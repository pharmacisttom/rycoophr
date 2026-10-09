# ติดตั้ง rycoopHR สำหรับทดสอบ

ปลายทางที่ผู้ใช้กำหนด: `https://rycoophr.tomvisolution.tech` แอปฟังพอร์ต **3013**

## เครื่องที่มี reverse proxy อยู่แล้ว

ใช้วิธีนี้เมื่อเซิร์ฟเวอร์มี Nginx/Caddy และใช้งานพอร์ต 80/443 อยู่ ห้ามเริ่ม Caddy ตัวที่สองทับบริการเดิม

1. ชี้ DNS A/AAAA ของโดเมนไปยังเครื่องทดสอบ
2. clone repository แล้วสร้าง `.env` จาก `.env.example` บนเซิร์ฟเวอร์
3. กำหนด `RYCOOP_MODE=production`, `RYCOOP_ORIGIN=https://rycoophr.tomvisolution.tech`, รหัสผ่านเริ่มต้นที่สุ่มและคีย์ TOTP 64 ตัวอักษร hex
4. ใช้ Node 22.17+ และ `npm ci --omit=dev`
5. เริ่มด้วย `node --env-file=.env apps/server.js` ภายใต้ service manager; แอป bind `127.0.0.1:3013` เป็นค่าเริ่มต้น
6. ตั้ง reverse proxy HTTPS ให้คง Host header และส่งต่อไป `http://127.0.0.1:3013`
7. เปิดแอดมิน `pharmacisttom@gmail.com` และตั้ง Google Authenticator ก่อนเข้าหน้าอื่น

ตัวอย่าง location สำหรับ Nginx ใน HTTPS server block ที่มี certificate แล้ว:

```nginx
location / {
    proxy_pass http://127.0.0.1:3013;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2m;
}
```

## เครื่องใหม่ด้วย Docker Compose

ต้องมี Docker Engine และ Compose v2, DNS ชี้ถูกเครื่อง และเปิด TCP 80/443 สำหรับ certificate กับ HTTPS

```bash
git clone https://github.com/pharmacisttom/rycoophr.git
cd rycoophr
cp .env.example .env
# แก้ .env โดยไม่เผยแพร่รหัสผ่านและคีย์
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

คีย์เข้ารหัส TOTP สร้างด้วย:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

แอป expose 3013 เฉพาะเครือข่ายภายใน Compose; เว็บภายนอกใช้ 443 ห้ามเปิดแอปให้ข้าม HTTPS proxy

## ข้อมูลและ backup

- SQLite ใช้ volume `hr_data` ข้อมูลไม่หายเมื่อสร้าง container ใหม่ ห้าม `docker compose down -v` เมื่อต้องการเก็บข้อมูล
- เก็บ `RYCOOP_TOTP_KEY` เดิมทุกครั้ง การเปลี่ยนคีย์ทำให้ secret ที่เข้ารหัสอ่านไม่ได้
- สำรองฐานข้อมูลขณะระบบทำงาน: `docker compose exec app npm run backup` (VACUUM INTO ทำ snapshot ที่สอดคล้องกัน)
- สำเนา snapshot ออกจาก volume ไปยังที่เก็บนอกเครื่อง และเก็บคีย์เข้ารหัสแยกอย่างปลอดภัย
- Restore: หยุดแอป สำรองไฟล์ปัจจุบัน เปลี่ยนไฟล์ `data/production.sqlite` ด้วย snapshot ตรวจสิทธิ์ node user แล้วเริ่มแอปด้วยคีย์เดิม
- รหัสผ่าน environment ใช้สร้างบัญชีครั้งแรกเท่านั้น ไม่เปลี่ยนรหัสผ่านของฐานข้อมูลเดิม

## ขั้นตอนรับรองก่อนใช้งาน

1. ลงทะเบียนแอดมินด้วย QR จริง เก็บรหัสกู้คืน แล้วทดสอบออก/เข้าสู่ระบบอีกครั้ง
2. กำหนดพิกัดสำนักงาน รัศมี ความแม่นยำ GPS เวลาเริ่มงาน ผ่อนผัน วันทำงานและวันหยุด
3. สร้างทะเบียนเจ้าหน้าที่ด้วยรหัส/เงินเดือนจริง ผูกบัญชีผ่านหน้า ผู้ใช้งาน
4. ให้ HR จัดทำและผู้จัดการอนุมัติรายการโดยเป็นคนละคน
5. ทดสอบ GPS จากมือถือจริงทั้งในและนอกรัศมี ผ่าน HTTPS; browser GPS สามารถถูกจำลองได้ จึงควรตรวจสอบกับบันทึกงานเมื่อมีข้อพิพาท
6. รับรองวาระและหน้าที่กรรมการจากมติ ปรับข้อมูลชื่อที่สะกดต่างกันบนหน้าเว็บ แล้วเปิดบัญชีด้วยอีเมลที่ยืนยันแล้ว
7. ทดสอบ backup/restore บนสำเนา ก่อนบรรจุข้อมูลจริง

## สถานะการติดตั้ง

ชุดนี้เตรียมสำหรับ deploy; ไม่มี SSH host หรือข้อมูลโฮสต์ในคำขอปัจจุบัน และยังไม่ได้เปิดเว็บบนโดเมนจริง
Docker build จะตรวจใน GitHub Actions; เครื่องพัฒนาที่ใช้งานไม่มี Docker daemon ทำงาน จึงยังไม่ยืนยัน container runtime ที่นี่
