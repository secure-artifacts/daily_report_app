const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const dataFile = process.env.DATA_FILE || path.join(dataDir, "report_data.json");
const port = Number(process.env.PORT || 8787);
const maxBodyBytes = 10 * 1024 * 1024;

const defaultData = {
  version: 2,
  updated_at: "",
  quota: 3,
  rules: { "视频": 1, "音频": 1, "字幕": 0.25, "图片": 0 },
  members: ["成员A"],
  groups: ["1组"],
  memberGroups: { "成员A": "1组" },
  groupItems: {},
  memberItems: {},
  memberQuotas: {},
  dailyQuotas: {},
  monthlyPlans: {},
  fbSpecialties: [],
  checkinOptions: ["\u4e0a\u7ebf", "\u8bf7\u5047", "\u71ac\u591c\u8fdf\u5230"],
  adminPassword: "",
  sheetBackupEnabled: true,
  backupCleanupEnabled: false,
  autoUpdateEnabled: false,
  autoAudit: true,
  reviewMessages: {
    pass: ["恭喜达标", "今天很稳", "继续保持", "漂亮完成", "节奏很好", "进步明显", "状态在线", "效率不错", "超额很棒", "明天继续"],
    fail: ["很遗憾不达标", "明天补上", "先找原因", "差一点点", "继续加油", "调整节奏", "补救计划", "稳住再来", "目标明确", "别断复盘"]
  },
  records: {}
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCheckinStatus(status) {
  const text = String(status || "").trim();
  if (text === "\u51c6\u65f6\u4e0a\u7ebf") return "\u4e0a\u7ebf";
  if (text === "\u8fdf\u5230") return "\u71ac\u591c\u8fdf\u5230";
  return text;
}

function recordKeyParts(key = "") {
  const [date = "", ...memberParts] = String(key || "").split("|");
  return { date, member: memberParts.join("|") };
}

function normalizeRecordMap(records = {}) {
  const normalized = {};
  Object.entries(records || {}).forEach(([key, record]) => {
    if (!record || typeof record !== "object") return;
    const fallback = recordKeyParts(key);
    const date = String(record.date || fallback.date || "").trim();
    const member = String(record.member || fallback.member || "").trim();
    if (!date || !member) return;
    normalized[`${date}|${member}`] = { ...record, date, member };
  });
  return normalized;
}

function normalize(source) {
  const loaded = source && typeof source === "object" ? source : {};
  const data = { ...clone(defaultData), ...loaded };
  data.version = 2;
  data.members = Array.isArray(data.members) && data.members.length ? data.members.map(String) : ["成员A"];
  data.groups = Array.isArray(data.groups) && data.groups.length ? data.groups.map(String) : ["1组"];
  data.rules = data.rules && typeof data.rules === "object" ? data.rules : clone(defaultData.rules);
  data.memberGroups = data.memberGroups && typeof data.memberGroups === "object" ? data.memberGroups : {};
  data.groupItems = data.groupItems && typeof data.groupItems === "object" ? data.groupItems : {};
  data.memberItems = data.memberItems && typeof data.memberItems === "object" ? data.memberItems : {};
  data.memberQuotas = data.memberQuotas && typeof data.memberQuotas === "object" ? data.memberQuotas : {};
  data.dailyQuotas = data.dailyQuotas && typeof data.dailyQuotas === "object" ? data.dailyQuotas : {};
  data.monthlyPlans = data.monthlyPlans && typeof data.monthlyPlans === "object" ? data.monthlyPlans : {};
  data.fbSpecialties = Array.isArray(data.fbSpecialties) ? data.fbSpecialties : [];
  data.checkinOptions = Array.isArray(data.checkinOptions) && data.checkinOptions.length
    ? Array.from(new Set(data.checkinOptions.map(normalizeCheckinStatus).filter(Boolean)))
    : clone(defaultData.checkinOptions);
  data.records = normalizeRecordMap(data.records && typeof data.records === "object" ? data.records : {});
  data.adminPassword = String(data.adminPassword || "");
  data.updated_at = String(data.updated_at || "");
  data.members.forEach((member) => {
    if (!data.memberGroups[member]) data.memberGroups[member] = data.groups[0];
  });
  data.groups.forEach((group) => {
    if (!Array.isArray(data.groupItems[group])) data.groupItems[group] = Object.keys(data.rules);
  });
  return data;
}

function readData() {
  try {
    if (!fs.existsSync(dataFile)) return normalize(defaultData);
    return normalize(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  } catch {
    return normalize(defaultData);
  }
}

function writeData(data) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const normalized = normalize({ ...data, updated_at: new Date().toISOString() });
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalized, null, 2));
  fs.renameSync(tempFile, dataFile);
  return normalized;
}

function passwordCandidates(data) {
  return new Set([data.adminPassword, process.env.APP_PASSWORD, process.env.TEAM_SYNC_TOKEN].filter(Boolean).map(String));
}

function isAuthorized(req, data, bodyPassword = "") {
  const headerPassword = req.headers["x-app-password"] || "";
  return passwordCandidates(data).has(String(bodyPassword || headerPassword));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function normalizeSyncEndpoint(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\/+$/, "");
  text = text.replace(/\/api\/cloud-data$/i, "").replace(/\/cloud-data$/i, "");
  text = text.replace(/\/api\/app-auth$/i, "").replace(/\/app-auth$/i, "");
  return text.replace(/\/+$/, "");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, pathname) {
  const data = readData();
  if (pathname === "/api/sync-config" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      endpoint: normalizeSyncEndpoint(process.env.CLOUD_SYNC_ENDPOINT || process.env.CLOUDFLARE_SYNC_URL || process.env.CLOUDFLARE_WORKER_URL || "")
    });
  }
  if (pathname === "/api/app-auth" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, configured: Boolean(process.env.APP_PASSWORD || process.env.TEAM_SYNC_TOKEN || data.adminPassword) });
  }
  if (pathname === "/api/app-auth" && req.method === "POST") {
    const body = await readBody(req);
    if (!isAuthorized(req, data, body.password)) return sendJson(res, 401, { ok: false, error: "密码不正确" });
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === "/api/unlock" && req.method === "POST") {
    const body = await readBody(req);
    if (!isAuthorized(req, data, body.password)) return sendJson(res, 401, { error: "密码不正确" });
    return sendJson(res, 200, { data });
  }
  if (pathname === "/api/data" && req.method === "GET") {
    if (!isAuthorized(req, data)) return sendJson(res, 401, { error: "未授权" });
    return sendJson(res, 200, { data });
  }
  if (pathname === "/api/data" && req.method === "PUT") {
    if (!isAuthorized(req, data)) return sendJson(res, 401, { error: "未授权" });
    const body = await readBody(req);
    const next = writeData(body.data || body);
    return sendJson(res, 200, { data: next });
  }
  return sendJson(res, 404, { error: "接口不存在" });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(rootDir, `.${decodeURIComponent(requested)}`);
  const insideRoot = resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`);
  if (!insideRoot || resolved === dataFile || resolved.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403, { "Cache-Control": "no-store" });
    return res.end("Forbidden");
  }
  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": contentType(resolved),
      "Cache-Control": "no-store"
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Cache-Control": "no-store" });
      return res.end("Method not allowed");
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "服务器错误" });
  }
});

server.listen(port, () => {
  console.log(`Daily report web app: http://localhost:${port}`);
  console.log(`Data file: ${dataFile}`);
});
