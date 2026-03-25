'use strict';

const dgram  = require('node:dgram');
const dns2   = require('dns2');
const cache  = require('./cache');
const db     = require('./db');

const { Packet } = dns2;

const UPSTREAM_IP      = process.env.DNS_UPSTREAM || '1.1.1.1';
const UPSTREAM_PORT    = 53;
const FORWARD_TIMEOUT  = 5000; // ms

// ── RCODE constants (RFC 1035) ────────────────────────────────────────────────
const RCODE_NXDOMAIN = Packet.RCODE?.NXDOMAIN ?? 3;
const RCODE_SERVFAIL = Packet.RCODE?.SERVFAIL ?? 2;

// ═════════════════════════════════════════════════════════════════════════════
// Upstream forwarding
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Serialise a dns2 Packet to a raw UDP buffer.
 * dns2 v2 exposes toBuffer() as a Packet instance method.
 */
function packetToBuffer(pkt) {
  return pkt.toBuffer();
}

/**
 * Forward a DNS request packet to UPSTREAM_IP over UDP and return the
 * parsed response Packet.
 *
 * Resolution flow keeps the original transaction ID intact:
 *   client → (ID=N) → our server → (ID=N) → 1.1.1.1
 *   1.1.1.1 replies (ID=N), we copy its answers into `Packet.createResponseFromRequest`
 *   which already holds ID=N, so the client gets back the right ID.
 */
function forwardToUpstream(request) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');

    const timer = setTimeout(() => {
      try { socket.close(); } catch (_) {}
      reject(new Error(`DNS upstream at ${UPSTREAM_IP} timed out after ${FORWARD_TIMEOUT}ms`));
    }, FORWARD_TIMEOUT);

    socket.once('message', (msg) => {
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      try {
        resolve(Packet.parse(msg));
      } catch (parseErr) {
        reject(parseErr);
      }
    });

    socket.once('error', (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      reject(err);
    });

    let buf;
    try {
      buf = packetToBuffer(request);
    } catch (serErr) {
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      reject(serErr);
      return;
    }

    socket.send(buf, UPSTREAM_PORT, UPSTREAM_IP, (sendErr) => {
      if (sendErr) {
        clearTimeout(timer);
        try { socket.close(); } catch (_) {}
        reject(sendErr);
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Response builders
// ═════════════════════════════════════════════════════════════════════════════

function buildNxDomain(request) {
  const response = Packet.createResponseFromRequest(request);
  response.header.rcode = RCODE_NXDOMAIN;
  return response;
}

function buildServFail(request) {
  const response = Packet.createResponseFromRequest(request);
  response.header.rcode = RCODE_SERVFAIL;
  return response;
}

/** Forward to upstream and merge answers into a fresh response. */
async function buildForwarded(request) {
  const upstream = await forwardToUpstream(request);
  const response = Packet.createResponseFromRequest(request);
  response.header.rcode = upstream.header.rcode;
  response.answers     = upstream.answers     || [];
  response.authorities = upstream.authorities || [];
  // Intentionally omit additionals — avoids leaking EDNS0 OPT records upstream
  return response;
}

// ═════════════════════════════════════════════════════════════════════════════
// Blocked-query side-effects
// ═════════════════════════════════════════════════════════════════════════════

async function handleBlocked(domain, sourceIp) {
  try {
    const device = await db.lookupDeviceByIp(sourceIp);
    await db.logBlocked({
      domain,
      source_ip:    sourceIp,
      device_id:    device?.device_id   || null,
      device_token: device?.device_token || null,
    });
    console.log(
      `[DNS] BLOCKED  ${domain}  from ${sourceIp}` +
      (device ? `  token=${device.device_token}` : '  (device unknown)')
    );
  } catch (err) {
    // Logging must never crash the DNS response path
    console.error('[DNS] Failed to log blocked query:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Core resolution logic
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a DNS request from `sourceIp` and return the Packet to send back.
 *
 * Decision tree:
 *  1. No question → SERVFAIL
 *  2. Domain on Redis allowlist → forward immediately (no block check)
 *  3. Domain on Redis blocklist → NXDOMAIN + log
 *  4. Cache miss → check PostgreSQL
 *     a. In allowlist → warm cache, forward
 *     b. In blocklist → warm cache, NXDOMAIN + log
 *     c. Unknown      → forward upstream, log for AI classification
 */
async function resolve(request, sourceIp) {
  const [question] = request.questions;
  if (!question) return buildServFail(request);

  const domain = cache.normalise(question.name);

  // ── 1. Allowlist cache hit ─────────────────────────────────────────────────
  if (await cache.isAllowed(domain)) {
    return buildForwarded(request).catch(() => buildServFail(request));
  }

  // ── 2. Blocklist cache hit ────────────────────────────────────────────────
  if (await cache.isBlocked(domain)) {
    handleBlocked(domain, sourceIp); // fire-and-forget — don't await logging
    return buildNxDomain(request);
  }

  // ── 3. Cache miss: consult PostgreSQL in parallel ─────────────────────────
  const [inAllowlist, inBlocklist] = await Promise.all([
    db.isInAllowlist(domain),
    db.isInBlocklist(domain),
  ]);

  if (inAllowlist) {
    cache.warmAllow(domain);
    return buildForwarded(request).catch(() => buildServFail(request));
  }

  if (inBlocklist) {
    cache.warmBlock(domain);
    handleBlocked(domain, sourceIp);
    return buildNxDomain(request);
  }

  // ── 4. Unknown: forward to upstream and log for classification ────────────
  db.logUnknown({ domain, source_ip: sourceIp }).catch(() => {});
  return buildForwarded(request).catch(() => buildServFail(request));
}

module.exports = { resolve };
