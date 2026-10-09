import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import { bangkokDate, distanceMeters } from "../modules/hr/attendance.js";
const password = "test-password-long";
test("Bangkok timezone and geofence distance", () => {
  assert.deepEqual(bangkokDate(new Date("2026-10-08T17:01:00Z")), {
    day: "2026-10-09",
    time: "00:01",
  });
  assert.equal(distanceMeters(12, 101, 12, 101), 0);
  assert(distanceMeters(12, 101, 12.01, 101) > 1000);
});
test("mobile checkin validates GPS, employee binding and duplicate events; leave-aware absence and approval", async (t) => {
  const db = createDatabase(":memory:", password),
    server = createApp(db);
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
  const admin = await login("admin@tomvis.demo"),
    staff = await login("staff@tomvis.demo");
  assert.equal(
    (
      await call(
        "hr/checkin",
        "POST",
        { action: "in", latitude: 12, longitude: 101, accuracy: 10 },
        staff,
      )
    ).status,
    403,
  );
  db.prepare(
    "INSERT INTO employees(tenant_id,code,name,department,kind,salary,user_id) VALUES('demo','E001','Staff','HR','permanent',3000000,'staff')",
  ).run();
  assert.equal(
    (
      await call(
        "hr/checkin",
        "POST",
        { action: "in", latitude: 12, longitude: 101, accuracy: 10 },
        staff,
      )
    ).status,
    409,
  );
  const settings = {
    latitude: 12,
    longitude: 101,
    radius: 150,
    max_accuracy: 50,
    start_time: "08:30",
    grace_minutes: 5,
    workdays: [0, 1, 2, 3, 4, 5, 6],
    holidays: [],
  };
  assert.equal((await call("hr/office", "POST", settings, staff)).status, 403);
  assert.equal((await call("hr/office", "POST", settings, admin)).status, 200);
  for (const [body, status] of [
    [{ action: "out", latitude: 12, longitude: 101, accuracy: 10 }, 409],
    [{ action: "in", latitude: 13, longitude: 101, accuracy: 10 }, 403],
    [{ action: "in", latitude: 12, longitude: 101, accuracy: 80 }, 422],
    [{ action: "in", latitude: 12, longitude: 101, accuracy: 0 }, 422],
  ])
    assert.equal(
      (await call("hr/checkin", "POST", body, staff)).status,
      status,
    );
  const body = {
    action: "in",
    latitude: 12,
    longitude: 101,
    accuracy: 10,
    day: "2000-01-01",
    time: "00:00",
  };
  const first = await call("hr/checkin", "POST", body, staff);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).data.day, bangkokDate().day);
  assert.equal((await call("hr/checkin", "POST", body, staff)).status, 409);
  assert.equal(
    (await call("hr/checkin", "POST", { ...body, action: "out" }, staff))
      .status,
    200,
  );
  assert.equal(
    (await call("hr/checkin", "POST", { ...body, action: "out" }, staff))
      .status,
    409,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM checkin_events").get().n, 2);
  const yesterday = new Date(Date.now() - 86400000),
    day = bangkokDate(yesterday).day;
  assert.equal(
    (
      await call(
        "hr/leaves",
        "POST",
        { kind: "sick", start_day: day, end_day: day, reason: "ทดสอบ" },
        staff,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await call(
        "hr/leaves",
        "POST",
        { kind: "sick", start_day: day, end_day: day, reason: "ซ้อน" },
        staff,
      )
    ).status,
    409,
  );
  const leave = db.prepare("SELECT id FROM leave_requests").get();
  assert.equal(
    (
      await call(
        `hr/leaves/${leave.id}/decision`,
        "POST",
        { status: "approved", note: "อนุมัติ" },
        admin,
      )
    ).status,
    200,
  );
  const result = (
    await (await call("hr/absence/process", "POST", { day }, admin)).json()
  ).data;
  assert.deepEqual(result, { absent: 0, onLeave: 1 });
  assert.equal(
    db.prepare("SELECT status FROM attendance WHERE day=?").get(day).status,
    "leave",
  );
  assert.equal(
    (
      await call(
        "hr/absence/process",
        "POST",
        { day: bangkokDate().day },
        admin,
      )
    ).status,
    422,
  );
  const otherCookie = await login("viewer@tomvis.demo");
  assert.equal(
    (await call("hr/my-attendance", "GET", null, otherCookie)).status,
    403,
  );
});
