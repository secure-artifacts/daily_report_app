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

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });
  const endpoint = normalizeEndpoint(
    process.env.CLOUD_SYNC_ENDPOINT ||
    process.env.CLOUDFLARE_SYNC_URL ||
    process.env.CLOUDFLARE_WORKER_URL ||
    ""
  );
  return send(res, 200, { ok: true, endpoint });
};
