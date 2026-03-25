// node-pg-migrate configuration
// See: https://salsita.github.io/node-pg-migrate/
require("dotenv").config();

module.exports = {
  databaseUrl: process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}` +
    `@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5432}` +
    `/${process.env.DB_NAME}`,
  migrationsTable: "pgmigrations",
  dir: "migrations",
  direction: "up",
  // Use timestamps in migration filenames for predictable ordering
  decamelize: true,
};
