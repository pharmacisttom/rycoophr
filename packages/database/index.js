import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../security/index.js";
import { seedOrganization } from "../../modules/hr/organization.js";
import { extendedSchema } from "../../modules/hr/extended-schema.js";
export function createDatabase(
  path,
  password,
  { production = false, adminEmail = "pharmacisttom@gmail.com" } = {},
) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,disabled INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),tenant_id TEXT REFERENCES tenants(id),role TEXT NOT NULL,PRIMARY KEY(user_id,tenant_id));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),tenant_id TEXT REFERENCES tenants(id),expires_at INTEGER);
 CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT REFERENCES tenants(id),subject TEXT,category TEXT,status TEXT,priority TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,tenant_id TEXT,actor TEXT,action TEXT,resource TEXT,resource_id TEXT,old_value TEXT,new_value TEXT,ip TEXT,user_agent TEXT,request_id TEXT,timestamp TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS user_totp(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,pending_expires INTEGER);
 CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT REFERENCES users(id),digest TEXT NOT NULL,PRIMARY KEY(user_id,digest));
 CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),code TEXT NOT NULL,name TEXT NOT NULL,department TEXT NOT NULL,kind TEXT NOT NULL,salary INTEGER NOT NULL CHECK(salary>=0),active INTEGER DEFAULT 1,UNIQUE(tenant_id,code));
 CREATE TABLE IF NOT EXISTS welfare(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),kind TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),detail TEXT NOT NULL,status TEXT DEFAULT 'pending',created_by TEXT NOT NULL,approved_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS payroll(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),period TEXT NOT NULL,kind TEXT NOT NULL,gross INTEGER NOT NULL,deductions INTEGER NOT NULL,net INTEGER NOT NULL,status TEXT DEFAULT 'draft',created_by TEXT NOT NULL,approved_by TEXT,UNIQUE(tenant_id,employee_id,period,kind));
 CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),day TEXT NOT NULL,check_in TEXT,check_out TEXT,status TEXT NOT NULL,UNIQUE(tenant_id,employee_id,day));
 INSERT OR IGNORE INTO migrations VALUES(1);
 CREATE TABLE IF NOT EXISTS directors(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),user_id TEXT UNIQUE REFERENCES users(id),name TEXT NOT NULL,position TEXT NOT NULL,term_start TEXT NOT NULL,term_end TEXT NOT NULL,duties TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS board_tasks(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),director_id INTEGER REFERENCES directors(id),title TEXT NOT NULL,indicator TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT DEFAULT 'assigned',outcome TEXT DEFAULT '',score INTEGER,review TEXT,reviewer TEXT);
 CREATE TABLE IF NOT EXISTS office_settings(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),latitude REAL NOT NULL,longitude REAL NOT NULL,radius INTEGER NOT NULL,max_accuracy INTEGER NOT NULL,start_time TEXT NOT NULL,grace_minutes INTEGER NOT NULL,workdays TEXT NOT NULL,holidays TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS leave_requests(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),kind TEXT NOT NULL,start_day TEXT NOT NULL,end_day TEXT NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL,status TEXT DEFAULT 'pending',approved_by TEXT,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS checkin_events(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),action TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy REAL NOT NULL,distance INTEGER NOT NULL,server_time TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS organization_staff(id INTEGER PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),name TEXT NOT NULL,position TEXT NOT NULL,source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS director_committees(director_id INTEGER REFERENCES directors(id),committee TEXT NOT NULL,position TEXT NOT NULL,PRIMARY KEY(director_id,committee));
 CREATE TABLE IF NOT EXISTS organization_imports(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),retrieved TEXT NOT NULL);
 INSERT OR IGNORE INTO migrations VALUES(2);`);
  if (
    !db
      .prepare("PRAGMA table_info(employees)")
      .all()
      .some((c) => c.name === "user_id")
  ) {
    db.exec("BEGIN");
    try {
      db.exec(
        "ALTER TABLE employees ADD COLUMN user_id TEXT REFERENCES users(id); CREATE UNIQUE INDEX employees_user ON employees(tenant_id,user_id); INSERT OR IGNORE INTO migrations VALUES(3);",
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (!db.prepare("SELECT id FROM tenants LIMIT 1").get()) {
    db.exec("BEGIN");
    try {
      for (const [id, name] of production
        ? [["rayong", "สหกรณ์ออมทรัพย์สาธารณสุขระยอง จำกัด"]]
        : [
            ["demo", "rycoopHR · ข้อมูลทดลอง"],
            ["other", "Isolation Test Workspace"],
          ])
        db.prepare("INSERT INTO tenants VALUES(?,?)").run(id, name);
      for (const [id, name, email, role] of production
        ? [["admin", "ผู้ดูแลระบบ", adminEmail, "admin"]]
        : [
            ["admin", "Demo Administrator", "admin@tomvis.demo", "admin"],
            ["staff", "Demo Staff", "staff@tomvis.demo", "staff"],
            ["viewer", "Demo Viewer", "viewer@tomvis.demo", "viewer"],
            ["ryadmin", "ผู้ดูแล rycoopHR", adminEmail, "admin"],
          ]) {
        db.prepare(
          "INSERT INTO users(id,email,name,password) VALUES(?,?,?,?)",
        ).run(id, email, name, hashPassword(password));
        db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
          id,
          production ? "rayong" : "demo",
          role,
        );
      }
      if (!production) {
        seed(db, "demo");
        seed(db, "other");
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  db.exec("BEGIN");
  try {
    for (const t of db.prepare("SELECT id FROM tenants").all())
      seedOrganization(db, t.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  extendedSchema(db);
  return db;
}
export function seed(db, tenant) {
  for (const [subject, category, status, priority] of [
    ["ปรับปรุงขั้นตอนการให้บริการ", "Service", "open", "high"],
    ["เพิ่มช่องทางติดต่อออนไลน์", "Suggestion", "in_progress", "medium"],
    ["ขอบคุณทีมงานสำหรับการดูแล", "Appreciation", "resolved", "low"],
    ["แจ้งปัญหาการเข้าสู่ระบบ", "Technical", "open", "high"],
    ["เสนอเพิ่มรายงานสรุปรายเดือน", "Suggestion", "in_progress", "medium"],
    ["ประสบการณ์ใช้งานที่ยอดเยี่ยม", "Appreciation", "resolved", "low"],
  ])
    db.prepare(
      "INSERT INTO feedback(tenant_id,subject,category,status,priority) VALUES(?,?,?,?,?)",
    ).run(tenant, subject, category, status, priority);
}
