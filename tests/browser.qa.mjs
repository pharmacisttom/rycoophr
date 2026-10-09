import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/database/index.js";
import { createApp } from "../apps/server.js";
import { totp, decryptSecret } from "../packages/security/totp.js";
const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_PATH)
  throw Error("Set PLAYWRIGHT_PATH to installed playwright package");
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const password = "browser-fixture-only-password";
const db = createDatabase(":memory:", password),
  key = randomBytes(32),
  server = createApp(db, { totpKey: key });
db.prepare(
  "INSERT INTO employees(tenant_id,code,name,department,kind,salary,user_id) VALUES('demo','QA001','ทดสอบมือถือ','ทดสอบ','permanent',3000000,'staff')",
).run();
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
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
mkdirSync("output/qa", { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["geolocation"],
    geolocation: { latitude: 12, longitude: 101, accuracy: 10 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("401"))
      errors.push(m.text());
  });
  async function login(email) {
    await page.goto(base);
    await page.locator("input[name=email]").fill(email);
    await page.locator("input[name=password]").fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
  }
  await login("admin@tomvis.demo");
  await page.getByRole("heading", { name: "ภาพรวม", exact: true }).waitFor();
  await page.getByRole("button", { name: "กรรมการ", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "นางสาวอุษา อิศรางกูร ณ อยุธยา",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".module-grid .card").count(), 15);
  await page.screenshot({
    path: "output/qa/directors-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "หน้ารายบุคคล", exact: true })
    .first()
    .click();
  await page.locator("dialog").waitFor();
  assert((await page.locator("dialog").innerText()).includes("กำหนดหน้าที่"));
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await page
    .getByRole("button", { name: "ตั้งค่าเวลาและ GPS", exact: true })
    .click();
  await page.locator("input[name=latitude]").waitFor();
  await page.screenshot({ path: "output/qa/gps-settings.png", fullPage: true });
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await login("pharmacisttom@gmail.com");
  await page
    .getByRole("heading", { name: "ความปลอดภัย", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "ภาพรวม", exact: true }).count(),
    0,
  );
  await page.locator("input[name=password]").fill(password);
  await page
    .getByRole("button", { name: "สร้าง QR สำหรับบัญชีนี้", exact: true })
    .click();
  await page.locator(".qr svg").waitFor();
  await page.screenshot({ path: "output/qa/2fa-setup.png", fullPage: true });
  const factor = db
    .prepare("SELECT secret FROM user_totp WHERE user_id='ryadmin'")
    .get();
  const code = totp(
    decryptSecret(factor.secret, key),
    Math.floor(Date.now() / 30000),
  );
  await page.locator("input[name=code]").fill(code);
  await page
    .getByRole("button", { name: "ยืนยันและเปิดใช้ 2FA", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "เปิดใช้ 2FA สำเร็จ", exact: true })
    .waitFor();
  assert.equal((await page.locator("pre").innerText()).split("\n").length, 10);
  await page
    .getByRole("button", {
      name: "ฉันบันทึกรหัสแล้ว · ไปหน้าหลัก",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { name: "ภาพรวม", exact: true }).waitFor();
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await login("staff@tomvis.demo");
  await page
    .getByRole("heading", { name: "โครงสร้างองค์กร", exact: true })
    .waitFor();
  await page.locator(".mobile-menu").click();
  await page
    .getByRole("button", { name: "เช็กอินมือถือ", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "เช็กอินมือถือ", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "เงินเดือนและโบนัส", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "เช็กอินเข้างาน", exact: true })
    .click();
  await page.getByText("บันทึก ", { exact: false }).last().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("tbody tr").length > 0 &&
      document.querySelector("tbody")?.textContent?.includes(":"),
  );
  await page.screenshot({
    path: "output/qa/checkin-mobile.png",
    fullPage: true,
  });
  assert.equal(db.prepare("SELECT count(*) n FROM checkin_events").get().n, 1);
  assert(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser QA passed: desktop, individual director, mandatory 2FA QR/recovery, mobile GPS, no page errors or mobile overflow",
  );
} finally {
  await browser.close();
  server.close();
  db.close();
}
