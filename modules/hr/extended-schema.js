export function extendedSchema(db) {
  db.exec("BEGIN");
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(employees)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, definition] of [
      ["start_date", "TEXT NOT NULL DEFAULT ''"],
      ["end_date", "TEXT NOT NULL DEFAULT ''"],
      ["profile", "TEXT NOT NULL DEFAULT '{}'"],
    ]) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE employees ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_records(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),employee_id INTEGER NOT NULL REFERENCES employees(id),kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS salary_adjustments(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),employee_id INTEGER NOT NULL REFERENCES employees(id),old_salary INTEGER NOT NULL,new_salary INTEGER NOT NULL,percent REAL NOT NULL,effective_day TEXT NOT NULL,reason TEXT NOT NULL,status TEXT DEFAULT 'pending',created_by TEXT NOT NULL,approved_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),resource TEXT NOT NULL,resource_id INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,content BLOB NOT NULL,uploaded_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS board_meetings(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),committee TEXT NOT NULL,title TEXT NOT NULL,day TEXT NOT NULL,agenda TEXT NOT NULL,minutes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'scheduled',created_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meeting_participants(meeting_id INTEGER REFERENCES board_meetings(id),director_id INTEGER REFERENCES directors(id),status TEXT DEFAULT 'invited',note TEXT DEFAULT '',PRIMARY KEY(meeting_id,director_id));
      CREATE TABLE IF NOT EXISTS leave_entitlements(tenant_id TEXT REFERENCES tenants(id),employee_id INTEGER REFERENCES employees(id),year INTEGER NOT NULL,kind TEXT NOT NULL,days REAL NOT NULL,PRIMARY KEY(tenant_id,employee_id,year,kind));
      CREATE INDEX IF NOT EXISTS records_employee_scope ON employee_records(tenant_id,employee_id);
      CREATE INDEX IF NOT EXISTS attachments_resource_scope ON attachments(tenant_id,resource,resource_id);
      INSERT OR IGNORE INTO migrations VALUES(4);
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
