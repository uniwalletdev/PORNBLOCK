'use strict';

require('dotenv').config();

const http           = require('node:http');
const dns2           = require('dns2');
const { loadBlocklist } = require('./cache');
const { resolve }    = require('./resolver');
const httpApp        = require('./http');

const DNS_UDP_PORT   = parseInt(process.env.DNS_PORT)      || 53;
const HTTP_PORT      = parseInt(process.env.DNS_HTTP_PORT)  || 8053;

async function start() {
  // ── Step 1: Populate Redis blocklist cache from PostgreSQL ────────────────
  // All DNS queries are served from cache to minimise DB round-trips.
  await loadBlocklist();

  // ── Step 2: Start UDP DNS server ──────────────────────────────────────────
  const dnsServer = dns2.createServer({
    udp: true,
    handle: async (request, send, rinfo) => {
      try {
        const response = await resolve(request, rinfo.address);
        send(response);
      } catch (err) {
        console.error('[DNS] Unhandled handler error:', err.message);
        // Return SERVFAIL so the client can retry rather than hanging
        try {
          const fallback = dns2.Packet.createResponseFromRequest(request);
          fallback.header.rcode = dns2.Packet.RCODE?.SERVFAIL ?? 2;
          send(fallback);
        } catch (_) {
          // If we cannot even build a SERVFAIL, let the client time out
        }
      }
    },
  });

  dnsServer.on('error', (err) => {
    console.error('[DNS] Server error:', err.message);
  });

  dnsServer.listen({
    udp: { port: DNS_UDP_PORT, address: '0.0.0.0' },
  });
  console.log(`[DNS] Listening on UDP 0.0.0.0:${DNS_UDP_PORT}`);

  // ── Step 3: Start HTTP control plane ─────────────────────────────────────
  // Bound to loopback only — this endpoint must NOT be internet-accessible.
  const httpServer = http.createServer(httpApp);
  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`[DNS] HTTP control at http://127.0.0.1:${HTTP_PORT}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = () => {
    console.log('\n[DNS] Shutting down…');
    dnsServer.close();
    httpServer.close(() => process.exit(0));
  };

  process.once('SIGINT',  shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[DNS] Fatal startup error:', err.message);
  process.exit(1);
});
