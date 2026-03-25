package app.pornblock.vpn

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

private const val TAG = "DnsPacketProcessor"

/**
 * Parses raw IPv4+UDP+DNS packets coming off the TUN interface
 * and either returns an NXDOMAIN response or forwards to upstream.
 *
 * Upstream forwarding MUST use a socket that has already been protected
 * via VpnService.protect() to avoid a routing loop.
 */
class DnsPacketProcessor(
    private val protect: (DatagramSocket) -> Boolean,
    private val upstreamDns: String = "1.1.1.1",
    private val upstreamPort: Int = 53,
) {

    // ── Domain blocklist (populated from SecureStorage / API) ────────────────

    @Volatile
    private var blocklist: Set<String> = emptySet()

    @Volatile
    private var allowlist: Set<String> = emptySet()

    fun updateBlocklist(domains: Set<String>) { blocklist = domains }
    fun updateAllowlist(domains: Set<String>) { allowlist = domains }

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Process one raw IP packet read from the TUN fd.
     *
     * @return A fully formed IP+UDP+DNS response to write back to the TUN fd,
     *         or null if the packet is not DNS / should be ignored.
     */
    fun process(raw: ByteArray, length: Int): ByteArray? {
        if (length < 28) return null  // min IPv4(20) + UDP(8) = 28 bytes

        // --- IPv4 header ---
        val ipVersion  = (raw[0].toInt() ushr 4) and 0xF
        if (ipVersion != 4) return null

        val ipHeaderLen = (raw[0].toInt() and 0xF) * 4
        val protocol    = raw[9].toInt() and 0xFF
        if (protocol != 17) return null  // not UDP

        if (length < ipHeaderLen + 8) return null

        // --- UDP header ---
        val dstPort = getU16(raw, ipHeaderLen + 2)
        if (dstPort != 53) return null  // not DNS

        val udpPayloadOffset = ipHeaderLen + 8
        val udpPayloadLen    = length - udpPayloadOffset
        if (udpPayloadLen < 12) return null  // too short for a DNS header

        val dnsPayload = raw.copyOfRange(udpPayloadOffset, length)

        // --- DNS query ---
        val domain = parseDomainFromQuery(dnsPayload) ?: return null

        return if (isDomainBlocked(domain)) {
            Log.d(TAG, "NXDOMAIN: $domain")
            buildNxDomainPacket(raw, ipHeaderLen, dnsPayload)
        } else {
            Log.d(TAG, "Forward: $domain")
            forwardToUpstream(raw, ipHeaderLen, dnsPayload)
        }
    }

    // ── Domain checking ───────────────────────────────────────────────────────

    private fun isDomainBlocked(domain: String): Boolean {
        val lower = domain.lowercase().trimEnd('.')
        // Explicit allowlist overrides blocklist
        if (lower in allowlist || isChildOf(lower, allowlist)) return false
        // Check blocklist (exact + parent hierarchy)
        return lower in blocklist || isChildOf(lower, blocklist)
    }

    private fun isChildOf(domain: String, list: Set<String>): Boolean {
        var d = domain
        while ('.' in d) {
            d = d.substringAfter('.')
            if (d in list) return true
        }
        return false
    }

    // ── DNS parsing ───────────────────────────────────────────────────────────

    private fun parseDomainFromQuery(dns: ByteArray): String? {
        if (dns.size < 12) return null
        var pos = 12  // Question section starts after the 12-byte DNS header
        val labels = mutableListOf<String>()
        try {
            while (pos < dns.size) {
                val labelLen = dns[pos].toInt() and 0xFF
                if (labelLen == 0) break
                if ((labelLen and 0xC0) == 0xC0) break  // compression pointer — skip
                pos++
                if (pos + labelLen > dns.size) return null
                labels.add(String(dns, pos, labelLen, Charsets.US_ASCII))
                pos += labelLen
            }
        } catch (e: Exception) {
            return null
        }
        return if (labels.isEmpty()) null else labels.joinToString(".")
    }

    // ── NXDOMAIN response builder ─────────────────────────────────────────────

    private fun buildNxDomainPacket(
        originalIp: ByteArray,
        ipHeaderLen: Int,
        dnsQuery: ByteArray,
    ): ByteArray {
        // Clone the entire DNS query and flip it into a response
        val response = dnsQuery.copyOf()
        // Flags byte[2]: set QR=1 (response), keep other query flags
        response[2] = (dnsQuery[2].toInt() or 0x80).toByte()
        // Flags byte[3]: RA=1, RCODE=3 (NXDOMAIN)
        response[3] = 0x83.toByte()
        // Zero ANCOUNT, NSCOUNT, ARCOUNT; keep QDCOUNT=1
        response[6] = 0; response[7] = 0
        response[8] = 0; response[9] = 0
        response[10] = 0; response[11] = 0

        return buildIpUdpPacket(
            srcIp   = originalIp.copyOfRange(16, 20),  // original dst → new src
            dstIp   = originalIp.copyOfRange(12, 16),  // original src → new dst
            srcPort = getU16(originalIp, ipHeaderLen + 2),  // original dst port (53)
            dstPort = getU16(originalIp, ipHeaderLen + 0),  // original src port
            payload = response,
        )
    }

    // ── Upstream forwarding ───────────────────────────────────────────────────

    private fun forwardToUpstream(
        originalIp: ByteArray,
        ipHeaderLen: Int,
        dnsQuery: ByteArray,
    ): ByteArray? {
        return try {
            val socket = DatagramSocket()
            protect(socket)  // critical: prevent routing loop through VPN tunnel
            socket.soTimeout = 3_000

            val sendPacket = DatagramPacket(dnsQuery, dnsQuery.size, InetAddress.getByName(upstreamDns), upstreamPort)
            socket.send(sendPacket)

            val buf = ByteArray(4096)
            val recvPacket = DatagramPacket(buf, buf.size)
            socket.receive(recvPacket)
            socket.close()

            val responsePayload = recvPacket.data.copyOf(recvPacket.length)

            buildIpUdpPacket(
                srcIp   = originalIp.copyOfRange(16, 20),
                dstIp   = originalIp.copyOfRange(12, 16),
                srcPort = getU16(originalIp, ipHeaderLen + 2),
                dstPort = getU16(originalIp, ipHeaderLen + 0),
                payload = responsePayload,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Upstream forwarding failed: ${e.message}")
            null
        }
    }

    // ── Packet builder ────────────────────────────────────────────────────────

    private fun buildIpUdpPacket(
        srcIp: ByteArray,
        dstIp: ByteArray,
        srcPort: Int,
        dstPort: Int,
        payload: ByteArray,
    ): ByteArray {
        val udpLen = 8 + payload.size
        val ipLen  = 20 + udpLen
        val packet = ByteArray(ipLen)

        // IPv4 header
        packet[0]  = 0x45.toByte()             // Version=4, IHL=5 (20 bytes)
        packet[1]  = 0x00                       // DSCP/ECN
        setU16(packet, 2, ipLen)               // Total length
        packet[4]  = 0x00; packet[5] = 0x00    // Identification
        packet[6]  = 0x40; packet[7] = 0x00    // Flags=DF, Fragment offset=0
        packet[8]  = 0x40.toByte()              // TTL=64
        packet[9]  = 0x11.toByte()              // Protocol=UDP
        packet[10] = 0x00; packet[11] = 0x00    // Checksum placeholder
        srcIp.copyInto(packet, 12)
        dstIp.copyInto(packet, 16)

        // IP checksum (over header only)
        val ipChecksum = ipChecksum(packet, 0, 20)
        setU16(packet, 10, ipChecksum)

        // UDP header
        setU16(packet, 20, srcPort)
        setU16(packet, 22, dstPort)
        setU16(packet, 24, udpLen)
        packet[26] = 0x00; packet[27] = 0x00   // Checksum optional for IPv4

        // Payload
        payload.copyInto(packet, 28)
        return packet
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun getU16(buf: ByteArray, offset: Int): Int =
        ((buf[offset].toInt() and 0xFF) shl 8) or (buf[offset + 1].toInt() and 0xFF)

    private fun setU16(buf: ByteArray, offset: Int, value: Int) {
        buf[offset]     = (value ushr 8 and 0xFF).toByte()
        buf[offset + 1] = (value        and 0xFF).toByte()
    }

    private fun ipChecksum(buf: ByteArray, offset: Int, length: Int): Int {
        var sum = 0L
        var i = offset
        while (i < offset + length - 1) {
            sum += ((buf[i].toInt() and 0xFF) shl 8) or (buf[i + 1].toInt() and 0xFF)
            i += 2
        }
        if ((length and 1) != 0) {
            sum += (buf[offset + length - 1].toInt() and 0xFF) shl 8
        }
        while (sum ushr 16 != 0L) {
            sum = (sum and 0xFFFF) + (sum ushr 16)
        }
        return sum.inv().toInt() and 0xFFFF
    }
}
