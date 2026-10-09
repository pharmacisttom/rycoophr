import QRCode from "qrcode";
import {
  newSecret,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  recoveryDigest,
  recoveryCodes,
} from "../packages/security/totp.js";
import { hrRoutes } from "../modules/hr/routes.js";
import http from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDatabase, seed } from "../packages/database/index.js";
import { verifyPassword, redact } from "../packages/security/index.js";
import { can, roles } from "../packages/rbac/index.js";

export function createApp(
  db,
  {
    mode = "sandbox",
    origin = "http://localhost:3013",
    totpKey = randomBytes(32),
  } = {},
) {
  if (!["sandbox", "demo", "development", "production"].includes(mode))
    throw Error("Unsupported mode");
  const production = mode === "production";
  if (
    production &&
    (!origin.startsWith("https://") || !process.env.RYCOOP_TOTP_KEY)
  )
    throw Error("Production requires HTTPS origin and RYCOOP_TOTP_KEY");
  const loginAttempts = new Map();
  const loginIpLimits = new Map();
  const limits = new Map();
  const digest = (token) => createHash("sha256").update(token).digest("hex");
  const atomic = (run) => {
    db.exec("BEGIN");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    const reply = (status, data, error) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          error
            ? { success: false, error: { code: error, message: data } }
            : { success: true, data, meta: { request_id: requestId, mode } },
        ),
      );
    };
    const fail = (status, message) => {
      const e = new Error(message);
      e.status = status;
      throw e;
    };
    try {
      const hostname = (req.headers.host || "").split(":")[0];
      if (
        !(
          production ? [new URL(origin).hostname] : ["localhost", "127.0.0.1"]
        ).includes(hostname)
      )
        fail(403, "Local host required");
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/health")
        return reply(200, { status: "ok", version: "0.1.0" });
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET")
          return reply(405, "Method not allowed", "METHOD_NOT_ALLOWED");
        const files = {
          "/": "index.html",
          "/app.js": "hr-app.js",
          "/style.css": "style.css",
          "/mobile.js": "mobile.js",
          "/favicon.svg": "favicon.svg",
          "/favicon.ico": "favicon.svg",
        };
        const file = files[url.pathname];
        if (!file) return reply(404, "Not found", "NOT_FOUND");
        res.setHeader(
          "Content-Type",
          file.endsWith(".svg")
            ? "image/svg+xml"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".js")
                ? "text/javascript"
                : "text/html; charset=utf-8",
        );
        return res.end(
          readFileSync(
            fileURLToPath(new URL(`./public/${file}`, import.meta.url)),
          ),
        );
      }
      const now = Date.now();
      const ip = req.socket.remoteAddress;
      for (const [key, value] of limits)
        if (value.until < now) limits.delete(key);
      let bucket = limits.get(ip);
      if (!bucket) {
        bucket = { count: 0, until: now + 60000 };
        limits.set(ip, bucket);
      }
      if (++bucket.count > 120)
        return reply(429, "Too many requests", "RATE_LIMITED");
      if (["POST", "PATCH", "DELETE"].includes(req.method)) {
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail(403, "Cross-site request blocked");
        if (
          req.headers.origin !==
          (production ? origin : `http://${req.headers.host}`)
        )
          fail(403, "Origin rejected");
        if (!req.headers["content-type"]?.startsWith("application/json"))
          fail(415, "JSON required");
      }
      let body = {};
      if (["POST", "PATCH"].includes(req.method)) {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 2097152) fail(413, "Request too large");
        }
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          fail(400, "Invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(422, "Invalid body");
      }
      const token = req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("tv_session="))
        ?.slice(11);
      const user =
        token &&
        db
          .prepare(
            "SELECT u.id,u.name,u.email,u.disabled,s.tenant_id,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.tenant_id=s.tenant_id WHERE s.token=? AND s.expires_at>?",
          )
          .get(digest(token), now);
      const audit = (action, resource, id, oldValue, newValue, actor = user) =>
        db
          .prepare(
            "INSERT INTO audit_logs(tenant_id,actor,action,resource,resource_id,old_value,new_value,ip,user_agent,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            actor?.tenant_id || "demo",
            actor?.id || "anonymous",
            action,
            resource,
            String(id || ""),
            JSON.stringify(redact(oldValue ?? null)),
            JSON.stringify(redact(newValue ?? null)),
            ip,
            req.headers["user-agent"] || "",
            requestId,
          );
      if (url.pathname === "/api/v1/login" && req.method === "POST") {
        for (const [key, v] of loginIpLimits)
          if (v.until < now) loginIpLimits.delete(key);
        let loginBucket = loginIpLimits.get(ip);
        if (!loginBucket) {
          loginBucket = { count: 0, until: now + 60000 };
          loginIpLimits.set(ip, loginBucket);
        }
        if (++loginBucket.count > 20) fail(429, "Login rate limit reached");
        const attemptKey = String(body.email).toLowerCase();
        for (const [k, v] of loginAttempts)
          if (v.until < now) loginAttempts.delete(k);
        let attempts = loginAttempts.get(attemptKey);
        if (!attempts) {
          attempts = { count: 0, until: now + 900000 };
          loginAttempts.set(attemptKey, attempts);
        }
        if (++attempts.count > 10)
          fail(429, "ลองเข้าสู่ระบบอีกครั้งใน 15 นาที");
        if (
          typeof body.email !== "string" ||
          typeof body.password !== "string" ||
          body.password.length > 256
        )
          fail(422, "Invalid credentials");
        const account = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(body.email.trim().toLowerCase());
        if (
          !account ||
          account.disabled ||
          !verifyPassword(body.password, account.password)
        ) {
          audit("login.failed", "session", "", null, null);
          fail(401, "Email or password incorrect");
        }
        const factor = db
          .prepare("SELECT * FROM user_totp WHERE user_id=? AND enabled=1")
          .get(account.id);
        let verifiedCounter = null,
          recovery = null;
        if (factor) {
          verifiedCounter = verifyTotp(
            decryptSecret(factor.secret, totpKey),
            body.code,
            factor.last_counter,
          );
          if (
            verifiedCounter === null &&
            typeof body.recovery_code === "string"
          ) {
            recovery = recoveryDigest(body.recovery_code);
            if (
              !db
                .prepare(
                  "SELECT digest FROM recovery_codes WHERE user_id=? AND digest=?",
                )
                .get(account.id, recovery)
            )
              recovery = null;
          }
          if (verifiedCounter === null && !recovery) {
            audit("login.2fa_failed", "session", "", null, null, {
              id: account.id,
              tenant_id: "demo",
            });
            return reply(
              401,
              "กรอกรหัส Google Authenticator หรือรหัสกู้คืน",
              "TWO_FACTOR_REQUIRED",
            );
          }
        }
        const member = db
          .prepare(
            "SELECT * FROM memberships WHERE user_id=? ORDER BY tenant_id LIMIT 1",
          )
          .get(account.id);
        if (!member) fail(403, "No workspace membership");
        const session = randomBytes(32).toString("hex");
        atomic(() => {
          if (verifiedCounter !== null)
            db.prepare(
              "UPDATE user_totp SET last_counter=? WHERE user_id=?",
            ).run(verifiedCounter, account.id);
          if (recovery)
            db.prepare(
              "DELETE FROM recovery_codes WHERE user_id=? AND digest=?",
            ).run(account.id, recovery);
          db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
          db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
            digest(session),
            account.id,
            member.tenant_id,
            now + 8 * 3600000,
          );
          audit("login.success", "session", "", null, null, {
            id: account.id,
            tenant_id: member.tenant_id,
          });
        });
        loginAttempts.delete(attemptKey);
        res.setHeader(
          "Set-Cookie",
          `tv_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? "; Secure" : ""}`,
        );
        return reply(200, { name: account.name });
      }
      if (!user || user.disabled) fail(401, "Please sign in");
      const requirePermission = (p) => {
        if (!can(user.role, p)) fail(403, "Permission denied");
      };
      if (url.pathname === "/api/v1/me" && req.method === "GET")
        return reply(200, {
          ...user,
          roles,
          mode,
          totp_enabled: Boolean(
            db
              .prepare("SELECT enabled FROM user_totp WHERE user_id=?")
              .get(user.id)?.enabled,
          ),
          totp_required:
            (user.role === "admin" || user.role === "super_admin") &&
            (production || user.email === "pharmacisttom@gmail.com"),
          workspace: db
            .prepare("SELECT name FROM tenants WHERE id=?")
            .get(user.tenant_id).name,
        });
      if (url.pathname === "/api/v1/logout" && req.method === "POST") {
        atomic(() => {
          db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
          audit("logout", "session", "", null, null);
        });
        res.setHeader(
          "Set-Cookie",
          "tv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return reply(200, {});
      }
      const factor = db
        .prepare("SELECT * FROM user_totp WHERE user_id=?")
        .get(user.id);
      if (url.pathname === "/api/v1/2fa/setup" && req.method === "POST") {
        if (factor?.enabled) fail(409, "2FA เปิดใช้งานแล้ว");
        if (
          typeof body.password !== "string" ||
          !verifyPassword(
            body.password,
            db.prepare("SELECT password FROM users WHERE id=?").get(user.id)
              .password,
          )
        )
          fail(401, "รหัสผ่านไม่ถูกต้อง");
        const secret = newSecret();
        db.prepare(
          "INSERT INTO user_totp(user_id,secret,pending_expires) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,pending_expires=excluded.pending_expires,last_counter=-1",
        ).run(user.id, encryptSecret(secret, totpKey), now + 600000);
        const uri = `otpauth://totp/${encodeURIComponent("rycoopHR:" + user.email)}?secret=${secret}&issuer=rycoopHR&algorithm=SHA1&digits=6&period=30`;
        return reply(200, {
          secret,
          qr_svg: await QRCode.toString(uri, { type: "svg" }),
          expires_in: 600,
        });
      }
      if (url.pathname === "/api/v1/2fa/confirm" && req.method === "POST") {
        if (!factor || factor.enabled || factor.pending_expires < now)
          fail(409, "เริ่มตั้งค่า 2FA ใหม่");
        const counter = verifyTotp(
          decryptSecret(factor.secret, totpKey),
          body.code,
        );
        if (counter === null) fail(422, "รหัส 2FA ไม่ถูกต้อง");
        const codes = recoveryCodes();
        atomic(() => {
          db.prepare(
            "UPDATE user_totp SET enabled=1,last_counter=?,pending_expires=NULL WHERE user_id=?",
          ).run(counter, user.id);
          for (const code of codes)
            db.prepare("INSERT INTO recovery_codes VALUES(?,?)").run(
              user.id,
              recoveryDigest(code),
            );
          db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(
            user.id,
            digest(token),
          );
          audit("2fa.enabled", "user", user.id, null, { enabled: true });
        });
        return reply(200, { recovery_codes: codes });
      }
      if (
        (user.role === "admin" || user.role === "super_admin") &&
        (production || user.email === "pharmacisttom@gmail.com") &&
        !factor?.enabled
      )
        fail(403, "ต้องเปิดใช้ Google Authenticator ก่อนใช้งานระบบแอดมิน");
      if (
        await hrRoutes({
          url,
          req,
          body,
          user,
          db,
          reply,
          fail,
          requirePermission,
          atomic,
          audit,
        })
      )
        return;
      if (url.pathname === "/api/v1/feedback" && req.method === "GET") {
        requirePermission("feedback.view");
        const q = (url.searchParams.get("q") || "").slice(0, 200);
        return reply(
          200,
          db
            .prepare(
              "SELECT id,subject,category,status,priority,created_at FROM feedback WHERE tenant_id=? AND subject LIKE ? ORDER BY id DESC LIMIT 100",
            )
            .all(user.tenant_id, `%${q}%`),
        );
      }
      if (url.pathname === "/api/v1/feedback" && req.method === "POST") {
        requirePermission("feedback.manage");
        if (
          typeof body.subject !== "string" ||
          !body.subject.trim() ||
          body.subject.length > 200 ||
          !["Service", "Suggestion", "Appreciation", "Technical"].includes(
            body.category,
          ) ||
          !["low", "medium", "high"].includes(body.priority)
        )
          fail(422, "Invalid feedback");
        const result = atomic(() => {
          const row = db
            .prepare(
              "INSERT INTO feedback(tenant_id,subject,category,status,priority) VALUES(?,?,?,?,?)",
            )
            .run(
              user.tenant_id,
              body.subject.trim(),
              body.category,
              "open",
              body.priority,
            );
          audit("feedback.created", "feedback", row.lastInsertRowid, null, {
            subject: body.subject.trim(),
            category: body.category,
            priority: body.priority,
          });
          return row;
        });
        return reply(201, { id: Number(result.lastInsertRowid) });
      }
      const match = url.pathname.match(/^\/api\/v1\/feedback\/(\d+)$/);
      if (match && req.method === "PATCH") {
        requirePermission("feedback.manage");
        if (!["open", "in_progress", "resolved"].includes(body.status))
          fail(422, "Invalid status");
        const old = db
          .prepare("SELECT * FROM feedback WHERE id=? AND tenant_id=?")
          .get(match[1], user.tenant_id);
        if (!old) fail(404, "Feedback not found");
        atomic(() => {
          db.prepare(
            "UPDATE feedback SET status=? WHERE id=? AND tenant_id=?",
          ).run(body.status, match[1], user.tenant_id);
          audit("feedback.updated", "feedback", match[1], old, {
            status: body.status,
          });
        });
        return reply(200, {});
      }
      if (url.pathname === "/api/v1/users" && req.method === "GET") {
        requirePermission("users.view");
        return reply(
          200,
          db
            .prepare(
              "SELECT u.name,u.email,m.role,u.disabled FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=?",
            )
            .all(user.tenant_id),
        );
      }
      if (url.pathname === "/api/v1/audit" && req.method === "GET") {
        requirePermission("audit.view");
        return reply(
          200,
          db
            .prepare(
              "SELECT actor,action,resource,timestamp,request_id FROM audit_logs WHERE tenant_id=? ORDER BY id DESC LIMIT 100",
            )
            .all(user.tenant_id),
        );
      }
      if (url.pathname === "/api/v1/sandbox/reset" && req.method === "POST") {
        if (production)
          fail(403, "Sandbox reset unavailable on deployed systems");
        requirePermission("sandbox.reset");
        if (body.confirm !== "RESET") fail(422, "Confirmation required");
        db.exec("BEGIN");
        try {
          db.prepare("DELETE FROM feedback WHERE tenant_id=?").run(
            user.tenant_id,
          );
          seed(db, user.tenant_id);
          audit("sandbox.reset", "tenant", user.tenant_id, null, {
            synthetic: true,
          });
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return reply(200, {});
      }
      return reply(404, "Not found", "NOT_FOUND");
    } catch (e) {
      if (e.code?.startsWith("SQLITE_CONSTRAINT")) {
        e.status = 409;
        e.message = "ข้อมูลซ้ำหรือไม่สัมพันธ์กัน";
      }
      reply(
        e.status || 500,
        e.status ? e.message : "Internal server error",
        `HTTP_${e.status || 500}`,
      );
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.env.RYCOOP_MODE || process.env.TOMVIS_MODE || "sandbox",
    production = mode === "production";
  const password =
    process.env.RYCOOP_ADMIN_PASSWORD || process.env.TOMVIS_DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw Error("Set RYCOOP_ADMIN_PASSWORD (12+ characters)");
  mkdirSync("data", { recursive: true });
  let key;
  if (production) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.RYCOOP_TOTP_KEY || ""))
      throw Error("Set RYCOOP_TOTP_KEY: 64 hex characters");
    key = Buffer.from(process.env.RYCOOP_TOTP_KEY, "hex");
  } else {
    const path = "data/totp.key";
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32), { mode: 0o600 });
    key = readFileSync(path);
  }
  const db = createDatabase(`data/${mode}.sqlite`, password, { production });
  createApp(db, {
    mode,
    origin: process.env.RYCOOP_ORIGIN,
    totpKey: key,
  }).listen(
    Number(process.env.PORT || 3013),
    process.env.RYCOOP_BIND || "127.0.0.1",
    () =>
      console.log(
        `rycoopHR ${mode} listening on port ${process.env.PORT || 3013}`,
      ),
  );
}
