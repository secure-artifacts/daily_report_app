const crypto = require("crypto");

const maxBodyBytes = 16 * 1024;

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function expectedPasswords() {
  return [process.env.APP_PASSWORD, process.env.TEAM_SYNC_TOKEN].filter(Boolean).map(String);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hasValidPassword(password) {
  return expectedPasswords().some((expected) => safeEqual(password, expected));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body.trim() ? JSON.parse(req.body) : {};
  return await new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body.trim() ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET") {
      return send(res, 200, { ok: true, configured: expectedPasswords().length > 0 });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    if (!expectedPasswords().length) {
      return send(res, 503, { ok: false, configured: false, error: "Vercel has not configured APP_PASSWORD or TEAM_SYNC_TOKEN." });
    }
    const body = await readJson(req);
    if (!hasValidPassword(body.password)) return send(res, 401, { ok: false, error: "密码不正确" });
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 500, { ok: false, error: error.message || "Auth failed." });
  }
};
