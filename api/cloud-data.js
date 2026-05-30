const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const maxBodyBytes = 8 * 1024 * 1024;
let schemaReady = false;

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
  checkinOptions: ["\u4e0a\u7ebf", "\u8bf7\u5047", "\u71ac\u591c\u8fdf\u5230"],
  adminPassword: "999",
  sheetBackupEnabled: true,
  backupCleanupEnabled: false,
  autoAudit: true,
  deletedMembers: {},
  reviewMessages: {
    pass: ["恭喜达标", "今天很稳", "继续保持", "漂亮完成", "节奏很好", "进步明显", "状态在线", "效率不错", "超额很棒", "明天继续"],
    fail: ["很遗憾不达标", "明天补上", "先找原因", "差一点点", "继续加油", "调整节奏", "补救计划", "稳住再来", "目标明确", "别断复盘"]
  },
  records: {}
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function normalizeCheckinStatus(status) {
  const text = String(status || "").trim();
  if (text === "\u51c6\u65f6\u4e0a\u7ebf") return "\u4e0a\u7ebf";
  if (text === "\u8fdf\u5230") return "\u71ac\u591c\u8fdf\u5230";
  return text;
}

function normalizeCheckinOptions(options) {
  const source = Array.isArray(options) && options.length ? options : defaultData.checkinOptions;
  return Array.from(new Set(source.map(normalizeCheckinStatus).filter(Boolean)));
}

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function authTokens(extraTokens = []) {
  return [
    process.env.TEAM_SYNC_TOKEN,
    process.env.APP_PASSWORD,
    process.env.CLOUD_BACKUP_TOKEN,
    process.env.BACKUP_TOKEN,
    ...extraTokens
  ].filter(Boolean).map(String);
}

