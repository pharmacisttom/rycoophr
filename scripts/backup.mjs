import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
const mode = process.env.RYCOOP_MODE || "sandbox";
if (!["sandbox", "demo", "development", "production"].includes(mode))
  throw Error("Invalid mode");
mkdirSync("data/backups", { recursive: true });
const target = `data/backups/${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
const db = new DatabaseSync(`data/${mode}.sqlite`);
db.exec(`VACUUM INTO '${target}'`);
db.close();
console.log(target);
