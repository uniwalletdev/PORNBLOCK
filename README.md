# PORNBLOCK — Development Environment

Content-protection platform with DNS filtering, screen monitoring, and Android VPN enforcement.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Docker Desktop | 24 |
| Docker Compose | 2.x (bundled with Docker Desktop) |
| Node.js | 20 LTS |
| npm | 10 |
| Android Studio | Ladybug (2024.2) or later |

---

## Quick start (Docker — all services)

```bash
# 1. Clone and enter the repo
git clone <repo-url> pornblock && cd pornblock

# 2. Create env file and fill in secrets
cp .env.example .env
# Required: DB_PASSWORD, JWT_SECRET (≥64 chars), SEED_ADMIN_PASSWORD

# 3. Start all services  
docker compose up --build

# Services available at:
#   API        →  http://localhost:3000
#   Dashboard  →  http://localhost:5173
#   PostgreSQL →  localhost:5432
#   Redis      →  localhost:6379
```

On first boot the PostgreSQL container automatically executes `src/db/schema.sql`.

---

## Manual setup (without Docker)

### 1. PostgreSQL 15

```bash
# macOS (Homebrew)
brew install postgresql@15 && brew services start postgresql@15

# Ubuntu / Debian
sudo apt install postgresql-15

# Windows — use the installer at https://www.postgresql.org/download/windows/
# or run: docker run -p 5432:5432 -e POSTGRES_PASSWORD=yourpass postgres:15-alpine
```

Create the database and user:

```sql
CREATE USER pornblock WITH PASSWORD 'yourpassword';
CREATE DATABASE pornblock OWNER pornblock;
\c pornblock
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 2. Redis 7

```bash
# macOS
brew install redis && brew services start redis

# Ubuntu
sudo apt install redis-server && sudo systemctl start redis

# Windows / any platform
docker run -d -p 6379:6379 redis:7-alpine
```

### 3. Backend API

```bash
# Install dependencies
npm install

# Copy env and configure
cp .env.example .env          # fill in DB_PASSWORD, JWT_SECRET, etc.

# Run database migrations (node-pg-migrate)
npm run migrate

# Seed database — creates admin + test user, imports Hagezi blocklist
npm run seed

# Start dev server (nodemon, auto-restarts on file changes)
npm run dev
# API available at http://localhost:3000
```

### 4. Admin Dashboard

```bash
cd dashboard

# Install dependencies
npm install

# Start Vite dev server
npm run dev
# Dashboard available at http://localhost:5173
```

---

## npm scripts — Backend

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API with nodemon (hot-reload) |
| `npm start` | Start API (production, no reload) |
| `npm run build` | Lint check (no compile step for plain Node) |
| `npm test` | Run Jest test suite |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:coverage` | Jest with Istanbul coverage report |
| `npm run migrate` | Apply pending node-pg-migrate migrations |
| `npm run migrate:down` | Rollback last migration |
| `npm run migrate:create` | Scaffold a new migration file |
| `npm run migrate:status` | List applied / pending migrations |
| `npm run seed` | Full seed: users + Hagezi blocklist |
| `npm run seed:hagezi` | Import / update Hagezi list only |
| `npm run dns` | Start DNS filtering server |
| `npm run dns:dev` | DNS server with nodemon |
| `npm run dns:migrate` | Create DNS tables |

## npm scripts — Dashboard

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Production bundle → `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Vitest test suite |

---

## Database migrations

PORNBLOCK uses **node-pg-migrate** to manage schema changes.

```bash
# Create a new migration
npm run migrate:create -- add-notification-settings

# Apply all pending migrations
npm run migrate

# Rollback one step
npm run migrate:down

# See current status
npm run migrate:status
```

Migration files live in `migrations/`. They run in timestamp order.

---

## Testing

### Backend (Jest + Supertest)

```bash
# Requires a running PostgreSQL instance
# Copy and configure the test env
cp .env.test.example .env.test
# Set DB_NAME=pornblock_test, DB_PASSWORD, JWT_SECRET

