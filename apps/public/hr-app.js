import { mobilePage } from "/mobile.js";
import { completePage } from "/complete.js";
const root = document.querySelector("#app");
let me,
  page = "",
  directors = [],
  employees = [];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const can = (p) => me?.roles[me.role]?.some((x) => x === "*" || x === p);
const money = (v) =>
  (Number(v) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
const statuses = {
  assigned: "มอบหมายแล้ว",
  in_progress: "กำลังดำเนินการ",
  submitted: "ส่งผลงานแล้ว",
  reviewed: "ประเมินแล้ว",
  pending: "รออนุมัติ",
  draft: "ร่าง",
  approved: "อนุมัติ",
  rejected: "ไม่อนุมัติ",
  present: "ปกติ",
  late: "สาย",
  absent: "ขาดงาน",
  leave: "ลาที่อนุมัติ",
};
const labels = {
  medical: "ค่ารักษาพยาบาล",
  tuition: "การศึกษาบุตร",
  overtime: "ล่วงเวลา",
  salary: "เงินเดือน",
  bonus: "โบนัส",
  permanent: "ลูกจ้างประจำ",
  monthly: "พนักงานรายเดือน",
  temporary: "ลูกจ้างชั่วคราว",
};
async function api(path, method = "GET", body) {
  const r = await fetch("/api/v1/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = Error(j.error.message);
    e.code = j.error.code;
    throw e;
  }
  return j.data;
}
function toast(msg) {
  const t = document.querySelector("#toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4500);
}
function field(name, label, type = "text", value = "", extra = "") {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
}
function area(name, label, value = "") {
  return `<label>${esc(label)}<textarea name="${name}" maxlength="3000" required>${esc(value)}</textarea></label>`;
}
function select(name, label, options) {
  return `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>`;
}
function employeeSelect() {
  return select(
    "employee_id",
    "เจ้าหน้าที่",
    employees.map((e) => [e.id, e.code + " · " + e.name]),
  );
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${headers.length}">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>`;
}
function pill(s) {
  return `<span class="pill ${esc(s)}">${esc(statuses[s] || s)}</span>`;
}
function dialog(title, fields, submit) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form><h2>${esc(title)}</h2>${fields}<div class="error" role="alert"></div><div class="actions"><button type="button" id="cancel">ยกเลิก</button><button class="primary">บันทึก</button></div></form>`;
  document.body.append(d);
  d.querySelector("#cancel").onclick = () => d.close();
  d.onclose = () => d.remove();
  d.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".primary");
    btn.disabled = true;
    try {
      await submit(Object.fromEntries(new FormData(e.target)));
      d.close();
      await render();
      toast("บันทึกแล้ว");
    } catch (err) {
      d.querySelector(".error").textContent = err.message;
      btn.disabled = false;
    }
  };
  d.showModal();
  return d;
}
function login() {
  me = null;
  root.innerHTML = `<div class="login"><form class="card"><div class="brand">rycoop<span>HR</span></div><p>สหกรณ์ออมทรัพย์สาธารณสุขระยอง จำกัด</p><h1>เข้าสู่ระบบ</h1>${field("email", "อีเมล", "email", "pharmacisttom@gmail.com", 'autocomplete="username"')}${field("password", "รหัสผ่าน", "password", "", 'autocomplete="current-password"')}<label>รหัส Google Authenticator (หากเปิดใช้)<input name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"></label><details><summary>ใช้รหัสกู้คืน 2FA</summary><label>รหัสกู้คืน<input name="recovery_code" autocomplete="off"></label></details><button class="primary">เข้าสู่ระบบ</button><div class="error" role="alert"></div></form></div>`;
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("login", "POST", Object.fromEntries(new FormData(e.target)));
      page = "";
      await boot();
    } catch (err) {
      e.target.querySelector(".error").textContent = err.message;
    }
  };
}
async function security(view) {
  view.innerHTML = `<div class="card security"><h2>Google Authenticator · ${esc(me.email)}</h2><p>${me.totp_enabled ? "เปิดใช้ 2FA แล้ว รหัสกู้คืนใช้ได้ครั้งเดียว" : "สแกน QR ด้วย Google Authenticator แล้วกรอกรหัส 6 หลักเพื่อเปิดใช้งาน"}</p>${me.totp_enabled ? "" : `<form id="setup">${field("password", "ยืนยันรหัสผ่าน", "password")}<button class="primary">สร้าง QR สำหรับบัญชีนี้</button></form>`}<div id="factor"></div><div class="error" role="alert"></div></div>`;
  view.querySelector("#setup")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api(
        "2fa/setup",
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      e.target.remove();
      const factor = view.querySelector("#factor");
      factor.innerHTML = `<div class="qr">${data.qr_svg}</div><p>คีย์สำหรับตั้งค่าด้วยตนเอง: <code>${esc(data.secret)}</code><br>QR นี้หมดอายุใน 10 นาที เก็บเป็นความลับ</p><form>${field("code", "รหัส 6 หลัก", "text", "", 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}<button class="primary">ยืนยันและเปิดใช้ 2FA</button></form>`;
      factor.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const data = await api(
            "2fa/confirm",
            "POST",
            Object.fromEntries(new FormData(ev.target)),
          );
          me = await api("me");
          factor.innerHTML = `<h2>เปิดใช้ 2FA สำเร็จ</h2><p>เก็บรหัสกู้คืนในที่ปลอดภัย แสดงครั้งเดียว</p><pre>${data.recovery_codes.map(esc).join("\n")}</pre><button id="continue" class="primary">ฉันบันทึกรหัสแล้ว · ไปหน้าหลัก</button>`;
          factor.querySelector("#continue").onclick = () => {
            page = "";
            render().catch((e) => toast(e.message));
          };
        } catch (err) {
          view.querySelector(".error").textContent = err.message;
        }
      };
    } catch (err) {
      view.querySelector(".error").textContent = err.message;
    }
  });
}
async function render() {
  const locked = me.totp_required && !me.totp_enabled;
  const pages = locked
    ? ["ความปลอดภัย"]
    : [
        ...(can("hr.view")
          ? [
              "ภาพรวม",
              "เจ้าหน้าที่",
              "สวัสดิการ",
              "เงินเดือนและโบนัส",
              "ปรับเงินเดือน",
              "เวลาเข้าออก",
              "รายงาน HR",
            ]
          : []),
        ...(can("board.view")
          ? [
              "กรรมการ",
              "ภาพรวมกรรมการ",
              "งานและผลงานกรรมการ",
              "การประชุมกรรมการ",
            ]
          : []),
        ...(can("directory.view") ? ["โครงสร้างองค์กร"] : []),
        ...(can("attendance.self")
          ? ["เช็กอินมือถือ", "ใบลา", "สิทธิ์การลา", "สลิปของฉัน"]
          : []),
        ...(can("attendance.configure") ? ["ตั้งค่าเวลาและ GPS"] : []),
        ...(can("users.view") ? ["ผู้ใช้งาน"] : []),
        ...(can("audit.view") ? ["ประวัติการใช้งาน"] : []),
        ...(can("feedback.view") ? ["ข้อเสนอแนะ"] : []),
        "สิทธิ์และบทบาท",
        "บัญชีของฉัน",
        "ความปลอดภัย",
      ];
  if (!pages.includes(page)) page = pages[0];
  root.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand">rycoop<span>HR</span></div><div class="tagline">RAYONG COOPERATIVE</div><div class="section-label">บุคลากรและกรรมการ</div>${pages.map((p) => `<button class="nav ${p === page ? "active" : ""}" data-page="${p}">${esc(p)}</button>`).join("")}<div class="side-bottom"><span class="badge">${esc(me.mode)}</span><p>${me.mode === "production" ? "ระบบทดสอบก่อนเปิดใช้งานจริง" : "พื้นที่ทดลอง ข้อมูลการเงินจำลอง"}</p><small>พัฒนาบน Tomvis V2</small></div></aside><main><header class="topbar"><button class="mobile-menu">☰</button><div>${esc(me.workspace)}</div><div class="profile"><span>${esc(me.name)}<br><small>${esc(me.role)}</small></span><button id="logout">ออกจากระบบ</button></div></header><div class="content"><div class="eyebrow">PERSONNEL & BOARD MANAGEMENT</div><div class="heading"><div><h1>${esc(page)}</h1><p>สหกรณ์ออมทรัพย์สาธารณสุขระยอง จำกัด</p></div><div id="actions"></div></div><div id="view">กำลังโหลด…</div><footer>rycoopHR · Asia/Bangkok · ยอดเงินแสดงเป็นบาท</footer></div></main></div>`;
  root.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        render().catch((e) => toast(e.message));
      }),
  );
  root.querySelector(".mobile-menu").onclick = () =>
    root.querySelector(".sidebar").classList.toggle("visible");
  root.querySelector("#logout").onclick = async () => {
    await api("logout", "POST", {});
    login();
  };
  const view = root.querySelector("#view"),
    actions = root.querySelector("#actions");
  const add = (label, fn) => {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = label;
    b.onclick = fn;
    actions.append(b);
  };
  view.setAttribute("aria-busy", "true");
  try {
    if (page === "ความปลอดภัย") {
      await security(view);
      return;
    }
    if (await completePage(page, view, actions)) return;
    if (can("hr.view")) employees = await api("hr/employees");
    if (page === "ภาพรวม") {
      const s = await api("hr/summary");
      view.innerHTML = `<div class="stats">${[
        ["เจ้าหน้าที่ในทะเบียน", s.employees],
        ["สวัสดิการรออนุมัติ", s.pending],
        ["ยอดจ่ายที่อนุมัติ (บาท)", money(s.payroll)],
      ]
        .map(
          ([l, n]) =>
            `<div class="card"><div class="stat-label">${l}</div><div class="stat-number">${n}</div></div>`,
        )
        .join(
          "",
        )}</div><div class="notice">เจ้าหน้าที่แยกจากกรรมการ รายการการเงินต้องมีผู้จัดทำและผู้อนุมัติคนละคน ยอดนี้รวมงวดที่อนุมัติทั้งหมด</div>`;
    }
    if (page === "เจ้าหน้าที่") {
      view.innerHTML = `<div class="card">${table(
        ["รหัส", "ชื่อ", "ฝ่าย / ตำแหน่ง", "ประเภท", "เงินเดือน (บาท)"],
        employees.map((e) => [
          esc(e.code),
          esc(e.name),
          esc(e.department),
          esc(labels[e.kind]),
          money(e.salary),
        ]),
      )}</div><div class="notice">ทะเบียนใช้รหัสและเงินเดือนที่ HR ยืนยัน รายชื่อจากเว็บอยู่ในหน้าโครงสร้างองค์กร</div>`;
      if (can("hr.manage"))
        add("เพิ่มเจ้าหน้าที่", () =>
          dialog(
            "ทะเบียนเจ้าหน้าที่",
            field("code", "รหัสเจ้าหน้าที่") +
              field("name", "ชื่อ–นามสกุล") +
              field("department", "ฝ่าย / ตำแหน่ง") +
              select("kind", "ประเภท", [
                ["permanent", labels.permanent],
                ["monthly", labels.monthly],
                ["temporary", labels.temporary],
              ]) +
              field(
                "salary",
                "เงินเดือน (บาท)",
                "number",
                "0",
                'min="0" step="0.01"',
              ),
            (b) => api("hr/employees", "POST", b),
          ),
        );
    }
    if (["สวัสดิการ", "เงินเดือนและโบนัส"].includes(page)) {
      const welfare = page === "สวัสดิการ",
        resource = welfare ? "welfare" : "payroll",
        rows = await api("hr/" + resource);
      view.innerHTML = `<div class="card">${table(
        welfare
          ? ["เจ้าหน้าที่", "ประเภท", "รายละเอียด", "ยอด", "สถานะ", "พิจารณา"]
          : [
              "เจ้าหน้าที่",
              "งวด",
              "ประเภท",
              "รวม",
              "หัก",
              "สุทธิ",
              "สถานะ",
              "พิจารณา",
            ],
        rows.map((r) => [
          esc(r.name),
          ...(welfare
            ? [esc(labels[r.kind]), esc(r.detail), money(r.amount)]
            : [
                esc(r.period),
                esc(labels[r.kind]),
                money(r.gross),
                money(r.deductions),
                money(r.net),
              ]),
          pill(r.status),
          can("hr.approve") &&
          r.created_by !== me.id &&
          ["pending", "draft"].includes(r.status)
            ? `<button data-decision="${r.id}" data-status="approved">อนุมัติ</button><button data-decision="${r.id}" data-status="rejected">ไม่อนุมัติ</button>`
            : "—",
        ]),
      )}</div>`;
      view.querySelectorAll("[data-decision]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await api(
                `hr/${resource}/${b.dataset.decision}/decision`,
                "POST",
                {
                  status: b.dataset.status,
                },
              );
              await render();
            } catch (e) {
              toast(e.message);
            }
          }),
      );
      if (can("hr.manage"))
        add("สร้างรายการ", () => {
          if (!employees.length) return toast("เพิ่มเจ้าหน้าที่ก่อน");
          dialog(
            page,
            employeeSelect() +
              select(
                "kind",
                "ประเภท",
                welfare
                  ? [
                      ["medical", labels.medical],
                      ["tuition", labels.tuition],
                      ["overtime", labels.overtime],
                    ]
                  : [
                      ["salary", labels.salary],
                      ["bonus", labels.bonus],
                    ],
              ) +
              (welfare
                ? field(
                    "amount",
                    "ยอดขอเบิก (บาท)",
                    "number",
                    "",
                    'min="0.01" step="0.01"',
                  ) +
                  area(
                    "detail",
                    "รายละเอียด / บุตร / ช่วงเวลา OT และหลักฐานอ้างอิง",
                  )
                : field("period", "งวด (ค.ศ.)", "month") +
                  field(
                    "multiplier",
                    "จำนวนเท่า (โบนัส)",
                    "number",
                    "1",
                    'min="0" max="24" step="0.01"',
                  ) +
                  field(
                    "additions",
                    "รายได้เพิ่ม (เงินเดือน)",
                    "number",
                    "0",
                    'min="0" step="0.01"',
                  ) +
                  field(
                    "deductions",
                    "ยอดหักที่ได้รับอนุมัติ (บาท)",
                    "number",
                    "0",
                    'min="0" step="0.01"',
                  )),
            (b) => api("hr/" + resource, "POST", b),
          );
        });
    }
    if (page === "เวลาเข้าออก") {
      const rows = await api("hr/attendance");
      view.innerHTML = `<div class="card"><h2>นำเข้าจากเครื่องสแกน</h2><p>Excel .xlsx ไม่เกิน 1 MB / 500 แถว หัวตาราง: code, name, day, check_in, check_out<br>วันที่ YYYY-MM-DD เวลา HH:mm เวลาไทย เกณฑ์เริ่มต้น: สายหลัง 08:30</p>${can("hr.manage") ? '<label>เลือกไฟล์<input id="xlsx" type="file" accept=".xlsx"></label><button id="import" class="primary">ตรวจและนำเข้า</button><pre id="result"></pre>' : ""}${table(
        ["รหัส", "ชื่อ", "วันที่", "เข้า", "ออก", "สถานะ"],
        rows.map((r) => [
          esc(r.code),
          esc(r.name),
          esc(r.day),
          esc(r.check_in || "—"),
          esc(r.check_out || "—"),
          pill(r.status),
        ]),
      )}</div>`;
      view.querySelector("#import")?.addEventListener("click", async () => {
        const file = view.querySelector("#xlsx").files[0];
        if (!file || file.size > 1000000)
          return toast("เลือก Excel ไม่เกิน 1 MB");
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          const r = await api("hr/attendance/xlsx", "POST", {
            base64: btoa(binary),
          });
          view.querySelector("#result").textContent = JSON.stringify(
            r,
            null,
            2,
          );
          toast(
            `นำเข้าสำเร็จ ${r.accepted} แถว / ไม่ผ่าน ${r.errors.length} แถว`,
          );
        } catch (e) {
          toast(e.message);
        }
      });
    }
    if (["เช็กอินมือถือ", "ใบลา", "ตั้งค่าเวลาและ GPS"].includes(page)) {
      await mobilePage(page, view, actions);
      return;
    }
    if (page === "โครงสร้างองค์กร") {
      const d = await api("hr/directory");
      view.innerHTML = `<div class="card">${table(
        ["ชื่อ", "ตำแหน่ง", "แหล่งข้อมูล"],
        d.staff.map((s) => [
          esc(s.name),
          esc(s.position),
          s.source.startsWith("https:")
            ? "หน้าเจ้าหน้าที่สหกรณ์"
            : "ผู้ใช้แจ้งเพิ่มเติม",
        ]),
      )}</div><div class="notice">รายชื่อจากเว็บ ณ ${esc(d.sources.retrieved)} · นักคอมพิวเตอร์รอระบุชื่อ · ตำแหน่งงานแยกจากสิทธิ์ระบบ</div>`;
    }
    if (page === "กรรมการ") {
      directors = await api("hr/directors");
      view.innerHTML = `<div class="module-grid">${directors.map((d) => `<div class="card"><span class="badge">${esc(d.position)}</span><h2>${esc(d.name)}</h2><p>วาระ ${esc(d.term_start || "รอยืนยัน")} – ${esc(d.term_end || "รอยืนยัน")}</p><p>${d.committees.map((c) => esc(c.committee + " · " + c.position)).join("<br>")}</p><p>${esc(d.duties)}</p><div class="actions"><button data-person="${d.id}">หน้ารายบุคคล</button></div></div>`).join("")}</div><div class="notice">ชุดที่ 38 ตามเว็บสหกรณ์ หน้าที่เริ่มต้นเป็นข้อเสนอ รอสหกรณ์รับรอง</div>`;
      view
        .querySelectorAll("[data-person]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              profile(
                directors.find((d) => d.id === Number(b.dataset.person)),
              ).catch((e) => toast(e.message))),
        );
    }
    if (page === "งานและผลงานกรรมการ") {
      directors = await api("hr/directors");
      const tasks = await api("hr/tasks");
      view.innerHTML = `<div class="card">${table(
        [
          "กรรมการ",
          "งาน / ตัวชี้วัด",
          "กำหนดส่ง",
          "ผลงาน",
          "สถานะ",
          "ผลประเมิน",
          "ดำเนินการ",
        ],
        tasks.map((t) => [
          esc(t.name),
          `<strong>${esc(t.title)}</strong><br>${esc(t.indicator)}`,
          esc(t.due_date),
          esc(t.outcome),
          pill(t.status),
          t.score == null ? "—" : `${t.score}/100 · ${esc(t.review)}`,
          `<button data-task="${t.id}">ดูรายละเอียด</button>`,
        ]),
      )}</div>`;
      view
        .querySelectorAll("[data-task]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              taskDialog(tasks.find((t) => t.id === Number(b.dataset.task)))),
        );
      if (can("board.assign"))
        add("มอบหมายงาน", () =>
          dialog(
            "มอบหมายงานกรรมการ",
            select(
              "director_id",
              "กรรมการ",
              directors.map((d) => [d.id, d.name]),
            ) +
              field("title", "งาน / โครงการ") +
              area("indicator", "ตัวชี้วัดและเป้าหมาย") +
              field("due_date", "กำหนดส่ง", "date"),
            (b) => api("hr/tasks", "POST", b),
          ),
        );
    }
    if (page === "ผู้ใช้งาน") {
      const users = await api("users");
      view.innerHTML = `<div class="card">${table(
        ["ชื่อ", "อีเมล", "สิทธิ์", "สถานะ"],
        users.map((u) => [
          esc(u.name),
          esc(u.email),
          esc(u.role),
          u.disabled ? "ปิดใช้งาน" : "เปิดใช้งาน",
        ]),
      )}</div>`;
      if (can("users.manage"))
        add("เพิ่มบัญชีเจ้าหน้าที่", () =>
          dialog(
            "บัญชีเจ้าหน้าที่",
            field("name", "ชื่อ–นามสกุล") +
              field("email", "อีเมล", "email") +
              field(
                "password",
                "รหัสผ่านเริ่มต้น 12 ตัวขึ้นไป",
                "password",
                "",
                'minlength="12" autocomplete="new-password"',
              ) +
              (can("hr.manage")
                ? select("employee_id", "ผูกทะเบียนเจ้าหน้าที่", [
                    ["", "ยังไม่ผูก"],
                    ...employees.map((e) => [e.id, e.code + " · " + e.name]),
                  ])
                : "") +
              select(
                "role",
                "สิทธิ์",
                (["admin", "super_admin"].includes(me.role)
                  ? ["staff", "hr_officer", "manager", "it_admin", "viewer"]
                  : ["staff", "viewer"]
                ).map((r) => [r, r]),
              ),
            (b) => api("hr/accounts", "POST", b),
          ),
        );
    }
    if (page === "ประวัติการใช้งาน") {
      const logs = await api("audit");
      view.innerHTML = `<div class="card">${table(
        ["การกระทำ", "ผู้ใช้", "ข้อมูล", "เวลา (UTC)"],
        logs.map((l) => [
          esc(l.action),
          esc(l.actor),
          esc(l.resource),
          esc(l.timestamp),
        ]),
      )}</div>`;
    }
    if (page === "สิทธิ์และบทบาท") {
      const permissions = [...new Set(Object.values(me.roles).flat())].filter(
        (p) => p !== "*",
      );
      view.innerHTML = `<div class="card permission">${table(
        ["สิทธิ์", ...Object.keys(me.roles)],
        permissions.map((p) => [
          esc(p),
          ...Object.values(me.roles).map((list) =>
            list.includes("*") || list.includes(p) ? "✓" : "—",
          ),
        ]),
      )}</div><div class="notice">กรรมการเห็นงานตนเอง ประธานดูและประเมินกรรมการ IT ไม่มีสิทธิ์เงินเดือน HR จัดทำรายการ ผู้จัดการอนุมัติรายการที่ตนไม่ได้จัดทำ</div>`;
    }
  } catch (e) {
    view.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    throw e;
  } finally {
    view.setAttribute("aria-busy", "false");
  }
}
async function profile(d) {
  history.replaceState(null, "", `#director/${d.id}`);
  const tasks = (await api("hr/tasks")).filter((t) => t.director_id === d.id);
  const modal = document.createElement("dialog");
  modal.className = "wide-dialog";
  modal.innerHTML = `<h2>${esc(d.name)}</h2><p>${esc(d.position)} · วาระ ${esc(d.term_start || "รอยืนยัน")} – ${esc(d.term_end || "รอยืนยัน")}</p><p>${esc(d.duties)}</p>${table(
    ["งาน", "ตัวชี้วัด", "สถานะ", "คะแนน"],
    tasks.map((t) => [
      esc(t.title),
      esc(t.indicator),
      pill(t.status),
      t.score ?? "—",
    ]),
  )}<div class="actions"><button id="close">ปิด</button>${can("board.manage") ? '<button id="edit">กำหนดหน้าที่ / วาระ</button>' : ""}${can("board.manage") && !d.user_id ? '<button id="activate" class="primary">เปิดบัญชีเข้าสู่ระบบ</button>' : ""}</div>`;
  document.body.append(modal);
  modal.onclose = () => {
    modal.remove();
    history.replaceState(null, "", location.pathname);
  };
  modal.querySelector("#close").onclick = () => modal.close();
  modal.querySelector("#edit")?.addEventListener("click", () => {
    modal.close();
    dialog(
      "หน้าที่รายบุคคล",
      field("term_start", "เริ่มวาระ", "date", d.term_start) +
        field("term_end", "สิ้นสุดวาระ", "date", d.term_end) +
        area("duties", "หน้าที่ที่รับรอง", d.duties),
      (b) => api("hr/directors/" + d.id, "PATCH", b),
    );
  });
  modal.querySelector("#activate")?.addEventListener("click", () => {
    modal.close();
    dialog(
      "เปิดบัญชีกรรมการ",
      field("name", "ชื่อ–นามสกุล", "text", d.name) +
        field("position", "ตำแหน่ง", "text", d.position) +
        field("email", "อีเมลที่ยืนยันแล้ว", "email") +
        field(
          "password",
          "รหัสผ่าน 12 ตัวขึ้นไป",
          "password",
          "",
          'minlength="12" autocomplete="new-password"',
        ) +
        select("role", "สิทธิ์", [
          ["director", "กรรมการ (งานตนเอง)"],
          ["chair", "ประธาน (มอบหมาย / ประเมิน)"],
        ]) +
        field("term_start", "เริ่มวาระ", "date", d.term_start) +
        field("term_end", "สิ้นสุดวาระ", "date", d.term_end) +
        area("duties", "หน้าที่ที่รับรอง", d.duties),
      (b) => api("hr/directors", "POST", { ...b, profile_id: d.id }),
    );
  });
  modal.showModal();
}
function taskDialog(t) {
  const director = directors.find((d) => d.id === t.director_id);
  if (director?.user_id === me.id && t.status !== "reviewed")
    return dialog(
      t.title,
      area("outcome", "ผลงาน / หลักฐานอ้างอิง", t.outcome) +
        select("status", "สถานะ", [
          ["in_progress", "กำลังดำเนินการ"],
          ["submitted", "ส่งประเมิน"],
        ]),
      (b) => api("hr/tasks/" + t.id, "PATCH", b),
    );
  if (
    can("board.review") &&
    director?.user_id !== me.id &&
    t.status === "submitted"
  )
    return dialog(
      "ประเมิน: " + t.title,
      `<p>${esc(t.indicator)}<br>${esc(t.outcome)}</p>` +
        field(
          "score",
          "คะแนน 0-100",
          "number",
          "",
          'min="0" max="100" step="1"',
        ) +
        area("review", "ข้อประเมิน"),
      (b) => api(`hr/tasks/${t.id}/review`, "POST", b),
    );
  toast(`${t.title}: ${t.outcome || "ยังไม่บันทึกผลงาน"} ${t.review || ""}`);
}
async function boot() {
  try {
    me = await api("me");
    const deepLink = location.hash.match(/^#director\/(\d+)$/);
    if (deepLink && can("board.view")) page = "กรรมการ";
    await render();
    if (deepLink && can("board.view")) {
      const director = directors.find((d) => d.id === Number(deepLink[1]));
      if (director) await profile(director);
    }
  } catch (e) {
    if (e.code === "HTTP_401") login();
    else {
      root.innerHTML =
        '<div class="login"><div class="card"><h1>โหลดระบบไม่ได้</h1><p id="error"></p><button id="retry">ลองใหม่</button></div></div>';
      root.querySelector("#error").textContent = e.message;
      root.querySelector("#retry").onclick = boot;
    }
  }
}
boot();
export {
  api,
  can,
  esc,
  field,
  area,
  select,
  table,
  pill,
  dialog,
  toast,
  render,
  me,
};
