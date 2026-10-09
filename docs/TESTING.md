# การตรวจสอบ

```bash
npm ci
npm run build
npm test
npm audit --omit=dev --audit-level=moderate
```

ชุด API 16 tests ครอบคลุม hashing/redaction, session, CSRF/origin, role/tenant isolation, MFA enrollment gate, RFC 6238 vectors, OTP/recovery replay, AES-GCM, payroll maker/checker, Excel mismatch, board task ownership/review, mobile geofence/accuracy/duplicates/server clock, leave overlaps และ leave-aware absence

Browser QA ใช้ฐานข้อมูล `:memory:` และบัญชีทดสอบที่ไม่มีผลต่อ production:

```powershell
$env:PLAYWRIGHT_PATH='absolute-path-to-installed-playwright-package'
# ระบุเมื่อ Chromium ที่ติดตั้งไม่ตรงกับ Playwright default
$env:CHROMIUM_PATH='absolute-path-to-chrome.exe'
node tests/browser.qa.mjs
node tests/pages.qa.mjs
```

ตรวจ desktop 1440px, mobile 390px, กรรมการรายบุคคล, QR/confirm/recovery และเช็กอินด้วยพิกัดจำลอง ภาพอยู่ใน `output/qa/` ซึ่งไม่เผยแพร่ขึ้น Git
ต้องตรวจมือถือจริงและพิกัดสำนักงานจริงก่อนรับรองการใช้งาน
Docker daemon ในเครื่องพัฒนาไม่ทำงาน; build container กำหนดไว้ใน GitHub Actions

ตรวจทั้ง 23 เมนูที่ความกว้าง 1440 และ 390px รวมทะเบียนประวัติ เอกสารแนบ การปรับเงินเดือน สลิป รายงาน สิทธิ์ลา และประชุมกรรมการ ชุด API ตรวจสิทธิ์ข้ามองค์กร เอกสารหลังอนุมัติ การเพิกถอน session และสิทธิ์ลาตามปฏิทินด้วย
