export function bangkokDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = (v) => (v * Math.PI) / 180,
    dlat = rad(lat2 - lat1),
    dlon = rad(lon2 - lon1);
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const dateValid = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(new Date(v + "T00:00:00Z").getTime()) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
export async function attendanceRoutes(c) {
  const {
    url,
    req,
    body: b,
    user: u,
    db,
    reply,
    fail,
    requirePermission: permit,
    atomic,
    audit,
  } = c;
  const path = url.pathname.slice("/api/v1/hr/".length),
    post = req.method === "POST",
    get = req.method === "GET";
  if (
    ![
      "office",
      "checkin",
      "my-attendance",
      "leaves",
      "absence/process",
    ].includes(path) &&
    !/^leaves\/\d+\/decision$/.test(path)
  )
    return false;
  const own = () => {
    const e = db
      .prepare(
        "SELECT * FROM employees WHERE tenant_id=? AND user_id=? AND active=1",
      )
      .get(u.tenant_id, u.id);
    if (!e) fail(403, "บัญชียังไม่ผูกกับทะเบียนเจ้าหน้าที่ กรุณาติดต่อ HR");
    return e;
  };
  const office = () =>
    db
      .prepare("SELECT * FROM office_settings WHERE tenant_id=?")
      .get(u.tenant_id);
  if (path === "office" && get) {
    permit("attendance.self");
    reply(200, office() || { configured: false });
    return true;
  }
  if (path === "office" && post) {
    permit("attendance.configure");
    const n = (x) => typeof x === "number" && Number.isFinite(x);
    if (
      !n(b.latitude) ||
      !n(b.longitude) ||
      Math.abs(b.latitude) > 90 ||
      Math.abs(b.longitude) > 180 ||
      !n(b.radius) ||
      b.radius < 20 ||
      b.radius > 2000 ||
      !n(b.max_accuracy) ||
      b.max_accuracy < 5 ||
      b.max_accuracy > b.radius ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time) ||
      !Number.isInteger(b.grace_minutes) ||
      b.grace_minutes < 0 ||
      b.grace_minutes > 60 ||
      !Array.isArray(b.workdays) ||
      !b.workdays.length ||
      b.workdays.some((v) => !Number.isInteger(v) || v < 0 || v > 6) ||
      !Array.isArray(b.holidays) ||
      b.holidays.some((v) => !dateValid(v))
    )
      fail(422, "การตั้งค่าพิกัด รัศมี เวลา หรือวันทำงานไม่ถูกต้อง");
    atomic(() => {
      db.prepare(
        "INSERT INTO office_settings VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,radius=excluded.radius,max_accuracy=excluded.max_accuracy,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,workdays=excluded.workdays,holidays=excluded.holidays",
      ).run(
        u.tenant_id,
        b.latitude,
        b.longitude,
        b.radius,
        b.max_accuracy,
        b.start_time,
        b.grace_minutes,
        JSON.stringify(b.workdays),
        JSON.stringify(b.holidays),
      );
      audit("attendance.office_configured", "office", u.tenant_id, null, {
        radius: b.radius,
        start_time: b.start_time,
        grace_minutes: b.grace_minutes,
      });
    });
    reply(200, {});
    return true;
  }
  if (path === "my-attendance" && get) {
    permit("attendance.self");
    const e = own();
    reply(
      200,
      db
        .prepare(
          "SELECT day,check_in,check_out,status FROM attendance WHERE tenant_id=? AND employee_id=? ORDER BY day DESC LIMIT 100",
        )
        .all(u.tenant_id, e.id),
    );
    return true;
  }
  if (path === "checkin" && post) {
    permit("attendance.self");
    const e = own(),
      s = office();
    if (!s) fail(409, "แอดมินยังไม่ตั้งค่าพิกัดสำนักงาน");
    if (
      !["in", "out"].includes(b.action) ||
      typeof b.latitude !== "number" ||
      typeof b.longitude !== "number" ||
      typeof b.accuracy !== "number" ||
      ![b.latitude, b.longitude, b.accuracy].every(Number.isFinite) ||
      Math.abs(b.latitude) > 90 ||
      Math.abs(b.longitude) > 180 ||
      b.accuracy <= 0 ||
      b.accuracy > s.max_accuracy
    )
      fail(
        422,
        "พิกัดไม่ถูกต้องหรือ GPS คลาดเคลื่อนมากเกินไป กรุณาลองบริเวณโล่ง",
      );
    const distance = distanceMeters(
      s.latitude,
      s.longitude,
      b.latitude,
      b.longitude,
    );
    if (distance > s.radius) fail(403, "อยู่นอกรัศมีสำนักงาน");
    const { day, time } = bangkokDate();
    const row = db
      .prepare(
        "SELECT * FROM attendance WHERE tenant_id=? AND employee_id=? AND day=?",
      )
      .get(u.tenant_id, e.id, day);
    if (b.action === "in" && row?.check_in) fail(409, "เช็กอินวันนี้แล้ว");
    if (b.action === "out" && (!row?.check_in || row?.check_out))
      fail(409, "ต้องเช็กอินก่อน หรือเช็กเอาต์แล้ว");
    const minutes = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    const status =
      minutes(time) > minutes(s.start_time) + s.grace_minutes
        ? "late"
        : "present";
    atomic(() => {
      if (b.action === "in")
        db.prepare(
          "INSERT INTO attendance(tenant_id,employee_id,day,check_in,status) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,employee_id,day) DO UPDATE SET check_in=excluded.check_in,status=excluded.status",
        ).run(u.tenant_id, e.id, day, time, status);
      else
        db.prepare(
          "UPDATE attendance SET check_out=? WHERE tenant_id=? AND employee_id=? AND day=?",
        ).run(time, u.tenant_id, e.id, day);
      db.prepare(
        "INSERT INTO checkin_events(tenant_id,employee_id,action,latitude,longitude,accuracy,distance,server_time) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        u.tenant_id,
        e.id,
        b.action,
        b.latitude,
        b.longitude,
        b.accuracy,
        Math.round(distance),
        new Date().toISOString(),
      );
      audit("attendance.mobile_" + b.action, "attendance", e.id, null, {
        day,
        time,
        distance: Math.round(distance),
        accuracy: b.accuracy,
      });
    });
    reply(200, {
      day,
      time,
      status: b.action === "in" ? status : row.status,
      distance: Math.round(distance),
    });
    return true;
  }
  if (path === "leaves" && get) {
    permit("attendance.self");
    const all =
      u.role === "admin" ||
      u.role === "super_admin" ||
      u.role === "hr_officer" ||
      u.role === "manager";
    const args = all ? [u.tenant_id] : [u.tenant_id, own().id];
    reply(
      200,
      db
        .prepare(
          `SELECT l.*,e.name,e.code FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.tenant_id=? ${all ? "" : "AND l.employee_id=?"} ORDER BY l.id DESC LIMIT 500`,
        )
        .all(...args),
    );
    return true;
  }
  if (path === "leaves" && post) {
    permit("attendance.self");
    const e = own();
    if (
      !["annual", "sick", "personal", "unpaid"].includes(b.kind) ||
      !dateValid(b.start_day) ||
      !dateValid(b.end_day) ||
      b.end_day < b.start_day ||
      (new Date(b.end_day) - new Date(b.start_day)) / 86400000 > 366 ||
      typeof b.reason !== "string" ||
      !b.reason.trim() ||
      b.reason.length > 2000
    )
      fail(422, "ประเภท วันลา หรือเหตุผลไม่ถูกต้อง");
    if (
      db
        .prepare(
          "SELECT id FROM leave_requests WHERE tenant_id=? AND employee_id=? AND status IN ('pending','approved') AND start_day<=? AND end_day>=?",
        )
        .get(u.tenant_id, e.id, b.end_day, b.start_day)
    )
      fail(409, "มีใบลาซ้อนช่วงวันที่แล้ว");
    const r = atomic(() => {
      const row = db
        .prepare(
          "INSERT INTO leave_requests(tenant_id,employee_id,kind,start_day,end_day,reason,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          e.id,
          b.kind,
          b.start_day,
          b.end_day,
          b.reason.trim(),
          u.id,
        );
      audit("leave.requested", "leave_requests", row.lastInsertRowid, null, {
        kind: b.kind,
        start_day: b.start_day,
        end_day: b.end_day,
      });
      return row;
    });
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  const decision = path.match(/^leaves\/(\d+)\/decision$/);
  if (decision && post) {
    permit("hr.approve");
    const row = db
      .prepare("SELECT * FROM leave_requests WHERE id=? AND tenant_id=?")
      .get(decision[1], u.tenant_id);
    if (!row) fail(404, "ไม่พบใบลา");
    if (row.created_by === u.id) fail(403, "อนุมัติใบลาของตนเองไม่ได้");
    if (row.status !== "pending") fail(409, "พิจารณาใบลาแล้ว");
    if (
      !["approved", "rejected"].includes(b.status) ||
      typeof b.note !== "string" ||
      b.note.length > 1000
    )
      fail(422, "ผลพิจารณาไม่ถูกต้อง");
    atomic(() => {
      db.prepare(
        "UPDATE leave_requests SET status=?,approved_by=?,note=? WHERE id=?",
      ).run(b.status, u.id, b.note, row.id);
      if (b.status === "approved")
        db.prepare(
          "UPDATE attendance SET status='leave' WHERE tenant_id=? AND employee_id=? AND day BETWEEN ? AND ? AND check_in IS NULL",
        ).run(u.tenant_id, row.employee_id, row.start_day, row.end_day);
      audit("leave." + b.status, "leave_requests", row.id, null, {
        status: b.status,
      });
    });
    reply(200, {});
    return true;
  }
  if (path === "absence/process" && post) {
    permit("hr.manage");
    const s = office(),
      today = bangkokDate().day;
    if (!s) fail(409, "ตั้งค่าตารางทำงานก่อน");
    if (!dateValid(b.day) || b.day >= today)
      fail(422, "ประมวลผลได้เฉพาะวันที่ผ่านมา");
    const weekday = new Date(b.day + "T00:00:00Z").getUTCDay();
    if (
      !JSON.parse(s.workdays).includes(weekday) ||
      JSON.parse(s.holidays).includes(b.day)
    )
      fail(422, "วันหยุดไม่ถือเป็นวันขาดงาน");
    let absent = 0,
      onLeave = 0;
    atomic(() => {
      for (const e of db
        .prepare("SELECT id FROM employees WHERE tenant_id=? AND active=1")
        .all(u.tenant_id)) {
        const leave = db
          .prepare(
            "SELECT id FROM leave_requests WHERE tenant_id=? AND employee_id=? AND status='approved' AND start_day<=? AND end_day>=?",
          )
          .get(u.tenant_id, e.id, b.day, b.day);
        const row = db
          .prepare(
            "SELECT check_in FROM attendance WHERE tenant_id=? AND employee_id=? AND day=?",
          )
          .get(u.tenant_id, e.id, b.day);
        if (row?.check_in) continue;
        const status = leave ? "leave" : "absent";
        db.prepare(
          "INSERT INTO attendance(tenant_id,employee_id,day,status) VALUES(?,?,?,?) ON CONFLICT(tenant_id,employee_id,day) DO UPDATE SET status=excluded.status",
        ).run(u.tenant_id, e.id, b.day, status);
        if (leave) onLeave++;
        else absent++;
      }
      audit("attendance.absence_processed", "attendance", b.day, null, {
        absent,
        onLeave,
      });
    });
    reply(200, { absent, onLeave });
    return true;
  }
  return false;
}
