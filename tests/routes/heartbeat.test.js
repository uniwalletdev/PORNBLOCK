"use strict";

const request  = require("supertest");
const { Pool } = require("pg");
const bcrypt   = require("bcrypt");
const jwt      = require("jsonwebtoken");

process.env.NODE_ENV = "test";
const app = require("../../src/app");

let pool;
let userId, deviceId, token;

beforeAll(async () => {
  pool = new Pool(global.__DB_CONFIG__);

  // Create a user
  const hash = await bcrypt.hash("Pass123!", 4);
  const { rows: [user] } = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id",
    [`hb_test_${Date.now()}@pornblock.local`, hash],
  );
  userId = user.id;

  // Create a device
  const { rows: [device] } = await pool.query(
    `INSERT INTO devices (user_id, device_name, platform, device_token)
     VALUES ($1,'Test Phone','android', $2) RETURNING id`,
    [userId, `tok_${Date.now()}`],
  );
  deviceId = device.id;

  // Mint a JWT (id field must match what auth.js issues and heartbeat.js expects)
  token = jwt.sign({ id: userId, role: "standard_user" }, process.env.JWT_SECRET, { expiresIn: "1h" });
});

afterAll(async () => {
  if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

// ── POST /heartbeat ────────────────────────────────────────────────────────

describe("POST /heartbeat", () => {
  it("accepts a valid heartbeat and updates last_heartbeat", async () => {
    const res = await request(app)
      .post("/heartbeat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        device_id:         deviceId,
        protection_status: "active",
        battery_level:     82,
        app_version:       "1.0.0",
        vpn_active:        true,
        screen_monitor:    true,
      });

    expect(res.status).toBe(200);
    expect(res.body.device.protection_status).toBe("active");

    const { rows: [d] } = await pool.query("SELECT last_heartbeat FROM devices WHERE id = $1", [deviceId]);
    expect(d.last_heartbeat).not.toBeNull();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post("/heartbeat").send({ device_id: deviceId });
    expect(res.status).toBe(401);
  });

  it("rejects heartbeat for a device not belonging to the user", async () => {
    // Create a different user + device
    const hash = await bcrypt.hash("Pw!", 4);
    const { rows: [u2] } = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id",
      [`other_${Date.now()}@pornblock.local`, hash],
    );
    const { rows: [d2] } = await pool.query(
      `INSERT INTO devices (user_id, device_name, platform, device_token)
       VALUES ($1, 'Other', 'android', $2) RETURNING id`,
      [u2.id, `tok_other_${Date.now()}`],
    );

    const res = await request(app)
      .post("/heartbeat")
      .set("Authorization", `Bearer ${token}`)
      .send({ device_id: d2.id, protection_status: "active" });

    expect([403, 404]).toContain(res.status);

    await pool.query("DELETE FROM users WHERE id = $1", [u2.id]);
  });
});
