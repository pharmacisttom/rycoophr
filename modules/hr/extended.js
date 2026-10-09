import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../../packages/security/index.js";
import { bangkokDate } from "./attendance.js";
import { can } from "../../packages/rbac/index.js";
export const validDay = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(new Date(v + "T00:00:00Z").getTime()) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
export const text = (v, max = 200, optional = false) => {
  if (typeof v !== "string" || v.length > max || (!optional && !v.trim()))
    throw Object.assign(Error("ข้อมูลข้อความไม่ถูกต้อง"), { status: 422 });
  return v.trim();
};
const amount = (v) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n) || n < 0 || n > 100000000)
    throw Object.assign(Error("จำนวนเงินไม่ถูกต้อง"), { status: 422 });
  return Math.round(n * 100);
};
const fields = {
  child: ["name", "birth_day", "school", "level"],
  family: ["name", "relationship", "phone"],
  education: ["institution", "degree", "major", "year"],
  training: ["title", "provider", "start_day", "end_day", "result"],
};
function validateRecord(kind, data, fail) {
  if (!fields[kind] || !data || Array.isArray(data) || typeof data !== "object")
    fail(422, "ประเภทประวัติไม่ถูกต้อง");
  const clean = {};
  for (const k of fields[kind])
    clean[k] = text(
      data[k] ?? "",
      k === "result" ? 1000 : 200,
      k !== "name" && k !== "institution" && k !== "title",
    );
  for (const k of ["birth_day", "start_day", "end_day"])
    if (clean[k] && !validDay(clean[k])) fail(422, "วันที่ไม่ถูกต้อง");
  if (clean.start_day && clean.end_day && clean.end_day < clean.start_day)
    fail(422, "ช่วงวันที่ไม่ถูกต้อง");
  return clean;
}
export async function extendedRoutes(c) {
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
    get = req.method === "GET",
    patch = req.method === "PATCH";
  const employee = (id) => {
    const e = db
      .prepare("SELECT * FROM employees WHERE id=? AND tenant_id=?")
      .get(id, u.tenant_id);
    if (!e) fail(404, "ไม่พบเจ้าหน้าที่");
    return e;
  };
  const own = () => {
    const e = db
      .prepare("SELECT * FROM employees WHERE tenant_id=? AND user_id=?")
      .get(u.tenant_id, u.id);
    if (!e) fail(403, "บัญชียังไม่ผูกกับทะเบียนเจ้าหน้าที่");
    return e;
  };
  const accessEmployee = (e) => {
    if (!can(u.role, "hr.view") && e.user_id !== u.id)
      fail(403, "ไม่มีสิทธิ์ข้อมูลเจ้าหน้าที่นี้");
  };
  const changed = (action, resource, id, run) =>
    atomic(() => {
      const r = run();
      audit(action, resource, id, null, { updated: true });
      return r;
    });
  if (path === "account-password" && post) {
    if (
      typeof b.current_password !== "string" ||
      typeof b.new_password !== "string" ||
      b.new_password.length < 12 ||
      b.new_password.length > 256 ||
      b.new_password !== b.confirm_password
    )
      fail(422, "รหัสผ่านใหม่ต้องตรงกันและยาว 12–256 ตัวอักษร");
    const a = db.prepare("SELECT password FROM users WHERE id=?").get(u.id);
    if (!verifyPassword(b.current_password, a.password))
      fail(401, "รหัสผ่านปัจจุบันไม่ถูกต้อง");
    changed("account.password_changed", "user", u.id, () => {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        hashPassword(b.new_password),
        u.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
    });
    reply(200, { sign_out: true });
    return true;
  }
  const em = path.match(/^employees\/(\d+)$/);
  if (em && get) {
    permit("hr.view");
    const e = employee(em[1]);
    reply(200, {
      ...e,
      profile: JSON.parse(e.profile),
      records: db
        .prepare(
          "SELECT id,kind,data,created_at FROM employee_records WHERE tenant_id=? AND employee_id=? ORDER BY id DESC",
        )
        .all(u.tenant_id, e.id)
        .map((r) => ({ ...r, data: JSON.parse(r.data) })),
      salary_history: db
        .prepare(
          "SELECT * FROM salary_adjustments WHERE tenant_id=? AND employee_id=? ORDER BY id DESC",
        )
        .all(u.tenant_id, e.id),
    });
    return true;
  }
  if (em && patch) {
    permit("hr.manage");
    const e = employee(em[1]);
    if (b.salary !== undefined && amount(b.salary) !== e.salary)
      fail(422, "เปลี่ยนเงินเดือนผ่านคำขอปรับเงินเดือน");
    if (
      !["permanent", "monthly", "temporary"].includes(b.kind) ||
      ![0, 1].includes(b.active) ||
      (!validDay(b.start_date) && b.start_date !== "") ||
      (!validDay(b.end_date) && b.end_date !== "") ||
      (b.start_date && b.end_date && b.end_date < b.start_date)
    )
      fail(422, "ประเภท วันที่ หรือสถานะไม่ถูกต้อง");
    const profile = {};
    for (const k of [
      "phone",
      "email",
      "address",
      "bank_name",
      "bank_account",
      "emergency_contact",
    ])
      profile[k] = text(
        b.profile?.[k] ?? "",
        k === "address" ? 1000 : 200,
        true,
      );
    changed("employee.updated", "employees", e.id, () => {
      db.prepare(
        "UPDATE employees SET code=?,name=?,department=?,kind=?,active=?,start_date=?,end_date=?,profile=? WHERE id=? AND tenant_id=?",
      ).run(
        text(b.code, 30),
        text(b.name),
        text(b.department),
        b.kind,
        b.active,
        b.start_date,
        b.end_date,
        JSON.stringify(profile),
        e.id,
        u.tenant_id,
      );
      if (!b.active && e.user_id)
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(e.user_id);
    });
    reply(200, {});
    return true;
  }
  const records = path.match(/^employees\/(\d+)\/records$/);
  if (records && post) {
    permit("hr.manage");
    const e = employee(records[1]),
      data = validateRecord(b.kind, b.data, fail);
    const r = changed("employee.record_created", "employees", e.id, () =>
      db
        .prepare(
          "INSERT INTO employee_records(tenant_id,employee_id,kind,data) VALUES(?,?,?,?)",
        )
        .run(u.tenant_id, e.id, b.kind, JSON.stringify(data)),
    );
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  const record = path.match(/^records\/(\d+)$/);
  if (record && (patch || req.method === "DELETE")) {
    permit("hr.manage");
    const r = db
      .prepare("SELECT * FROM employee_records WHERE id=? AND tenant_id=?")
      .get(record[1], u.tenant_id);
    if (!r) fail(404, "ไม่พบประวัติ");
    changed("employee.record_updated", "employee_records", r.id, () =>
      patch
        ? db
            .prepare(
              "UPDATE employee_records SET data=? WHERE id=? AND tenant_id=?",
            )
            .run(
              JSON.stringify(validateRecord(r.kind, b.data, fail)),
              r.id,
              u.tenant_id,
            )
        : db
            .prepare("DELETE FROM employee_records WHERE id=? AND tenant_id=?")
            .run(r.id, u.tenant_id),
    );
    reply(200, {});
    return true;
  }
  if (path === "my-profile" && get) {
    permit("attendance.self");
    const e = own();
    reply(200, {
      id: e.id,
      code: e.code,
      name: e.name,
      department: e.department,
      start_date: e.start_date,
      profile: JSON.parse(e.profile),
    });
    return true;
  }
  if (path === "my-payroll" && get) {
    permit("attendance.self");
    reply(
      200,
      db
        .prepare(
          "SELECT p.*,e.name,e.code FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.tenant_id=? AND p.employee_id=? AND p.status='approved' ORDER BY period DESC",
        )
        .all(u.tenant_id, own().id),
    );
    return true;
  }
  if (path === "salary-adjustments" && get) {
    permit("hr.view");
    reply(
      200,
      db
        .prepare(
          "SELECT a.*,e.name,e.code FROM salary_adjustments a JOIN employees e ON e.id=a.employee_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 500",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  if (path === "salary-adjustments" && post) {
    permit("hr.manage");
    const e = employee(b.employee_id),
      percent = Number(b.percent);
    if (
      !e.active ||
      !Number.isFinite(percent) ||
      percent < -100 ||
      percent > 100 ||
      !validDay(b.effective_day)
    )
      fail(422, "อัตราหรือวันมีผลไม่ถูกต้อง");
    const next = Math.round(e.salary * (1 + percent / 100));
    const r = changed("salary.requested", "employees", e.id, () =>
      db
        .prepare(
          "INSERT INTO salary_adjustments(tenant_id,employee_id,old_salary,new_salary,percent,effective_day,reason,created_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          e.id,
          e.salary,
          next,
          percent,
          b.effective_day,
          text(b.reason, 1000),
          u.id,
        ),
    );
    reply(201, { id: Number(r.lastInsertRowid), new_salary: next });
    return true;
  }
  const adjustment = path.match(/^salary-adjustments\/(\d+)\/decision$/);
  if (adjustment && post) {
    permit("hr.approve");
    const r = db
      .prepare("SELECT * FROM salary_adjustments WHERE id=? AND tenant_id=?")
      .get(adjustment[1], u.tenant_id);
    if (!r) fail(404, "ไม่พบคำขอ");
    if (r.status !== "pending") fail(409, "พิจารณาแล้ว");
    if (r.created_by === u.id) fail(403, "อนุมัติคำขอตนเองไม่ได้");
    if (!["approved", "rejected"].includes(b.status))
      fail(422, "สถานะไม่ถูกต้อง");
    const e = employee(r.employee_id);
    if (
      b.status === "approved" &&
      (r.effective_day > bangkokDate().day || e.salary !== r.old_salary)
    )
      fail(409, "ยังไม่ถึงวันมีผลหรือฐานเงินเดือนเปลี่ยนแล้ว");
    changed("salary." + b.status, "salary_adjustments", r.id, () => {
      if (b.status === "approved")
        db.prepare(
          "UPDATE employees SET salary=? WHERE id=? AND tenant_id=?",
        ).run(r.new_salary, e.id, u.tenant_id);
      db.prepare(
        "UPDATE salary_adjustments SET status=?,approved_by=? WHERE id=?",
      ).run(b.status, u.id, r.id);
    });
    reply(200, {});
    return true;
  }
  const payroll = path.match(/^payroll\/(\d+)$/);
  if (payroll && get) {
    const r = db
      .prepare(
        "SELECT p.*,e.name,e.code,e.user_id FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.id=? AND p.tenant_id=?",
      )
      .get(payroll[1], u.tenant_id);
    if (!r) fail(404, "ไม่พบสลิป");
    if (
      !can(u.role, "hr.view") &&
      (r.user_id !== u.id || r.status !== "approved")
    )
      fail(403, "ไม่มีสิทธิ์สลิปนี้");
    reply(200, r);
    return true;
  }
  const cancel = path.match(/^(payroll|welfare)\/(\d+)\/cancel$/);
  if (cancel && post) {
    permit("hr.manage");
    const table = cancel[1],
      r = db
        .prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`)
        .get(cancel[2], u.tenant_id);
    if (!r) fail(404, "ไม่พบรายการ");
    if (r.created_by !== u.id || !["pending", "draft"].includes(r.status))
      fail(409, "ยกเลิกได้เฉพาะรายการรอพิจารณาของตน");
    changed(table + ".cancelled", table, r.id, () =>
      db
        .prepare(
          `UPDATE ${table} SET status='cancelled' WHERE id=? AND tenant_id=?`,
        )
        .run(r.id, u.tenant_id),
    );
    reply(200, {});
    return true;
  }
  if (path === "payroll/bulk" && post) {
    permit("hr.manage");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.period)) fail(422, "งวดไม่ถูกต้อง");
    const rows = db
      .prepare("SELECT * FROM employees WHERE tenant_id=? AND active=1")
      .all(u.tenant_id);
    if (!rows.length) fail(422, "ไม่มีเจ้าหน้าที่");
    if (
      db
        .prepare(
          "SELECT id FROM payroll WHERE tenant_id=? AND period=? AND kind='salary'",
        )
        .get(u.tenant_id, b.period)
    )
      fail(409, "มีรายการงวดนี้แล้ว กรุณาตรวจรายการเดิม");
    changed("payroll.bulk_created", "payroll", b.period, () => {
      for (const e of rows)
        db.prepare(
          "INSERT INTO payroll(tenant_id,employee_id,period,kind,gross,deductions,net,created_by) VALUES(?,?,?,'salary',?,0,?,?)",
        ).run(u.tenant_id, e.id, b.period, e.salary, e.salary, u.id);
    });
    reply(201, { count: rows.length });
    return true;
  }
  if (path === "reports" && get) {
    permit("hr.view");
    const period =
      url.searchParams.get("period") || bangkokDate().day.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(422, "งวดไม่ถูกต้อง");
    const days = period + "%",
      employees = db
        .prepare(
          "SELECT id,code,name,department,active FROM employees WHERE tenant_id=? ORDER BY code",
        )
        .all(u.tenant_id);
    const attendance = db
      .prepare(
        "SELECT a.employee_id,a.status,count(*) count FROM attendance a WHERE tenant_id=? AND day LIKE ? GROUP BY employee_id,status",
      )
      .all(u.tenant_id, days);
    const payments = db
      .prepare(
        "SELECT p.id,e.code,e.name,p.period,p.kind,p.gross,p.deductions,p.net,p.status FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.tenant_id=? AND p.period=? ORDER BY e.code",
      )
      .all(u.tenant_id, period);
    const welfare = db
      .prepare(
        "SELECT kind,status,count(*) count,sum(amount) amount FROM welfare WHERE tenant_id=? AND created_at LIKE ? GROUP BY kind,status",
      )
      .all(u.tenant_id, days);
    reply(200, { period, employees, attendance, payments, welfare });
    return true;
  }
  if (path === "board-summary" && get) {
    permit("board.view");
    const ownScope = u.role === "director";
    const rows = db
      .prepare(
        `SELECT d.id,d.name,d.position,d.duties,count(t.id) tasks,sum(CASE WHEN t.status='reviewed' THEN 1 ELSE 0 END) completed,avg(t.score) score,sum(CASE WHEN t.due_date<? AND t.status NOT IN ('submitted','reviewed') THEN 1 ELSE 0 END) overdue FROM directors d LEFT JOIN board_tasks t ON t.director_id=d.id AND t.tenant_id=d.tenant_id WHERE d.tenant_id=? ${ownScope ? "AND d.user_id=?" : ""} GROUP BY d.id ORDER BY d.id`,
      )
      .all(
        ...(ownScope
          ? [bangkokDate().day, u.tenant_id, u.id]
          : [bangkokDate().day, u.tenant_id]),
      );
    reply(200, rows);
    return true;
  }
  const account = path.match(/^accounts\/([^/]+)$/);
  if (account && patch) {
    permit("users.manage");
    const target = db
      .prepare(
        "SELECT u.id,m.role,u.disabled FROM users u JOIN memberships m ON u.id=m.user_id WHERE u.id=? AND m.tenant_id=?",
      )
      .get(account[1], u.tenant_id);
    if (!target) fail(404, "ไม่พบบัญชี");
    if (target.id === u.id) fail(403, "เปลี่ยนสิทธิ์หรือปิดบัญชีตนเองไม่ได้");
    const basic = ["staff", "viewer"];
    if (
      u.role === "it_admin" &&
      (!basic.includes(target.role) || !basic.includes(b.role))
    )
      fail(403, "IT แก้ไขได้เฉพาะบัญชีพื้นฐาน");
    if (
      ["admin", "super_admin"].includes(target.role) ||
      ![
        "staff",
        "viewer",
        "hr_officer",
        "manager",
        "it_admin",
        "chair",
        "director",
      ].includes(b.role) ||
      ![0, 1].includes(b.disabled)
    )
      fail(422, "แก้ไขบัญชีแอดมินหรือบทบาทนี้ไม่ได้");
    const isBoard = db
      .prepare("SELECT id FROM directors WHERE tenant_id=? AND user_id=?")
      .get(u.tenant_id, target.id);
    if (Boolean(isBoard) !== ["chair", "director"].includes(b.role))
      fail(422, "ห้ามเปลี่ยนบัญชีข้ามกรรมการและเจ้าหน้าที่");
    changed("account.updated", "user", target.id, () => {
      db.prepare("UPDATE users SET disabled=? WHERE id=?").run(
        b.disabled,
        target.id,
      );
      db.prepare(
        "UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?",
      ).run(b.role, target.id, u.tenant_id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
    });
    reply(200, {});
    return true;
  }
  if (path === "accounts/list" && get) {
    permit("users.view");
    reply(
      200,
      db
        .prepare(
          "SELECT u.id,u.name,u.email,u.disabled,m.role,e.code FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN employees e ON e.user_id=u.id AND e.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY u.name",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  const directory = path.match(/^directory\/(\d+)$/);
  if (directory && patch) {
    permit("board.manage");
    const r = db
      .prepare("SELECT id FROM organization_staff WHERE id=? AND tenant_id=?")
      .get(directory[1], u.tenant_id);
    if (!r) fail(404, "ไม่พบข้อมูล");
    changed("directory.updated", "organization_staff", r.id, () =>
      db
        .prepare(
          "UPDATE organization_staff SET name=?,position=?,source='ยืนยันโดยสหกรณ์' WHERE id=? AND tenant_id=?",
        )
        .run(text(b.name), text(b.position), r.id, u.tenant_id),
    );
    reply(200, {});
    return true;
  }
  // Resource access is checked on each upload, listing, download and deletion.
  const resource = (type, id, write = false) => {
    if (!Number.isInteger(Number(id)) || Number(id) < 1)
      fail(422, "รหัสข้อมูลไม่ถูกต้อง");
    const tables = {
      employee: "employees",
      welfare: "welfare",
      payroll: "payroll",
      leave: "leave_requests",
      task: "board_tasks",
    };
    if (!tables[type]) fail(422, "ประเภทเอกสารไม่ถูกต้อง");
    const r = db
      .prepare(`SELECT * FROM ${tables[type]} WHERE id=? AND tenant_id=?`)
      .get(id, u.tenant_id);
    if (!r) fail(404, "ไม่พบข้อมูลหลัก");
    if (write && ["approved", "reviewed"].includes(r.status))
      fail(409, "เอกสารของรายการที่อนุมัติหรือประเมินแล้วแก้ไขไม่ได้");
    if (type === "task") {
      permit("board.view");
      const d = db
        .prepare("SELECT user_id FROM directors WHERE id=? AND tenant_id=?")
        .get(r.director_id, u.tenant_id);
      if (u.role === "director" && d.user_id !== u.id)
        fail(403, "ไม่มีสิทธิ์งานนี้");
      if (write && d.user_id !== u.id && !can(u.role, "board.assign"))
        fail(403, "ไม่มีสิทธิ์แนบหลักฐาน");
    } else if (type === "employee") {
      accessEmployee(r);
      if (write) permit("hr.manage");
    } else {
      const e = employee(r.employee_id);
      accessEmployee(e);
      if (write && type !== "leave") permit("hr.manage");
      if (
        write &&
        type === "leave" &&
        r.created_by !== u.id &&
        !can(u.role, "hr.manage")
      )
        fail(403, "ไม่มีสิทธิ์ใบลา");
    }
    return r;
  };
  if (path === "attachments" && get) {
    resource(url.searchParams.get("resource"), url.searchParams.get("id"));
    reply(
      200,
      db
        .prepare(
          "SELECT id,name,mime,size,uploaded_by,created_at FROM attachments WHERE tenant_id=? AND resource=? AND resource_id=? ORDER BY created_at DESC",
        )
        .all(
          u.tenant_id,
          url.searchParams.get("resource"),
          url.searchParams.get("id"),
        ),
    );
    return true;
  }
  if (path === "attachments" && post) {
    resource(b.resource, b.resource_id, true);
    const name = text(b.name, 150).replace(/[\/\\\x00-\x1f]/g, "_");
    if (typeof b.base64 !== "string" || b.base64.length > 1400000)
      fail(422, "เอกสารต้องไม่เกิน 1 MB");
    const bytes = Buffer.from(b.base64, "base64");
    let mime;
    if (bytes.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
    else if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = "image/jpeg";
    if (!mime || bytes.length > 1000000)
      fail(422, "รองรับ PDF JPG PNG ขนาดไม่เกิน 1 MB");
    if (
      db
        .prepare(
          "SELECT count(*) n FROM attachments WHERE tenant_id=? AND resource=? AND resource_id=?",
        )
        .get(u.tenant_id, b.resource, b.resource_id).n >= 20
    )
      fail(422, "แนบได้สูงสุด 20 ไฟล์ต่อรายการ");
    const id = randomUUID();
    changed("attachment.uploaded", "attachment", id, () =>
      db
        .prepare(
          "INSERT INTO attachments(id,tenant_id,resource,resource_id,name,mime,size,content,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          u.tenant_id,
          b.resource,
          b.resource_id,
          name,
          mime,
          bytes.length,
          bytes,
          u.id,
        ),
    );
    reply(201, { id });
    return true;
  }
  const attachment = path.match(/^attachments\/([^/]+)$/);
  if (attachment && (get || req.method === "DELETE")) {
    const a = db
      .prepare("SELECT * FROM attachments WHERE id=? AND tenant_id=?")
      .get(attachment[1], u.tenant_id);
    if (!a) fail(404, "ไม่พบไฟล์");
    resource(a.resource, a.resource_id, req.method === "DELETE");
    if (get)
      reply(200, {
        name: a.name,
        mime: a.mime,
        base64: Buffer.from(a.content).toString("base64"),
      });
    else {
      if (
        a.uploaded_by !== u.id &&
        !can(u.role, "hr.manage") &&
        !can(u.role, "board.assign")
      )
        fail(403, "ลบได้เฉพาะไฟล์ที่ตนแนบ");
      changed("attachment.deleted", "attachment", a.id, () =>
        db
          .prepare("DELETE FROM attachments WHERE id=? AND tenant_id=?")
          .run(a.id, u.tenant_id),
      );
      reply(200, {});
    }
    return true;
  }
  if (path === "meetings" && get) {
    permit("board.view");
    reply(
      200,
      db
        .prepare(
          `SELECT DISTINCT m.* FROM board_meetings m LEFT JOIN meeting_participants p ON p.meeting_id=m.id LEFT JOIN directors d ON d.id=p.director_id WHERE m.tenant_id=? ${u.role === "director" ? "AND d.user_id=?" : ""} ORDER BY m.day DESC,m.id DESC`,
        )
        .all(...(u.role === "director" ? [u.tenant_id, u.id] : [u.tenant_id]))
        .map((m) => ({
          ...m,
          participants: db
            .prepare(
              "SELECT p.*,d.name FROM meeting_participants p JOIN directors d ON d.id=p.director_id WHERE p.meeting_id=? ORDER BY d.id",
            )
            .all(m.id),
        })),
    );
    return true;
  }
  if (path === "meetings" && post) {
    permit("board.assign");
    if (
      !validDay(b.day) ||
      !Array.isArray(b.director_ids) ||
      !b.director_ids.length ||
      b.director_ids.length > 50
    )
      fail(422, "วันที่หรือผู้เข้าร่วมไม่ถูกต้อง");
    const ids = [...new Set(b.director_ids.map(Number))];
    for (const id of ids)
      if (
        !db
          .prepare("SELECT id FROM directors WHERE id=? AND tenant_id=?")
          .get(id, u.tenant_id)
      )
        fail(422, "กรรมการไม่อยู่ในสหกรณ์นี้");
    const r = changed("meeting.created", "board_meetings", "", () => {
      const row = db
        .prepare(
          "INSERT INTO board_meetings(tenant_id,committee,title,day,agenda,created_by) VALUES(?,?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          text(b.committee),
          text(b.title),
          b.day,
          text(b.agenda, 5000),
          u.id,
        );
      for (const id of ids)
        db.prepare(
          "INSERT INTO meeting_participants(meeting_id,director_id) VALUES(?,?)",
        ).run(row.lastInsertRowid, id);
      return row;
    });
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  const meeting = path.match(/^meetings\/(\d+)$/);
  if (meeting && patch) {
    permit("board.assign");
    const r = db
      .prepare("SELECT id FROM board_meetings WHERE id=? AND tenant_id=?")
      .get(meeting[1], u.tenant_id);
    if (!r) fail(404, "ไม่พบการประชุม");
    if (
      !["scheduled", "completed", "cancelled"].includes(b.status) ||
      !Array.isArray(b.participants)
    )
      fail(422, "ข้อมูลประชุมไม่ถูกต้อง");
    for (const p of b.participants)
      if (
        !["invited", "present", "absent", "excused"].includes(p.status) ||
        !db
          .prepare(
            "SELECT director_id FROM meeting_participants WHERE meeting_id=? AND director_id=?",
          )
          .get(r.id, p.director_id)
      )
        fail(422, "ผู้เข้าร่วมไม่ถูกต้อง");
    changed("meeting.minutes_saved", "board_meetings", r.id, () => {
      db.prepare(
        "UPDATE board_meetings SET minutes=?,status=? WHERE id=? AND tenant_id=?",
      ).run(text(b.minutes, 10000, true), b.status, r.id, u.tenant_id);
      for (const p of b.participants)
        db.prepare(
          "UPDATE meeting_participants SET status=?,note=? WHERE meeting_id=? AND director_id=?",
        ).run(p.status, text(p.note ?? "", 1000, true), r.id, p.director_id);
    });
    reply(200, {});
    return true;
  }
  return false;
}
