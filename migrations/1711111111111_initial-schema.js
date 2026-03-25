/* eslint-disable camelcase */
/**
 * Migration 001 — core tables
 *
 * Creates: users, devices, policies, accountability_partners,
 *          partner_approvals, violations, audit_log
 *
 * Mirrors src/db/schema.sql but expressed as node-pg-migrate calls
 * so the migration is tracked in pgmigrations and can be rolled back.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {

  // ── Extensions ─────────────────────────────────────────────────────────────
  pgm.createExtension("pgcrypto",   { ifNotExists: true });
  pgm.createExtension("pg_trgm",    { ifNotExists: true });
  pgm.createExtension("btree_gin",  { ifNotExists: true });

  // ── set_updated_at helper ──────────────────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `);

  // ── users ──────────────────────────────────────────────────────────────────
  pgm.createTable("users", {
    id:         { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email:      { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    role:       { type: "text", notNull: true, default: "'standard_user'",
                  check: "role IN ('standard_user','admin')" },
    subscription_tier: { type: "text", notNull: true, default: "'free'",
                         check: "subscription_tier IN ('free','pro','family')" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("users", "email");
  pgm.sql(`CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ── devices ────────────────────────────────────────────────────────────────
  pgm.createTable("devices", {
    id:               { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id:          { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    device_name:      { type: "text", notNull: true },
    platform:         { type: "text", check: "platform IN ('android','ios','windows','mac','linux')" },
    device_token:     { type: "text", unique: true },
    protection_status:{ type: "text", notNull: true, default: "'inactive'",
                        check: "protection_status IN ('active','inactive','tampered')" },
    last_heartbeat:   { type: "timestamptz" },
    app_version:      { type: "text" },
    created_at:       { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at:       { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("devices", "user_id");
  pgm.createIndex("devices", "device_token");
  pgm.sql(`CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ── policies ───────────────────────────────────────────────────────────────
  pgm.createTable("policies", {
    id:                { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    device_id:         { type: "uuid", notNull: true, unique: true,
                         references: "devices", onDelete: "CASCADE" },
    sensitivity_level: { type: "text", notNull: true, default: "'standard'",
                         check: "sensitivity_level IN ('low','standard','strict')" },
    custom_blocklist:  { type: "text[]", notNull: true, default: pgm.func("ARRAY[]::text[]") },
    custom_allowlist:  { type: "text[]", notNull: true, default: pgm.func("ARRAY[]::text[]") },
    created_at:        { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at:        { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.sql(`CREATE INDEX idx_policies_blocklist  ON policies USING GIN (custom_blocklist);`);
  pgm.sql(`CREATE INDEX idx_policies_allowlist  ON policies USING GIN (custom_allowlist);`);
  pgm.sql(`CREATE TRIGGER trg_policies_updated_at
    BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ── accountability_partners ────────────────────────────────────────────────
  pgm.createTable("accountability_partners", {
    id:           { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id:      { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    partner_name: { type: "text", notNull: true },
    partner_email:{ type: "text", notNull: true },
    notify_violations: { type: "boolean", notNull: true, default: true },
    notify_tamper:     { type: "boolean", notNull: true, default: true },
    created_at:   { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at:   { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("accountability_partners", "user_id");
  pgm.sql(`CREATE INDEX idx_partners_name_trgm
    ON accountability_partners USING GIN (partner_name gin_trgm_ops);`);
  pgm.sql(`CREATE TRIGGER trg_partners_updated_at
    BEFORE UPDATE ON accountability_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ── violations ─────────────────────────────────────────────────────────────
  pgm.createTable("violations", {
    id:               { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    device_id:        { type: "uuid", notNull: true, references: "devices", onDelete: "CASCADE" },
    violation_type:   { type: "text", notNull: true,
                        check: "violation_type IN ('dns_block','nsfw_screen','manual')" },
    url:              { type: "text" },
    confidence_score: { type: "real" },
    screenshot_hash:  { type: "text" },
    details:          { type: "jsonb" },
    created_at:       { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("violations", "device_id");
  pgm.createIndex("violations", "created_at");

  // ── enrolment_tokens ───────────────────────────────────────────────────────
  pgm.createTable("enrolment_tokens", {
    id:         { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id:    { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    device_id:  { type: "uuid", references: "devices", onDelete: "SET NULL" },
    token:      { type: "text", notNull: true, unique: true },
    used:       { type: "boolean", notNull: true, default: false },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("enrolment_tokens", "token");
  pgm.createIndex("enrolment_tokens", ["user_id", "used"]);

  // ── audit_log (append-only) ────────────────────────────────────────────────
  pgm.createTable("audit_log", {
    id:         { type: "bigserial", primaryKey: true },
    actor_id:   { type: "uuid" },
    event:      { type: "text", notNull: true },
    payload:    { type: "jsonb" },
    ip:         { type: "inet" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("audit_log", "actor_id");
  pgm.createIndex("audit_log", "created_at");
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit_log_deny_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$;

    CREATE TRIGGER trg_audit_log_no_update
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_deny_mutation();
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("audit_log",               { cascade: true });
  pgm.dropTable("enrolment_tokens",        { cascade: true });
  pgm.dropTable("violations",              { cascade: true });
  pgm.dropTable("accountability_partners", { cascade: true });
  pgm.dropTable("policies",               { cascade: true });
  pgm.dropTable("devices",                { cascade: true });
  pgm.dropTable("users",                  { cascade: true });
  pgm.sql("DROP FUNCTION IF EXISTS set_updated_at() CASCADE;");
  pgm.sql("DROP FUNCTION IF EXISTS audit_log_deny_mutation() CASCADE;");
};
