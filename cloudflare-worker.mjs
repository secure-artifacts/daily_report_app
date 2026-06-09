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
  checkinOptions: ["上线", "请假", "熬夜迟到"],
  adminPassword: "",
  sheetBackupEnabled: true,
  backupCleanupEnabled: false,
  autoAudit: false,
  deletedMembers: {},
  reviewMessages: {
    pass: ["恭喜达标", "今天很稳", "继续保持"],
    fail: ["很遗憾不达标", "明天补上", "先找原因"]
  },
  records: {}
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Team-Token,X-App-Password",
  "Access-Control-Max-Age": "86400"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function readJson(request) {
  if (!request.body) return {};
  return request.json();
}

function authTokens(env) {
  return [env.APP_PASSWORD, env.TEAM_SYNC_TOKEN].filter(Boolean).map(String);
}

function tokenFromRequest(request) {
  return String(request.headers.get("X-Team-Token") || request.headers.get("X-App-Password") || "").trim();
}

function hasValidToken(request, env, bodyPassword = "") {
  const tokens = authTokens(env);
  const token = String(bodyPassword || tokenFromRequest(request)).trim();
  return Boolean(token && tokens.includes(token));
}

function sanitizeCheckins(checkins = {}) {
  const result = {};
  ["morning", "afternoon", "evening"].forEach((slot) => {
    const source = checkins?.[slot] || {};
    result[slot] = {
      status: String(source.status || "").trim(),
      time: source.time ? String(source.time) : "",
      updated_at: source.updated_at ? String(source.updated_at) : ""
    };
  });
  return result;
}

function normalizeRecordMap(records = {}, rules = defaultData.rules) {
  const normalized = {};
  Object.entries(records || {}).forEach(([key, record]) => {
    if (!record || typeof record !== "object") return;
    const date = String(record.date || String(key).split("|")[0] || "").trim();
    const member = String(record.member || String(key).split("|").slice(1).join("|") || "").trim();
    if (!date || !member) return;
    const items = {};
    Object.keys(rules || {}).forEach((name) => {
      items[name] = Number(record.items?.[name] || 0);
    });
    const next = {
      date,
      member,
      items,
      raw_total: Number(record.raw_total || 0),
      weighted_total: Number(record.weighted_total || 0),
      status: String(record.status || "待审核"),
      reason: String(record.reason || ""),
      harvest: String(record.harvest || ""),
      diary: String(record.diary || ""),
      checkins: sanitizeCheckins(record.checkins || {}),
      updated_at: record.updated_at || ""
    };
    const nextKey = `${date}|${member}`;
    normalized[nextKey] = normalized[nextKey] ? newerRecord(normalized[nextKey], next, "second", rules) : next;
  });
  return normalized;
}

function normalize(loaded = {}) {
  const rules = loaded.rules && typeof loaded.rules === "object" ? clone(loaded.rules) : clone(defaultData.rules);
  const groups = Array.isArray(loaded.groups) && loaded.groups.length ? loaded.groups.map(String) : clone(defaultData.groups);
  const members = Array.isArray(loaded.members) && loaded.members.length ? loaded.members.map(String) : clone(defaultData.members);
  return {
    ...clone(defaultData),
    ...clone(loaded || {}),
    rules,
    groups,
    members,
    memberGroups: loaded.memberGroups && typeof loaded.memberGroups === "object" ? clone(loaded.memberGroups) : {},
    groupItems: loaded.groupItems && typeof loaded.groupItems === "object" ? clone(loaded.groupItems) : {},
    memberItems: loaded.memberItems && typeof loaded.memberItems === "object" ? clone(loaded.memberItems) : {},
    memberQuotas: loaded.memberQuotas && typeof loaded.memberQuotas === "object" ? clone(loaded.memberQuotas) : {},
    dailyQuotas: loaded.dailyQuotas && typeof loaded.dailyQuotas === "object" ? clone(loaded.dailyQuotas) : {},
    checkinOptions: Array.isArray(loaded.checkinOptions) && loaded.checkinOptions.length ? loaded.checkinOptions.map(String) : clone(defaultData.checkinOptions),
    adminPassword: String(loaded.adminPassword || ""),
    records: normalizeRecordMap(loaded.records || {}, rules)
  };
}

function recordTimestamp(record) {
  const time = Date.parse(record?.updated_at || "");
  return Number.isNaN(time) ? 0 : time;
}

function newerRecordSide(a, b, prefer = "first") {
  const at = recordTimestamp(a);
  const bt = recordTimestamp(b);
  if (at === bt) return prefer === "second" ? b : a;
  return at > bt ? a : b;
}

