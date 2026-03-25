-- =============================================================================
-- PORNBLOCK — Complete PostgreSQL Schema
-- =============================================================================
-- Apply with:  psql -U <user> -d <database> -f schema.sql
-- Requires:    PostgreSQL 14+ (gen_random_uuid(), GENERATED ALWAYS)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram indexes on email/name


-- ===========================================================================
-- UTILITY: updated_at auto-stamp trigger
-- ===========================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ===========================================================================
-- TABLE: users
-- ===========================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT        NOT NULL,
  password_hash       TEXT        NOT NULL,
  subscription_tier   TEXT        NOT NULL DEFAULT 'free'
                        CHECK (subscription_tier IN ('free', 'personal', 'family', 'org')),
  subscription_status TEXT        NOT NULL DEFAULT 'active'
                        CHECK (subscription_status IN (
                          'active', 'trialing', 'past_due', 'canceled', 'unpaid'
                        )),
  stripe_customer_id  TEXT        UNIQUE,                -- nullable until payment added
  role                TEXT        NOT NULL DEFAULT 'standard_user'
                        CHECK (role IN ('standard_user', 'admin')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email),
  -- Enforce lowercase email storage to prevent duplicate-case accounts
  CONSTRAINT users_email_lowercase CHECK (email = LOWER(email))
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email            ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_subscription     ON users (subscription_tier, subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Idempotent column additions (handles existing DBs created before this migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'standard_user'
  CHECK (role IN ('standard_user', 'admin'));


-- ===========================================================================
-- TABLE: devices
-- ===========================================================================
CREATE TABLE IF NOT EXISTS devices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL
                     REFERENCES users (id) ON DELETE CASCADE,
  device_name      TEXT        NOT NULL,
  platform         TEXT        NOT NULL
                     CHECK (platform IN ('ios', 'android', 'windows', 'mac')),
  device_token     TEXT        NOT NULL,               -- unique per-device secret for agent auth
  protection_active BOOLEAN    NOT NULL DEFAULT TRUE,
  protection_status TEXT        NOT NULL DEFAULT 'active'
                     CHECK (protection_status IN ('active', 'inactive', 'tampered')),
  last_heartbeat   TIMESTAMPTZ,
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT devices_token_unique UNIQUE (device_token)
);

DROP TRIGGER IF EXISTS trg_devices_updated_at ON devices;
CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devices_user_id         ON devices (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_platform        ON devices (platform);
CREATE INDEX IF NOT EXISTS idx_devices_last_heartbeat  ON devices (last_heartbeat DESC NULLS LAST);
-- Partial: only active devices need fast heartbeat lookups
CREATE INDEX IF NOT EXISTS idx_devices_active_heartbeat ON devices (user_id, last_heartbeat DESC)
  WHERE protection_active = TRUE;

-- Idempotent column additions (handles existing DBs created before this migration)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS protection_status TEXT NOT NULL DEFAULT 'active'
  CHECK (protection_status IN ('active', 'inactive', 'tampered'));
ALTER TABLE accountability_partners ADD COLUMN IF NOT EXISTS notify_violations BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE accountability_partners ADD COLUMN IF NOT EXISTS notify_tamper BOOLEAN NOT NULL DEFAULT TRUE;


-- ===========================================================================
-- TABLE: policies
-- ===========================================================================
CREATE TABLE IF NOT EXISTS policies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL
                      REFERENCES users (id) ON DELETE CASCADE,
  sensitivity_level SMALLINT    NOT NULL DEFAULT 2
                      CHECK (sensitivity_level BETWEEN 1 AND 3),
  -- 1 = moderate  |  2 = strict  |  3 = maximum
  allowlist         TEXT[]      NOT NULL DEFAULT '{}',
  blocklist         TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one policy per user
  CONSTRAINT policies_user_unique UNIQUE (user_id)
);

DROP TRIGGER IF EXISTS trg_policies_updated_at ON policies;
CREATE TRIGGER trg_policies_updated_at
  BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_policies_user_id           ON policies (user_id);
CREATE INDEX IF NOT EXISTS idx_policies_sensitivity       ON policies (sensitivity_level);
-- GIN indexes for array containment queries (@> / <@)
CREATE INDEX IF NOT EXISTS idx_policies_allowlist_gin     ON policies USING GIN (allowlist);
CREATE INDEX IF NOT EXISTS idx_policies_blocklist_gin     ON policies USING GIN (blocklist);


-- ===========================================================================
-- TABLE: accountability_partners
-- ===========================================================================
CREATE TABLE IF NOT EXISTS accountability_partners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL
                  REFERENCES users (id) ON DELETE CASCADE,
  partner_email TEXT        NOT NULL,
  partner_name  TEXT,
  role          TEXT        NOT NULL DEFAULT 'standard'
                  CHECK (role IN ('primary', 'standard', 'observer')),
  status        TEXT        NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'revoked')),
  invite_token              TEXT        UNIQUE,
  invite_token_expires_at   TIMESTAMPTZ,
  notify_violations         BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_tamper             BOOLEAN     NOT NULL DEFAULT TRUE,
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate partner invitations for the same user
  CONSTRAINT accountability_partners_unique_pair UNIQUE (user_id, partner_email),
  -- Enforce lowercase email storage
  CONSTRAINT accountability_partners_email_lowercase
    CHECK (partner_email = LOWER(partner_email))
);

