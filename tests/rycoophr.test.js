import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import {
  totp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
} from "../packages/security/totp.js";
const password = "test-password-long";
async function fixture(t, options = {}) {
  const db = createDatabase(":memory:", password, options);
  const key = randomBytes(32),
    server = createApp(db, { totpKey: key });
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
  const login = async (email) => {
    const r = await call("login", "POST", { email, password });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie").split(";")[0];
  };
  return { db, key, call, login };
}
test("RFC 6238 six-digit vectors, invalid OTP, replay, authenticated encryption", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [time, expected] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])
    assert.equal(totp(secret, Math.floor(time / 30)), expected);
  assert.equal(verifyTotp(secret, "287082", -1, 59000), 1);
  assert.equal(verifyTotp(secret, "287082", 1, 59000), null);
  assert.equal(verifyTotp(secret, "000000", -1, 59000), null);
  assert.equal(verifyTotp(secret, 123456), null);
  const key = randomBytes(32),
    encrypted = encryptSecret(secret, key);
  assert(!encrypted.includes(secret));
  assert.equal(decryptSecret(encrypted, key), secret);
  assert.throws(() => decryptSecret(encrypted, randomBytes(32)));
});
test("admin enrollment is mandatory; OTP and recovery codes cannot be reused", async (t) => {
  const { db, call, login } = await fixture(t);
  const cookie = await login("pharmacisttom@gmail.com");
  assert.equal((await call("hr/employees", "GET", null, cookie)).status, 403);
  assert.equal(
    (await call("2fa/setup", "POST", { password: "wrong" }, cookie)).status,
    401,
  );
  const setup = await (
    await call("2fa/setup", "POST", { password }, cookie)
  ).json();
  assert(setup.data.qr_svg.includes("<svg"));
  assert(
    !db
      .prepare("SELECT secret FROM user_totp WHERE user_id='ryadmin'")
      .get()
      .secret.includes(setup.data.secret),
  );
  assert.equal(
    (await call("2fa/confirm", "POST", { code: "invalid" }, cookie)).status,
    422,
  );
  const counter = Math.floor(Date.now() / 30000),
    code = totp(setup.data.secret, counter);
  const confirm = await call("2fa/confirm", "POST", { code }, cookie);
  assert.equal(confirm.status, 200);
  const recovery = (await confirm.json()).data.recovery_codes;
  assert.equal(recovery.length, 10);
  assert.equal((await call("hr/employees", "GET", null, cookie)).status, 200);
  assert.equal(
    (await call("2fa/setup", "POST", { password }, cookie)).status,
    409,
  );
  assert.equal(
    (
      await call("login", "POST", {
        email: "pharmacisttom@gmail.com",
        password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("login", "POST", {
        email: "pharmacisttom@gmail.com",
        password,
        code,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("login", "POST", {
        email: "pharmacisttom@gmail.com",
        password,
        recovery_code: recovery[0],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("login", "POST", {
        email: "pharmacisttom@gmail.com",
        password,
        recovery_code: recovery[0],
      })
    ).status,
    401,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM recovery_codes WHERE user_id='ryadmin'")
      .get().n,
    9,
  );
  assert(
    !JSON.stringify(db.prepare("SELECT * FROM audit_logs").all()).includes(
      setup.data.secret,
    ),
  );
});
test("employee money, welfare, payroll maker/checker, attendance and cross-tenant checks", async (t) => {
  const { db, call, login } = await fixture(t);
  const cookie = await login("admin@tomvis.demo");
  const employee = await call(
    "hr/employees",
    "POST",
    {
      code: "E001",
      name: "ทดสอบ",
      department: "นักคอมพิวเตอร์",
      kind: "permanent",
      salary: "30000.50",
    },
    cookie,
  );
  assert.equal(employee.status, 201);
  const id = (await employee.json()).data.id;
  assert.equal(
    db.prepare("SELECT salary FROM employees WHERE id=?").get(id).salary,
    3000050,
  );
  assert.equal(
    (
      await call(
        "hr/accounts",
        "POST",
        {
          name: "ผู้อนุมัติ",
          email: "manager@test.invalid",
          password,
          role: "manager",
        },
        cookie,
      )
    ).status,
    201,
  );
  const manager = await login("manager@test.invalid");
  assert.equal(
    (
      await call(
        "hr/payroll",
        "POST",
        {
          employee_id: id,
          period: "2026-10",
          kind: "bonus",
          multiplier: 2,
          deductions: 500,
        },
        cookie,
      )
    ).status,
    201,
  );
  const pay = db.prepare("SELECT * FROM payroll").get();
  assert.equal(pay.net, 5950100);
  assert.equal(
    (
      await call(
        `hr/payroll/${pay.id}/decision`,
        "POST",
        { status: "approved" },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `hr/payroll/${pay.id}/decision`,
        "POST",
        { status: "approved" },
        manager,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `hr/payroll/${pay.id}/decision`,
        "POST",
        { status: "rejected" },
        manager,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "hr/employees",
        "POST",
        { code: "x", name: "x", department: "x", kind: "permanent", salary: 5 },
        manager,
      )
    ).status,
    403,
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");
  sheet.addRow(["code", "name", "day", "check_in", "check_out"]);
  sheet.addRow(["E001", "ทดสอบ", "2026-10-09", "08:31", "17:00"]);
  sheet.addRow(["E001", "ชื่อไม่ตรง", "2026-10-09", "08:00", "17:00"]);
  const result = await call(
    "hr/attendance/xlsx",
    "POST",
    {
      base64: Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64"),
    },
    cookie,
  );
  assert.equal(result.status, 200);
  const imported = (await result.json()).data;
  assert.equal(imported.accepted, 1);
  assert.equal(imported.errors.length, 1);
  assert.equal(
    db.prepare("SELECT status FROM attendance").get().status,
    "late",
  );
  assert.equal(
    (
      await call(
        "hr/attendance/import",
        "POST",
        {
          rows: [
            {
              code: "E001",
              name: "ทดสอบ",
              day: "2026-02-30",
              check_in: "25:00",
            },
          ],
        },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM attendance").get().n, 1);
  db.prepare(
    "INSERT INTO employees(tenant_id,code,name,department,kind,salary) VALUES('other','OTHER','Other','Other','permanent',100)",
  ).run();
  const other = db
    .prepare("SELECT id FROM employees WHERE tenant_id='other'")
    .get().id;
  assert.equal(
    (
      await call(
        "hr/welfare",
        "POST",
        { employee_id: other, kind: "medical", amount: 100, detail: "test" },
        cookie,
      )
    ).status,
    422,
  );
  const staff = await login("staff@tomvis.demo");
  assert.equal((await call("hr/employees", "GET", null, staff)).status, 403);
});
test("board individual pages, owner-only outcome, independent review, IT isolation and source roster", async (t) => {
  const { db, call, login } = await fixture(t);
  const admin = await login("admin@tomvis.demo");
  const profiles = (
    await (await call("hr/directors", "GET", null, admin)).json()
  ).data;
  assert.equal(profiles.length, 15);
  const p = profiles[0],
    q = profiles[1];
  for (const [profile, email, role] of [
    [p, "chair@test.invalid", "chair"],
    [q, "director@test.invalid", "director"],
  ])
    assert.equal(
      (
        await call(
          "hr/directors",
          "POST",
          {
            profile_id: profile.id,
            name: profile.name,
            position: profile.position,
            email,
            password,
            role,
            term_start: "2026-01-01",
            term_end: "2026-12-31",
            duties: "หน้าที่ที่รับรอง",
          },
          admin,
        )
      ).status,
      201,
    );
  const chair = await login("chair@test.invalid"),
    director = await login("director@test.invalid");
  assert.equal((await call("hr/employees", "GET", null, chair)).status, 403);
  assert.equal((await call("hr/payroll", "GET", null, director)).status, 403);
  const mine = (
    await (await call("hr/directors", "GET", null, director)).json()
  ).data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, q.id);
  assert.equal(
    (
      await call(
        "hr/tasks",
        "POST",
        {
          director_id: q.id,
          title: "ติดตามมติ",
          indicator: "ครบ 3 รายการ",
          due_date: "2026-12-01",
        },
        chair,
      )
    ).status,
    201,
  );
  const task = db.prepare("SELECT * FROM board_tasks").get();
  assert.equal(
    (
      await call(
        "hr/tasks/" + task.id,
        "PATCH",
        { outcome: "test", status: "submitted" },
        chair,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "hr/tasks/" + task.id,
        "PATCH",
        { outcome: "ครบ 3 รายการ หลักฐานมติ 12", status: "submitted" },
        director,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `hr/tasks/${task.id}/review`,
        "POST",
        { score: 90, review: "บรรลุเป้าหมาย" },
        chair,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "hr/tasks/" + task.id,
        "PATCH",
        { outcome: "แก้", status: "submitted" },
        director,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "hr/accounts",
        "POST",
        { name: "IT", email: "it@test.invalid", password, role: "it_admin" },
        admin,
      )
    ).status,
    201,
  );
  const it = await login("it@test.invalid");
  assert.equal((await call("hr/payroll", "GET", null, it)).status, 403);
  assert.equal(
    (
      await call(
        "hr/accounts",
        "POST",
        { name: "x", email: "x@test.invalid", password, role: "admin" },
        it,
      )
    ).status,
    422,
  );
  const directory = (await (await call("hr/directory", "GET", null, it)).json())
    .data;
  assert(directory.staff.some((s) => s.position === "นักคอมพิวเตอร์"));
  assert.equal(
    db.prepare("SELECT count(*) n FROM directors WHERE tenant_id=?").get("demo")
      .n,
    15,
  );
});
test("production database has one intended admin, no demo accounts or invented payroll", () => {
  const db = createDatabase(":memory:", password, { production: true });
  assert.deepEqual(
    db
      .prepare("SELECT email FROM users")
      .all()
      .map((x) => x.email),
    ["pharmacisttom@gmail.com"],
  );
  assert.equal(db.prepare("SELECT count(*) n FROM employees").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM payroll").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM feedback").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM directors").get().n, 15);
  db.close();
});