function hasValidToken(req, extraTokens = []) {
  const expected = authTokens(extraTokens);
  const received = String(req.headers["x-team-token"] || req.headers["x-app-password"] || req.headers["x-backup-token"] || "");
  if (!expected.length || !received) return false;
  return expected.some((token) => {
    const left = Buffer.from(received);
    const right = Buffer.from(token);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

function digestData(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function safeDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function dataStats(data) {
  return {
    recordCount: Object.keys(data?.records || {}).length,
    memberCount: Array.isArray(data?.members) ? data.members.length : 0,
    groupCount: Array.isArray(data?.groups) ? data.groups.length : 0,
    clientUpdatedAt: safeDate(data?.updated_at)
  };
}

function normalize(source) {
  const loaded = source && typeof source === "object" ? source : {};
  const members = Array.isArray(loaded.members) && loaded.members.length ? loaded.members.map(String) : ["成员A"];
  const groups = Array.isArray(loaded.groups) && loaded.groups.length ? loaded.groups.map(String) : ["1组"];
  const memberGroups = { ...(loaded.memberGroups || {}) };
  const groupItems = { ...(loaded.groupItems || {}) };
  const memberItems = { ...(loaded.memberItems || {}) };
  const rules = loaded.rules && typeof loaded.rules === "object" ? loaded.rules : clone(defaultData.rules);
  members.forEach((name) => {
    if (!memberGroups[name]) memberGroups[name] = groups[0];
  });
  groups.forEach((group) => {
    if (!Array.isArray(groupItems[group])) groupItems[group] = Object.keys(rules);
  });
  const checkinOptions = normalizeCheckinOptions(loaded.checkinOptions);
  return {
    ...clone(defaultData),
    ...loaded,
    version: 2,
    quota: Number(loaded.quota ?? defaultData.quota),
    rules,
    members,
    groups,
    memberGroups,
    groupItems,
    memberItems,
    memberQuotas: loaded.memberQuotas && typeof loaded.memberQuotas === "object" ? clone(loaded.memberQuotas) : {},
    dailyQuotas: loaded.dailyQuotas && typeof loaded.dailyQuotas === "object" ? clone(loaded.dailyQuotas) : {},
    checkinOptions,
    adminPassword: String(loaded.adminPassword || process.env.APP_PASSWORD || defaultData.adminPassword),
    sheetBackupEnabled: loaded.sheetBackupEnabled !== false,
    backupCleanupEnabled: loaded.backupCleanupEnabled === true,
    autoAudit: loaded.autoAudit !== false,
    deletedMembers: loaded.deletedMembers && typeof loaded.deletedMembers === "object" ? clone(loaded.deletedMembers) : {},
    reviewMessages: {
      pass: Array.isArray(loaded.reviewMessages?.pass) ? loaded.reviewMessages.pass : clone(defaultData.reviewMessages.pass),
      fail: Array.isArray(loaded.reviewMessages?.fail) ? loaded.reviewMessages.fail : clone(defaultData.reviewMessages.fail)
    },
    records: loaded.records && typeof loaded.records === "object" ? loaded.records : {}
  };
}

function newerRecord(a, b, prefer = "first") {
  if (!a) return b;
  if (!b) return a;
  const left = String(a.updated_at || "");
  const right = String(b.updated_at || "");
  if (left === right) return prefer === "second" ? b : a;
  return left > right ? a : b;
}

function mergeDailyQuotas(remoteDaily = {}, localDaily = {}, mode = "records") {
  const merged = {};
  const days = new Set([...Object.keys(remoteDaily || {}), ...Object.keys(localDaily || {})]);
  days.forEach((day) => {
    const remote = remoteDaily?.[day] || {};
    const local = localDaily?.[day] || {};
    merged[day] = {
      default: mode === "admin" ? (local.default ?? "") : (remote.default ?? local.default ?? ""),
      members: {
        ...(remote.members || {}),
        ...(local.members || {})
      }
    };
  });
  return merged;
}

function mergeCloudData(remoteSource, localSource, mode = "records") {
  if (!remoteSource) return normalize(localSource);
  const remote = normalize(remoteSource);
  const local = normalize(localSource);
  const merged = mode === "admin" ? { ...remote, ...local } : { ...local, ...remote };
  merged.records = { ...remote.records, ...local.records };
  Object.keys(merged.records).forEach((key) => {
    merged.records[key] = newerRecord(remote.records[key], local.records[key], "second");
  });
  if (mode === "admin") {
    merged.rules = clone(local.rules);
    merged.members = clone(local.members);
    merged.groups = clone(local.groups || []);
    merged.memberGroups = clone(local.memberGroups || {});
    merged.groupItems = clone(local.groupItems || {});
    merged.memberItems = clone(local.memberItems || {});
    merged.memberQuotas = clone(local.memberQuotas || {});
    merged.dailyQuotas = mergeDailyQuotas(remote.dailyQuotas, local.dailyQuotas, mode);
    merged.checkinOptions = clone(local.checkinOptions || defaultData.checkinOptions);
    merged.quota = Number(local.quota || 0);
    merged.adminPassword = String(local.adminPassword || process.env.APP_PASSWORD || "999");
    merged.sheetBackupEnabled = local.sheetBackupEnabled !== false;
    merged.backupCleanupEnabled = local.backupCleanupEnabled === true;
    merged.autoAudit = local.autoAudit !== false;
    merged.deletedMembers = clone(local.deletedMembers || {});
    merged.reviewMessages = clone(local.reviewMessages || defaultData.reviewMessages);
  } else {
    merged.rules = clone(remote.rules || local.rules);
    merged.members = clone(remote.members || local.members);
    merged.groups = clone(remote.groups || local.groups || ["1组"]);
    merged.memberGroups = clone(remote.memberGroups || local.memberGroups || {});
    merged.groupItems = clone(remote.groupItems || local.groupItems || {});
    merged.memberItems = clone(remote.memberItems || local.memberItems || {});
    merged.memberQuotas = clone(remote.memberQuotas || local.memberQuotas || {});
    merged.dailyQuotas = mergeDailyQuotas(remote.dailyQuotas, local.dailyQuotas, mode);
    merged.checkinOptions = clone(remote.checkinOptions || local.checkinOptions || defaultData.checkinOptions);
    merged.quota = Number(remote.quota ?? local.quota ?? 0);
    merged.adminPassword = String(remote.adminPassword || local.adminPassword || process.env.APP_PASSWORD || "999");
    merged.sheetBackupEnabled = remote.sheetBackupEnabled !== false;
    merged.backupCleanupEnabled = remote.backupCleanupEnabled === true;
    merged.autoAudit = remote.autoAudit !== false;
    merged.deletedMembers = { ...(local.deletedMembers || {}), ...(remote.deletedMembers || {}) };
    merged.reviewMessages = clone(remote.reviewMessages || local.reviewMessages || defaultData.reviewMessages);
  }
  Object.keys(merged.records || {}).forEach((key) => {
    const member = merged.records[key]?.member || String(key).split("|").slice(1).join("|");
    if (merged.deletedMembers?.[member]) delete merged.records[key];
  });
  merged.updated_at = new Date().toISOString();
  return normalize(merged);
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
        reject(new Error("请求体过大，云同步单次最多 8MB。"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body.trim() ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function database() {
  const url = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return null;
  return neon(url);
}

async function ensureSchema(sql) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_state (
      id TEXT PRIMARY KEY,
      latest_backup_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_updated_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'team-sync',
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_events (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'records',
      source TEXT NOT NULL DEFAULT 'team-sync',
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS daily_report_cloud_events_created_at ON daily_report_cloud_events (created_at DESC)`;
  schemaReady = true;
}

async function readState(sql) {
  const rows = await sql`
    SELECT updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data
    FROM daily_report_cloud_state
    WHERE id = 'latest'
    LIMIT 1
  `;
  return rows[0] || null;
}

function publicStateMeta(state) {
  if (!state) return null;
  return {
    updated_at: state.updated_at,
    client_updated_at: state.client_updated_at,
    source: state.source,
    record_count: Number(state.record_count || 0),
    member_count: Number(state.member_count || 0),
    group_count: Number(state.group_count || 0),
    data_sha256: state.data_sha256
  };
}

async function writeState(sql, nextData, source = "team-sync", actor = "", mode = "records") {
  const normalized = normalize(nextData);
  normalized.updated_at = new Date().toISOString();
  const json = JSON.stringify(normalized);
  const sha = digestData(normalized);
  const stats = dataStats(normalized);
  const eventId = `event_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  await sql`
    INSERT INTO daily_report_cloud_state
      (id, updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data)
    VALUES
      ('latest', NOW(), ${stats.clientUpdatedAt}, ${source}, ${stats.recordCount}, ${stats.memberCount}, ${stats.groupCount}, ${sha}, ${json}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      updated_at = NOW(),
      client_updated_at = EXCLUDED.client_updated_at,
      source = EXCLUDED.source,
      record_count = EXCLUDED.record_count,
      member_count = EXCLUDED.member_count,
      group_count = EXCLUDED.group_count,
      data_sha256 = EXCLUDED.data_sha256,
      data = EXCLUDED.data
  `;
  await sql`
    INSERT INTO daily_report_cloud_events
      (id, actor, mode, source, record_count, member_count, group_count, data_sha256, data)
    VALUES
      (${eventId}, ${String(actor || "").slice(0, 80)}, ${String(mode || "records").slice(0, 30)}, ${source}, ${stats.recordCount}, ${stats.memberCount}, ${stats.groupCount}, ${sha}, ${json}::jsonb)
  `;
  return {
    data: normalized,
    meta: {
      event_id: eventId,
      updated_at: new Date().toISOString(),
      client_updated_at: stats.clientUpdatedAt,
      source,
      record_count: stats.recordCount,
      member_count: stats.memberCount,
      group_count: stats.groupCount,
      data_sha256: sha
    }
  };
}

function publicEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    actor: row.actor || "",
    mode: row.mode || "records",
    source: row.source || "team-sync",
    record_count: Number(row.record_count || 0),
    member_count: Number(row.member_count || 0),
    group_count: Number(row.group_count || 0),
    data_sha256: row.data_sha256
  };
}

async function listEvents(sql) {
  const rows = await sql`
    SELECT id, created_at, actor, mode, source, record_count, member_count, group_count, data_sha256
    FROM daily_report_cloud_events
    ORDER BY created_at DESC
    LIMIT 80
  `;
  return rows.map(publicEvent);
}

async function restoreEvent(sql, eventId) {
  const rows = await sql`
    SELECT id, created_at, actor, mode, source, record_count, member_count, group_count, data_sha256, data
    FROM daily_report_cloud_events
    WHERE id = ${eventId}
    LIMIT 1
  `;
  if (!rows[0]) {
    const error = new Error("没有找到这个历史版本。");
    error.statusCode = 404;
    throw error;
  }
  const saved = await writeState(sql, rows[0].data, "history-restore", `恢复:${rows[0].actor || rows[0].id}`, "admin");
  return { ...saved, restored: publicEvent(rows[0]) };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && !req.headers["x-team-token"] && !req.headers["x-app-password"] && !req.headers["x-backup-token"]) {
      return send(res, 200, {
        ok: true,
        configured: Boolean(database()),
        protected: authTokens().length > 0
      });
    }
    if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    const sql = database();
    if (!sql) return send(res, 503, { ok: false, error: "Vercel 还没有配置 DATABASE_URL 或 POSTGRES_URL。" });
    await ensureSchema(sql);
    const state = await readState(sql);
    const statePassword = state?.data?.adminPassword ? String(state.data.adminPassword) : "";
    if (!authTokens([statePassword]).length) return send(res, 503, { ok: false, error: "Vercel 还没有配置 TEAM_SYNC_TOKEN 或 APP_PASSWORD。" });
    if (!hasValidToken(req, [statePassword])) return send(res, 401, { ok: false, error: "云同步口令不正确。" });

    if (req.method === "GET") {
      return send(res, 200, {
        ok: true,
        data: state?.data || null,
        meta: publicStateMeta(state)
      });
    }

    const body = await readJson(req);
    const action = String(body.action || "save");
    if (action === "pull") {
      return send(res, 200, { ok: true, data: state?.data || null, meta: publicStateMeta(state) });
    }
    if (action === "history") {
      return send(res, 200, { ok: true, events: await listEvents(sql) });
    }
    if (action === "restore_history") {
      if (!body.eventId) return send(res, 400, { ok: false, error: "缺少历史版本 ID。" });
      return send(res, 200, { ok: true, ...(await restoreEvent(sql, String(body.eventId))) });
    }
    if (action === "save") {
      if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
        return send(res, 400, { ok: false, error: "缺少可同步的数据。" });
      }
      const merged = mergeCloudData(state?.data || null, body.data, body.mode === "admin" ? "admin" : "records");
      const saved = await writeState(sql, merged, body.mode === "admin" ? "admin-sync" : "team-sync", body.actor || "", body.mode === "admin" ? "admin" : "records");
      return send(res, 200, { ok: true, ...saved });
    }
    return send(res, 400, { ok: false, error: "未知云同步动作。" });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "云同步失败。" });
  }
};
