import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import {
  redact,
  hashPassword,
  verifyPassword,
} from "../packages/security/index.js";
test("password hashing and recursive secret redaction", () => {
  const h = hashPassword("test-password");
  assert(!h.includes("test-password"));
  assert(verifyPassword("test-password", h));
  assert(!verifyPassword("wrong", h));
  assert.equal(
    redact({ nested: { apiKey: "secret" } }).nested.apiKey,
    "[REDACTED]",
  );
});
test("API authentication, RBAC, tenant isolation, reset, audit and disabled account", async (t) => {
  const db = createDatabase(":memory:", "test-password-long");
  const server = createApp(db);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = "GET", body, cookie) =>
    fetch(base + "/api/v1/" + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await call("feedback")).status, 401);
  const login = await call("login", "POST", {
    email: "admin@tomvis.demo",
    password: "test-password-long",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const rows = (await (await call("feedback", "GET", null, cookie)).json())
    .data;
  assert.equal(rows.length, 6);
  const other = db
    .prepare("SELECT id FROM feedback WHERE tenant_id='other' LIMIT 1")
    .get().id;
  assert.equal(
    (await call("feedback/" + other, "PATCH", { status: "resolved" }, cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        "feedback",
        "POST",
        { subject: "Synthetic test", category: "Technical", priority: "high" },
        cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call("sandbox/reset", "POST", { confirm: "WRONG" }, cookie)).status,
    422,
  );
  assert.equal(
    (await call("sandbox/reset", "POST", { confirm: "RESET" }, cookie)).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM feedback WHERE tenant_id='other'").get()
      .n,
    6,
  );
  assert(
    db.prepare("SELECT id FROM audit_logs WHERE action='sandbox.reset'").get(),
  );
  const staff = await call("login", "POST", {
    email: "staff@tomvis.demo",
    password: "test-password-long",
  });
  const sc = staff.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("users", "GET", null, sc)).status, 403);
  assert.equal(
    (await call("sandbox/reset", "POST", { confirm: "RESET" }, sc)).status,
    403,
  );
  db.prepare("UPDATE users SET disabled=1 WHERE id='staff'").run();
  assert.equal((await call("feedback", "GET", null, sc)).status, 401);
  assert.equal(
    (
      await call("login", "POST", {
        email: "staff@tomvis.demo",
        password: "test-password-long",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/v1/feedback", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal((await call("logout", "POST", {}, cookie)).status, 200);
  assert.equal((await call("feedback", "GET", null, cookie)).status, 401);
});
test("production and staging startup fail closed", () => {
  const db = createDatabase(":memory:", "test-password-long");
  assert.throws(() => createApp(db, { mode: "production" }));
  assert.throws(() => createApp(db, { mode: "staging" }));
  db.close();
});
