import {
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
} from "/app.js";
import { leavePages } from "/leave-ui.js";
const baht = (v) =>
  (Number(v) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const month = () =>
  new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" })
    .slice(0, 7);
const kinds = {
  medical: "ค่ารักษาพยาบาล",
  tuition: "การศึกษาบุตร",
  overtime: "ล่วงเวลา",
  salary: "เงินเดือน",
  bonus: "โบนัส",
  permanent: "ลูกจ้างประจำ",
  monthly: "พนักงานรายเดือน",
  temporary: "ลูกจ้างชั่วคราว",
  child: "บุตร",
  family: "ครอบครัว",
  education: "การศึกษา",
  training: "อบรม",
};
const recordFields = {
  child: [
    ["name", "ชื่อบุตร"],
    ["birth_day", "วันเกิด", "date"],
    ["school", "สถานศึกษา"],
    ["level", "ระดับการศึกษา"],
  ],
  family: [
    ["name", "ชื่อสมาชิกครอบครัว"],
    ["relationship", "ความสัมพันธ์"],
    ["phone", "โทรศัพท์"],
  ],
  education: [
    ["institution", "สถานศึกษา"],
    ["degree", "วุฒิการศึกษา"],
    ["major", "สาขา"],
    ["year", "ปีที่สำเร็จ (พ.ศ.)"],
  ],
  training: [
    ["title", "หลักสูตร"],
    ["provider", "หน่วยงาน"],
    ["start_day", "เริ่มอบรม", "date"],
    ["end_day", "สิ้นสุด", "date"],
    ["result", "ผลการอบรม"],
  ],
};
const optional = (name, label, type = "text", value = "") =>
  `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
function action(parent, label, fn, primary = false) {
  const b = document.createElement("button");
  b.textContent = label;
  if (primary) b.className = "primary";
  b.onclick = () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => toast(e.message));
  parent.append(b);
  return b;
}
function popup(title, html) {
  const d = document.createElement("dialog");
  d.className = "wide-dialog";
  d.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2><button data-close>ปิด</button></div>${html}`;
  document.body.append(d);
  d.querySelector("[data-close]").onclick = () => d.close();
  d.onclose = () => d.remove();
  d.showModal();
  return d;
}
function download(name, mime, content) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([content], { type: mime }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(name, headers, rows) {
  const safe = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  download(
    name,
    "text/csv;charset=utf-8",
    "\ufeff" +
      [headers, ...rows].map((r) => r.map(safe).join(",")).join("\r\n"),
  );
}
function printDocument(title, html) {
  document.querySelector("#print-root")?.remove();
  const el = document.createElement("section");
  el.id = "print-root";
  el.innerHTML = `<h1>${esc(title)}</h1><p>สหกรณ์ออมทรัพย์สาธารณสุขระยอง จำกัด</p>${html}`;
  document.body.append(el);
  window.addEventListener("afterprint", () => el.remove(), { once: true });
  window.print();
}
function list(
  host,
  headers,
  rows,
  columns,
  { filter = null, onRow = null } = {},
) {
  host.innerHTML = `<div class="toolbar"><input data-search placeholder="ค้นหาชื่อ รหัส หรือรายละเอียด…" aria-label="ค้นหารายการ">${filter ? `<select data-filter aria-label="กรองสถานะ"><option value="">ทุกสถานะ</option>${filter.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>` : ""}<span class="list-count"></span></div><div data-table></div>`;
  const draw = () => {
    const q = host.querySelector("[data-search]").value.toLowerCase(),
      f = host.querySelector("[data-filter]")?.value;
    const filtered = rows.filter(
      (r) =>
        (!q || JSON.stringify(r).toLowerCase().includes(q)) &&
        (!f || r.status === f),
    );
    host.querySelector(".list-count").textContent = `${filtered.length} รายการ`;
    host.querySelector("[data-table]").innerHTML = table(
      headers,
      filtered.map(columns),
    );
    if (onRow)
      host
        .querySelectorAll("[data-id]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              Promise.resolve(
                onRow(rows.find((r) => String(r.id) === b.dataset.id)),
              ).catch((e) => toast(e.message))),
        );
  };
  host.querySelector("[data-search]").oninput = draw;
  host.querySelector("[data-filter]")?.addEventListener("change", draw);
  draw();
}
async function files(host, resource, id, write = false) {
  const rows = await api(
    `hr/attachments?resource=${encodeURIComponent(resource)}&id=${id}`,
  );
  const cells = rows.map((r) => [
    esc(r.name),
    `${Math.round(r.size / 1024)} KB`,
    esc(r.created_at),
    `<button data-download="${r.id}">ดาวน์โหลด</button>${write ? `<button data-delete-file="${r.id}">ลบ</button>` : ""}`,
  ]);
  host.innerHTML = `<h3>เอกสารแนบ</h3>${table(["ชื่อไฟล์", "ขนาด", "แนบเมื่อ", "จัดการ"], cells)}${write ? '<div class="toolbar"><input type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="เอกสารแนบ"><button data-upload>แนบ PDF / JPG / PNG</button></div><p>ไม่เกิน 1 MB ต่อไฟล์ สูงสุด 20 ไฟล์</p>' : ""}`;
  host.querySelectorAll("[data-download]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const f = await api("hr/attachments/" + b.dataset.download);
          download(
            f.name,
            f.mime,
            Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
          );
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  host.querySelectorAll("[data-delete-file]").forEach(
    (b) =>
      (b.onclick = () =>
        dialog(
          "ลบเอกสารแนบ",
          "<p>ยืนยันการลบไฟล์นี้ออกจากรายการ</p>",
          async () => {
            await api("hr/attachments/" + b.dataset.deleteFile, "DELETE");
            await files(host, resource, id, write);
          },
        )),
  );
  host.querySelector("[data-upload]")?.addEventListener("click", async () => {
    try {
      const f = host.querySelector("input[type=file]").files[0];
      if (!f || f.size > 1000000) throw Error("เลือกไฟล์ขนาดไม่เกิน 1 MB");
      const bytes = new Uint8Array(await f.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await api("hr/attachments", "POST", {
        resource,
        resource_id: id,
        name: f.name,
        base64: btoa(binary),
      });
      await files(host, resource, id, write);
      toast("แนบเอกสารแล้ว");
    } catch (e) {
      toast(e.message);
    }
  });
}
function stats(items) {
  return `<div class="stats">${items.map(([label, value, note]) => `<div class="card"><div class="stat-label">${esc(label)}</div><div class="stat-number">${esc(value)}</div><div class="stat-note">${esc(note || "")}</div></div>`).join("")}</div>`;
}
async function employeeDetail(e) {
  const d = await api("hr/employees/" + e.id);
  const modal = popup(
    d.name,
    `<div class="profile-banner"><span class="avatar">${esc(d.name.slice(0, 1))}</span><div><strong>${esc(d.code)} · ${esc(d.department)}</strong><p>${esc(kinds[d.kind])} · ${d.active ? "ปฏิบัติงาน" : "สิ้นสุด/พักการจ้าง"} · เงินเดือน ${baht(d.salary)} บาท</p></div></div><div class="detail-grid"><div><h3>ข้อมูลการจ้าง</h3><p>เริ่มงาน ${esc(d.start_date || "รอระบุ")} · สิ้นสุด ${esc(d.end_date || "—")}</p><p>โทรศัพท์ ${esc(d.profile.phone || "—")}<br>อีเมล ${esc(d.profile.email || "—")}<br>ที่อยู่ ${esc(d.profile.address || "—")}<br>ผู้ติดต่อฉุกเฉิน ${esc(d.profile.emergency_contact || "—")}</p></div><div><h3>ข้อมูลรับเงิน</h3><p>${esc(d.profile.bank_name || "ยังไม่ระบุธนาคาร")}<br>บัญชี ${esc(d.profile.bank_account || "—")}</p></div></div><div class="actions" data-edit></div><div class="tabs" data-tabs></div><div data-records></div><div data-files></div><h3>ประวัติปรับเงินเดือน</h3>${table(
      ["มีผล", "อัตรา", "เดิม", "ใหม่", "สถานะ"],
      d.salary_history.map((r) => [
        esc(r.effective_day),
        `${r.percent}%`,
        baht(r.old_salary),
        baht(r.new_salary),
        pill(r.status),
      ]),
    )}`,
  );
  if (can("hr.manage"))
    action(modal.querySelector("[data-edit]"), "แก้ไขข้อมูลเจ้าหน้าที่", () => {
      modal.close();
      dialog(
        "แก้ไขทะเบียน",
        field("code", "รหัส", "text", d.code) +
          field("name", "ชื่อ–นามสกุล", "text", d.name) +
          field("department", "ฝ่าย / ตำแหน่ง", "text", d.department) +
          select("kind", "ประเภท", [
            [d.kind, kinds[d.kind]],
            ...Object.entries(kinds).filter(
              ([k]) =>
                ["permanent", "monthly", "temporary"].includes(k) &&
                k !== d.kind,
            ),
          ]) +
          select("active", "สถานะ", [
            [d.active, d.active ? "ปฏิบัติงาน" : "สิ้นสุด/พักการจ้าง"],
            [1 - d.active, d.active ? "สิ้นสุด/พักการจ้าง" : "ปฏิบัติงาน"],
          ]) +
          optional("start_date", "วันที่เริ่มงาน", "date", d.start_date) +
          optional("end_date", "วันสิ้นสุด", "date", d.end_date) +
          [
            "phone",
            "email",
            "address",
            "bank_name",
            "bank_account",
            "emergency_contact",
          ]
            .map((k, i) =>
              optional(
                k,
                [
                  "โทรศัพท์",
                  "อีเมล",
                  "ที่อยู่",
                  "ธนาคาร",
                  "เลขบัญชีรับเงิน",
                  "ผู้ติดต่อฉุกเฉิน",
                ][i],
                "text",
                d.profile[k] || "",
              ),
            )
            .join(""),
        async (b) => {
          const profile = {};
          for (const k of [
            "phone",
            "email",
            "address",
            "bank_name",
            "bank_account",
            "emergency_contact",
          ])
            profile[k] = b[k];
          await api("hr/employees/" + d.id, "PATCH", {
            ...b,
            active: Number(b.active),
            profile,
          });
        },
      );
    });
  let kind = "child";
  const show = () => {
    const host = modal.querySelector("[data-records]"),
      rows = d.records.filter((r) => r.kind === kind);
    host.innerHTML = `<h3>ประวัติ${kinds[kind]}</h3>${table(
      [...recordFields[kind].map((x) => x[1]), "จัดการ"],
      rows.map((r) => [
        ...recordFields[kind].map(([k]) => esc(r.data[k])),
        can("hr.manage") ? `<button data-record="${r.id}">แก้ไข</button>` : "—",
      ]),
    )}<div class="actions" data-add-record></div>`;
    const edit = (r) => {
      const activeKind = kind;
      dialog(
        (r ? "แก้ไข" : "เพิ่ม") + "ข้อมูล" + kinds[activeKind],
        recordFields[activeKind]
          .map(([k, l, t]) =>
            ["name", "institution", "title"].includes(k)
              ? field(k, l, t || "text", r?.data[k] || "")
              : optional(k, l, t || "text", r?.data[k] || ""),
          )
          .join(""),
        async (data) => {
          if (r) await api("hr/records/" + r.id, "PATCH", { data });
          else
            await api(`hr/employees/${d.id}/records`, "POST", {
              kind: activeKind,
              data,
            });
          modal.close();
          await employeeDetail(d);
        },
      );
    };
    host
      .querySelectorAll("[data-record]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            edit(rows.find((r) => String(r.id) === b.dataset.record))),
      );
    if (can("hr.manage"))
      action(host.querySelector("[data-add-record]"), "เพิ่มข้อมูล", () =>
        edit(null),
      );
    modal
      .querySelectorAll("[data-tabs] button")
      .forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  };
  for (const k of Object.keys(recordFields)) {
    const b = action(modal.querySelector("[data-tabs]"), kinds[k], () => {
      kind = k;
      show();
    });
    b.dataset.kind = k;
  }
  show();
  await files(
    modal.querySelector("[data-files]"),
    "employee",
    d.id,
    can("hr.manage"),
  );
}
async function slip(r) {
  const d = await api("hr/payroll/" + r.id),
    html = `<p><strong>${esc(d.code)} · ${esc(d.name)}</strong></p><p>งวด ${esc(d.period)} · ${esc(kinds[d.kind])} · ${pill(d.status)}</p>${table(
      ["รายการ", "จำนวนเงิน (บาท)"],
      [
        ["รายได้รวม", baht(d.gross)],
        ["ยอดหัก", baht(d.deductions)],
        ["รับสุทธิ", `<strong>${baht(d.net)}</strong>`],
      ],
    )}<p>สลิปนี้แสดงข้อมูลตามรายการในระบบ ${d.status === "approved" ? "อนุมัติแล้ว" : "ยังไม่อนุมัติ"}</p>`;
  const modal = popup(
    "สลิปเงินเดือน / โบนัส",
    html + '<div class="actions" data-print></div><div data-files></div>',
  );
  action(modal.querySelector("[data-print]"), "พิมพ์ / บันทึก PDF", () =>
    printDocument("สลิปเงินเดือน / โบนัส", html),
  );
  await files(
    modal.querySelector("[data-files]"),
    "payroll",
    d.id,
    can("hr.manage") && d.status !== "approved",
  );
}
async function transactionDetail(r, resource) {
  const welfare = resource === "welfare",
    html = `<p><strong>${esc(r.code)} · ${esc(r.name)}</strong></p><p>${esc(kinds[r.kind])} · ${pill(r.status)}</p>${welfare ? `<p>${esc(r.detail)}</p><h3>${baht(r.amount)} บาท</h3>` : `<p>งวด ${esc(r.period)}</p>${table(["รวม", "หัก", "สุทธิ"], [[baht(r.gross), baht(r.deductions), baht(r.net)]])}`}`;
  const modal = popup(
    welfare ? "รายละเอียดสวัสดิการ" : "รายละเอียดเงินเดือน",
    html + '<div class="actions" data-actions></div><div data-files></div>',
  );
  const actions = modal.querySelector("[data-actions]");
  if (
    can("hr.approve") &&
    r.created_by !== me.id &&
    ["pending", "draft"].includes(r.status)
  ) {
    for (const [status, label] of [
      ["approved", "อนุมัติ"],
      ["rejected", "ไม่อนุมัติ"],
    ])
      action(actions, label, async () => {
        await api(`hr/${resource}/${r.id}/decision`, "POST", { status });
        modal.close();
        await render();
      });
  }
  if (
    can("hr.manage") &&
    r.created_by === me.id &&
    ["pending", "draft"].includes(r.status)
  )
    action(actions, "ยกเลิกรายการ", () =>
      dialog("ยกเลิกรายการ", "<p>ยืนยันยกเลิกรายการนี้</p>", async () => {
        await api(`hr/${resource}/${r.id}/cancel`, "POST", {});
        modal.close();
      }),
    );
  action(actions, "พิมพ์", () =>
    printDocument(welfare ? "ใบขอเบิกสวัสดิการ" : "รายการเงินเดือน", html),
  );
  await files(
    modal.querySelector("[data-files]"),
    resource,
    r.id,
    can("hr.manage") && r.status !== "approved",
  );
}
export async function completePage(page, view, actions) {
  if (["ใบลา", "สิทธิ์การลา"].includes(page))
    return leavePages(page, view, actions);
  const pages = [
    "ภาพรวม",
    "เจ้าหน้าที่",
    "สวัสดิการ",
    "เงินเดือนและโบนัส",
    "ปรับเงินเดือน",
    "รายงาน HR",
    "ภาพรวมกรรมการ",
    "การประชุมกรรมการ",
    "งานและผลงานกรรมการ",
    "ผู้ใช้งาน",
    "โครงสร้างองค์กร",
    "สลิปของฉัน",
    "บัญชีของฉัน",
    "ข้อเสนอแนะ",
  ];
  if (!pages.includes(page)) return false;
  if (page === "ภาพรวม") {
    const [summary, report] = await Promise.all([
      api("hr/summary"),
      api("hr/reports?period=" + month()),
    ]);
    const counts = (s) =>
        report.attendance
          .filter((r) => r.status === s)
          .reduce((n, r) => n + r.count, 0),
      payments = report.payments.filter((r) => r.status === "approved");
    view.innerHTML =
      stats([
        ["เจ้าหน้าที่ปฏิบัติงาน", summary.employees, "ทะเบียนที่ HR รับรอง"],
        ["สวัสดิการรออนุมัติ", summary.pending, "รอผู้มีสิทธิ์พิจารณา"],
        [
          "จ่ายสุทธิเดือนนี้",
          baht(payments.reduce((n, r) => n + r.net, 0)),
          "บาท · " + report.period,
        ],
      ]) +
      `<div class="grid"><div class="card"><h2>เวลาเข้า–ออกเดือนนี้</h2><div class="metric-grid">${[
        ["ปกติ", counts("present")],
        ["สาย", counts("late")],
        ["ลา", counts("leave")],
        ["ขาด", counts("absent")],
      ]
        .map(
          ([l, n]) =>
            `<div><strong>${n}</strong><span>${l} (คน-วัน)</span></div>`,
        )
        .join(
          "",
        )}</div><p>ขาดงานแสดงหลัง HR ประมวลผลวันที่ผ่านมา</p></div><div class="card"><h2>ขั้นตอนเริ่มใช้งาน</h2><ol class="checklist"><li>ลงทะเบียนเจ้าหน้าที่และผูกบัญชี</li><li>ตั้งพิกัด GPS วันทำงานและวันหยุด</li><li>จัดทำรายการและให้คนละคนอนุมัติ</li></ol></div></div><div class="card table-card"><h2>เงินเดือนล่าสุดของเดือน</h2>${table(
        ["รหัส", "ชื่อ", "ประเภท", "สุทธิ", "สถานะ"],
        report.payments
          .slice(0, 8)
          .map((r) => [
            esc(r.code),
            esc(r.name),
            esc(kinds[r.kind]),
            baht(r.net),
            pill(r.status),
          ]),
      )}</div>`;
    return true;
  }
  if (page === "เจ้าหน้าที่") {
    const rows = await api("hr/employees");
    view.innerHTML =
      stats([
        ["ทะเบียนทั้งหมด", rows.length],
        ["ปฏิบัติงาน", rows.filter((e) => e.active).length],
        ["สิ้นสุด/พักการจ้าง", rows.filter((e) => !e.active).length],
      ]) + '<div class="card table-card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      [
        "รหัส",
        "ชื่อ",
        "ฝ่าย / ตำแหน่ง",
        "ประเภท",
        "เงินเดือน",
        "สถานะ",
        "รายละเอียด",
      ],
      rows,
      (r) => [
        esc(r.code),
        esc(r.name),
        esc(r.department),
        esc(kinds[r.kind]),
        baht(r.salary),
        r.active ? "ปฏิบัติงาน" : "สิ้นสุด/พักการจ้าง",
        `<button data-id="${r.id}">เปิดประวัติ</button>`,
      ],
      { onRow: employeeDetail },
    );
    if (can("hr.manage"))
      action(
        actions,
        "เพิ่มเจ้าหน้าที่",
        () =>
          dialog(
            "ทะเบียนเจ้าหน้าที่",
            field("code", "รหัสเจ้าหน้าที่") +
              field("name", "ชื่อ–นามสกุล") +
              field("department", "ฝ่าย / ตำแหน่ง") +
              select("kind", "ประเภท", [
                ["permanent", kinds.permanent],
                ["monthly", kinds.monthly],
                ["temporary", kinds.temporary],
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
        true,
      );
    return true;
  }
  if (["สวัสดิการ", "เงินเดือนและโบนัส"].includes(page)) {
    const resource = page === "สวัสดิการ" ? "welfare" : "payroll",
      welfare = resource === "welfare";
    const [rows, employees] = await Promise.all([
      api("hr/" + resource),
      api("hr/employees"),
    ]);
    view.innerHTML =
      stats([
        ["ทั้งหมด", rows.length],
        [
          "รอพิจารณา",
          rows.filter((r) => ["pending", "draft"].includes(r.status)).length,
        ],
        ["อนุมัติแล้ว", rows.filter((r) => r.status === "approved").length],
      ]) + '<div class="card table-card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      welfare
        ? ["รหัส", "เจ้าหน้าที่", "ประเภท", "ยอด", "สถานะ", "รายละเอียด"]
        : [
            "งวด",
            "รหัส",
            "เจ้าหน้าที่",
            "ประเภท",
            "สุทธิ",
            "สถานะ",
            "รายละเอียด",
          ],
      rows,
      (r) => [
        ...(welfare
          ? [esc(r.code), esc(r.name), esc(kinds[r.kind]), baht(r.amount)]
          : [
              esc(r.period),
              esc(r.code),
              esc(r.name),
              esc(kinds[r.kind]),
              baht(r.net),
            ]),
        pill(r.status),
        `<button data-id="${r.id}">ตรวจรายการ</button>`,
      ],
      {
        filter: ["pending", "draft", "approved", "rejected", "cancelled"],
        onRow: (r) => transactionDetail(r, resource),
      },
    );
    if (can("hr.manage")) {
      action(
        actions,
        "สร้างรายการ",
        () => {
          if (!employees.some((e) => e.active))
            return toast("เพิ่มเจ้าหน้าที่ก่อน");
          dialog(
            page,
            select(
              "employee_id",
              "เจ้าหน้าที่",
              employees
                .filter((e) => e.active)
                .map((e) => [e.id, e.code + " · " + e.name]),
            ) +
              select(
                "kind",
                "ประเภท",
                welfare
                  ? [
                      ["medical", kinds.medical],
                      ["tuition", kinds.tuition],
                      ["overtime", kinds.overtime],
                    ]
                  : [
                      ["salary", kinds.salary],
                      ["bonus", kinds.bonus],
                    ],
              ) +
              (welfare
                ? field(
                    "amount",
                    "ยอดขอเบิก (บาท)",
                    "number",
                    "",
                    'min="0.01" step="0.01"',
                  ) + area("detail", "รายละเอียด / บุตร / ช่วงเวลา OT")
                : field("period", "งวด", "month", month()) +
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
                    "ยอดหัก (บาท)",
                    "number",
                    "0",
                    'min="0" step="0.01"',
                  )),
            (b) => api("hr/" + resource, "POST", b),
          );
        },
        true,
      );
      if (!welfare)
        action(actions, "สร้างเงินเดือนทั้งงวด", () =>
          dialog(
            "สร้างร่างเงินเดือนทุกคน",
            `<p>สร้างจากอัตราเงินเดือนปัจจุบันของเจ้าหน้าที่ปฏิบัติงาน ${employees.filter((e) => e.active).length} คน ยอดหักเริ่มต้น 0 บาท ยังไม่ผ่านอนุมัติ</p>` +
              field("period", "งวด", "month", month()),
            (b) => api("hr/payroll/bulk", "POST", b),
          ),
        );
    }
    return true;
  }
  if (page === "ปรับเงินเดือน") {
    const [rows, employees] = await Promise.all([
      api("hr/salary-adjustments"),
      api("hr/employees"),
    ]);
    view.innerHTML =
      '<div class="card" data-list></div><div class="notice">อัตราใหม่ = อัตราเดิม × (1 + % / 100) ต้องอนุมัติโดยคนละคนและถึงวันมีผล ก่อนเปลี่ยนฐานเงินเดือน</div>';
    list(
      view.querySelector("[data-list]"),
      ["เจ้าหน้าที่", "เดิม", "เปลี่ยน %", "ใหม่", "มีผล", "สถานะ", "พิจารณา"],
      rows,
      (r) => [
        esc(r.name),
        baht(r.old_salary),
        `${r.percent}%`,
        baht(r.new_salary),
        esc(r.effective_day),
        pill(r.status),
        `<button data-id="${r.id}">ดูคำขอ</button>`,
      ],
      {
        filter: ["pending", "approved", "rejected"],
        onRow: (r) => {
          const m = popup(
            "คำขอปรับเงินเดือน",
            `<p>${esc(r.name)} · ${esc(r.reason)}</p><h3>${baht(r.old_salary)} → ${baht(r.new_salary)} บาท</h3><p>มีผล ${esc(r.effective_day)} · ${pill(r.status)}</p><div class="actions"></div>`,
          );
          if (
            can("hr.approve") &&
            r.created_by !== me.id &&
            r.status === "pending"
          )
            for (const [status, label] of [
              ["approved", "อนุมัติ"],
              ["rejected", "ไม่อนุมัติ"],
            ])
              action(m.querySelector(".actions"), label, async () => {
                await api(`hr/salary-adjustments/${r.id}/decision`, "POST", {
                  status,
                });
                m.close();
                await render();
              });
        },
      },
    );
    if (can("hr.manage"))
      action(
        actions,
        "ขอปรับเงินเดือน",
        () =>
          dialog(
            "ปรับเงินเดือน",
            select(
              "employee_id",
              "เจ้าหน้าที่",
              employees
                .filter((e) => e.active)
                .map((e) => [e.id, e.name + " · " + baht(e.salary)]),
            ) +
              field(
                "percent",
                "อัตราเปลี่ยน (%)",
                "number",
                "0",
                'min="-100" max="100" step="0.01"',
              ) +
              field("effective_day", "วันมีผล", "date", today()) +
              area("reason", "เหตุผล / มติอ้างอิง"),
            (b) => api("hr/salary-adjustments", "POST", b),
          ),
        true,
      );
    return true;
  }
  if (page === "รายงาน HR") {
    view.innerHTML = `<div class="toolbar"><label>งวดรายงาน<input type="month" value="${month()}" data-period></label><button data-load>แสดงรายงาน</button><button data-csv>ส่งออก CSV</button><button data-print>พิมพ์ / PDF</button></div><div data-report></div>`;
    let report;
    const load = async () => {
      report = await api(
        "hr/reports?period=" + view.querySelector("[data-period]").value,
      );
      const host = view.querySelector("[data-report]");
      host.innerHTML =
        stats([
          [
            "รับสุทธิที่อนุมัติ",
            baht(
              report.payments
                .filter((r) => r.status === "approved")
                .reduce((n, r) => n + r.net, 0),
            ),
          ],
          ["รายการเงินเดือน / โบนัส", report.payments.length],
          [
            "บันทึกเวลา (คน-วัน)",
            report.attendance.reduce((n, r) => n + r.count, 0),
          ],
        ]) +
        `<div class="card table-card"><h2>ขาด–ลา–มาสาย ${esc(report.period)}</h2>${table(
          ["รหัส", "เจ้าหน้าที่", "ฝ่าย", "ปกติ", "สาย", "ลา", "ขาด"],
          report.employees.map((e) => [
            esc(e.code),
            esc(e.name),
            esc(e.department),
            ...["present", "late", "leave", "absent"].map(
              (s) =>
                report.attendance.find(
                  (r) => r.employee_id === e.id && r.status === s,
                )?.count || 0,
            ),
          ]),
        )}</div><div class="card table-card"><h2>เงินเดือน / โบนัส</h2>${table(
          ["รหัส", "ชื่อ", "ประเภท", "รวม", "หัก", "สุทธิ", "สถานะ"],
          report.payments.map((r) => [
            esc(r.code),
            esc(r.name),
            esc(kinds[r.kind]),
            baht(r.gross),
            baht(r.deductions),
            baht(r.net),
            pill(r.status),
          ]),
        )}</div><div class="card table-card"><h2>สวัสดิการตามเดือนที่สร้าง</h2>${table(
          ["ประเภท", "สถานะ", "รายการ", "ยอด (บาท)"],
          report.welfare.map((r) => [
            esc(kinds[r.kind]),
            pill(r.status),
            r.count,
            baht(r.amount),
          ]),
        )}</div>`;
    };
    view.querySelector("[data-load]").onclick = () =>
      load().catch((e) => toast(e.message));
    view.querySelector("[data-print]").onclick = () =>
      printDocument(
        "รายงาน HR งวด " + report.period,
        view.querySelector("[data-report]").innerHTML,
      );
    view.querySelector("[data-csv]").onclick = () =>
      csv(
        "payroll-" + report.period + ".csv",
        [
          "งวด",
          "รหัส",
          "ชื่อ",
          "ประเภท",
          "รวมบาท",
          "หักบาท",
          "สุทธิบาท",
          "สถานะ",
        ],
        report.payments
          .filter((r) => r.status === "approved")
          .map((r) => [
            r.period,
            r.code,
            r.name,
            kinds[r.kind],
            r.gross / 100,
            r.deductions / 100,
            r.net / 100,
            "approved",
          ]),
      );
    await load();
    return true;
  }
  if (page === "ภาพรวมกรรมการ") {
    const rows = await api("hr/board-summary");
    view.innerHTML =
      stats([
        ["กรรมการที่มีสิทธิ์ดู", rows.length],
        ["งานทั้งหมด", rows.reduce((n, r) => n + r.tasks, 0)],
        ["งานเกินกำหนด", rows.reduce((n, r) => n + r.overdue, 0)],
      ]) +
      `<div class="card table-card">${table(
        [
          "กรรมการ",
          "ตำแหน่ง",
          "งาน",
          "ประเมินแล้ว",
          "เกินกำหนด",
          "คะแนนเฉลี่ย",
        ],
        rows.map((r) => [
          esc(r.name),
          esc(r.position),
          r.tasks,
          r.completed || 0,
          r.overdue || 0,
          r.score == null ? "—" : Number(r.score).toFixed(1),
        ]),
      )}</div><div class="notice">คะแนนเฉลี่ยนับเฉพาะงานที่ได้รับการประเมิน ไม่ใช่การจัดอันดับกรรมการ</div>`;
    action(actions, "ส่งออกผลงาน CSV", () =>
      csv(
        "board-performance.csv",
        ["ชื่อ", "ตำแหน่ง", "งาน", "ประเมินแล้ว", "เกินกำหนด", "คะแนนเฉลี่ย"],
        rows.map((r) => [
          r.name,
          r.position,
          r.tasks,
          r.completed || 0,
          r.overdue || 0,
          r.score ?? "",
        ]),
      ),
    );
    return true;
  }
  if (page === "งานและผลงานกรรมการ") {
    const [rows, directors] = await Promise.all([
      api("hr/tasks"),
      api("hr/directors"),
    ]);
    view.innerHTML = '<div class="card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      [
        "กรรมการ",
        "งาน / ตัวชี้วัด",
        "กำหนดส่ง",
        "สถานะ",
        "คะแนน",
        "รายละเอียด",
      ],
      rows,
      (r) => [
        esc(r.name),
        `<strong>${esc(r.title)}</strong><br>${esc(r.indicator)}`,
        esc(r.due_date),
        pill(r.status),
        r.score ?? "—",
        `<button data-id="${r.id}">เปิดงาน</button>`,
      ],
      {
        filter: ["assigned", "in_progress", "submitted", "reviewed"],
        onRow: async (r) => {
          const d = directors.find((d) => d.id === r.director_id),
            own = d?.user_id === me.id;
          const modal = popup(
            r.title,
            `<p>ผู้รับผิดชอบ ${esc(r.name)} · กำหนดส่ง ${esc(r.due_date)}</p><h3>ตัวชี้วัด</h3><p>${esc(r.indicator)}</p><h3>ผลงาน</h3><p>${esc(r.outcome || "ยังไม่บันทึก")}</p><p>${pill(r.status)} · คะแนน ${r.score ?? "—"}</p><p>${esc(r.review || "")}</p><div class="actions" data-edit-task></div><div data-files></div>`,
          );
          const host = modal.querySelector("[data-edit-task]");
          if (own && r.status !== "reviewed")
            action(host, "บันทึก / ส่งผลงาน", () =>
              dialog(
                "ส่งผลงาน",
                area("outcome", "ผลงาน", r.outcome) +
                  select("status", "สถานะ", [
                    ["in_progress", "กำลังทำ"],
                    ["submitted", "ส่งประเมิน"],
                  ]),
                async (b) => {
                  await api("hr/tasks/" + r.id, "PATCH", b);
                  modal.close();
                },
              ),
            );
          if (!own && can("board.review") && r.status === "submitted")
            action(host, "ประเมินผลงาน", () =>
              dialog(
                "ประเมินผลงาน",
                field(
                  "score",
                  "คะแนน 0–100",
                  "number",
                  "",
                  'min="0" max="100" step="1"',
                ) + area("review", "ผลประเมิน"),
                async (b) => {
                  await api(`hr/tasks/${r.id}/review`, "POST", b);
                  modal.close();
                },
              ),
            );
          await files(
            modal.querySelector("[data-files]"),
            "task",
            r.id,
            r.status !== "reviewed" && (own || can("board.assign")),
          );
        },
      },
    );
    if (can("board.assign"))
      action(
        actions,
        "มอบหมายงาน",
        () =>
          dialog(
            "มอบหมายงานกรรมการ",
            select(
              "director_id",
              "กรรมการ",
              directors.map((d) => [d.id, d.name]),
            ) +
              field("title", "งาน / โครงการ") +
              area("indicator", "ตัวชี้วัด / เป้าหมาย") +
              field("due_date", "กำหนดส่ง", "date"),
            (b) => api("hr/tasks", "POST", b),
          ),
        true,
      );
    return true;
  }
  if (page === "การประชุมกรรมการ") {
    const [rows, directors] = await Promise.all([
      api("hr/meetings"),
      api("hr/directors"),
    ]);
    view.innerHTML = '<div class="card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      ["วันที่", "คณะ", "หัวข้อ", "ผู้เข้าร่วม", "สถานะ", "รายละเอียด"],
      rows,
      (r) => [
        esc(r.day),
        esc(r.committee),
        esc(r.title),
        r.participants.length,
        esc(
          {
            scheduled: "นัดหมาย",
            completed: "ประชุมแล้ว",
            cancelled: "ยกเลิก",
          }[r.status],
        ),
        `<button data-id="${r.id}">ดูการประชุม</button>`,
      ],
      {
        onRow: (r) => {
          const m = popup(
            r.title,
            `<p>${esc(r.day)} · ${esc(r.committee)}</p><h3>วาระ</h3><p>${esc(r.agenda)}</p><h3>รายงานประชุม / มติ</h3><p>${esc(r.minutes || "รอบันทึก")}</p>${table(
              ["กรรมการ", "เข้าร่วม", "หมายเหตุ"],
              r.participants.map((p) => [
                esc(p.name),
                esc(
                  {
                    invited: "เชิญ",
                    present: "มา",
                    absent: "ขาด",
                    excused: "ลา",
                  }[p.status],
                ),
                esc(p.note),
              ]),
            )}<div class="actions"></div>`,
          );
          action(m.querySelector(".actions"), "พิมพ์รายงาน", () =>
            printDocument(
              r.title,
              m.innerHTML.replace(/<div class="actions">[\s\S]*$/, ""),
            ),
          );
          if (can("board.assign"))
            action(
              m.querySelector(".actions"),
              "บันทึกประชุม / ผู้เข้าร่วม",
              () =>
                dialog(
                  "บันทึกรายงานประชุม",
                  select("status", "สถานะ", [
                    ["completed", "ประชุมแล้ว"],
                    ["scheduled", "นัดหมาย"],
                    ["cancelled", "ยกเลิก"],
                  ]) +
                    area("minutes", "รายงาน / มติ", r.minutes) +
                    r.participants
                      .map((p) =>
                        select("participant_" + p.director_id, p.name, [
                          [
                            p.status,
                            {
                              invited: "เชิญ",
                              present: "มา",
                              absent: "ขาด",
                              excused: "ลา",
                            }[p.status],
                          ],
                          ...["present", "absent", "excused", "invited"]
                            .filter((s) => s !== p.status)
                            .map((s) => [
                              s,
                              {
                                invited: "เชิญ",
                                present: "มา",
                                absent: "ขาด",
                                excused: "ลา",
                              }[s],
                            ]),
                        ]),
                      )
                      .join(""),
                  async (b) => {
                    await api("hr/meetings/" + r.id, "PATCH", {
                      status: b.status,
                      minutes: b.minutes,
                      participants: r.participants.map((p) => ({
                        director_id: p.director_id,
                        status: b["participant_" + p.director_id],
                        note: p.note,
                      })),
                    });
                    m.close();
                  },
                ),
            );
        },
      },
    );
    if (can("board.assign"))
      action(
        actions,
        "นัดประชุม",
        () =>
          dialog(
            "นัดประชุมกรรมการ",
            select("committee", "คณะ", [
              ["คณะกรรมการดำเนินการ", "คณะกรรมการดำเนินการ"],
              ["อำนวยการ", "อำนวยการ"],
              ["เงินกู้", "เงินกู้"],
              ["ศึกษาและประชาสัมพันธ์", "ศึกษาและประชาสัมพันธ์"],
            ]) +
              field("title", "หัวข้อ") +
              field("day", "วันที่", "date") +
              area("agenda", "วาระการประชุม") +
              `<fieldset><legend>กรรมการที่เชิญ</legend>${directors.map((d) => `<label class="checkbox"><input type="checkbox" name="director_${d.id}" value="1">${esc(d.name)}</label>`).join("")}</fieldset>`,
            (b) =>
              api("hr/meetings", "POST", {
                ...b,
                director_ids: directors
                  .filter((d) => b["director_" + d.id])
                  .map((d) => d.id),
              }),
          ),
        true,
      );
    return true;
  }
  if (page === "ผู้ใช้งาน") {
    const rows = await api("hr/accounts/list");
    view.innerHTML = '<div class="card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      ["ชื่อ", "อีเมล", "บทบาท", "ผูกเจ้าหน้าที่", "สถานะ", "จัดการ"],
      rows,
      (r) => [
        esc(r.name),
        esc(r.email),
        esc(r.role),
        esc(r.code || "—"),
        r.disabled ? "ปิด" : "เปิด",
        can("users.manage") &&
        r.id !== me.id &&
        (me.role !== "it_admin" || ["staff", "viewer"].includes(r.role)) &&
        !["admin", "super_admin"].includes(r.role)
          ? `<button data-id="${r.id}">แก้ไขสิทธิ์</button>`
          : "—",
      ],
      {
        onRow: (r) => {
          const roles = ["chair", "director"].includes(r.role)
            ? ["chair", "director"]
            : me.role === "it_admin"
              ? ["staff", "viewer"]
              : ["staff", "viewer", "hr_officer", "manager", "it_admin"];
          dialog(
            "จัดการบัญชี " + r.name,
            select("role", "บทบาท", [
              [r.role, r.role],
              ...roles.filter((x) => x !== r.role).map((x) => [x, x]),
            ]) +
              select("disabled", "สถานะ", [
                [r.disabled, r.disabled ? "ปิดใช้งาน" : "เปิดใช้งาน"],
                [1 - r.disabled, r.disabled ? "เปิดใช้งาน" : "ปิดใช้งาน"],
              ]),
            (b) =>
              api("hr/accounts/" + r.id, "PATCH", {
                ...b,
                disabled: Number(b.disabled),
              }),
          );
        },
      },
    );
    if (can("users.manage")) {
      const employees = can("hr.manage") ? await api("hr/employees") : [];
      action(
        actions,
        "เพิ่มบัญชีเจ้าหน้าที่",
        () =>
          dialog(
            "สร้างบัญชี",
            field("name", "ชื่อ") +
              field("email", "อีเมล", "email") +
              field(
                "password",
                "รหัสผ่าน 12 ตัวขึ้นไป",
                "password",
                "",
                'minlength="12" autocomplete="new-password"',
              ) +
              (can("hr.manage")
                ? select("employee_id", "ผูกทะเบียน", [
                    ["", "ยังไม่ผูก"],
                    ...employees
                      .filter((e) => !e.user_id)
                      .map((e) => [e.id, e.code + " · " + e.name]),
                  ])
                : "") +
              select(
                "role",
                "บทบาท",
                (me.role === "it_admin"
                  ? ["staff", "viewer"]
                  : ["staff", "viewer", "hr_officer", "manager", "it_admin"]
                ).map((r) => [r, r]),
              ),
            (b) => api("hr/accounts", "POST", b),
          ),
        true,
      );
    }
    return true;
  }
  if (page === "โครงสร้างองค์กร") {
    const d = await api("hr/directory");
    view.innerHTML = `<div class="card"><h2>เจ้าหน้าที่สหกรณ์</h2><div data-list></div></div><div class="notice">ชื่อและตำแหน่งจากเว็บไซต์ ณ ${esc(d.sources.retrieved)} · ข้อมูลที่สหกรณ์ยืนยันจะแทนรายการเดิม โดยไม่สร้างบัญชีหรือเงินเดือนอัตโนมัติ</div>`;
    list(
      view.querySelector("[data-list]"),
      ["ชื่อ", "ตำแหน่ง", "แหล่งข้อมูล", "จัดการ"],
      d.staff,
      (r) => [
        esc(r.name),
        esc(r.position),
        esc(r.source.startsWith("https:") ? "เว็บไซต์สหกรณ์" : r.source),
        can("board.manage")
          ? `<button data-id="${r.id}">ยืนยัน / แก้ไข</button>`
          : "—",
      ],
      {
        onRow: (r) =>
          dialog(
            "ข้อมูลเจ้าหน้าที่จากองค์กร",
            field("name", "ชื่อ", "text", r.name) +
              field("position", "ตำแหน่ง", "text", r.position),
            (b) => api("hr/directory/" + r.id, "PATCH", b),
          ),
      },
    );
    return true;
  }
  if (page === "สลิปของฉัน") {
    let rows = [];
    try {
      rows = await api("hr/my-payroll");
    } catch (e) {
      view.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
      return true;
    }
    view.innerHTML = '<div class="card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      ["งวด", "ประเภท", "รวม", "หัก", "สุทธิ", "สลิป"],
      rows,
      (r) => [
        esc(r.period),
        esc(kinds[r.kind]),
        baht(r.gross),
        baht(r.deductions),
        baht(r.net),
        `<button data-id="${r.id}">ดูสลิป</button>`,
      ],
      { onRow: slip },
    );
    return true;
  }
  if (page === "บัญชีของฉัน") {
    let own = null;
    if (can("attendance.self"))
      try {
        own = await api("hr/my-profile");
      } catch {}
    view.innerHTML = `<div class="detail-grid"><div class="card"><h2>${esc(me.name)}</h2><p>${esc(me.email)} · ${esc(me.role)}</p><p>${me.totp_enabled ? "✓ เปิดใช้ 2FA" : "ยังไม่เปิดใช้ 2FA"}</p>${own ? `<h3>ทะเบียนเจ้าหน้าที่</h3><p>${esc(own.code)} · ${esc(own.department)}<br>เริ่มงาน ${esc(own.start_date || "รอ HR ยืนยัน")}</p>` : "<p>บัญชีนี้ยังไม่มีทะเบียนเจ้าหน้าที่ หรือเป็นบัญชีกรรมการ</p>"}</div><div class="card"><h2>เปลี่ยนรหัสผ่าน</h2><form>${field("current_password", "รหัสผ่านปัจจุบัน", "password", "", 'autocomplete="current-password"')}${field("new_password", "รหัสผ่านใหม่", "password", "", 'minlength="12" autocomplete="new-password"')}${field("confirm_password", "ยืนยันรหัสผ่านใหม่", "password", "", 'minlength="12" autocomplete="new-password"')}<button class="primary">เปลี่ยนรหัสผ่านและเข้าสู่ระบบใหม่</button><div class="error" role="alert"></div></form></div></div>`;
    view.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(
          "hr/account-password",
          "POST",
          Object.fromEntries(new FormData(e.target)),
        );
        location.reload();
      } catch (err) {
        view.querySelector(".error").textContent = err.message;
      }
    };
    return true;
  }
  if (page === "ข้อเสนอแนะ") {
    const rows = await api("feedback");
    view.innerHTML = '<div class="card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      ["หัวข้อ", "หมวด", "สถานะ", "ความสำคัญ", "รายละเอียด"],
      rows,
      (r) => [
        esc(r.subject),
        esc(r.category),
        pill(r.status),
        esc(r.priority),
        `<button data-id="${r.id}">ดูรายการ</button>`,
      ],
      {
        filter: ["open", "in_progress", "resolved"],
        onRow: (r) => {
          const m = popup(
            r.subject,
            `<p>${esc(r.category)} · ${esc(r.priority)} · ${pill(r.status)}</p><div class="actions"></div>`,
          );
          if (can("feedback.manage"))
            action(m.querySelector(".actions"), "ปรับสถานะ", () =>
              dialog(
                "ปรับสถานะข้อเสนอแนะ",
                select("status", "สถานะ", [
                  ["in_progress", "กำลังดำเนินการ"],
                  ["resolved", "เสร็จแล้ว"],
                  ["open", "เปิดใหม่"],
                ]),
                async (b) => {
                  await api("feedback/" + r.id, "PATCH", b);
                  m.close();
                },
              ),
            );
        },
      },
    );
    if (can("feedback.manage"))
      action(
        actions,
        "ส่งข้อเสนอแนะ",
        () =>
          dialog(
            "ข้อเสนอแนะ",
            field("subject", "หัวข้อ") +
              select("category", "หมวด", [
                ["Suggestion", "ข้อเสนอแนะ"],
                ["Service", "บริการ"],
                ["Technical", "ปัญหาระบบ"],
                ["Appreciation", "คำชม"],
              ]) +
              select("priority", "ความสำคัญ", [
                ["medium", "ปกติ"],
                ["high", "สูง"],
                ["low", "ต่ำ"],
              ]),
            (b) => api("feedback", "POST", b),
          ),
        true,
      );
    return true;
  }
  return false;
}
export { files, popup, list, action, optional, stats };
