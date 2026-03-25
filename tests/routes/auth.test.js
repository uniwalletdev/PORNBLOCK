"use strict";

const request  = require("supertest");
const { Pool } = require("pg");
const bcrypt   = require("bcrypt");

// load app without starting the server
process.env.NODE_ENV = "test";
const app = require("../../src/app");

let pool;
let testUserId;

beforeAll(async () => {
  pool = new Pool(global.__DB_CONFIG__);
  const hash = await bcrypt.hash("TestPass123!", 4); // low rounds for speed
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'standard_user') RETURNING id",
    ["auth_test@pornblock.local", hash],
  );
  testUserId = rows[0].id;
});

afterAll(async () => {
  if (testUserId) await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

// ── POST /auth/register ────────────────────────────────────────────────────

describe("POST /auth/register", () => {
  let createdEmail;

  afterAll(async () => {
    if (createdEmail) await pool.query("DELETE FROM users WHERE email = $1", [createdEmail]);
  });

  it("registers a new user and returns a JWT", async () => {
    createdEmail = `reg_${Date.now()}@pornblock.local`;
    const res = await request(app)
      .post("/auth/register")
      .send({ email: createdEmail, password: "Str0ngPass!" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.email).toBe(createdEmail);
    expect(res.body.user.role).toBe("standard_user");
  });

  it("rejects duplicate email with 409", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "auth_test@pornblock.local", password: "Anything1!" });
    expect(res.status).toBe(409);
  });

  it("rejects weak / missing password with 400", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: `weak_${Date.now()}@x.com`, password: "123" });
    expect(res.status).toBe(400);
  });

  it("blocks registering with role=admin", async () => {
    const email = `admin_attempt_${Date.now()}@pornblock.local`;
    const res   = await request(app)
      .post("/auth/register")
      .send({ email, password: "Str0ngPass!", role: "admin" });

    // Should succeed BUT role must be forced to standard_user
    if (res.status === 201) {
      expect(res.body.user.role).toBe("standard_user");
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
    } else {
      expect([400, 403]).toContain(res.status);
    }
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────

describe("POST /auth/login", () => {
  it("returns a JWT for valid credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "auth_test@pornblock.local", password: "TestPass123!" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });

  it("returns 401 for wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "auth_test@pornblock.local", password: "WrongPassword!" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for non-existent user (no user enumeration)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@pornblock.local", password: "Irrelevant1!" });
    expect(res.status).toBe(401);
  });

  it("does not leak whether the user exists in the error message", async () => {
    const real   = await request(app).post("/auth/login").send({ email: "auth_test@pornblock.local",  password: "wrong" });
    const fake   = await request(app).post("/auth/login").send({ email: "nobody999@pornblock.local", password: "wrong" });
    // Both should return identical error bodies to prevent user enumeration
    expect(real.body.error).toBe(fake.body.error);
  });
});
