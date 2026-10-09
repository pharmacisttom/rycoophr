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
import { files, popup, list, action, stats } from "/complete.js";
const labels = {
  annual: "พักร้อน",
  sick: "ป่วย",
  personal: "กิจ",
  unpaid: "ไม่รับค่าจ้าง",
};
export async function leavePages(page, view, actions) {
  if (page === "สิทธิ์การลา") {
    view.innerHTML = `<div class="toolbar"><label>ปี ค.ศ.<input type="number" min="2000" max="2200" value="${new Date().getFullYear()}" data-year></label><button data-load>แสดงสิทธิ์ลา</button></div><div data-balances></div><div class="notice">วันลานับเฉพาะวันทำงานและหักวันหยุดตามปฏิทินสำนักงาน สิทธิ์ที่ยังไม่กำหนดจะแสดง “รอ HR กำหนด”</div>`;
    let data;
    const load = async () => {
      data = await api(
        "hr/leave-balances?year=" + view.querySelector("[data-year]").value,
      );
      view.querySelector("[data-balances]").innerHTML =
        `<div class="card">${table(
          [
            "รหัส",
            "ชื่อ",
            "ประเภท",
            "สิทธิ์ (วัน)",
            "ใช้แล้ว",
            "รออนุมัติ",
            "คงเหลือ",
          ],
          data.employees.flatMap((e) =>
            e.balances.map((b) => [
              esc(e.code),
              esc(e.name),
              labels[b.kind],
              b.entitlement ?? "รอ HR กำหนด",
              b.calendar_configured ? b.used : "รอปฏิทิน",
              b.calendar_configured ? b.pending : "รอปฏิทิน",
              b.remaining ?? "—",
            ]),
          ),
        )}</div>`;
    };
    view.querySelector("[data-load]").onclick = () =>
      load().catch((e) => toast(e.message));
    await load();
    if (can("hr.manage"))
      action(
        actions,
        "กำหนดสิทธิ์ลา",
        () =>
          dialog(
            "สิทธิ์ลาตามระเบียบที่รับรอง",
            select(
              "employee_id",
              "เจ้าหน้าที่",
              data.employees.map((e) => [e.id, e.code + " · " + e.name]),
            ) +
              field(
                "year",
                "ปี ค.ศ.",
                "number",
                data.year,
                'min="2000" max="2200"',
              ) +
              select("kind", "ประเภท", Object.entries(labels)) +
              field(
                "days",
                "จำนวนวันตามสิทธิ์",
                "number",
                "0",
                'min="0" max="366" step="0.5"',
              ),
            (b) =>
              api("hr/leave-balances", "POST", {
                ...b,
                year: Number(b.year),
                days: Number(b.days),
              }),
          ),
        true,
      );
    return true;
  }
  if (page === "ใบลา") {
    let rows;
    try {
      rows = await api("hr/leaves");
    } catch (e) {
      view.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
      return true;
    }
    view.innerHTML =
      stats([
        ["ใบลาทั้งหมด", rows.length],
        ["รอพิจารณา", rows.filter((r) => r.status === "pending").length],
        ["อนุมัติ", rows.filter((r) => r.status === "approved").length],
      ]) + '<div class="card table-card" data-list></div>';
    list(
      view.querySelector("[data-list]"),
      ["เจ้าหน้าที่", "ประเภท", "วันที่", "สถานะ", "รายละเอียด"],
      rows,
      (r) => [
        esc(r.name),
        labels[r.kind],
        esc(r.start_day + " – " + r.end_day),
        pill(r.status),
        `<button data-id="${r.id}">เปิดใบลา</button>`,
      ],
      {
        filter: ["pending", "approved", "rejected", "cancelled"],
        onRow: async (r) => {
          const html = `<p><strong>${esc(r.code)} · ${esc(r.name)}</strong></p><p>${labels[r.kind]} · ${esc(r.start_day)} – ${esc(r.end_day)}</p><h3>เหตุผล</h3><p>${esc(r.reason)}</p><p>${pill(r.status)} · ${esc(r.note || "")}</p>`;
          const modal = popup(
            "ใบลา",
            html +
              '<div class="actions" data-decisions></div><div data-files></div>',
          );
          const host = modal.querySelector("[data-decisions]");
          if (
            can("hr.approve") &&
            r.created_by !== me.id &&
            r.status === "pending"
          )
            action(host, "พิจารณาใบลา", () =>
              dialog(
                "ผลพิจารณา",
                select("status", "ผล", [
                  ["approved", "อนุมัติ"],
                  ["rejected", "ไม่อนุมัติ"],
                ]) + area("note", "เหตุผล / หมายเหตุ"),
                async (b) => {
                  await api(`hr/leaves/${r.id}/decision`, "POST", b);
                  modal.close();
                },
              ),
            );
          if (r.created_by === me.id && r.status === "pending")
            action(host, "ยกเลิกใบลา", () =>
              dialog(
                "ยืนยันยกเลิกใบลา",
                "<p>ใบลานี้ยังไม่ได้อนุมัติ</p>",
                async () => {
                  await api(`hr/leaves/${r.id}/cancel`, "POST", {});
                  modal.close();
                },
              ),
            );
          await files(
            modal.querySelector("[data-files]"),
            "leave",
            r.id,
            r.status === "pending" &&
              (r.created_by === me.id || can("hr.manage")),
          );
        },
      },
    );
    action(
      actions,
      "ยื่นใบลา",
      () =>
        dialog(
          "ยื่นใบลา",
          select("kind", "ประเภท", Object.entries(labels)) +
            field("start_day", "วันเริ่มลา", "date") +
            field("end_day", "วันสิ้นสุด", "date") +
            area("reason", "เหตุผล"),
          (b) => api("hr/leaves", "POST", b),
        ),
      true,
    );
    if (can("hr.manage"))
      action(actions, "ประมวลผลขาดงาน", () =>
        dialog(
          "ประมวลผลขาดงานวันที่ผ่านมา",
          field("day", "วันที่", "date"),
          async (b) => {
            const r = await api("hr/absence/process", "POST", b);
            toast(`ขาดงาน ${r.absent} · ลา ${r.onLeave}`);
          },
        ),
      );
    return true;
  }
  return false;
}
