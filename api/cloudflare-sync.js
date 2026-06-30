const maxBodyBytes = 8 * 1024 * 1024;

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function normalizeEndpoint(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\/+$/, "");
  text = text.replace(/\/api\/cloud-data$/i, "").replace(/\/cloud-data$/i, "");
  text = text.replace(/\/api\/app-auth$/i, "").replace(/\/app-auth$/i, "");
  return text.replace(/\/+$/, "");
}

function workerEndpoint() {
  return normalizeEndpoint(
    process.env.CLOUD_SYNC_ENDPOINT ||
    process.env.CLOUDFLARE_SYNC_URL ||
    process.env.CLOUDFLARE_WORKER_URL ||
    ""
  );
}

function normalizePath(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") ? path : "/" + path;
}

function isAllowedPath(path) {
  return ["/api/cloud-data", "/cloud-data", "/api/app-auth", "/app-auth"].includes(path);
}

function forwardedHeaders(req) {
  const headers = {};
  const contentType = req.headers["content-type"];
  if (contentType) headers["Content-Type"] = String(contentType);
  const teamToken = req.headers["x-team-token"];
  if (teamToken) headers["X-Team-Token"] = String(teamToken);
  const appPassword = req.headers["x-app-password"];
  if (appPassword) headers["X-App-Password"] = String(appPassword);
  return headers;
}

async function readRawBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    const endpoint = workerEndpoint();
    if (!endpoint) return send(res, 503, { ok: false, error: "CLOUD_SYNC_ENDPOINT is not configured." });
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const path = normalizePath(url.searchParams.get("path") || "");
    if (!isAllowedPath(path)) return send(res, 400, { ok: false, error: "Unsupported Cloudflare sync path." });
    const response = await fetch(endpoint + path, {
      method: req.method,
      headers: forwardedHeaders(req),
      body: req.method === "GET" ? undefined : await readRawBody(req)
    });
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch (error) {
    return send(res, 502, { ok: false, error: error.message || "Cloudflare sync proxy failed." });
  }
};
