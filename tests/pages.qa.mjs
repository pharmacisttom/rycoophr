import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import { hashPassword } from "../packages/security/index.js";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_PATH),
  password = "all-pages-fixture-password";
const db = createDatabase(":memory:", password);
const server = createApp(db);
const e = db
  .prepare(
    "INSERT INTO employees(tenant_id,code,name,department,kind,salary,user_id,start_date,profile) VALUES('demo','QA001','เจ้าหน้าที่ทดสอบ','นักคอมพิวเตอร์','permanent',3000000,'staff','2025-01-01',?)",
  )
  .run(
    JSON.stringify({
      phone: "0800000000",
      bank_name: "ธนาคารทดสอบ",
      bank_account: "0000000000",
    }),
  );
const id = Number(e.lastInsertRowid);
db.prepare(
  "INSERT INTO employee_records(tenant_id,employee_id,kind,data) VALUES('demo',?,'child',?)",
).run(
  id,
  JSON.stringify({
    name: "บุตรทดสอบ",
    school: "โรงเรียนทดสอบ",
    level: "ประถม",
    birth_day: "2020-01-01",
  }),
);
db.prepare(
  "INSERT INTO welfare(tenant_id,employee_id,kind,amount,detail,created_by) VALUES('demo',?,'medical',150000,'ใบเสร็จทดสอบ','staff')",
).run(id);
const payroll = db
  .prepare(
    "INSERT INTO payroll(tenant_id,employee_id,period,kind,gross,deductions,net,status,created_by,approved_by) VALUES('demo',?,'2026-10','salary',3000000,100000,2900000,'approved','staff','admin')",
  )
  .run(id);
db.prepare(
  "INSERT INTO salary_adjustments(tenant_id,employee_id,old_salary,new_salary,percent,effective_day,reason,created_by) VALUES('demo',?,3000000,3150000,5,'2026-10-01','มติทดสอบ','staff')",
).run(id);
db.prepare(
  "INSERT INTO leave_requests(tenant_id,employee_id,kind,start_day,end_day,reason,created_by) VALUES('demo',?,'sick','2026-10-09','2026-10-09','ใบลาทดสอบ','staff')",
).run(id);
db.prepare("INSERT INTO office_settings VALUES(?,?,?,?,?,?,?,?,?)").run(
  "demo",
  12,
  101,
  150,
  50,
  "08:30",
  5,
  "[1,2,3,4,5]",
  "[]",
);
db.prepare(
  "INSERT INTO attendance(tenant_id,employee_id,day,check_in,check_out,status) VALUES('demo',?,'2026-10-08','08:35','17:00','present')",
).run(id);
db.prepare(
  "INSERT INTO leave_entitlements VALUES('demo',?,2026,'annual',10)",
).run(id);
for (const [uid, role] of [
  ["directorqa", "director"],
  ["chairqa", "chair"],
]) {
  db.prepare("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)").run(
    uid,
    uid,
    uid + "@test.invalid",
    hashPassword(password),
  );
  db.prepare("INSERT INTO memberships VALUES(?,'demo',?)").run(uid, role);
}
const ds = db
  .prepare("SELECT id FROM directors WHERE tenant_id='demo' ORDER BY id")
  .all();
db.prepare("UPDATE directors SET user_id=? WHERE id=?").run(
  "directorqa",
  ds[0].id,
);
db.prepare("UPDATE directors SET user_id=? WHERE id=?").run(
  "chairqa",
  ds[1].id,
);
db.prepare(
  "INSERT INTO board_tasks(tenant_id,director_id,title,indicator,due_date,status,outcome,score,review) VALUES('demo',?,'ติดตามมติทดสอบ','ครบ 3 รายการ','2026-10-01','reviewed','ครบตามเป้า',90,'บรรลุเป้า')",
).run(ds[0].id);
const m = db
  .prepare(
    "INSERT INTO board_meetings(tenant_id,committee,title,day,agenda,minutes,status,created_by) VALUES('demo','อำนวยการ','ประชุมทดสอบ','2026-10-09','ทบทวนแผนงาน','รับรองมติ','completed','admin')",
  )
  .run();
db.prepare("INSERT INTO meeting_participants VALUES(?,?,'present','')").run(
  m.lastInsertRowid,
  ds[0].id,
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
mkdirSync("output/qa/pages", { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(r.status() + " " + r.url());
  });
  async function login(email) {
    await page.goto(base);
    await page.locator("input[name=email]").fill(email);
    await page.locator("input[name=password]").fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
    await page.locator(".layout").waitFor();
  }
  async function nav(name) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector("#view")?.getAttribute("aria-busy") === "false",
    );
  }
  await login("admin@tomvis.demo");
  await page.waitForFunction(
    () =>
      document.querySelector("#view")?.getAttribute("aria-busy") === "false",
  );
  const names = await page
    .locator("[data-page]")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.page));
  for (const [i, name] of names.entries()) {
    await nav(name);
    assert(await page.locator("#view").innerText());
    await page.screenshot({
      path: `output/qa/pages/${String(i + 1).padStart(2, "0")}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of names) {
    await page.locator(".mobile-menu").click();
    await nav(name);
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert(width <= 390, `Mobile overflow ${name}: ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${names.length} desktop and mobile pages`);
} finally {
  await browser.close();
  server.close();
  db.close();
}