npm test
npm run test:coverage
```

The Jest global setup (`tests/setup/globalSetup.js`) runs the schema DDL against the test database before the suite starts and truncates all tables in teardown.

### DNS resolver (unit — no DB needed)

```bash
npm test tests/dns/resolver.test.js
```

---

## Seed details

`npm run seed` performs two operations:

1. **Users** — creates two test accounts (idempotent, skips existing):
   - `admin@pornblock.local` / value of `SEED_ADMIN_PASSWORD` — role: `admin`
   - `testuser@pornblock.local` / value of `SEED_TEST_PASSWORD` — role: `standard_user`

2. **Hagezi blocklist** — downloads [hagezi/dns-blocklists `porn.txt`](https://github.com/hagezi/dns-blocklists), parses ~200k domains, and batch-inserts them into `dns_blocklist`. Existing Hagezi entries are cleared first so re-running is safe.

Run individual steps:

```bash
node scripts/seed.js --users-only
node scripts/seed.js --hagezi-only
npm run seed:hagezi          # alias for hagezi-only
```

---

## Android development

1. **Open** `android/` in Android Studio (Ladybug or later)
2. **Create** `android/app/local.properties`:
   ```properties
   sdk.dir=C\:\\Users\\YourName\\AppData\\Local\\Android\\Sdk
   ```
3. **Replace** placeholder certificate pins in [android/app/src/main/kotlin/app/pornblock/network/ApiClient.kt](android/app/src/main/kotlin/app/pornblock/network/ApiClient.kt) with real SHA-256 pins for your API hostname
4. **Add** the TFLite model: drop `nsfw_model.tflite` into `android/app/src/main/assets/`
5. **Sync Gradle** → **Run** on a device/emulator running Android 8+ (API 26+)
6. **Scan** the QR code from the dashboard's *Enrol* page to bind the device

Minimum SDK: **API 26 (Android 8.0)**

---

## Environment variables reference

See [.env.example](.env.example) for the full, annotated list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | ✅ | PostgreSQL password |
| `JWT_SECRET` | ✅ | ≥ 64 random characters |
| `DATABASE_URL` | auto | Constructed from DB_* vars by node-pg-migrate |
| `REDIS_URL` | | Defaults to `redis://127.0.0.1:6379` |
| `SEED_ADMIN_PASSWORD` | seed only | Admin account password |
| `VITE_API_URL` | dashboard | Backend origin for Vite proxy |

---

## Project layout

```
pornblock/
├── android/                  Kotlin Android app
├── dashboard/                React 18 + Vite admin dashboard
│   ├── src/
│   │   ├── pages/            Route-level components
│   │   ├── components/       Shared UI (Layout, etc.)
│   │   ├── lib/api.js        Axios instance with JWT interceptor
│   │   └── store/authStore.js  Token storage
│   ├── tailwind.config.js
│   └── vite.config.js
├── migrations/               node-pg-migrate migration files
├── scripts/
│   ├── seed.js               User + Hagezi seed
│   └── import-hagezi.js      (used internally by seed)
├── src/
│   ├── app.js                Express entry point
│   ├── config/               pg Pool, ioredis client
│   ├── db/                   schema.sql, legacy migrate helpers
│   ├── dns/                  DNS filtering server (dns2)
│   ├── middleware/           auth, errorHandler
│   └── routes/               auth, devices, policy, heartbeat, violations, enrol
├── tests/
│   ├── setup/                Jest globalSetup / globalTeardown
│   ├── routes/               auth.test.js, heartbeat.test.js
│   └── dns/                  resolver.test.js
├── docker-compose.yml
├── Dockerfile                Backend Docker image (dev + prod targets)
├── migrate.config.js         node-pg-migrate runtime config
├── .env.example
└── .env.test.example
```

---

## Ports

| Service | Port |
|---------|------|
| Backend API | 3000 |
| Dashboard | 5173 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| DNS server | 5353 (UDP) |
| DNS HTTP control | 8053 |

> **Note on DNS port:** Linux requires root to bind port 53. The default `DNS_PORT` in `.env.example` is `5353`. To use port 53 in Docker, uncomment and adjust the port mapping in `docker-compose.yml`.

---

## Security notes

- Never commit `.env` — it is in `.gitignore`
- Rotate `JWT_SECRET` and restart the API if credentials are suspected compromised
- Replace certificate pins in `ApiClient.kt` before building a release APK
- The `audit_log` table has database-level triggers that prevent UPDATE/DELETE
- `bcrypt` rounds are set to 12 in production (`seed.js` uses 4 for speed in tests only)
