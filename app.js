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
  checkinOptions: ["上线", "请假", "迟到", "听交通", "聚会", "上班", "干农活", "值日", "熬夜", "拍摄"],
  timezones: [
    { name: "澳大利亚时间", offset: "+10:00" },
    { name: "新西兰时间", offset: "+12:00" },
    { name: "欧洲时间", offset: "+01:00" },
    { name: "希腊时间", offset: "+03:00" },
    { name: "柬埔寨时间", offset: "+07:00" },
    { name: "美国时间", offset: "-05:00" },
    { name: "洛杉矶时间", offset: "-07:00" },
  ],
  adminPassword: "",
  sheetBackupEnabled: true,
  backupCleanupEnabled: false,
  autoAudit: false,
  deletedMembers: {},
  reviewMessages: {
    pass: ["恭喜达标", "今天很稳", "继续保持", "漂亮完成", "节奏很好", "进步明显", "状态在线", "效率不错", "超额很棒", "明天继续"],
    fail: ["很遗憾不达标", "明天补上", "先找原因", "差一点点", "继续加油", "调整节奏", "补救计划", "稳住再来", "目标明确", "别断复盘"]
  },
  records: {}
};
const clone = (obj) => JSON.parse(JSON.stringify(obj));
let data = loadLocal();
let currentMember = data.members[0] || "成员A";
let currentDate = dateKeyFromDate(new Date());
let fileHandle = null;
let cloudDirHandle = null;
let lastFileModified = 0;
let lastCloudText = "";
let cloudLocationLabel = "";
let syncStatusText = "未连接云端文件夹";
let cloudDbStatusText = "未连接云同步";
let cloudDbLastMeta = null;
let cloudHistoryEvents = [];
let cloudDbPollTimer = 0;
let cloudDbLastSeenSha = "";
let cloudDbQuotaPausedUntil = 0;
let appSessionPassword = "";
let cloudBackupStatusText = "未检查云数据库";
let cloudBackupLastMeta = null;
let cloudBackupBackups = [];
let cloudBackupToken = "";
let syncPollTimer = 0;
let pollInProgress = false;
let sourceDirHandles = [];
let sourceDirLabels = [];
let summaryDirHandle = null;
let summaryLocationLabel = "";
let superAdminUnlocked = false;
let activeReportSource = "current";
let sourceDatasets = [];
let mergedSourceDataset = null;
let reportDataOverride = null;
let overviewSelectedGroups = JSON.parse(localStorage.getItem("dailyReportOverviewGroups") || "[]");
let analysisTableMember = "";
let overviewRangeMode = "day";
let overviewDetailGroup = "";
let overviewDetailMember = "";
let mixedTableGroup = "";
let mixedTableMember = "";
let mixedTableRangeMode = "default";
let mixedCheckinGroup = "";
let mixedCheckinMember = "";
let checkinViewGroup = "";
let checkinViewMember = "";
let checkinViewRangeMode = "default";
let pendingDialogField = "";
let activeView = "entry";
let saveTimer = 0;
let draftTimer = 0;
let recordCloudSaveTimer = 0;
let adminUnlocked = false;
let showAllEntryItems = false;
let appUnlocked = false;
let collapsedGroups = JSON.parse(localStorage.getItem("dailyReportCollapsedGroups") || "{}");
let lastTypingAt = 0;
let sharedReplicaCount = 0;
let cloudSyncEndpoint = loadCloudSyncEndpoint();
let cloudSyncEndpointFromEnv = "";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const recordKey = () => `${currentDate}|${currentMember}`;
const desktopApp = window.desktopApp || null;
const syncPollMs = 3000;
const cloudDbPollMs = 60000;
const recordCloudSaveDelayMs = 8000;
const cloudDbQuotaPauseMs = 6 * 60 * 60 * 1000;
const sharedReplicaDirName = "daily_report_clients";
const clientId = loadClientId();
function loadClientId() {
  const saved = localStorage.getItem("dailyReportClientId");
  if (saved) return saved;
  const next = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("dailyReportClientId", next);
  return next;
}
function normalizeCloudSyncEndpoint(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\/+$/, "");
  text = text.replace(/\/api\/cloud-data$/i, "").replace(/\/cloud-data$/i, "");
  text = text.replace(/\/api\/app-auth$/i, "").replace(/\/app-auth$/i, "");
  return text.replace(/\/+$/, "");
}
function loadCloudSyncEndpoint() {
  return normalizeCloudSyncEndpoint(localStorage.getItem("dailyReportCloudSyncEndpoint") || "");
}
function saveCloudSyncEndpoint(value) {
  cloudSyncEndpoint = normalizeCloudSyncEndpoint(value);
  if (cloudSyncEndpoint) localStorage.setItem("dailyReportCloudSyncEndpoint", cloudSyncEndpoint);
  else localStorage.removeItem("dailyReportCloudSyncEndpoint");
  syncCloudEndpointInputs();
  renderSyncPanel();
  return cloudSyncEndpoint;
}
function setCloudSyncEndpointFromEnv(value) {
  cloudSyncEndpointFromEnv = normalizeCloudSyncEndpoint(value);
  if (!loadCloudSyncEndpoint()) cloudSyncEndpoint = cloudSyncEndpointFromEnv;
  syncCloudEndpointInputs();
  renderSyncPanel();
}
async function loadCloudSyncConfig() {
  if (window.location.protocol === "file:" || typeof fetch !== "function") return;
  try {
    const response = await fetch("/api/sync-config", { cache: "no-store" });
    const result = await response.json();
    if (response.ok && result.ok) setCloudSyncEndpointFromEnv(result.endpoint || "");
  } catch {
    // Vercel/local config endpoint is optional; manual endpoint entry still works.
  }
}
function cloudSyncProviderLabel() {
  return cloudSyncEndpoint ? "Cloudflare Worker" : "Vercel 云库";
}
function cloudApiUrl(path) {
  const nextPath = path.startsWith("/") ? path : `/${path}`;
  return cloudSyncEndpoint ? `${cloudSyncEndpoint}${nextPath}` : nextPath;
}
function defaultCloudApiUrl(path) {
  return path.startsWith("/") ? path : `/${path}`;
}
function syncCloudEndpointInputs() {
  if ($("cloudSyncEndpointInput")) $("cloudSyncEndpointInput").value = cloudSyncEndpoint;
  if ($("cloudSyncEndpointAdminInput")) $("cloudSyncEndpointAdminInput").value = cloudSyncEndpoint;
}
function todayLocalKey() {
  const now = new Date();
  return dateKeyFromDate(now);
}
function normalizeCheckinStatus(status) {
  const text = String(status || "").trim();
  if (text === "准时上线") return "上线";
  if (text === "迟到") return "迟到";
  return text;
}
function normalizeCheckinOptions(options) {
  const source = Array.isArray(options) && options.length ? options : defaultData.checkinOptions;
  return Array.from(new Set(source.map(normalizeCheckinStatus).filter(Boolean)));
}
function recordKeyParts(key = "") {
  const [date = "", ...memberParts] = String(key || "").split("|");
  return { date, member: memberParts.join("|") };
}
function normalizeRecordMap(records = {}, rules = defaultData.rules) {
  const normalized = {};
  Object.entries(records || {}).forEach(([key, record]) => {
    if (!record || typeof record !== "object") return;
    const fallback = recordKeyParts(key);
    const date = String(record.date || fallback.date || "").trim();
    const member = String(record.member || fallback.member || "").trim();
    if (!date || !member) return;
    const next = { ...clone(record), date, member };
    const nextKey = `${date}|${member}`;
    normalized[nextKey] = normalized[nextKey]
      ? newerRecord(normalized[nextKey], next, "second", rules)
      : next;
  });
  return normalized;
}
function normalize(source) {
  const loaded = source || {};
  const members = Array.isArray(loaded.members) && loaded.members.length ? loaded.members.map(String) : ["成员A"];
  const groups = Array.isArray(loaded.groups) && loaded.groups.length ? loaded.groups.map(String) : ["1组"];
  const memberGroups = { ...(loaded.memberGroups || {}) };
  const groupItems = { ...(loaded.groupItems || {}) };
  const memberItems = { ...(loaded.memberItems || {}) };
  members.forEach((name) => {
    if (!memberGroups[name]) memberGroups[name] = groups[0];
  });
  const rules = loaded.rules && typeof loaded.rules === "object" ? loaded.rules : clone(defaultData.rules);
  groups.forEach((group) => {
    if (!Array.isArray(groupItems[group])) groupItems[group] = Object.keys(rules);
  });
  const memberQuotas = { ...(loaded.memberQuotas || {}) };
  const dailyQuotas = loaded.dailyQuotas && typeof loaded.dailyQuotas === "object" ? clone(loaded.dailyQuotas) : {};
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
    memberQuotas,
    dailyQuotas,
    checkinOptions,
    timezones: Array.isArray(loaded.timezones) && loaded.timezones.length
      ? loaded.timezones.map((item) => ({
        name: String(item.name || "时间").trim() || "时间",
        offset: String(item.offset || "+08:00").trim() || "+08:00"
      }))
      : clone(defaultData.timezones),
    adminPassword: String(loaded.adminPassword || defaultData.adminPassword),
    sheetBackupEnabled: loaded.sheetBackupEnabled !== false,
    backupCleanupEnabled: loaded.backupCleanupEnabled === true,
    autoAudit: loaded.autoAudit === true,
    deletedMembers: loaded.deletedMembers && typeof loaded.deletedMembers === "object" ? clone(loaded.deletedMembers) : {},
    reviewMessages: {
      pass: Array.isArray(loaded.reviewMessages?.pass) ? loaded.reviewMessages.pass : clone(defaultData.reviewMessages.pass),
      fail: Array.isArray(loaded.reviewMessages?.fail) ? loaded.reviewMessages.fail : clone(defaultData.reviewMessages.fail)
    },
    records: normalizeRecordMap(loaded.records || {}, rules)
  };
}
function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem("dailyReportData") || "null");
    return normalize(saved);
  } catch {
    return clone(defaultData);
  }
}
function readBackups() {
  try {
    const items = JSON.parse(localStorage.getItem("dailyReportBackups") || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
function writeBackups(items) {
  localStorage.setItem("dailyReportBackups", JSON.stringify(items));
}
function pruneBackups() {
  if (!data?.backupCleanupEnabled) return;
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  writeBackups(readBackups().filter((item) => {
    if (/周备份|月备份|配置|恢复/.test(item.label || "")) return true;
    return new Date(item.created_at).getTime() >= cutoff;
  }).slice(0, 120));
}
function createBackup(label = "自动备份") {
  pruneBackups();
  const backups = readBackups();
  const today = new Date().toISOString().slice(0, 10);
  const last = backups[0];
  if (last && last.label === label && last.created_at.slice(0, 10) === today) return;
  backups.unshift({
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    label,
    data: clone(data)
  });
  writeBackups(backups.slice(0, 80));
}
function persistLocal() {
  data.updated_at = new Date().toISOString();
  localStorage.setItem("dailyReportData", JSON.stringify(data));
  pruneBackups();
  renderSyncPanel();
}
function recordTimestamp(record) {
  const time = Date.parse(record?.updated_at || "");
  return Number.isNaN(time) ? 0 : time;
}
function newerRecordSide(a, b, prefer = "first") {
  const left = recordTimestamp(a);
  const right = recordTimestamp(b);
  if (left === right) return prefer === "second" ? "second" : "first";
  return left > right ? "first" : "second";
}
function mergeStringValue(aValue, bValue, aRecord, bRecord, prefer = "first") {
  const left = String(aValue || "").trim();
  const right = String(bValue || "").trim();
  if (left && right) return newerRecordSide(aRecord, bRecord, prefer) === "second" ? bValue : aValue;
  return right ? bValue : (left ? aValue : "");
}
function normalizeMergedCheckin(value) {
  if (!value) return null;
  const status = normalizeCheckinStatus(typeof value === "string" ? value : value.status || "");
  if (!status) return null;
  return typeof value === "object" ? { ...clone(value), status } : { status };
}
function checkinTimestamp(value, record) {
  const source = typeof value === "object" ? (value.iso || value.updated_at || "") : "";
  const time = Date.parse(source);
  return Number.isNaN(time) ? recordTimestamp(record) : time;
}
function mergeRecordCheckins(aCheckins = {}, bCheckins = {}, aRecord = {}, bRecord = {}, prefer = "first") {
  const merged = {};
  const keys = new Set(["morning", "noon", "evening", ...Object.keys(aCheckins || {}), ...Object.keys(bCheckins || {})]);
  keys.forEach((key) => {
    const left = normalizeMergedCheckin(aCheckins?.[key]);
    const right = normalizeMergedCheckin(bCheckins?.[key]);
    if (left && right) {
      const leftTime = checkinTimestamp(left, aRecord);
      const rightTime = checkinTimestamp(right, bRecord);
      const pickRight = leftTime === rightTime ? prefer === "second" : rightTime > leftTime;
      merged[key] = pickRight ? right : left;
    } else if (right) {
      merged[key] = right;
    } else if (left) {
      merged[key] = left;
    }
  });
  return merged;
}
function mergeRecordItems(aItems = {}, bItems = {}, aRecord = {}, bRecord = {}, prefer = "first") {
  const merged = {};
  const keys = new Set([...Object.keys(aItems || {}), ...Object.keys(bItems || {})]);
  keys.forEach((key) => {
    const left = Number(aItems?.[key] || 0);
    const right = Number(bItems?.[key] || 0);
    const hasLeft = left !== 0;
    const hasRight = right !== 0;
    if (hasLeft && hasRight) {
      merged[key] = newerRecordSide(aRecord, bRecord, prefer) === "second" ? right : left;
    } else if (hasRight) {
      merged[key] = right;
    } else if (hasLeft) {
      merged[key] = left;
    }
  });
  return merged;
}
function mergedEntryTotals(items, rules = {}) {
  const raw = Object.values(items || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const weighted = Object.entries(items || {}).reduce((sum, [name, amount]) => {
    const weight = Number(rules?.[name] ?? 1);
    return sum + Number(amount || 0) * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { raw, weighted };
}
function mergedItemsToText(items) {
  return Object.entries(items || {})
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([name, amount]) => `${name}：${Number(amount || 0)}`)
    .join("\n");
}
function newerRecord(a, b, prefer = "first", rules = defaultData.rules) {
  if (!a) return b ? clone(b) : b;
  if (!b) return clone(a);
  const primarySide = newerRecordSide(a, b, prefer);
  const primary = primarySide === "second" ? b : a;
  const secondary = primarySide === "second" ? a : b;
  const merged = { ...clone(secondary), ...clone(primary) };
  merged.date = primary.date || secondary.date || "";
  merged.member = primary.member || secondary.member || "";
  merged.items = mergeRecordItems(a.items || {}, b.items || {}, a, b, prefer);
  merged.checkins = mergeRecordCheckins(a.checkins || {}, b.checkins || {}, a, b, prefer);
  ["reason", "harvest", "diary"].forEach((field) => {
    merged[field] = mergeStringValue(a[field], b[field], a, b, prefer);
  });
  merged.status = mergeStringValue(a.status, b.status, a, b, prefer) || "待审核";
  merged.text = mergedItemsToText(merged.items) || mergeStringValue(a.text, b.text, a, b, prefer);
  const totals = mergedEntryTotals(merged.items, rules);
  merged.raw_total = totals.raw;
  merged.weighted_total = totals.weighted;
  merged.quota_total = Number(primary.quota_total ?? secondary.quota_total ?? 0);
  merged.updated_at = [a.updated_at, b.updated_at].filter(Boolean).sort().pop() || primary.updated_at || secondary.updated_at || "";
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
      members: {
        ...(remote.members || {}),
        ...(local.members || {})
      }
    };
  });
  return merged;
}
function clearActiveDeletedMembers(report) {
  const deleted = { ...(report.deletedMembers || {}) };
  (report.members || []).forEach((member) => {
    if (deleted[member]) delete deleted[member];
  });
  return deleted;
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
    merged.sheetBackupEnabled = local.sheetBackupEnabled !== false;
    merged.backupCleanupEnabled = local.backupCleanupEnabled === true;
    merged.autoAudit = local.autoAudit === true;
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
    merged.adminPassword = String(remote.adminPassword || local.adminPassword || "");
    merged.sheetBackupEnabled = remote.sheetBackupEnabled !== false;
    merged.backupCleanupEnabled = remote.backupCleanupEnabled === true;
    merged.autoAudit = remote.autoAudit === true;
    merged.deletedMembers = { ...(local.deletedMembers || {}), ...(remote.deletedMembers || {}) };
    merged.reviewMessages = clone(remote.reviewMessages || local.reviewMessages || defaultData.reviewMessages);
  }
  merged.records = {};
  recordKeys.forEach((key) => {
    merged.records[key] = newerRecord(remote.records?.[key], local.records?.[key], "second", merged.rules);
  });
  merged.deletedMembers = clearActiveDeletedMembers(merged);
  return normalize(merged);
}
function mergeSummaryData(baseSource, sourceData) {
  const base = normalize(baseSource);
  const source = normalize(sourceData);
  const merged = normalize({
    ...base,
    rules: { ...base.rules, ...source.rules },
    members: Array.from(new Set([...base.members, ...source.members])),
    groups: Array.from(new Set([...base.groups, ...source.groups])),
    memberGroups: { ...base.memberGroups, ...source.memberGroups },
    groupItems: { ...base.groupItems, ...source.groupItems },
    memberItems: { ...base.memberItems, ...source.memberItems },
    memberQuotas: { ...base.memberQuotas, ...source.memberQuotas },
    dailyQuotas: mergeDailyQuotas(base.dailyQuotas, source.dailyQuotas, "records"),
    checkinOptions: Array.from(new Set([...(base.checkinOptions || []), ...(source.checkinOptions || [])])),
    records: { ...base.records }
  });
  Object.entries(source.records || {}).forEach(([key, record]) => {
    merged.records[key] = newerRecord(record, merged.records[key]);
  });
  return normalize(merged);
}
function mergeAdminCenterData(baseSource, sourceData) {
  const base = normalize(baseSource);
  const source = normalize(sourceData);
  const merged = normalize({
    ...base,
    rules: { ...source.rules, ...base.rules },
    members: Array.from(new Set([...base.members, ...source.members])),
    groups: Array.from(new Set([...base.groups, ...source.groups])),
    memberGroups: { ...source.memberGroups, ...base.memberGroups },
    groupItems: { ...source.groupItems, ...base.groupItems },
    memberItems: { ...source.memberItems, ...base.memberItems },
    memberQuotas: { ...source.memberQuotas, ...base.memberQuotas },
    dailyQuotas: mergeDailyQuotas(source.dailyQuotas, base.dailyQuotas, "records"),
    checkinOptions: Array.from(new Set([...(base.checkinOptions || []), ...(source.checkinOptions || [])])),
    records: { ...base.records }
  });
  Object.entries(source.records || {}).forEach(([key, record]) => {
    merged.records[key] = newerRecord(record, merged.records[key]);
  });
  return normalize(merged);
}
function makeEmptySummary(seed = data) {
  const empty = normalize(seed);
  empty.members = [];
  empty.groups = [];
  empty.memberGroups = {};
  empty.groupItems = {};
  empty.memberItems = {};
  empty.memberQuotas = {};
  empty.dailyQuotas = {};
  empty.records = {};
  return empty;
}
function scopedSourceData(sourceData, label, existingMembers = new Set()) {
  const source = normalize(sourceData);
  const scoped = makeEmptySummary(source);
  const groupMap = {};
  const memberMap = {};
  const sourceLabel = String(label || "来源").trim() || "来源";
  source.groups.forEach((group) => {
    const nextGroup = `${sourceLabel} / ${group}`;
    groupMap[group] = nextGroup;
    scoped.groups.push(nextGroup);
    scoped.groupItems[nextGroup] = clone(source.groupItems?.[group] || Object.keys(source.rules || {}));
  });
  source.members.forEach((member) => {
    let nextMember = member;
    if (existingMembers.has(nextMember) || memberMap[nextMember]) nextMember = `${member}（${sourceLabel}）`;
    let suffix = 2;
    while (existingMembers.has(nextMember) || memberMap[nextMember]) {
      nextMember = `${member}（${sourceLabel} ${suffix}）`;
      suffix += 1;
    }
    memberMap[member] = nextMember;
    existingMembers.add(nextMember);
    scoped.members.push(nextMember);
    const sourceGroup = source.memberGroups?.[member] || source.groups[0] || "未分组";
    scoped.memberGroups[nextMember] = groupMap[sourceGroup] || `${sourceLabel} / ${sourceGroup}`;
    if (source.memberItems?.[member]) scoped.memberItems[nextMember] = clone(source.memberItems[member]);
    if (source.memberQuotas?.[member] !== undefined) scoped.memberQuotas[nextMember] = source.memberQuotas[member];
  });
  Object.entries(source.dailyQuotas || {}).forEach(([day, entry]) => {
    scoped.dailyQuotas[day] = { default: entry.default ?? "", members: {} };
    Object.entries(entry.members || {}).forEach(([member, quota]) => {
      if (memberMap[member]) scoped.dailyQuotas[day].members[memberMap[member]] = quota;
    });
  });
  Object.values(source.records || {}).forEach((record) => {
    const nextMember = memberMap[record.member] || record.member;
    const nextRecord = { ...clone(record), member: nextMember };
    scoped.records[`${nextRecord.date}|${nextMember}`] = nextRecord;
  });
  return normalize(scoped);
}
async function readRemoteData() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.getCloudData();
    if (result?.text?.trim()) return JSON.parse(result.text);
    return null;
  }
  if (fileHandle) {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  return null;
}
async function persistEverywhere(mode = "records") {
  window.clearTimeout(recordCloudSaveTimer);
  persistLocal();
  const remoteData = await readRemoteData().catch(() => null);
  data = mergeCloudData(remoteData, data, mode);
  persistLocal();
  const clientReplicaPath = await writeClientReplicaToSharedFolder(data).catch(() => null);
  const cloudDbResult = await saveCloudDatabaseData(mode, true);
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.writeCloudData(data);
    if (result?.path) {
      lastFileModified = result.mtime || lastFileModified;
      cloudLocationLabel = result.path;
      lastCloudText = JSON.stringify(data, null, 2);
      setSyncStatus(`已写入云端 · ${new Date().toLocaleTimeString("zh-CN")}`, result.path);
    }
    return { written: true, cloudDbWritten: cloudDbResult?.written === true, folderWritten: true };
  }
  if (!fileHandle) {
    if (clientReplicaPath) {
      setSyncStatus("已写入共享成员副本，未写入总文件");
      return { written: true, cloudDbWritten: cloudDbResult?.written === true, folderWritten: true, clientReplicaWritten: true };
    }
    if (cloudDbResult?.written) {
      setSyncStatus(`已写入${cloudSyncProviderLabel()}，未选择文件夹备份`);
      return { written: true, cloudDbWritten: true, folderWritten: false };
    }
    setSyncStatus(`未选择云端文件夹，也未写入${cloudSyncProviderLabel()}，只保存了本地草稿`);
    return { written: false, cloudDbWritten: false, folderWritten: false, reason: cloudDbResult?.reason || "missing-cloud-target" };
  }
  try {
    const nextText = JSON.stringify(data, null, 2);
    const writable = await fileHandle.createWritable();
    await writable.write(nextText);
    await writable.close();
    const file = await fileHandle.getFile();
    lastFileModified = file.lastModified;
    lastCloudText = nextText;
    setSyncStatus(`已写入云端 · ${new Date().toLocaleTimeString("zh-CN")}`);
    return { written: true, cloudDbWritten: cloudDbResult?.written === true, folderWritten: true };
  } catch {
    if (cloudDbResult?.written) {
      setSyncStatus(`已写入${cloudSyncProviderLabel()}，文件夹备份写入失败`);
      return { written: true, cloudDbWritten: true, folderWritten: false, reason: "folder-write-failed" };
    }
    if (clientReplicaPath) {
      setSyncStatus("已写入共享成员副本，总文件暂时不可写");
      return { written: true, cloudDbWritten: false, folderWritten: true, clientReplicaWritten: true, reason: "client-replica-written" };
    }
    setSyncStatus("写入失败，已保存到本地缓存");
    return { written: false, cloudDbWritten: false, folderWritten: false, reason: cloudDbResult?.reason || "write-failed" };
  }
}
function openCloudDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dailyReportCloud", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveCloudDirectory(dir) {
  try {
    const db = await openCloudDb();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(dir, "directory");
  } catch {}
}
async function saveDirectoryHandle(key, value) {
  try {
    const db = await openCloudDb();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(value, key);
  } catch {}
}
async function loadDirectoryHandle(key) {
  try {
    const db = await openCloudDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readonly");
      const request = tx.objectStore("handles").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function loadCloudDirectory() {
  try {
    const db = await openCloudDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readonly");
      const request = tx.objectStore("handles").get("directory");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function saveSummaryFolders() {
  await saveDirectoryHandle("sourceDirectories", sourceDirHandles);
  await saveDirectoryHandle("summaryDirectory", summaryDirHandle);
}
async function restoreSummaryFolders() {
  const sources = await loadDirectoryHandle("sourceDirectories");
  const summary = await loadDirectoryHandle("summaryDirectory");
  sourceDirHandles = Array.isArray(sources) ? sources.filter(Boolean) : [];
  sourceDirLabels = sourceDirHandles.map((dir) => dir.name || "来源文件夹");
  summaryDirHandle = summary || null;
  summaryLocationLabel = summaryDirHandle?.name || "";
  renderSummaryFolders();
}
async function hasCloudPermission(dir) {
  if (!dir) return false;
  const options = { mode: "readwrite" };
  if ((await dir.queryPermission?.(options)) === "granted") return true;
  return (await dir.requestPermission?.(options)) === "granted";
}
function clientReplicaFileName() {
  const safeId = String(clientId || "client").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `${safeId}.json`;
}
async function writeClientReplicaToDirectory(dir, snapshot = data) {
  if (!dir || !(await hasCloudPermission(dir))) return null;
  const replicaDir = await dir.getDirectoryHandle(sharedReplicaDirName, { create: true });
  const handle = await replicaDir.getFileHandle(clientReplicaFileName(), { create: true });
  const payload = {
    version: 1,
    client_id: clientId,
    actor: currentMember,
    updated_at: new Date().toISOString(),
    record_count: Object.keys(snapshot.records || {}).length,
    data: normalize(snapshot)
  };
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
  return `${dir.name || "共享文件夹"}\\${sharedReplicaDirName}\\${clientReplicaFileName()}`;
}
async function writeClientReplicaToSharedFolder(snapshot = data) {
  if (!cloudDirHandle) return null;
  return writeClientReplicaToDirectory(cloudDirHandle, snapshot);
}
async function readClientReplicasFromDirectory(dir) {
  if (!dir || !(await hasCloudPermission(dir))) return [];
  let replicaDir = null;
  try {
    replicaDir = await dir.getDirectoryHandle(sharedReplicaDirName, { create: false });
  } catch {
    return [];
  }
  if (typeof replicaDir.entries !== "function") return [];
  const replicas = [];
  for await (const [name, handle] of replicaDir.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".json")) continue;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      if (!text.trim()) continue;
      const payload = JSON.parse(text);
      const replicaData = payload?.data || payload;
      replicas.push({
        label: `${payload?.actor || "成员副本"} · ${name}`,
        data: normalize(replicaData),
        updated_at: payload?.updated_at || ""
      });
    } catch (error) {
      console.warn(error);
    }
  }
  return replicas.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}
async function useCloudDirectory(dir, shouldSave = true) {
  if (!(await hasCloudPermission(dir))) {
    setSyncStatus("未获得云端文件夹权限，请重新选择");
    return false;
  }
  cloudDirHandle = dir;
  const handle = await dir.getFileHandle("report_data.json", { create: true });
  fileHandle = handle;
  const file = await handle.getFile();
  lastFileModified = file.lastModified;
  const text = await file.text();
  lastCloudText = text;
  cloudLocationLabel = `${dir.name}\\report_data.json`;
  createBackup("连接云端文件夹前备份");
  if (text.trim()) data = normalize(JSON.parse(text));
  persistLocal();
  setSyncStatus(`已挂载，后台刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
  if (!data.members.includes(currentMember)) currentMember = data.members[0];
  loadForm();
  render();
  if (!text.trim()) await persistEverywhere();
  if (shouldSave) await saveCloudDirectory(dir);
  startCloudPolling();
  return true;
}
async function restoreCloudDirectory() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.getCloudData();
    if (!result || result.error) return;
    if (result.text?.trim()) data = normalize(JSON.parse(result.text));
    lastFileModified = result.mtime || 0;
    lastCloudText = result.text || "";
    cloudLocationLabel = result.path || "";
    setSyncStatus(`已恢复挂载，后台刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    persistLocal();
    loadForm();
    render();
    startCloudPolling();
    return;
  }
  if (!("showDirectoryPicker" in window) || !("indexedDB" in window)) return;
  const dir = await loadCloudDirectory();
  if (dir) await useCloudDirectory(dir, false);
  else setSyncStatus("未选择云端文件夹，正在使用本地缓存");
  await restoreSummaryFolders();
}
function scheduleSave(mode = "records") {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistEverywhere(mode), 180);
}
function markUserTyping() {
  lastTypingAt = Date.now();
}
function scheduleDraftSave() {
  markUserTyping();
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveFormSilently(), 500);
}
function scheduleRecordCloudSave() {
  window.clearTimeout(recordCloudSaveTimer);
  if (!appSessionPassword && !fileHandle && !desktopApp?.isDesktop) return;
  recordCloudSaveTimer = window.setTimeout(() => {
    persistEverywhere("records").catch(() => {});
  }, recordCloudSaveDelayMs);
}
function preserveActiveDraft() {
  if (!appUnlocked || activeView !== "entry" || !$("entryInputs") || !$("dateInput")) return;
  try {
    saveFormSilently();
  } catch {
    // The draft saver is best-effort before refresh; normal editing can continue.
  }
}
function isActiveTypingWindow() {
  if (Date.now() - lastTypingAt > 1800) return false;
  const active = document.activeElement;
  if (!active) return false;
  const tag = String(active.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || active.isContentEditable;
}
function setSyncStatus(message, location = cloudLocationLabel) {
  syncStatusText = message || syncStatusText;
  cloudLocationLabel = location || cloudLocationLabel;
  if ($("syncLabel")) $("syncLabel").textContent = cloudLocationLabel ? `${syncStatusText}：${cloudLocationLabel}` : syncStatusText;
  renderSyncPanel();
}
function reportData() {
  return reportDataOverride || data;
}
function withReportData(nextData, callback) {
  const previous = reportDataOverride;
  reportDataOverride = nextData || data;
  try {
    return callback();
  } finally {
    reportDataOverride = previous;
  }
}
function selectedReportData() {
  if (!superAdminUnlocked) return data;
  if (activeReportSource === "all") return mergedSourceDataset || buildMergedSourceDataset();
  const match = activeReportSource.match(/^source:(\d+)$/);
  if (match) return sourceDatasets[Number(match[1])]?.data || data;
  return data;
}
function selectedReportLabel() {
  if (!superAdminUnlocked) return "当前文件夹";
  if (activeReportSource === "all") return "全部汇总";
  const match = activeReportSource.match(/^source:(\d+)$/);
  if (match) return sourceDatasets[Number(match[1])]?.label || "来源文件夹";
  return "当前文件夹";
}
function buildMergedSourceDataset() {
  let merged = normalize(data);
  const existingMembers = new Set(merged.members || []);
  sourceDatasets.forEach((source) => {
    if (source.error) return;
    merged = mergeSummaryData(merged, scopedSourceData(source.data, source.label, existingMembers));
  });
  mergedSourceDataset = normalize(merged);
  return mergedSourceDataset;
}
function renderReportSourceTabs() {
  const box = $("reportSourceTabs");
  if (!box) return;
  if (!superAdminUnlocked) {
    box.innerHTML = `<span class="hint">当前：普通管理员视图</span>`;
    return;
  }
  const tabs = [
    { id: "current", label: "当前文件夹" },
    { id: "all", label: `全部汇总 ${sourceDatasets.length}` },
    ...sourceDatasets.map((source, index) => ({ id: `source:${index}`, label: source.label }))
  ];
  box.innerHTML = tabs.map((tab) => `
    <button class="tab mini ${activeReportSource === tab.id ? "active" : ""}" data-report-source="${escapeAttr(tab.id)}">${escapeHtml(tab.label)}</button>
  `).join("");
  box.querySelectorAll("[data-report-source]").forEach((button) => {
    button.onclick = () => {
      activeReportSource = button.dataset.reportSource || "current";
      analysisTableMember = "";
      renderOverview();
      renderHistory();
      renderReportSourceTabs();
    };
  });
}
function renderSyncPanel() {
  const box = $("syncStatusBox");
  if (!box) return;
  const cachedAt = data.updated_at ? new Date(data.updated_at).toLocaleString("zh-CN") : "暂无";
  const recordCount = Object.keys(data.records || {}).length;
  const connected = Boolean(fileHandle || desktopApp?.isDesktop);
  const quotaPaused = isCloudDbQuotaPaused();
  const provider = cloudSyncProviderLabel();
  const dbReady = Boolean(appSessionPassword && cloudDatabaseAvailable() && !quotaPaused && !/未配置|失败|不可用|额度|暂停|未登录/.test(cloudDbStatusText));
  const syncMode = quotaPaused
    ? `云库额度暂停 · 约 ${cloudDbPauseRemainingText()} 后重试`
    : (dbReady ? `${provider}主同步 · ${cloudDbPollMs / 1000} 秒轻量检查` : (connected ? `${syncPollMs / 1000} 秒刷新` : "未连接时不会进入团队总数据"));
  box.innerHTML = `
    <div><span>云端挂载</span><strong>${escapeHtml(cloudLocationLabel || "未选择")}</strong></div>
    <div><span>后台刷新</span><strong>${escapeHtml(syncStatusText)}</strong></div>
    <div><span>云同步</span><strong>${escapeHtml(provider)} · ${escapeHtml(cloudDbStatusText)}</strong></div>
    <div><span>本地草稿</span><strong>${recordCount} 条 · ${escapeHtml(cachedAt)}</strong></div>
    <div><span>同步状态</span><strong>${escapeHtml(syncMode)}</strong></div>
  `;
}
function cloudDatabaseAvailable() {
  return Boolean(cloudSyncEndpoint) || (window.location.protocol !== "file:" && typeof fetch === "function");
}
function cloudDataMetaText(meta) {
  if (!meta) return "";
  const updatedAt = meta.updated_at ? new Date(meta.updated_at).toLocaleString("zh-CN") : "未知时间";
  const count = Number(meta.record_count || 0);
  return `${count} 条 · ${updatedAt}`;
}
function isQuotaError(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.payload || {})}`.toLowerCase();
  return Number(error?.status || 0) === 402 || /quota|额度|transfer/.test(text);
}
function isCloudDbQuotaPaused() {
  return cloudDbQuotaPausedUntil > Date.now();
}
function cloudDbPauseRemainingText() {
  const ms = Math.max(0, cloudDbQuotaPausedUntil - Date.now());
  if (!ms) return "0 分钟";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} 小时`;
}
function cloudDbQuotaMessage() {
  return `云数据库额度已满或暂时不可用，已暂停自动同步，本地草稿安全保留。请恢复云同步服务后再同步。`;
}
function pauseCloudDbForQuota(error) {
  cloudDbQuotaPausedUntil = Date.now() + cloudDbQuotaPauseMs;
  window.clearInterval(cloudDbPollTimer);
  setCloudDbStatus(cloudDbQuotaMessage(), cloudDbLastMeta);
  return { pulled: false, written: false, paused: true, reason: "cloud-quota-paused", error: error?.message || "" };
}
function clearCloudDbQuotaPause() {
  if (!cloudDbQuotaPausedUntil) return;
  cloudDbQuotaPausedUntil = 0;
  renderSyncPanel();
}
function setCloudDbStatus(message, meta) {
  cloudDbStatusText = message || cloudDbStatusText;
  if (meta !== undefined) cloudDbLastMeta = meta;
  renderSyncPanel();
}
async function callCloudData(action, payload = {}, token = appSessionPassword) {
  if (!cloudDatabaseAvailable()) throw new Error("请通过 Vercel、本地开发服务器打开网页，或填写 Cloudflare Worker 备用云同步地址。");
  const syncToken = String(token || appSessionPassword || "").trim();
  if (!syncToken) throw new Error("请先输入应用密码。");
  const response = await fetch(cloudApiUrl("/api/cloud-data"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Team-Token": syncToken
    },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || `${cloudSyncProviderLabel()}同步失败：${response.status}`);
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}
async function verifyVercelPassword(candidate) {
  const response = await fetch(defaultCloudApiUrl("/api/app-auth"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: candidate })
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (response.ok && result.ok) return { ok: true, source: "vercel-env" };
  if (response.status !== 404) return { ok: false, error: result.error || "密码不正确" };
  return { ok: false, error: "未检测到 Vercel 登录接口" };
}
async function verifyAppPassword(password) {
  const candidate = String(password || "").trim();
  if (!candidate) return { ok: false, error: "请输入应用密码" };
  if (!cloudDatabaseAvailable()) {
    if (!data.adminPassword) return { ok: false, error: "本地模式还没有设置应用密码，请通过 Vercel 环境变量 APP_PASSWORD 或 TEAM_SYNC_TOKEN 配置。" };
    return candidate === String(data.adminPassword)
      ? { ok: true, source: "local" }
      : { ok: false, error: "密码不正确" };
  }
  try {
    const response = await fetch(cloudApiUrl("/api/app-auth"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: candidate })
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (response.ok && result.ok) return { ok: true, source: cloudSyncEndpoint ? "worker-env" : "vercel-env" };
    if (response.status !== 404) {
      if (cloudSyncEndpoint && window.location.protocol !== "file:") {
        const fallback = await verifyVercelPassword(candidate).catch(() => null);
        if (fallback?.ok) {
          cloudSyncEndpoint = "";
          cloudDbLastSeenSha = "";
          setCloudDbStatus("Worker 登录失败，已临时切回 Vercel");
          syncCloudEndpointInputs();
          return { ok: true, source: "vercel-fallback" };
        }
      }
      return { ok: false, error: result.error || "密码不正确" };
    }
  } catch {
    if (cloudSyncEndpoint && window.location.protocol !== "file:") {
      const fallback = await verifyVercelPassword(candidate).catch(() => null);
      if (fallback?.ok) {
        cloudSyncEndpoint = "";
        cloudDbLastSeenSha = "";
        setCloudDbStatus("Worker 不可用，已临时切回 Vercel");
        syncCloudEndpointInputs();
        return { ok: true, source: "vercel-fallback" };
      }
    }
    // Older deployments may not have the standalone auth endpoint yet; cloud data auth is the fallback.
  }
  const cloudResult = await pullCloudDatabaseData({ silent: true, token: candidate, beforeUnlock: true });
  if (cloudResult.pulled || cloudResult.reason === "empty-cloud") return { ok: true, source: "cloud-data" };
  return { ok: false, error: "密码不正确" };
}
async function refreshCloudDatabaseStatus(silent = false) {
  if (!cloudDatabaseAvailable()) {
    setCloudDbStatus("本地文件打开不可用");
    return;
  }
  if (isCloudDbQuotaPaused()) {
    setCloudDbStatus(cloudDbQuotaMessage(), cloudDbLastMeta);
    return;
  }
  if (!appSessionPassword) {
    try {
      const response = await fetch(cloudApiUrl("/api/cloud-data"), { cache: "no-store" });
      const result = await response.json();
      if (!result.configured) setCloudDbStatus(cloudSyncEndpoint ? "未配置 D1 数据库" : "未配置 DATABASE_URL");
      else if (!result.protected) setCloudDbStatus("未配置 TEAM_SYNC_TOKEN");
      else if (cloudSyncEndpoint && result.encrypted === false) setCloudDbStatus("未配置加密密钥");
      else setCloudDbStatus("已配置，登录后自动同步");
    } catch {
      setCloudDbStatus("未检测到云同步 API");
    }
    return;
  }
  try {
    const result = await callCloudData("meta", {}, appSessionPassword);
    clearCloudDbQuotaPause();
    cloudDbLastSeenSha = result.meta?.data_sha256 || cloudDbLastSeenSha;
    setCloudDbStatus(result.meta ? `已连接 · ${cloudDataMetaText(result.meta)}` : "已连接，云库暂无数据", result.meta || null);
  } catch (error) {
    if (isQuotaError(error)) {
      pauseCloudDbForQuota(error);
      return;
    }
    setCloudDbStatus(`连接失败：${error.message}`);
    if (!silent) alert(`${cloudSyncProviderLabel()}同步检查失败：${error.message}`);
  }
}
async function pullCloudDatabaseData({ silent = false, token = appSessionPassword, beforeUnlock = false } = {}) {
  if (!cloudDatabaseAvailable()) {
    setCloudDbStatus("本地文件打开不可用");
    return { pulled: false, reason: "not-available" };
  }
  const syncToken = String(token || appSessionPassword || "").trim();
  if (!syncToken) {
    setCloudDbStatus("登录后自动同步");
    return { pulled: false, reason: "missing-token" };
  }
  if (isCloudDbQuotaPaused()) {
    setCloudDbStatus(cloudDbQuotaMessage(), cloudDbLastMeta);
    return { pulled: false, reason: "cloud-quota-paused" };
  }
  try {
    if (!beforeUnlock && silent && isActiveTypingWindow()) {
      setCloudDbStatus("正在输入，稍后同步");
      return { pulled: false, reason: "active-typing" };
    }
    if (!beforeUnlock) preserveActiveDraft();
    const result = await callCloudData("pull", {}, syncToken);
    if (result.data) {
      if (!silent) createBackup(`${cloudSyncProviderLabel()}刷新前备份`);
      data = mergeCloudData(result.data, data, "records");
      persistLocal();
      if (!data.members.includes(currentMember)) currentMember = data.members[0] || currentMember;
      if (!beforeUnlock) {
        loadForm();
        render();
      }
      clearCloudDbQuotaPause();
      cloudDbLastSeenSha = result.meta?.data_sha256 || cloudDbLastSeenSha;
      setCloudDbStatus(`已读取${cloudSyncProviderLabel()} · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta || null);
      return { pulled: true, data };
    }
    clearCloudDbQuotaPause();
    setCloudDbStatus("云库暂无数据，首次保存会创建");
    return { pulled: false, reason: "empty-cloud" };
  } catch (error) {
    if (isQuotaError(error)) return pauseCloudDbForQuota(error);
    setCloudDbStatus(`读取失败：${error.message}`);
    if (!silent) alert(`${cloudSyncProviderLabel()}读取失败：${error.message}`);
    return { pulled: false, reason: error.message };
  }
}
async function saveCloudDatabaseData(mode = "records", silent = false) {
  if (!cloudDatabaseAvailable()) {
    setCloudDbStatus("本地文件打开不可用");
    return { written: false, reason: "not-available" };
  }
  if (!appSessionPassword) {
    setCloudDbStatus(`未登录，不能写入${cloudSyncProviderLabel()}`);
    return { written: false, reason: "missing-token" };
  }
  if (isCloudDbQuotaPaused()) {
    setCloudDbStatus(cloudDbQuotaMessage(), cloudDbLastMeta);
    return { written: false, reason: "cloud-quota-paused" };
  }
  try {
    const result = await callCloudData("save", { data: normalize(data), mode, actor: currentMember }, appSessionPassword);
    if (result.data) {
      data = mergeCloudData(result.data, data, "records");
      persistLocal();
    }
    clearCloudDbQuotaPause();
    cloudDbLastSeenSha = result.meta?.data_sha256 || cloudDbLastSeenSha;
    setCloudDbStatus(`已写入${cloudSyncProviderLabel()} · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta || null);
    return { written: true, meta: result.meta || null };
  } catch (error) {
    if (isQuotaError(error)) return { written: false, ...pauseCloudDbForQuota(error) };
    setCloudDbStatus(`写入失败：${error.message}`);
    if (!silent) alert(`${cloudSyncProviderLabel()}写入失败：${error.message}`);
    return { written: false, reason: error.message };
  }
}
async function syncCloudDatabaseIfChanged({ silent = true } = {}) {
  if (!cloudDatabaseAvailable() || !appSessionPassword) return { pulled: false, reason: "not-ready" };
  if (isCloudDbQuotaPaused()) {
    setCloudDbStatus(cloudDbQuotaMessage(), cloudDbLastMeta);
    return { pulled: false, reason: "cloud-quota-paused" };
  }
  if (silent && isActiveTypingWindow()) {
    setCloudDbStatus("正在输入，稍后同步");
    return { pulled: false, reason: "active-typing" };
  }
  try {
    const result = await callCloudData("meta", {}, appSessionPassword);
    clearCloudDbQuotaPause();
    const nextSha = result.meta?.data_sha256 || "";
    if (!nextSha) {
      setCloudDbStatus("云库暂无数据，首次保存会创建", result.meta || null);
      return { pulled: false, reason: "empty-cloud" };
    }
    if (cloudDbLastSeenSha && nextSha === cloudDbLastSeenSha) {
      setCloudDbStatus(`云库无新变化 · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta || null);
      return { pulled: false, reason: "unchanged" };
    }
    return await pullCloudDatabaseData({ silent });
  } catch (error) {
    if (isQuotaError(error)) return pauseCloudDbForQuota(error);
    setCloudDbStatus(`检查失败：${error.message}`);
    return { pulled: false, reason: error.message };
  }
}
function startCloudDbPolling() {
  window.clearInterval(cloudDbPollTimer);
  if (!appSessionPassword || !cloudDatabaseAvailable() || isCloudDbQuotaPaused()) return;
  cloudDbPollTimer = window.setInterval(() => {
    syncCloudDatabaseIfChanged({ silent: true }).catch(() => {});
  }, cloudDbPollMs);
}
function renderCloudHistoryPanel() {
  const select = $("cloudHistorySelect");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `<option value="">选择云端历史版本</option>` + cloudHistoryEvents.map((item) => {
    const createdAt = item.created_at ? new Date(item.created_at).toLocaleString("zh-CN") : "未知时间";
    const actor = item.actor ? ` · ${item.actor}` : "";
    return `<option value="${escapeAttr(item.id)}">${escapeHtml(createdAt + actor)} · ${Number(item.record_count || 0)} 条</option>`;
  }).join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}
async function refreshCloudHistory(silent = false) {
  try {
    const result = await callCloudData("history");
    cloudHistoryEvents = result.events || [];
    renderCloudHistoryPanel();
    if (!silent) showDialog("云端历史已刷新", `已读取最近 ${cloudHistoryEvents.length} 个云端历史版本。`, "");
  } catch (error) {
    if (!silent) alert(`读取云端历史失败：${error.message}`);
  }
}
async function restoreCloudHistory() {
  const eventId = $("cloudHistorySelect")?.value || "";
  if (!eventId) return alert("请先选择一个云端历史版本。");
  if (!confirm("确定恢复到这个云端历史版本？当前数据会先保留本地备份。")) return;
  createBackup("云端历史恢复前备份");
  const result = await callCloudData("restore_history", { eventId });
  data = normalize(result.data);
  persistLocal();
  if (!data.members.includes(currentMember)) currentMember = data.members[0] || currentMember;
  loadForm();
  render();
  await refreshCloudHistory(true);
  showDialog("云端历史已恢复", `已经把团队数据恢复到选中的历史版本，并写回${cloudSyncProviderLabel()}。`, "");
}
function cloudBackupAvailable() {
  return window.location.protocol !== "file:" && typeof fetch === "function";
}
function cloudBackupMetaText(meta) {
  if (!meta) return "暂无云快照";
  const createdAt = meta.created_at ? new Date(meta.created_at).toLocaleString("zh-CN") : "未知时间";
  return `${Number(meta.record_count || 0)} 条 · ${Number(meta.member_count || 0)} 人 · ${createdAt}`;
}
function setCloudBackupStatus(message, meta, backups) {
  cloudBackupStatusText = message || cloudBackupStatusText;
  if (meta !== undefined) cloudBackupLastMeta = meta;
  if (Array.isArray(backups)) cloudBackupBackups = backups;
  renderCloudBackupPanel();
}
function selectedCloudBackupId() {
  return $("cloudBackupSelect")?.value || "";
}
function renderCloudBackupPanel() {
  const statusBox = $("cloudBackupStatusBox");
  if (!statusBox) return;
  const available = cloudBackupAvailable();
  const latest = cloudBackupMetaText(cloudBackupLastMeta);
  statusBox.innerHTML = `
    <div><span>云库状态</span><strong>${escapeHtml(available ? cloudBackupStatusText : "本地文件打开不可用")}</strong></div>
    <div><span>最新快照</span><strong>${escapeHtml(latest)}</strong></div>
    <div><span>快照数量</span><strong>${cloudBackupBackups.length ? `${cloudBackupBackups.length} 个最近备份` : "暂无列表"}</strong></div>
  `;
  const select = $("cloudBackupSelect");
  if (select) {
    const previous = select.value;
    select.innerHTML = `<option value="">最新云快照</option>` + cloudBackupBackups.map((item) => `
      <option value="${escapeAttr(item.id)}">${escapeHtml(item.label || "云备份")} · ${escapeHtml(new Date(item.created_at).toLocaleString("zh-CN"))}</option>
    `).join("");
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  ["cloudBackupStatusBtn", "cloudBackupNowBtn", "cloudRestoreLatestBtn", "cloudBackupSelect"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !available;
  });
}
async function callCloudBackup(action, payload = {}) {
  if (!cloudBackupAvailable()) throw new Error("请通过 Vercel 或本地开发服务器打开网页，直接打开本地文件不能调用云数据库。");
  cloudBackupToken = $("cloudBackupTokenInput")?.value.trim() || cloudBackupToken;
  if (!cloudBackupToken) throw new Error("请先输入云备份口令。");
  const response = await fetch("/api/cloud-backup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Backup-Token": cloudBackupToken
    },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok || result.ok === false) throw new Error(result.error || `云数据库请求失败：${response.status}`);
  return result;
}
async function refreshCloudBackupStatus(silent = false) {
  if (!cloudBackupAvailable()) {
    setCloudBackupStatus("本地文件打开不可用", cloudBackupLastMeta);
    if (!silent) alert("请部署到 Vercel，或用本地开发服务器打开网页后再使用云数据库备份。");
    return;
  }
  cloudBackupToken = $("cloudBackupTokenInput")?.value.trim() || cloudBackupToken;
  if (!cloudBackupToken) {
    try {
      const response = await fetch("/api/cloud-backup", { cache: "no-store" });
      const result = await response.json();
      if (!result.configured) setCloudBackupStatus("未配置 DATABASE_URL", null, []);
      else if (!result.protected) setCloudBackupStatus("未配置 CLOUD_BACKUP_TOKEN", null, []);
      else setCloudBackupStatus("已配置，输入口令可查看", cloudBackupLastMeta);
    } catch {
      setCloudBackupStatus("未检测到云备份 API", cloudBackupLastMeta);
    }
    return;
  }
  setCloudBackupStatus("正在检查云数据库...");
  const result = await callCloudBackup("list");
  setCloudBackupStatus(result.latest ? "云数据库已连接" : "已连接，暂无备份", result.latest || null, result.backups || []);
}
async function backupToCloudDatabase() {
  if (!adminUnlocked) return setView("admin");
  const snapshot = normalize(clone(selectedReportData()));
  const source = selectedReportLabel();
  const label = `${source} · ${new Date().toLocaleString("zh-CN")}`;
  setCloudBackupStatus("正在写入云数据库...");
  const result = await callCloudBackup("backup", { label, source, data: snapshot });
  setCloudBackupStatus(`已备份云数据库 · ${new Date().toLocaleTimeString("zh-CN")}`, result.latest || result.meta, result.backups || []);
  showDialog("云数据库备份完成", `已把“${source}”备份到云数据库，共 ${Number(result.meta?.record_count || 0)} 条记录。`, "");
}
async function restoreFromCloudDatabase() {
  if (!adminUnlocked) return setView("admin");
  if (!confirm("确定从云数据库恢复？当前数据会先保留一个本地恢复前备份。")) return;
  setCloudBackupStatus("正在读取云数据库...");
  const result = await callCloudBackup("restore", { backupId: selectedCloudBackupId() });
  createBackup("云数据库恢复前备份");
  data = normalize(result.data);
  currentMember = data.members[0] || currentMember;
  persistLocal();
  const writeResult = await persistEverywhere("admin");
  loadForm();
  render();
  setCloudBackupStatus(`已从云数据库恢复 · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta, cloudBackupBackups);
  showDialog("云数据库恢复完成", writeResult?.written ? "云备份已经恢复并同步到当前云端文件夹。" : "云备份已经恢复到当前浏览器草稿，请选择云端文件夹后再保存同步。", "");
}
function renderSummaryFolders() {
  const box = $("summaryFolderBox");
  if (!box) return;
  const sourceStats = sourceDatasets.map((source, index) => {
    const recordCount = Object.keys(source.data.records || {}).length;
    const memberCount = source.data.members?.length || 0;
    return `
      <button class="summary-source-card ${activeReportSource === `source:${index}` ? "active" : ""}" data-report-source="source:${index}">
        <strong>${escapeHtml(source.label)}</strong>
        <span>${memberCount} 人 · ${recordCount} 条${source.error ? ` · ${escapeHtml(source.error)}` : ""}</span>
      </button>
    `;
  }).join("");
  box.innerHTML = `
    <div class="summary-folder-line">
      <span>来源文件夹</span>
      <strong>${sourceDirLabels.length ? sourceDirLabels.map(escapeHtml).join("、") : "未添加"}</strong>
    </div>
    <div class="summary-folder-line">
      <span>汇总文件夹</span>
      <strong>${escapeHtml(summaryLocationLabel || "未选择")}</strong>
    </div>
    <div class="summary-folder-line">
      <span>高级管理员</span>
      <strong>${superAdminUnlocked ? `已开启 · 当前查看 ${escapeHtml(selectedReportLabel())}` : "未提升"}</strong>
    </div>
    <div class="summary-folder-line">
      <span>汇总提醒</span>
      <strong>总文件夹不会自动收到成员提交；高级管理员需要刷新来源数据并点击“同步到汇总”。</strong>
    </div>
    <div class="summary-source-grid">${sourceStats || `<div class="hint">提升高级管理员权限后，可加载并切换多个来源文件夹的数据。</div>`}</div>
  `;
  box.querySelectorAll("[data-report-source]").forEach((button) => {
    button.onclick = () => {
      activeReportSource = button.dataset.reportSource || "current";
      renderReportSourceTabs();
      renderOverview();
      renderHistory();
      renderSummaryFolders();
    };
  });
}
function adminCenterTargetText() {
  const targets = [];
  if (desktopApp?.isDesktop) targets.push("本机 data/report_data.json");
  if (fileHandle) targets.push(cloudLocationLabel || "备用文件");
  if (summaryDirHandle) targets.push(`${summaryLocationLabel || "汇总文件夹"}\\report_data.json`);
  return targets.length ? targets.join("、") : "未选择共享副本";
}
function renderAdminCenterPanel() {
  const box = $("adminCenterStatusBox");
  if (!box) return;
  const recordCount = Object.keys(data.records || {}).length;
  const memberCount = data.members?.length || 0;
  const cachedAt = data.updated_at ? new Date(data.updated_at).toLocaleString("zh-CN") : "暂无";
  const sourceOk = sourceDatasets.filter((source) => !source.error).length;
  box.innerHTML = `
    <div><span>中心副本</span><strong>${recordCount} 条 · ${memberCount} 人</strong></div>
    <div><span>本机时间</span><strong>${escapeHtml(cachedAt)}</strong></div>
    <div><span>可合并来源</span><strong>${sourceOk}/${sourceDirHandles.length} 个来源 · ${sharedReplicaCount} 个成员副本</strong></div>
    <div><span>共享落点</span><strong>${escapeHtml(adminCenterTargetText())}</strong></div>
  `;
}
function startCloudPolling() {
  window.clearInterval(syncPollTimer);
  syncPollTimer = window.setInterval(() => pollSharedFile(false), syncPollMs);
}
function dailyQuotaEntry(day = currentDate) {
  if (!data.dailyQuotas || typeof data.dailyQuotas !== "object") data.dailyQuotas = {};
  if (!data.dailyQuotas[day]) data.dailyQuotas[day] = { default: "", members: {} };
  if (!data.dailyQuotas[day].members) data.dailyQuotas[day].members = {};
  return data.dailyQuotas[day];
}
function quotaValue(value) {
  return value === "" || value === undefined || value === null ? null : Number(value);
}
function memberQuota(member, day = currentDate) {
  const report = reportData();
  const daily = report.dailyQuotas?.[day];
  const dailyOwn = quotaValue(daily?.members?.[member]);
  if (dailyOwn !== null) return dailyOwn;
  const dailyDefault = quotaValue(daily?.default);
  if (dailyDefault !== null) return dailyDefault;
  const own = quotaValue(report.memberQuotas?.[member]);
  return own === null ? Number(report.quota || 0) : own;
}
function setDailyDefaultQuota(day, value) {
  const entry = dailyQuotaEntry(day);
  entry.default = value === "" ? "" : Number(value || 0);
}
function setDailyMemberQuota(member, day, value) {
  const entry = dailyQuotaEntry(day);
  if (value === "") delete entry.members[member];
  else entry.members[member] = Number(value || 0);
}
function dailyMemberQuotaValue(member, day = currentDate) {
  const value = data.dailyQuotas?.[day]?.members?.[member];
  return value === undefined || value === null ? "" : Number(value);
}
function groupMembers(group) {
  const report = reportData();
  return reportMembers(report).filter((member) => (report.memberGroups?.[member] || report.groups[0]) === group);
}
function reportMembers(report = reportData()) {
  const members = new Set(report.members || []);
  const deletedMembers = clearActiveDeletedMembers(report);
  Object.values(report.records || {}).forEach((record) => {
    if (deletedMembers?.[record?.member]) return;
    if (record?.member) members.add(record.member);
  });
  Object.keys(deletedMembers || {}).forEach((member) => members.delete(member));
  return Array.from(members).sort((a, b) => {
    const ai = (report.members || []).indexOf(a);
    const bi = (report.members || []).indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return String(a).localeCompare(String(b), "zh-CN");
  });
}
function membersForGroupValue(group, report = reportData()) {
  const members = reportMembers(report);
  if (!group || group === "__all__") return members;
  return members.filter((member) => (report.memberGroups?.[member] || report.groups?.[0]) === group);
}
function overviewGroupsForReport(report = reportData()) {
  return Array.isArray(report.groups) ? report.groups : [];
}
function selectedOverviewGroups(report = reportData()) {
  const groups = overviewGroupsForReport(report);
  const selected = Array.isArray(overviewSelectedGroups) ? overviewSelectedGroups.filter((group) => groups.includes(group)) : [];
  return selected.length ? selected : groups;
}
function overviewGroupLabel(report = reportData()) {
  const groups = overviewGroupsForReport(report);
  const selected = selectedOverviewGroups(report);
  if (!groups.length || selected.length === groups.length) return "全部分组";
  if (selected.length === 1) return selected[0];
  return `已选 ${selected.length} 个分组`;
}
function renderOverviewGroupPicker(report = reportData()) {
  const picker = $("overviewGroupPicker");
  const menu = $("overviewGroupMenu");
  const toggle = $("overviewGroupToggle");
  if (!picker || !menu || !toggle) return;
  const groups = overviewGroupsForReport(report);
  const selected = selectedOverviewGroups(report);
  toggle.textContent = overviewGroupLabel(report);
  const allChecked = !groups.length || selected.length === groups.length;
  menu.innerHTML = `
    <label><input type="checkbox" data-overview-group="__all__" ${allChecked ? "checked" : ""}> <span>全部分组</span></label>
    ${groups.map((group) => `
      <label><input type="checkbox" data-overview-group="${escapeAttr(group)}" ${selected.includes(group) ? "checked" : ""}> <span>${escapeHtml(group)}</span></label>
    `).join("")}
  `;
  toggle.onclick = (event) => {
    event.stopPropagation();
    picker.classList.toggle("open");
  };
  menu.onclick = (event) => event.stopPropagation();
  menu.querySelectorAll("input[data-overview-group]").forEach((input) => {
    input.onchange = () => {
      if (input.dataset.overviewGroup === "__all__") {
        overviewSelectedGroups = input.checked ? [] : [];
      } else {
        const checked = Array.from(menu.querySelectorAll("input[data-overview-group]:checked"))
          .map((item) => item.dataset.overviewGroup)
          .filter((group) => group && group !== "__all__");
        overviewSelectedGroups = checked.length === groups.length ? [] : checked;
      }
      localStorage.setItem("dailyReportOverviewGroups", JSON.stringify(overviewSelectedGroups));
      renderOverview();
    };
  });
}
function renderGroupMemberSelectors(groupId, memberId, selectedGroup, selectedMember, includeAll = true, includeAllMembers = true) {
  const report = reportData();
  const groupSelect = $(groupId);
  const memberSelect = $(memberId);
  if (!groupSelect || !memberSelect) return { group: selectedGroup || "__all__", member: selectedMember || "" };
  const currentGroup = selectedGroup || groupSelect.value || "__all__";
  groupSelect.innerHTML = `${includeAll ? `<option value="__all__">全部分组</option>` : ""}${report.groups.map((group) => `<option value="${escapeAttr(group)}">${escapeHtml(group)}</option>`).join("")}`;
  groupSelect.value = [...groupSelect.options].some((option) => option.value === currentGroup) ? currentGroup : (includeAll ? "__all__" : report.groups[0] || "");
  const members = membersForGroupValue(groupSelect.value, report);
  const currentMemberValue = selectedMember ?? memberSelect.value ?? "";
  const allLabel = groupSelect.value && groupSelect.value !== "__all__" ? `${groupSelect.value} 全部成员` : "全部成员";
  memberSelect.innerHTML = `${includeAllMembers ? `<option value="">${escapeHtml(allLabel)}</option>` : ""}${members.map((member) => `<option value="${escapeAttr(member)}">${escapeHtml(member)}</option>`).join("")}`;
  memberSelect.value = members.includes(currentMemberValue) ? currentMemberValue : (includeAllMembers ? "" : members[0] || "");
  return { group: groupSelect.value, member: memberSelect.value };
}
function dateFromKey(key) {
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
function dateKeyFromDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function addDays(key, offset) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + offset);
  return dateKeyFromDate(date);
}
function monthKeyFromDateKey(key) {
  return String(key || todayLocalKey()).slice(0, 7);
}
function daysInMonth(monthKey) {
  const [year, month] = String(monthKey || monthKeyFromDateKey(currentDate)).split("-").map(Number);
  return new Date(year, month, 0).getDate();
}
function sameDayInMonth(monthKey, dayKey = currentDate) {
  const day = Math.min(Number(String(dayKey).slice(8, 10)) || 1, daysInMonth(monthKey));
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}
function shiftMonth(dayKey, offset) {
  const date = dateFromKey(dayKey);
  date.setMonth(date.getMonth() + offset, 1);
  const monthKey = dateKeyFromDate(date).slice(0, 7);
  return sameDayInMonth(monthKey, dayKey);
}
function weekStartKey(dayKey) {
  const date = dateFromKey(dayKey);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return dateKeyFromDate(date);
}
function weekRangeFor(dayKey) {
  const start = weekStartKey(dayKey);
  return { start, end: addDays(start, 6) };
}
function shiftMonthKey(monthKey, offset) {
  const [year, month] = String(monthKey || monthKeyFromDateKey(currentDate)).split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return dateKeyFromDate(date).slice(0, 7);
}
function dateKeyForMonthDay(monthKey, day) {
  const safeDay = Math.min(Math.max(1, Number(day) || 1), daysInMonth(monthKey));
  return `${monthKey}-${String(safeDay).padStart(2, "0")}`;
}
function cutoffPeriodRange(dayKey, cutoffDay) {
  const monthKey = monthKeyFromDateKey(dayKey);
  const day = Number(String(dayKey || "").slice(8, 10)) || 1;
  const endMonth = day <= cutoffDay ? monthKey : shiftMonthKey(monthKey, 1);
  return {
    start: dateKeyForMonthDay(shiftMonthKey(endMonth, -1), cutoffDay),
    end: dateKeyForMonthDay(endMonth, cutoffDay)
  };
}
function overviewRangeInfo() {
  if (overviewRangeMode === "day") return { label: "今日", start: currentDate, end: currentDate };
  if (overviewRangeMode === "small-month") return { label: "小月度汇总", ...cutoffPeriodRange(currentDate, 14) };
  if (overviewRangeMode === "month") return { label: "月度汇总", ...cutoffPeriodRange(currentDate, 23) };
  return { label: "本周", ...weekRangeFor(currentDate) };
}
function rangeText(range) {
  return range.start === range.end ? range.start : `${range.start} 至 ${range.end}`;
}
function applyMixedTableDefaultRange() {
  const startInput = $("mixedTableStart");
  const endInput = $("mixedTableEnd");
  if (!startInput || !endInput) return;
  if (mixedTableRangeMode !== "default" && startInput.value && endInput.value) return;
  const range = weekRangeFor(currentDate);
  startInput.value = range.start;
  endInput.value = range.end;
  mixedTableRangeMode = "default";
}
function applyCheckinDefaultRange() {
  const startInput = $("checkinViewStart");
  const endInput = $("checkinViewEnd");
  if (!startInput || !endInput) return;
  if (checkinViewRangeMode !== "default" && startInput.value && endInput.value) return;
  const range = weekRangeFor(currentDate);
  startInput.value = range.start;
  endInput.value = range.end;
  checkinViewRangeMode = "default";
}
function selectDate(nextDate, shouldSave = true) {
  if (!nextDate) return;
  if (shouldSave) saveFormSilently();
  currentDate = nextDate;
  if ($("dateInput")) $("dateInput").value = currentDate;
  if ($("overviewDateInput")) $("overviewDateInput").value = currentDate;
  loadForm();
  render();
}
function renderWeekStrip(containerId) {
  const box = $(containerId);
  if (!box) return;
  const start = weekStartKey(currentDate);
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  box.innerHTML = weekdays.map((weekday, index) => {
    const day = addDays(start, index);
    const active = day === currentDate;
    const outMonth = day.slice(0, 7) !== currentDate.slice(0, 7);
    return `
      <button class="day-cell ${active ? "active" : ""} ${outMonth ? "out-month" : ""}" type="button" data-calendar-day="${day}" title="${day}">
        <span>周${weekday}</span>
        <strong>${Number(day.slice(8, 10))}</strong>
      </button>
    `;
  }).join("");
  box.querySelectorAll("[data-calendar-day]").forEach((button) => {
    button.onclick = () => selectDate(button.dataset.calendarDay);
  });
}
function renderDateCalendars() {
  const monthKey = monthKeyFromDateKey(currentDate);
  if ($("dateDisplay")) $("dateDisplay").textContent = currentDate;
  if ($("dateInput")) $("dateInput").value = currentDate;
  if ($("overviewDateInput")) $("overviewDateInput").value = currentDate;
  if ($("monthInput")) $("monthInput").value = monthKey;
  if ($("overviewMonthInput")) $("overviewMonthInput").value = monthKey;
  renderWeekStrip("dateWeekStrip");
  renderWeekStrip("overviewWeekStrip");
}
function periodKeys(endKey, days) {
  return Array.from({ length: days }, (_, index) => addDays(endKey, index - days + 1));
}
function recordForReport(report, day, member) {
  const direct = report?.records?.[`${day}|${member}`];
  if (direct && (!direct.date || direct.date === day) && (!direct.member || direct.member === member)) return direct;
  return Object.values(report?.records || {}).find((record) => record?.date === day && record?.member === member) || null;
}
function recordFor(day, member) {
  return recordForReport(reportData(), day, member);
}
function ensureRecordFor(day, member) {
  const key = `${day}|${member}`;
  if (!data.records[key]) {
    data.records[key] = {
      date: day,
      member,
      text: "",
      raw_total: 0,
      weighted_total: 0,
      quota_total: memberQuota(member, day),
      status: "待审核",
      reason: "",
      harvest: "",
      diary: "",
      items: {},
      checkins: {},
      updated_at: ""
    };
  }
  data.records[key].checkins = sanitizeCheckins(data.records[key].checkins || {});
  return data.records[key];
}
function updateRecordTotals(rec) {
  const parsed = { items: rec.items || {}, ...entryTotals(rec.items || {}) };
  rec.items = parsed.items;
  rec.text = itemsToText(parsed.items);
  rec.raw_total = parsed.raw;
  rec.weighted_total = parsed.weighted;
  rec.quota_total = memberQuota(rec.member, rec.date);
  if (!rec.status) rec.status = "待审核";
  rec.updated_at = new Date().toISOString();
  return rec;
}
function analysisGroupValue(report = reportData()) {
  const group = $("analysisGroup")?.value || report.groups?.[0] || "";
  return report.groups?.includes(group) ? group : report.groups?.[0] || "";
}
function analysisMembersForScope(scope, member, report = reportData()) {
  if (scope === "team") return reportMembers(report);
  const group = analysisGroupValue(report);
  if (scope === "group") return membersForGroupValue(group, report);
  return member ? [member] : membersForGroupValue(group, report);
}
function aggregatePeriod(days, scope, member) {
  const report = reportData();
  const members = analysisMembersForScope(scope, member, report);
  const itemNames = configuredItems();
  const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
  const daily = days.map((day) => {
    let weighted = 0;
    let raw = 0;
    let quota = 0;
    members.forEach((name) => {
      const rec = recordFor(day, name);
      const memberItems = rec?.items || {};
      weighted += Number(rec?.weighted_total || 0);
      raw += Number(rec?.raw_total || 0);
      quota += memberQuota(name, day);
      itemNames.forEach((item) => {
        itemTotals[item] += Number(memberItems[item] || 0);
      });
    });
    return { day, raw, weighted, quota, diff: weighted - quota };
  });
  const weighted = daily.reduce((sum, row) => sum + row.weighted, 0);
  const quota = daily.reduce((sum, row) => sum + row.quota, 0);
  const raw = daily.reduce((sum, row) => sum + row.raw, 0);
  return { daily, raw, weighted, quota, diff: weighted - quota, itemTotals };
}
function renderMiniBars(containerId, rows, valueKey = "weighted") {
  const max = Math.max(...rows.map((row) => Math.abs(Number(row[valueKey] || 0))), 1);
  $(containerId).innerHTML = rows.map((row) => {
    const value = Number(row[valueKey] || 0);
    const width = Math.min(100, Math.round(Math.abs(value) / max * 100));
    return `
      <div class="chart-row">
        <div class="chart-label" title="${escapeAttr(row.label)}">${escapeHtml(row.label)}</div>
        <div class="chart-track"><div class="chart-bar ${value < 0 ? "warn" : ""}" style="--w:${width}%"></div></div>
        <div class="chart-value">${fmt(value)}</div>
      </div>
    `;
  }).join("") || `<div class="hint">还没有可分析的数据。</div>`;
}
function configuredItems() {
  return Object.keys(reportData().rules);
}
function groupVisibleItems(group, report = reportData()) {
  const all = Object.keys(report.rules || {});
  if (!group || group === "__all__") return all;
  const selected = Array.isArray(report.groupItems?.[group]) ? report.groupItems[group] : all;
  return all.filter((name) => selected.includes(name));
}
function totalsForItems(items = {}, itemNames = configuredItems(), report = reportData()) {
  const raw = itemNames.reduce((sum, name) => sum + Number(items[name] || 0), 0);
  const weighted = itemNames.reduce((sum, name) => {
    const weight = Number(report.rules?.[name] ?? 1);
    return sum + Number(items[name] || 0) * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { raw, weighted };
}
function memberVisibleItems(member = currentMember) {
  const group = data.memberGroups?.[member] || data.groups[0];
  const groupSelected = data.groupItems?.[group];
  const selected = Array.isArray(groupSelected) ? groupSelected : configuredItems();
  return configuredItems().filter((name) => selected.includes(name));
}
function nextRuleName() {
  let index = 1;
  let name = "新项目";
  while (data.rules[name] !== undefined) {
    name = `新项目 ${index}`;
    index += 1;
  }
  return name;
}
function normalizeNumberText(value) {
  const full = "０１２３４５６７８９．，";
  const half = "0123456789..";
  return value.replace(/[０-９．，]/g, (char) => half[full.indexOf(char)] || char).replace(/,/g, ".");
}
function currentRecord() {
  if (!data.records[recordKey()]) {
    data.records[recordKey()] = {
      date: currentDate,
      member: currentMember,
      text: "",
      raw_total: 0,
      weighted_total: 0,
      status: "待审核",
      reason: "",
      harvest: "",
      diary: "",
      items: {},
      checkins: {},
      updated_at: ""
    };
  }
  data.records[recordKey()].checkins = sanitizeCheckins(data.records[recordKey()].checkins || {});
  return data.records[recordKey()];
}
function nonZeroItems(items = {}) {
  return Object.fromEntries(Object.keys(items || {}).sort().map((name) => [name, Number(items[name] || 0)]).filter(([, amount]) => amount !== 0));
}
function sortedCheckins(checkins = {}) {
  const cleaned = sanitizeCheckins(checkins || {});
  return Object.fromEntries(Object.keys(cleaned).sort().map((key) => [key, cleaned[key]]));
}
function recordContentSnapshot(record = {}) {
  return {
    date: record.date || "",
    member: record.member || "",
    items: nonZeroItems(record.items || {}),
    status: record.status || "",
    reason: record.reason || "",
    harvest: record.harvest || "",
    diary: record.diary || "",
    checkins: sortedCheckins(record.checkins || {})
  };
}
function recordContentChanged(previous = {}, next = {}) {
  return JSON.stringify(recordContentSnapshot(previous)) !== JSON.stringify(recordContentSnapshot(next));
}
function checkinPeriods() {
  return [
    { key: "morning", label: "早" },
    { key: "noon", label: "中" },
    { key: "evening", label: "晚" }
  ];
}
function sanitizeCheckins(checkins = {}) {
  const cleaned = {};
  const allowed = new Set(checkinPeriods().map((period) => period.key));
  Object.entries(checkins || {}).forEach(([key, value]) => {
    if (!allowed.has(key) || !value) return;
    const status = normalizeCheckinStatus(checkinStatus(value));
    if (!status) return;
    cleaned[key] = typeof value === "object"
      ? { ...value, status }
      : { status };
  });
  return cleaned;
}
function checkinValueText(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeCheckinStatus(value);
  const status = normalizeCheckinStatus(value.status || "");
  const note = value.note ? `/${value.note}` : "";
  const time = value.time ? ` ${value.time}` : "";
  return `${status}${note}${time}`.trim();
}
function checkinStatus(value) {
  if (!value) return "";
  return normalizeCheckinStatus(typeof value === "string" ? value : String(value.status || ""));
}
function checkinDisplay(value) {
  if (value) return checkinValueText(value);
  return "未打卡";
}
function checkinTimeText(value) {
  if (!value || typeof value === "string") return "";
  return value.time ? `记录时间 ${value.time}` : "";
}
function setCheckin(periodKey) {
  saveFormSilently();
  const now = new Date();
  const updatedAt = now.toISOString();
  const rec = currentRecord();
  const next = sanitizeCheckins(rec.checkins || {});
  const status = normalizeCheckinStatus($(`checkinNote_${periodKey}`)?.value || "");
  if (!status) {
    delete next[periodKey];
  } else {
    next[periodKey] = {
      status,
      time: now.toLocaleTimeString("zh-CN", { hour12: false }),
      iso: updatedAt
    };
  }
  Object.assign(rec, {
    date: currentDate,
    member: currentMember,
    checkins: next,
    updated_at: updatedAt
  });
  persistLocal();
  scheduleRecordCloudSave();
  renderCheckins(rec.checkins);
  renderOverview();
}
function readCheckins() {
  return sanitizeCheckins(clone(currentRecord().checkins || {}));
}
function renderCheckins(seed = currentRecord().checkins || {}) {
  const box = $("checkinInputs");
  if (!box) return;
  seed = sanitizeCheckins(seed);
  const savedStatuses = Object.values(seed).map(checkinStatus).filter(Boolean);
  const options = normalizeCheckinOptions([...(data.checkinOptions || defaultData.checkinOptions), ...savedStatuses]);
  box.innerHTML = checkinPeriods().map((period) => `
    <label class="checkin-field">
      <span>${period.label}</span>
      <select id="checkinNote_${period.key}" data-checkin-period="${period.key}">
        <option value="">选择打卡选项</option>
        ${options.map((option) => `<option value="${escapeAttr(option)}" ${checkinStatus(seed[period.key]) === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
      <span class="checkin-time">${escapeHtml(checkinTimeText(seed[period.key]) || "未记录时间")}</span>
    </label>
  `).join("");
  box.querySelectorAll("select[data-checkin-period]").forEach((select) => {
    select.onchange = () => setCheckin(select.dataset.checkinPeriod);
  });
}
function checkinSummary(checkins = {}) {
  return checkinPeriods().map((period) => `${period.label}:${checkinDisplay(checkins[period.key])}`).join(" ");
}
function parseEntry(text) {
  const items = {};
  text.split(/\r?\n/).forEach((line) => {
    const match = normalizeNumberText(line).match(/^\s*([^:：=\s][^:：=\n]*?)\s*[:：=]\s*([-+]?\d+(?:\.\d+)?)\s*(?:个|条|件|份|次)?\s*$/);
    if (!match) return;
    const name = match[1].trim();
    items[name] = (items[name] || 0) + Number(match[2]);
  });
  const raw = Object.values(items).reduce((sum, amount) => sum + amount, 0);
  const weighted = Object.entries(items).reduce((sum, [name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return sum + amount * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { items, raw, weighted };
}
function entryTotals(items) {
  const raw = Object.values(items).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const weighted = Object.entries(items).reduce((sum, [name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return sum + Number(amount || 0) * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { raw, weighted };
}
function itemsToText(items) {
  return Object.entries(items)
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([name, amount]) => `${name}：${Number(amount || 0)}`)
    .join("\n");
}
function readEntryInputs() {
  const inputs = $("entryInputs").querySelectorAll("input[data-entry-item]");
  if (!inputs.length) return parseEntry($("entryText").value).items;
  const items = {};
  inputs.forEach((input) => {
    const name = input.dataset.entryItem || "";
    if (!name) return;
    items[name] = Number(input.value || 0);
  });
  return items;
}
function filterItemsByRules(items) {
  const filtered = {};
  const names = showAllEntryItems ? configuredItems() : memberVisibleItems(currentMember);
  names.forEach((name) => {
    filtered[name] = Number(items[name] || 0);
  });
  return filtered;
}
function renderEntryInputs(seedItems = readEntryInputs()) {
  const names = showAllEntryItems ? configuredItems() : memberVisibleItems(currentMember);
  $("entryInputs").innerHTML = names.map((name) => {
    const value = Number(seedItems[name] || 0);
    const weight = Number(data.rules[name] ?? 1);
    return `
      <div class="entry-field">
        <label>${escapeHtml(name)}</label>
        <input type="number" step="0.01" inputmode="decimal" data-entry-item="${escapeAttr(name)}" value="${value || ""}" placeholder="0">
        <small>换算系数 ${fmt(weight)}</small>
      </div>
    `;
  }).join("");
  $("entryInputs").querySelectorAll("input[data-entry-item]").forEach((input) => {
    input.addEventListener("input", () => {
      $("entryText").value = itemsToText(readEntryInputs());
      preview();
      scheduleDraftSave();
    });
  });
  $("entryText").value = itemsToText(readEntryInputs());
  $("selectedItemsBtn").classList.toggle("active", !showAllEntryItems);
  $("allItemsBtn").classList.toggle("active", showAllEntryItems);
}
function preview() {
  const items = readEntryInputs();
  const parsed = { items, ...entryTotals(items) };
  const quota = memberQuota(currentMember);
  const passed = parsed.weighted >= quota;
  $("rawTotal").textContent = fmt(parsed.raw);
  $("weightedTotal").textContent = fmt(parsed.weighted);
  $("auditText").textContent = passed ? "达标 ✓" : "不达标";
  $("auditCard").className = `metric ${passed ? "pass" : "fail"}`;
  const manualStatus = $("statusSelect")?.value || "自动判断";
  const displayStatus = manualStatus === "自动判断" ? "待审核" : manualStatus;
  $("statusPill").textContent = displayStatus;
  $("statusPill").className = `status ${displayStatus === "达标" ? "pass" : (displayStatus === "不达标" ? "fail" : "pending")}`;
  if ($("dailyQuotaInput")) $("dailyQuotaInput").placeholder = fmt(memberQuota(currentMember, currentDate));
  $("previewBody").innerHTML = Object.entries(parsed.items).map(([name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return `<tr><td>${escapeHtml(name)}</td><td>${fmt(amount)}</td><td>${fmt(weight)}</td><td>${fmt(amount * weight)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">还没有可统计的报数。</td></tr>`;
}
function loadForm() {
  const rec = currentRecord();
  $("dateInput").value = currentDate;
  $("quotaInput").value = String(data.quota);
  if ($("dailyQuotaInput")) {
    $("dailyQuotaInput").value = dailyMemberQuotaValue(currentMember, currentDate);
    $("dailyQuotaInput").placeholder = fmt(memberQuota(currentMember, currentDate));
  }
  $("entryText").value = rec.text || "";
  renderEntryInputs(Object.keys(rec.items || {}).length ? rec.items : parseEntry(rec.text || "").items);
  $("statusSelect").value = ["自动判断", "达标", "不达标", "待审核"].includes(rec.status) ? rec.status : "自动判断";
  $("reasonText").value = rec.reason || "";
  $("harvestText").value = rec.harvest || "";
  $("diaryText").value = rec.diary || "";
  renderCheckins(rec.checkins || {});
  preview();
}
function saveFormSilently() {
  data.quota = Number($("quotaInput").value || 0);
  if ($("dailyQuotaInput")) setDailyMemberQuota(currentMember, currentDate, $("dailyQuotaInput").value);
  const items = readEntryInputs();
  const parsed = { items, ...entryTotals(items) };
  $("entryText").value = itemsToText(items);
  const quota = memberQuota(currentMember);
  const autoStatus = parsed.weighted >= quota ? "达标" : "不达标";
  const selected = $("statusSelect").value;
  const rec = currentRecord();
  const finalStatus = selected === "自动判断" ? "待审核" : selected;
  const nextRecord = {
    date: currentDate,
    member: currentMember,
    text: itemsToText(items),
    raw_total: parsed.raw,
    weighted_total: parsed.weighted,
    quota_total: quota,
    status: finalStatus,
    reason: $("reasonText").value.trim(),
    harvest: $("harvestText").value.trim(),
    diary: $("diaryText").value.trim(),
    checkins: readCheckins(),
    items: parsed.items,
    updated_at: new Date().toISOString()
  };
  if (!recordContentChanged(rec, nextRecord)) return { rec, autoStatus, changed: false };
  Object.assign(rec, nextRecord);
  persistLocal();
  scheduleRecordCloudSave();
  return { rec, autoStatus, changed: true };
}
function pickReviewMessage(type) {
  const list = data.reviewMessages?.[type] || defaultData.reviewMessages[type];
  return list[Math.floor(Math.random() * list.length)] || (type === "pass" ? "恭喜达标" : "很遗憾不达标");
}
async function saveAndAudit() {
  createBackup("保存前备份");
  saveFormSilently();
  const result = await persistEverywhere("records");
  if (data.sheetBackupEnabled !== false) await backupSheets(true);
  render();
  if (!result?.written) {
    const message = result?.reason === "cloud-quota-paused"
      ? "云数据库额度已满或暂时不可用，这次已保存到本机浏览器草稿。请先恢复云同步服务，或选择团队共享文件夹作为临时备份后再重新提交。"
      : "这次只保存到了本机浏览器缓存。请确认云同步已配置应用密码，或点击顶部“云端文件夹”选择团队共享文件夹后重新提交。";
    showDialog("未同步到总数据", message, "");
  } else if (result.cloudDbWritten && !result.folderWritten) {
    showDialog(`已提交到${cloudSyncProviderLabel()}`, `记录已经写入${cloudSyncProviderLabel()}，等待管理员人工审核。当前没有写入文件夹备份。`, "");
  } else {
    showDialog("已提交", "记录已同步云端，等待管理员审核。", "");
  }
}
function renderMembers() {
  $("memberList").innerHTML = "";
  data.groups.forEach((group) => {
    const members = groupMembers(group);
    const box = document.createElement("details");
    box.className = "member-group";
    box.open = collapsedGroups[group] !== true;
    box.innerHTML = `
      <summary class="member-group-head">
        <span>${escapeHtml(group)} · ${members.length}</span>
        <button title="给 ${escapeAttr(group)} 添加成员" data-add-group-member="${escapeAttr(group)}">+</button>
      </summary>
    `;
    box.ontoggle = () => {
      collapsedGroups[group] = !box.open;
      localStorage.setItem("dailyReportCollapsedGroups", JSON.stringify(collapsedGroups));
    };
    members.forEach((name) => {
      const todayQuota = memberQuota(name, currentDate);
      const defaultQuota = data.memberQuotas[name] === "" || data.memberQuotas[name] === undefined ? data.quota : data.memberQuotas[name];
      const btn = document.createElement("button");
      btn.className = `member ${name === currentMember ? "active" : ""}`;
      btn.innerHTML = `<span><span>${escapeHtml(name)}</span><small>今日 ${fmt(todayQuota)} · 默认 ${fmt(defaultQuota)}</small></span><span class="badge">${memberTodayStatus(name)}</span>`;
      btn.onclick = () => {
        saveFormSilently();
        currentMember = name;
        loadForm();
        render();
      };
      box.appendChild(btn);
    });
    $("memberList").appendChild(box);
  });
  $("memberList").querySelectorAll("button[data-add-group-member]").forEach((button) => {
    button.onclick = () => {
      const name = prompt(`添加到 ${button.dataset.addGroupMember} 的成员名`);
      if (name?.trim()) addMember(name.trim(), button.dataset.addGroupMember);
    };
  });
  $("memberCard").textContent = currentMember;
}
function memberTodayStatus(name) {
  const rec = data.records[`${currentDate}|${name}`];
  if (!rec) return "未填";
  if (rec.status === "达标") return "达标";
  if (rec.status === "不达标") return "未达";
  return "待审";
}
function renderRules() {
  $("rulesBox").innerHTML = "";
  Object.entries(data.rules).forEach(([name, weight]) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `
      <input value="${escapeAttr(name)}" aria-label="项目">
      <input type="number" step="0.01" value="${Number(weight)}" aria-label="换算系数">
      <button class="icon" title="删除">×</button>
    `;
    const inputs = row.querySelectorAll("input");
    inputs[0].onchange = () => renameRule(name, inputs[0].value.trim(), Number(inputs[1].value));
    inputs[1].oninput = () => {
      data.rules[name] = Number(inputs[1].value || 0);
      renderEntryInputs(readEntryInputs());
      preview();
      scheduleSave("admin");
    };
    row.querySelector("button").onclick = () => {
      createBackup(`删除项目 ${name} 前备份`);
      delete data.rules[name];
      Object.keys(data.groupItems || {}).forEach((group) => {
        data.groupItems[group] = (data.groupItems[group] || []).filter((item) => item !== name);
      });
      Object.keys(data.memberItems || {}).forEach((member) => {
        data.memberItems[member] = (data.memberItems[member] || []).filter((item) => item !== name);
      });
      renderRules();
      renderEntryInputs(filterItemsByRules(readEntryInputs()));
      preview();
      scheduleSave("admin");
    };
    $("rulesBox").appendChild(row);
  });
}
function renderMemberQuotas() {
  $("memberQuotaBox").innerHTML = "";
  const selectedDay = $("adminQuotaDate")?.value || currentDate;
  if ($("adminQuotaDate")) $("adminQuotaDate").value = selectedDay;
  if ($("dateQuotaInput")) {
    const value = data.dailyQuotas?.[selectedDay]?.default;
    $("dateQuotaInput").value = value === undefined || value === null ? "" : value;
    $("dateQuotaInput").placeholder = fmt(data.quota);
  }
  data.members.forEach((name) => {
    const row = document.createElement("div");
    row.className = "quota-row";
    const own = data.memberQuotas[name] ?? "";
    const dayOwn = data.dailyQuotas?.[selectedDay]?.members?.[name];
    row.innerHTML = `
      <input value="${escapeAttr(name)}" aria-label="成员">
      <input type="number" step="0.01" min="0" placeholder="${fmt(data.quota)}" value="${own === "" ? "" : Number(own)}" aria-label="成员定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberQuota(name, selectedDay))}" value="${dayOwn === undefined || dayOwn === null ? "" : Number(dayOwn)}" aria-label="当天定额">
      <button class="icon" title="删除成员">×</button>
    `;
    const inputs = row.querySelectorAll("input");
    inputs[0].onchange = () => renameMember(name, inputs[0].value.trim());
    inputs[1].oninput = () => {
      data.memberQuotas[name] = inputs[1].value === "" ? "" : Number(inputs[1].value);
      renderOverview();
      scheduleSave("admin");
    };
    inputs[2].oninput = () => {
      setDailyMemberQuota(name, selectedDay, inputs[2].value);
      preview();
      renderOverview();
      scheduleSave("admin");
    };
    row.querySelector("button").onclick = () => removeMember(name);
    $("memberQuotaBox").appendChild(row);
  });
}
function renderMemberGroups() {
  $("memberGroupBox").innerHTML = data.groups.map((group) => {
    const members = data.members.filter((name) => (data.memberGroups?.[name] || data.groups[0]) === group);
    return `
      <details class="overview-group" open>
        <summary>
          <input value="${escapeAttr(group)}" data-group-name="${escapeAttr(group)}" aria-label="分组名称">
          <button class="icon" data-remove-group="${escapeAttr(group)}" title="删除分组">×</button>
        </summary>
        ${members.map((name) => {
          const index = data.members.indexOf(name);
          const groupValue = data.memberGroups?.[name] || data.groups[0] || "";
          return `
            <div class="member-group-row">
              <input value="${escapeAttr(name)}" data-member-name="${escapeAttr(name)}" aria-label="成员">
              <select data-member-group="${escapeAttr(name)}">
                ${data.groups.map((item) => `<option value="${escapeAttr(item)}" ${item === groupValue ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
              </select>
              <button class="icon" data-move-up="${escapeAttr(name)}" ${index === 0 ? "disabled" : ""} title="上移">↑</button>
              <button class="icon" data-move-down="${escapeAttr(name)}" ${index === data.members.length - 1 ? "disabled" : ""} title="下移">↓</button>
              <button class="icon" data-remove-member="${escapeAttr(name)}" title="删除成员">×</button>
            </div>
          `;
        }).join("") || `<div class="hint">这个分组还没有成员。</div>`}
      </details>
    `;
  }).join("");
  $("memberGroupBox").querySelectorAll("input[data-group-name]").forEach((input) => {
    input.onchange = () => renameGroup(input.dataset.groupName, input.value.trim());
  });
  $("memberGroupBox").querySelectorAll("button[data-remove-group]").forEach((button) => {
    button.onclick = () => removeGroup(button.dataset.removeGroup);
  });
  $("memberGroupBox").querySelectorAll("input[data-member-name]").forEach((input) => {
    input.onchange = () => renameMember(input.dataset.memberName, input.value.trim());
  });
  $("memberGroupBox").querySelectorAll("select[data-member-group]").forEach((select) => {
    select.onchange = () => {
      data.memberGroups[select.dataset.memberGroup] = select.value;
      renderMembers();
      if (select.dataset.memberGroup === currentMember && !showAllEntryItems) renderEntryInputs(filterItemsByRules(readEntryInputs()));
      renderOverview();
      scheduleSave("admin");
    };
  });
  $("memberGroupBox").querySelectorAll("button[data-move-up]").forEach((button) => {
    button.onclick = () => moveMember(button.dataset.moveUp, -1);
  });
  $("memberGroupBox").querySelectorAll("button[data-move-down]").forEach((button) => {
    button.onclick = () => moveMember(button.dataset.moveDown, 1);
  });
  $("memberGroupBox").querySelectorAll("button[data-remove-member]").forEach((button) => {
    button.onclick = () => removeMember(button.dataset.removeMember);
  });
}
function renderMemberItemConfig() {
  const select = $("itemConfigGroup");
  const current = select.value || data.groups[0];
  select.innerHTML = data.groups.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = data.groups.includes(current) ? current : data.groups[0];
  const group = select.value;
  const selected = Array.isArray(data.groupItems?.[group]) ? data.groupItems[group] : configuredItems();
  $("groupItemConfigBox").dataset.currentGroup = group;
  $("groupItemConfigBox").innerHTML = configuredItems().map((name) => `
    <label class="item-check">
      <input type="checkbox" data-member-item="${escapeAttr(name)}" ${selected.includes(name) ? "checked" : ""}>
      <span>${escapeHtml(name)}</span>
    </label>
  `).join("") || `<div class="hint">还没有项目。</div>`;
  $("groupItemConfigBox").querySelectorAll("input[data-member-item]").forEach((input) => {
    input.onchange = () => {
      const checked = Array.from($("groupItemConfigBox").querySelectorAll("input[data-member-item]:checked")).map((item) => item.dataset.memberItem);
      data.groupItems[group] = checked;
      if ((data.memberGroups[currentMember] || data.groups[0]) === group && !showAllEntryItems) renderEntryInputs(filterItemsByRules(readEntryInputs()));
      scheduleSave("admin");
    };
  });
}
function addGroup(name) {
  if (!name || data.groups.includes(name)) return;
  data.groups.push(name);
  data.groupItems[name] = configuredItems();
  $("groupNameInput").value = "";
  render();
  scheduleSave("admin");
}
function renameGroup(oldName, newName) {
  if (!newName || oldName === newName || data.groups.includes(newName)) return renderMemberGroups();
  data.groups = data.groups.map((group) => group === oldName ? newName : group);
  data.members.forEach((member) => {
    if ((data.memberGroups[member] || oldName) === oldName) data.memberGroups[member] = newName;
  });
  if (data.groupItems?.[oldName]) {
    data.groupItems[newName] = data.groupItems[oldName];
    delete data.groupItems[oldName];
  }
  render();
  scheduleSave("admin");
}
function removeGroup(name) {
  if (data.groups.length <= 1) return alert("至少保留一个分组。");
  const fallback = data.groups.find((group) => group !== name) || data.groups[0];
  if (!confirm(`确定删除分组“${name}”？成员会移动到“${fallback}”。`)) return;
  data.groups = data.groups.filter((group) => group !== name);
  data.members.forEach((member) => {
    if (data.memberGroups[member] === name) data.memberGroups[member] = fallback;
  });
  delete data.groupItems[name];
  render();
  scheduleSave("admin");
}
function moveMember(name, direction) {
  const index = data.members.indexOf(name);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= data.members.length) return;
  const members = [...data.members];
  [members[index], members[next]] = [members[next], members[index]];
  data.members = members;
  render();
  scheduleSave("admin");
}
function renameRule(oldName, newName, weight) {
  if (!newName) return renderRules();
  delete data.rules[oldName];
  data.rules[newName] = Number.isFinite(weight) ? weight : 1;
  Object.keys(data.memberItems || {}).forEach((member) => {
    data.memberItems[member] = (data.memberItems[member] || []).map((item) => item === oldName ? newName : item);
  });
  Object.keys(data.groupItems || {}).forEach((group) => {
    data.groupItems[group] = (data.groupItems[group] || []).map((item) => item === oldName ? newName : item);
  });
  renderRules();
  renderEntryInputs(filterItemsByRules(readEntryInputs()));
  preview();
  scheduleSave("admin");
}
function renameMember(oldName, newName) {
  if (!newName || data.members.includes(newName)) return renderMemberQuotas();
  delete data.deletedMembers?.[oldName];
  delete data.deletedMembers?.[newName];
  data.members = data.members.map((name) => name === oldName ? newName : name);
  if (data.memberQuotas[oldName] !== undefined) {
    data.memberQuotas[newName] = data.memberQuotas[oldName];
    delete data.memberQuotas[oldName];
  }
  if (data.memberGroups[oldName] !== undefined) {
    data.memberGroups[newName] = data.memberGroups[oldName];
    delete data.memberGroups[oldName];
  }
  if (data.memberItems[oldName] !== undefined) {
    data.memberItems[newName] = data.memberItems[oldName];
    delete data.memberItems[oldName];
  }
  Object.values(data.dailyQuotas || {}).forEach((entry) => {
    if (entry.members && entry.members[oldName] !== undefined) {
      entry.members[newName] = entry.members[oldName];
      delete entry.members[oldName];
    }
  });
  Object.entries(data.records).forEach(([key, record]) => {
    if (record.member !== oldName) return;
    const nextKey = `${record.date}|${newName}`;
    record.member = newName;
    data.records[nextKey] = record;
    delete data.records[key];
  });
  if (currentMember === oldName) currentMember = newName;
  loadForm();
  render();
  scheduleSave("admin");
}
function addMember(name, groupName = data.groups[0] || "1组") {
  if (!name || data.members.includes(name)) return;
  saveFormSilently();
  delete data.deletedMembers?.[name];
  data.members.push(name);
  data.memberGroups[name] = groupName;
  data.memberItems[name] = configuredItems();
  currentMember = name;
  $("memberName").value = "";
  $("adminMemberName").value = "";
  loadForm();
  render();
  scheduleSave("admin");
}
function removeMember(name) {
  if (data.members.length <= 1) return alert("至少保留一个成员。");
  if (!confirm(`确定隐藏成员“${name}”？会移出成员列表并保留历史记录，之后重新添加同名成员可恢复显示。`)) return;
  data.members = data.members.filter((item) => item !== name);
  data.deletedMembers = data.deletedMembers || {};
  data.deletedMembers[name] = new Date().toISOString();
  delete data.memberQuotas[name];
  delete data.memberGroups[name];
  delete data.memberItems[name];
  Object.values(data.dailyQuotas || {}).forEach((entry) => {
    if (entry.members) delete entry.members[name];
  });
  if (currentMember === name) currentMember = data.members[0];
  loadForm();
  render();
  scheduleSave("admin");
}
function latestRecordText(records, fields = ["reason", "harvest", "diary"]) {
  return records
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .map((record) => fields.map((field) => record?.[field] || "").find(Boolean))
    .find(Boolean) || "";
}
function aggregateMemberRange(member, days, report, itemNames) {
  const records = days.map((day) => recordForReport(report, day, member)).filter(Boolean);
  const items = Object.fromEntries(itemNames.map((name) => [name, 0]));
  let raw = 0;
  let weighted = 0;
  let quota = 0;
  let checkinCount = 0;
  days.forEach((day) => {
    const rec = recordForReport(report, day, member);
    raw += Number(rec?.raw_total || 0);
    weighted += Number(rec?.weighted_total || 0);
    quota += memberQuota(member, day);
    itemNames.forEach((name) => {
      items[name] += Number(rec?.items?.[name] || 0);
    });
    checkinCount += checkinPeriods().filter((period) => checkinStatus(rec?.checkins?.[period.key])).length;
  });
  const checkinSlots = days.length * checkinPeriods().length;
  const rate = quota > 0 ? Math.min(100, Math.round((weighted / quota) * 100)) : 100;
  return {
    member,
    records,
    items,
    raw,
    weighted,
    quota,
    diff: weighted - quota,
    passed: weighted >= quota,
    rate,
    checkinCount,
    checkinSlots,
    note: latestRecordText(records)
  };
}
function renderDetailSummaryGrid(containerId, itemTotals, stats) {
  const box = $(containerId);
  if (!box) return;
  const itemEntries = Object.entries(itemTotals || {});
  const maxItem = Math.max(...itemEntries.map(([, amount]) => Math.abs(Number(amount || 0))), 1);
  const statCards = [
    { label: "原始合计", value: fmt(stats.raw || 0) },
    { label: "换算合计", value: fmt(stats.weighted || 0), strong: true },
    { label: stats.quotaLabel || "周期定额", value: fmt(stats.quota || 0) },
    { label: "总差额", value: `${(stats.diff || 0) >= 0 ? "+" : ""}${fmt(stats.diff || 0)}`, tone: (stats.diff || 0) >= 0 ? "good" : "bad" }
  ].map((item) => `
    <div class="item-total-card stat ${item.strong ? "featured" : ""} ${item.tone || ""}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join("");
  const itemCards = itemEntries.map(([name, amount]) => {
    const width = Math.min(100, Math.round(Math.abs(Number(amount || 0)) / maxItem * 100));
    return `
      <div class="item-total-card">
        <span>${escapeHtml(name)}</span>
        <strong>${fmt(amount)}</strong>
        <div class="item-total-bar"><i style="--w:${width}%"></i></div>
      </div>
    `;
  }).join("");
  box.innerHTML = statCards + (itemCards || `<div class="hint">这个范围还没有项目数据。</div>`);
}
function selectOverviewMember(member, report = reportData()) {
  const group = report.memberGroups?.[member] || report.groups?.[0] || "__all__";
  overviewDetailGroup = group;
  overviewDetailMember = member;
  checkinViewGroup = group;
  checkinViewMember = member;
  checkinViewRangeMode = "default";
  if (data.members.includes(member)) {
    currentMember = member;
    loadForm();
  }
  if ($("analysisScope")) $("analysisScope").value = "member";
  if ($("analysisGroup") && [...$("analysisGroup").options].some((option) => option.value === group)) $("analysisGroup").value = group;
  if ($("analysisMember")) $("analysisMember").value = member;
  renderOverview();
}
function renderOverview() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderOverview);
  const report = reportData();
  renderReportSourceTabs();
  renderOverviewGroupPicker(report);
  const range = overviewRangeInfo();
  const days = buildDateRange(range.start, range.end);
  const quotaLabel = days.length === 1 ? "定额" : "周期定额";
  if ($("overviewRangeSelect")) $("overviewRangeSelect").value = overviewRangeMode;
  if ($("overviewRangeHint")) $("overviewRangeHint").textContent = `${range.label}：${rangeText(range)} · ${days.length} 天`;
  if ($("overviewScopeHint")) $("overviewScopeHint").textContent = `当前查看：${selectedReportLabel()} · ${overviewGroupLabel(report)} · ${range.label}`;
  $("overviewDateInput").value = currentDate;
  const itemNames = configuredItems();
  const selectedGroups = selectedOverviewGroups(report);
  const selectedGroupSet = new Set(selectedGroups);
  const visibleGroups = report.groups.filter((group) => selectedGroupSet.has(group));
  const allRows = reportMembers(report).map((member) => aggregateMemberRange(member, days, report, itemNames));
  const rows = allRows.filter((row) => selectedGroupSet.has(report.memberGroups?.[row.member] || report.groups[0]));
  const pass = rows.filter((row) => row.passed).length;
  const fail = rows.length - pass;
  const totalWeighted = rows.reduce((sum, row) => sum + row.weighted, 0);
  const totalQuota = rows.reduce((sum, row) => sum + row.quota, 0);
  const teamPassed = totalWeighted >= totalQuota;
  const itemTotals = itemNames.reduce((totals, name) => {
    totals[name] = rows.reduce((sum, row) => sum + Number(row.items[name] || 0), 0);
    return totals;
  }, {});
  $("overviewTitle").textContent = `${range.label} ${overviewGroupLabel(report)}达标情况`;
  $("passCount").textContent = String(pass);
  $("failCount").textContent = String(fail);
  $("passRate").textContent = rows.length ? `${Math.round(pass / rows.length * 100)}%` : "0%";
  if ($("passRateDetail")) $("passRateDetail").textContent = `${pass} / ${rows.length} 位成员达标`;
  $("teamTotal").textContent = fmt(totalWeighted);
  $("teamQuota").textContent = `${fmt(totalQuota)} ${teamPassed ? "✓" : ""}`;
  $("teamDiff").textContent = `${totalWeighted - totalQuota >= 0 ? "+" : ""}${fmt(totalWeighted - totalQuota)}`;
  $("overviewHint").textContent = `${rangeText(range)} · ${rows.length} 位成员 · ${teamPassed ? "已完成" : "未完成"}总定额`;
  const rowCard = (row) => `
    <article class="person-card ${row.passed ? "pass" : "fail"}" data-overview-member="${escapeAttr(row.member)}" title="点击切换这个成员的明细和打卡">
      <div class="person-top">
        <span>${escapeHtml(row.member)}</span>
        <span class="status ${row.passed ? "pass" : "fail"}">${row.passed ? "达标" : "未达"}</span>
      </div>
      <div class="progress" title="${row.rate}%"><span style="--w:${row.rate}%"></span></div>
      <div class="hint">换算 ${fmt(row.weighted)} / ${quotaLabel} ${fmt(row.quota)}</div>
      <div class="hint">差额 ${row.diff >= 0 ? "+" : ""}${fmt(row.diff)}</div>
      <div class="hint">打卡 ${row.checkinCount}/${row.checkinSlots}</div>
      <div class="hint">${escapeHtml(row.note || "暂无备注")}</div>
    </article>
  `;
  $("overviewGrid").innerHTML = visibleGroups.map((group) => {
    const groupRows = rows.filter((row) => (report.memberGroups?.[row.member] || report.groups[0]) === group);
    const groupWeighted = groupRows.reduce((sum, row) => sum + row.weighted, 0);
    const groupQuota = groupRows.reduce((sum, row) => sum + row.quota, 0);
    return `
      <details class="overview-group" open>
        <summary>
          <span>${escapeHtml(group)} · ${groupRows.length} 人</span>
          <strong>${fmt(groupWeighted)} / ${fmt(groupQuota)}</strong>
        </summary>
        <div class="member-grid">${groupRows.map(rowCard).join("") || `<div class="hint">这个分组还没有成员。</div>`}</div>
      </details>
    `;
  }).join("");
  $("overviewGrid").querySelectorAll("[data-overview-member]").forEach((card) => {
    card.onclick = () => {
      selectOverviewMember(card.dataset.overviewMember, report);
    };
  });
  const detailPick = renderGroupMemberSelectors("overviewDetailGroup", "overviewDetailMember", overviewDetailGroup, overviewDetailMember);
  overviewDetailGroup = detailPick.group;
  overviewDetailMember = detailPick.member;
  const detailMembers = overviewDetailMember ? [overviewDetailMember] : membersForGroupValue(overviewDetailGroup, report);
  const detailSourceRows = allRows.filter((row) => detailMembers.includes(row.member));
  const detailTotals = itemNames.reduce((totals, name) => {
    totals[name] = detailSourceRows.reduce((sum, row) => sum + Number(row.items[name] || 0), 0);
    return totals;
  }, {});
  const detailRaw = detailSourceRows.reduce((sum, row) => sum + row.raw, 0);
  const detailWeighted = detailSourceRows.reduce((sum, row) => sum + row.weighted, 0);
  const detailQuota = detailSourceRows.reduce((sum, row) => sum + row.quota, 0);
  const detailLabel = overviewDetailMember || (overviewDetailGroup === "__all__" ? "全部成员合计" : `${overviewDetailGroup}全部成员`);
  $("detailHint").textContent = `${detailLabel} · ${rangeText(range)} · 只显示合计`;
  renderDetailSummaryGrid("detailSummaryGrid", detailTotals, {
    raw: detailRaw,
    weighted: detailWeighted,
    quota: detailQuota,
    diff: detailWeighted - detailQuota,
    quotaLabel
  });
  renderMixedOverviewTable();
  renderCheckinOverview();
  renderAnalytics();
}
function renderHistory() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderHistory);
  const report = reportData();
  const rows = Object.values(report.records).sort((a, b) => `${b.date}|${b.member}`.localeCompare(`${a.date}|${a.member}`));
  $("historyCount").textContent = `${selectedReportLabel()} · ${rows.length} 条记录`;
  $("historyBody").innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.date || "")}</td>
      <td>${escapeHtml(r.member || "")}</td>
      <td>${fmt(r.raw_total)}</td>
      <td>${fmt(r.weighted_total)}</td>
      <td>${escapeHtml(r.status || "")}</td>
      <td>${escapeHtml(r.reason || r.harvest || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="hint">还没有历史记录。</td></tr>`;
}
function renderGroupOnlySelect(selectId, selectedGroup, report = reportData()) {
  const select = $(selectId);
  const groups = report.groups || [];
  const group = groups.includes(selectedGroup) ? selectedGroup : groups[0] || "";
  if (select) {
    select.innerHTML = groups.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
    select.value = group;
  }
  return group;
}
function renderValueTabs(containerId, tabs, selectedValue, dataAttr) {
  const box = $(containerId);
  if (!box) return;
  box.innerHTML = tabs.length
    ? tabs.map(({ value, label }) => `<button class="tab mini ${value === selectedValue ? "active" : ""}" type="button" ${dataAttr}="${escapeAttr(value)}">${escapeHtml(label)}</button>`).join("")
    : `<span class="hint">暂无成员</span>`;
}
function renderMixedOverviewTable() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderMixedOverviewTable);
  const report = reportData();
  if (!$("mixedTableHead")) return;
  mixedTableGroup = renderGroupOnlySelect("mixedTableGroup", mixedTableGroup, report);
  applyMixedTableDefaultRange();
  let start = $("mixedTableStart").value || currentDate;
  let end = $("mixedTableEnd").value || currentDate;
  if (start > end) {
    [start, end] = [end, start];
    $("mixedTableStart").value = start;
    $("mixedTableEnd").value = end;
  }
  const members = membersForGroupValue(mixedTableGroup, report);
  const member = members.includes(mixedTableMember) ? mixedTableMember : members[0] || "";
  mixedTableMember = member;
  if ($("mixedTableMember")) {
    $("mixedTableMember").innerHTML = members.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
    if (member) $("mixedTableMember").value = member;
  }
  renderValueTabs("mixedMemberTabs", members.map((name) => ({ value: name, label: name })), member, "data-mixed-member-tab");
  $("mixedMemberTabs")?.querySelectorAll("[data-mixed-member-tab]").forEach((button) => {
    button.onclick = () => {
      mixedTableMember = button.dataset.mixedMemberTab || "";
      renderMixedOverviewTable();
    };
  });
  const days = buildDateRange(start, end);
  const itemNames = groupVisibleItems(mixedTableGroup, report);
  const editable = report === data && data.members.includes(member);
  const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
  let totalWeighted = 0;
  let totalQuota = 0;
  $("mixedTableHint").textContent = member
    ? `${mixedTableGroup} · ${member} · ${start} 至 ${end} · ${itemNames.length} 个组项目 · ${editable ? "可直接编辑" : "当前范围只读"}`
    : "请选择成员";
  $("mixedTableHead").innerHTML = `
    <tr>
      <th>日期</th>
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
      <th>完成</th>
      <th>定额</th>
      <th>差额</th>
      <th>备注</th>
    </tr>
  `;
  if (!member) {
    $("mixedTableBody").innerHTML = `<tr><td colspan="${5 + itemNames.length}" class="hint">暂无可查看成员。</td></tr>`;
    renderMixedCheckinTable();
    return;
  }
  const rows = days.map((day) => {
    const rec = recordForReport(report, day, member);
    const items = rec?.items || {};
    const totals = totalsForItems(items, itemNames, report);
    const weighted = totals.weighted;
    const quota = memberQuota(member, day);
    totalWeighted += weighted;
    totalQuota += quota;
    itemNames.forEach((name) => {
      itemTotals[name] += Number(items[name] || 0);
    });
    const diff = weighted - quota;
    return `
      <tr>
        <td class="mixed-date">${escapeHtml(day.slice(5))}</td>
        ${itemNames.map((name) => {
          const amount = Number(items[name] || 0);
          return `<td class="${amount ? "mixed-number" : ""}">
            <input data-mixed-item data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" data-item="${escapeAttr(name)}" type="number" step="0.01" inputmode="decimal" value="${amount || ""}" placeholder="0" ${editable ? "" : "disabled"}>
          </td>`;
        }).join("")}
        <td class="mixed-total">${weighted ? fmt(weighted) : ""}</td>
        <td>${fmt(quota)}</td>
        <td class="${diff >= 0 ? "mixed-good" : "mixed-bad"}">${diff >= 0 ? "+" : ""}${fmt(diff)}</td>
        <td class="mixed-note">
          <textarea data-mixed-note data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" rows="2" ${editable ? "" : "disabled"}>${escapeHtml(rec?.reason || rec?.harvest || rec?.diary || "")}</textarea>
        </td>
      </tr>
    `;
  });
  const totalDiff = totalWeighted - totalQuota;
  rows.unshift(`
    <tr class="mixed-summary-row">
      <th>合计</th>
      ${itemNames.map((name) => `<th>${fmt(itemTotals[name])}</th>`).join("")}
      <th>${fmt(totalWeighted)}</th>
      <th>${fmt(totalQuota)}</th>
      <th class="${totalDiff >= 0 ? "mixed-good" : "mixed-bad"}">${totalDiff >= 0 ? "+" : ""}${fmt(totalDiff)}</th>
      <th></th>
    </tr>
  `);
  $("mixedTableBody").innerHTML = rows.join("");
  bindMixedTableEdits();
  renderMixedCheckinTable();
}
function bindMixedTableEdits() {
  $("mixedTableBody").querySelectorAll("[data-mixed-checkin]").forEach((select) => {
    select.onchange = () => updateMixedCheckin(select);
  });
  $("mixedTableBody").querySelectorAll("[data-mixed-item]").forEach((input) => {
    input.onchange = () => updateMixedItem(input);
    input.onkeydown = (event) => {
      if (event.key === "Enter") input.blur();
    };
  });
  $("mixedTableBody").querySelectorAll("[data-mixed-note]").forEach((textarea) => {
    textarea.onchange = () => updateMixedNote(textarea);
    textarea.onkeydown = (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) textarea.blur();
    };
  });
}
function updateMixedCheckin(select) {
  const day = select.dataset.day || currentDate;
  const member = select.dataset.member || "";
  const period = select.dataset.period || "";
  if (!member || !period || !data.members.includes(member)) return;
  const rec = ensureRecordFor(day, member);
  rec.checkins = sanitizeCheckins(rec.checkins || {});
  const status = normalizeCheckinStatus(select.value || "");
  if (!status) delete rec.checkins[period];
  else {
    const now = new Date();
    rec.checkins[period] = {
      status,
      time: now.toLocaleTimeString("zh-CN", { hour12: false }),
      iso: now.toISOString()
    };
  }
  rec.updated_at = new Date().toISOString();
  persistMixedEdit(day, member);
}
function updateMixedItem(input) {
  const day = input.dataset.day || currentDate;
  const member = input.dataset.member || "";
  const item = input.dataset.item || "";
  if (!member || !item || !data.members.includes(member)) return;
  const rec = ensureRecordFor(day, member);
  rec.items = { ...(rec.items || {}) };
  const value = Number(input.value || 0);
  if (!value) delete rec.items[item];
  else rec.items[item] = value;
  updateRecordTotals(rec);
  persistMixedEdit(day, member);
}
function updateMixedNote(textarea) {
  const day = textarea.dataset.day || currentDate;
  const member = textarea.dataset.member || "";
  if (!member || !data.members.includes(member)) return;
  const rec = ensureRecordFor(day, member);
  rec.reason = textarea.value.trim();
  rec.updated_at = new Date().toISOString();
  persistMixedEdit(day, member);
}
function renderMixedCheckinTable() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderMixedCheckinTable);
  const report = reportData();
  if (!$("mixedCheckinHead")) return;
  applyMixedTableDefaultRange();
  let start = $("mixedTableStart")?.value || currentDate;
  let end = $("mixedTableEnd")?.value || currentDate;
  if (start > end) [start, end] = [end, start];
  const groups = report.groups || [];
  const fallbackGroup = (mixedTableGroup && mixedTableGroup !== "__all__" && groups.includes(mixedTableGroup)) ? mixedTableGroup : groups[0] || "";
  const group = renderGroupOnlySelect("mixedCheckinGroup", groups.includes(mixedCheckinGroup) ? mixedCheckinGroup : fallbackGroup, report);
  mixedCheckinGroup = group;
  const days = buildDateRange(start, end);
  const groupMembers = membersForGroupValue(group, report);
  if (mixedCheckinMember && !groupMembers.includes(mixedCheckinMember)) mixedCheckinMember = "";
  renderValueTabs(
    "mixedCheckinTabs",
    [{ value: "", label: "全组" }, ...groupMembers.map((name) => ({ value: name, label: name }))],
    mixedCheckinMember,
    "data-mixed-checkin-member-tab"
  );
  $("mixedCheckinTabs")?.querySelectorAll("[data-mixed-checkin-member-tab]").forEach((button) => {
    button.onclick = () => {
      mixedCheckinMember = button.dataset.mixedCheckinMemberTab || "";
      renderMixedCheckinTable();
    };
  });
  const members = mixedCheckinMember ? [mixedCheckinMember] : groupMembers;
  const checkinOptions = normalizeCheckinOptions(data.checkinOptions || defaultData.checkinOptions);
  const editable = report === data;
  $("mixedCheckinHint").textContent = group
    ? `${group} · ${mixedCheckinMember || "全组"} · ${start} 至 ${end} · ${members.length} 人`
    : "暂无小组";
  $("mixedCheckinHead").innerHTML = `<tr><th>日期</th><th>成员</th>${checkinPeriods().map((period) => `<th>${period.label}打卡</th>`).join("")}</tr>`;
  const rows = [];
  days.forEach((day) => {
    members.forEach((member) => {
      const rec = recordForReport(report, day, member);
      const canEditMember = editable && data.members.includes(member);
      rows.push(`
        <tr>
          <td class="mixed-date">${escapeHtml(day.slice(5))}</td>
          <td class="mixed-member">${escapeHtml(member)}</td>
          ${checkinPeriods().map((period) => {
            const value = rec?.checkins?.[period.key];
            const status = checkinStatus(value);
            const time = checkinTimeText(value).replace("记录时间 ", "");
            const options = normalizeCheckinOptions([...checkinOptions, status].filter(Boolean));
            return `<td class="mixed-checkin ${status ? "filled" : ""}" title="${escapeAttr(checkinDisplay(value))}">
              <select data-mixed-checkin data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" data-period="${escapeAttr(period.key)}" ${canEditMember ? "" : "disabled"}>
                <option value=""></option>
                ${options.map((option) => `<option value="${escapeAttr(option)}" ${status === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
              </select>
              ${time ? `<small>${escapeHtml(time)}</small>` : ""}
            </td>`;
          }).join("")}
        </tr>
      `);
    });
  });
  $("mixedCheckinBody").innerHTML = rows.join("") || `<tr><td colspan="${2 + checkinPeriods().length}" class="hint">暂无可查看成员。</td></tr>`;
  bindMixedCheckinTableEdits();
}
function bindMixedCheckinTableEdits() {
  $("mixedCheckinBody").querySelectorAll("[data-mixed-checkin]").forEach((select) => {
    select.onchange = () => updateMixedCheckin(select);
  });
}
function persistMixedEdit(day, member) {
  persistLocal();
  scheduleRecordCloudSave();
  if (day === currentDate && member === currentMember) loadForm();
  renderOverview();
}
function renderCheckinOverview() {
  const report = reportData();
  if (!$("checkinHead")) return;
  const pick = renderGroupMemberSelectors("checkinViewGroup", "checkinViewMember", checkinViewGroup, checkinViewMember);
  checkinViewGroup = pick.group;
  checkinViewMember = pick.member;
  applyCheckinDefaultRange();
  let start = $("checkinViewStart").value || currentDate;
  let end = $("checkinViewEnd").value || currentDate;
  if (start > end) {
    [start, end] = [end, start];
    $("checkinViewStart").value = start;
    $("checkinViewEnd").value = end;
  }
  const days = buildDateRange(start, end);
  const members = checkinViewMember ? [checkinViewMember] : membersForGroupValue(checkinViewGroup, report);
  $("checkinOverviewHint").textContent = `${start} 至 ${end} · ${members.length || 0} 人 · ${days.length} 天`;
  $("checkinHead").innerHTML = `<tr><th>日期</th><th>分组</th><th>成员</th>${checkinPeriods().map((period) => `<th>${period.label}</th>`).join("")}</tr>`;
  const rows = [];
  days.forEach((day) => {
    members.forEach((member) => {
      const rec = recordForReport(report, day, member);
      const group = report.memberGroups?.[member] || report.groups?.[0] || "";
      rows.push(`
        <tr>
          <td>${escapeHtml(day)}</td>
          <td>${escapeHtml(group)}</td>
          <td><button class="table-link" data-checkin-member="${escapeAttr(member)}" data-checkin-group="${escapeAttr(group)}">${escapeHtml(member)}</button></td>
          ${checkinPeriods().map((period) => `<td>${escapeHtml(checkinDisplay(rec?.checkins?.[period.key]))}</td>`).join("")}
        </tr>
      `);
    });
  });
  $("checkinBody").innerHTML = rows.join("") || `<tr><td colspan="6" class="hint">暂无打卡记录。</td></tr>`;
  $("checkinBody").querySelectorAll("[data-checkin-member]").forEach((button) => {
    button.onclick = () => selectOverviewMember(button.dataset.checkinMember || "", report);
  });
}
function renderAnalysisMemberOptions() {
  const report = reportData();
  const select = $("analysisMember");
  const scope = $("analysisScope")?.value || "team";
  const groupSelect = $("analysisGroup");
  const currentGroup = groupSelect.value || report.groups[0] || "";
  groupSelect.innerHTML = report.groups.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
  groupSelect.value = report.groups.includes(currentGroup) ? currentGroup : report.groups[0] || "";
  const members = scope === "member" ? membersForGroupValue(groupSelect.value, report) : reportMembers(report);
  const current = select.value;
  const allLabel = groupSelect.value ? `${groupSelect.value} 全部成员` : "全部成员";
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${members.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("")}`;
  select.value = current === "" || members.includes(current) ? current : "";
}
function renderAnalytics() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderAnalytics);
  renderAnalysisMemberOptions();
  const report = reportData();
  const scope = $("analysisScope").value || "team";
  const member = $("analysisMember").value || "";
  const range = Math.max(1, Math.min(62, Number($("analysisCustomDays").value || $("analysisRange").value || 7)));
  const compareMode = $("analysisCompare").value || "previous";
  $("analysisMember").disabled = false;
  $("analysisGroup").disabled = false;
  const days = periodKeys(currentDate, range);
  const startInput = $("rangeStart");
  const endInput = $("rangeEnd");
  if (!startInput.value) startInput.value = days[0];
  if (!endInput.value) endInput.value = days[days.length - 1];
  const customDays = buildDateRange(startInput.value, endInput.value);
  const current = aggregatePeriod(days, scope, member);
  const custom = aggregatePeriod(customDays, scope, member);
  const compareDays = compareMode === "lastMonth"
    ? periodKeys(addDays(currentDate, -30), range)
    : periodKeys(addDays(days[0], -1), range);
  const displayDays = compareMode === "thisWeek" ? periodKeys(currentDate, Math.min(7, dateFromKey(currentDate).getDay() || 7)) : days;
  const currentDisplay = aggregatePeriod(displayDays, scope, member);
  const previous = aggregatePeriod(compareDays, scope, member);
  const weightedDelta = current.weighted - previous.weighted;
  const diffDelta = current.diff - previous.diff;
  const rate = current.quota > 0 ? Math.round(current.weighted / current.quota * 100) : 100;
  const group = analysisGroupValue(report);
  const label = scope === "member" ? (member || `${group}全部成员`) : scope === "group" ? group : "团队";
  const yesterday = aggregatePeriod([addDays(currentDate, -1)], scope, member);
  const today = aggregatePeriod([currentDate], scope, member);
  const todayDelta = today.weighted - yesterday.weighted;
  const compareLabel = { previous: `当前 ${range} 天 vs 前 ${range} 天`, thisWeek: "本周累计", lastMonth: "对比上月同期" }[compareMode] || `当前 ${range} 天 vs 前 ${range} 天`;
  $("analysisHint").textContent = `${label} · ${compareMode === "thisWeek" ? "本周" : `${range} 天`} · ${compareLabel}`;
  $("analysisSummary").innerHTML = `
    <div class="analysis-card"><span>完成量</span><strong>${fmt(current.weighted)}</strong></div>
    <div class="analysis-card"><span>周期定额</span><strong>${fmt(current.quota)}</strong></div>
    <div class="analysis-card ${current.diff >= 0 ? "good" : "bad"}"><span>周期差额</span><strong>${current.diff >= 0 ? "+" : ""}${fmt(current.diff)}</strong></div>
    <div class="analysis-card ${todayDelta >= 0 ? "good" : "bad"}"><span>今日较昨日</span><strong>${todayDelta >= 0 ? `增长 ${fmt(todayDelta)}` : `下滑 ${fmt(Math.abs(todayDelta))}`}</strong></div>
  `;
  const itemDeltaRows = Object.entries(today.itemTotals).map(([name, value]) => {
    const previousValue = Number(yesterday.itemTotals[name] || 0);
    const delta = Number(value || 0) - previousValue;
    return { label: `${name}：${delta >= 0 ? "增加" : "减少"} ${fmt(Math.abs(delta))}`, weighted: delta };
  });
  $("compareSummary").innerHTML = `
    <div class="analysis-card"><span>当前段</span><strong>${fmt(current.weighted)}</strong></div>
    <div class="analysis-card"><span>对比段</span><strong>${fmt(previous.weighted)}</strong></div>
    <div class="analysis-card ${weightedDelta >= 0 ? "good" : "bad"}"><span>完成量差</span><strong>${weightedDelta >= 0 ? "+" : ""}${fmt(weightedDelta)}</strong></div>
    <div class="analysis-card ${diffDelta >= 0 ? "good" : "bad"}"><span>差额变化</span><strong>${diffDelta >= 0 ? "增长" : "下滑"} ${fmt(Math.abs(diffDelta))}</strong></div>
  `;
  renderMiniBars("compareChart", [
    { label: `${days[0].slice(5)}-${days[days.length - 1].slice(5)}`, weighted: current.weighted },
    { label: `${compareDays[0].slice(5)}-${compareDays[compareDays.length - 1].slice(5)}`, weighted: previous.weighted },
    ...itemDeltaRows
  ], "weighted");
  renderMiniBars("analysisChart", currentDisplay.daily.map((row) => ({
    label: row.day.slice(5),
    weighted: row.weighted,
    diff: row.diff
  })), "weighted");
  const itemRows = Object.entries(current.itemTotals).map(([name, value]) => ({ label: name, weighted: value }));
  renderMiniBars("analysisItemChart", itemRows, "weighted");
  renderLineChart("analysisLineChart", currentDisplay.daily);
  renderTreemap("analysisTreemap", itemRows);
  renderProgressBlocks("analysisBlocks", currentDisplay.daily);
  renderPersonalTable(customDays, custom, scope, member);
}
function renderLineChart(containerId, rows) {
  const max = Math.max(...rows.map((row) => row.weighted), 1);
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? 0 : index / (rows.length - 1) * 100;
    const y = 100 - (row.weighted / max * 92);
    return `${x},${y}`;
  }).join(" ");
  $(containerId).innerHTML = `
    <div class="line-axis"></div><div class="line-x"></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="#2f6f59" stroke-width="3" vector-effect="non-scaling-stroke"></polyline>
    </svg>
  `;
}
function renderTreemap(containerId, rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.weighted || 0), 0) || 1;
  $(containerId).innerHTML = rows.map((row) => `
    <div class="tree-cell" style="flex:${Math.max(0.2, Number(row.weighted || 0) / total * 6)}">
      <span>${escapeHtml(row.label)}</span>
      <small>${fmt(row.weighted)}</small>
    </div>
  `).join("") || `<div class="hint">暂无项目数据。</div>`;
}
function renderProgressBlocks(containerId, rows) {
  $(containerId).innerHTML = rows.map((row) => `
    <div class="block-card ${row.diff >= 0 ? "good" : "bad"}">
      <div>${row.day.slice(5)}</div>
      <small>${row.diff >= 0 ? "+" : ""}${fmt(row.diff)}</small>
    </div>
  `).join("") || `<div class="hint">暂无进度数据。</div>`;
}
function buildDateRange(start, end) {
  if (!start || !end) return periodKeys(currentDate, 7);
  const days = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 370) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days.length ? days : [currentDate];
}
function renderAnalysisPersonTabs(members, scope, member) {
  const box = $("analysisPersonTabs");
  if (!box) return;
  if (scope === "member" || members.length <= 1) {
    analysisTableMember = member || "";
    box.innerHTML = "";
    return;
  }
  if (!analysisTableMember || !members.includes(analysisTableMember)) analysisTableMember = members[0];
  box.innerHTML = members.map((name) => `
    <button class="tab mini ${analysisTableMember === name ? "active" : ""}" data-analysis-person="${escapeAttr(name)}">${escapeHtml(name)}</button>
  `).join("");
  box.querySelectorAll("[data-analysis-person]").forEach((button) => {
    button.onclick = () => {
      analysisTableMember = button.dataset.analysisPerson || "";
      renderAnalytics();
    };
  });
}
function renderPersonalTable(days, aggregate, scope, member) {
  const itemNames = configuredItems();
  const report = reportData();
  const scopedMembers = analysisMembersForScope(scope, member, report);
  renderAnalysisPersonTabs(scopedMembers, scope, member);
  const members = scope === "member" ? scopedMembers : [analysisTableMember || scopedMembers[0]].filter(Boolean);
  const tableAggregate = scope === "member" ? aggregate : aggregatePeriod(days, "member", members[0]);
  $("personalHead").innerHTML = `
    <tr>
      <th>日期</th>
      <th>成员</th>
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
      <th>换算</th>
      <th>定额</th>
      <th>差额</th>
    </tr>
  `;
  const rows = [];
  days.forEach((day) => {
    members.forEach((name) => {
      const rec = recordFor(day, name);
      const items = rec?.items || {};
      const weighted = Number(rec?.weighted_total || 0);
      const quota = memberQuota(name, day);
      rows.push(`
        <tr>
          <td>${escapeHtml(day)}</td>
          <td>${escapeHtml(name)}</td>
          ${itemNames.map((item) => `<td>${fmt(items[item] || 0)}</td>`).join("")}
          <td>${fmt(weighted)}</td>
          <td>${fmt(quota)}</td>
          <td>${weighted - quota >= 0 ? "+" : ""}${fmt(weighted - quota)}</td>
        </tr>
      `);
    });
  });
  rows.push(`
    <tr>
      <th>合计</th>
      <th>${scope === "member" ? escapeHtml(member || `${analysisGroupValue(report)}全部成员`) : escapeHtml(analysisTableMember || "团队")}</th>
      ${itemNames.map((name) => `<th>${fmt(tableAggregate.itemTotals[name] || 0)}</th>`).join("")}
      <th>${fmt(tableAggregate.weighted)}</th>
      <th>${fmt(tableAggregate.quota)}</th>
      <th>${tableAggregate.diff >= 0 ? "+" : ""}${fmt(tableAggregate.diff)}</th>
    </tr>
  `);
  $("personalBody").innerHTML = rows.join("");
}
function renderBackups() {
  const backups = readBackups();
  $("backupList").innerHTML = backups.map((item) => `
    <div class="backup-item">
      <span>${escapeHtml(item.label)} · ${new Date(item.created_at).toLocaleString("zh-CN")}</span>
      <button data-backup="${escapeAttr(item.id)}">恢复</button>
    </div>
  `).join("") || `<div class="hint">还没有本地备份。保存和导入前会自动生成。</div>`;
  $("backupList").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = readBackups().find((backup) => backup.id === btn.dataset.backup);
      if (!item || !confirm("确定恢复这个备份？当前数据会先再备份一次。")) return;
      createBackup("恢复前备份");
      data = normalize(item.data);
      currentMember = data.members[0];
      loadForm();
      render();
      persistEverywhere();
    });
  });
}
function parseUtcOffset(offset) {
  const match = String(offset || "").trim().match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2] || 0) * 60 + Number(match[3] || 0));
}
function timezoneNow(offset) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + parseUtcOffset(offset) * 60000);
}
function renderTimezones() {
  const box = $("timezoneList");
  if (!box) return;
  box.innerHTML = (data.timezones || defaultData.timezones).map((item, index) => {
    const time = timezoneNow(item.offset).toLocaleString("zh-CN", { hour12: false });
    return `
      <div class="backup-item">
        <span><strong>${escapeHtml(item.name)}</strong> · UTC${escapeHtml(item.offset)} · ${escapeHtml(time)}</span>
        <button data-remove-timezone="${index}">删除</button>
      </div>
    `;
  }).join("") || `<div class="hint">还没有时区。</div>`;
  box.querySelectorAll("[data-remove-timezone]").forEach((button) => {
    button.onclick = () => {
      data.timezones.splice(Number(button.dataset.removeTimezone), 1);
      renderTimezones();
      scheduleSave("admin");
    };
  });
}
function renderAdminSettings() {
  $("autoAuditToggle").checked = false;
  $("sheetBackupToggle").checked = data.sheetBackupEnabled !== false;
  $("backupCleanupToggle").checked = data.backupCleanupEnabled === true;
  $("checkinOptionsInput").value = (data.checkinOptions || defaultData.checkinOptions).join("\n");
  $("passMessagesInput").value = (data.reviewMessages?.pass || defaultData.reviewMessages.pass).join("\n");
  $("failMessagesInput").value = (data.reviewMessages?.fail || defaultData.reviewMessages.fail).join("\n");
}
function collectAdminSettings() {
  data.autoAudit = false;
  data.sheetBackupEnabled = $("sheetBackupToggle").checked;
  data.backupCleanupEnabled = $("backupCleanupToggle").checked;
  data.checkinOptions = normalizeCheckinOptions($("checkinOptionsInput").value.split(/\r?\n/)).slice(0, 20);
  if (!data.checkinOptions.length) data.checkinOptions = clone(defaultData.checkinOptions);
  data.reviewMessages = {
    pass: $("passMessagesInput").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 30),
    fail: $("failMessagesInput").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 30)
  };
  if (!data.reviewMessages.pass.length) data.reviewMessages.pass = clone(defaultData.reviewMessages.pass);
  if (!data.reviewMessages.fail.length) data.reviewMessages.fail = clone(defaultData.reviewMessages.fail);
}
function render() {
  renderDateCalendars();
  renderMembers();
  renderRules();
  renderMemberQuotas();
  renderMemberGroups();
  renderMemberItemConfig();
  renderEntryInputs(readEntryInputs());
  renderOverview();
  renderHistory();
  renderBackups();
  renderAdminSettings();
  renderSyncPanel();
  renderCloudBackupPanel();
  renderCloudHistoryPanel();
  renderTimezones();
  renderSummaryFolders();
  renderAdminCenterPanel();
  renderReportSourceTabs();
  $("quotaInput").value = String(data.quota);
  preview();
}
function setView(view) {
  if (view === "admin" && !adminUnlocked) {
    const password = prompt("请输入管理员密码");
    const ok = (data.adminPassword && password === String(data.adminPassword)) || (appSessionPassword && password === appSessionPassword);
    if (!ok) {
      alert("管理员密码不正确。");
      return;
    }
    adminUnlocked = true;
  }
  activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  renderOverview();
}
function showDialog(title, message, field) {
  pendingDialogField = field;
  $("dialogTitle").textContent = title;
  $("dialogMessage").textContent = message;
  $("dialogText").value = "";
  $("dialogText").classList.toggle("hidden", !field);
  $("dialogSkip").classList.toggle("hidden", !field);
  $("dialogSave").textContent = field ? "写入记录" : "知道了";
  $("dialog").classList.add("show");
}
function closeDialog() {
  $("dialog").classList.remove("show");
}
async function unlockApp() {
  const password = $("appPasswordInput").value.trim();
  saveCloudSyncEndpoint($("cloudSyncEndpointInput")?.value || cloudSyncEndpoint);
  $("lockHint").textContent = "正在验证应用密码...";
  const auth = await verifyAppPassword(password);
  if (!auth.ok) {
    $("lockHint").textContent = auth.error || "密码不正确";
    $("appPasswordInput").select();
    return;
  }
  appSessionPassword = password;
  appUnlocked = true;
  $("lockScreen").classList.add("hidden");
  $("appPasswordInput").value = "";
  await pullCloudDatabaseData({ silent: true });
  await refreshCloudHistory(true).catch(() => {});
  startCloudDbPolling();
  loadForm();
  render();
}
function updateCloudSyncEndpointFromAdmin(clear = false) {
  const next = clear ? "" : ($("cloudSyncEndpointAdminInput")?.value || "");
  saveCloudSyncEndpoint(next);
  if (clear && cloudSyncEndpointFromEnv) setCloudSyncEndpointFromEnv(cloudSyncEndpointFromEnv);
  cloudDbLastSeenSha = "";
  cloudDbQuotaPausedUntil = 0;
  refreshCloudDatabaseStatus(true);
  showDialog(clear ? "备用云地址已清空" : "备用云地址已保存", clear ? (cloudSyncEndpoint ? `已清空本机手动地址，当前使用 Vercel 下发地址：${cloudSyncEndpoint}` : "当前云同步会回到 Vercel 默认接口。") : `当前云同步会优先连接：${cloudSyncEndpoint}`, "");
}
async function chooseSharedFile() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.chooseCloudFolder(data);
    if (!result) return;
    if (result.error) throw new Error(result.error);
    createBackup("切换云端文件夹前备份");
    if (result.text?.trim()) data = normalize(JSON.parse(result.text));
    lastFileModified = result.mtime || 0;
    lastCloudText = result.text || "";
    cloudLocationLabel = result.path || "";
    setSyncStatus(`已挂载，后台刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    persistLocal();
    loadForm();
    render();
    startCloudPolling();
    return;
  }
  if ("showDirectoryPicker" in window) {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    await useCloudDirectory(dir, true);
    return;
  }
  const canOpen = "showOpenFilePicker" in window;
  const canSave = "showSaveFilePicker" in window;
  if (!canOpen && !canSave) {
    alert("当前浏览器不支持直接写入共享文件。请用新版 Chrome/Edge，或使用导入/导出。");
    return;
  }
  const pickerOptions = {
    types: [{ description: "JSON 数据文件", accept: { "application/json": [".json"] } }]
  };
  let handle;
  const createNew = canSave && !confirm("选择已有云端数据文件点“确定”；在 Google Drive 目录中新建文件点“取消”。");
  if (createNew) {
    handle = await window.showSaveFilePicker({ ...pickerOptions, suggestedName: "report_data.json" });
  } else {
    [handle] = await window.showOpenFilePicker({ ...pickerOptions, multiple: false });
  }
  fileHandle = handle;
  const file = await handle.getFile();
  lastFileModified = file.lastModified;
  const text = await file.text();
  lastCloudText = text;
  cloudLocationLabel = file.name;
  createBackup(createNew ? "新建云端文件前备份" : "切换云端文件前备份");
  if (text.trim()) data = normalize(JSON.parse(text));
  persistLocal();
  setSyncStatus(`已挂载文件，后台刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
  if (!data.members.includes(currentMember)) currentMember = data.members[0];
  loadForm();
  render();
  if (!text.trim() || createNew) await persistEverywhere();
  startCloudPolling();
}
async function pollSharedFile(showIdle = true) {
  if (pollInProgress) return;
  pollInProgress = true;
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.pollCloudData().catch((error) => ({ error: error.message }));
    pollInProgress = false;
    if (!result) return;
    if (result.unchanged) {
      if (showIdle) setSyncStatus(`后台已检查 · ${new Date().toLocaleTimeString("zh-CN")}`);
      return;
    }
    if (result.error) {
      setSyncStatus(`同步暂时不可读：${result.error}`);
      return;
    }
    createBackup("云端刷新前备份");
    preserveActiveDraft();
    data = mergeCloudData(JSON.parse(result.text || "{}"), data, "records");
    lastFileModified = result.mtime || lastFileModified;
    lastCloudText = result.text || "";
    setSyncStatus(`发现云端更新，已刷新 · ${new Date().toLocaleTimeString("zh-CN")}`, result.path || cloudLocationLabel);
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    loadForm();
    render();
    return;
  }
  if (!fileHandle) {
    pollInProgress = false;
    return;
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text !== lastCloudText) {
      lastFileModified = file.lastModified;
      lastCloudText = text;
      createBackup("云端刷新前备份");
      preserveActiveDraft();
      data = mergeCloudData(JSON.parse(text || "{}"), data, "records");
      persistLocal();
      if (!data.members.includes(currentMember)) currentMember = data.members[0];
      setSyncStatus(`发现云端更新，已刷新 · ${new Date().toLocaleTimeString("zh-CN")}`);
      loadForm();
      render();
    } else if (showIdle) {
      setSyncStatus(`后台已检查 · ${new Date().toLocaleTimeString("zh-CN")}`);
    }
  } catch (error) {
    setSyncStatus(`共享文件暂时不可读，继续使用本地缓存`);
  } finally {
    pollInProgress = false;
  }
}
async function readDirectoryReport(dir) {
  if (!(await hasCloudPermission(dir))) throw new Error(`${dir.name || "文件夹"} 没有读写权限`);
  const handle = await dir.getFileHandle("report_data.json", { create: false });
  const file = await handle.getFile();
  const text = await file.text();
  return text.trim() ? normalize(JSON.parse(text)) : normalize({});
}
async function writeDirectoryReport(dir, nextData) {
  if (!(await hasCloudPermission(dir))) throw new Error(`${dir.name || "汇总文件夹"} 没有读写权限`);
  const handle = await dir.getFileHandle("report_data.json", { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(normalize(nextData), null, 2));
  await writable.close();
}
async function refreshSourceDatasets() {
  sourceDatasets = [];
  for (let index = 0; index < sourceDirHandles.length; index += 1) {
    const dir = sourceDirHandles[index];
    try {
      const sourceData = await readDirectoryReport(dir);
      sourceDatasets.push({
        label: sourceDirLabels[index] || dir.name || `来源 ${index + 1}`,
        data: sourceData
      });
    } catch (error) {
      sourceDatasets.push({
        label: `${sourceDirLabels[index] || dir.name || `来源 ${index + 1}`}（读取失败）`,
        data: normalize({}),
        error: error.message
      });
    }
  }
  mergedSourceDataset = buildMergedSourceDataset();
  if (activeReportSource.startsWith("source:")) {
    const index = Number(activeReportSource.split(":")[1]);
    if (!sourceDatasets[index]) activeReportSource = sourceDatasets.length ? "all" : "current";
  }
  renderSummaryFolders();
  renderAdminCenterPanel();
  renderReportSourceTabs();
  renderOverview();
  renderHistory();
}
async function unlockSuperAdmin() {
  const password = prompt("请输入管理员密码以提升高级管理员权限");
  const ok = (data.adminPassword && password === String(data.adminPassword)) || (appSessionPassword && password === appSessionPassword);
  if (!ok) return alert("管理员密码不正确。");
  superAdminUnlocked = true;
  document.body.classList.add("super-admin");
  activeReportSource = sourceDirHandles.length ? "all" : "current";
  await refreshSourceDatasets();
  setView("overview");
  showDialog("高级管理员已开启", "现在可以在整体预览顶部切换当前文件夹、全部汇总或单个来源文件夹。", "");
}
async function addSourceFolder() {
  if (!("showDirectoryPicker" in window)) return alert("当前浏览器不支持选择文件夹，请用新版 Chrome/Edge。");
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  if (!(await hasCloudPermission(dir))) return;
  sourceDirHandles.push(dir);
  sourceDirLabels = sourceDirHandles.map((item) => item.name || "来源文件夹");
  await saveSummaryFolders();
  if (superAdminUnlocked) await refreshSourceDatasets();
  renderSummaryFolders();
  renderAdminCenterPanel();
}
async function chooseSummaryFolder() {
  if (!("showDirectoryPicker" in window)) return alert("当前浏览器不支持选择文件夹，请用新版 Chrome/Edge。");
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  if (!(await hasCloudPermission(dir))) return;
  summaryDirHandle = dir;
  summaryLocationLabel = dir.name || "汇总文件夹";
  await saveSummaryFolders();
  renderSummaryFolders();
  renderAdminCenterPanel();
}
async function syncSummaryFolder() {
  if (!summaryDirHandle) return alert("请先选择汇总文件夹。");
  if (!sourceDirHandles.length) return alert("请先添加至少一个来源文件夹。");
  let merged = normalize(data);
  const existingMembers = new Set(merged.members || []);
  let count = 0;
  for (const dir of sourceDirHandles) {
    try {
      const label = dir.name || `来源 ${count + 1}`;
      merged = mergeSummaryData(merged, scopedSourceData(await readDirectoryReport(dir), label, existingMembers));
      count += 1;
    } catch (error) {
      console.warn(error);
    }
  }
  merged.updated_at = new Date().toISOString();
  await writeDirectoryReport(summaryDirHandle, merged);
  mergedSourceDataset = normalize(merged);
  if (superAdminUnlocked) activeReportSource = "all";
  await refreshSourceDatasets();
  setSyncStatus(`已汇总 ${count} 个来源 · ${new Date().toLocaleTimeString("zh-CN")}`, summaryLocationLabel || cloudLocationLabel);
  renderAdminCenterPanel();
  showDialog("汇总完成", `已经把 ${count} 个来源文件夹写入汇总文件夹。当前组文件夹数据没有被替换。`, "");
}
async function buildAdminCenterSnapshot() {
  saveFormSilently();
  let merged = normalize(data);
  let sourceCount = 0;
  sharedReplicaCount = 0;
  if (cloudDirHandle) {
    const replicas = await readClientReplicasFromDirectory(cloudDirHandle);
    sharedReplicaCount += replicas.length;
    replicas.forEach((replica) => {
      merged = mergeAdminCenterData(merged, replica.data);
      sourceCount += 1;
    });
  }
  if (sourceDirHandles.length) {
    await refreshSourceDatasets();
    sourceDatasets.forEach((source) => {
      if (source.error) return;
      merged = mergeAdminCenterData(merged, source.data);
      sourceCount += 1;
    });
  }
  if (summaryDirHandle) {
    try {
      merged = mergeAdminCenterData(merged, await readDirectoryReport(summaryDirHandle));
      sourceCount += 1;
      const replicas = await readClientReplicasFromDirectory(summaryDirHandle);
      sharedReplicaCount += replicas.length;
      replicas.forEach((replica) => {
        merged = mergeAdminCenterData(merged, replica.data);
        sourceCount += 1;
      });
    } catch (error) {
      console.warn(error);
    }
  }
  merged.updated_at = new Date().toISOString();
  return { data: normalize(merged), sourceCount };
}
async function mergeToAdminCenter() {
  if (!adminUnlocked) return setView("admin");
  createBackup("管理员中心合并前备份");
  const snapshot = await buildAdminCenterSnapshot();
  data = snapshot.data;
  if (!data.members.includes(currentMember)) currentMember = data.members[0] || currentMember;
  persistLocal();
  loadForm();
  render();
  setSyncStatus(`已合并到管理员本地中心 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
  showDialog("管理员中心已更新", `已合并 ${snapshot.sourceCount} 个共享来源。本机中心现在有 ${Object.keys(data.records || {}).length} 条记录。`, "");
}
async function writeAdminCenterToSharedTargets() {
  if (!adminUnlocked) return setView("admin");
  saveFormSilently();
  createBackup("管理员中心写共享前备份");
  persistLocal();
  const written = [];
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.writeCloudData(data);
    if (result?.path) {
      lastFileModified = result.mtime || lastFileModified;
      cloudLocationLabel = result.path;
      lastCloudText = JSON.stringify(data, null, 2);
      written.push(result.path);
    }
  }
  if (fileHandle) {
    const nextText = JSON.stringify(normalize(data), null, 2);
    const writable = await fileHandle.createWritable();
    await writable.write(nextText);
    await writable.close();
    lastCloudText = nextText;
    written.push(cloudLocationLabel || "备用文件");
  }
  const replicaPath = await writeClientReplicaToSharedFolder(data).catch(() => null);
  if (replicaPath) written.push(replicaPath);
  if (summaryDirHandle) {
    await writeDirectoryReport(summaryDirHandle, data);
    written.push(`${summaryLocationLabel || "汇总文件夹"}\\report_data.json`);
  }
  if (!written.length) return alert("请先选择备用文件夹或汇总文件夹，才能把管理员中心写到共享副本。");
  setSyncStatus(`管理员中心已写入共享 · ${new Date().toLocaleTimeString("zh-CN")}`, cloudLocationLabel);
  renderAdminCenterPanel();
  showDialog("共享副本已更新", `管理员中心已写入：${written.join("、")}`, "");
}
async function restoreCloudFromAdminCenter() {
  if (!adminUnlocked) return setView("admin");
  saveFormSilently();
  persistLocal();
  if (!confirm(`确定用管理员本地中心回灌${cloudSyncProviderLabel()}？会与云端现有数据自动合并，并优先保留管理员本机配置。`)) return;
  const result = await saveCloudDatabaseData("admin", false);
  renderAdminCenterPanel();
  if (result?.written) {
    await refreshCloudHistory(true).catch(() => {});
    showDialog("云同步已回灌", `已用管理员本地中心写回${cloudSyncProviderLabel()}，共 ${Object.keys(data.records || {}).length} 条记录。`, "");
    return;
  }
  const message = result?.reason === "cloud-quota-paused"
    ? "云同步额度仍然满或暂时不可用，管理员中心已经保留在本机和可选共享副本里。服务恢复后再点“中心回灌云同步”。"
    : "暂时无法写入云同步，请确认同步地址和 TEAM_SYNC_TOKEN 配置正常。管理员中心仍保存在本机。";
  showDialog("暂时无法回灌", message, "");
}
async function clearSourceFolders() {
  if (!confirm("确定清空来源文件夹列表？不会删除任何云端数据。")) return;
  sourceDirHandles = [];
  sourceDirLabels = [];
  sourceDatasets = [];
  mergedSourceDataset = null;
  activeReportSource = "current";
  await saveSummaryFolders();
  renderSummaryFolders();
  renderAdminCenterPanel();
  renderReportSourceTabs();
  renderOverview();
}
function exportData() {
  saveFormSilently();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `小组报数日记-${currentDate}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function xmlEscape(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));
}
function sheetNameSafe(name) {
  return String(name || "Sheet").replace(/[\\/*?:[\]]/g, "").slice(0, 28) || "Sheet";
}
function recordsInLastMonths(months = 3) {
  const cutoff = addDays(currentDate, -Math.round(months * 31));
  return Object.values(data.records).filter((rec) => rec.date >= cutoff).sort((a, b) => `${a.date}|${a.member}`.localeCompare(`${b.date}|${b.member}`));
}
function rowsToWorksheet(name, rows) {
  return `
    <Worksheet ss:Name="${xmlEscape(sheetNameSafe(name))}">
      <Table>
        ${rows.map((row, rowIndex) => `<Row>${row.map((cell) => {
          const isNumber = typeof cell === "number" && Number.isFinite(cell);
          return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(cell)}</Data></Cell>`;
        }).join("")}</Row>`).join("")}
      </Table>
    </Worksheet>
  `;
}
function excelBordersXml() {
  return `<Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/>
  </Borders>`;
}
function mixedWorkbookStylesXml() {
  const borders = excelBordersXml();
  return `
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
    <Style ss:ID="sTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#D95F5F" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sHeader"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#E57373" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sDate"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1"/><Interior ss:Color="#FCE4E4" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sItem"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#FBEAEA" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sTotal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1"/><Interior ss:Color="#EA9A9A" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sQuota"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sDiffGood"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#B7E1CD" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sDiffBad"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#F4CCCC" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sNote"><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#FFF2F2" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sCheckinGood"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1"/><Interior ss:Color="#63D878" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sCheckinLate"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#D9534F" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sCheckinLeave"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1"/><Interior ss:Color="#FCE5CD" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sCheckinBlue"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1"/><Interior ss:Color="#CFE2F3" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sCheckinBlank"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#FDEDED" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sStatusGood"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1"/><Interior ss:Color="#D9EAD3" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sStatusBad"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#990000"/><Interior ss:Color="#F4CCCC" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sSpacer"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
  `;
}
function styledCell(value, styleId = "", extra = {}) {
  return { value, styleId, ...extra };
}
function styledCellXml(cell) {
  const spec = cell && typeof cell === "object" && !Array.isArray(cell) && Object.prototype.hasOwnProperty.call(cell, "value")
    ? cell
    : { value: cell };
  const value = spec.value ?? "";
  const type = spec.type || (typeof value === "number" && Number.isFinite(value) ? "Number" : "String");
  const attrs = [
    spec.styleId ? ` ss:StyleID="${xmlEscape(spec.styleId)}"` : "",
    Number(spec.mergeAcross || 0) > 0 ? ` ss:MergeAcross="${Number(spec.mergeAcross)}"` : ""
  ].join("");
  return `<Cell${attrs}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}
function rowsToStyledWorksheet(name, rows, columns = []) {
  return `
    <Worksheet ss:Name="${xmlEscape(sheetNameSafe(name))}">
      <Table>
        ${columns.map((width) => `<Column ss:Width="${Number(width) || 48}"/>`).join("")}
        ${rows.map((row) => `<Row>${row.map(styledCellXml).join("")}</Row>`).join("")}
      </Table>
    </Worksheet>
  `;
}
function styledWorkbookXml(sheets, stylesXml) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>${stylesXml}</Styles>
  ${sheets.join("\n")}
</Workbook>`;
}
function buildThreeMonthWorkbookXml() {
  const itemNames = configuredItems();
  const records = recordsInLastMonths(3);
  const header = ["日期", "成员", "分组", ...itemNames, "原始", "换算", "定额", "差额", "状态", "备注"];
  const recordRow = (rec) => {
    const quota = memberQuota(rec.member, rec.date);
    return [
      rec.date,
      rec.member,
      data.memberGroups?.[rec.member] || "",
      ...itemNames.map((name) => Number(rec.items?.[name] || 0)),
      Number(rec.raw_total || 0),
      Number(rec.weighted_total || 0),
      quota,
      Number(rec.weighted_total || 0) - quota,
      rec.status || "",
      rec.reason || rec.harvest || rec.diary || ""
    ];
  };
  const summaryRows = [["成员", "分组", "总换算", "总定额", "总差额", ...itemNames]];
  data.members.forEach((member) => {
    const own = records.filter((rec) => rec.member === member);
    const weighted = own.reduce((sum, rec) => sum + Number(rec.weighted_total || 0), 0);
    const quota = own.reduce((sum, rec) => sum + memberQuota(member, rec.date), 0);
    summaryRows.push([
      member,
      data.memberGroups?.[member] || "",
      weighted,
      quota,
      weighted - quota,
      ...itemNames.map((name) => own.reduce((sum, rec) => sum + Number(rec.items?.[name] || 0), 0))
    ]);
  });
  const sheets = [
    rowsToWorksheet("总览", summaryRows),
    rowsToWorksheet("全部记录", [header, ...records.map(recordRow)]),
    ...data.members.map((member) => rowsToWorksheet(member, [header, ...records.filter((rec) => rec.member === member).map(recordRow)]))
  ];
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/></Style>
  </Styles>
  ${sheets.join("\n")}
</Workbook>`;
}
function workbookXml(sheets) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/></Style>
  </Styles>
  ${sheets.join("\n")}
</Workbook>`;
}
function downloadExcelXml(xml, filename) {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function crc32(bytes) {
  if (!crc32.table) {
    crc32.table = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}
function writeZipValue(bytes, offset, value, size) {
  for (let index = 0; index < size; index += 1) bytes[offset + index] = (value >>> (index * 8)) & 0xff;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}
function createZip(files) {
  const encoder = new TextEncoder();
  const now = dosDateTime();
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    writeZipValue(local, 0, 0x04034b50, 4);
    writeZipValue(local, 4, 20, 2);
    writeZipValue(local, 6, 0x0800, 2);
    writeZipValue(local, 10, now.time, 2);
    writeZipValue(local, 12, now.date, 2);
    writeZipValue(local, 14, crc, 4);
    writeZipValue(local, 18, dataBytes.length, 4);
    writeZipValue(local, 22, dataBytes.length, 4);
    writeZipValue(local, 26, nameBytes.length, 2);
    local.set(nameBytes, 30);
    chunks.push(local, dataBytes);
    const entry = new Uint8Array(46 + nameBytes.length);
    writeZipValue(entry, 0, 0x02014b50, 4);
    writeZipValue(entry, 4, 20, 2);
    writeZipValue(entry, 6, 20, 2);
    writeZipValue(entry, 8, 0x0800, 2);
    writeZipValue(entry, 12, now.time, 2);
    writeZipValue(entry, 14, now.date, 2);
    writeZipValue(entry, 16, crc, 4);
    writeZipValue(entry, 20, dataBytes.length, 4);
    writeZipValue(entry, 24, dataBytes.length, 4);
    writeZipValue(entry, 28, nameBytes.length, 2);
    writeZipValue(entry, 42, offset, 4);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length + dataBytes.length;
  });
  const centralOffset = offset;
  central.forEach((entry) => {
    chunks.push(entry);
    offset += entry.length;
  });
  const end = new Uint8Array(22);
  writeZipValue(end, 0, 0x06054b50, 4);
  writeZipValue(end, 8, files.length, 2);
  writeZipValue(end, 10, files.length, 2);
  writeZipValue(end, 12, offset - centralOffset, 4);
  writeZipValue(end, 16, centralOffset, 4);
  chunks.push(end);
  return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function columnName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}
