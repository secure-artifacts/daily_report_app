const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const maxBodyBytes = 8 * 1024 * 1024;
let schemaReady = false;

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function backupToken() {
  return process.env.CLOUD_BACKUP_TOKEN || process.env.BACKUP_TOKEN || "";
}

function hasValidToken(req) {
  const expected = backupToken();
  const received = String(req.headers["x-backup-token"] || "");
  if (!expected || !received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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

function publicBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    record_count: Number(row.record_count || 0),
    member_count: Number(row.member_count || 0),
    group_count: Number(row.group_count || 0),
    data_sha256: row.data_sha256,
    client_updated_at: row.client_updated_at,
    source: row.source || "admin-ui"
  };
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
        reject(new Error("请求体过大，云备份单次最多 8MB。"));
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
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

async function ensureSchema(sql) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_backups (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_updated_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'admin-ui',
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_state (
      id TEXT PRIMARY KEY,
      latest_backup_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_updated_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'admin-ui',
      record_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      group_count INTEGER NOT NULL DEFAULT 0,
      data_sha256 TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS daily_report_cloud_backups_created_at ON daily_report_cloud_backups (created_at DESC)`;
  schemaReady = true;
}

async function listBackups(sql) {
  const rows = await sql`
    SELECT id, label, created_at, client_updated_at, source, record_count, member_count, group_count, data_sha256
    FROM daily_report_cloud_backups
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return rows.map(publicBackup);
}

async function latestBackup(sql) {
  const rows = await sql`
    SELECT latest_backup_id AS id, '最新云快照' AS label, updated_at AS created_at,
           client_updated_at, source, record_count, member_count, group_count, data_sha256
    FROM daily_report_cloud_state
    WHERE id = 'latest'
    LIMIT 1
  `;
  return publicBackup(rows[0]);
}

async function createBackup(sql, body) {
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    const error = new Error("缺少可备份的数据。");
    error.statusCode = 400;
    throw error;
  }
  const id = `backup_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const label = String(body.label || "管理员云备份").slice(0, 80);
  const source = String(body.source || "admin-ui").slice(0, 80);
  const json = JSON.stringify(body.data);
  const sha = digestData(body.data);
  const stats = dataStats(body.data);
  await sql`
    INSERT INTO daily_report_cloud_backups
      (id, label, client_updated_at, source, record_count, member_count, group_count, data_sha256, data)
    VALUES
      (${id}, ${label}, ${stats.clientUpdatedAt}, ${source}, ${stats.recordCount}, ${stats.memberCount}, ${stats.groupCount}, ${sha}, ${json}::jsonb)
  `;
  await sql`
    INSERT INTO daily_report_cloud_state
      (id, latest_backup_id, updated_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data)
    VALUES
      ('latest', ${id}, NOW(), ${stats.clientUpdatedAt}, ${source}, ${stats.recordCount}, ${stats.memberCount}, ${stats.groupCount}, ${sha}, ${json}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      latest_backup_id = EXCLUDED.latest_backup_id,
      updated_at = NOW(),
      client_updated_at = EXCLUDED.client_updated_at,
      source = EXCLUDED.source,
      record_count = EXCLUDED.record_count,
      member_count = EXCLUDED.member_count,
      group_count = EXCLUDED.group_count,
      data_sha256 = EXCLUDED.data_sha256,
      data = EXCLUDED.data
  `;
  return {
    id,
    label,
    created_at: new Date().toISOString(),
    client_updated_at: stats.clientUpdatedAt,
    source,
    record_count: stats.recordCount,
    member_count: stats.memberCount,
    group_count: stats.groupCount,
    data_sha256: sha
  };
}

async function restoreBackup(sql, backupId) {
  if (backupId) {
    const rows = await sql`
      SELECT id, label, created_at, client_updated_at, source, record_count, member_count, group_count, data_sha256, data
      FROM daily_report_cloud_backups
      WHERE id = ${backupId}
      LIMIT 1
    `;
    if (!rows[0]) {
      const error = new Error("没有找到这个云备份。");
      error.statusCode = 404;
      throw error;
    }
    return { meta: publicBackup(rows[0]), data: rows[0].data };
  }
  const rows = await sql`
    SELECT latest_backup_id AS id, '最新云快照' AS label, updated_at AS created_at,
           client_updated_at, source, record_count, member_count, group_count, data_sha256, data
    FROM daily_report_cloud_state
    WHERE id = 'latest'
    LIMIT 1
  `;
  if (!rows[0]) {
    const error = new Error("云数据库里还没有备份。");
    error.statusCode = 404;
    throw error;
  }
  return { meta: publicBackup(rows[0]), data: rows[0].data };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET") {
      return send(res, 200, {
        ok: true,
        configured: Boolean(process.env.DATABASE_URL),
        protected: Boolean(backupToken())
      });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    const sql = database();
    if (!sql) return send(res, 503, { ok: false, error: "Vercel 还没有配置 DATABASE_URL。" });
    if (!backupToken()) return send(res, 503, { ok: false, error: "Vercel 还没有配置 CLOUD_BACKUP_TOKEN。" });
    if (!hasValidToken(req)) return send(res, 401, { ok: false, error: "云备份口令不正确。" });

    const body = await readJson(req);
    const action = String(body.action || "list");
    await ensureSchema(sql);

    if (action === "backup") {
      const meta = await createBackup(sql, body);
      const backups = await listBackups(sql);
      return send(res, 200, { ok: true, meta, latest: meta, backups });
    }
    if (action === "restore") {
      const restored = await restoreBackup(sql, body.backupId ? String(body.backupId) : "");
      return send(res, 200, { ok: true, ...restored });
    }
    if (action === "list") {
      const latest = await latestBackup(sql);
      const backups = await listBackups(sql);
      return send(res, 200, { ok: true, latest, backups });
    }
    return send(res, 400, { ok: false, error: "未知云备份动作。" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return send(res, statusCode, { ok: false, error: error.message || "云备份失败。" });
  }
};