function newerText(a = "", b = "", prefer = "first") {
  const first = String(a || "").trim();
  const second = String(b || "").trim();
  if (!first) return second;
  if (!second) return first;
  return prefer === "second" ? second : first;
}

function mergeCheckins(remote = {}, local = {}) {
  const merged = {};
  ["morning", "afternoon", "evening"].forEach((slot) => {
    const a = remote?.[slot] || {};
    const b = local?.[slot] || {};
    merged[slot] = newerRecordSide(a, b, "second");
  });
  return sanitizeCheckins(merged);
}

function newerRecord(remoteRecord, localRecord, prefer = "second", rules = defaultData.rules) {
  if (!remoteRecord) return clone(localRecord);
  if (!localRecord) return clone(remoteRecord);
  const remote = clone(remoteRecord);
  const local = clone(localRecord);
  const base = newerRecordSide(remote, local, prefer);
  const merged = { ...remote, ...local, ...base, items: {}, checkins: mergeCheckins(remote.checkins, local.checkins) };
  Object.keys(rules || {}).forEach((name) => {
    const chosen = newerRecordSide(
      { value: remote.items?.[name], updated_at: remote.updated_at },
      { value: local.items?.[name], updated_at: local.updated_at },
      prefer
    );
    merged.items[name] = Number(chosen?.value || 0);
  });
  merged.reason = newerText(remote.reason, local.reason, prefer);
  merged.harvest = newerText(remote.harvest, local.harvest, prefer);
  merged.diary = newerText(remote.diary, local.diary, prefer);
  merged.updated_at = newerRecordSide(remote, local, prefer)?.updated_at || remote.updated_at || local.updated_at || "";
  return merged;
}

function mergeDailyQuotas(remoteDaily = {}, localDaily = {}, mode = "records") {
  const merged = {};
  const days = new Set([...Object.keys(remoteDaily || {}), ...Object.keys(localDaily || {})]);
  days.forEach((day) => {
    const remote = remoteDaily?.[day] || {};
    const local = localDaily?.[day] || {};
    merged[day] = {
      default: mode === "admin" ? (local.default ?? "") : (remote.default ?? local.default ?? ""),
      members: { ...(remote.members || {}), ...(local.members || {}) }
    };
  });
  return merged;
}

function mergeCloudData(remoteSource, localSource, mode = "records") {
  if (!remoteSource) return normalize(localSource);
  const remote = normalize(remoteSource);
  const local = normalize(localSource);
  const merged = mode === "admin" ? { ...remote, ...local } : { ...local, ...remote };
  const recordKeys = new Set([...Object.keys(remote.records || {}), ...Object.keys(local.records || {})]);
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
    merged.adminPassword = String(local.adminPassword || "");
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
    merged.adminPassword = String(remote.adminPassword || local.adminPassword || "");
  }
  merged.records = {};
  recordKeys.forEach((key) => {
    merged.records[key] = newerRecord(remote.records?.[key], local.records?.[key], "second", merged.rules);
  });
  return normalize(merged);
}

function dataStats(data) {
  return {
    recordCount: Object.keys(data?.records || {}).length,
    memberCount: Array.isArray(data?.members) ? data.members.length : 0,
    groupCount: Array.isArray(data?.groups) ? data.groups.length : 0
  };
}

