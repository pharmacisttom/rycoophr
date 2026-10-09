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
export async function mobilePage(page, view, actions) {
  if (page === "เช็กอินมือถือ") {
    let records = [],
      error = "";
    try {
      records = await api("hr/my-attendance");
    } catch (e) {
      error = e.message;
    }
    const office = await api("hr/office");
    view.innerHTML = `<div class="card mobile-checkin"><h2>เข้างานผ่าน GPS</h2><p>${error ? esc(error) : "เปิดตำแหน่งบนมือถือ แล้วกดปุ่มเมื่ออยู่ที่สำนักงาน"}</p><p>${office.latitude == null ? "รอแอดมินตั้งค่าพิกัดสำนักงาน" : `รัศมี ${esc(office.radius)} เมตร · GPS คลาดเคลื่อนไม่เกิน ${esc(office.max_accuracy)} เมตร · เริ่มงาน ${esc(office.start_time)} ผ่อนผัน ${esc(office.grace_minutes)} นาที`}</p><div class="actions"><button id="in" class="primary" ${error || office.latitude == null ? "disabled" : ""}>เช็กอินเข้างาน</button><button id="out" ${error || office.latitude == null ? "disabled" : ""}>เช็กเอาต์ออกงาน</button></div><p id="location-status" role="status"></p></div><div class="card table-card">${table(
      ["วันที่", "เข้า", "ออก", "สถานะ"],
      records.map((r) => [
        esc(r.day),
        esc(r.check_in || "—"),
        esc(r.check_out || "—"),
        pill(r.status),
      ]),
    )}</div>`;
    for (const action of ["in", "out"])
      view.querySelector("#" + action).onclick = async () => {
        const status = view.querySelector("#location-status");
        const buttons = view.querySelectorAll(".actions button");
        buttons.forEach((b) => (b.disabled = true));
        status.textContent = "กำลังอ่านพิกัด GPS…";
        try {
          if (!navigator.geolocation) throw Error("อุปกรณ์นี้ไม่รองรับ GPS");
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 0,
            }),
          );
          const r = await api("hr/checkin", "POST", {
            action,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
          toast(`บันทึก ${r.day} ${r.time} · ${r.distance} เมตรจากสำนักงาน`);
          await render();
        } catch (e) {
          status.textContent =
            e.code === 1
              ? "กรุณาอนุญาตการใช้ตำแหน่งในเบราว์เซอร์"
              : e.message || "อ่านพิกัดไม่ได้ ลองใหม่บริเวณโล่ง";
          buttons.forEach((b) => (b.disabled = false));
        }
      };
  }
  if (page === "ใบลา") {
    const rows = await api("hr/leaves");
    view.innerHTML = `<div class="card">${table(
      [
        "เจ้าหน้าที่",
        "ประเภท",
        "ช่วงวันที่",
        "เหตุผล",
        "สถานะ",
        "หมายเหตุ",
        "พิจารณา",
      ],
      rows.map((r) => [
        esc(r.name),
        esc(
          {
            annual: "พักร้อน",
            sick: "ป่วย",
            personal: "กิจ",
            unpaid: "ไม่รับค่าจ้าง",
          }[r.kind],
        ),
        esc(r.start_day + " – " + r.end_day),
        esc(r.reason),
        pill(r.status),
        esc(r.note),
        can("hr.approve") && r.created_by !== me.id && r.status === "pending"
          ? `<button data-leave="${r.id}">พิจารณา</button>`
          : "—",
      ]),
    )}</div><div class="notice">จำนวนสิทธิ์ลาและการหักเงินต้องใช้ระเบียบที่สหกรณ์รับรอง ระบบรุ่นนี้บันทึกคำขอและผลอนุมัติ</div>`;
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = "ยื่นใบลา";
    b.onclick = () =>
      dialog(
        "ยื่นใบลา",
        select("kind", "ประเภท", [
          ["annual", "พักร้อน"],
          ["sick", "ป่วย"],
          ["personal", "กิจ"],
          ["unpaid", "ไม่รับค่าจ้าง"],
        ]) +
          field("start_day", "เริ่มลา", "date") +
          field("end_day", "สิ้นสุด", "date") +
          area("reason", "เหตุผล / หลักฐานอ้างอิง"),
        (body) => api("hr/leaves", "POST", body),
      );
    actions.append(b);
    view.querySelectorAll("[data-leave]").forEach(
      (b) =>
        (b.onclick = () =>
          dialog(
            "พิจารณาใบลา",
            select("status", "ผล", [
              ["approved", "อนุมัติ"],
              ["rejected", "ไม่อนุมัติ"],
            ]) + area("note", "หมายเหตุ"),
            (body) =>
              api(`hr/leaves/${b.dataset.leave}/decision`, "POST", body),
          )),
    );
    if (can("hr.manage")) {
      const process = document.createElement("button");
      process.textContent = "ประมวลผลขาดงาน";
      process.onclick = () =>
        dialog(
          "ประมวลผลวันที่ผ่านมา",
          field("day", "วันที่ทำงาน", "date"),
          async (body) => {
            const r = await api("hr/absence/process", "POST", body);
            toast(`ขาด ${r.absent} · ลา ${r.onLeave}`);
          },
        );
      actions.append(process);
    }
  }
  if (page === "ตั้งค่าเวลาและ GPS") {
    const s = await api("hr/office");
    view.innerHTML = `<div class="card security"><h2>สำนักงาน / เวลาทำงาน</h2><p>กำหนดพิกัดจากสถานที่จริง การลาที่อนุมัติและวันหยุดจะไม่ถูกนับเป็นขาดงาน</p><form>${field("latitude", "ละติจูด", "number", s.latitude ?? "", 'step="any" min="-90" max="90"')}${field("longitude", "ลองจิจูด", "number", s.longitude ?? "", 'step="any" min="-180" max="180"')}${field("radius", "รัศมีเช็กอิน (เมตร)", "number", s.radius ?? 150, 'min="20" max="2000"')}${field("max_accuracy", "GPS คลาดเคลื่อนสูงสุด (เมตร)", "number", s.max_accuracy ?? 50, 'min="5" max="2000"')}${field("start_time", "เริ่มงาน", "time", s.start_time ?? "08:30")}${field("grace_minutes", "ผ่อนผัน (นาที)", "number", s.grace_minutes ?? 0, 'min="0" max="60"')}${field("workdays", "วันทำงาน 0=อาทิตย์ … 6=เสาร์ คั่นด้วย comma", "text", s.workdays ? JSON.parse(s.workdays).join(",") : "1,2,3,4,5")}<label>วันหยุด YYYY-MM-DD คั่นด้วย comma<textarea name="holidays">${esc(s.holidays ? JSON.parse(s.holidays).join(",") : "")}</textarea></label><button class="primary">บันทึกการตั้งค่า</button><div class="error" role="alert"></div></form></div>`;
    view.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.target));
      for (const k of [
        "latitude",
        "longitude",
        "radius",
        "max_accuracy",
        "grace_minutes",
      ])
        b[k] = Number(b[k]);
      b.workdays = b.workdays.split(",").map((x) => Number(x.trim()));
      b.holidays = b.holidays
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      try {
        await api("hr/office", "POST", b);
        toast("บันทึกพิกัดและเวลาแล้ว");
      } catch (err) {
        view.querySelector(".error").textContent = err.message;
      }
    };
  }
}