function xlsxCellStyleId(styleId = "") {
  const styles = {
    sTitle: 1,
    sHeader: 2,
    sDate: 3,
    sItem: 4,
    sTotal: 5,
    sQuota: 6,
    sDiffGood: 7,
    sDiffBad: 8,
    sNote: 9,
    sCheckinGood: 10,
    sCheckinLate: 11,
    sCheckinLeave: 12,
    sCheckinBlue: 13,
    sCheckinBlank: 14,
    sStatusGood: 15,
    sStatusBad: 16,
    sSpacer: 17
  };
  return styles[styleId] || 0;
}
function xlsxCellXml(cell, rowIndex, colIndex) {
  const spec = cell && typeof cell === "object" && !Array.isArray(cell) && Object.prototype.hasOwnProperty.call(cell, "value")
    ? cell
    : { value: cell };
  const ref = `${columnName(colIndex)}${rowIndex}`;
  const style = xlsxCellStyleId(spec.styleId);
  const value = spec.value ?? "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}
function rowsToXlsxWorksheet(rows, columns = []) {
  const merges = [];
  const rowXml = rows.map((row, rowIndex) => {
    let colIndex = 1;
    const cells = row.map((cell) => {
      const spec = cell && typeof cell === "object" && !Array.isArray(cell) && Object.prototype.hasOwnProperty.call(cell, "value")
        ? cell
        : { value: cell };
      const cellXml = xlsxCellXml(spec, rowIndex + 1, colIndex);
      const mergeAcross = Number(spec.mergeAcross || 0);
      if (mergeAcross > 0) merges.push(`${columnName(colIndex)}${rowIndex + 1}:${columnName(colIndex + mergeAcross)}${rowIndex + 1}`);
      colIndex += 1 + Math.max(0, mergeAcross);
      return cellXml;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const cols = columns.length
    ? `<cols>${columns.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(6, Number(width || 48) / 7)}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${cols}
  <sheetData>${rowXml}</sheetData>
  ${mergeXml}
</worksheet>`;
}
function xlsxStylesXml() {
  const fills = ["FFFFFF", "D95F5F", "E57373", "FCE4E4", "FBEAEA", "EA9A9A", "FFF2CC", "B7E1CD", "F4CCCC", "FFF2F2", "63D878", "D9534F", "FCE5CD", "CFE2F3", "FDEDED", "D9EAD3"];
  const fillXml = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', ...fills.map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)].join("");
  const fontXml = [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF990000"/><name val="Calibri"/></font>'
  ].join("");
  const border = '<border><left style="thin"><color rgb="FFFFFFFF"/></left><right style="thin"><color rgb="FFFFFFFF"/></right><top style="thin"><color rgb="FFFFFFFF"/></top><bottom style="thin"><color rgb="FFFFFFFF"/></bottom><diagonal/></border>';
  const xf = (fillId, fontId = 0, horizontal = "center", wrap = false) => `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${horizontal}" vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">${fontXml}</fonts>
  <fills count="${fills.length + 2}">${fillXml}</fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="18">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    ${xf(2, 1, "center", true)}
    ${xf(3, 1, "center", true)}
    ${xf(4, 2)}
    ${xf(5)}
    ${xf(6, 2)}
    ${xf(7)}
    ${xf(8)}
    ${xf(9)}
    ${xf(10, 0, "left", true)}
    ${xf(11, 2, "center", true)}
    ${xf(12, 1, "center", true)}
    ${xf(13, 2, "center", true)}
    ${xf(14, 2, "center", true)}
    ${xf(15)}
    ${xf(16, 2)}
    ${xf(9, 3)}
    ${xf(2)}
  </cellXfs>
</styleSheet>`;
}
function buildXlsxWorkbook(sheetName, rows, columns = []) {
  return createZip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetNameSafe(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: xlsxStylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: rowsToXlsxWorksheet(rows, columns) }
  ]);
}
function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function mixedTableExportRange() {
  applyMixedTableDefaultRange();
  let start = $("mixedTableStart")?.value || currentDate;
  let end = $("mixedTableEnd")?.value || currentDate;
  if (start > end) [start, end] = [end, start];
  return { start, end, days: buildDateRange(start, end) };
}
function mixedExportCheckinStyle(value) {
  const status = checkinStatus(value);
  if (!status) return "sCheckinBlank";
  if (/(迟到|迟|未到)/.test(status)) return "sCheckinLate";
  if (/(请假|假|休)/.test(status)) return "sCheckinLeave";
  if (/(听|交通|上班|农活|聚会|值日)/.test(status)) return "sCheckinBlue";
  if (/(上线|准时|到|达标)/.test(status)) return "sCheckinGood";
  return "sCheckinBlue";
}
function mixedExportStatusStyle(status) {
  if (/(未|待|不|失败)/.test(String(status || ""))) return "sStatusBad";
  if (status) return "sStatusGood";
  return "sItem";
}
function mixedExportBlock(member, index, group, days, itemNames, periods, report) {
  const header = ["日期", ...periods.map((period) => `${period.label}打卡`), ...itemNames, "原始", "换算", "定额", "差额", "状态", "备注"];
  const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
  const records = days.map((day) => {
    const rec = recordForReport(report, day, member);
    const items = rec?.items || {};
    itemNames.forEach((name) => {
      itemTotals[name] += Number(items[name] || 0);
    });
    const totals = totalsForItems(items, itemNames, report);
    const quota = memberQuota(member, day);
    return { day, rec, items, raw: totals.raw, weighted: totals.weighted, quota, diff: totals.weighted - quota };
  });
  const totalRaw = records.reduce((sum, row) => sum + row.raw, 0);
  const totalWeighted = records.reduce((sum, row) => sum + row.weighted, 0);
  const totalQuota = records.reduce((sum, row) => sum + row.quota, 0);
  const totalDiff = totalWeighted - totalQuota;
  const blockWidth = header.length;
  const title = `${index + 1} ${member}｜${group || "未分组"}｜换算 ${fmt(totalWeighted)}｜定额 ${fmt(totalQuota)}｜差额 ${fmt(totalDiff)}`;
  const rows = [
    [styledCell(title, "sTitle", { mergeAcross: blockWidth - 1 })],
    header.map((label) => styledCell(label, "sHeader")),
    [
      styledCell("合计", "sDate"),
      ...periods.map(() => styledCell("", "sCheckinBlank")),
      ...itemNames.map((name) => styledCell(itemTotals[name] || "", "sItem")),
      styledCell(totalRaw, "sTotal"),
      styledCell(totalWeighted, "sTotal"),
      styledCell(totalQuota, "sQuota"),
      styledCell(totalDiff, totalDiff >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell("", "sItem"),
      styledCell("", "sNote")
    ],
    ...records.map(({ day, rec, items, raw, weighted, quota, diff }) => [
      styledCell(day.slice(5), "sDate"),
      ...periods.map((period) => styledCell(checkinDisplay(rec?.checkins?.[period.key]), mixedExportCheckinStyle(rec?.checkins?.[period.key]))),
      ...itemNames.map((name) => styledCell(Number(items[name] || 0) || "", "sItem")),
      styledCell(raw, "sTotal"),
      styledCell(weighted, "sTotal"),
      styledCell(quota, "sQuota"),
      styledCell(diff, diff >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell(rec?.status || "", mixedExportStatusStyle(rec?.status || "")),
      styledCell(rec?.reason || rec?.harvest || rec?.diary || "", "sNote")
    ])
  ];
  return { rows, blockWidth };
}
function mixedExportColumnWidths(blockWidth, itemCount, memberCount) {
  const block = [
    46,
    ...checkinPeriods().map(() => 46),
    ...Array.from({ length: itemCount }, () => 56),
    56,
    56,
    56,
    56,
    62,
    126
  ];
  return Array.from({ length: memberCount }, (_, index) => [
    ...block,
    ...(index < memberCount - 1 ? [12] : [])
  ]).flat().slice(0, memberCount * blockWidth + Math.max(0, memberCount - 1));
}
function buildMixedTableWorkbookXml() {
  const report = selectedReportData();
  return withReportData(report, () => {
    const { start, end, days } = mixedTableExportRange();
    const group = $("mixedTableGroup")?.value || mixedTableGroup || report.groups?.[0] || "";
    const members = membersForGroupValue(group, report);
    const itemNames = groupVisibleItems(group, report);
    const periods = checkinPeriods();
    if (!members.length) {
      return {
        group,
        start,
        end,
        name: `${group || "混合"}总表`,
        rows: [[styledCell("暂无成员", "sTitle")]],
        columns: [120],
        xml: styledWorkbookXml([rowsToStyledWorksheet(`${group || "混合"}总表`, [[styledCell("暂无成员", "sTitle")]], [120])], mixedWorkbookStylesXml())
      };
    }
    const blocks = members.map((member, index) => mixedExportBlock(member, index, group, days, itemNames, periods, report));
    const maxRows = Math.max(...blocks.map((block) => block.rows.length));
    const spacer = styledCell("", "sSpacer");
    const rows = Array.from({ length: maxRows }, (_, rowIndex) => blocks.flatMap((block, blockIndex) => [
      ...(block.rows[rowIndex] || Array.from({ length: block.blockWidth }, () => styledCell("", "sItem"))),
      ...(blockIndex < blocks.length - 1 ? [spacer] : [])
    ]));
    const columns = mixedExportColumnWidths(blocks[0].blockWidth, itemNames.length, blocks.length);
    const sheet = rowsToStyledWorksheet(`${group || "混合"}总表`, rows, columns);
    return { group, start, end, name: `${group || "混合"}总表`, rows, columns, xml: styledWorkbookXml([sheet], mixedWorkbookStylesXml()) };
  });
}
function exportMixedTableWorkbook() {
  saveFormSilently();
  const { group, start, end, name, rows, columns } = buildMixedTableWorkbookXml();
  downloadBlob(buildXlsxWorkbook(name, rows, columns), `mixed_table_${group || "all"}_${start}_${end}.xlsx`);
}
function buildCsvBackups() {
  const itemNames = configuredItems();
  const rows = [["日期", "成员", ...itemNames, "原始", "换算", "定额", "差额", "状态", "备注"]];
  Object.values(data.records)
    .sort((a, b) => `${a.date}|${a.member}`.localeCompare(`${b.date}|${b.member}`))
    .forEach((rec) => {
      const quota = memberQuota(rec.member, rec.date);
      rows.push([
        rec.date,
        rec.member,
        ...itemNames.map((name) => rec.items?.[name] || 0),
        rec.raw_total || 0,
        rec.weighted_total || 0,
        quota,
        Number(rec.weighted_total || 0) - quota,
        rec.status || "",
        rec.reason || rec.harvest || rec.diary || ""
      ]);
    });
  const summary = [["成员", "总换算", "总定额", "总差额", ...itemNames]];
  data.members.forEach((member) => {
    const records = Object.values(data.records).filter((rec) => rec.member === member);
    const weighted = records.reduce((sum, rec) => sum + Number(rec.weighted_total || 0), 0);
    const quota = records.reduce((sum, rec) => sum + memberQuota(member, rec.date), 0);
    summary.push([
      member,
      weighted,
      quota,
      weighted - quota,
      ...itemNames.map((name) => records.reduce((sum, rec) => sum + Number(rec.items?.[name] || 0), 0))
    ]);
  });
  const toCsv = (table) => table.map((row) => row.map(csvEscape).join(",")).join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return [
    { name: `daily_report_records_${stamp}.csv`, text: "\ufeff" + toCsv(rows) },
    { name: `daily_report_summary_${stamp}.csv`, text: "\ufeff" + toCsv(summary) }
  ];
}
async function backupSheets(silent = false) {
  const stamp = currentDate.slice(0, 7);
  const files = [
    { name: `daily_report_3months_${stamp}.xls`, text: buildThreeMonthWorkbookXml() },
    ...buildCsvBackups()
  ];
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.writeCsvBackup(files);
    if (result?.folder) {
      if (!silent) showDialog("表格备份已生成", `3个月表格和 CSV 已写入：${result.folder}。放在 Google Drive 同步目录里后，可用 Google 表格打开。`, "");
      return;
    }
  }
  if (silent) return;
  files.forEach((file) => {
    const blob = new Blob([file.text], { type: file.name.endsWith(".xls") ? "application/vnd.ms-excel;charset=utf-8" : "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    createBackup("导入前备份");
    data = normalize(JSON.parse(String(reader.result || "{}")));
    persistLocal();
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    loadForm();
    render();
  };
  reader.readAsText(file, "utf-8");
}
async function saveAdminConfig() {
  if (!adminUnlocked) return setView("admin");
  const nextPassword = $("adminPasswordInput").value.trim();
  if (nextPassword) {
    data.adminPassword = nextPassword;
    $("adminPasswordInput").value = "";
  }
  collectAdminSettings();
  createBackup("保存配置前备份");
  persistLocal();
  const result = await persistEverywhere("admin");
  render();
  if (!result?.written) {
    $("adminSaveStatus").textContent = `配置只保存为本地草稿 · ${new Date().toLocaleString("zh-CN")}`;
    const message = result?.reason === "cloud-quota-paused"
      ? "云数据库额度已满或暂时不可用，配置已先留在本机草稿。请恢复云同步服务，或先选择团队共享文件夹作为临时备份。"
      : "请确认云同步已配置，或选择团队共享的云端文件夹。未连接云端时，配置只会留在本机浏览器缓存里。";
    showDialog("配置未同步", message, "");
    return;
  }
  $("adminSaveStatus").textContent = `配置已保存并同步 · ${new Date().toLocaleString("zh-CN")}`;
  showDialog("配置已保存", result.cloudDbWritten ? `项目、定额和成员名单已经写入${cloudSyncProviderLabel()}。其他成员同步后会自动更新。` : "项目、定额和成员名单已经写入共享数据。其他成员同步后会自动更新。", "");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s] || s));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
function bindEvents() {
  syncCloudEndpointInputs();
  $("dateInput").value = currentDate;
  $("dateInput").onchange = () => selectDate($("dateInput").value);
  $("overviewDateInput").onchange = () => {
    selectDate($("overviewDateInput").value || todayLocalKey());
  };
  $("overviewRangeSelect").onchange = () => {
    overviewRangeMode = $("overviewRangeSelect").value || "day";
    renderOverview();
  };
  ["monthInput", "overviewMonthInput"].forEach((id) => {
    $(id).onchange = () => selectDate(sameDayInMonth($(id).value || monthKeyFromDateKey(currentDate)));
  });
  $("prevMonthBtn").onclick = () => selectDate(addDays(currentDate, -1));
  $("nextMonthBtn").onclick = () => selectDate(addDays(currentDate, 1));
  $("overviewPrevMonthBtn").onclick = () => selectDate(addDays(currentDate, -1));
  $("overviewNextMonthBtn").onclick = () => selectDate(addDays(currentDate, 1));
  $("unlockBtn").onclick = () => unlockApp().catch((err) => {
    $("lockHint").textContent = err.message || "登录失败";
  });
  $("appPasswordInput").onkeydown = (event) => {
    if (event.key === "Enter") unlockApp().catch((err) => {
      $("lockHint").textContent = err.message || "登录失败";
    });
  };
  $("quotaInput").oninput = () => {
    data.quota = Number($("quotaInput").value || 0);
    preview();
    renderOverview();
    scheduleSave("admin");
  };
  $("dailyQuotaInput").oninput = () => {
    setDailyMemberQuota(currentMember, currentDate, $("dailyQuotaInput").value);
    preview();
    renderOverview();
    persistLocal();
    scheduleRecordCloudSave();
  };
  $("adminQuotaDate").value = currentDate;
  $("adminQuotaDate").onchange = renderMemberQuotas;
  $("dateQuotaInput").oninput = () => {
    setDailyDefaultQuota($("adminQuotaDate").value || currentDate, $("dateQuotaInput").value);
    renderMemberQuotas();
    preview();
    renderOverview();
    scheduleSave("admin");
  };
  $("entryText").oninput = () => {
    preview();
    scheduleDraftSave();
  };
  $("statusSelect").onchange = () => saveFormSilently();
  $("reasonText").oninput = scheduleDraftSave;
  $("harvestText").oninput = scheduleDraftSave;
  $("diaryText").oninput = scheduleDraftSave;
  $("saveBtn").onclick = () => activeView === "admin" ? saveAdminConfig() : saveAndAudit();
  $("adminSaveBtn").onclick = saveAdminConfig;
  $("autoAuditToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("sheetBackupToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("backupCleanupToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("checkinOptionsInput").onchange = () => { collectAdminSettings(); renderCheckins(currentRecord().checkins || {}); renderOverview(); scheduleSave("admin"); };
  $("passMessagesInput").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("failMessagesInput").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("analysisScope").onchange = () => {
    analysisTableMember = "";
    renderAnalytics();
  };
  $("analysisGroup").onchange = () => {
    if ($("analysisScope").value === "team") $("analysisScope").value = "group";
    analysisTableMember = "";
    renderAnalytics();
  };
  $("analysisMember").onchange = () => {
    const member = $("analysisMember").value;
    if (member) {
      const report = selectedReportData();
      const group = report.memberGroups?.[member];
      if (group && [...$("analysisGroup").options].some((option) => option.value === group)) $("analysisGroup").value = group;
      $("analysisScope").value = "member";
    } else if ($("analysisScope").value === "member") {
      $("analysisScope").value = "group";
    }
    analysisTableMember = "";
    renderAnalytics();
  };
  ["analysisRange", "analysisCustomDays", "analysisCompare", "rangeStart", "rangeEnd"].forEach((id) => {
    $(id).onchange = renderAnalytics;
  });
  ["overviewDetailGroup", "overviewDetailMember"].forEach((id) => {
    $(id).onchange = () => {
      overviewDetailGroup = $("overviewDetailGroup").value;
      overviewDetailMember = $("overviewDetailMember").value;
      renderOverview();
    };
  });
  $("mixedTableGroup").onchange = () => {
    mixedTableGroup = $("mixedTableGroup").value;
    mixedTableMember = "";
    mixedCheckinGroup = mixedTableGroup;
    mixedCheckinMember = "";
    renderMixedOverviewTable();
  };
  $("mixedTableMember").onchange = () => {
    mixedTableMember = $("mixedTableMember").value;
    renderMixedOverviewTable();
  };
  ["mixedTableStart", "mixedTableEnd"].forEach((id) => {
    $(id).onchange = () => {
      mixedTableRangeMode = $("mixedTableStart").value || $("mixedTableEnd").value ? "custom" : "default";
      renderMixedOverviewTable();
    };
  });
  $("mixedCheckinGroup").onchange = () => {
    mixedCheckinGroup = $("mixedCheckinGroup").value;
    mixedCheckinMember = "";
    renderMixedCheckinTable();
  };
  ["checkinViewGroup", "checkinViewMember"].forEach((id) => {
    $(id).onchange = () => {
      checkinViewGroup = $("checkinViewGroup").value;
      checkinViewMember = $("checkinViewMember").value;
      renderCheckinOverview();
    };
  });
  ["checkinViewStart", "checkinViewEnd"].forEach((id) => {
    $(id).onchange = () => {
      checkinViewRangeMode = $("checkinViewStart").value || $("checkinViewEnd").value ? "custom" : "default";
      renderCheckinOverview();
    };
  });
  $("analysisCustomDays").oninput = renderAnalytics;
  $("addRuleBtn").onclick = () => {
    const name = nextRuleName();
    data.rules[name] = 1;
    Object.keys(data.groupItems || {}).forEach((group) => {
      if (!Array.isArray(data.groupItems[group])) data.groupItems[group] = [];
      data.groupItems[group].push(name);
    });
    data.members.forEach((member) => {
      if (!Array.isArray(data.memberItems[member])) data.memberItems[member] = configuredItems();
      data.memberItems[member].push(name);
    });
    renderRules();
    renderEntryInputs(readEntryInputs());
    scheduleSave("admin");
  };
  $("selectedItemsBtn").onclick = () => {
    showAllEntryItems = false;
    $("selectedItemsBtn").classList.add("active");
    $("allItemsBtn").classList.remove("active");
    renderEntryInputs(filterItemsByRules(readEntryInputs()));
  };
  $("allItemsBtn").onclick = () => {
    showAllEntryItems = true;
    $("allItemsBtn").classList.add("active");
    $("selectedItemsBtn").classList.remove("active");
    renderEntryInputs(readEntryInputs());
  };
  $("itemConfigGroup").onchange = renderMemberItemConfig;
  $("selectAllGroupItemsBtn").onclick = () => {
    data.groupItems[$("itemConfigGroup").value] = configuredItems();
    renderMemberItemConfig();
    if ((data.memberGroups[currentMember] || data.groups[0]) === $("itemConfigGroup").value && !showAllEntryItems) renderEntryInputs(readEntryInputs());
    scheduleSave("admin");
  };
  $("clearGroupItemsBtn").onclick = () => {
    data.groupItems[$("itemConfigGroup").value] = [];
    renderMemberItemConfig();
    if ((data.memberGroups[currentMember] || data.groups[0]) === $("itemConfigGroup").value && !showAllEntryItems) renderEntryInputs({});
    scheduleSave("admin");
  };
  $("addMemberBtn").onclick = () => addMember($("memberName").value.trim());
  $("adminAddMemberBtn").onclick = () => addMember($("adminMemberName").value.trim());
  $("addGroupBtn").onclick = () => addGroup($("groupNameInput").value.trim());
  $("addTimezoneBtn").onclick = () => {
    const name = $("timezoneNameInput").value.trim();
    const offset = $("timezoneOffsetInput").value.trim();
    if (!name || !/^[+-]\d{1,2}:?\d{2}$/.test(offset)) return alert("请填写名称和 UTC 偏移，例如 +08:00 或 -05:00。");
    data.timezones.push({ name, offset });
    $("timezoneNameInput").value = "";
    $("timezoneOffsetInput").value = "";
    renderTimezones();
    scheduleSave("admin");
  };
  $("compactToggle").onchange = () => $("app").classList.toggle("compact", $("compactToggle").checked);
  $("openFileBtn").onclick = () => chooseSharedFile().catch((err) => alert(`打开失败：${err.message}`));
  $("sidebarToggle").onclick = () => {
    $("app").classList.toggle("sidebar-collapsed");
    $("sidebarToggle").textContent = $("app").classList.contains("sidebar-collapsed") ? "›" : "‹";
  };
  $("addSourceFolderBtn").onclick = () => addSourceFolder().catch((err) => alert(`添加来源失败：${err.message}`));
  $("elevateSuperAdminBtn").onclick = () => unlockSuperAdmin().catch((err) => alert(`提升失败：${err.message}`));
  $("refreshSourceFoldersBtn").onclick = () => (superAdminUnlocked ? refreshSourceDatasets() : unlockSuperAdmin()).catch((err) => alert(`刷新失败：${err.message}`));
  $("clearSourceFoldersBtn").onclick = () => clearSourceFolders();
  $("chooseSummaryFolderBtn").onclick = () => chooseSummaryFolder().catch((err) => alert(`选择汇总失败：${err.message}`));
  $("syncSummaryFolderBtn").onclick = () => syncSummaryFolder().catch((err) => alert(`汇总失败：${err.message}`));
  $("saveCloudEndpointBtn").onclick = () => updateCloudSyncEndpointFromAdmin(false);
  $("clearCloudEndpointBtn").onclick = () => updateCloudSyncEndpointFromAdmin(true);
  $("mergeAdminCenterBtn").onclick = () => mergeToAdminCenter().catch((err) => alert(`合并失败：${err.message}`));
  $("writeAdminCenterFolderBtn").onclick = () => writeAdminCenterToSharedTargets().catch((err) => alert(`写入共享失败：${err.message}`));
  $("restoreCloudFromAdminCenterBtn").onclick = () => restoreCloudFromAdminCenter().catch((err) => alert(`回灌失败：${err.message}`));
  $("cloudBackupStatusBtn").onclick = () => refreshCloudBackupStatus(false).catch((err) => alert(`云数据库检查失败：${err.message}`));
  $("cloudBackupNowBtn").onclick = () => backupToCloudDatabase().catch((err) => {
    setCloudBackupStatus(`备份失败：${err.message}`);
    alert(`云数据库备份失败：${err.message}`);
  });
  $("cloudRestoreLatestBtn").onclick = () => restoreFromCloudDatabase().catch((err) => {
    setCloudBackupStatus(`恢复失败：${err.message}`);
    alert(`云数据库恢复失败：${err.message}`);
  });
  $("cloudBackupTokenInput").onkeydown = (event) => {
    if (event.key === "Enter") refreshCloudBackupStatus(false).catch((err) => alert(`云数据库检查失败：${err.message}`));
  };
  $("cloudHistoryRefreshBtn").onclick = () => refreshCloudHistory(false);
  $("cloudHistoryRestoreBtn").onclick = () => restoreCloudHistory().catch((err) => alert(`恢复云端历史失败：${err.message}`));
  $("exportBtn").onclick = exportData;
  $("exportMixedTableBtn").onclick = exportMixedTableWorkbook;
  $("backupBtn").onclick = () => setView("admin");
  $("sheetBackupBtn").onclick = backupSheets;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = (event) => {
    const file = event.target.files?.[0];
    if (file) importData(file);
  };
  $("dialogSkip").onclick = closeDialog;
  $("dialogSave").onclick = () => {
    if (!pendingDialogField) {
      closeDialog();
      return;
    }
    const rec = currentRecord();
    if (pendingDialogField === "reason") {
      rec.reason = $("dialogText").value.trim();
      $("reasonText").value = rec.reason;
    }
    if (pendingDialogField === "harvest") {
      rec.harvest = $("dialogText").value.trim();
      $("harvestText").value = rec.harvest;
    }
    persistEverywhere();
    renderHistory();
    closeDialog();
  };
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view || "entry"));
  });
  document.addEventListener("click", (event) => {
    const picker = $("overviewGroupPicker");
    if (picker && !picker.contains(event.target)) picker.classList.remove("open");
  });
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) markUserTyping();
  }, true);
}
pruneBackups();
createBackup("每日自动备份");
bindEvents();
loadForm();
render();
setView(activeView);
restoreCloudDirectory();
loadCloudSyncConfig().then(() => refreshCloudDatabaseStatus(true));
refreshCloudBackupStatus(true);
startCloudPolling();
window.addEventListener("focus", () => {
  pollSharedFile(true);
  if (appUnlocked) syncCloudDatabaseIfChanged({ silent: true }).catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    pollSharedFile(true);
    if (appUnlocked) syncCloudDatabaseIfChanged({ silent: true }).catch(() => {});
  }
});
