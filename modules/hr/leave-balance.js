import { can } from "../../packages/rbac/index.js";
import { bangkokDate } from "./attendance.js";
export function leaveDays(db, tenant, start, end, year) {
  const office = db
    .prepare("SELECT workdays,holidays FROM office_settings WHERE tenant_id=?")
    .get(tenant);
  if (!office) return null;
  const workdays = JSON.parse(office.workdays),
    holidays = new Set(JSON.parse(office.holidays));
  let days = 0;
  const from = new Date(start + "T00:00:00Z"),
    to = new Date(end + "T00:00:00Z");
  for (let d = from; d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (
      d.getUTCFullYear() === year &&
      workdays.includes(d.getUTCDay()) &&
      !holidays.has(day)
    )
      days++;
  }
  return days;
}
export function leaveBalance(db, tenant, employee, year, kind) {
  const entitlement = db
    .prepare(
      "SELECT days FROM leave_entitlements WHERE tenant_id=? AND employee_id=? AND year=? AND kind=?",
    )
    .get(tenant, employee, year, kind);
  const rows = db
    .prepare(
      "SELECT start_day,end_day,status FROM leave_requests WHERE tenant_id=? AND employee_id=? AND kind=? AND status IN ('approved','pending') AND start_day<=? AND end_day>=?",
    )
    .all(tenant, employee, kind, year + "-12-31", year + "-01-01");
  let used = 0,
    pending = 0,
    configured = true;
  for (const r of rows) {
    const days = leaveDays(db, tenant, r.start_day, r.end_day, year);
    if (days === null) {
      configured = false;
      continue;
    }
    if (r.status === "approved") used += days;
    else pending += days;
  }
  return {
    kind,
    entitlement: entitlement?.days ?? null,
    used,
    pending,
    remaining: entitlement && configured ? entitlement.days - used : null,
    calendar_configured: Boolean(
      db
        .prepare("SELECT tenant_id FROM office_settings WHERE tenant_id=?")
        .get(tenant),
    ),
  };
}
export async function leaveBalanceRoutes(c) {
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
  const path = url.pathname.slice("/api/v1/hr/".length);
  if (path !== "leave-balances" && !/^leaves\/\d+\/cancel$/.test(path))
    return false;
  if (path === "leave-balances" && req.method === "GET") {
    permit("attendance.self");
    const year = Number(
      url.searchParams.get("year") || Number(bangkokDate().day.slice(0, 4)),
    );
    if (!Number.isInteger(year) || year < 2000 || year > 2200)
      fail(422, "ปีไม่ถูกต้อง");
    const all = can(u.role, "hr.view");
    const rows = db
      .prepare(
        `SELECT id,code,name FROM employees WHERE tenant_id=? ${all ? "" : "AND user_id=?"} ORDER BY code`,
      )
      .all(...(all ? [u.tenant_id] : [u.tenant_id, u.id]));
    reply(200, {
      year,
      employees: rows.map((e) => ({
        ...e,
        balances: ["annual", "sick", "personal", "unpaid"].map((k) =>
          leaveBalance(db, u.tenant_id, e.id, year, k),
        ),
      })),
    });
    return true;
  }
  if (path === "leave-balances" && req.method === "POST") {
    permit("hr.manage");
    if (
      !db
        .prepare("SELECT id FROM employees WHERE id=? AND tenant_id=?")
        .get(b.employee_id, u.tenant_id) ||
      !Number.isInteger(Number(b.year)) ||
      Number(b.year) < 2000 ||
      Number(b.year) > 2200 ||
      !["annual", "sick", "personal", "unpaid"].includes(b.kind) ||
      typeof b.days !== "number" ||
      !Number.isFinite(b.days) ||
      b.days < 0 ||
      b.days > 366
    )
      fail(422, "ข้อมูลสิทธิ์ลาไม่ถูกต้อง");
    atomic(() => {
      db.prepare(
        "INSERT INTO leave_entitlements VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,employee_id,year,kind) DO UPDATE SET days=excluded.days",
      ).run(u.tenant_id, b.employee_id, Number(b.year), b.kind, b.days);
      audit("leave.entitlement_updated", "employee", b.employee_id, null, {
        year: Number(b.year),
        kind: b.kind,
        days: b.days,
      });
    });
    reply(200, {});
    return true;
  }
  const cancel = path.match(/^leaves\/(\d+)\/cancel$/);
  if (cancel && req.method === "POST") {
    permit("attendance.self");
    const row = db
      .prepare("SELECT * FROM leave_requests WHERE id=? AND tenant_id=?")
      .get(cancel[1], u.tenant_id);
    if (!row) fail(404, "ไม่พบใบลา");
    if (row.created_by !== u.id || row.status !== "pending")
      fail(409, "ยกเลิกได้เฉพาะใบลารออนุมัติของตนเอง");
    atomic(() => {
      db.prepare(
        "UPDATE leave_requests SET status='cancelled' WHERE id=? AND tenant_id=?",
      ).run(row.id, u.tenant_id);
      audit("leave.cancelled", "leave_requests", row.id, null, {
        status: "cancelled",
      });
    });
    reply(200, {});
    return true;
  }
  return false;
}
