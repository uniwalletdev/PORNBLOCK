// node-pg-migrate configuration
// See: https://salsita.github.io/node-pg-migrate/
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

// Railway always provides DATABASE_URL. Fall back to individual vars for local dev.
const databaseUrl =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}` +
    `@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5432}` +
    `/${process.env.DB_NAME}`;

module.exports = {
  databaseUrl,
  // Railway PostgreSQL requires SSL; disable cert validation for self-signed certs.
  decamelize: true,
  dir: "migrations",
  migrationsTable: "pgmigrations",
  // node-pg-migrate passes these directly to the pg.Pool constructor.
  ...(isProduction && {
    ssl: { rejectUnauthorized: false },
  }),
};