async function digestData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_state (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT,
      source TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      actor TEXT,
      mode TEXT NOT NULL DEFAULT 'records',
      source TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS daily_report_cloud_events_created_at ON daily_report_cloud_events (created_at DESC)`).run();
}

async function readState(db, includeData = true) {
  const columns = includeData
    ? "updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data"
    : "updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256";
  const row = await db.prepare(`SELECT ${columns} FROM daily_report_cloud_state WHERE id = 'latest' LIMIT 1`).first();
  if (!row) return null;
  if (includeData) row.data = JSON.parse(row.data || "null");
  return row;
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

async function writeState(db, nextData, source = "team-sync", actor = "", mode = "records") {
  const normalized = normalize(nextData);
  normalized.updated_at = new Date().toISOString();
  const now = new Date().toISOString();
  const serialized = JSON.stringify(normalized);
  const sha = await digestData(normalized);
  const stats = dataStats(normalized);
  const eventId = `event_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await db.batch([
    db.prepare(`
      INSERT INTO daily_report_cloud_state
        (id, updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data)
      VALUES ('latest', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        client_updated_at = excluded.client_updated_at,
        source = excluded.source,
        record_count = excluded.record_count,
        member_count = excluded.member_count,
        group_count = excluded.group_count,
        data_sha256 = excluded.data_sha256,
        data = excluded.data
    `).bind(now, normalized.updated_at || now, source, stats.recordCount, stats.memberCount, stats.groupCount, sha, serialized),
    db.prepare(`
      INSERT INTO daily_report_cloud_events
        (id, created_at, actor, mode, source, record_count, member_count, group_count, data_sha256, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, now, String(actor || "").slice(0, 80), String(mode || "records").slice(0, 30), source, stats.recordCount, stats.memberCount, stats.groupCount, sha, serialized)
  ]);
  return {
    data: normalized,
    meta: {
      updated_at: now,
      client_updated_at: normalized.updated_at,
      source,
      record_count: stats.recordCount,
      member_count: stats.memberCount,
      group_count: stats.groupCount,
      data_sha256: sha
    }
  };
}

async function listEvents(db) {
  const result = await db.prepare(`
    SELECT id, created_at, actor, mode, source, record_count, member_count, group_count, data_sha256
    FROM daily_report_cloud_events
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  return result.results || [];
}

async function restoreEvent(db, eventId) {
  const row = await db.prepare(`SELECT id, actor, data FROM daily_report_cloud_events WHERE id = ? LIMIT 1`).bind(eventId).first();
  if (!row) return { error: "没有找到这个历史版本。", status: 404 };
  return writeState(db, JSON.parse(row.data), "history-restore", `恢复:${row.actor || row.id}`, "admin");
}

async function handleCloudData(request, env) {
  if (!env.DB) return json({ ok: false, error: "Cloudflare Worker 未绑定 D1 数据库 DB。" }, 503);
  if (request.method === "GET" && !tokenFromRequest(request)) {
    return json({ ok: true, configured: true, protected: authTokens(env).length > 0, provider: "cloudflare-d1" });
  }
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);
  await ensureSchema(env.DB);
  if (!authTokens(env).length) return json({ ok: false, error: "Cloudflare Worker 还没有配置 TEAM_SYNC_TOKEN 或 APP_PASSWORD。" }, 503);
  if (!hasValidToken(request, env)) return json({ ok: false, error: "云同步口令不正确。" }, 401);
  if (request.method === "GET") {
    const state = await readState(env.DB, true);
    return json({ ok: true, data: state?.data || null, meta: publicStateMeta(state) });
  }
  const body = await readJson(request);
  const action = String(body.action || "save");
  if (action === "meta") {
    const state = await readState(env.DB, false);
    return json({ ok: true, meta: publicStateMeta(state) });
  }
  if (action === "pull") {
    const state = await readState(env.DB, true);
    return json({ ok: true, data: state?.data || null, meta: publicStateMeta(state) });
  }
  if (action === "history") return json({ ok: true, events: await listEvents(env.DB) });
  if (action === "restore_history") {
    if (!body.eventId) return json({ ok: false, error: "缺少历史版本 ID。" }, 400);
    const restored = await restoreEvent(env.DB, String(body.eventId));
    if (restored.error) return json({ ok: false, error: restored.error }, restored.status || 500);
    return json({ ok: true, ...restored });
  }
  if (action === "save") {
    if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      return json({ ok: false, error: "缺少可同步的数据。" }, 400);
    }
    const state = await readState(env.DB, true);
    const merged = mergeCloudData(state?.data || null, body.data, body.mode === "admin" ? "admin" : "records");
    return json({ ok: true, ...(await writeState(env.DB, merged, body.mode === "admin" ? "admin-sync" : "team-sync", body.actor || "", body.mode === "admin" ? "admin" : "records")) });
  }
  return json({ ok: false, error: "未知云同步动作。" }, 400);
}

async function handleAppAuth(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);
  if (!authTokens(env).length) return json({ ok: false, configured: false, error: "Cloudflare Worker 还没有配置 APP_PASSWORD 或 TEAM_SYNC_TOKEN。" }, 503);
  const body = await readJson(request);
  if (!hasValidToken(request, env, body.password)) return json({ ok: false, error: "密码不正确" }, 401);
  return json({ ok: true, provider: "cloudflare-d1" });
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      const url = new URL(request.url);
      if (url.pathname === "/api/cloud-data" || url.pathname === "/cloud-data") return handleCloudData(request, env);
      if (url.pathname === "/api/app-auth" || url.pathname === "/app-auth") return handleAppAuth(request, env);
      return json({ ok: true, service: "daily-report-cloudflare-sync" });
    } catch (error) {
      return json({ ok: false, error: error.message || "Cloudflare 同步失败。" }, error.status || 500);
    }
  }
};
