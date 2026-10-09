// Public roster snapshot retrieved 2026-10-09. Terms, email and payroll are unknown.
export const rosterSources = {
  directors: "https://rayongcoop.com/page.php?pid=3",
  staff: "https://rayongcoop.com/page.php?pid=4",
  retrieved: "2026-10-09",
  boardSet: 38,
};
export const directors = [
  ["นางสาวอุษา อิศรางกูร ณ อยุธยา", "ประธานกรรมการ", "อำนวยการ:ประธาน"],
  ["นางณาทัศญา ทรัพย์อักษรศิริ", "รองประธาน", "อำนวยการ:กรรมการ"],
  ["นางพจวรรณ ธรรมเจริญ", "กรรมการ", "อำนวยการ:กรรมการ"],
  ["นายจัตุพล กันทะมูล", "กรรมการ", "อำนวยการ:กรรมการ"],
  ["นางสุเนตรา ตระการกูล", "กรรมการ", "อำนวยการ:เลขานุการ"],
  ["นางวรรณา ทิพย์ประภาแย้ม", "กรรมการ", "เงินกู้:กรรมการ"],
  ["นายเฉลิม ช่างสุวรรณ", "กรรมการ", "ศึกษาและประชาสัมพันธ์:กรรมการ"],
  ["นางสาวเครือทิพย์ เย็นจิต", "กรรมการ", "ศึกษาและประชาสัมพันธ์:กรรมการ"],
  ["นางรจนา เลาหพจนารถ", "กรรมการ", "ศึกษาและประชาสัมพันธ์:ประธาน"],
  ["นางมริสสา กองสมบัติสุข", "กรรมการ", "เงินกู้:กรรมการ"],
  ["นายอนุชิต วิริยาภรณ์", "กรรมการ", "เงินกู้:เลขานุการ"],
  ["นางพิชญาภา บำรงพงษ์", "กรรมการ", "ศึกษาและประชาสัมพันธ์:กรรมการ"],
  ["นายสุรพงษ์ จำนงค์ภักดิ์", "กรรมการ", "เงินกู้:ประธาน"],
  ["นางสาวนงลักษณ์ บรรเทาทุกข์", "กรรมการ", "ศึกษาและประชาสัมพันธ์:เลขานุการ"],
  ["นายชัชชัย บำรุง", "กรรมการ", "เงินกู้:กรรมการ"],
];
export const staff = [
  ["นางนริศษา แย้มกลิ่น", "ผู้จัดการ"],
  ["นางสาวนิภาภัทร์ แก้วประเสริฐกุล", "เจ้าหน้าที่ธุรการ"],
  ["นางศรีนวล รักษาวงศ์", "เจ้าหน้าที่การเงิน"],
  ["นางสาววันวิสาข์ เจริญรัตน์", "เจ้าหน้าที่สินเชื่อ"],
  ["นางสาวศุจิพัชร เหล็กเพชร", "เจ้าหน้าที่บัญชี"],
  ["นางสาวเนตรนภา ชื่นพงษ์", "เจ้าหน้าที่ประจำหน่วย"],
];
export const dutyTemplates = {
  ประธานกรรมการ:
    "กำกับแผนงาน ติดตามมติและผลการดำเนินงาน ประเมินงานที่ได้รับมอบหมาย (ข้อเสนอ รอรับรอง)",
  รองประธาน:
    "สนับสนุนประธาน ประสานงานและติดตามงานที่ได้รับมอบหมาย (ข้อเสนอ รอรับรอง)",
  กรรมการ:
    "ปฏิบัติงานตามมติ บันทึกผลและหลักฐานตามตัวชี้วัดของงานที่ได้รับมอบหมาย (ข้อเสนอ รอรับรอง)",
};
export function seedOrganization(db, tenant) {
  const marker = db
    .prepare("SELECT tenant_id FROM organization_imports WHERE tenant_id=?")
    .get(tenant);
  if (marker) return;
  for (const [name, position, committee] of directors) {
    const r = db
      .prepare(
        "INSERT INTO directors(tenant_id,name,position,term_start,term_end,duties) VALUES(?,?,?,?,?,?)",
      )
      .run(tenant, name, position, "", "", dutyTemplates[position]);
    const [group, role] = committee.split(":");
    db.prepare("INSERT INTO director_committees VALUES(?,?,?)").run(
      r.lastInsertRowid,
      group,
      role,
    );
  }
  for (const [name, position] of staff)
    db.prepare(
      "INSERT INTO organization_staff(tenant_id,name,position,source) VALUES(?,?,?,?)",
    ).run(tenant, name, position, rosterSources.staff);
  db.prepare(
    "INSERT INTO organization_staff(tenant_id,name,position,source) VALUES(?,?,?,?)",
  ).run(
    tenant,
    "รอระบุชื่อ",
    "นักคอมพิวเตอร์",
    "ผู้ใช้แจ้งเพิ่มเติม 2026-10-09",
  );
  db.prepare("INSERT INTO organization_imports VALUES(?,?)").run(
    tenant,
    rosterSources.retrieved,
  );
}
