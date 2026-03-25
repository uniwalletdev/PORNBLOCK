/* eslint-disable camelcase */
/**
 * Migration 002 — DNS blocklist tables
 *
 * Creates: dns_blocklist, dns_allowlist, device_ip_map,
 *          dns_blocked_log, dns_unknown_log
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {

  // ── dns_blocklist ──────────────────────────────────────────────────────────
  pgm.createTable("dns_blocklist", {
    id:         { type: "bigserial",  primaryKey: true },
    domain:     { type: "text",       notNull: true, unique: true },
    category:   { type: "text",       notNull: true, default: "'porn'" },
    source:     { type: "text",       notNull: true, default: "'hagezi'" },
    added_at:   { type: "timestamptz",notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("dns_blocklist", "domain", { name: "idx_dns_blocklist_domain" });

  // ── dns_allowlist ──────────────────────────────────────────────────────────
  pgm.createTable("dns_allowlist", {
    id:         { type: "bigserial",  primaryKey: true },
    domain:     { type: "text",       notNull: true, unique: true },
    reason:     { type: "text" },
    added_at:   { type: "timestamptz",notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("dns_allowlist", "domain", { name: "idx_dns_allowlist_domain" });

  // ── device_ip_map ──────────────────────────────────────────────────────────
  pgm.createTable("device_ip_map", {
    id:            { type: "bigserial",  primaryKey: true },
    device_token:  { type: "text",       notNull: true },
    ip_address:    { type: "inet",       notNull: true },
    last_seen:     { type: "timestamptz",notNull: true, default: pgm.func("now()") },
  });
  pgm.sql("CREATE UNIQUE INDEX idx_device_ip_map ON device_ip_map (ip_address);");
  pgm.createIndex("device_ip_map", "device_token", { name: "idx_device_ip_device_token" });

  // ── dns_blocked_log ────────────────────────────────────────────────────────
  pgm.createTable("dns_blocked_log", {
    id:           { type: "bigserial",  primaryKey: true },
    device_token: { type: "text" },
    domain:       { type: "text",       notNull: true },
    client_ip:    { type: "inet" },
    ts:           { type: "timestamptz",notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("dns_blocked_log", "device_token");
  pgm.createIndex("dns_blocked_log", "ts");

  // ── dns_unknown_log ────────────────────────────────────────────────────────
  pgm.createTable("dns_unknown_log", {
    id:           { type: "bigserial",  primaryKey: true },
    domain:       { type: "text",       notNull: true },
    client_ip:    { type: "inet" },
    ts:           { type: "timestamptz",notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("dns_unknown_log", "domain");
  pgm.createIndex("dns_unknown_log", "ts");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("dns_unknown_log",  { cascade: true });
  pgm.dropTable("dns_blocked_log",  { cascade: true });
  pgm.dropTable("device_ip_map",    { cascade: true });
  pgm.dropTable("dns_allowlist",    { cascade: true });
  pgm.dropTable("dns_blocklist",    { cascade: true });
};
