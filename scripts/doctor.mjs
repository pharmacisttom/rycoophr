import { existsSync } from "node:fs";
const mode = process.env.RYCOOP_MODE || "sandbox",
  production = mode === "production",
  checks = [
    [
      "Node 22.17+",
      Number(process.versions.node.split(".")[0]) > 22 ||
        (Number(process.versions.node.split(".")[0]) === 22 &&
          Number(process.versions.node.split(".")[1]) >= 17),
    ],
    ["Mode", ["sandbox", "demo", "development", "production"].includes(mode)],
    [
      "Bootstrap password",
      (
        process.env.RYCOOP_ADMIN_PASSWORD ||
        process.env.TOMVIS_DEMO_PASSWORD ||
        ""
      ).length >= 12,
    ],
    [
      "Production HTTPS",
      !production || /^https:\/\//.test(process.env.RYCOOP_ORIGIN || ""),
    ],
    [
      "Production TOTP key",
      !production || /^[a-f0-9]{64}$/i.test(process.env.RYCOOP_TOTP_KEY || ""),
    ],
    ["UI", existsSync("apps/public/hr-app.js")],
  ];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