DROP TRIGGER IF EXISTS trg_accountability_partners_updated_at ON accountability_partners;
CREATE TRIGGER trg_accountability_partners_updated_at
  BEFORE UPDATE ON accountability_partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ap_user_id       ON accountability_partners (user_id);
CREATE INDEX IF NOT EXISTS idx_ap_partner_email ON accountability_partners (partner_email);
CREATE INDEX IF NOT EXISTS idx_ap_status        ON accountability_partners (status);
-- GIN trigram for fuzzy partner name search
CREATE INDEX IF NOT EXISTS idx_ap_partner_name_trgm
  ON accountability_partners USING GIN (partner_name gin_trgm_ops)
  WHERE partner_name IS NOT NULL;
-- Partial: active partners only
CREATE INDEX IF NOT EXISTS idx_ap_active ON accountability_partners (user_id)
  WHERE status = 'active';


-- ===========================================================================
-- TABLE: partner_approvals
-- ===========================================================================
-- Records change-requests that require partner sign-off before taking effect.
-- Examples: pause protection, add to allowlist, change sensitivity level.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS partner_approvals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  TEXT        NOT NULL
                  CHECK (request_type IN (
                    'pause_protection',
                    'sensitivity_change',
                    'allowlist_add',
                    'blocklist_remove',
                    'device_unenroll',
                    'account_delete'
                  )),
  requested_by  UUID        NOT NULL
                  REFERENCES users (id) ON DELETE CASCADE,
  reason        TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'denied')),
  delay_until   TIMESTAMPTZ,          -- enforce cooling-off period before approval takes effect
  metadata      JSONB,                -- stores before/after values specific to request_type
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- resolved_at must be set when status leaves 'pending'
  CONSTRAINT partner_approvals_resolved_consistency
    CHECK (
      (status = 'pending'  AND resolved_at IS NULL) OR
      (status <> 'pending' AND resolved_at IS NOT NULL)
    )
);

DROP TRIGGER IF EXISTS trg_partner_approvals_updated_at ON partner_approvals;
CREATE TRIGGER trg_partner_approvals_updated_at
  BEFORE UPDATE ON partner_approvals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pa_requested_by  ON partner_approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_pa_status        ON partner_approvals (status);
CREATE INDEX IF NOT EXISTS idx_pa_created_at    ON partner_approvals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_delay_until   ON partner_approvals (delay_until)
  WHERE delay_until IS NOT NULL;
-- Partial: open cases that partners need to action
CREATE INDEX IF NOT EXISTS idx_pa_pending ON partner_approvals (requested_by, created_at DESC)
  WHERE status = 'pending';


