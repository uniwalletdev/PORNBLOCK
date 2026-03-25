/* eslint-disable camelcase */
exports.up = (pgm) => { pgm.sql("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'standard_user', ALTER COLUMN subscription_tier SET DEFAULT 'free'"); pgm.sql("ALTER TABLE devices ALTER COLUMN protection_status SET DEFAULT 'inactive'"); pgm.sql("ALTER TABLE policies ALTER COLUMN sensitivity_level SET DEFAULT 'standard'"); pgm.sql("ALTER TABLE dns_blocklist ALTER COLUMN category SET DEFAULT 'porn', ALTER COLUMN source SET DEFAULT 'hagezi'"); };
exports.down = (pgm) => { pgm.sql('SELECT 1'); };
