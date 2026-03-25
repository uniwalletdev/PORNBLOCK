/* eslint-disable camelcase */
/**
 * Migration 004 — Accountability partner system
 *
 * Changes:
 *  1. Adds invite_token + invite_token_expires_at to accountability_partners
 *     (role + status already exist from schema.sql; this migration adds them
 *      for DBs originally set up via migrations 001–003 which omitted them)
 *  2. Creates partner_change_requests — tracks user-submitted change requests
 *  3. Creates partner_actions — one row per partner per request (approve/deny tokens)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── 1. Complete accountability_partners ────────────────────────────────────
  // Migrations 001-003 created the table without role/status/invite fields.
  // Add the missing columns (idempotent via IF NOT EXISTS via raw SQL).
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'accountability_partners' AND column_name = 'role'
      ) THEN
        ALTER TABLE accountability_partners
          ADD COLUMN role TEXT NOT NULL DEFAULT 'standard'
            CHECK (role IN ('primary','standard','observer'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'accountability_partners' AND column_name = 'status'
      ) THEN
        ALTER TABLE accountability_partners
          ADD COLUMN status TEXT NOT NULL DEFAULT 'invited'
            CHECK (status IN ('invited','active','revoked'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'accountability_partners' AND column_name = 'invite_token'
      ) THEN
        ALTER TABLE accountability_partners
          ADD COLUMN invite_token TEXT UNIQUE,
          ADD COLUMN invite_token_expires_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);

  // ── 2. partner_change_requests ────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS partner_change_requests (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_type  TEXT        NOT NULL
                      CHECK (request_type IN (
                        'remove_protection',
                        'change_setting',
                        'allowlist_site'
                      )),
      reason        TEXT        NOT NULL,
      status        TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','denied','executing','executed')),
      payload       JSONB       NOT NULL DEFAULT '{}',
      delay_until   TIMESTAMPTZ,
      executed_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_pcr_user_id  ON partner_change_requests (user_id);
    CREATE INDEX IF NOT EXISTS idx_pcr_status   ON partner_change_requests (status);
    CREATE INDEX IF NOT EXISTS idx_pcr_delay    ON partner_change_requests (delay_until)
      WHERE delay_until IS NOT NULL AND executed_at IS NULL;

    CREATE TRIGGER trg_partner_requests_updated_at
      BEFORE UPDATE ON partner_change_requests
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── 3. partner_actions ─────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS partner_actions (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id       UUID        NOT NULL REFERENCES partner_change_requests(id) ON DELETE CASCADE,
      partner_id       UUID        NOT NULL REFERENCES accountability_partners(id) ON DELETE CASCADE,
      action_token     TEXT        NOT NULL UNIQUE,
      action           TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (action IN ('pending','approved','denied')),
      denial_reason    TEXT,
      acted_at         TIMESTAMPTZ,
      token_expires_at TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_action_per_partner_request UNIQUE (request_id, partner_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pa_token      ON partner_actions (action_token);
    CREATE INDEX IF NOT EXISTS idx_pa_request_id ON partner_actions (request_id);
    CREATE INDEX IF NOT EXISTS idx_pa_partner_id ON partner_actions (partner_id);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS partner_actions CASCADE;`);
  pgm.sql(`DROP TABLE IF EXISTS partner_change_requests CASCADE;`);
  pgm.sql(`
    ALTER TABLE accountability_partners
      DROP COLUMN IF EXISTS invite_token_expires_at,
      DROP COLUMN IF EXISTS invite_token,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS role;
  `);
};