-- ===========================================================================
-- TABLE: violations
-- ===========================================================================
CREATE TABLE IF NOT EXISTS violations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id        UUID        NOT NULL
                     REFERENCES devices (id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL
                     REFERENCES users (id) ON DELETE CASCADE,
  violation_type   TEXT        NOT NULL
                     CHECK (violation_type IN (
                       'dns_block',
                       'vision_classifier',
                       'app_filter',
                       'url_block',
                       'screen_monitor'
                     )),
  confidence_score REAL
                     CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  -- Store only a cryptographic hash of the screenshot — never the raw image.
  -- The actual image (if retained at all) must live in encrypted object storage.
  screenshot_hash  TEXT,
  network_type     TEXT
                     CHECK (network_type IN ('wifi', 'cellular', 'ethernet', 'vpn', 'unknown')),
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- the "timestamp" column from spec
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_violations_updated_at ON violations;
CREATE TRIGGER trg_violations_updated_at
  BEFORE UPDATE ON violations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_violations_device_id    ON violations (device_id);
CREATE INDEX IF NOT EXISTS idx_violations_user_id      ON violations (user_id);
CREATE INDEX IF NOT EXISTS idx_violations_detected_at  ON violations (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_type         ON violations (violation_type);
-- Composite: most common dashboard query — a user's recent violations
CREATE INDEX IF NOT EXISTS idx_violations_user_recent  ON violations (user_id, detected_at DESC);
-- Partial: high-confidence hits (> 0.8) for fast severity dashboards
CREATE INDEX IF NOT EXISTS idx_violations_high_conf    ON violations (user_id, detected_at DESC)
  WHERE confidence_score > 0.8;


-- ===========================================================================
-- TABLE: audit_log  (APPEND-ONLY — no UPDATE or DELETE permitted)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID,                  -- NULL for system-initiated actions
  action     TEXT        NOT NULL,  -- e.g. 'user.login', 'policy.updated', 'device.enrolled'
  target_id  UUID,                  -- ID of the affected resource (user, device, policy…)
  metadata   JSONB,                 -- structured diff / contextual payload
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at: this table must never be modified after insert
);

-- ---------------------------------------------------------------------------
-- Enforce append-only semantics at the database level
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_deny_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % operations are not permitted.', TG_OP
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_deny_mutation();

DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_log;
CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_deny_mutation();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id   ON audit_log (actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_id  ON audit_log (target_id)
  WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
-- Composite: fetch full audit trail for a specific actor in time order
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_time ON audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
-- GIN index for searching inside the metadata payload
CREATE INDEX IF NOT EXISTS idx_audit_log_metadata_gin ON audit_log USING GIN (metadata)
  WHERE metadata IS NOT NULL;


-- ===========================================================================
-- TABLE-LEVEL COMMENTS
-- ===========================================================================
COMMENT ON TABLE users
  IS 'Registered accounts. Email stored lowercase-normalised.';

COMMENT ON TABLE devices
  IS 'Enrolled devices. device_token is issued at enrolment and used for agent auth.';

COMMENT ON TABLE policies
  IS 'One row per user. sensitivity_level: 1=moderate, 2=strict, 3=maximum.';

COMMENT ON TABLE accountability_partners
  IS 'Trusted contacts who receive violation summaries and approve policy changes.';

COMMENT ON TABLE partner_approvals
  IS 'Change-requests requiring partner sign-off. delay_until enforces a cooling-off window.';

COMMENT ON TABLE violations
  IS 'Detected content policy violations. screenshot_hash is a SHA-256 of the thumbnail only.';

COMMENT ON TABLE audit_log
  IS 'Immutable event log. Rows may never be updated or deleted — enforced by triggers.';

COMMENT ON COLUMN violations.screenshot_hash
  IS 'SHA-256 hex digest of the screenshot thumbnail. Raw image must be stored encrypted externally.';

COMMENT ON COLUMN partner_approvals.delay_until
  IS 'Approved changes must not be applied until this timestamp, enforcing a cooling-off period.';


-- ===========================================================================
-- TABLE: partner_change_requests
-- ===========================================================================
-- User-submitted requests to change protection settings; require partner
-- majority approval before taking effect after a mandatory 72-hour delay.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS partner_change_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL
                  REFERENCES users (id) ON DELETE CASCADE,
  request_type  TEXT        NOT NULL
                  CHECK (request_type IN (
                    'remove_protection',
                    'change_setting',
                    'allowlist_site'
                  )),
  reason        TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'denied', 'executing', 'executed')),
  payload       JSONB       NOT NULL DEFAULT '{}',
  delay_until   TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_partner_requests_updated_at ON partner_change_requests;
CREATE TRIGGER trg_partner_requests_updated_at
  BEFORE UPDATE ON partner_change_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_pcr_user_id  ON partner_change_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_pcr_status   ON partner_change_requests (status);
CREATE INDEX IF NOT EXISTS idx_pcr_delay    ON partner_change_requests (delay_until)
  WHERE delay_until IS NOT NULL AND executed_at IS NULL;

COMMENT ON TABLE partner_change_requests
  IS 'Change requests submitted by users that require partner approval + 72-hour delay.';


-- ===========================================================================
-- TABLE: partner_actions
-- ===========================================================================
-- One row per partner per change-request. Stores the secure action token
-- sent by email and records whether the partner approved or denied.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS partner_actions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID        NOT NULL
                     REFERENCES partner_change_requests (id) ON DELETE CASCADE,
  partner_id       UUID        NOT NULL
                     REFERENCES accountability_partners (id) ON DELETE CASCADE,
  action_token     TEXT        NOT NULL UNIQUE,
  action           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (action IN ('pending', 'approved', 'denied')),
  denial_reason    TEXT,
  acted_at         TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_action_per_partner_request UNIQUE (request_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_pa_token      ON partner_actions (action_token);
CREATE INDEX IF NOT EXISTS idx_pa_request_id ON partner_actions (request_id);
CREATE INDEX IF NOT EXISTS idx_pa_partner_id ON partner_actions (partner_id);

COMMENT ON TABLE partner_actions
  IS 'Individual approve/deny votes from each partner. action_token is sent via email link.';


COMMIT;
