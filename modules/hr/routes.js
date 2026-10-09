import { randomUUID } from "node:crypto";
import { hashPassword } from "../../packages/security/index.js";
import { rosterSources } from "./organization.js";
import ExcelJS from "exceljs";
import { attendanceRoutes } from "./attendance.js";

export async function hrRoutes(c) {
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
  if (!url.pathname.startsWith("/api/v1/hr/")) return false;
  if (await attendanceRoutes(c)) return true;
  const path = url.pathname.slice("/api/v1/hr/".length),
    post = req.method === "POST",
    get = req.method === "GET";
  const text = (v, max = 200) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      fail(422, "ข้อมูลข้อความไม่ถูกต้อง");
    return v.trim();
  };
  const money = (v) => {
    const n = Number(v);
    if (v === "" || v == null || !Number.isFinite(n) || n < 0 || n > 100000000)
      fail(422, "จำนวนเงินไม่ถูกต้อง");
    return Math.round(n * 100);
  };
  const employee = (id) => {
    const e = db
      .prepare(
        "SELECT * FROM employees WHERE id=? AND tenant_id=? AND active=1",
      )
      .get(id, u.tenant_id);
    if (!e) fail(422, "ไม่พบพนักงาน");
    return e;
  };
  const write = (action, table, run) =>
    atomic(() => {
      const result = run();
      audit(action, table, result.lastInsertRowid || "", null, {
        recorded: true,
      });
      return result;
    });
  const boardRole = ["director", "chair"].includes(u.role);
  if (path === "attendance/xlsx" && post) {
    permit("hr.manage");
    if (typeof b.base64 !== "string" || b.base64.length > 1800000)
      fail(422, "ไฟล์ต้องไม่เกิน 1 MB");
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(Buffer.from(b.base64, "base64"));
    } catch {
      fail(422, "อ่านไฟล์ Excel ไม่ได้");
    }
    const sheet = book.worksheets[0];
    if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 501)
      fail(422, "Excel ต้องมี 1-500 แถว");
    const headers = ["code", "name", "day", "check_in", "check_out"];
    if (
      headers.some(
        (h, i) =>
          sheet
            .getRow(1)
            .getCell(i + 1)
            .text.trim() !== h,
      )
    )
      fail(422, "หัวตารางต้องเป็น code,name,day,check_in,check_out");
    b.rows = [];
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const r = {};
      headers.forEach((h, j) => {
        const cell = row.getCell(j + 1);
        r[h] =
          cell.value instanceof Date
            ? cell.value.toISOString().slice(0, 10)
            : cell.text.trim();
      });
      b.rows.push(r);
    }
    return hrRoutes({
      ...c,
      url: new URL("/api/v1/hr/attendance/import", url),
      body: b,
    });
  }
  if (path === "directory" && get) {
    permit("directory.view");
    reply(200, {
      sources: rosterSources,
      staff: db
        .prepare(
          "SELECT id,name,position,source FROM organization_staff WHERE tenant_id=? ORDER BY id",
        )
        .all(u.tenant_id),
    });
    return true;
  }
  if (path === "accounts" && post) {
    permit("users.manage");
    const permitted =
      u.role === "it_admin"
        ? ["staff", "viewer"]
        : ["staff", "hr_officer", "manager", "it_admin", "viewer"];
    if (
      !permitted.includes(b.role) ||
      typeof b.password !== "string" ||
      b.password.length < 12 ||
      b.password.length > 256
    )
      fail(422, "บทบาทหรือรหัสผ่านไม่ถูกต้อง");
    const email = text(b.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, "อีเมลไม่ถูกต้อง");
    const link = b.employee_id ? employee(b.employee_id) : null;
    if (link) {
      permit("hr.manage");
      if (link.user_id) fail(409, "เจ้าหน้าที่มีบัญชีแล้ว");
    }
    const id = randomUUID();
    atomic(() => {
      db.prepare(
        "INSERT INTO users(id,email,name,password) VALUES(?,?,?,?)",
      ).run(id, email, text(b.name), hashPassword(b.password));
      db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
        id,
        u.tenant_id,
        b.role,
      );
      if (link)
        db.prepare(
          "UPDATE employees SET user_id=? WHERE id=? AND tenant_id=?",
        ).run(id, link.id, u.tenant_id);
      audit("account.created", "user", id, null, { role: b.role });
    });
    reply(201, { id });
    return true;
  }
  if (path === "summary" && get) {
    permit("hr.view");
    reply(200, {
      employees: db
        .prepare(
          "SELECT count(*) n FROM employees WHERE tenant_id=? AND active=1",
        )
        .get(u.tenant_id).n,
      pending: db
        .prepare(
          "SELECT count(*) n FROM welfare WHERE tenant_id=? AND status='pending'",
        )
        .get(u.tenant_id).n,
      payroll: db
        .prepare(
          "SELECT coalesce(sum(net),0) n FROM payroll WHERE tenant_id=? AND status='approved'",
        )
        .get(u.tenant_id).n,
    });
    return true;
  }
  if (path === "employees" && get) {
    permit("hr.view");
    reply(
      200,
      db
        .prepare(
          "SELECT * FROM employees WHERE tenant_id=? ORDER BY code LIMIT 500",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  if (path === "employees" && post) {
    permit("hr.manage");
    if (!["permanent", "monthly", "temporary"].includes(b.kind))
      fail(422, "ประเภทพนักงานไม่ถูกต้อง");
    const r = write("employee.created", "employees", () =>
      db
        .prepare(
          "INSERT INTO employees(tenant_id,code,name,department,kind,salary) VALUES(?,?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          text(b.code, 30),
          text(b.name),
          text(b.department),
          b.kind,
          money(b.salary),
        ),
    );
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  if (path === "welfare" && get) {
    permit("hr.view");
    reply(
      200,
      db
        .prepare(
          "SELECT w.*,e.name,e.code FROM welfare w JOIN employees e ON e.id=w.employee_id WHERE w.tenant_id=? ORDER BY w.id DESC LIMIT 500",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  if (path === "welfare" && post) {
    permit("hr.manage");
    const e = employee(b.employee_id);
    if (!["medical", "tuition", "overtime"].includes(b.kind))
      fail(422, "ประเภทสวัสดิการไม่ถูกต้อง");
    if (e.kind === "temporary" && b.kind === "tuition")
      fail(422, "ลูกจ้างชั่วคราวไม่มีสิทธิ์ค่าเล่าเรียนบุตรในนโยบายเริ่มต้น");
    const amount = money(b.amount);
    if (!amount) fail(422, "ยอดต้องมากกว่าศูนย์");
    const r = write("welfare.created", "welfare", () =>
      db
        .prepare(
          "INSERT INTO welfare(tenant_id,employee_id,kind,amount,detail,created_by) VALUES(?,?,?,?,?,?)",
        )
        .run(u.tenant_id, e.id, b.kind, amount, text(b.detail, 2000), u.id),
    );
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  if (path === "payroll" && get) {
    permit("hr.view");
    reply(
      200,
      db
        .prepare(
          "SELECT p.*,e.code,e.name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.tenant_id=? ORDER BY p.period DESC,p.id DESC LIMIT 500",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  if (path === "payroll" && post) {
    permit("hr.manage");
    const e = employee(b.employee_id);
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.period) ||
      !["salary", "bonus"].includes(b.kind)
    )
      fail(422, "งวดหรือประเภทรายการไม่ถูกต้อง");
    const multiplier = Number(b.multiplier ?? 1);
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 24)
      fail(422, "จำนวนเท่าไม่ถูกต้อง");
    const gross =
      b.kind === "bonus"
        ? Math.round(e.salary * multiplier)
        : e.salary + money(b.additions ?? 0);
    const deductions = money(b.deductions);
    if (deductions > gross) fail(422, "ยอดหักมากกว่ารายได้");
    const r = write("payroll.created", "payroll", () =>
      db
        .prepare(
          "INSERT INTO payroll(tenant_id,employee_id,period,kind,gross,deductions,net,created_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          e.id,
          b.period,
          b.kind,
          gross,
          deductions,
          gross - deductions,
          u.id,
        ),
    );
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  const approve = path.match(/^(welfare|payroll)\/(\d+)\/decision$/);
  if (approve && post) {
    permit("hr.approve");
    if (!["approved", "rejected"].includes(b.status))
      fail(422, "สถานะไม่ถูกต้อง");
    const table = approve[1],
      row = db
        .prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`)
        .get(approve[2], u.tenant_id);
    if (!row) fail(404, "ไม่พบรายการ");
    if (row.created_by === u.id)
      fail(403, "ผู้จัดทำต้องเป็นคนละคนกับผู้อนุมัติ");
    if (!["draft", "pending"].includes(row.status))
      fail(409, "รายการตัดสินแล้ว");
    atomic(() => {
      db.prepare(
        `UPDATE ${table} SET status=?,approved_by=? WHERE id=? AND tenant_id=?`,
      ).run(b.status, u.id, row.id, u.tenant_id);
      audit(
        table + "." + b.status,
        table,
        row.id,
        { status: row.status },
        { status: b.status },
      );
    });
    reply(200, {});
    return true;
  }
  if (path === "attendance" && get) {
    permit("hr.view");
    reply(
      200,
      db
        .prepare(
          "SELECT a.*,e.code,e.name FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.tenant_id=? ORDER BY day DESC LIMIT 500",
        )
        .all(u.tenant_id),
    );
    return true;
  }
  if (path === "attendance/import" && post) {
    permit("hr.manage");
    if (!Array.isArray(b.rows) || b.rows.length > 500 || !b.rows.length)
      fail(422, "นำเข้าได้ 1-500 แถว");
    const errors = [],
      valid = [];
    b.rows.forEach((r, i) => {
      const e = db
        .prepare(
          "SELECT * FROM employees WHERE tenant_id=? AND code=? AND name=? AND active=1",
        )
        .get(u.tenant_id, String(r.code), String(r.name));
      const day = r.day;
      const date = new Date(String(day) + "T00:00:00Z");
      const time = (t) =>
        t === "" || t == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
      if (
        !e ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== day ||
        !time(r.check_in) ||
        !time(r.check_out) ||
        (r.check_out && !r.check_in) ||
        (r.check_in && r.check_out && r.check_out < r.check_in)
      )
        errors.push({
          row: i + 1,
          message: "รหัส/ชื่อ วันที่ หรือเวลาไม่ถูกต้อง",
        });
      else
        valid.push({
          e,
          day,
          check_in: r.check_in || null,
          check_out: r.check_out || null,
          status: !r.check_in
            ? "absent"
            : r.check_in > "08:30"
              ? "late"
              : "present",
        });
    });
    atomic(() => {
      for (const r of valid)
        db.prepare(
          "INSERT INTO attendance(tenant_id,employee_id,day,check_in,check_out,status) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,employee_id,day) DO UPDATE SET check_in=excluded.check_in,check_out=excluded.check_out,status=excluded.status",
        ).run(u.tenant_id, r.e.id, r.day, r.check_in, r.check_out, r.status);
      audit("attendance.imported", "attendance", "", null, {
        accepted: valid.length,
        rejected: errors.length,
      });
    });
    reply(200, { accepted: valid.length, errors });
    return true;
  }
  if (path === "directors" && get) {
    permit("board.view");
    const own = u.role === "director";
    const rows = db
      .prepare(
        `SELECT id,user_id,name,position,term_start,term_end,duties FROM directors WHERE tenant_id=? ${own ? "AND user_id=?" : ""} ORDER BY id`,
      )
      .all(...(own ? [u.tenant_id, u.id] : [u.tenant_id]));
    reply(
      200,
      rows.map((d) => ({
        ...d,
        committees: db
          .prepare(
            "SELECT committee,position FROM director_committees WHERE director_id=?",
          )
          .all(d.id),
      })),
    );
    return true;
  }
  if (path === "directors" && post) {
    permit("board.manage");
    const name = text(b.name),
      email = text(b.email).toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof b.password !== "string" ||
      b.password.length < 12 ||
      b.password.length > 256
    )
      fail(422, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    if (
      !["chair", "director"].includes(b.role) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.term_start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.term_end) ||
      b.term_end < b.term_start
    )
      fail(422, "บทบาทหรือวาระไม่ถูกต้อง");
    const existing = b.profile_id
      ? db
          .prepare("SELECT * FROM directors WHERE id=? AND tenant_id=?")
          .get(b.profile_id, u.tenant_id)
      : null;
    if (b.profile_id && (!existing || existing.user_id))
      fail(409, "โปรไฟล์นี้เปิดบัญชีแล้วหรือไม่พบ");
    const uid = randomUUID();
    const r = atomic(() => {
      db.prepare(
        "INSERT INTO users(id,email,name,password) VALUES(?,?,?,?)",
      ).run(uid, email, name, hashPassword(b.password));
      db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
        uid,
        u.tenant_id,
        b.role,
      );
      let id;
      if (existing) {
        id = existing.id;
        db.prepare(
          "UPDATE directors SET user_id=?,name=?,position=?,term_start=?,term_end=?,duties=? WHERE id=? AND tenant_id=?",
        ).run(
          uid,
          name,
          text(b.position),
          b.term_start,
          b.term_end,
          text(b.duties, 3000),
          id,
          u.tenant_id,
        );
      } else {
        id = db
          .prepare(
            "INSERT INTO directors(tenant_id,user_id,name,position,term_start,term_end,duties) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            u.tenant_id,
            uid,
            name,
            text(b.position),
            b.term_start,
            b.term_end,
            text(b.duties, 3000),
          ).lastInsertRowid;
      }
      audit("director.activated", "directors", id, null, { role: b.role });
      return { id: Number(id) };
    });
    reply(201, r);
    return true;
  }
  const profile = path.match(/^directors\/(\d+)$/);
  if (profile && req.method === "PATCH") {
    permit("board.manage");
    const d = db
      .prepare("SELECT * FROM directors WHERE id=? AND tenant_id=?")
      .get(profile[1], u.tenant_id);
    if (!d) fail(404, "ไม่พบกรรมการ");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(b.term_start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.term_end) ||
      b.term_end < b.term_start
    )
      fail(422, "วาระไม่ถูกต้อง");
    atomic(() => {
      db.prepare(
        "UPDATE directors SET duties=?,term_start=?,term_end=? WHERE id=? AND tenant_id=?",
      ).run(text(b.duties, 3000), b.term_start, b.term_end, d.id, u.tenant_id);
      audit("director.duties_updated", "directors", d.id, null, {
        updated: true,
      });
    });
    reply(200, {});
    return true;
  }
  if (path === "tasks" && get) {
    permit("board.view");
    reply(
      200,
      db
        .prepare(
          `SELECT t.*,d.name,d.position FROM board_tasks t JOIN directors d ON d.id=t.director_id WHERE t.tenant_id=? ${u.role === "director" ? "AND d.user_id=?" : ""} ORDER BY due_date,t.id`,
        )
        .all(...(u.role === "director" ? [u.tenant_id, u.id] : [u.tenant_id])),
    );
    return true;
  }
  if (path === "tasks" && post) {
    permit("board.assign");
    const d = db
      .prepare("SELECT id FROM directors WHERE id=? AND tenant_id=?")
      .get(b.director_id, u.tenant_id);
    if (!d) fail(422, "ไม่พบกรรมการ");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date))
      fail(422, "กำหนดส่งไม่ถูกต้อง");
    const r = write("board.task_assigned", "board_tasks", () =>
      db
        .prepare(
          "INSERT INTO board_tasks(tenant_id,director_id,title,indicator,due_date) VALUES(?,?,?,?,?)",
        )
        .run(
          u.tenant_id,
          d.id,
          text(b.title),
          text(b.indicator, 1000),
          b.due_date,
        ),
    );
    reply(201, { id: Number(r.lastInsertRowid) });
    return true;
  }
  const task = path.match(/^tasks\/(\d+)$/);
  if (task && req.method === "PATCH") {
    permit("board.view");
    const row = db
      .prepare(
        "SELECT t.*,d.user_id FROM board_tasks t JOIN directors d ON d.id=t.director_id WHERE t.id=? AND t.tenant_id=?",
      )
      .get(task[1], u.tenant_id);
    if (!row) fail(404, "ไม่พบงาน");
    if (row.user_id !== u.id) fail(403, "เฉพาะกรรมการเจ้าของงานบันทึกผลงาน");
    if (row.status === "reviewed") fail(409, "งานประเมินแล้ว");
    if (!["in_progress", "submitted"].includes(b.status))
      fail(422, "สถานะไม่ถูกต้อง");
    atomic(() => {
      db.prepare("UPDATE board_tasks SET outcome=?,status=? WHERE id=?").run(
        text(b.outcome, 3000),
        b.status,
        row.id,
      );
      audit("board.outcome_saved", "board_tasks", row.id, null, {
        status: b.status,
      });
    });
    reply(200, {});
    return true;
  }
  const review = path.match(/^tasks\/(\d+)\/review$/);
  if (review && post) {
    permit("board.review");
    const row = db
      .prepare(
        "SELECT t.*,d.user_id FROM board_tasks t JOIN directors d ON d.id=t.director_id WHERE t.id=? AND t.tenant_id=?",
      )
      .get(review[1], u.tenant_id);
    if (!row) fail(404, "ไม่พบงาน");
    if (row.user_id === u.id) fail(403, "ประเมินผลงานตนเองไม่ได้");
    if (row.status !== "submitted") fail(409, "ต้องส่งผลงานก่อน");
    if (
      !Number.isInteger(Number(b.score)) ||
      Number(b.score) < 0 ||
      Number(b.score) > 100
    )
      fail(422, "คะแนนต้องอยู่ระหว่าง 0-100");
    atomic(() => {
      db.prepare(
        "UPDATE board_tasks SET score=?,review=?,reviewer=?,status='reviewed' WHERE id=?",
      ).run(Number(b.score), text(b.review, 2000), u.id, row.id);
      audit("board.reviewed", "board_tasks", row.id, null, {
        score: Number(b.score),
      });
    });
    reply(200, {});
    return true;
  }
  reply(404, "Not found", "NOT_FOUND");
  return true;
}
