import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import { hashPassword, verifyPassword } from "../packages/security/index.js";
const password = "extended-fixture-password";
async function fixture(t) {
  const db = createDatabase(":memory:", password),
    server = createApp(db);
  for (const [id, role] of [
    ["manager", "manager"],
    ["hr", "hr_officer"],
    ["it", "it_admin"],
    ["director", "director"],
    ["chair", "chair"],
  ]) {
    db.prepare("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)").run(
      id,
      id,
      id + "@test.invalid",
      hashPassword(password),
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(id, "demo", role);
  }
  const director = db
    .prepare(
      "SELECT id FROM directors WHERE tenant_id='demo' ORDER BY id LIMIT 1",
    )
    .get().id;
  db.prepare("UPDATE directors SET user_id=? WHERE id=?").run(
    "director",
    director,
  );
  const e = db
    .prepare(
      "INSERT INTO employees(tenant_id,code,name,department,kind,salary,user_id) VALUES('demo','E001','ทดสอบเอกสาร','HR','permanent',3000000,'staff')",
    )
    .run();
  const other = db
    .prepare(
      "INSERT INTO employees(tenant_id,code,name,department,kind,salary) VALUES('other','X001','Other','Other','permanent',100)",
    )
    .run();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    call = (path, method = "GET", body, cookie) =>
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
  return {
    db,
    call,
    login,
    id: Number(e.lastInsertRowid),
    other: Number(other.lastInsertRowid),
    director,
  };
}
test("profile CRUD, typed records, migration compatibility, and cross-tenant isolation", async (t) => {
  const { db, call, login, id, other } = await fixture(t);
  const admin = await login("admin@tomvis.demo"),
    staff = await login("staff@tomvis.demo");
  assert.equal(
    (await call("hr/employees/" + other, "GET", null, admin)).status,
    404,
  );
  assert.equal(
    (await call("hr/employees/" + id, "GET", null, staff)).status,
    403,
  );
  const body = {
    code: "E001",
    name: "ทดสอบเอกสาร",
    department: "นักคอมพิวเตอร์",
    kind: "permanent",
    active: 1,
    start_date: "2025-01-01",
    end_date: "",
    profile: {
      phone: "0800000000",
      address: "ทดสอบ",
      bank_name: "Bank",
      bank_account: "12345",
    },
  };
  assert.equal(
    (await call("hr/employees/" + id, "PATCH", body, admin)).status,
    200,
  );
  assert.equal(
    (await call("hr/employees/" + id, "PATCH", { ...body, salary: 1 }, admin))
      .status,
    422,
  );
  assert.equal(
    (
      await call(
        `hr/employees/${id}/records`,
        "POST",
        { kind: "child", data: { name: "บุตรทดสอบ", birth_day: "2026-02-30" } },
        admin,
      )
    ).status,
    422,
  );
  const r = await call(
    `hr/employees/${id}/records`,
    "POST",
    {
      kind: "child",
      data: {
        name: "บุตรทดสอบ",
        birth_day: "2020-01-01",
        school: "โรงเรียน",
        level: "ประถม",
      },
    },
    admin,
  );
  assert.equal(r.status, 201);
  const record = (await r.json()).data.id;
  assert.equal(
    (
      await call(
        "hr/records/" + record,
        "PATCH",
        { data: { name: "แก้ไขบุตร" } },
        admin,
      )
    ).status,
    200,
  );
  const detail = (
    await (await call("hr/employees/" + id, "GET", null, admin)).json()
  ).data;
  assert.equal(detail.records.length, 1);
  assert.equal(detail.profile.bank_account, "12345");
  assert.equal(
    (await call("hr/records/" + record, "DELETE", null, admin)).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM employee_records").get().n,
    0,
  );
  assert.equal((await call("hr/my-profile", "GET", null, staff)).status, 200);
});
test("salary adjustment independent approval, draft bulk payroll, personal slips and monthly reports", async (t) => {
  const { db, call, login, id } = await fixture(t);
  const hr = await login("hr@test.invalid"),
    manager = await login("manager@test.invalid"),
    staff = await login("staff@tomvis.demo");
  const created = await call(
    "hr/salary-adjustments",
    "POST",
    {
      employee_id: id,
      percent: 5,
      effective_day: "2026-01-01",
      reason: "มติทดสอบ",
    },
    hr,
  );
  assert.equal(created.status, 201);
  const adjustment = (await created.json()).data.id;
  assert.equal(
    (
      await call(
        `hr/salary-adjustments/${adjustment}/decision`,
        "POST",
        { status: "approved" },
        hr,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `hr/salary-adjustments/${adjustment}/decision`,
        "POST",
        { status: "approved" },
        manager,
      )
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT salary FROM employees WHERE id=?").get(id).salary,
    3150000,
  );
  assert.equal(
    (await call("hr/payroll/bulk", "POST", { period: "2026-10" }, hr)).status,
    201,
  );
  assert.equal(
    (await call("hr/payroll/bulk", "POST", { period: "2026-10" }, hr)).status,
    409,
  );
  const pay = db.prepare("SELECT * FROM payroll WHERE tenant_id='demo'").get();
  assert.equal(
    (await call("hr/payroll/" + pay.id, "GET", null, staff)).status,
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
  const slips = (await (await call("hr/my-payroll", "GET", null, staff)).json())
    .data;
  assert.equal(slips.length, 1);
  assert.equal(slips[0].net, 3150000);
  assert.equal((await call("hr/reports", "GET", null, staff)).status, 403);
  const report = (
    await (await call("hr/reports?period=2026-10", "GET", null, manager)).json()
  ).data;
  assert.equal(report.payments.length, 1);
  assert.equal(report.payments[0].net, 3150000);
});
test("attachment signature, scope, parent authorization, freeze after approval and safe download", async (t) => {
  const { db, call, login, id, other } = await fixture(t);
  const admin = await login("admin@tomvis.demo"),
    staff = await login("staff@tomvis.demo"),
    director = await login("director@test.invalid");
  const file = {
    resource: "employee",
    resource_id: id,
    name: "ใบรับรอง.pdf",
    base64: Buffer.from("%PDF-1.4\nfixture").toString("base64"),
  };
  assert.equal(
    (
      await call(
        "hr/attachments",
        "POST",
        { ...file, resource_id: other },
        admin,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "hr/attachments",
        "POST",
        {
          ...file,
          base64: Buffer.from("<script>bad</script>").toString("base64"),
        },
        admin,
      )
    ).status,
    422,
  );
  assert.equal((await call("hr/attachments", "POST", file, staff)).status, 403);
  const r = await call("hr/attachments", "POST", file, admin);
  assert.equal(r.status, 201);
  const fid = (await r.json()).data.id;
  assert.equal(
    (await call("hr/attachments/" + fid, "GET", null, director)).status,
    403,
  );
  assert.equal(
    (await call("hr/attachments/" + fid, "GET", null, staff)).status,
    200,
  );
  const downloaded = (
    await (await call("hr/attachments/" + fid, "GET", null, admin)).json()
  ).data;
  assert.equal(downloaded.base64, file.base64);
  assert.equal(
    (await call("hr/attachments/" + fid, "DELETE", null, admin)).status,
    200,
  );
  const welfare = db
    .prepare(
      "INSERT INTO welfare(tenant_id,employee_id,kind,amount,detail,status,created_by) VALUES('demo',?,'medical',100,'fixture','approved','admin')",
    )
    .run(id);
  assert.equal(
    (
      await call(
        "hr/attachments",
        "POST",
        {
          ...file,
          resource: "welfare",
          resource_id: Number(welfare.lastInsertRowid),
        },
        admin,
      )
    ).status,
    409,
  );
});
test("meetings scoped to invited directors, attendance/minutes, IT restrictions and account revocation", async (t) => {
  const { db, call, login, director } = await fixture(t);
  const admin = await login("admin@tomvis.demo"),
    chair = await login("chair@test.invalid"),
    dir = await login("director@test.invalid"),
    it = await login("it@test.invalid");
  const r = await call(
    "hr/meetings",
    "POST",
    {
      committee: "อำนวยการ",
      title: "ประชุมทดสอบ",
      day: "2026-10-09",
      agenda: "วาระทดสอบ",
      director_ids: [director],
    },
    chair,
  );
  assert.equal(r.status, 201);
  const id = (await r.json()).data.id;
  assert.equal(
    (
      await call(
        "hr/meetings/" + id,
        "PATCH",
        {
          status: "completed",
          minutes: "มติทดสอบ",
          participants: [{ director_id: director, status: "present" }],
        },
        dir,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "hr/meetings/" + id,
        "PATCH",
        {
          status: "completed",
          minutes: "มติทดสอบ",
          participants: [{ director_id: director, status: "present" }],
        },
        chair,
      )
    ).status,
    200,
  );
  const mine = (await (await call("hr/meetings", "GET", null, dir)).json())
    .data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].participants[0].status, "present");
  assert.equal(
    (
      await call(
        "hr/accounts/manager",
        "PATCH",
        { role: "staff", disabled: 1 },
        it,
      )
    ).status,
    403,
  );
  const staff = await login("staff@tomvis.demo");
  assert.equal(
    (
      await call(
        "hr/accounts/staff",
        "PATCH",
        { role: "staff", disabled: 1 },
        admin,
      )
    ).status,
    200,
  );
  assert.equal((await call("hr/my-profile", "GET", null, staff)).status, 401);
});
test("own password change checks current password and revokes all sessions", async (t) => {
  const { db, call, login } = await fixture(t);
  const cookie = await login("staff@tomvis.demo"),
    newPassword = "changed-fixture-password";
  assert.equal(
    (
      await call(
        "hr/account-password",
        "POST",
        {
          current_password: "wrong",
          new_password: newPassword,
          confirm_password: newPassword,
        },
        cookie,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "hr/account-password",
        "POST",
        {
          current_password: password,
          new_password: newPassword,
          confirm_password: newPassword,
        },
        cookie,
      )
    ).status,
    200,
  );
  assert(
    verifyPassword(
      newPassword,
      db.prepare("SELECT password FROM users WHERE id='staff'").get().password,
    ),
  );
  assert.equal((await call("hr/my-profile", "GET", null, cookie)).status, 401);
  assert(
    !JSON.stringify(db.prepare("SELECT * FROM audit_logs").all()).includes(
      newPassword,
    ),
  );
});

test("leave quotas use working days, exclude holidays and enforce remaining balance", async (t) => {
  const { db, call, login, id } = await fixture(t);
  const { leaveDays, leaveBalance } =
    await import("../modules/hr/leave-balance.js");
  assert.equal(leaveDays(db, "demo", "2026-10-05", "2026-10-11", 2026), null);
  db.prepare("INSERT INTO office_settings VALUES(?,?,?,?,?,?,?,?,?)").run(
    "demo",
    12,
    101,
    150,
    50,
    "08:30",
    5,
    "[1,2,3,4,5]",
    '["2026-10-06"]',
  );
  assert.equal(leaveDays(db, "demo", "2026-10-05", "2026-10-11", 2026), 4);
  assert.equal(leaveDays(db, "demo", "2026-12-31", "2027-01-01", 2026), 1);
  assert.equal(leaveDays(db, "demo", "2026-12-31", "2027-01-01", 2027), 1);
  db.prepare(
    "INSERT INTO leave_entitlements VALUES('demo',?,2026,'annual',3)",
  ).run(id);
  const row = db
    .prepare(
      "INSERT INTO leave_requests(tenant_id,employee_id,kind,start_day,end_day,reason,created_by) VALUES('demo',?,'annual','2026-10-05','2026-10-11','test','staff')",
    )
    .run(id);
  const manager = await login("manager@test.invalid");
  let r = await call(
    `hr/leaves/${row.lastInsertRowid}/decision`,
    "POST",
    { status: "approved", note: "test" },
    manager,
  );
  assert.equal(r.status, 409);
  assert.equal(leaveBalance(db, "demo", id, 2026, "annual").pending, 4);
  const hr = await login("hr@test.invalid");
  r = await call(
    "hr/leave-balances",
    "POST",
    { employee_id: id, year: 2026, kind: "annual", days: 5 },
    hr,
  );
  assert.equal(r.status, 200);
  r = await call(
    `hr/leaves/${row.lastInsertRowid}/decision`,
    "POST",
    { status: "approved", note: "test" },
    manager,
  );
  assert.equal(r.status, 200);
  const b = leaveBalance(db, "demo", id, 2026, "annual");
  assert.equal(b.used, 4);
  assert.equal(b.remaining, 1);
  assert.equal(b.pending, 0);
  const staff = await login("staff@tomvis.demo");
  r = await call(
    "hr/leave-balances",
    "POST",
    { employee_id: id, year: 2026, kind: "annual", days: 50 },
    staff,
  );
  assert.equal(r.status, 403);
});
