const defaultData = {
  version: 2,
  updated_at: "",
  quota: 3,
  rules: { "视频": 1, "音频": 1, "字幕": 0.25, "图片": 0 },
  productRules: { "视频": { video: 1, ai: 0 }, "音频": { video: 0, ai: 0 }, "字幕": { video: 0, ai: 1 }, "图片": { video: 0, ai: 0 } },
  totalConversionRules: {},
  members: ["成员A"],
  groups: ["1组"],
  memberGroups: { "成员A": "1组" },
  memberSubgroups: {},
  groupItems: {},
  memberItems: {},
  memberQuotas: {},
  completeQuota: "",
  memberCompleteQuotas: {},
  memberWorkloadNotes: {},
  workloadQuota: "",
  memberWorkloadQuotas: {},
  dailyWorkloadQuotas: {},
  dailyQuotas: {},
  dailyCompleteQuotas: {},
  monthlyPlans: {},
  freeTable: { rows: 20, columns: 8, cells: {}, updated_at: "" },
  checkinOptions: ["准时上线", "迟到", "请假", "上班", "已讲", "准时下线", "伯日", "值日", "请假生病", "聚会", "运动", "其他本分", "上学", "听评", "熬夜", "拍摄"],
  timezones: [
    { name: "澳大利亚时间", offset: "+10:00" },
    { name: "新西兰时间", offset: "+12:00" },
    { name: "欧洲时间", offset: "+01:00" },
    { name: "希腊时间", offset: "+03:00" },
    { name: "柬埔寨时间", offset: "+07:00" },
    { name: "美国时间", offset: "-05:00" },
    { name: "洛杉矶时间", offset: "-07:00" },
  ],
  fbSpecialties: [],
  adminPassword: "",
  sheetBackupEnabled: true,
  sheetBackupBaseName: "daily_report",
  backupCleanupEnabled: false,
  autoAudit: false,
  hiddenMembers: {},
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
let sheetBackupDirHandle = null;
let sheetBackupLocationLabel = "";
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
let mixedTableRangeMode = "week";
let mixedExportMonths = [];
let mixedExportYear = Number(monthKeyFromDateKey(todayLocalKey()).slice(0, 4));
let mixedCheckinGroup = "";
let mixedCheckinMember = "";
let activeSpecialtyId = "";
let checkinViewGroup = "";
let checkinViewMember = "";
let checkinViewRangeMode = "default";
let pendingDialogField = "";
let activeView = "entry";
let saveTimer = 0;
let draftTimer = 0;
let recordCloudSaveTimer = 0;
let freeTableSaveTimer = 0;
let pendingCloudRecordKeys = new Set();
let adminUnlocked = false;
let showAllEntryItems = false;
let appUnlocked = false;
let collapsedGroups = JSON.parse(localStorage.getItem("dailyReportCollapsedGroups") || "{}");
let lastTypingAt = 0;
let sharedReplicaCount = 0;
let cloudSyncEndpoint = loadCloudSyncEndpoint();
let cloudSyncEndpointFromEnv = "";
let cloudSyncConfigLoaded = false;
let cloudSyncConfigLoading = null;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
function cleanTotalValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const snapped = Math.round(number * 4) / 4;
  return Object.is(snapped, -0) ? 0 : snapped;
}
function fmtTotal(value) {
  return fmt(cleanTotalValue(value));
}
function signedTotalText(value) {
  const cleaned = cleanTotalValue(value);
  return `${cleaned >= 0 ? "+" : ""}${fmt(cleaned)}`;
}
function normalizeDutyHours(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number;
}
function dutyHoursValue(record = {}) {
  return normalizeDutyHours(record?.duty_hours ?? record?.dutyHours ?? 0);
}
function fmtDutyHours(value) {
  return `${fmt(normalizeDutyHours(value))}h`;
}
function markPendingCloudRecord(day = currentDate, member = currentMember) {
  const nextDay = String(day || "").trim();
  const nextMember = String(member || "").trim();
  if (nextDay && nextMember) pendingCloudRecordKeys.add(nextDay + "|" + nextMember);
}
function compactCloudSyncData(mode = "records") {
  if (mode !== "records") return normalize(data);
  const keys = new Set(pendingCloudRecordKeys);
  if (currentDate && currentMember) keys.add(currentDate + "|" + currentMember);
  const records = {};
  const dailyQuotas = {};
  const dailyCompleteQuotas = {};
  const dailyWorkloadQuotas = {};
  keys.forEach((key) => {
    const record = data.records?.[key];
    if (!record) return;
    records[key] = clone(record);
    if (record.date && data.dailyQuotas?.[record.date]) dailyQuotas[record.date] = clone(data.dailyQuotas[record.date]);
    if (record.date && data.dailyCompleteQuotas?.[record.date]) dailyCompleteQuotas[record.date] = clone(data.dailyCompleteQuotas[record.date]);
    if (record.date && data.dailyWorkloadQuotas?.[record.date]) dailyWorkloadQuotas[record.date] = clone(data.dailyWorkloadQuotas[record.date]);
  });
  if (!Object.keys(records).length) return normalize(data);
  return normalize({
    version: data.version,
    updated_at: data.updated_at,
    quota: data.quota,
    completeQuota: data.completeQuota,
    rules: data.rules,
    productRules: data.productRules,
    totalConversionRules: data.totalConversionRules,
    members: data.members,
    groups: data.groups,
    memberGroups: data.memberGroups,
    memberSubgroups: data.memberSubgroups,
    groupItems: data.groupItems,
    memberItems: data.memberItems,
    memberQuotas: data.memberQuotas,
    memberCompleteQuotas: data.memberCompleteQuotas,
    memberWorkloadNotes: data.memberWorkloadNotes,
    workloadQuota: data.workloadQuota,
    memberWorkloadQuotas: data.memberWorkloadQuotas,
    dailyWorkloadQuotas,
    dailyQuotas,
    dailyCompleteQuotas,
    checkinOptions: data.checkinOptions,
    records
  });
}
function styledTotalCell(value, style) {
  return styledCell(cleanTotalValue(value), style);
}
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
  if (!loadCloudSyncEndpoint()) {
    cloudSyncEndpoint = cloudSyncEndpointFromEnv;
    if (cloudSyncEndpointFromEnv) localStorage.setItem("dailyReportCloudSyncEndpoint", cloudSyncEndpointFromEnv);
  }
  syncCloudEndpointInputs();
  renderSyncPanel();
}
async function loadCloudSyncConfig({ force = false } = {}) {
  if (window.location.protocol === "file:" || typeof fetch !== "function") return cloudSyncEndpointFromEnv;
  if (!force && cloudSyncConfigLoaded) return cloudSyncEndpointFromEnv;
  if (!force && cloudSyncConfigLoading) return cloudSyncConfigLoading;
  cloudSyncConfigLoading = (async () => {
    try {
      const response = await fetch("/api/sync-config", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && result.ok) {
        setCloudSyncEndpointFromEnv(result.endpoint || "");
        cloudSyncConfigLoaded = true;
      }
    } catch {
      // Vercel/local config endpoint is optional; manual endpoint entry still works.
    }
    return cloudSyncEndpointFromEnv;
  })();
  try {
    return await cloudSyncConfigLoading;
  } finally {
    cloudSyncConfigLoading = null;
  }
}
async function ensureCloudSyncConfig() {
  if (cloudSyncEndpoint || cloudSyncEndpointFromEnv) return cloudSyncEndpoint;
  await loadCloudSyncConfig({ force: !cloudSyncConfigLoaded });
  return cloudSyncEndpoint;
}
function cloudSyncProviderLabel() {
  return cloudSyncEndpoint ? "Cloudflare Worker" : "Vercel 云库";
}
function shouldUseCloudflareSyncProxy() {
  const host = window.location.hostname;
  return Boolean(
    cloudSyncEndpoint &&
    cloudSyncEndpointFromEnv &&
    cloudSyncEndpoint === cloudSyncEndpointFromEnv &&
    window.location.protocol !== "file:" &&
    host !== "localhost" &&
    host !== "127.0.0.1"
  );
}
function cloudApiUrl(path) {
  const nextPath = path.startsWith("/") ? path : `/${path}`;
  if (!cloudSyncEndpoint) return nextPath;
  if (shouldUseCloudflareSyncProxy()) return `/api/cloudflare-sync?path=${encodeURIComponent(nextPath)}`;
  return `${cloudSyncEndpoint}${nextPath}`;
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
  if (text === "迟到") return "迟到";
  return text;
}
function normalizeCheckinOptions(options) {
  const source = Array.isArray(options) && options.length ? options : defaultData.checkinOptions;
  return Array.from(new Set(source.map(normalizeCheckinStatus).filter(Boolean)));
}
function defaultProductRuleFor(name) {
  if (name === "字幕") return { video: 0, ai: 1 };
  if (["图片", "音频", "动画"].includes(name)) return { video: 0, ai: 0 };
  return { video: 1, ai: 0 };
}
function normalizeProductRules(rules = {}, productRules = {}) {
  const normalized = {};
  Object.keys(rules || {}).forEach((name) => {
    const fallback = defaultProductRuleFor(name);
    const source = productRules?.[name] || {};
    normalized[name] = {
      video: Number(source.video ?? fallback.video ?? 0),
      ai: Number(source.ai ?? fallback.ai ?? 0)
    };
  });
  return normalized;
}
function normalizeTotalConversionRules(rules = {}, totalConversionRules = {}) {
  const normalized = {};
  Object.keys(rules || {}).forEach((name) => {
    const value = Number(totalConversionRules?.[name] || 0);
    normalized[name] = Number.isFinite(value) && value > 0 ? value : 0;
  });
  return normalized;
}
function normalizeMonthlyPlans(plans = {}) {
  const normalized = {};
  Object.entries(plans || {}).forEach(([periodKey, entry]) => {
    if (!periodKey || !entry || typeof entry !== "object") return;
    const members = {};
    Object.entries(entry.members || {}).forEach(([member, plan]) => {
      if (!member || !plan || typeof plan !== "object") return;
      const items = {};
      Object.entries(plan.items || {}).forEach(([name, amount]) => {
        const value = Number(amount || 0);
        if (value) items[name] = value;
      });
      members[member] = {
        quota: plan.quota === "" || plan.quota === undefined || plan.quota === null ? "" : Number(plan.quota || 0),
        items
      };
    });
    normalized[periodKey] = { members };
  });
  return normalized;
}
function mergeMonthlyPlans(basePlans = {}, sourcePlans = {}) {
  const merged = normalizeMonthlyPlans(basePlans);
  const source = normalizeMonthlyPlans(sourcePlans);
  Object.entries(source).forEach(([periodKey, entry]) => {
    if (!merged[periodKey]) merged[periodKey] = { members: {} };
    merged[periodKey].members = { ...(merged[periodKey].members || {}), ...(entry.members || {}) };
  });
  return merged;
}
function defaultFreeTable() {
  return { rows: 20, columns: 8, cells: {}, updated_at: "" };
}
function normalizeFreeTable(table = {}) {
  const fallback = defaultFreeTable();
  const rows = Math.max(1, Math.min(200, Number(table.rows || fallback.rows) || fallback.rows));
  const columns = Math.max(1, Math.min(50, Number(table.columns || fallback.columns) || fallback.columns));
  const cells = {};
  Object.entries(table.cells && typeof table.cells === "object" ? table.cells : {}).forEach(([key, value]) => {
    const match = String(key || "").match(/^(\d+):(\d+)$/);
    if (!match) return;
    const row = Number(match[1]);
    const column = Number(match[2]);
    if (row < 0 || column < 0 || row >= rows || column >= columns) return;
    cells[String(row) + ":" + String(column)] = String(value ?? "").slice(0, 10000);
  });
  return { rows, columns, cells, updated_at: String(table.updated_at || "") };
}
function mergeFreeTable(baseTable = {}, sourceTable = {}) {
  const base = normalizeFreeTable(baseTable);
  const source = normalizeFreeTable(sourceTable);
  const baseTime = Date.parse(base.updated_at || "") || 0;
  const sourceTime = Date.parse(source.updated_at || "") || 0;
  const dimensionSource = sourceTime >= baseTime ? source : base;
  const rows = dimensionSource.rows;
  const columns = dimensionSource.columns;
  const cells = {};
  const putCells = (table) => {
    Object.entries(table.cells || {}).forEach(([key, value]) => {
      const [row, column] = key.split(":").map(Number);
      if (row >= 0 && column >= 0 && row < rows && column < columns) cells[key] = String(value ?? "");
    });
  };
  putCells(base);
  putCells(source);
  return { rows, columns, cells, updated_at: [base.updated_at, source.updated_at].filter(Boolean).sort().pop() || "" };
}
function normalizeFbSpecialties(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: String(item.id || `fb_${Date.now()}_${Math.random().toString(16).slice(2)}`),
    fbUrl: String(item.fbUrl || ""),
    name: String(item.name || ""),
    avatarUrl: String(item.avatarUrl || ""),
    bannerUrl: String(item.bannerUrl || ""),
    tier: String(item.tier || "测试专业"),
    status: String(item.status || "观察"),
    category: String(item.category || "逐个出字"),
    videoOwner: String(item.videoOwner || ""),
    operator: String(item.operator || ""),
    notes: String(item.notes || ""),
    reels: (Array.isArray(item.reels) ? item.reels : []).map((reel) => ({
      id: String(reel.id || `reel_${Date.now()}_${Math.random().toString(16).slice(2)}`),
      url: String(reel.url || ""),
      title: String(reel.title || ""),
      date: String(reel.date || ""),
      views: reel.views === "" || reel.views === undefined || reel.views === null ? "" : Number(reel.views || 0),
      interactions: reel.interactions === "" || reel.interactions === undefined || reel.interactions === null ? "" : Number(reel.interactions || 0),
      result: String(reel.result || "观察"),
      owner: String(reel.owner || ""),
      notes: String(reel.notes || "")
    }))
  }));
}
function mergeFbSpecialties(baseItems = [], sourceItems = []) {
  const map = new Map();
  const put = (item) => {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      return;
    }
    const reels = new Map();
    (existing.reels || []).forEach((reel) => reels.set(reel.id, reel));
    (item.reels || []).forEach((reel) => reels.set(reel.id, { ...(reels.get(reel.id) || {}), ...reel }));
    map.set(item.id, { ...existing, ...item, reels: Array.from(reels.values()) });
  };
  normalizeFbSpecialties(baseItems).forEach(put);
  normalizeFbSpecialties(sourceItems).forEach(put);
  return Array.from(map.values());
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
    next.duty_hours = normalizeDutyHours(next.duty_hours ?? next.dutyHours);
    const nextKey = `${date}|${member}`;
    normalized[nextKey] = normalized[nextKey]
      ? newerRecord(normalized[nextKey], next, "second", rules)
      : next;
  });
  return normalized;
}
function addRecordItemsToRules(records = {}, rules = {}, memberGroups = {}, groups = [], groupItems = {}) {
  // Keep project configuration admin-owned. Old record fields should not recreate removed projects.
}
function normalize(source) {
  const loaded = source || {};
  const members = Array.isArray(loaded.members) && loaded.members.length ? loaded.members.map(String) : ["成员A"];
  const groups = Array.isArray(loaded.groups) && loaded.groups.length ? loaded.groups.map(String) : ["1组"];
  const memberGroups = { ...(loaded.memberGroups || {}) };
  const memberSubgroups = {};
  Object.entries(loaded.memberSubgroups && typeof loaded.memberSubgroups === "object" ? loaded.memberSubgroups : {}).forEach(([member, subgroup]) => {
    const name = String(member || "").trim();
    const value = String(subgroup || "").trim();
    if (name && value) memberSubgroups[name] = value;
  });
  const groupItems = { ...(loaded.groupItems || {}) };
  const memberItems = { ...(loaded.memberItems || {}) };
  members.forEach((name) => {
    if (!memberGroups[name]) memberGroups[name] = groups[0];
  });
  const rules = loaded.rules && typeof loaded.rules === "object" ? clone(loaded.rules) : clone(defaultData.rules);
  const records = normalizeRecordMap(loaded.records || {}, rules);
  addRecordItemsToRules(records, rules, memberGroups, groups, groupItems);
  const productRules = normalizeProductRules(rules, loaded.productRules || defaultData.productRules);
  const totalConversionRules = normalizeTotalConversionRules(rules, loaded.totalConversionRules || defaultData.totalConversionRules);
  groups.forEach((group) => {
    if (!Array.isArray(groupItems[group])) groupItems[group] = Object.keys(rules);
  });
  const memberQuotas = { ...(loaded.memberQuotas || {}) };
  const memberCompleteQuotas = { ...(loaded.memberCompleteQuotas || {}) };
  const memberWorkloadNotes = loaded.memberWorkloadNotes && typeof loaded.memberWorkloadNotes === "object" ? clone(loaded.memberWorkloadNotes) : {};
  const memberWorkloadQuotas = loaded.memberWorkloadQuotas && typeof loaded.memberWorkloadQuotas === "object" ? clone(loaded.memberWorkloadQuotas) : {};
  const dailyWorkloadQuotas = loaded.dailyWorkloadQuotas && typeof loaded.dailyWorkloadQuotas === "object" ? clone(loaded.dailyWorkloadQuotas) : {};
  const dailyQuotas = loaded.dailyQuotas && typeof loaded.dailyQuotas === "object" ? clone(loaded.dailyQuotas) : {};
  const dailyCompleteQuotas = loaded.dailyCompleteQuotas && typeof loaded.dailyCompleteQuotas === "object" ? clone(loaded.dailyCompleteQuotas) : {};
  const monthlyPlans = normalizeMonthlyPlans(loaded.monthlyPlans || {});
  const freeTable = normalizeFreeTable(loaded.freeTable || defaultData.freeTable);
  const fbSpecialties = normalizeFbSpecialties(loaded.fbSpecialties || []);
  const checkinOptions = normalizeCheckinOptions([...(Array.isArray(loaded.checkinOptions) ? loaded.checkinOptions : []), ...defaultData.checkinOptions]);
  const hiddenMembers = loaded.hiddenMembers && typeof loaded.hiddenMembers === "object" ? clone(loaded.hiddenMembers) : {};
  Object.entries(loaded.deletedMembers || {}).forEach(([member, value]) => {
    if (!members.includes(member) && !hiddenMembers[member]) hiddenMembers[member] = value || true;
  });
  return {
    ...clone(defaultData),
    ...loaded,
    version: 2,
    quota: Number(loaded.quota ?? defaultData.quota),
    completeQuota: loaded.completeQuota === "" || loaded.completeQuota === undefined || loaded.completeQuota === null ? "" : Number(loaded.completeQuota || 0),
    workloadQuota: loaded.workloadQuota === "" || loaded.workloadQuota === undefined || loaded.workloadQuota === null ? "" : Number(loaded.workloadQuota || 0),
    rules,
    productRules,
    totalConversionRules,
    members,
    groups,
    memberGroups,
    memberSubgroups,
    groupItems,
    memberItems,
    memberQuotas,
    memberCompleteQuotas,
    memberWorkloadNotes,
    memberWorkloadQuotas,
    dailyWorkloadQuotas,
    dailyQuotas,
    dailyCompleteQuotas,
    monthlyPlans,
    freeTable,
    fbSpecialties,
    checkinOptions,
    timezones: Array.isArray(loaded.timezones) && loaded.timezones.length
      ? loaded.timezones.map((item) => ({
        name: String(item.name || "时间").trim() || "时间",
        offset: String(item.offset || "+08:00").trim() || "+08:00"
      }))
      : clone(defaultData.timezones),
    adminPassword: String(loaded.adminPassword || defaultData.adminPassword),
    sheetBackupEnabled: loaded.sheetBackupEnabled !== false,
    sheetBackupBaseName: String(loaded.sheetBackupBaseName || defaultData.sheetBackupBaseName),
    backupCleanupEnabled: loaded.backupCleanupEnabled === true,
    autoAudit: loaded.autoAudit === true,
    hiddenMembers,
    deletedMembers: loaded.deletedMembers && typeof loaded.deletedMembers === "object" ? clone(loaded.deletedMembers) : {},
    reviewMessages: {
      pass: Array.isArray(loaded.reviewMessages?.pass) ? loaded.reviewMessages.pass : clone(defaultData.reviewMessages.pass),
      fail: Array.isArray(loaded.reviewMessages?.fail) ? loaded.reviewMessages.fail : clone(defaultData.reviewMessages.fail)
    },
    records
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
  mergedSourceDataset = null;
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
function mergeNumberValue(aValue, bValue, aRecord, bRecord, prefer = "first") {
  const left = normalizeDutyHours(aValue);
  const right = normalizeDutyHours(bValue);
  if (left && right) return newerRecordSide(aRecord, bRecord, prefer) === "second" ? right : left;
  return right || left || 0;
}
function normalizeMergedCheckin(value) {
  if (!value) return null;
  const status = normalizeCheckinStatus(typeof value === "string" ? value : value.status || "");
  if (!status) return null;
  const next = typeof value === "object" ? { ...clone(value), status } : { status };
  const updatedAt = String(next.updated_at || next.iso || "").trim();
  if (updatedAt) {
    next.iso = next.iso || updatedAt;
    next.updated_at = next.updated_at || updatedAt;
  }
  return next;
}
function checkinTimestamp(value, record) {
  const source = typeof value === "object" ? (value.iso || value.updated_at || "") : "";
  const time = Date.parse(source);
  return Number.isNaN(time) ? recordTimestamp(record) : time;
}
function checkinSlotValue(checkins = {}, key = "") {
  const normalizedKey = key === "afternoon" ? "noon" : key;
  return checkins?.[normalizedKey] || (normalizedKey === "noon" ? checkins?.afternoon : null);
}
function mergeRecordCheckins(aCheckins = {}, bCheckins = {}, aRecord = {}, bRecord = {}, prefer = "first") {
  const merged = {};
  const keys = new Set(["morning", "noon", "evening", ...Object.keys(aCheckins || {}).map((key) => key === "afternoon" ? "noon" : key), ...Object.keys(bCheckins || {}).map((key) => key === "afternoon" ? "noon" : key)]);
  keys.forEach((key) => {
    if (!["morning", "noon", "evening"].includes(key)) return;
    const left = normalizeMergedCheckin(checkinSlotValue(aCheckins, key));
    const right = normalizeMergedCheckin(checkinSlotValue(bCheckins, key));
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
  const entries = Object.entries(items || {}).filter(([name]) => rules?.[name] !== undefined);
  const raw = entries.reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
  const weighted = entries.reduce((sum, [name, amount]) => {
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
  merged.duty_hours = mergeNumberValue(a.duty_hours ?? a.dutyHours, b.duty_hours ?? b.dutyHours, a, b, prefer);
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
function hiddenMemberMap(report = data) {
  const hidden = { ...(report.hiddenMembers || {}) };
  Object.entries(clearActiveDeletedMembers(report) || {}).forEach(([member, value]) => {
    if (!hidden[member]) hidden[member] = value || true;
  });
  return hidden;
}
function isMemberHidden(member, report = data) {
  return Boolean(member && hiddenMemberMap(report)[member]);
}
function hiddenMemberEntries(report = data) {
  const hidden = hiddenMemberMap(report);
  return Object.keys(hidden).filter(Boolean).sort((a, b) => {
    const ai = (report.members || []).indexOf(a);
    const bi = (report.members || []).indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return String(a).localeCompare(String(b), "zh-CN");
  }).map((member) => ({ member, hiddenAt: hidden[member] }));
}
function visibleConfiguredMembers(report = data) {
  const hidden = hiddenMemberMap(report);
  return (report.members || []).filter((member) => member && !hidden[member]);
}
function firstVisibleMember(report = data) {
  return visibleConfiguredMembers(report)[0] || (report.members || [])[0] || "成员A";
}
function ensureCurrentMemberVisible() {
  const visible = visibleConfiguredMembers(data);
  if (!visible.includes(currentMember)) currentMember = visible[0] || data.members[0] || currentMember || "成员A";
}
function mergeCloudData(remoteSource, localSource, mode = "records") {
  if (!remoteSource) return normalize(localSource);
  const remote = normalize(remoteSource);
  const local = normalize(localSource);
  const merged = mode === "admin" ? { ...remote, ...local } : { ...local, ...remote };
  const recordKeys = new Set([...Object.keys(remote.records || {}), ...Object.keys(local.records || {})]);
  if (mode === "admin") {
    merged.rules = clone(local.rules);
    merged.productRules = normalizeProductRules(local.rules, local.productRules || {});
    merged.totalConversionRules = normalizeTotalConversionRules(local.rules, local.totalConversionRules || {});
    merged.members = clone(local.members);
    merged.groups = clone(local.groups || []);
    merged.memberGroups = clone(local.memberGroups || {});
    merged.memberSubgroups = clone(local.memberSubgroups || {});
    merged.groupItems = clone(local.groupItems || {});
    merged.memberItems = clone(local.memberItems || {});
    merged.memberQuotas = clone(local.memberQuotas || {});
    merged.memberCompleteQuotas = clone(local.memberCompleteQuotas || {});
    merged.memberWorkloadNotes = clone(local.memberWorkloadNotes || {});
    merged.workloadQuota = local.workloadQuota === "" || local.workloadQuota === undefined || local.workloadQuota === null ? "" : Number(local.workloadQuota || 0);
    merged.memberWorkloadQuotas = clone(local.memberWorkloadQuotas || {});
    merged.dailyWorkloadQuotas = mergeDailyQuotas(remote.dailyWorkloadQuotas, local.dailyWorkloadQuotas, mode);
    merged.dailyQuotas = mergeDailyQuotas(remote.dailyQuotas, local.dailyQuotas, mode);
    merged.dailyCompleteQuotas = mergeDailyQuotas(remote.dailyCompleteQuotas, local.dailyCompleteQuotas, mode);
    merged.monthlyPlans = mergeMonthlyPlans(remote.monthlyPlans, local.monthlyPlans);
    merged.freeTable = mergeFreeTable(remote.freeTable, local.freeTable);
    merged.fbSpecialties = mergeFbSpecialties(remote.fbSpecialties, local.fbSpecialties);
    merged.checkinOptions = clone(local.checkinOptions || defaultData.checkinOptions);
    merged.quota = Number(local.quota || 0);
    merged.completeQuota = local.completeQuota === "" || local.completeQuota === undefined || local.completeQuota === null ? "" : Number(local.completeQuota || 0);
    merged.adminPassword = String(local.adminPassword || "");
    merged.sheetBackupEnabled = local.sheetBackupEnabled !== false;
    merged.sheetBackupBaseName = safeBackupBaseName(local.sheetBackupBaseName || defaultData.sheetBackupBaseName);
    merged.backupCleanupEnabled = local.backupCleanupEnabled === true;
    merged.autoAudit = local.autoAudit === true;
    merged.hiddenMembers = clone(local.hiddenMembers || {});
    merged.deletedMembers = clone(local.deletedMembers || {});
    merged.reviewMessages = clone(local.reviewMessages || defaultData.reviewMessages);
  } else {
    merged.rules = clone(remote.rules || local.rules);
    merged.productRules = normalizeProductRules(merged.rules, remote.productRules || local.productRules || {});
    merged.totalConversionRules = normalizeTotalConversionRules(merged.rules, remote.totalConversionRules || local.totalConversionRules || {});
    merged.members = clone(remote.members || local.members);
    merged.groups = clone(remote.groups || local.groups || ["1组"]);
    merged.memberGroups = clone(remote.memberGroups || local.memberGroups || {});
    merged.memberSubgroups = clone(remote.memberSubgroups || local.memberSubgroups || {});
    merged.groupItems = clone(remote.groupItems || local.groupItems || {});
    merged.memberItems = clone(remote.memberItems || local.memberItems || {});
    merged.memberQuotas = clone(remote.memberQuotas || local.memberQuotas || {});
    merged.memberCompleteQuotas = clone(remote.memberCompleteQuotas || local.memberCompleteQuotas || {});
    merged.memberWorkloadNotes = clone(remote.memberWorkloadNotes || local.memberWorkloadNotes || {});
    merged.workloadQuota = remote.workloadQuota === "" || remote.workloadQuota === undefined || remote.workloadQuota === null ? (local.workloadQuota ?? "") : Number(remote.workloadQuota || 0);
    merged.memberWorkloadQuotas = clone(remote.memberWorkloadQuotas || local.memberWorkloadQuotas || {});
    merged.dailyWorkloadQuotas = mergeDailyQuotas(remote.dailyWorkloadQuotas, local.dailyWorkloadQuotas, mode);
    merged.dailyQuotas = mergeDailyQuotas(remote.dailyQuotas, local.dailyQuotas, mode);
    merged.dailyCompleteQuotas = mergeDailyQuotas(remote.dailyCompleteQuotas, local.dailyCompleteQuotas, mode);
    merged.monthlyPlans = mergeMonthlyPlans(local.monthlyPlans, remote.monthlyPlans);
    merged.freeTable = mergeFreeTable(remote.freeTable, local.freeTable);
    merged.fbSpecialties = mergeFbSpecialties(local.fbSpecialties, remote.fbSpecialties);
    merged.checkinOptions = clone(remote.checkinOptions || local.checkinOptions || defaultData.checkinOptions);
    merged.quota = Number(remote.quota ?? local.quota ?? 0);
    merged.completeQuota = remote.completeQuota === "" || remote.completeQuota === undefined || remote.completeQuota === null ? (local.completeQuota ?? "") : Number(remote.completeQuota || 0);
    merged.adminPassword = String(remote.adminPassword || local.adminPassword || "");
    merged.sheetBackupEnabled = remote.sheetBackupEnabled !== false;
    merged.sheetBackupBaseName = safeBackupBaseName(remote.sheetBackupBaseName || local.sheetBackupBaseName || defaultData.sheetBackupBaseName);
    merged.backupCleanupEnabled = remote.backupCleanupEnabled === true;
    merged.autoAudit = remote.autoAudit === true;
    merged.hiddenMembers = { ...(local.hiddenMembers || {}), ...(remote.hiddenMembers || {}) };
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
    productRules: normalizeProductRules({ ...base.rules, ...source.rules }, { ...base.productRules, ...source.productRules }),
    totalConversionRules: normalizeTotalConversionRules({ ...base.rules, ...source.rules }, { ...base.totalConversionRules, ...source.totalConversionRules }),
    members: Array.from(new Set([...base.members, ...source.members])),
    groups: Array.from(new Set([...base.groups, ...source.groups])),
    memberGroups: { ...base.memberGroups, ...source.memberGroups },
    memberSubgroups: { ...base.memberSubgroups, ...source.memberSubgroups },
    groupItems: { ...base.groupItems, ...source.groupItems },
    memberItems: { ...base.memberItems, ...source.memberItems },
    memberQuotas: { ...base.memberQuotas, ...source.memberQuotas },
    completeQuota: quotaValue(source.completeQuota) === null ? base.completeQuota : source.completeQuota,
    memberCompleteQuotas: { ...base.memberCompleteQuotas, ...source.memberCompleteQuotas },
    memberWorkloadNotes: { ...base.memberWorkloadNotes, ...source.memberWorkloadNotes },
    workloadQuota: quotaValue(source.workloadQuota) === null ? base.workloadQuota : source.workloadQuota,
    memberWorkloadQuotas: { ...base.memberWorkloadQuotas, ...source.memberWorkloadQuotas },
    dailyWorkloadQuotas: mergeDailyQuotas(base.dailyWorkloadQuotas, source.dailyWorkloadQuotas, "records"),
    hiddenMembers: { ...base.hiddenMembers, ...source.hiddenMembers },
    dailyQuotas: mergeDailyQuotas(base.dailyQuotas, source.dailyQuotas, "records"),
    dailyCompleteQuotas: mergeDailyQuotas(base.dailyCompleteQuotas, source.dailyCompleteQuotas, "records"),
    monthlyPlans: mergeMonthlyPlans(base.monthlyPlans, source.monthlyPlans),
    freeTable: mergeFreeTable(base.freeTable, source.freeTable),
    fbSpecialties: mergeFbSpecialties(base.fbSpecialties, source.fbSpecialties),
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
    productRules: normalizeProductRules({ ...source.rules, ...base.rules }, { ...source.productRules, ...base.productRules }),
    totalConversionRules: normalizeTotalConversionRules({ ...source.rules, ...base.rules }, { ...source.totalConversionRules, ...base.totalConversionRules }),
    members: Array.from(new Set([...base.members, ...source.members])),
    groups: Array.from(new Set([...base.groups, ...source.groups])),
    memberGroups: { ...source.memberGroups, ...base.memberGroups },
    memberSubgroups: { ...source.memberSubgroups, ...base.memberSubgroups },
    groupItems: { ...source.groupItems, ...base.groupItems },
    memberItems: { ...source.memberItems, ...base.memberItems },
    memberQuotas: { ...source.memberQuotas, ...base.memberQuotas },
    completeQuota: quotaValue(base.completeQuota) === null ? source.completeQuota : base.completeQuota,
    memberCompleteQuotas: { ...source.memberCompleteQuotas, ...base.memberCompleteQuotas },
    memberWorkloadNotes: { ...source.memberWorkloadNotes, ...base.memberWorkloadNotes },
    workloadQuota: quotaValue(base.workloadQuota) === null ? source.workloadQuota : base.workloadQuota,
    memberWorkloadQuotas: { ...source.memberWorkloadQuotas, ...base.memberWorkloadQuotas },
    dailyWorkloadQuotas: mergeDailyQuotas(source.dailyWorkloadQuotas, base.dailyWorkloadQuotas, "records"),
    hiddenMembers: { ...source.hiddenMembers, ...base.hiddenMembers },
    dailyQuotas: mergeDailyQuotas(source.dailyQuotas, base.dailyQuotas, "records"),
    dailyCompleteQuotas: mergeDailyQuotas(source.dailyCompleteQuotas, base.dailyCompleteQuotas, "records"),
    monthlyPlans: mergeMonthlyPlans(source.monthlyPlans, base.monthlyPlans),
    freeTable: mergeFreeTable(source.freeTable, base.freeTable),
    fbSpecialties: mergeFbSpecialties(source.fbSpecialties, base.fbSpecialties),
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
  empty.memberSubgroups = {};
  empty.groupItems = {};
  empty.memberItems = {};
  empty.memberQuotas = {};
  empty.completeQuota = "";
  empty.memberCompleteQuotas = {};
  empty.memberWorkloadNotes = {};
  empty.workloadQuota = "";
  empty.memberWorkloadQuotas = {};
  empty.dailyWorkloadQuotas = {};
  empty.dailyQuotas = {};
  empty.dailyCompleteQuotas = {};
  empty.monthlyPlans = {};
  empty.freeTable = defaultFreeTable();
  empty.fbSpecialties = [];
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
    if (source.memberSubgroups?.[member]) scoped.memberSubgroups[nextMember] = source.memberSubgroups[member];
    if (source.memberItems?.[member]) scoped.memberItems[nextMember] = clone(source.memberItems[member]);
    if (source.memberQuotas?.[member] !== undefined) scoped.memberQuotas[nextMember] = source.memberQuotas[member];
    if (source.memberCompleteQuotas?.[member] !== undefined) scoped.memberCompleteQuotas[nextMember] = source.memberCompleteQuotas[member];
    if (source.memberWorkloadNotes?.[member] !== undefined) scoped.memberWorkloadNotes[nextMember] = source.memberWorkloadNotes[member];
    if (source.memberWorkloadQuotas?.[member] !== undefined) scoped.memberWorkloadQuotas[nextMember] = source.memberWorkloadQuotas[member];
  });
  Object.entries(source.dailyQuotas || {}).forEach(([day, entry]) => {
    scoped.dailyQuotas[day] = { default: entry.default ?? "", members: {} };
    Object.entries(entry.members || {}).forEach(([member, quota]) => {
      if (memberMap[member]) scoped.dailyQuotas[day].members[memberMap[member]] = quota;
    });
  });
  Object.entries(source.dailyCompleteQuotas || {}).forEach(([day, entry]) => {
    scoped.dailyCompleteQuotas[day] = { default: entry.default ?? "", members: {} };
    Object.entries(entry.members || {}).forEach(([member, quota]) => {
      if (memberMap[member]) scoped.dailyCompleteQuotas[day].members[memberMap[member]] = quota;
    });
  });
  Object.entries(source.dailyWorkloadQuotas || {}).forEach(([day, entry]) => {
    scoped.dailyWorkloadQuotas[day] = { default: entry.default ?? "", members: {} };
    Object.entries(entry.members || {}).forEach(([member, quota]) => {
      if (memberMap[member]) scoped.dailyWorkloadQuotas[day].members[memberMap[member]] = quota;
    });
  });
  Object.entries(source.monthlyPlans || {}).forEach(([periodKey, entry]) => {
    scoped.monthlyPlans[periodKey] = { members: {} };
    Object.entries(entry.members || {}).forEach(([member, plan]) => {
      if (memberMap[member]) scoped.monthlyPlans[periodKey].members[memberMap[member]] = clone(plan);
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
async function restoreSheetBackupDirectory() {
  const dir = await loadDirectoryHandle("sheetBackupDirectory");
  sheetBackupDirHandle = dir || null;
  sheetBackupLocationLabel = sheetBackupDirHandle?.name || "";
  renderSheetBackupStatus();
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
  ensureCurrentMemberVisible();
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
    ensureCurrentMemberVisible();
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
  await restoreSheetBackupDirectory();
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
  if (activeReportSource === "all") return buildMergedSourceDataset();
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
  await ensureCloudSyncConfig();
  if (!cloudDatabaseAvailable()) throw new Error("请通过 Vercel、本地开发服务器打开网页，或填写 Cloudflare Worker 备用云同步地址。");
  const syncToken = String(token || appSessionPassword || "").trim();
  if (!syncToken) throw new Error("请先输入应用密码。");
  const response = await fetch(cloudApiUrl("/api/cloud-data"), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Team-Token": syncToken
    },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
    const error = new Error(`${cloudSyncProviderLabel()}\u8fd4\u56de\u4e86\u975e JSON \u54cd\u5e94\uff1a${response.status}${snippet ? `\uff1a${snippet}` : ""}`);
    error.status = response.status;
    error.payload = { raw: text.slice(0, 1000) };
    throw error;
  }
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || `${cloudSyncProviderLabel()}同步失败：${response.status}`);
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}
async function verifyAppPassword(password) {
  await ensureCloudSyncConfig();
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
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: candidate })
    });
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      const message = `${cloudSyncProviderLabel()}登录接口返回了非 JSON 响应：${response.status}`;
      if (cloudSyncEndpoint) setCloudDbStatus(message);
      return { ok: false, error: message };
    }
    if (response.ok && result.ok) return { ok: true, source: cloudSyncEndpoint ? "worker-env" : "vercel-env" };
    if (response.status !== 404) {
      const message = result.error || (cloudSyncEndpoint ? `Cloudflare Worker 登录失败：${response.status}` : "密码不正确");
      if (cloudSyncEndpoint) setCloudDbStatus(message);
      return { ok: false, error: message };
    }
  } catch (error) {
    if (cloudSyncEndpoint) {
      const message = `Cloudflare Worker 不可用：${error.message || "网络连接失败"}`;
      setCloudDbStatus(message);
      return { ok: false, error: message };
    }
    // Older deployments may not have the standalone auth endpoint yet; cloud data auth is the fallback.
  }
  const cloudResult = await pullCloudDatabaseData({ silent: true, token: candidate, beforeUnlock: true });
  if (cloudResult.pulled || cloudResult.reason === "empty-cloud") return { ok: true, source: "cloud-data" };
  return { ok: false, error: "密码不正确" };
}
async function refreshCloudDatabaseStatus(silent = false) {
  await ensureCloudSyncConfig();
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
  await ensureCloudSyncConfig();
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
      ensureCurrentMemberVisible();
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
  await ensureCloudSyncConfig();
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
    const payloadData = compactCloudSyncData(mode);
    const result = await callCloudData("save", { data: payloadData, mode, actor: currentMember }, appSessionPassword);
    if (result.data) {
      data = mergeCloudData(result.data, data, "records");
      persistLocal();
    }
    clearCloudDbQuotaPause();
    cloudDbLastSeenSha = result.meta?.data_sha256 || cloudDbLastSeenSha;
    if (mode === "records") pendingCloudRecordKeys.clear();
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
  await ensureCloudSyncConfig();
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
  ensureCurrentMemberVisible();
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
  currentMember = firstVisibleMember(data);
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
function dailyCompleteQuotaEntry(day = currentDate) {
  if (!data.dailyCompleteQuotas || typeof data.dailyCompleteQuotas !== "object") data.dailyCompleteQuotas = {};
  if (!data.dailyCompleteQuotas[day]) data.dailyCompleteQuotas[day] = { default: "", members: {} };
  if (!data.dailyCompleteQuotas[day].members) data.dailyCompleteQuotas[day].members = {};
  return data.dailyCompleteQuotas[day];
}
function dailyWorkloadQuotaEntry(day = currentDate) {
  if (!data.dailyWorkloadQuotas || typeof data.dailyWorkloadQuotas !== "object") data.dailyWorkloadQuotas = {};
  if (!data.dailyWorkloadQuotas[day]) data.dailyWorkloadQuotas[day] = { default: "", members: {} };
  if (!data.dailyWorkloadQuotas[day].members) data.dailyWorkloadQuotas[day].members = {};
  return data.dailyWorkloadQuotas[day];
}
function quotaValue(value) {
  if (value === "" || value === undefined || value === null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}
function memberQuota(member, day = currentDate) {
  const report = reportData();
  const daily = report.dailyQuotas?.[day];
  const dailyOwn = quotaValue(daily?.members?.[member]);
  if (dailyOwn !== null) return dailyOwn;
  const dailyDefault = quotaValue(daily?.default);
  if (dailyDefault !== null) return dailyDefault;
  const own = quotaValue(report.memberQuotas?.[member]);
  const fallback = quotaValue(report.quota);
  return own === null ? (fallback ?? 0) : own;
}
function memberCompleteQuota(member, day = currentDate) {
  const passQuota = memberQuota(member, day);
  const report = reportData();
  const daily = report.dailyCompleteQuotas?.[day];
  const dailyOwn = quotaValue(daily?.members?.[member]);
  if (dailyOwn !== null) return Math.max(passQuota, dailyOwn);
  const dailyDefault = quotaValue(daily?.default);
  if (dailyDefault !== null) return Math.max(passQuota, dailyDefault);
  const own = quotaValue(report.memberCompleteQuotas?.[member]);
  if (own !== null) return Math.max(passQuota, own);
  const fallback = quotaValue(report.completeQuota);
  return fallback === null ? passQuota : Math.max(passQuota, fallback);
}
function memberWorkloadQuota(member, day = currentDate) {
  const report = reportData();
  const daily = report.dailyWorkloadQuotas?.[day];
  const dailyOwn = quotaValue(daily?.members?.[member]);
  if (dailyOwn !== null) return dailyOwn;
  const dailyDefault = quotaValue(daily?.default);
  if (dailyDefault !== null) return dailyDefault;
  const own = quotaValue(report.memberWorkloadQuotas?.[member]);
  const fallback = quotaValue(report.workloadQuota);
  return own === null ? (fallback ?? 0) : own;
}
function workloadQuotaStatus(weighted, quota) {
  const target = Number(quota || 0);
  if (target <= 0) return "未设置";
  return Number(weighted || 0) >= target ? "饱和" : "不足";
}
function workloadQuotaClass(status) {
  if (status === "饱和") return "pass";
  if (status === "不足") return "fail";
  return "pending";
}
function workloadQuotaText(weighted, quota) {
  const target = Number(quota || 0);
  if (target <= 0) return "未设置";
  const diff = cleanTotalValue(Number(weighted || 0) - target);
  return `${workloadQuotaStatus(weighted, target)} ${signedTotalText(diff)}`;
}
function quotaTier(member, day = currentDate) {
  const quota = memberQuota(member, day);
  const completeQuota = memberCompleteQuota(member, day);
  return { quota, completeQuota };
}
function quotaStatusFromTotals(productTotal, quota, completeQuota = quota) {
  const total = Number(productTotal || 0);
  const pass = Number(quota || 0);
  const complete = Math.max(pass, Number(completeQuota || 0));
  if (pass <= 0 && complete <= 0) return "完全达标";
  if (complete > 0 && total >= complete) return "完全达标";
  if (pass > 0 && total >= pass) return "达标";
  if (pass <= 0 && total > 0) return "完全达标";
  return "不达标";
}
function quotaStatusFor(member, day, productTotal) {
  const tier = quotaTier(member, day);
  return quotaStatusFromTotals(productTotal, tier.quota, tier.completeQuota);
}
function quotaStatusClass(status) {
  if (status === "完全达标") return "complete";
  if (status === "达标") return "pass";
  if (status === "不达标" || status === "未达标" || status === "未达") return "fail";
  return "pending";
}
function quotaStatusShort(status) {
  if (status === "完全达标") return "完全";
  if (status === "达标") return "达标";
  if (status === "不达标" || status === "未达标") return "未达";
  return "待审";
}
function setDailyDefaultQuota(day, value) {
  const entry = dailyQuotaEntry(day);
  entry.default = value === "" ? "" : Number(value || 0);
}
function setDailyDefaultCompleteQuota(day, value) {
  const entry = dailyCompleteQuotaEntry(day);
  entry.default = value === "" ? "" : Number(value || 0);
}
function setDailyMemberQuota(member, day, value) {
  const entry = dailyQuotaEntry(day);
  if (value === "") delete entry.members[member];
  else entry.members[member] = Number(value || 0);
}
function setDailyMemberCompleteQuota(member, day, value) {
  const entry = dailyCompleteQuotaEntry(day);
  if (value === "") delete entry.members[member];
  else entry.members[member] = Number(value || 0);
}
function setDailyDefaultWorkloadQuota(day, value) {
  const entry = dailyWorkloadQuotaEntry(day);
  entry.default = value === "" ? "" : Number(value || 0);
}
function setDailyMemberWorkloadQuota(member, day, value) {
  const entry = dailyWorkloadQuotaEntry(day);
  if (value === "") delete entry.members[member];
  else entry.members[member] = Number(value || 0);
}
function dailyMemberQuotaValue(member, day = currentDate) {
  const value = data.dailyQuotas?.[day]?.members?.[member];
  return value === undefined || value === null ? "" : Number(value);
}
function dailyMemberCompleteQuotaValue(member, day = currentDate) {
  const value = data.dailyCompleteQuotas?.[day]?.members?.[member];
  return value === undefined || value === null ? "" : Number(value);
}
function dailyMemberWorkloadQuotaValue(member, day = currentDate) {
  const value = data.dailyWorkloadQuotas?.[day]?.members?.[member];
  return value === undefined || value === null ? "" : Number(value);
}
function groupMembers(group) {
  const report = reportData();
  return reportMembers(report).filter((member) => (report.memberGroups?.[member] || report.groups[0]) === group);
}
function reportMembers(report = reportData()) {
  const members = new Set((report.members || []).filter((member) => !isMemberHidden(member, report)));
  const hidden = hiddenMemberMap(report);
  Object.values(report.records || {}).forEach((record) => {
    if (!record?.member || hidden[record.member]) return;
    members.add(record.member);
  });
  Object.keys(hidden || {}).forEach((member) => members.delete(member));
  return Array.from(members).sort((a, b) => {
    const ai = (report.members || []).indexOf(a);
    const bi = (report.members || []).indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return String(a).localeCompare(String(b), "zh-CN");
  });
}
function memberSubgroup(member, report = reportData()) {
  const subgroup = String(report.memberSubgroups?.[member] || "").trim();
  return subgroup || "未分队";
}
function subgroupSortValue(name) {
  return name === "未分队" ? "~~~~" : String(name || "");
}
function groupRowsBySubgroup(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const name = String(row.subgroup || "未分队").trim() || "未分队";
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  });
  return Array.from(map, ([name, subgroupRows]) => ({ name, rows: subgroupRows })).sort((a, b) => {
    const diff = subgroupSortValue(a.name).localeCompare(subgroupSortValue(b.name), "zh-CN");
    return diff || a.name.localeCompare(b.name, "zh-CN");
  });
}
function summarizeOverviewRows(rows = []) {
  const productTotal = rows.reduce((sum, row) => sum + Number(row.productTotal || 0), 0);
  const quota = rows.reduce((sum, row) => sum + Number(row.quota || 0), 0);
  const completeQuota = rows.reduce((sum, row) => sum + Number(row.completeQuota || row.quota || 0), 0);
  const weighted = rows.reduce((sum, row) => sum + Number(row.weighted || 0), 0);
  const workloadQuota = rows.reduce((sum, row) => sum + Number(row.workloadQuota || 0), 0);
  return {
    raw: rows.reduce((sum, row) => sum + Number(row.raw || 0), 0),
    weighted,
    productTotal,
    quota,
    completeQuota,
    workloadQuota,
    workloadDiff: weighted - workloadQuota,
    workloadStatus: workloadQuotaStatus(weighted, workloadQuota),
    dutyHours: rows.reduce((sum, row) => sum + Number(row.dutyHours || 0), 0),
    video: rows.reduce((sum, row) => sum + Number(row.video || 0), 0),
    ai: rows.reduce((sum, row) => sum + Number(row.ai || 0), 0),
    diff: productTotal - quota,
    completeDiff: productTotal - completeQuota,
    status: quotaStatusFromTotals(productTotal, quota, completeQuota)
  };
}
function overviewSubgroupBriefLines(rows = []) {
  const groups = groupRowsBySubgroup(rows);
  if (!groups.length) return ["   暂无二级小组数据。"];
  return groups.map(({ name, rows: subgroupRows }) => {
    const summary = summarizeOverviewRows(subgroupRows);
    return `   ${name}：${summary.status}｜${subgroupRows.length}人｜一级定额 ${fmt(summary.quota)}｜完全定额 ${fmt(summary.completeQuota)}｜成品量 ${fmt(summary.productTotal)}｜一级差额 ${signedTotalText(summary.diff)}｜完全差额 ${signedTotalText(summary.completeDiff)}｜换算工作量 ${fmt(summary.weighted)}｜工作量定额 ${fmt(summary.workloadQuota)}｜工作量差额 ${signedTotalText(summary.workloadDiff)}｜尽本分 ${fmtDutyHours(summary.dutyHours)}`;
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
function cutoffPeriodRange(dayKey, endDay, startDay = endDay + 1) {
  const monthKey = monthKeyFromDateKey(dayKey);
  const day = Number(String(dayKey || "").slice(8, 10)) || 1;
  const endMonth = day <= endDay ? monthKey : shiftMonthKey(monthKey, 1);
  return cutoffPeriodRangeForMonth(endMonth, startDay, endDay);
}
function cutoffPeriodRangeForMonth(endMonth, startDay, endDay) {
  return {
    start: dateKeyForMonthDay(shiftMonthKey(endMonth, -1), startDay),
    end: dateKeyForMonthDay(endMonth, endDay)
  };
}
function cutoffEndMonthFor(dayKey, cutoffDay) {
  const monthKey = monthKeyFromDateKey(dayKey);
  const day = Number(String(dayKey || "").slice(8, 10)) || 1;
  return day <= cutoffDay ? monthKey : shiftMonthKey(monthKey, 1);
}
function mixedRangeInfo(dayKey = currentDate) {
  const monthKey = monthKeyFromDateKey(dayKey);
  if (mixedTableRangeMode === "small-month") return { label: "小月度汇总", endMonth: monthKey, ...mixedPeriodRangeForMonth(monthKey, "small-month") };
  if (mixedTableRangeMode === "month") return { label: "月度汇总", endMonth: monthKey, ...mixedPeriodRangeForMonth(monthKey, "month") };
  if (mixedTableRangeMode === "custom") return { label: "自定义", start: $("mixedTableStart")?.value || dayKey, end: $("mixedTableEnd")?.value || dayKey };
  return { label: "本周", ...weekRangeFor(dayKey) };
}
function overviewRangeInfo() {
  if (overviewRangeMode === "day") return { label: "今日", start: currentDate, end: currentDate };
  if (overviewRangeMode === "small-month") return { label: "小月度汇总", ...cutoffPeriodRange(currentDate, 14) };
  if (overviewRangeMode === "month") return { label: "月度汇总", ...cutoffPeriodRange(currentDate, 22, 23) };
  return { label: "本周", ...weekRangeFor(currentDate) };
}
function rangeText(range) {
  return range.start === range.end ? range.start : `${range.start} 至 ${range.end}`;
}
function applyMixedTableDefaultRange() {
  const startInput = $("mixedTableStart");
  const endInput = $("mixedTableEnd");
  if (!startInput || !endInput) return;
  if (mixedTableRangeMode === "custom" && startInput.value && endInput.value) return;
  if (mixedTableRangeMode === "small-month" || mixedTableRangeMode === "month") {
    const months = selectedMixedExportMonths(reportData());
    const ranges = months.map((month) => mixedPeriodRangeForMonth(month, mixedTableRangeMode));
    if (ranges.length) {
      startInput.value = ranges[ranges.length - 1].start;
      endInput.value = ranges[0].end;
      if ($("mixedTableRangeMode")) $("mixedTableRangeMode").value = mixedTableRangeMode;
      return;
    }
  }
  const range = mixedRangeInfo(currentDate);
  startInput.value = range.start;
  endInput.value = range.end;
  if ($("mixedTableRangeMode")) $("mixedTableRangeMode").value = mixedTableRangeMode;
}
function mixedExportMonthLabel(monthKey) {
  const month = Number(String(monthKey || "").slice(5, 7)) || "";
  return `${month}月份`;
}
function mixedExportYearMonths(year = mixedExportYear) {
  const safeYear = Number(year) || Number(monthKeyFromDateKey(currentDate).slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => `${safeYear}-${String(index + 1).padStart(2, "0")}`).reverse();
}
function periodMonthForDay(dayKey, mode = mixedTableRangeMode) {
  if (mode === "small-month") return cutoffEndMonthFor(dayKey, 14);
  if (mode === "month") return cutoffEndMonthFor(dayKey, 22);
  return monthKeyFromDateKey(dayKey);
}
function mixedPeriodRangeForMonth(monthKey, mode = mixedTableRangeMode) {
  if (mode === "small-month") return { label: `${mixedExportMonthLabel(monthKey)}小月度汇总`, ...cutoffPeriodRangeForMonth(monthKey, 15, 14) };
  if (mode === "month") return { label: `${mixedExportMonthLabel(monthKey)}月度汇总`, ...cutoffPeriodRangeForMonth(monthKey, 23, 22) };
  return { label: `${mixedExportMonthLabel(monthKey)}自然月`, start: `${monthKey}-01`, end: dateKeyForMonthDay(monthKey, daysInMonth(monthKey)) };
}
function availableMixedExportMonths(report, mode = mixedTableRangeMode) {
  return mixedExportYearMonths(mixedExportYear);
}
function selectedMixedExportMonths(report) {
  if (mixedTableRangeMode !== "small-month" && mixedTableRangeMode !== "month") return [];
  const available = availableMixedExportMonths(report, mixedTableRangeMode);
  if (!mixedExportMonths.length) mixedExportMonths = [monthKeyFromDateKey(currentDate)];
  const selected = mixedExportMonths.filter((month) => available.includes(month));
  if (selected.length) return selected.sort().reverse();
  return [available.includes(monthKeyFromDateKey(currentDate)) ? monthKeyFromDateKey(currentDate) : available[0]].filter(Boolean);
}
function syncMixedDateInputsToSelectedMonths(report) {
  if (mixedTableRangeMode !== "small-month" && mixedTableRangeMode !== "month") return;
  const months = selectedMixedExportMonths(report);
  const ranges = months.map((month) => mixedPeriodRangeForMonth(month, mixedTableRangeMode));
  if (!ranges.length) return;
  const start = ranges[ranges.length - 1].start;
  const end = ranges[0].end;
  if ($("mixedTableStart")) $("mixedTableStart").value = start;
  if ($("mixedTableEnd")) $("mixedTableEnd").value = end;
}
function renderMixedExportMonths(report) {
  const box = $("mixedExportMonths");
  if (!box) return;
  if (mixedTableRangeMode !== "small-month" && mixedTableRangeMode !== "month") {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  const available = availableMixedExportMonths(report, mixedTableRangeMode);
  const selected = new Set(selectedMixedExportMonths(report));
  box.innerHTML = `
    <label class="mixed-month-option mixed-year-option">
      <span>年份</span>
      <input id="mixedExportYearInput" type="number" min="2000" max="2100" step="1" value="${Number(mixedExportYear) || Number(monthKeyFromDateKey(currentDate).slice(0, 4))}">
    </label>
    ${available.map((month) => `
    <label class="mixed-month-option">
      <input type="checkbox" value="${escapeAttr(month)}" ${selected.has(month) ? "checked" : ""}>
      <span>${escapeHtml(mixedExportMonthLabel(month))}</span>
    </label>
  `).join("")}`;
  $("mixedExportYearInput").onchange = () => {
    mixedExportYear = Number($("mixedExportYearInput").value || mixedExportYear);
    mixedExportMonths = [`${mixedExportYear}-${String(Number(monthKeyFromDateKey(currentDate).slice(5, 7)) || 1).padStart(2, "0")}`];
    syncMixedDateInputsToSelectedMonths(report);
    renderMixedExportMonths(report);
    renderMixedOverviewTable();
  };
  box.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.onchange = () => {
      mixedExportMonths = Array.from(box.querySelectorAll("input[type='checkbox']:checked")).map((item) => item.value).sort().reverse();
      syncMixedDateInputsToSelectedMonths(report);
      renderMixedOverviewTable();
    };
  });
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
      workload_quota_total: memberWorkloadQuota(member, day),
      duty_hours: 0,
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
  rec.workload_quota_total = memberWorkloadQuota(rec.member, rec.date);
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
    let workloadQuota = 0;
    let dutyHours = 0;
    let totalConversion = 0;
    let video = 0;
    let ai = 0;
    members.forEach((name) => {
      const rec = recordFor(day, name);
      const memberItems = rec?.items || {};
      const totals = totalsForItems(memberItems, itemNames, report);
      const products = productTotalsForItems(memberItems, itemNames, report);
      const conversions = totalConversionForItems(memberItems, itemNames, report);
      weighted += totals.weighted;
      totalConversion += conversions.total;
      raw += totals.raw;
      video += products.video;
      ai += products.ai;
      quota += memberQuota(name, day);
      workloadQuota += memberWorkloadQuota(name, day);
      dutyHours += dutyHoursValue(rec);
      itemNames.forEach((item) => {
        itemTotals[item] += Number(memberItems[item] || 0);
      });
    });
    const productTotal = productTotalValue({ video, ai });
    return { day, raw, weighted, totalConversion, quota, workloadQuota, workloadDiff: weighted - workloadQuota, dutyHours, video, ai, productTotal, diff: productTotal - quota };
  });
  const weighted = daily.reduce((sum, row) => sum + row.weighted, 0);
  const totalConversion = daily.reduce((sum, row) => sum + Number(row.totalConversion || 0), 0);
  const totalConversionCapacityDays = days.length * Math.max(members.length, 1);
  const quota = daily.reduce((sum, row) => sum + row.quota, 0);
  const workloadQuota = daily.reduce((sum, row) => sum + Number(row.workloadQuota || 0), 0);
  const raw = daily.reduce((sum, row) => sum + row.raw, 0);
  const dutyHours = daily.reduce((sum, row) => sum + Number(row.dutyHours || 0), 0);
  const video = daily.reduce((sum, row) => sum + Number(row.video || 0), 0);
  const ai = daily.reduce((sum, row) => sum + Number(row.ai || 0), 0);
  const productTotal = productTotalValue({ video, ai });
  return { daily, raw, weighted, totalConversion, totalConversionCapacityDays, totalConversionSaturation: totalConversionSaturation(totalConversion, totalConversionCapacityDays), totalConversionStatus: totalConversionStatus(totalConversion, totalConversionCapacityDays), quota, workloadQuota, workloadDiff: weighted - workloadQuota, dutyHours, video, ai, productTotal, diff: productTotal - quota, itemTotals };
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
function orderedItemNames(names, report = reportData()) {
  const selected = new Set(Array.from(names || []).filter(Boolean));
  const configured = Object.keys(report.rules || {});
  return [
    ...configured.filter((name) => selected.has(name)),
    ...Array.from(selected).filter((name) => !configured.includes(name)).sort((a, b) => String(a).localeCompare(String(b), "zh-CN"))
  ];
}
function recordItemNamesForGroup(group, report = reportData()) {
  const names = new Set();
  const memberSet = group && group !== "__all__" ? new Set(membersForGroupValue(group, report)) : null;
  const hidden = hiddenMemberMap(report);
  Object.values(report.records || {}).forEach((record) => {
    if (!record?.member || hidden[record.member]) return;
    if (memberSet && !memberSet.has(record.member)) return;
    Object.entries(record.items || {}).forEach(([name, amount]) => {
      if (String(name || "").trim() && Number(amount || 0) !== 0) names.add(name);
    });
  });
  return names;
}
function groupVisibleItems(group, report = reportData()) {
  const all = Object.keys(report.rules || {});
  const selected = (!group || group === "__all__")
    ? all
    : (Array.isArray(report.groupItems?.[group]) ? report.groupItems[group] : all);
  return orderedItemNames(new Set([...selected, ...recordItemNamesForGroup(group, report)]), report);
}
function totalsForItems(items = {}, itemNames = configuredItems(), report = reportData()) {
  const raw = itemNames.reduce((sum, name) => sum + Number(items[name] || 0), 0);
  const weighted = itemNames.reduce((sum, name) => {
    const weight = Number(report.rules?.[name] ?? 1);
    return sum + Number(items[name] || 0) * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { raw, weighted };
}
function productTotalsForItems(items = {}, itemNames = configuredItems(), report = reportData()) {
  return itemNames.reduce((totals, name) => {
    const amount = Number(items[name] || 0);
    const rule = report.productRules?.[name] || defaultProductRuleFor(name);
    totals.video += amount * Number(rule.video || 0);
    totals.ai += amount * Number(rule.ai || 0);
    return totals;
  }, { video: 0, ai: 0 });
}
function totalConversionQuotaForItem(name, report = reportData()) {
  const value = Number(report.totalConversionRules?.[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function totalConversionForItems(items = {}, itemNames = configuredItems(), report = reportData()) {
  const byItem = {};
  let total = 0;
  itemNames.forEach((name) => {
    const amount = Number(items[name] || 0);
    const quota = totalConversionQuotaForItem(name, report);
    const value = quota > 0 ? amount / quota : 0;
    byItem[name] = value;
    total += value;
  });
  return { total, items: byItem };
}
function totalConversionSaturation(totalConversion, capacityDays = 0) {
  const capacity = Number(capacityDays || 0);
  return capacity > 0 ? Number(totalConversion || 0) / capacity * 100 : 0;
}
function totalConversionStatus(totalConversion, capacityDays = 0) {
  if (Number(capacityDays || 0) <= 0) return "未设置";
  return totalConversionSaturation(totalConversion, capacityDays) >= 100 ? "饱和" : "未饱和";
}
function fmtTotalConversion(value) {
  return fmt(Number(value || 0));
}
function productTotalValue(products = {}) {
  // AI 成品只作辅助参考，不参与成品量、差额和达标计算。
  return Number(products.video || 0);
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
      quota_total: memberQuota(currentMember, currentDate),
      workload_quota_total: memberWorkloadQuota(currentMember, currentDate),
      duty_hours: 0,
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
    duty_hours: dutyHoursValue(record),
    workload_quota_total: Number(record.workload_quota_total || 0),
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
    const normalizedKey = key === "afternoon" ? "noon" : key;
    if (!allowed.has(normalizedKey) || !value) return;
    const status = normalizeCheckinStatus(checkinStatus(value));
    if (!status) return;
    const next = typeof value === "object"
      ? { ...value, status }
      : { status };
    const updatedAt = String(next.updated_at || next.iso || "").trim();
    if (updatedAt) {
      next.iso = next.iso || updatedAt;
      next.updated_at = next.updated_at || updatedAt;
    }
    cleaned[normalizedKey] = next;
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
      iso: updatedAt,
      updated_at: updatedAt
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
  const knownEntries = Object.entries(items).filter(([name]) => data.rules[name] !== undefined);
  const raw = knownEntries.reduce((sum, [, amount]) => sum + amount, 0);
  const weighted = knownEntries.reduce((sum, [name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return sum + amount * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { items, raw, weighted };
}
function entryTotals(items) {
  const knownEntries = Object.entries(items).filter(([name]) => data.rules[name] !== undefined);
  const raw = knownEntries.reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
  const weighted = knownEntries.reduce((sum, [name, amount]) => {
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
  const products = productTotalsForItems(items, Object.keys(items), data);
  const quota = memberQuota(currentMember);
  const completeQuota = memberCompleteQuota(currentMember);
  const workloadQuota = memberWorkloadQuota(currentMember);
  const productTotal = productTotalValue(products);
  const computedStatus = quotaStatusFromTotals(productTotal, quota, completeQuota);
  const workloadStatus = workloadQuotaStatus(parsed.weighted, workloadQuota);
  const passed = computedStatus !== "不达标";
  $("rawTotal").textContent = fmt(parsed.raw);
  $("weightedTotal").textContent = fmt(parsed.weighted);
  if ($("workloadAuditText")) $("workloadAuditText").textContent = workloadQuotaText(parsed.weighted, workloadQuota);
  if ($("workloadAuditCard")) $("workloadAuditCard").className = `metric ${workloadQuotaClass(workloadStatus)}`;
  if ($("videoProductTotal")) $("videoProductTotal").textContent = fmt(products.video);
  if ($("aiProductTotal")) $("aiProductTotal").textContent = fmt(products.ai);
  $("auditText").textContent = computedStatus === "完全达标" ? "完全达标 ✓" : (passed ? "达标 ✓" : "不达标");
  $("auditCard").className = `metric ${quotaStatusClass(computedStatus)}`;
  const manualStatus = $("statusSelect")?.value || "自动判断";
  const displayStatus = manualStatus === "自动判断" ? "待审核" : manualStatus;
  $("statusPill").textContent = displayStatus;
  $("statusPill").className = `status ${quotaStatusClass(displayStatus)}`;
  if ($("dailyQuotaInput")) $("dailyQuotaInput").placeholder = fmt(memberQuota(currentMember, currentDate));
  if ($("dailyCompleteQuotaInput")) $("dailyCompleteQuotaInput").placeholder = fmt(memberCompleteQuota(currentMember, currentDate));
  if ($("dailyWorkloadQuotaInput")) $("dailyWorkloadQuotaInput").placeholder = fmt(memberWorkloadQuota(currentMember, currentDate));
  $("previewBody").innerHTML = Object.entries(parsed.items).map(([name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    const productRule = data.productRules?.[name] || defaultProductRuleFor(name);
    return `<tr><td>${escapeHtml(name)}</td><td>${fmt(amount)}</td><td>${fmt(weight)}</td><td>${fmt(amount * weight)}</td><td>${fmt(amount * Number(productRule.video || 0))}</td><td>${fmt(amount * Number(productRule.ai || 0))}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="hint">还没有可统计的报数。</td></tr>`;
}
function loadForm() {
  ensureCurrentMemberVisible();
  const rec = currentRecord();
  $("dateInput").value = currentDate;
  $("quotaInput").value = String(data.quota);
  if ($("completeQuotaInput")) $("completeQuotaInput").value = data.completeQuota === "" || data.completeQuota === undefined || data.completeQuota === null ? "" : String(data.completeQuota);
  if ($("dailyQuotaInput")) {
    $("dailyQuotaInput").value = dailyMemberQuotaValue(currentMember, currentDate);
    $("dailyQuotaInput").placeholder = fmt(memberQuota(currentMember, currentDate));
  }
  if ($("dailyCompleteQuotaInput")) {
    $("dailyCompleteQuotaInput").value = dailyMemberCompleteQuotaValue(currentMember, currentDate);
    $("dailyCompleteQuotaInput").placeholder = fmt(memberCompleteQuota(currentMember, currentDate));
  }
  if ($("dailyWorkloadQuotaInput")) {
    $("dailyWorkloadQuotaInput").value = dailyMemberWorkloadQuotaValue(currentMember, currentDate);
    $("dailyWorkloadQuotaInput").placeholder = fmt(memberWorkloadQuota(currentMember, currentDate));
  }
  if ($("dutyHoursInput")) $("dutyHoursInput").value = dutyHoursValue(rec) || "";
  $("entryText").value = rec.text || "";
  renderEntryInputs(Object.keys(rec.items || {}).length ? rec.items : parseEntry(rec.text || "").items);
  $("statusSelect").value = ["自动判断", "完全达标", "达标", "不达标", "待审核"].includes(rec.status) ? rec.status : "自动判断";
  $("reasonText").value = rec.reason || "";
  $("harvestText").value = rec.harvest || "";
  $("diaryText").value = rec.diary || "";
  renderCheckins(rec.checkins || {});
  preview();
}
function saveFormSilently() {
  data.quota = Number($("quotaInput").value || 0);
  if ($("completeQuotaInput")) data.completeQuota = $("completeQuotaInput").value === "" ? "" : Number($("completeQuotaInput").value || 0);
  if ($("dailyQuotaInput")) setDailyMemberQuota(currentMember, currentDate, $("dailyQuotaInput").value);
  if ($("dailyCompleteQuotaInput")) setDailyMemberCompleteQuota(currentMember, currentDate, $("dailyCompleteQuotaInput").value);
  if ($("dailyWorkloadQuotaInput")) setDailyMemberWorkloadQuota(currentMember, currentDate, $("dailyWorkloadQuotaInput").value);
  const items = readEntryInputs();
  const parsed = { items, ...entryTotals(items) };
  $("entryText").value = itemsToText(items);
  const quota = memberQuota(currentMember);
  const completeQuota = memberCompleteQuota(currentMember);
  const workloadQuota = memberWorkloadQuota(currentMember);
  const dutyHours = normalizeDutyHours($("dutyHoursInput")?.value);
  const products = productTotalsForItems(items, Object.keys(items), data);
  const productTotal = productTotalValue(products);
  const autoStatus = quotaStatusFromTotals(productTotal, quota, completeQuota);
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
    complete_quota_total: completeQuota,
    workload_quota_total: workloadQuota,
    duty_hours: dutyHours,
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
  markPendingCloudRecord(currentDate, currentMember);
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
    const baseMessage = result?.reason === "cloud-quota-paused"
      ? "云数据库额度已满或暂时不可用，这次已保存到本机浏览器草稿。请先恢复云同步服务，或选择团队共享文件夹作为临时备份后再重新提交。"
      : "这次只保存到了本机浏览器缓存。请确认云同步已配置应用密码，或点击顶部“云端文件夹”选择团队共享文件夹后重新提交。";
    const detail = [
      "当前通道：" + cloudSyncProviderLabel(),
      "云同步状态：" + (cloudDbStatusText || "未知"),
      result?.reason ? "失败原因：" + result.reason : ""
    ].filter(Boolean).join("\n");
    showDialog("未同步到总数据", baseMessage + "\n\n" + detail, "");
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
      const todayCompleteQuota = memberCompleteQuota(name, currentDate);
      const defaultQuota = data.memberQuotas[name] === "" || data.memberQuotas[name] === undefined ? data.quota : data.memberQuotas[name];
      const defaultCompleteQuota = quotaValue(data.memberCompleteQuotas?.[name]) ?? quotaValue(data.completeQuota) ?? defaultQuota;
      const btn = document.createElement("button");
      btn.className = `member ${name === currentMember ? "active" : ""}`;
      btn.innerHTML = `<span><span>${escapeHtml(name)}</span><small>今日 ${fmt(todayQuota)}/${fmt(todayCompleteQuota)} · 默认 ${fmt(defaultQuota)}/${fmt(Math.max(Number(defaultQuota || 0), Number(defaultCompleteQuota || 0)))}</small></span><span class="badge">${memberTodayStatus(name)}</span>`;
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
  if (rec.status === "完全达标") return "完全";
  if (rec.status === "达标") return "达标";
  if (rec.status === "不达标") return "未达";
  return "待审";
}
function deleteRules(names = []) {
  const unique = Array.from(new Set(names.map((name) => String(name || "").trim()).filter((name) => data.rules[name] !== undefined)));
  if (!unique.length) return alert("请先勾选要删除的项目。");
  if (!confirm(`确定删除 ${unique.length} 个项目？这些项目会从今日报数、整体预览和混合表格中隐藏，历史记录仍保留。`)) return;
  createBackup(`删除项目 ${unique.join(", ")} 前备份`);
  unique.forEach((name) => {
    delete data.rules[name];
    delete data.productRules?.[name];
    delete data.totalConversionRules?.[name];
    Object.keys(data.groupItems || {}).forEach((group) => {
      data.groupItems[group] = (data.groupItems[group] || []).filter((item) => item !== name);
    });
    Object.keys(data.memberItems || {}).forEach((member) => {
      data.memberItems[member] = (data.memberItems[member] || []).filter((item) => item !== name);
    });
  });
  Object.values(data.records || {}).forEach((record) => recalculateRecordTotals(record, data.rules));
  renderRules();
  renderEntryInputs(filterItemsByRules(readEntryInputs()));
  preview();
  scheduleSave("admin");
}
function renderRules() {
  $("rulesBox").innerHTML = `
    <div class="rule-admin-tools">
      <button type="button" data-delete-selected-rules>删除勾选项目</button>
      <span class="hint">删除后不再显示/计算，已保存的历史记录不清空。</span>
    </div>
    <div class="rule-row config-head">
      <span></span>
      <span>项目</span>
      <span>换算工作量</span>
      <span>视频成品</span>
      <span>AI成品</span>
      <span>总数日量</span>
      <span></span>
    </div>
  `;
  Object.entries(data.rules).forEach(([name, weight]) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    const productRule = data.productRules?.[name] || defaultProductRuleFor(name);
    const totalConversionQuota = totalConversionQuotaForItem(name, data);
    row.innerHTML = `
      <label class="member-row-check" title="勾选后可批量删除"><input type="checkbox" data-rule-select="${escapeAttr(name)}"></label>
      <input value="${escapeAttr(name)}" aria-label="项目">
      <input type="number" step="0.01" value="${Number(weight)}" aria-label="换算工作量系数" title="换算工作量系数">
      <input type="number" step="0.01" value="${Number(productRule.video || 0)}" aria-label="视频成品系数" title="视频成品系数">
      <input type="number" step="0.01" value="${Number(productRule.ai || 0)}" aria-label="AI成品系数" title="AI成品系数">
      <input type="number" step="0.01" min="0" value="${totalConversionQuota || ""}" placeholder="如150" aria-label="总数换算日量" title="总数换算日量：数量除以这个值，得到需要几天">
      <button class="icon" title="删除">×</button>
    `;
    const inputs = row.querySelectorAll("input");
    inputs[1].onchange = () => renameRule(name, inputs[1].value.trim(), Number(inputs[2].value), Number(inputs[3].value), Number(inputs[4].value), Number(inputs[5].value));
    [inputs[2], inputs[3], inputs[4], inputs[5]].forEach((input) => {
      input.oninput = () => {
        data.rules[name] = Number(inputs[2].value || 0);
        data.productRules[name] = {
          video: Number(inputs[3].value || 0),
          ai: Number(inputs[4].value || 0)
        };
        if (!data.totalConversionRules || typeof data.totalConversionRules !== "object") data.totalConversionRules = {};
        data.totalConversionRules[name] = Number(inputs[5].value || 0);
        renderEntryInputs(readEntryInputs());
        preview();
        scheduleSave("admin");
      };
    });
    row.querySelector("button").onclick = () => deleteRules([name]);
    $("rulesBox").appendChild(row);
  });
  $("rulesBox").querySelector("button[data-delete-selected-rules]")?.addEventListener("click", () => {
    const names = Array.from($("rulesBox").querySelectorAll("input[data-rule-select]:checked")).map((input) => input.dataset.ruleSelect);
    deleteRules(names);
  });
}
function renderMemberQuotas() {
  $("memberQuotaBox").innerHTML = `
    <div class="quota-row config-head">
      <span>成员</span>
      <span>默认一级</span>
      <span>默认完全</span>
      <span>默认工作量定额</span>
      <span>当天一级</span>
      <span>当天完全</span>
      <span>当天工作量定额</span>
      <span>工作量备注</span>
      <span></span>
    </div>
  `;
  const selectedDay = $("adminQuotaDate")?.value || currentDate;
  if ($("adminQuotaDate")) $("adminQuotaDate").value = selectedDay;
  if ($("dateQuotaInput")) {
    const value = data.dailyQuotas?.[selectedDay]?.default;
    $("dateQuotaInput").value = value === undefined || value === null ? "" : value;
    $("dateQuotaInput").placeholder = fmt(data.quota);
  }
  if ($("dateCompleteQuotaInput")) {
    const value = data.dailyCompleteQuotas?.[selectedDay]?.default;
    $("dateCompleteQuotaInput").value = value === undefined || value === null ? "" : value;
    $("dateCompleteQuotaInput").placeholder = fmt(memberCompleteQuota(firstVisibleMember(data), selectedDay));
  }
  if ($("dateWorkloadQuotaInput")) {
    const value = data.dailyWorkloadQuotas?.[selectedDay]?.default;
    $("dateWorkloadQuotaInput").value = value === undefined || value === null ? "" : value;
    $("dateWorkloadQuotaInput").placeholder = fmt(memberWorkloadQuota(firstVisibleMember(data), selectedDay));
  }
  reportMembers(data).forEach((name) => {
    const row = document.createElement("div");
    row.className = "quota-row";
    const own = data.memberQuotas[name] ?? "";
    const ownComplete = data.memberCompleteQuotas?.[name] ?? "";
    const ownWorkload = data.memberWorkloadQuotas?.[name] ?? "";
    const dayOwn = data.dailyQuotas?.[selectedDay]?.members?.[name];
    const dayCompleteOwn = data.dailyCompleteQuotas?.[selectedDay]?.members?.[name];
    const dayWorkloadOwn = data.dailyWorkloadQuotas?.[selectedDay]?.members?.[name];
    row.innerHTML = `
      <input value="${escapeAttr(name)}" aria-label="成员">
      <input type="number" step="0.01" min="0" placeholder="${fmt(data.quota)}" value="${own === "" ? "" : Number(own)}" aria-label="成员一级定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberCompleteQuota(name, selectedDay))}" value="${ownComplete === "" ? "" : Number(ownComplete)}" aria-label="成员完全定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberWorkloadQuota(name, selectedDay))}" value="${ownWorkload === "" ? "" : Number(ownWorkload)}" aria-label="成员工作量定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberQuota(name, selectedDay))}" value="${dayOwn === undefined || dayOwn === null ? "" : Number(dayOwn)}" aria-label="当天一级定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberCompleteQuota(name, selectedDay))}" value="${dayCompleteOwn === undefined || dayCompleteOwn === null ? "" : Number(dayCompleteOwn)}" aria-label="当天完全定额">
      <input type="number" step="0.01" min="0" placeholder="${fmt(memberWorkloadQuota(name, selectedDay))}" value="${dayWorkloadOwn === undefined || dayWorkloadOwn === null ? "" : Number(dayWorkloadOwn)}" aria-label="当天工作量定额">
      <input type="text" value="${escapeAttr(data.memberWorkloadNotes?.[name] || "")}" placeholder="仅备注，不参与达标" aria-label="换算工作量备注">
      <button class="icon" title="隐藏成员">隐</button>
    `;
    const inputs = row.querySelectorAll("input");
    inputs[0].onchange = () => renameMember(name, inputs[0].value.trim());
    inputs[1].oninput = () => {
      data.memberQuotas[name] = inputs[1].value === "" ? "" : Number(inputs[1].value);
      renderOverview();
      scheduleSave("admin");
    };
    inputs[2].oninput = () => {
      if (!data.memberCompleteQuotas || typeof data.memberCompleteQuotas !== "object") data.memberCompleteQuotas = {};
      data.memberCompleteQuotas[name] = inputs[2].value === "" ? "" : Number(inputs[2].value);
      renderOverview();
      scheduleSave("admin");
    };
    inputs[3].oninput = () => {
      if (!data.memberWorkloadQuotas || typeof data.memberWorkloadQuotas !== "object") data.memberWorkloadQuotas = {};
      data.memberWorkloadQuotas[name] = inputs[3].value === "" ? "" : Number(inputs[3].value);
      preview();
      renderOverview();
      scheduleSave("admin");
    };
    inputs[4].oninput = () => {
      setDailyMemberQuota(name, selectedDay, inputs[4].value);
      preview();
      renderOverview();
      scheduleSave("admin");
    };
    inputs[5].oninput = () => {
      setDailyMemberCompleteQuota(name, selectedDay, inputs[5].value);
      preview();
      renderOverview();
      scheduleSave("admin");
    };
    inputs[6].oninput = () => {
      setDailyMemberWorkloadQuota(name, selectedDay, inputs[6].value);
      preview();
      renderOverview();
      scheduleSave("admin");
    };
    inputs[7].oninput = () => {
      if (!data.memberWorkloadNotes || typeof data.memberWorkloadNotes !== "object") data.memberWorkloadNotes = {};
      const note = inputs[7].value.trim();
      if (note) data.memberWorkloadNotes[name] = note;
      else delete data.memberWorkloadNotes[name];
      scheduleSave("admin");
    };
    row.querySelector("button").onclick = () => removeMember(name);
    $("memberQuotaBox").appendChild(row);
  });
}
function renderMemberGroups() {
  const visibleMembers = reportMembers(data);
  const configured = new Set(data.members || []);
  if (!data.memberSubgroups || typeof data.memberSubgroups !== "object") data.memberSubgroups = {};
  const recordOnlyCount = visibleMembers.filter((name) => !configured.has(name)).length;
  const toolsHtml = `
    <div class="member-admin-tools">
      <button type="button" data-hide-selected-members>隐藏勾选成员</button>
      ${recordOnlyCount ? `<button type="button" data-select-record-members>勾选记录成员 · ${recordOnlyCount}</button>` : ""}
      <span class="hint">二级自由编队独立于一级小组，可跨组安排 A队、代培组、预备组长；一级小组仍只按领导安排报总量。</span>
    </div>
  `;
  const subgroupEntries = groupRowsBySubgroup(visibleMembers.map((name) => ({
    member: name,
    subgroup: memberSubgroup(name, data),
    primaryGroup: data.memberGroups?.[name] || data.groups[0] || "未分组"
  })));
  const freeSubgroupHtml = `
    <details class="overview-group member-subgroup-admin" open>
      <summary><span>二级自由编队列表 · ${subgroupEntries.length} 个</span><span class="hint">独立维度，可跨一级小组自由组队</span></summary>
      <div class="subgroup-admin-list">
        ${subgroupEntries.map(({ name, rows }) => `
          <div class="subgroup-admin-card">
            <strong>${escapeHtml(name)} · ${rows.length} 人</strong>
            <span>${rows.map((row) => `${escapeHtml(row.member)}（${escapeHtml(row.primaryGroup)}）`).join("、")}</span>
          </div>
        `).join("") || `<div class="hint">还没有二级自由编队。</div>`}
      </div>
    </details>
  `;
  const groupHtml = data.groups.map((group) => {
    const members = visibleMembers.filter((name) => (data.memberGroups?.[name] || data.groups[0]) === group);
    return `
      <details class="overview-group" open>
        <summary>
          <input value="${escapeAttr(group)}" data-group-name="${escapeAttr(group)}" aria-label="分组名称">
          <button class="icon" data-remove-group="${escapeAttr(group)}" title="删除分组">×</button>
        </summary>
        ${members.map((name) => {
          const index = data.members.indexOf(name);
          const isConfigured = index >= 0;
          const groupValue = data.memberGroups?.[name] || data.groups[0] || "";
          const subgroupValue = data.memberSubgroups?.[name] || "";
          return `
            <div class="member-group-row ${isConfigured ? "" : "record-only-member"}">
              <label class="member-row-check" title="勾选后可批量隐藏"><input type="checkbox" data-member-select="${escapeAttr(name)}"></label>
              <input value="${escapeAttr(name)}" data-member-name="${escapeAttr(name)}" aria-label="成员">
              <input value="${escapeAttr(subgroupValue)}" data-member-subgroup="${escapeAttr(name)}" placeholder="二级自由编队" aria-label="二级自由编队">
              <select data-member-group="${escapeAttr(name)}">
                ${data.groups.map((item) => `<option value="${escapeAttr(item)}" ${item === groupValue ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
              </select>
              ${isConfigured
                ? `<button class="icon" data-move-up="${escapeAttr(name)}" ${index === 0 ? "disabled" : ""} title="上移">↑</button>`
                : `<button class="icon" data-promote-member="${escapeAttr(name)}" title="加入正式成员名单">收</button>`}
              <button class="icon" data-move-down="${escapeAttr(name)}" ${!isConfigured || index === data.members.length - 1 ? "disabled" : ""} title="下移">↓</button>
              <button class="icon" data-remove-member="${escapeAttr(name)}" title="隐藏成员">隐</button>
            </div>
          `;
        }).join("") || `<div class="hint">这个分组还没有成员。</div>`}
      </details>
    `;
  }).join("");
  const hidden = hiddenMemberEntries(data);
  const hiddenHtml = hidden.length ? `
      <details class="overview-group hidden-members-group" open>
        <summary><span>隐藏成员 · ${hidden.length}</span><span class="hint">不参与侧边栏、整体预览和混合表格</span></summary>
        ${hidden.map(({ member, hiddenAt }) => {
          const group = data.memberGroups?.[member] || "未分组";
          const subgroup = data.memberSubgroups?.[member] || "未分队";
          const date = hiddenAt && hiddenAt !== true ? String(hiddenAt).slice(0, 10) : "已隐藏";
          return `
            <div class="member-group-row hidden-member-row">
              <span></span>
              <input value="${escapeAttr(member)}" aria-label="隐藏成员" disabled>
              <span class="hint">${escapeHtml(subgroup)}</span>
              <span class="hint">${escapeHtml(group)} · ${escapeHtml(date)}</span>
              <span></span>
              <span></span>
              <button class="icon" data-restore-member="${escapeAttr(member)}" title="恢复成员">显</button>
            </div>
          `;
        }).join("")}
      </details>
    ` : "";
  $("memberGroupBox").innerHTML = toolsHtml + freeSubgroupHtml + groupHtml + hiddenHtml;
  $("memberGroupBox").querySelectorAll("input[data-group-name]").forEach((input) => {
    input.onchange = () => renameGroup(input.dataset.groupName, input.value.trim());
  });
  $("memberGroupBox").querySelectorAll("button[data-remove-group]").forEach((button) => {
    button.onclick = () => removeGroup(button.dataset.removeGroup);
  });
  $("memberGroupBox").querySelectorAll("input[data-member-name]").forEach((input) => {
    input.onchange = () => renameMember(input.dataset.memberName, input.value.trim());
  });
  $("memberGroupBox").querySelectorAll("input[data-member-subgroup]").forEach((input) => {
    input.oninput = () => {
      if (!data.memberSubgroups || typeof data.memberSubgroups !== "object") data.memberSubgroups = {};
      const member = input.dataset.memberSubgroup;
      const value = input.value.trim();
      if (value) data.memberSubgroups[member] = value;
      else delete data.memberSubgroups[member];
      renderOverview();
      scheduleSave("admin");
    };
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
  $("memberGroupBox").querySelectorAll("button[data-promote-member]").forEach((button) => {
    button.onclick = () => promoteMember(button.dataset.promoteMember);
  });
  $("memberGroupBox").querySelectorAll("button[data-remove-member]").forEach((button) => {
    button.onclick = () => removeMember(button.dataset.removeMember);
  });
  $("memberGroupBox").querySelector("button[data-select-record-members]")?.addEventListener("click", () => {
    const configured = new Set(data.members || []);
    $("memberGroupBox").querySelectorAll("input[data-member-select]").forEach((input) => {
      input.checked = !configured.has(input.dataset.memberSelect);
    });
  });
  $("memberGroupBox").querySelector("button[data-hide-selected-members]")?.addEventListener("click", hideSelectedMembers);
  $("memberGroupBox").querySelectorAll("button[data-restore-member]").forEach((button) => {
    button.onclick = () => restoreMember(button.dataset.restoreMember);
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
function renameItemInList(list = [], oldName, newName) {
  const renamed = (Array.isArray(list) ? list : []).map((item) => item === oldName ? newName : item);
  return Array.from(new Set(renamed.filter(Boolean)));
}
function moveItemAmount(items = {}, oldName, newName) {
  if (!items || oldName === newName || !Object.prototype.hasOwnProperty.call(items, oldName)) return false;
  const oldValue = Number(items[oldName] || 0);
  const newValue = Number(items[newName] || 0);
  if (oldValue || newValue) items[newName] = oldValue + newValue;
  else if (!Object.prototype.hasOwnProperty.call(items, newName)) items[newName] = items[oldName];
  delete items[oldName];
  return true;
}
function recalculateRecordTotals(record, rules = data.rules) {
  const totals = mergedEntryTotals(record.items || {}, rules || {});
  record.raw_total = totals.raw;
  record.weighted_total = totals.weighted;
  record.updated_at = new Date().toISOString();
}
function migrateRuleDataKeys(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  let changed = 0;
  Object.values(data.records || {}).forEach((record) => {
    if (moveItemAmount(record.items || {}, oldName, newName)) {
      recalculateRecordTotals(record, data.rules);
      changed += 1;
    }
  });
  Object.values(data.monthlyPlans || {}).forEach((entry) => {
    Object.values(entry?.members || {}).forEach((plan) => {
      if (moveItemAmount(plan.items || {}, oldName, newName)) changed += 1;
    });
  });
  return changed;
}
function renameRule(oldName, newName, weight, videoProduct, aiProduct, totalConversionQuota) {
  const nextName = String(newName || "").trim();
  if (!nextName) return renderRules();
  if (!data.productRules || typeof data.productRules !== "object") data.productRules = {};
  if (!data.totalConversionRules || typeof data.totalConversionRules !== "object") data.totalConversionRules = {};
  const previousWeight = Number(data.rules?.[oldName] ?? data.rules?.[nextName] ?? 1);
  const previousProduct = data.productRules?.[oldName] || data.productRules?.[nextName] || defaultProductRuleFor(nextName);
  const previousTotalConversion = Number(data.totalConversionRules?.[oldName] ?? data.totalConversionRules?.[nextName] ?? 0);
  const isRename = oldName !== nextName;
  if (isRename) createBackup(`rename item ${oldName} before`);
  if (isRename) {
    delete data.rules[oldName];
    delete data.productRules?.[oldName];
    delete data.totalConversionRules?.[oldName];
  }
  data.rules[nextName] = Number.isFinite(weight) ? weight : previousWeight;
  data.productRules[nextName] = {
    video: Number.isFinite(videoProduct) ? videoProduct : Number(previousProduct.video || 0),
    ai: Number.isFinite(aiProduct) ? aiProduct : Number(previousProduct.ai || 0)
  };
  data.totalConversionRules[nextName] = Number.isFinite(totalConversionQuota) ? totalConversionQuota : previousTotalConversion;
  if (isRename) {
    Object.keys(data.memberItems || {}).forEach((member) => {
      data.memberItems[member] = renameItemInList(data.memberItems[member] || [], oldName, nextName);
    });
    Object.keys(data.groupItems || {}).forEach((group) => {
      data.groupItems[group] = renameItemInList(data.groupItems[group] || [], oldName, nextName);
    });
    migrateRuleDataKeys(oldName, nextName);
  }
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
  if (data.memberCompleteQuotas?.[oldName] !== undefined) {
    data.memberCompleteQuotas[newName] = data.memberCompleteQuotas[oldName];
    delete data.memberCompleteQuotas[oldName];
  }
  if (data.memberWorkloadNotes?.[oldName] !== undefined) {
    data.memberWorkloadNotes[newName] = data.memberWorkloadNotes[oldName];
    delete data.memberWorkloadNotes[oldName];
  }
  if (data.memberWorkloadQuotas?.[oldName] !== undefined) {
    data.memberWorkloadQuotas[newName] = data.memberWorkloadQuotas[oldName];
    delete data.memberWorkloadQuotas[oldName];
  }
  if (data.memberGroups[oldName] !== undefined) {
    data.memberGroups[newName] = data.memberGroups[oldName];
    delete data.memberGroups[oldName];
  }
  if (data.memberSubgroups?.[oldName] !== undefined) {
    data.memberSubgroups[newName] = data.memberSubgroups[oldName];
    delete data.memberSubgroups[oldName];
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
  Object.values(data.dailyCompleteQuotas || {}).forEach((entry) => {
    if (entry.members && entry.members[oldName] !== undefined) {
      entry.members[newName] = entry.members[oldName];
      delete entry.members[oldName];
    }
  });
  Object.values(data.dailyWorkloadQuotas || {}).forEach((entry) => {
    if (entry.members && entry.members[oldName] !== undefined) {
      entry.members[newName] = entry.members[oldName];
      delete entry.members[oldName];
    }
  });
  Object.values(data.monthlyPlans || {}).forEach((entry) => {
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
  if (!name) return;
  if (isMemberHidden(name, data)) {
    restoreMember(name, groupName);
    $("memberName").value = "";
    $("adminMemberName").value = "";
    return;
  }
  if (data.members.includes(name)) return;
  saveFormSilently();
  delete data.deletedMembers?.[name];
  delete data.hiddenMembers?.[name];
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
function promoteMember(name) {
  if (!name) return;
  data.hiddenMembers = data.hiddenMembers || {};
  delete data.hiddenMembers[name];
  delete data.deletedMembers?.[name];
  if (!data.members.includes(name)) data.members.push(name);
  if (!data.memberGroups[name]) data.memberGroups[name] = data.groups[0] || "1组";
  if (!Array.isArray(data.memberItems[name])) data.memberItems[name] = configuredItems();
  render();
  scheduleSave("admin");
}
function hideMembers(names = []) {
  const unique = Array.from(new Set(names.map((name) => String(name || "").trim()).filter(Boolean)));
  if (!unique.length) return alert("请先勾选要隐藏的成员。");
  const visibleAfter = reportMembers(data).filter((name) => !unique.includes(name));
  if (!visibleAfter.length) return alert("至少保留一个显示成员。");
  if (!confirm(`确定隐藏 ${unique.length} 位成员？会从成员列表、整体预览和混合表格中隐藏，但保留历史记录和配置。`)) return;
  data.hiddenMembers = data.hiddenMembers || {};
  unique.forEach((name) => {
    data.hiddenMembers[name] = new Date().toISOString();
    delete data.deletedMembers?.[name];
  });
  if (unique.includes(currentMember)) currentMember = firstVisibleMember(data);
  loadForm();
  render();
  scheduleSave("admin");
}
function hideSelectedMembers() {
  const names = Array.from($("memberGroupBox")?.querySelectorAll("input[data-member-select]:checked") || []).map((input) => input.dataset.memberSelect);
  hideMembers(names);
}
function restoreMember(name, groupName = "") {
  if (!name) return;
  saveFormSilently();
  data.hiddenMembers = data.hiddenMembers || {};
  delete data.hiddenMembers[name];
  delete data.deletedMembers?.[name];
  if (!data.members.includes(name)) data.members.push(name);
  if (groupName) data.memberGroups[name] = groupName;
  else if (!data.memberGroups[name]) data.memberGroups[name] = data.groups[0] || "1组";
  if (!Array.isArray(data.memberItems[name])) data.memberItems[name] = configuredItems();
  currentMember = name;
  loadForm();
  render();
  scheduleSave("admin");
}
function removeMember(name) {
  hideMembers([name]);
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
  let completeQuota = 0;
  let workloadQuota = 0;
  let dutyHours = 0;
  let checkinCount = 0;
  days.forEach((day) => {
    const rec = recordForReport(report, day, member);
    const memberItems = rec?.items || {};
    const totals = totalsForItems(memberItems, itemNames, report);
    raw += totals.raw;
    weighted += totals.weighted;
    quota += memberQuota(member, day);
    completeQuota += memberCompleteQuota(member, day);
    workloadQuota += memberWorkloadQuota(member, day);
    dutyHours += dutyHoursValue(rec);
    itemNames.forEach((name) => {
      items[name] += Number(memberItems?.[name] || 0);
    });
    checkinCount += checkinPeriods().filter((period) => checkinStatus(rec?.checkins?.[period.key])).length;
  });
  const checkinSlots = days.length * checkinPeriods().length;
  const products = productTotalsForItems(items, itemNames, report);
  const totalConversion = totalConversionForItems(items, itemNames, report).total;
  const productTotal = productTotalValue(products);
  const status = quotaStatusFromTotals(productTotal, quota, completeQuota);
  const rateBase = completeQuota || quota;
  const rate = rateBase > 0 ? Math.min(100, Math.round((productTotal / rateBase) * 100)) : 100;
  return {
    member,
    subgroup: memberSubgroup(member, report),
    records,
    items,
    raw,
    weighted,
    productTotal,
    totalConversion,
    totalConversionCapacityDays: days.length,
    totalConversionSaturation: totalConversionSaturation(totalConversion, days.length),
    totalConversionStatus: totalConversionStatus(totalConversion, days.length),
    quota,
    completeQuota,
    workloadQuota,
    workloadDiff: weighted - workloadQuota,
    workloadStatus: workloadQuotaStatus(weighted, workloadQuota),
    dutyHours,
    diff: productTotal - quota,
    completeDiff: productTotal - completeQuota,
    video: products.video,
    ai: products.ai,
    status,
    passed: status !== "不达标",
    completePassed: status === "完全达标",
    rate,
    checkinCount,
    checkinSlots,
    note: latestRecordText(records)
  };
}
function mixedMonthlyReportMode() {
  return mixedTableRangeMode === "month" ? "month" : "small-month";
}
function mixedMonthlyPlanKey(mode, monthKey) {
  return `${mode}|${monthKey}`;
}
function mixedMonthlyReportInfo(report = reportData()) {
  const mode = mixedMonthlyReportMode();
  const selectedMonths = mixedTableRangeMode === mode ? selectedMixedExportMonths(report) : [];
  const currentMonth = selectedMonths[0] || periodMonthForDay(currentDate, mode);
  const previousMonth = shiftMonthKey(currentMonth, -1);
  const nextMonth = shiftMonthKey(currentMonth, 1);
  const current = mixedPeriodRangeForMonth(currentMonth, mode);
  const previous = mixedPeriodRangeForMonth(previousMonth, mode);
  const next = mixedPeriodRangeForMonth(nextMonth, mode);
  return { mode, currentMonth, previousMonth, nextMonth, current, previous, next };
}
function mixedMonthlyPlanFor(report, mode, monthKey, member, itemNames) {
  const plan = report.monthlyPlans?.[mixedMonthlyPlanKey(mode, monthKey)]?.members?.[member] || {};
  return {
    quota: plan.quota === "" || plan.quota === undefined || plan.quota === null ? "" : Number(plan.quota || 0),
    items: Object.fromEntries(itemNames.map((name) => [name, Number(plan.items?.[name] || 0)]))
  };
}
function ensureMixedMonthlyPlanMember(mode, monthKey, member) {
  const key = mixedMonthlyPlanKey(mode, monthKey);
  if (!data.monthlyPlans || typeof data.monthlyPlans !== "object") data.monthlyPlans = {};
  if (!data.monthlyPlans[key]) data.monthlyPlans[key] = { members: {} };
  if (!data.monthlyPlans[key].members) data.monthlyPlans[key].members = {};
  if (!data.monthlyPlans[key].members[member]) data.monthlyPlans[key].members[member] = { quota: "", items: {} };
  if (!data.monthlyPlans[key].members[member].items) data.monthlyPlans[key].members[member].items = {};
  return data.monthlyPlans[key].members[member];
}
function aggregateRangeForMember(member, range, itemNames, report) {
  return aggregateMemberRange(member, buildDateRange(range.start, range.end), report, itemNames);
}
function mixedMonthlyMemberRow(member, info, itemNames, report) {
  const current = aggregateRangeForMember(member, info.current, itemNames, report);
  const previous = aggregateRangeForMember(member, info.previous, itemNames, report);
  const nextActual = aggregateRangeForMember(member, info.next, itemNames, report);
  const plan = mixedMonthlyPlanFor(report, info.mode, info.nextMonth, member, itemNames);
  const planTotals = totalsForItems(plan.items, itemNames, report);
  const planConversion = totalConversionForItems(plan.items, itemNames, report).total;
  const planProducts = productTotalsForItems(plan.items, itemNames, report);
  const planProductTotal = productTotalValue(planProducts);
  const planQuotaValue = quotaValue(plan.quota);
  const defaultPlanQuota = nextActual.quota;
  const planQuota = planQuotaValue === null ? defaultPlanQuota : planQuotaValue;
  const planActual = nextActual.productTotal;
  const planDiff = planActual - planQuota;
  const planRate = planQuota > 0 ? Math.round(planActual / planQuota * 100) : 0;
  const deltaItems = Object.fromEntries(itemNames.map((name) => [name, Number(current.items?.[name] || 0) - Number(previous.items?.[name] || 0)]));
  return {
    member,
    current,
    previous,
    delta: {
      items: deltaItems,
      productTotal: current.productTotal - previous.productTotal,
      weighted: current.weighted - previous.weighted,
      totalConversion: current.totalConversion - previous.totalConversion,
      video: current.video - previous.video,
      ai: current.ai - previous.ai
    },
    plan: {
      rawQuota: plan.quota,
      items: plan.items,
      productTotal: planProductTotal,
      weighted: planTotals.weighted,
      totalConversion: planConversion,
      totalConversionCapacityDays: nextActual.totalConversionCapacityDays,
      totalConversionSaturation: totalConversionSaturation(planConversion, nextActual.totalConversionCapacityDays),
      video: planProducts.video,
      ai: planProducts.ai,
      quota: planQuota,
      defaultQuota: defaultPlanQuota,
      actual: planActual,
      diff: planDiff,
      rate: planRate
    }
  };
}
function sumMonthlyRows(rows, itemNames) {
  const sumPart = (field) => {
    const items = Object.fromEntries(itemNames.map((name) => [name, rows.reduce((sum, row) => sum + Number(row[field].items?.[name] || 0), 0)]));
    const video = rows.reduce((sum, row) => sum + Number(row[field].video || 0), 0);
    const ai = rows.reduce((sum, row) => sum + Number(row[field].ai || 0), 0);
    const productTotal = rows.reduce((sum, row) => sum + Number(row[field].productTotal || 0), 0);
    const quota = rows.reduce((sum, row) => sum + Number(row[field].quota || 0), 0);
    const totalConversion = rows.reduce((sum, row) => sum + Number(row[field].totalConversion || 0), 0);
    const totalConversionCapacityDays = rows.reduce((sum, row) => sum + Number(row[field].totalConversionCapacityDays || 0), 0);
    return {
      items,
      productTotal,
      weighted: rows.reduce((sum, row) => sum + Number(row[field].weighted || 0), 0),
      totalConversion,
      totalConversionCapacityDays,
      totalConversionSaturation: totalConversionSaturation(totalConversion, totalConversionCapacityDays),
      quota,
      diff: productTotal - quota,
      video,
      ai
    };
  };
  const deltaItems = Object.fromEntries(itemNames.map((name) => [name, rows.reduce((sum, row) => sum + Number(row.delta.items?.[name] || 0), 0)]));
  const planItems = Object.fromEntries(itemNames.map((name) => [name, rows.reduce((sum, row) => sum + Number(row.plan.items?.[name] || 0), 0)]));
  const planQuota = rows.reduce((sum, row) => sum + Number(row.plan.quota || 0), 0);
  const planActual = rows.reduce((sum, row) => sum + Number(row.plan.actual || 0), 0);
  return {
    member: "合计",
    current: sumPart("current"),
    previous: sumPart("previous"),
    delta: {
      items: deltaItems,
      productTotal: rows.reduce((sum, row) => sum + Number(row.delta.productTotal || 0), 0),
      weighted: rows.reduce((sum, row) => sum + Number(row.delta.weighted || 0), 0),
      totalConversion: rows.reduce((sum, row) => sum + Number(row.delta.totalConversion || 0), 0),
      video: rows.reduce((sum, row) => sum + Number(row.delta.video || 0), 0),
      ai: rows.reduce((sum, row) => sum + Number(row.delta.ai || 0), 0)
    },
    plan: {
      items: planItems,
      productTotal: rows.reduce((sum, row) => sum + Number(row.plan.productTotal || 0), 0),
      weighted: rows.reduce((sum, row) => sum + Number(row.plan.weighted || 0), 0),
      totalConversion: rows.reduce((sum, row) => sum + Number(row.plan.totalConversion || 0), 0),
      totalConversionCapacityDays: rows.reduce((sum, row) => sum + Number(row.plan.totalConversionCapacityDays || 0), 0),
      totalConversionSaturation: totalConversionSaturation(rows.reduce((sum, row) => sum + Number(row.plan.totalConversion || 0), 0), rows.reduce((sum, row) => sum + Number(row.plan.totalConversionCapacityDays || 0), 0)),
      video: rows.reduce((sum, row) => sum + Number(row.plan.video || 0), 0),
      ai: rows.reduce((sum, row) => sum + Number(row.plan.ai || 0), 0),
      quota: planQuota,
      defaultQuota: rows.reduce((sum, row) => sum + Number(row.plan.defaultQuota || 0), 0),
      actual: planActual,
      diff: planActual - planQuota,
      rate: planQuota > 0 ? Math.round(planActual / planQuota * 100) : 0
    }
  };
}
function mixedMonthlyReportData(report = reportData()) {
  return withReportData(report, () => {
    const group = $("mixedTableGroup")?.value || mixedTableGroup || report.groups?.[0] || "";
    const info = mixedMonthlyReportInfo(report);
    const itemNames = groupVisibleItems(group, report);
    const rows = membersForGroupValue(group, report).map((member) => mixedMonthlyMemberRow(member, info, itemNames, report));
    return { group, info, itemNames, rows, total: sumMonthlyRows(rows, itemNames) };
  });
}
function renderDetailSummaryGrid(containerId, itemTotals, stats) {
  const box = $(containerId);
  if (!box) return;
  const itemEntries = Object.entries(itemTotals || {});
  const maxItem = Math.max(...itemEntries.map(([, amount]) => Math.abs(Number(amount || 0))), 1);
  const productTotal = stats.productTotal ?? productTotalValue({ video: stats.video, ai: stats.ai });
  const statCards = [
    { label: "原始合计", value: fmt(stats.raw || 0) },
    { label: "成品量合计", value: fmt(productTotal || 0), strong: true },
    { label: "换算工作量", value: fmt(stats.weighted || 0) },
    { label: "工作量定额", value: fmt(stats.workloadQuota || 0) },
    { label: "工作量差额", value: signedTotalText((stats.workloadDiff ?? ((stats.weighted || 0) - (stats.workloadQuota || 0)))), tone: (stats.workloadDiff ?? ((stats.weighted || 0) - (stats.workloadQuota || 0))) >= 0 ? "good" : "bad" },
    { label: "完全定额", value: fmt(stats.completeQuota || stats.quota || 0) },
    { label: stats.quotaLabel || "周期一级定额", value: fmt(stats.quota || 0) },
    { label: "尽本分时长", value: fmtDutyHours(stats.dutyHours || 0) },
    { label: "一级差额", value: `${(stats.diff || 0) >= 0 ? "+" : ""}${fmt(stats.diff || 0)}`, tone: (stats.diff || 0) >= 0 ? "good" : "bad" }
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
function overviewGroupBriefItemDetail(row, itemNames) {
  return itemNames
    .map((name) => [name, Number(row.items?.[name] || 0)])
    .filter(([, amount]) => amount)
    .map(([name, amount]) => `${name}${fmt(amount)}`)
    .join("，") || "无项目数";
}
function sortedOverviewGroupRows(rows = []) {
  return [...rows].sort((a, b) => {
    const diff = Number(a.diff || 0) - Number(b.diff || 0);
    if (diff) return diff;
    return String(a.member || "").localeCompare(String(b.member || ""), "zh-CN");
  });
}
function overviewBriefProductValue(source = {}) {
  return Number(source.video ?? source.productTotal ?? 0);
}
function overviewBriefStatus(productTotal, quota) {
  const total = Number(productTotal || 0);
  const target = Number(quota || 0);
  if (target <= 0) return total > 0 ? "达标" : "不达标";
  return total >= target ? "达标" : "不达标";
}
function overviewBriefDiffText(productTotal, quota) {
  const diff = cleanTotalValue(Number(productTotal || 0) - Number(quota || 0));
  if (diff < 0) return fmt(Math.abs(diff));
  return diff > 0 ? `+${fmt(diff)}` : "0";
}
function overviewGroupBriefLine(row, itemNames) {
  const product = overviewBriefProductValue(row);
  const status = overviewBriefStatus(product, row.quota || 0);
  const note = String(row.note || "").trim();
  const parts = [
    `${row.member}：${status}`,
    `定额 ${fmt(row.quota)}`,
    `成品量 ${fmt(product)}`,
    `差额 ${overviewBriefDiffText(product, row.quota || 0)}`,
    `项目 ${overviewGroupBriefItemDetail(row, itemNames)}`,
    note ? `备注 ${note}` : ""
  ].filter(Boolean);
  return parts.join("｜");
}
function overviewGroupBriefReasonText(row, itemNames) {
  const product = overviewBriefProductValue(row);
  const status = overviewBriefStatus(product, row.quota || 0);
  const note = String(row.note || "").trim();
  const lines = [
    `${row.member}：${status}`,
    `   定额：${fmt(row.quota)}｜成品量：${fmt(product)}｜差额：${overviewBriefDiffText(product, row.quota || 0)}`,
    `   项目明细：${overviewGroupBriefItemDetail(row, itemNames)}`
  ];
  if (note) lines.push(`   备注：${note}`);
  return lines.join("\n");
}
function buildOverviewGroupBriefTextForRange(group, range, label, report = reportData()) {
  const days = buildDateRange(range.start, range.end);
  const itemNames = configuredItems();
  const groupRows = membersForGroupValue(group, report).map((member) => aggregateMemberRange(member, days, report, itemNames));
  const summary = summarizeOverviewRows(groupRows);
  const product = overviewBriefProductValue(summary);
  const status = overviewBriefStatus(product, summary.quota);
  const detailLines = sortedOverviewGroupRows(groupRows).length
    ? sortedOverviewGroupRows(groupRows).map((row) => overviewGroupBriefReasonText(row, itemNames))
    : ["暂无成员数据。"];
  return [
    `${group} ${label}报数`,
    `时间：${rangeText(range)}`,
    `定额：${fmt(summary.quota)}`,
    `成品量：${fmt(product)}`,
    `差额：${overviewBriefDiffText(product, summary.quota)}`,
    `状态：${status}`,
    "成员达标与项目明细：",
    ...detailLines
  ].join("\n");
}
function buildOverviewGroupBriefText(group, report = reportData()) {
  const range = overviewRangeInfo();
  if (overviewRangeMode === "week") {
    return buildDateRange(range.start, range.end)
      .map((day) => buildOverviewGroupBriefTextForRange(group, { start: day, end: day }, "今日", report))
      .join("\n\n");
  }
  return buildOverviewGroupBriefTextForRange(group, range, range.label, report);
}
function overviewGroupBriefRows(group, report = reportData()) {
  const range = overviewRangeInfo();
  const days = buildDateRange(range.start, range.end);
  const itemNames = configuredItems();
  const groupRows = membersForGroupValue(group, report).map((member) => aggregateMemberRange(member, days, report, itemNames));
  const summary = summarizeOverviewRows(groupRows);
  const product = overviewBriefProductValue(summary);
  const status = overviewBriefStatus(product, summary.quota);
  const reasonLines = sortedOverviewGroupRows(groupRows).length
    ? sortedOverviewGroupRows(groupRows).map((row) => overviewGroupBriefLine(row, itemNames))
    : ["暂无成员数据。"];
  return [
    [styledCell(`${group} ${range.label}报数｜${rangeText(range)}`, "sTitle", { mergeAcross: 6 })],
    ["小组", "范围", "定额", "成品量", "差额", "状态", "成员达标与项目明细"].map((label) => styledCell(label, "sHeader")),
    [
      styledCell(group, "sDate"),
      styledCell(rangeText(range), "sItem"),
      styledCell(summary.quota, "sQuota"),
      styledCell(product, "sTotal"),
      styledCell(overviewBriefDiffText(product, summary.quota), status === "达标" ? "sDiffGood" : "sDiffBad"),
      styledCell(status, mixedExportStatusStyle(status)),
      styledCell(reasonLines.join("\n"), "sNote")
    ]
  ];
}
function buildOverviewBriefWorkbook(groups, report = reportData()) {
  const rows = groups.flatMap((group, index) => {
    const groupRows = overviewGroupBriefRows(group, report);
    return index < groups.length - 1 ? [...groupRows, [styledCell("", "sSpacer", { mergeAcross: 6 })]] : groupRows;
  });
  return {
    rows: rows.length ? rows : [[styledCell("暂无可导出小组", "sTitle", { mergeAcross: 6 })]],
    columns: [120, 150, 90, 100, 90, 90, 460]
  };
}
function exportOverviewGroupBrief(group) {
  const report = selectedReportData();
  const workbook = withReportData(report, () => buildOverviewBriefWorkbook([group], report));
  const range = overviewRangeInfo();
  const safeGroup = String(group || "group").replace(/[\\/:*?"<>|]/g, "_");
  downloadBlob(buildXlsxWorkbook(`${safeGroup}简报`, workbook.rows, workbook.columns), `overview_${safeGroup}_${range.start}_${range.end}.xlsx`);
}
function exportOverviewGroupBriefText(group) {
  const report = selectedReportData();
  const text = withReportData(report, () => buildOverviewGroupBriefText(group, report));
  const range = overviewRangeInfo();
  const safeGroup = String(group || "group").replace(/[\\/:*?"<>|]/g, "_");
  downloadBlob(new Blob([`\ufeff${text}`], { type: "text/plain;charset=utf-8" }), `overview_${safeGroup}_${range.start}_${range.end}.txt`);
}
async function copyOverviewGroupBriefText(group) {
  const report = selectedReportData();
  const text = withReportData(report, () => buildOverviewGroupBriefText(group, report));
  try {
    await navigator.clipboard.writeText(text);
    showDialog("已复制TXT", "简报内容已经复制到剪贴板。", "");
  } catch {
    showDialog("复制失败", "浏览器没有允许写入剪贴板，可以先用“导出TXT”下载。", "");
  }
}
function overviewRowsPrimaryGroupLabel(rows = [], report = reportData()) {
  const groups = Array.from(new Set(rows.map((row) => report.memberGroups?.[row.member] || report.groups?.[0] || "未分组").filter(Boolean)));
  return groups.length ? groups.join("、") : "无";
}
function overviewRowsBriefText(title, range, label, rows, itemNames, sourceLabel = "") {
  const summary = summarizeOverviewRows(rows);
  const product = overviewBriefProductValue(summary);
  const status = overviewBriefStatus(product, summary.quota);
  const detailLines = sortedOverviewGroupRows(rows).length
    ? sortedOverviewGroupRows(rows).map((row) => overviewGroupBriefReasonText(row, itemNames))
    : ["暂无成员数据。"];
  return [
    `${title} ${label}报数`,
    `时间：${rangeText(range)}`,
    `定额：${fmt(summary.quota)}`,
    `成品量：${fmt(product)}`,
    `差额：${overviewBriefDiffText(product, summary.quota)}`,
    `状态：${status}`,
    "成员达标与项目明细：",
    ...detailLines
  ].join("\n");
}
function overviewRowsBriefRows(title, range, rows, itemNames, sourceLabel = "") {
  const summary = summarizeOverviewRows(rows);
  const product = overviewBriefProductValue(summary);
  const status = overviewBriefStatus(product, summary.quota);
  const reasonLines = sortedOverviewGroupRows(rows).length
    ? sortedOverviewGroupRows(rows).map((row) => overviewGroupBriefLine(row, itemNames))
    : ["暂无成员数据。"];
  return [
    [styledCell(`${title}｜${rangeText(range)}`, "sTitle", { mergeAcross: 6 })],
    ["对象", "范围", "定额", "成品量", "差额", "状态", "成员达标与项目明细"].map((header) => styledCell(header, "sHeader")),
    [
      styledCell(title, "sDate"),
      styledCell(rangeText(range), "sItem"),
      styledCell(summary.quota, "sQuota"),
      styledCell(product, "sTotal"),
      styledCell(overviewBriefDiffText(product, summary.quota), status === "达标" ? "sDiffGood" : "sDiffBad"),
      styledCell(status, mixedExportStatusStyle(status)),
      styledCell(reasonLines.join("\n"), "sNote")
    ]
  ];
}
function overviewSubgroupRowsForRange(subgroup, range, report = reportData()) {
  const days = buildDateRange(range.start, range.end);
  const itemNames = configuredItems();
  const selectedGroupSet = new Set(selectedOverviewGroups(report));
  const rows = reportMembers(report)
    .map((member) => aggregateMemberRange(member, days, report, itemNames))
    .filter((row) => (row.subgroup || "未分队") === subgroup && selectedGroupSet.has(report.memberGroups?.[row.member] || report.groups?.[0]));
  return { rows, itemNames };
}
function buildOverviewSubgroupBriefTextForRange(subgroup, range, label, report = reportData()) {
  const { rows, itemNames } = overviewSubgroupRowsForRange(subgroup, range, report);
  return overviewRowsBriefText(subgroup, range, label, rows, itemNames);
}
function buildOverviewSubgroupBriefText(subgroup, report = reportData()) {
  const range = overviewRangeInfo();
  if (overviewRangeMode === "week") {
    return buildDateRange(range.start, range.end)
      .map((day) => buildOverviewSubgroupBriefTextForRange(subgroup, { start: day, end: day }, "今日", report))
      .join("\n\n");
  }
  return buildOverviewSubgroupBriefTextForRange(subgroup, range, range.label, report);
}
function overviewSubgroupBriefRows(subgroup, report = reportData()) {
  const range = overviewRangeInfo();
  const { rows, itemNames } = overviewSubgroupRowsForRange(subgroup, range, report);
  return overviewRowsBriefRows(subgroup, range, rows, itemNames);
}
function exportOverviewSubgroupBrief(subgroup) {
  const report = selectedReportData();
  const rows = withReportData(report, () => overviewSubgroupBriefRows(subgroup, report));
  const range = overviewRangeInfo();
  const safeName = String(subgroup || "subgroup").replace(/[\\/:*?"<>|]/g, "_");
  downloadBlob(buildXlsxWorkbook(`${safeName}简报`, rows, [120, 150, 90, 100, 90, 90, 460]), `overview_subgroup_${safeName}_${range.start}_${range.end}.xlsx`);
}
function exportOverviewSubgroupBriefText(subgroup) {
  const report = selectedReportData();
  const text = withReportData(report, () => buildOverviewSubgroupBriefText(subgroup, report));
  const range = overviewRangeInfo();
  const safeName = String(subgroup || "subgroup").replace(/[\\/:*?"<>|]/g, "_");
  downloadBlob(new Blob([`\ufeff${text}`], { type: "text/plain;charset=utf-8" }), `overview_subgroup_${safeName}_${range.start}_${range.end}.txt`);
}
async function copyOverviewSubgroupBriefText(subgroup) {
  const report = selectedReportData();
  const text = withReportData(report, () => buildOverviewSubgroupBriefText(subgroup, report));
  try {
    await navigator.clipboard.writeText(text);
    showDialog("已复制TXT", "简报内容已经复制到剪贴板。", "");
  } catch {
    showDialog("复制失败", "浏览器没有允许写入剪贴板，可以先用“导出TXT”下载。", "");
  }
}
function overviewRankingProduct(row = {}) {
  return cleanTotalValue(overviewBriefProductValue(row));
}
function overviewRankingStatus(product, quota) {
  return overviewBriefStatus(product, quota);
}
function overviewRankingSummary(rows = []) {
  const summary = summarizeOverviewRows(rows);
  const product = overviewRankingProduct(summary);
  const quota = Number(summary.quota || 0);
  return {
    product,
    quota,
    ai: cleanTotalValue(summary.ai || 0),
    weighted: cleanTotalValue(summary.weighted || 0),
    diff: cleanTotalValue(product - quota),
    status: overviewRankingStatus(product, quota)
  };
}
function overviewRankingScore(entry) {
  return [
    Number(entry.product || 0),
    entry.status === "达标" ? 1 : 0,
    Number(entry.diff || 0),
    Number(entry.ai || 0)
  ];
}
function compareOverviewRanking(a, b) {
  const left = overviewRankingScore(a);
  const right = overviewRankingScore(b);
  for (let i = 0; i < left.length; i += 1) {
    const diff = right[i] - left[i];
    if (diff) return diff;
  }
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
}
function overviewRankingBadgeClass(index) {
  if (index === 0) return " top-1";
  if (index === 1) return " top-2";
  if (index === 2) return " top-3";
  return "";
}
function overviewRankingListHtml(entries, emptyText, type) {
  if (!entries.length) return `<div class="ranking-empty">${escapeHtml(emptyText)}</div>`;
  return entries.map((entry, index) => {
    const passed = entry.status === "达标";
    const meta = type === "subgroup"
      ? `${entry.count} 人 · 换算工作量 ${fmt(entry.weighted || 0)}`
      : `自由编队 ${escapeHtml(entry.subgroup || "未分队")} · 换算工作量 ${fmt(entry.weighted || 0)}`;
    return `
      <article class="ranking-row ${passed ? "pass" : "fail"}">
        <div class="ranking-no${overviewRankingBadgeClass(index)}">${index + 1}</div>
        <div class="ranking-info">
          <strong>${escapeHtml(entry.name || "未命名")}</strong>
          <small>${meta}</small>
        </div>
        <div class="ranking-score">
          <strong>${fmt(entry.product || 0)}</strong>
          <small>定额 ${fmt(entry.quota || 0)} · 差额 <span class="ranking-diff ${passed ? "good" : "bad"}">${overviewBriefDiffText(entry.product || 0, entry.quota || 0)}</span> · AI ${fmt(entry.ai || 0)}</small>
        </div>
        <span class="ranking-status ${passed ? "pass" : "fail"}">${entry.status}</span>
      </article>
    `;
  }).join("");
}
function renderOverviewRankings(rows = [], range) {
  const hint = $("overviewRankingHint");
  const subgroupList = $("subgroupRankingList");
  const memberList = $("memberRankingList");
  if (!hint || !subgroupList || !memberList) return;
  const subgroupEntries = groupRowsBySubgroup(rows)
    .map(({ name, rows: subgroupRows }) => ({
      name,
      count: subgroupRows.length,
      ...overviewRankingSummary(subgroupRows)
    }))
    .sort(compareOverviewRanking);
  const memberEntries = rows.map((row) => {
    const product = overviewRankingProduct(row);
    const quota = Number(row.quota || 0);
    return {
      name: row.member,
      subgroup: row.subgroup || "未分队",
      product,
      quota,
      ai: cleanTotalValue(row.ai || 0),
      weighted: cleanTotalValue(row.weighted || 0),
      diff: cleanTotalValue(product - quota),
      status: overviewRankingStatus(product, quota)
    };
  }).sort(compareOverviewRanking);
  hint.textContent = `${rangeText(range)} · 按视频成品排序，AI成品仅作参考`;
  subgroupList.innerHTML = overviewRankingListHtml(subgroupEntries, "当前范围还没有自由编队数据。", "subgroup");
  memberList.innerHTML = overviewRankingListHtml(memberEntries, "当前范围还没有个人数据。", "member");
}
function exportSelectedOverviewBriefs() {
  const report = selectedReportData();
  const groups = withReportData(report, () => selectedOverviewGroups(report));
  const workbook = withReportData(report, () => buildOverviewBriefWorkbook(groups, report));
  const range = overviewRangeInfo();
  downloadBlob(buildXlsxWorkbook("批量简报", workbook.rows, workbook.columns), `overview_briefs_${range.start}_${range.end}.xlsx`);
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
  const quotaLabel = days.length === 1 ? "成品定额" : "周期成品定额";
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
  const completePass = rows.filter((row) => row.completePassed).length;
  const fail = rows.length - pass;
  const totalWeighted = rows.reduce((sum, row) => sum + row.weighted, 0);
  const totalWorkloadQuota = rows.reduce((sum, row) => sum + Number(row.workloadQuota || 0), 0);
  const totalProduct = rows.reduce((sum, row) => sum + Number(row.productTotal || 0), 0);
  const totalQuota = rows.reduce((sum, row) => sum + row.quota, 0);
  const totalCompleteQuota = rows.reduce((sum, row) => sum + row.completeQuota, 0);
  const teamStatus = quotaStatusFromTotals(totalProduct, totalQuota, totalCompleteQuota);
  const teamPassed = teamStatus !== "不达标";
  const itemTotals = itemNames.reduce((totals, name) => {
    totals[name] = rows.reduce((sum, row) => sum + Number(row.items[name] || 0), 0);
    return totals;
  }, {});
  $("overviewTitle").textContent = `${range.label} ${overviewGroupLabel(report)}达标情况`;
  $("passCount").textContent = String(pass);
  $("failCount").textContent = String(fail);
  $("passRate").textContent = rows.length ? `${Math.round(pass / rows.length * 100)}%` : "0%";
  if ($("passRateDetail")) $("passRateDetail").textContent = `${completePass} 完全 / ${pass} 达标 / ${rows.length} 位成员`;
  $("teamTotal").textContent = fmt(totalProduct);
  $("teamQuota").textContent = `${fmt(totalQuota)} / ${fmt(totalCompleteQuota)} ${teamStatus === "完全达标" ? "✓" : ""}`;
  $("teamDiff").textContent = `${totalProduct - totalQuota >= 0 ? "+" : ""}${fmt(totalProduct - totalQuota)}`;
  if ($("teamWorkloadQuota")) $("teamWorkloadQuota").textContent = fmt(totalWorkloadQuota);
  if ($("teamWorkloadDiff")) $("teamWorkloadDiff").textContent = signedTotalText(totalWeighted - totalWorkloadQuota);
  $("overviewHint").textContent = `${rangeText(range)} · ${rows.length} 位成员 · 团队${teamStatus} · 一级差额 ${signedTotalText(totalProduct - totalQuota)} · 完全差额 ${signedTotalText(totalProduct - totalCompleteQuota)} · 换算工作量 ${fmt(totalWeighted)} · 工作量差额 ${signedTotalText(totalWeighted - totalWorkloadQuota)}`;
  const rowCard = (row) => `
    <article class="person-card ${quotaStatusClass(row.status)}" data-overview-member="${escapeAttr(row.member)}" title="点击切换这个成员的明细和打卡">
      <div class="person-top">
        <span>${escapeHtml(row.member)}</span>
        <span class="status ${quotaStatusClass(row.status)}">${quotaStatusShort(row.status)}</span>
      </div>
      <div class="subgroup-pill">自由编队 ${escapeHtml(row.subgroup || "未分队")}</div>
      <div class="progress" title="${row.rate}%"><span style="--w:${row.rate}%"></span></div>
      <div class="hint">成品量 ${fmt(row.productTotal || 0)} / ${quotaLabel} ${fmt(row.quota)} / 完全 ${fmt(row.completeQuota)}</div>
      <div class="hint">一级差额 ${signedTotalText(row.diff)} · 完全差额 ${signedTotalText(row.completeDiff)}</div>
      <div class="hint">换算工作量 ${fmt(row.weighted)} / 定额 ${fmt(row.workloadQuota || 0)} · ${workloadQuotaText(row.weighted, row.workloadQuota)}</div>
      <div class="hint">尽本分 ${fmtDutyHours(row.dutyHours || 0)}</div>
      <div class="hint">打卡 ${row.checkinCount}/${row.checkinSlots}</div>
      <div class="hint">${escapeHtml(row.note || "暂无备注")}</div>
    </article>
  `;
  const primaryGroupHtml = visibleGroups.map((group) => {
    const groupRows = rows.filter((row) => (report.memberGroups?.[row.member] || report.groups[0]) === group);
    const groupSummary = summarizeOverviewRows(groupRows);
    return `
      <details class="overview-group" open>
        <summary>
          <span>${escapeHtml(group)} · ${groupRows.length} 人</span>
          <strong>${fmt(groupSummary.productTotal)} / ${fmt(groupSummary.quota)} / ${fmt(groupSummary.completeQuota)}<small> · ${groupSummary.status} · 换算 ${fmt(groupSummary.weighted)} / 工作量定额 ${fmt(groupSummary.workloadQuota)}</small></strong>
          <span class="overview-export-actions">
            <button class="overview-export-btn" type="button" data-overview-export-group="${escapeAttr(group)}">表格</button>
            <button class="overview-export-btn" type="button" data-overview-export-text-group="${escapeAttr(group)}">TXT</button>
            <button class="overview-export-btn" type="button" data-overview-copy-text-group="${escapeAttr(group)}">复制</button>
          </span>
        </summary>
        <div class="member-grid">${groupRows.map(rowCard).join("") || `<div class="hint">这个分组还没有成员。</div>`}</div>
      </details>
    `;
  }).join("");
  const freeSubgroups = groupRowsBySubgroup(rows);
  const freeSubgroupHtml = freeSubgroups.length ? `
      <details class="overview-group overview-free-groups" open>
        <summary>
          <span>二级自由编队 · ${freeSubgroups.length} 个</span>
          <strong>独立于一级小组<small> · 当前一级范围内 ${rows.length} 人</small></strong>
        </summary>
        <div class="overview-subgroup-list">
          ${freeSubgroups.map(({ name, rows: subgroupRows }) => {
            const subgroupSummary = summarizeOverviewRows(subgroupRows);
            const sourceGroups = overviewRowsPrimaryGroupLabel(subgroupRows, report);
            return `
              <details class="overview-subgroup" open>
                <summary>
                  <span>${escapeHtml(name)} · ${subgroupRows.length} 人<small> · 来自 ${escapeHtml(sourceGroups)}</small></span>
                  <strong>${fmt(subgroupSummary.productTotal)} / ${fmt(subgroupSummary.quota)} / ${fmt(subgroupSummary.completeQuota)}<small> · ${subgroupSummary.status} · 换算 ${fmt(subgroupSummary.weighted)} / 工作量定额 ${fmt(subgroupSummary.workloadQuota)}</small></strong>
                  <span class="overview-export-actions">
                    <button class="overview-export-btn" type="button" data-overview-export-subgroup="${escapeAttr(name)}">表格</button>
                    <button class="overview-export-btn" type="button" data-overview-export-text-subgroup="${escapeAttr(name)}">TXT</button>
                    <button class="overview-export-btn" type="button" data-overview-copy-text-subgroup="${escapeAttr(name)}">复制</button>
                  </span>
                </summary>
                <div class="member-grid">${subgroupRows.map(rowCard).join("")}</div>
              </details>
            `;
          }).join("")}
        </div>
      </details>
    ` : "";
  $("overviewGrid").innerHTML = primaryGroupHtml + freeSubgroupHtml;
  renderOverviewRankings(rows, range);
  $("overviewGrid").querySelectorAll("[data-overview-member]").forEach((card) => {
    card.onclick = () => {
      selectOverviewMember(card.dataset.overviewMember, report);
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-export-group]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportOverviewGroupBrief(button.dataset.overviewExportGroup || "");
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-export-text-group]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportOverviewGroupBriefText(button.dataset.overviewExportTextGroup || "");
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-copy-text-group]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyOverviewGroupBriefText(button.dataset.overviewCopyTextGroup || "");
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-export-subgroup]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportOverviewSubgroupBrief(button.dataset.overviewExportSubgroup || "");
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-export-text-subgroup]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportOverviewSubgroupBriefText(button.dataset.overviewExportTextSubgroup || "");
    };
  });
  $("overviewGrid").querySelectorAll("[data-overview-copy-text-subgroup]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyOverviewSubgroupBriefText(button.dataset.overviewCopyTextSubgroup || "");
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
  const detailProduct = detailSourceRows.reduce((sum, row) => sum + Number(row.productTotal || 0), 0);
  const detailVideo = detailSourceRows.reduce((sum, row) => sum + Number(row.video || 0), 0);
  const detailAi = detailSourceRows.reduce((sum, row) => sum + Number(row.ai || 0), 0);
  const detailQuota = detailSourceRows.reduce((sum, row) => sum + row.quota, 0);
  const detailCompleteQuota = detailSourceRows.reduce((sum, row) => sum + row.completeQuota, 0);
  const detailDutyHours = detailSourceRows.reduce((sum, row) => sum + Number(row.dutyHours || 0), 0);
  const detailWorkloadQuota = detailSourceRows.reduce((sum, row) => sum + Number(row.workloadQuota || 0), 0);
  const detailLabel = overviewDetailMember || (overviewDetailGroup === "__all__" ? "全部成员合计" : `${overviewDetailGroup}全部成员`);
  $("detailHint").textContent = `${detailLabel} · ${rangeText(range)} · 只显示合计`;
  renderDetailSummaryGrid("detailSummaryGrid", detailTotals, {
    raw: detailRaw,
    weighted: detailWeighted,
    productTotal: detailProduct,
    video: detailVideo,
    ai: detailAi,
    quota: detailQuota,
    completeQuota: detailCompleteQuota,
    dutyHours: detailDutyHours,
    workloadQuota: detailWorkloadQuota,
    workloadDiff: detailWeighted - detailWorkloadQuota,
    diff: detailProduct - detailQuota,
    completeDiff: detailProduct - detailCompleteQuota,
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
      <td>${fmtDutyHours(dutyHoursValue(r))}</td>
      <td>${escapeHtml(r.status || "")}</td>
      <td>${escapeHtml(r.reason || r.harvest || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="hint">还没有历史记录。</td></tr>`;
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
function signedText(value) {
  return signedTotalText(value);
}
function mixedMonthlyReportLabels(itemNames) {
  return {
    actual: [...itemNames, "成品量", "视频成品", "AI成品", "换算工作量", "总数换算量", "饱和度", "成品定额", "差额"],
    delta: [...itemNames, "成品量差", "视频差", "AI差", "换算差", "总数换算差"],
    plan: [...itemNames, "计划成品量", "计划视频", "计划AI", "计划换算", "计划总数换算", "计划饱和度", "计划成品定额", "已成品", "进度", "计划差额"]
  };
}
function mixedMonthlyActualCells(part, itemNames) {
  return [
    ...itemNames.map((name) => `<td>${fmtTotal(part.items?.[name] || 0)}</td>`),
    `<td class="mixed-total">${fmtTotal(part.productTotal || 0)}</td>`,
    `<td>${fmtTotal(part.video || 0)}</td>`,
    `<td>${fmtTotal(part.ai || 0)}</td>`,
    `<td>${fmtTotal(part.weighted || 0)}</td>`,
    `<td>${fmtTotalConversion(part.totalConversion || 0)}</td>`,
    `<td>${fmt(part.totalConversionSaturation || 0)}%</td>`,
    `<td>${fmtTotal(part.quota || 0)}</td>`,
    `<td class="${cleanTotalValue(part.diff || 0) >= 0 ? "mixed-good" : "mixed-bad"}">${signedText(part.diff || 0)}</td>`
  ].join("");
}
function mixedMonthlyDeltaCells(delta, itemNames) {
  return [
    ...itemNames.map((name) => {
      const value = cleanTotalValue(delta.items?.[name] || 0);
      return `<td class="${value >= 0 ? "mixed-good-soft" : "mixed-bad"}">${signedText(value)}</td>`;
    }),
    `<td class="${cleanTotalValue(delta.productTotal || 0) >= 0 ? "mixed-good" : "mixed-bad"}">${signedText(delta.productTotal || 0)}</td>`,
    `<td class="${cleanTotalValue(delta.video || 0) >= 0 ? "mixed-good-soft" : "mixed-bad"}">${signedText(delta.video || 0)}</td>`,
    `<td class="${cleanTotalValue(delta.ai || 0) >= 0 ? "mixed-good-soft" : "mixed-bad"}">${signedText(delta.ai || 0)}</td>`,
    `<td class="${cleanTotalValue(delta.weighted || 0) >= 0 ? "mixed-good-soft" : "mixed-bad"}">${signedText(delta.weighted || 0)}</td>`,
    `<td class="${Number(delta.totalConversion || 0) >= 0 ? "mixed-good-soft" : "mixed-bad"}">${signedText(delta.totalConversion || 0)}</td>`
  ].join("");
}
function mixedMonthlyPlanCells(row, itemNames, info, editable, isTotal = false) {
  const plan = row.plan || {};
  const itemCells = itemNames.map((name) => {
    const value = Number(plan.items?.[name] || 0);
    if (isTotal) return `<td>${fmtTotal(value)}</td>`;
    return `<td class="mixed-plan-cell">
      <input data-mixed-plan-item data-mode="${escapeAttr(info.mode)}" data-month="${escapeAttr(info.nextMonth)}" data-member="${escapeAttr(row.member)}" data-item="${escapeAttr(name)}" type="number" step="0.01" inputmode="decimal" value="${value || ""}" placeholder="0" ${editable ? "" : "disabled"}>
    </td>`;
  });
  const quotaCell = isTotal
    ? `<td>${fmtTotal(plan.quota || 0)}</td>`
    : `<td class="mixed-plan-cell">
      <input data-mixed-plan-quota data-mode="${escapeAttr(info.mode)}" data-month="${escapeAttr(info.nextMonth)}" data-member="${escapeAttr(row.member)}" type="number" step="0.01" inputmode="decimal" value="${plan.rawQuota === "" || plan.rawQuota === undefined ? "" : Number(plan.rawQuota || 0)}" placeholder="${fmtTotal(plan.defaultQuota || 0)}" ${editable ? "" : "disabled"}>
    </td>`;
  return [
    ...itemCells,
    `<td class="mixed-total">${fmtTotal(plan.productTotal || 0)}</td>`,
    `<td>${fmtTotal(plan.video || 0)}</td>`,
    `<td>${fmtTotal(plan.ai || 0)}</td>`,
    `<td>${fmtTotal(plan.weighted || 0)}</td>`,
    `<td>${fmtTotalConversion(plan.totalConversion || 0)}</td>`,
    `<td>${fmt(plan.totalConversionSaturation || 0)}%</td>`,
    quotaCell,
    `<td>${fmtTotal(plan.actual || 0)}</td>`,
    `<td class="${cleanTotalValue(plan.diff || 0) >= 0 ? "mixed-good" : "mixed-bad"}">${fmt(plan.rate || 0)}%</td>`,
    `<td class="${cleanTotalValue(plan.diff || 0) >= 0 ? "mixed-good" : "mixed-bad"}">${signedText(plan.diff || 0)}</td>`
  ].join("");
}
function renderMixedMonthlyReport() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderMixedMonthlyReport);
  const head = $("mixedMonthlyReportHead");
  const body = $("mixedMonthlyReportBody");
  if (!head || !body) return;
  const report = reportData();
  const { group, info, itemNames, rows, total } = mixedMonthlyReportData(report);
  const labels = mixedMonthlyReportLabels(itemNames);
  const editable = report === data;
  const planTitle = `${info.next.label.replace("汇总", "计划")} · ${rangeText(info.next)}`;
  if ($("mixedMonthlyReportHint")) {
    $("mixedMonthlyReportHint").textContent = `${group || "未分组"} · ${info.current.label} 对比 ${info.previous.label} · 计划期 ${rangeText(info.next)}`;
  }
  head.innerHTML = `
    <tr class="mixed-group-head">
      <th rowspan="2" class="mixed-sticky-name">姓名</th>
      <th colspan="${labels.actual.length}">${escapeHtml(info.current.label)} · ${escapeHtml(rangeText(info.current))}</th>
      <th colspan="${labels.actual.length}">${escapeHtml(info.previous.label)} · ${escapeHtml(rangeText(info.previous))}</th>
      <th colspan="${labels.delta.length}">差额：当前 - 上期</th>
      <th colspan="${labels.plan.length}">${escapeHtml(planTitle)}</th>
    </tr>
    <tr>
      ${labels.actual.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}
      ${labels.actual.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}
      ${labels.delta.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}
      ${labels.plan.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}
    </tr>
  `;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${1 + labels.actual.length * 2 + labels.delta.length + labels.plan.length}" class="hint">这个分组还没有成员。</td></tr>`;
    return;
  }
  const renderRow = (row, isTotal = false) => `
    <tr class="${isTotal ? "mixed-summary-row" : ""}">
      <${isTotal ? "th" : "td"} class="mixed-member mixed-sticky-name">${escapeHtml(row.member)}</${isTotal ? "th" : "td"}>
      ${mixedMonthlyActualCells(row.current, itemNames)}
      ${mixedMonthlyActualCells(row.previous, itemNames)}
      ${mixedMonthlyDeltaCells(row.delta, itemNames)}
      ${mixedMonthlyPlanCells(row, itemNames, info, editable, isTotal)}
    </tr>
  `;
  body.innerHTML = [renderRow(total, true), ...rows.map((row) => renderRow(row))].join("");
  bindMixedMonthlyReportEdits();
}
function bindMixedMonthlyReportEdits() {
  const body = $("mixedMonthlyReportBody");
  if (!body) return;
  body.querySelectorAll("[data-mixed-plan-item]").forEach((input) => {
    input.onchange = () => updateMixedMonthlyPlanItem(input);
    input.onkeydown = (event) => {
      if (event.key === "Enter") input.blur();
    };
  });
  body.querySelectorAll("[data-mixed-plan-quota]").forEach((input) => {
    input.onchange = () => updateMixedMonthlyPlanQuota(input);
    input.onkeydown = (event) => {
      if (event.key === "Enter") input.blur();
    };
  });
}
function updateMixedMonthlyPlanItem(input) {
  const member = input.dataset.member || "";
  const item = input.dataset.item || "";
  if (!member || !item || !data.members.includes(member)) return;
  const plan = ensureMixedMonthlyPlanMember(input.dataset.mode || "small-month", input.dataset.month || monthKeyFromDateKey(currentDate), member);
  const value = Number(input.value || 0);
  if (!value) delete plan.items[item];
  else plan.items[item] = value;
  persistLocal();
  scheduleSave("admin");
  renderMixedMonthlyReport();
}
function updateMixedMonthlyPlanQuota(input) {
  const member = input.dataset.member || "";
  if (!member || !data.members.includes(member)) return;
  const plan = ensureMixedMonthlyPlanMember(input.dataset.mode || "small-month", input.dataset.month || monthKeyFromDateKey(currentDate), member);
  if (input.value === "") plan.quota = "";
  else plan.quota = Number(input.value || 0);
  persistLocal();
  scheduleSave("admin");
  renderMixedMonthlyReport();
}
function renderMixedOverviewTable() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderMixedOverviewTable);
  const report = reportData();
  if (!$('mixedTableHead')) return;
  mixedTableGroup = renderGroupOnlySelect('mixedTableGroup', mixedTableGroup, report);
  if ($('mixedTableRangeMode')) $('mixedTableRangeMode').value = mixedTableRangeMode;
  applyMixedTableDefaultRange();
  renderMixedExportMonths(report);
  let start = $('mixedTableStart').value || currentDate;
  let end = $('mixedTableEnd').value || currentDate;
  if (start > end) {
    [start, end] = [end, start];
    $('mixedTableStart').value = start;
    $('mixedTableEnd').value = end;
  }
  const members = membersForGroupValue(mixedTableGroup, report);
  const member = members.includes(mixedTableMember) ? mixedTableMember : members[0] || '';
  mixedTableMember = member;
  if ($('mixedTableMember')) {
    $('mixedTableMember').innerHTML = members.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
    if (member) $('mixedTableMember').value = member;
  }
  renderValueTabs('mixedMemberTabs', members.map((name) => ({ value: name, label: name })), member, 'data-mixed-member-tab');
  $('mixedMemberTabs')?.querySelectorAll('[data-mixed-member-tab]').forEach((button) => {
    button.onclick = () => {
      mixedTableMember = button.dataset.mixedMemberTab || '';
      renderMixedOverviewTable();
    };
  });
  const days = buildDateRange(start, end).reverse();
  const itemNames = groupVisibleItems(mixedTableGroup, report);
  const editable = report === data && data.members.includes(member);
  const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
  let totalProduct = 0;
  let totalWeighted = 0;
  let totalConversion = 0;
  let totalQuota = 0;
  let totalCompleteQuota = 0;
  let totalWorkloadQuota = 0;
  let totalDutyHours = 0;
  $('mixedTableHint').textContent = member
    ? `${mixedTableGroup} · ${member} · ${start} 至 ${end} · ${itemNames.length} 个组项目 · 一级/完全定额 · 主看成品量 · ${editable ? '可直接编辑' : '当前范围只读'}`
    : '请选择成员';
  $('mixedTableHead').innerHTML = `
    <tr>
      <th>日期</th>
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}
      <th>成品量</th>
      <th>总数换算量</th>
      <th>一级定额</th>
      <th>完全定额</th>
      <th>换算工作量</th>
      <th>工作量定额</th>
      <th>工作量差额</th>
      <th>尽本分时长</th>
      <th>差额</th>
      <th>状态</th>
      <th>备注</th>
    </tr>
  `;
  if (!member) {
    $('mixedTableBody').innerHTML = `<tr><td colspan="${12 + itemNames.length}" class="hint">暂无可查看成员。</td></tr>`;
    renderMixedMonthlyReport();
    renderMixedCheckinTable();
    return;
  }
  const rows = days.map((day) => {
    const rec = recordForReport(report, day, member);
    const items = rec?.items || {};
    const totals = totalsForItems(items, itemNames, report);
    const products = productTotalsForItems(items, itemNames, report);
    const conversion = totalConversionForItems(items, itemNames, report).total;
    const productTotal = productTotalValue(products);
    const weighted = totals.weighted;
    const quota = memberQuota(member, day);
    const completeQuota = memberCompleteQuota(member, day);
    const workloadQuota = memberWorkloadQuota(member, day);
    const dutyHours = dutyHoursValue(rec);
    totalProduct += productTotal;
    totalWeighted += weighted;
    totalConversion += conversion;
    totalQuota += quota;
    totalCompleteQuota += completeQuota;
    totalWorkloadQuota += workloadQuota;
    totalDutyHours += dutyHours;
    itemNames.forEach((name) => {
      itemTotals[name] += Number(items[name] || 0);
    });
    const diff = productTotal - quota;
    const workloadDiff = weighted - workloadQuota;
    const status = quotaStatusFromTotals(productTotal, quota, completeQuota);
    return `
      <tr>
        <td class="mixed-date">${escapeHtml(day.slice(5))}</td>
        ${itemNames.map((name) => {
          const amount = Number(items[name] || 0);
          return `<td class="${amount ? 'mixed-number' : ''}">
            <input data-mixed-item data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" data-item="${escapeAttr(name)}" type="number" step="0.01" inputmode="decimal" value="${amount || ''}" placeholder="0" ${editable ? '' : 'disabled'}>
          </td>`;
        }).join('')}
        <td class="mixed-total">${cleanTotalValue(productTotal) ? fmtTotal(productTotal) : ''}</td>
        <td>${conversion ? fmtTotalConversion(conversion) : ''}</td>
        <td>${fmtTotal(quota)}</td>
        <td>${fmtTotal(completeQuota)}</td>
        <td>${cleanTotalValue(weighted) ? fmtTotal(weighted) : ''}</td>
        <td>${fmtTotal(workloadQuota)}</td>
        <td class="${cleanTotalValue(workloadDiff) >= 0 ? 'mixed-good' : 'mixed-bad'}">${workloadQuota ? signedTotalText(workloadDiff) : ''}</td>
        <td class="mixed-number">
          <input data-mixed-duty-hours data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" type="number" step="0.01" min="0" inputmode="decimal" value="${dutyHours || ''}" placeholder="0" ${editable ? '' : 'disabled'}>
        </td>
        <td class="${cleanTotalValue(diff) >= 0 ? 'mixed-good' : 'mixed-bad'}">${signedTotalText(diff)}</td>
        <td><span class="status ${quotaStatusClass(status)}">${escapeHtml(quotaStatusShort(status))}</span></td>
        <td class="mixed-note">
          <textarea data-mixed-note data-day="${escapeAttr(day)}" data-member="${escapeAttr(member)}" rows="2" ${editable ? '' : 'disabled'}>${escapeHtml(rec?.reason || rec?.harvest || rec?.diary || '')}</textarea>
        </td>
      </tr>
    `;
  });
  const totalDiff = totalProduct - totalQuota;
  const totalSaturation = totalConversionSaturation(totalConversion, days.length);
  const totalConversionLabel = totalConversion ? ` · 总数换算 ${fmtTotalConversion(totalConversion)}天 / 周期 ${days.length}天 · 饱和度 ${fmt(totalSaturation)}% · ${totalConversionStatus(totalConversion, days.length)}` : "";
  const totalStatus = quotaStatusFromTotals(totalProduct, totalQuota, totalCompleteQuota);
  if (member) {
    $('mixedTableHint').textContent = `${mixedTableGroup} · ${member} · ${start} 至 ${end} · ${itemNames.length} 个组项目 · 一级/完全定额 · 主看成品量${totalConversionLabel} · ${editable ? '可直接编辑' : '当前范围只读'}`;
  }
  rows.unshift(`
    <tr class="mixed-summary-row">
      <th>合计</th>
      ${itemNames.map((name) => `<th>${fmtTotal(itemTotals[name])}</th>`).join('')}
      <th>${fmtTotal(totalProduct)}</th>
      <th>${fmtTotalConversion(totalConversion)}</th>
      <th>${fmtTotal(totalQuota)}</th>
      <th>${fmtTotal(totalCompleteQuota)}</th>
      <th>${fmtTotal(totalWeighted)}</th>
      <th>${fmtTotal(totalWorkloadQuota)}</th>
      <th class="${totalWorkloadQuota ? (cleanTotalValue(totalWeighted - totalWorkloadQuota) >= 0 ? 'mixed-good' : 'mixed-bad') : ''}">${totalWorkloadQuota ? signedTotalText(totalWeighted - totalWorkloadQuota) : ''}</th>
      <th>${fmtDutyHours(totalDutyHours)}</th>
      <th class="${cleanTotalValue(totalDiff) >= 0 ? 'mixed-good' : 'mixed-bad'}">${signedTotalText(totalDiff)}</th>
      <th>${escapeHtml(quotaStatusShort(totalStatus))}</th>
      <th></th>
    </tr>
  `);
  $('mixedTableBody').innerHTML = rows.join('');
  bindMixedTableEdits();
  renderMixedMonthlyReport();
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
  $("mixedTableBody").querySelectorAll("[data-mixed-duty-hours]").forEach((input) => {
    input.onchange = () => updateMixedDutyHours(input);
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
      iso: now.toISOString(),
      updated_at: now.toISOString()
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
function updateMixedDutyHours(input) {
  const day = input.dataset.day || currentDate;
  const member = input.dataset.member || "";
  if (!member || !data.members.includes(member)) return;
  const rec = ensureRecordFor(day, member);
  rec.duty_hours = normalizeDutyHours(input.value);
  rec.updated_at = new Date().toISOString();
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
  const days = buildDateRange(start, end).reverse();
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
  markPendingCloudRecord(day, member);
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
  const productDelta = current.productTotal - previous.productTotal;
  const diffDelta = current.diff - previous.diff;
  const group = analysisGroupValue(report);
  const label = scope === "member" ? (member || `${group}全部成员`) : scope === "group" ? group : "团队";
  const yesterday = aggregatePeriod([addDays(currentDate, -1)], scope, member);
  const today = aggregatePeriod([currentDate], scope, member);
  const todayDelta = today.productTotal - yesterday.productTotal;
  const compareLabel = { previous: `当前 ${range} 天 vs 前 ${range} 天`, thisWeek: "本周累计", lastMonth: "对比上月同期" }[compareMode] || `当前 ${range} 天 vs 前 ${range} 天`;
  $("analysisHint").textContent = `${label} · ${compareMode === "thisWeek" ? "本周" : `${range} 天`} · ${compareLabel}`;
  $("analysisSummary").innerHTML = `
    <div class="analysis-card"><span>成品量</span><strong>${fmt(current.productTotal || 0)}</strong></div>
    <div class="analysis-card"><span>成品定额</span><strong>${fmt(current.quota)}</strong></div>
    <div class="analysis-card ${current.diff >= 0 ? "good" : "bad"}"><span>成品差额</span><strong>${current.diff >= 0 ? "+" : ""}${fmt(current.diff)}</strong></div>
    <div class="analysis-card"><span>换算工作量</span><strong>${fmt(current.weighted)}</strong></div>
    <div class="analysis-card ${todayDelta >= 0 ? "good" : "bad"}"><span>今日较昨日</span><strong>${todayDelta >= 0 ? `增长 ${fmt(todayDelta)}` : `下滑 ${fmt(Math.abs(todayDelta))}`}</strong></div>
  `;
  const itemDeltaRows = Object.entries(today.itemTotals).map(([name, value]) => {
    const previousValue = Number(yesterday.itemTotals[name] || 0);
    const delta = Number(value || 0) - previousValue;
    return { label: `${name}：${delta >= 0 ? "增加" : "减少"} ${fmt(Math.abs(delta))}`, weighted: delta, productTotal: delta };
  });
  $("compareSummary").innerHTML = `
    <div class="analysis-card"><span>当前成品</span><strong>${fmt(current.productTotal || 0)}</strong></div>
    <div class="analysis-card"><span>对比成品</span><strong>${fmt(previous.productTotal || 0)}</strong></div>
    <div class="analysis-card ${productDelta >= 0 ? "good" : "bad"}"><span>成品量差</span><strong>${productDelta >= 0 ? "+" : ""}${fmt(productDelta)}</strong></div>
    <div class="analysis-card ${diffDelta >= 0 ? "good" : "bad"}"><span>差额变化</span><strong>${diffDelta >= 0 ? "增长" : "下滑"} ${fmt(Math.abs(diffDelta))}</strong></div>
  `;
  renderMiniBars("compareChart", [
    { label: `${days[0].slice(5)}-${days[days.length - 1].slice(5)}`, productTotal: current.productTotal },
    { label: `${compareDays[0].slice(5)}-${compareDays[compareDays.length - 1].slice(5)}`, productTotal: previous.productTotal },
    ...itemDeltaRows
  ], "productTotal");
  renderMiniBars("analysisChart", currentDisplay.daily.map((row) => ({
    label: row.day.slice(5),
    productTotal: row.productTotal,
    diff: row.diff
  })), "productTotal");
  const itemRows = Object.entries(current.itemTotals).map(([name, value]) => ({ label: name, weighted: value }));
  renderMiniBars("analysisItemChart", itemRows, "weighted");
  renderLineChart("analysisLineChart", currentDisplay.daily);
  renderTreemap("analysisTreemap", itemRows);
  renderProgressBlocks("analysisBlocks", currentDisplay.daily);
  renderPersonalTable(customDays, custom, scope, member);
}
function renderLineChart(containerId, rows) {
  const valueFor = (row) => Number(row.productTotal ?? row.weighted ?? 0);
  const max = Math.max(...rows.map(valueFor), 1);
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? 0 : index / (rows.length - 1) * 100;
    const y = 100 - (valueFor(row) / max * 92);
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
      <th>成品量</th>
      <th>成品定额</th>
      <th>换算工作量</th>
      <th>工作量定额</th>
      <th>工作量差额</th>
      <th>尽本分时长</th>
      <th>差额</th>
    </tr>
  `;
  const rows = [];
  days.forEach((day) => {
    members.forEach((name) => {
      const rec = recordFor(day, name);
      const items = rec?.items || {};
      const products = productTotalsForItems(items, itemNames, report);
      const productTotal = productTotalValue(products);
      const weighted = totalsForItems(items, itemNames, report).weighted;
      const quota = memberQuota(name, day);
      const workloadQuota = memberWorkloadQuota(name, day);
      const workloadDiff = weighted - workloadQuota;
      const dutyHours = dutyHoursValue(rec);
      rows.push(`
        <tr>
          <td>${escapeHtml(day)}</td>
          <td>${escapeHtml(name)}</td>
          ${itemNames.map((item) => `<td>${fmt(items[item] || 0)}</td>`).join("")}
          <td>${fmt(productTotal)}</td>
          <td>${fmt(quota)}</td>
          <td>${fmt(weighted)}</td>
          <td>${fmt(workloadQuota)}</td>
          <td>${workloadQuota ? signedTotalText(workloadDiff) : ""}</td>
          <td>${fmtDutyHours(dutyHours)}</td>
          <td>${productTotal - quota >= 0 ? "+" : ""}${fmt(productTotal - quota)}</td>
        </tr>
      `);
    });
  });
  rows.push(`
    <tr>
      <th>合计</th>
      <th>${scope === "member" ? escapeHtml(member || `${analysisGroupValue(report)}全部成员`) : escapeHtml(analysisTableMember || "团队")}</th>
      ${itemNames.map((name) => `<th>${fmt(tableAggregate.itemTotals[name] || 0)}</th>`).join("")}
      <th>${fmt(tableAggregate.productTotal || 0)}</th>
      <th>${fmt(tableAggregate.quota)}</th>
      <th>${fmt(tableAggregate.weighted)}</th>
      <th>${fmt(tableAggregate.workloadQuota || 0)}</th>
      <th>${tableAggregate.workloadQuota ? signedTotalText(tableAggregate.workloadDiff || 0) : ""}</th>
      <th>${fmtDutyHours(tableAggregate.dutyHours || 0)}</th>
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
      currentMember = firstVisibleMember(data);
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
function freeTableCellKey(rowIndex, columnIndex) {
  return String(rowIndex) + ":" + String(columnIndex);
}
function freeTableColumnLabel(index) {
  let label = "";
  let value = Number(index || 0) + 1;
  while (value > 0) {
    const mod = (value - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    value = Math.floor((value - mod - 1) / 26);
  }
  return label;
}
function currentFreeTable() {
  data.freeTable = normalizeFreeTable(data.freeTable || defaultData.freeTable);
  return data.freeTable;
}
function scheduleFreeTableSave() {
  window.clearTimeout(freeTableSaveTimer);
  freeTableSaveTimer = window.setTimeout(() => scheduleSave("records"), 900);
}
function renderFreeTable() {
  const tableEl = $("freeSheetTable");
  if (!tableEl) return;
  const table = currentFreeTable();
  $("freeSheetHint").textContent = String(table.rows) + " 行 / " + String(table.columns) + " 列 / 自动保存";
  const headerCells = Array.from({ length: table.columns }, (_, column) => "<th>" + freeTableColumnLabel(column) + "</th>").join("");
  const rows = Array.from({ length: table.rows }, (_, row) => {
    const cells = Array.from({ length: table.columns }, (_, column) => {
      const key = freeTableCellKey(row, column);
      return "<td><textarea data-free-sheet-cell data-row=\"" + row + "\" data-column=\"" + column + "\" rows=\"1\">" + escapeHtml(table.cells[key] || "") + "</textarea></td>";
    }).join("");
    return "<tr><th class=\"sheet-row-head\">" + String(row + 1) + "</th>" + cells + "</tr>";
  }).join("");
  tableEl.innerHTML = "<thead><tr><th class=\"sheet-corner\"></th>" + headerCells + "</tr></thead><tbody>" + rows + "</tbody>";
  tableEl.querySelectorAll("[data-free-sheet-cell]").forEach((input) => {
    input.oninput = () => updateFreeTableCell(input);
    input.onkeydown = (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const row = Number(input.dataset.row || 0);
      const column = Number(input.dataset.column || 0) + (event.shiftKey ? -1 : 1);
      const nextColumn = Math.max(0, Math.min(table.columns - 1, column));
      const next = tableEl.querySelector("[data-row=\"" + row + "\"][data-column=\"" + nextColumn + "\"]");
      if (next) next.focus();
    };
  });
}
function touchFreeTable() {
  currentFreeTable().updated_at = new Date().toISOString();
  persistLocal();
  scheduleFreeTableSave();
}
function updateFreeTableCell(input) {
  const table = currentFreeTable();
  const key = freeTableCellKey(Number(input.dataset.row || 0), Number(input.dataset.column || 0));
  table.cells[key] = input.value;
  touchFreeTable();
}
function addFreeTableRow() {
  const table = currentFreeTable();
  table.rows = Math.min(200, table.rows + 1);
  touchFreeTable();
  renderFreeTable();
}
function addFreeTableColumn() {
  const table = currentFreeTable();
  table.columns = Math.min(50, table.columns + 1);
  touchFreeTable();
  renderFreeTable();
}
function removeFreeTableRow() {
  const table = currentFreeTable();
  if (table.rows <= 1) return alert("表格至少保留 1 行。");
  const nextRows = table.rows - 1;
  Object.keys(table.cells || {}).forEach((key) => {
    if (Number(key.split(":")[0]) >= nextRows) delete table.cells[key];
  });
  table.rows = nextRows;
  touchFreeTable();
  renderFreeTable();
}
function removeFreeTableColumn() {
  const table = currentFreeTable();
  if (table.columns <= 1) return alert("表格至少保留 1 列。");
  const nextColumns = table.columns - 1;
  Object.keys(table.cells || {}).forEach((key) => {
    if (Number(key.split(":")[1]) >= nextColumns) delete table.cells[key];
  });
  table.columns = nextColumns;
  touchFreeTable();
  renderFreeTable();
}
function clearFreeTable() {
  const table = currentFreeTable();
  if (!confirm("确定清空自由表格内容？")) return;
  Object.keys(table.cells || {}).forEach((key) => { table.cells[key] = ""; });
  touchFreeTable();
  renderFreeTable();
}
function renderAdminSettings() {
  $("autoAuditToggle").checked = false;
  $("sheetBackupToggle").checked = data.sheetBackupEnabled !== false;
  if ($("sheetBackupBaseNameInput")) $("sheetBackupBaseNameInput").value = data.sheetBackupBaseName || defaultData.sheetBackupBaseName;
  renderSheetBackupStatus();
  $("backupCleanupToggle").checked = data.backupCleanupEnabled === true;
  $("checkinOptionsInput").value = (data.checkinOptions || defaultData.checkinOptions).join("\n");
  $("passMessagesInput").value = (data.reviewMessages?.pass || defaultData.reviewMessages.pass).join("\n");
  $("failMessagesInput").value = (data.reviewMessages?.fail || defaultData.reviewMessages.fail).join("\n");
}
function collectAdminSettings() {
  data.autoAudit = false;
  data.sheetBackupEnabled = $("sheetBackupToggle").checked;
  data.sheetBackupBaseName = safeBackupBaseName($("sheetBackupBaseNameInput")?.value || data.sheetBackupBaseName || defaultData.sheetBackupBaseName);
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
function specialtyTierOptions() {
  return ["爆贴专业", "测试专业", "刚测能跑"];
}
function specialtyStatusOptions() {
  return ["持续爆", "下滑", "持平", "观察", "暂停"];
}
function specialtyCategoryOptions() {
  return ["逐个出字", "滚动字幕", "祷告词模板", "改贴图文", "其他"];
}
function activeSpecialty() {
  const list = data.fbSpecialties || [];
  if (!activeSpecialtyId && list.length) activeSpecialtyId = list[0].id;
  return list.find((item) => item.id === activeSpecialtyId) || null;
}
function specialtyBadgeClass(value) {
  if (/爆|持续/.test(value)) return "good";
  if (/下滑|暂停/.test(value)) return "bad";
  return "";
}
function renderSpecialties() {
  if (!$("specialtyList")) return;
  data.fbSpecialties = normalizeFbSpecialties(data.fbSpecialties || []);
  const list = data.fbSpecialties;
  if (!activeSpecialtyId && list.length) activeSpecialtyId = list[0].id;
  if (activeSpecialtyId && !list.some((item) => item.id === activeSpecialtyId)) activeSpecialtyId = list[0]?.id || "";
  const selected = activeSpecialty();
  $("specialtyHint").textContent = `${list.length} 个专业 · ${selected ? selected.name || "未命名专业" : "请选择或新增"}`;
  $("specialtyList").innerHTML = list.map((item) => `
    <button class="specialty-card ${item.id === activeSpecialtyId ? "active" : ""}" type="button" data-specialty-id="${escapeAttr(item.id)}">
      <span class="specialty-thumb">${item.avatarUrl ? `<img src="${escapeAttr(item.avatarUrl)}" alt="">` : "FB"}</span>
      <span>
        <strong>${escapeHtml(item.name || "未命名专业")}</strong>
        <small>${escapeHtml(item.tier)} · ${escapeHtml(item.status)} · ${escapeHtml(item.category)}</small>
      </span>
    </button>
  `).join("") || `<div class="hint">还没有专业，先新增一个。</div>`;
  $("specialtyList").querySelectorAll("[data-specialty-id]").forEach((button) => {
    button.onclick = () => {
      activeSpecialtyId = button.dataset.specialtyId || "";
      renderSpecialties();
    };
  });
  renderSpecialtyEditor(selected);
  renderSpecialtyReels(selected);
}
function renderSpecialtyEditor(item) {
  const ids = ["specialtyFbUrl", "specialtyName", "specialtyAvatarUrl", "specialtyBannerUrl", "specialtyVideoOwner", "specialtyOperator", "specialtyTier", "specialtyStatus", "specialtyCategory", "specialtyNotes"];
  ids.forEach((id) => { if ($(id)) $(id).disabled = !item; });
  if (!item) {
    ["specialtyFbUrl", "specialtyName", "specialtyAvatarUrl", "specialtyBannerUrl", "specialtyVideoOwner", "specialtyOperator", "specialtyNotes"].forEach((id) => { if ($(id)) $(id).value = ""; });
    $("specialtyPreview").innerHTML = `<div class="hint">选择一个专业后查看资料。</div>`;
    return;
  }
  $("specialtyFbUrl").value = item.fbUrl || "";
  $("specialtyName").value = item.name || "";
  $("specialtyAvatarUrl").value = item.avatarUrl || "";
  $("specialtyBannerUrl").value = item.bannerUrl || "";
  $("specialtyVideoOwner").value = item.videoOwner || "";
  $("specialtyOperator").value = item.operator || "";
  $("specialtyNotes").value = item.notes || "";
  $("specialtyTier").innerHTML = specialtyTierOptions().map((option) => `<option ${item.tier === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  $("specialtyStatus").innerHTML = specialtyStatusOptions().map((option) => `<option ${item.status === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  $("specialtyCategory").innerHTML = specialtyCategoryOptions().map((option) => `<option ${item.category === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  $("specialtyPreview").innerHTML = `
    <div class="specialty-banner" style="${item.bannerUrl ? `background-image:url('${escapeAttr(item.bannerUrl)}')` : ""}"></div>
    <div class="specialty-preview-main">
      <span class="specialty-avatar">${item.avatarUrl ? `<img src="${escapeAttr(item.avatarUrl)}" alt="">` : "FB"}</span>
      <div>
        <strong>${escapeHtml(item.name || "未命名专业")}</strong>
        <small>${escapeHtml(item.fbUrl || "未填写链接")}</small>
      </div>
      <span class="specialty-pill ${specialtyBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
    </div>
  `;
}
function saveActiveSpecialty() {
  const item = activeSpecialty();
  if (!item) return;
  item.fbUrl = $("specialtyFbUrl").value.trim();
  item.name = $("specialtyName").value.trim();
  item.avatarUrl = $("specialtyAvatarUrl").value.trim();
  item.bannerUrl = $("specialtyBannerUrl").value.trim();
  item.videoOwner = $("specialtyVideoOwner").value.trim();
  item.operator = $("specialtyOperator").value.trim();
  item.tier = $("specialtyTier").value || "测试专业";
  item.status = $("specialtyStatus").value || "观察";
  item.category = $("specialtyCategory").value || "逐个出字";
  item.notes = $("specialtyNotes").value.trim();
  persistLocal();
  scheduleSave("admin");
  renderSpecialties();
}
function addSpecialty() {
  const item = normalizeFbSpecialties([{ name: "新专业", tier: "测试专业", status: "观察", category: "逐个出字" }])[0];
  data.fbSpecialties = normalizeFbSpecialties([...(data.fbSpecialties || []), item]);
  activeSpecialtyId = item.id;
  persistLocal();
  scheduleSave("admin");
  renderSpecialties();
}
function deleteActiveSpecialty() {
  const item = activeSpecialty();
  if (!item) return;
  if (!confirm(`确定删除专业“${item.name || "未命名专业"}”？`)) return;
  data.fbSpecialties = (data.fbSpecialties || []).filter((entry) => entry.id !== item.id);
  activeSpecialtyId = data.fbSpecialties[0]?.id || "";
  persistLocal();
  scheduleSave("admin");
  renderSpecialties();
}
function renderSpecialtyReels(item) {
  const body = $("specialtyReelBody");
  if (!body) return;
  $("specialtyReelHint").textContent = item ? `${item.reels.length} 条视频 · ${item.name || "未命名专业"}` : "请选择专业";
  if (!item) {
    body.innerHTML = `<tr><td colspan="9" class="hint">请选择或新增一个专业。</td></tr>`;
    return;
  }
  body.innerHTML = item.reels.map((reel) => `
    <tr>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="url" value="${escapeAttr(reel.url)}" placeholder="Reels链接"></td>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="title" value="${escapeAttr(reel.title)}" placeholder="标题/钩子"></td>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="date" type="date" value="${escapeAttr(reel.date)}"></td>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="views" type="number" step="1" min="0" value="${reel.views === "" ? "" : Number(reel.views || 0)}"></td>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="interactions" type="number" step="1" min="0" value="${reel.interactions === "" ? "" : Number(reel.interactions || 0)}"></td>
      <td><select data-specialty-reel="${escapeAttr(reel.id)}" data-field="result">${["跑得好", "一般", "不好", "观察"].map((option) => `<option ${reel.result === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></td>
      <td><input data-specialty-reel="${escapeAttr(reel.id)}" data-field="owner" value="${escapeAttr(reel.owner)}" placeholder="负责人"></td>
      <td><textarea data-specialty-reel="${escapeAttr(reel.id)}" data-field="notes" rows="2" placeholder="封面/钩子/节奏/素材复盘">${escapeHtml(reel.notes)}</textarea></td>
      <td><button class="icon" type="button" data-remove-specialty-reel="${escapeAttr(reel.id)}" title="删除视频">×</button></td>
    </tr>
  `).join("") || `<tr><td colspan="9" class="hint">还没有视频，先新增一条。</td></tr>`;
  body.querySelectorAll("[data-specialty-reel]").forEach((input) => {
    input.onchange = () => updateSpecialtyReel(input);
  });
  body.querySelectorAll("[data-remove-specialty-reel]").forEach((button) => {
    button.onclick = () => removeSpecialtyReel(button.dataset.removeSpecialtyReel || "");
  });
}
function addSpecialtyReel() {
  const item = activeSpecialty();
  if (!item) return;
  item.reels.push(normalizeFbSpecialties([{ reels: [{ result: "观察", owner: item.videoOwner || "" }] }])[0].reels[0]);
  persistLocal();
  scheduleSave("admin");
  renderSpecialtyReels(item);
}
function updateSpecialtyReel(input) {
  const item = activeSpecialty();
  const reel = item?.reels.find((entry) => entry.id === input.dataset.specialtyReel);
  if (!reel) return;
  const field = input.dataset.field || "";
  reel[field] = ["views", "interactions"].includes(field)
    ? (input.value === "" ? "" : Number(input.value || 0))
    : input.value.trim();
  persistLocal();
  scheduleSave("admin");
}
function removeSpecialtyReel(id) {
  const item = activeSpecialty();
  if (!item) return;
  item.reels = item.reels.filter((reel) => reel.id !== id);
  persistLocal();
  scheduleSave("admin");
  renderSpecialtyReels(item);
}
function render() {
  ensureCurrentMemberVisible();
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
  renderFreeTable();
  renderSpecialties();
  renderSummaryFolders();
  renderAdminCenterPanel();
  renderReportSourceTabs();
  $("quotaInput").value = String(data.quota);
  if ($("completeQuotaInput")) $("completeQuotaInput").value = data.completeQuota === "" || data.completeQuota === undefined || data.completeQuota === null ? "" : String(data.completeQuota);
  if ($("workloadQuotaInput")) $("workloadQuotaInput").value = data.workloadQuota === "" || data.workloadQuota === undefined || data.workloadQuota === null ? "" : String(data.workloadQuota);
  preview();
}
function flushEntryDraftToRecords() {
  window.clearTimeout(draftTimer);
  if (!appUnlocked || !$("entryInputs") || !$("dateInput")) return null;
  try {
    return saveFormSilently();
  } catch {
    return null;
  }
}
function ensureMixedRangeIncludesCurrentDate() {
  const startInput = $("mixedTableStart");
  const endInput = $("mixedTableEnd");
  const start = startInput?.value || "";
  const end = endInput?.value || "";
  if (start && end && currentDate >= start && currentDate <= end) return;
  mixedTableRangeMode = "week";
  mixedExportMonths = [];
  const range = weekRangeFor(currentDate);
  if ($("mixedTableRangeMode")) $("mixedTableRangeMode").value = mixedTableRangeMode;
  if (startInput) startInput.value = range.start;
  if (endInput) endInput.value = range.end;
}
function prepareMixedTableFromCurrentEntry(options = {}) {
  flushEntryDraftToRecords();
  if (activeReportSource !== "current") {
    activeReportSource = "current";
    renderReportSourceTabs();
  }
  const group = data.memberGroups?.[currentMember] || data.groups?.[0] || "";
  if (group) {
    mixedTableGroup = group;
    mixedCheckinGroup = group;
  }
  mixedTableMember = currentMember;
  if (options.ensureRange) ensureMixedRangeIncludesCurrentDate();
}
async function syncTodayToMixedTable(event) {
  const button = event?.currentTarget || $("syncTodayToMixedBtn");
  const originalText = button?.textContent || "";
  if (button) {
    button.textContent = "同步中...";
    button.disabled = true;
  }
  prepareMixedTableFromCurrentEntry({ ensureRange: true });
  renderMixedOverviewTable();
  const result = await persistEverywhere("records").catch((error) => ({ written: false, error }));
  renderMixedOverviewTable();
  if (button) {
    button.textContent = result?.written ? "已同步" : "已本地同步";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  }
  if (!result?.written) {
    showDialog("已同步到混合表格", "今日面板已先写入本机记录并刷新混合表格；云端暂时没写成功，请看同步状态。", "");
  }
}
function setView(view) {
  const previousView = activeView;
  if (previousView === "entry" && view !== "entry") flushEntryDraftToRecords();
  if (view === "admin" && !adminUnlocked) {
    const password = prompt("请输入管理员密码");
    const ok = (data.adminPassword && password === String(data.adminPassword)) || (appSessionPassword && password === appSessionPassword);
    if (!ok) {
      alert("管理员密码不正确。");
      return;
    }
    adminUnlocked = true;
  }
  if (view === "mixed" && previousView === "entry") prepareMixedTableFromCurrentEntry({ ensureRange: true });
  activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  if (view === "mixed") renderMixedOverviewTable();
  else renderOverview();
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
  await loadCloudSyncConfig();
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
  showDialog(clear ? "备用云地址已清空" : "备用云地址已保存", clear ? (cloudSyncEndpoint ? `已清空本机手动地址，当前使用 Vercel 环境变量下发的 Worker 地址：${cloudSyncEndpoint}` : "当前没有 Worker 地址，云同步会回到 Vercel 默认接口。") : `当前云同步会优先连接：${cloudSyncEndpoint}`, "");
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
    ensureCurrentMemberVisible();
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
  ensureCurrentMemberVisible();
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
    ensureCurrentMemberVisible();
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
      ensureCurrentMemberVisible();
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
  ensureCurrentMemberVisible();
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
    <Style ss:ID="sTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#000000"/><Interior ss:Color="#D95F5F" ss:Pattern="Solid"/>${borders}</Style>
    <Style ss:ID="sHeader"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#000000"/><Interior ss:Color="#E57373" ss:Pattern="Solid"/>${borders}</Style>
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
        ${rows.map((rowSpec) => {
          const row = Array.isArray(rowSpec) ? rowSpec : (rowSpec.cells || []);
          return `<Row>${row.map(styledCellXml).join("")}</Row>`;
        }).join("")}
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
  const visibleMembers = new Set(reportMembers(data));
  const records = recordsInLastMonths(3).filter((rec) => visibleMembers.has(rec.member));
  const header = ["日期", "成员", "分组", ...itemNames, "原始", "成品量", "一级定额", "完全定额", "换算工作量", "尽本分时长", "一级差额", "视频成品", "AI成品", "状态", "备注"];
  const recordRow = (rec) => {
    const quota = memberQuota(rec.member, rec.date);
    const completeQuota = memberCompleteQuota(rec.member, rec.date);
    const products = productTotalsForItems(rec.items || {}, itemNames, data);
    const productTotal = productTotalValue(products);
    const weighted = totalsForItems(rec.items || {}, itemNames, data).weighted;
    return [
      rec.date,
      rec.member,
      data.memberGroups?.[rec.member] || "",
      ...itemNames.map((name) => Number(rec.items?.[name] || 0)),
      Number(rec.raw_total || 0),
      productTotal,
      quota,
      completeQuota,
      weighted,
      dutyHoursValue(rec),
      productTotal - quota,
      products.video,
      products.ai,
      rec.status || "",
      rec.reason || rec.harvest || rec.diary || ""
    ];
  };
  const summaryRows = [["成员", "分组", "总成品量", "总一级定额", "总完全定额", "总换算工作量", "总尽本分时长", "总一级差额", "状态", "视频成品", "AI成品", ...itemNames]];
  reportMembers(data).forEach((member) => {
    const own = records.filter((rec) => rec.member === member);
    const weighted = own.reduce((sum, rec) => sum + totalsForItems(rec.items || {}, itemNames, data).weighted, 0);
    const quota = own.reduce((sum, rec) => sum + memberQuota(member, rec.date), 0);
    const completeQuota = own.reduce((sum, rec) => sum + memberCompleteQuota(member, rec.date), 0);
    const dutyHours = own.reduce((sum, rec) => sum + dutyHoursValue(rec), 0);
    const products = own.reduce((sum, rec) => {
      const next = productTotalsForItems(rec.items || {}, itemNames, data);
      sum.video += next.video;
      sum.ai += next.ai;
      return sum;
    }, { video: 0, ai: 0 });
    const productTotal = productTotalValue(products);
    summaryRows.push([
      member,
      data.memberGroups?.[member] || "",
      productTotal,
      quota,
      completeQuota,
      weighted,
      dutyHours,
      productTotal - quota,
      quotaStatusFromTotals(productTotal, quota, completeQuota),
      products.video,
      products.ai,
      ...itemNames.map((name) => own.reduce((sum, rec) => sum + Number(rec.items?.[name] || 0), 0))
    ]);
  });
  const sheets = [
    rowsToWorksheet("总览", summaryRows),
    rowsToWorksheet("全部记录", [header, ...records.map(recordRow)]),
    ...reportMembers(data).map((member) => rowsToWorksheet(member, [header, ...records.filter((rec) => rec.member === member).map(recordRow)]))
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
function xlsxValidationXml(validation) {
  const values = (validation.values || []).map((value) => String(value || "").replace(/"/g, '""')).filter(Boolean);
  if (!values.length || !validation.sqref) return "";
  return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${xmlEscape(validation.sqref)}"><formula1>"${xmlEscape(values.join(","))}"</formula1></dataValidation>`;
}
function rowsToXlsxWorksheet(rows, columns = [], options = {}) {
  const merges = [];
  const rowXml = rows.map((rowSpec, rowIndex) => {
    const row = Array.isArray(rowSpec) ? rowSpec : (rowSpec.cells || []);
    const attrs = [
      `r="${rowIndex + 1}"`,
      rowSpec.outlineLevel ? `outlineLevel="${Number(rowSpec.outlineLevel)}"` : "",
      rowSpec.hidden ? 'hidden="1"' : "",
      rowSpec.collapsed ? 'collapsed="1"' : "",
      rowSpec.height ? `ht="${Number(rowSpec.height)}" customHeight="1"` : ""
    ].filter(Boolean).join(" ");
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
    return `<row ${attrs}>${cells}</row>`;
  }).join("");
  const cols = columns.length
    ? `<cols>${columns.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(6, Number(width || 48) / 7)}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const validations = Array.isArray(options.validations) ? options.validations.map(xlsxValidationXml).filter(Boolean) : [];
  const validationXml = validations.length ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>
  ${cols}
  <sheetData>${rowXml}</sheetData>
  ${mergeXml}
  ${validationXml}
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
    ${xf(3, 2, "center", true)}
    ${xf(4, 2, "center", true)}
    ${xf(5, 2)}
    ${xf(6)}
    ${xf(7, 2)}
    ${xf(8)}
    ${xf(9)}
    ${xf(10)}
    ${xf(11, 0, "left", true)}
    ${xf(12, 2, "center", true)}
    ${xf(13, 1, "center", true)}
    ${xf(14, 2, "center", true)}
    ${xf(15, 2, "center", true)}
    ${xf(16)}
    ${xf(17, 2)}
    ${xf(10, 3)}
    ${xf(2)}
  </cellXfs>
</styleSheet>`;
}
function uniqueSheetName(name, used = new Set()) {
  const base = sheetNameSafe(name || "Sheet").slice(0, 31) || "Sheet";
  let next = base;
  let index = 2;
  while (used.has(next)) {
    const suffix = ` ${index}`;
    next = base.slice(0, 31 - suffix.length) + suffix;
    index += 1;
  }
  used.add(next);
  return next;
}
function buildXlsxWorkbookSheets(sheets = []) {
  const usable = sheets.length ? sheets : [{ name: "Sheet1", rows: [[styledCell("", "sItem")]], columns: [80] }];
  const used = new Set();
  const sheetEntries = usable.map((sheet, index) => ({
    ...sheet,
    id: index + 1,
    relId: `rId${index + 1}`,
    safeName: uniqueSheetName(sheet.name || `Sheet${index + 1}`, used)
  }));
  return createZip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetEntries.map((sheet) => `<Override PartName="/xl/worksheets/sheet${sheet.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map((sheet) => `<sheet name="${xmlEscape(sheet.safeName)}" sheetId="${sheet.id}" r:id="${sheet.relId}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((sheet) => `<Relationship Id="${sheet.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.id}.xml"/>`).join("")}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: xlsxStylesXml() },
    ...sheetEntries.map((sheet) => ({ name: `xl/worksheets/sheet${sheet.id}.xml`, content: rowsToXlsxWorksheet(sheet.rows || [], sheet.columns || [], { validations: sheet.validations || [] }) }))
  ]);
}
function buildXlsxWorkbook(sheetName, rows, columns = [], options = {}) {
  return buildXlsxWorkbookSheets([{ name: sheetName, rows, columns, validations: options.validations || [] }]);
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
  return { start, end, days: buildDateRange(start, end).reverse() };
}
function mixedTableExportPeriods(report) {
  if (mixedTableRangeMode === "small-month" || mixedTableRangeMode === "month") {
    return selectedMixedExportMonths(report).map((month) => {
      const range = mixedPeriodRangeForMonth(month, mixedTableRangeMode);
      return { month, ...range, days: buildDateRange(range.start, range.end).reverse() };
    });
  }
  const range = mixedTableExportRange();
  return [{ label: mixedRangeInfo().label, month: monthKeyFromDateKey(range.end), ...range }];
}
function buildMixedSummaryText() {
  const report = selectedReportData();
  return withReportData(report, () => {
    const periods = mixedTableExportPeriods(report);
    const days = periods.flatMap((period) => period.days || []);
    const group = $('mixedTableGroup')?.value || mixedTableGroup || report.groups?.[0] || '';
    const members = membersForGroupValue(group, report);
    const member = members.includes(mixedTableMember) ? mixedTableMember : members[0] || '';
    if (!member) return '';
    const itemNames = groupVisibleItems(group, report);
    const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
    let totalQuota = 0;
    let totalConversion = 0;
    let totalVideoProduct = 0;
    let totalAiProduct = 0;
    days.forEach((day) => {
      const rec = recordForReport(report, day, member);
      const items = rec?.items || {};
      const products = productTotalsForItems(items, itemNames, report);
      totalConversion += totalConversionForItems(items, itemNames, report).total;
      totalQuota += memberQuota(member, day);
      totalVideoProduct += products.video;
      totalAiProduct += products.ai;
      itemNames.forEach((name) => {
        itemTotals[name] += Number(items[name] || 0);
      });
    });
    const totalProduct = productTotalValue({ video: totalVideoProduct, ai: totalAiProduct });
    const diff = totalProduct - totalQuota;
    const status = cleanTotalValue(diff) >= 0 ? "达标" : "未达标";
    const detail = Object.entries(itemTotals)
      .filter(([, amount]) => cleanTotalValue(amount) !== 0)
      .map(([name, amount]) => `${name}：${fmtTotal(amount)}`)
      .join('，') || '暂无项目明细';
    return [
      `视频成品：${fmtTotal(totalProduct)}`,
      `定额：${fmtTotal(totalQuota)}`,
      `差额：${signedTotalText(diff)}`,
      `状态：${status}`,
      `辅助AI成品：${fmtTotal(totalAiProduct)}`,
      `总数换算量：${fmtTotalConversion(totalConversion)}天`,
      `项目明细：${detail}`
    ].join('\n');
  });
}
function buildMixedConversionDetailText() {
  const report = selectedReportData();
  return withReportData(report, () => {
    const periods = mixedTableExportPeriods(report);
    const days = periods.flatMap((period) => period.days || []);
    const group = $('mixedTableGroup')?.value || mixedTableGroup || report.groups?.[0] || '';
    const members = membersForGroupValue(group, report);
    const member = members.includes(mixedTableMember) ? mixedTableMember : members[0] || '';
    if (!member) return '';
    const itemNames = groupVisibleItems(group, report);
    const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
    days.forEach((day) => {
      const items = recordForReport(report, day, member)?.items || {};
      itemNames.forEach((name) => {
        itemTotals[name] += Number(items[name] || 0);
      });
    });
    const rangeTextValue = periods
      .map((period) => `${period.label || period.month || ''}${period.start && period.end ? ` ${period.start} 至 ${period.end}` : ''}`.trim())
      .filter(Boolean)
      .join('；') || `${days[days.length - 1] || ''} 至 ${days[0] || ''}`;
    const detailLines = Object.entries(itemTotals)
      .filter(([, amount]) => cleanTotalValue(amount) !== 0)
      .map(([name, amount]) => {
        const quota = totalConversionQuotaForItem(name, report);
        if (quota <= 0) return `${name}：${fmtTotal(amount)} 除以 未设置总数日量 = 暂无法换算`;
        return `${name}：${fmtTotal(amount)} 除以 ${fmtTotal(quota)} = ${fmtTotalConversion(amount / quota)}天`;
      });
    const totalConversion = totalConversionForItems(itemTotals, itemNames, report).total;
    return [
      `${group} · ${member} 总数换算细节`,
      `范围：${rangeTextValue}`,
      ...(detailLines.length ? detailLines : ['暂无项目数量。']),
      `合计总数换算量：${fmtTotalConversion(totalConversion)}天`
    ].join('\n');
  });
}
function legacyCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for browsers with stricter permissions.
    }
  }
  return legacyCopyText(text);
}
async function copyMixedSummaryText(event) {
  const text = buildMixedSummaryText();
  if (!text) return showDialog("暂无可复制内容", "请先选择小组和成员。", "");
  const button = event?.currentTarget || $("copyMixedSummaryBtn");
  const originalText = button?.textContent || "";
  if (button) {
    button.textContent = "复制中...";
    button.disabled = true;
  }
  const ok = await copyTextToClipboard(text);
  if (button) {
    button.textContent = ok ? "已复制" : originalText;
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  }
  if (ok) {
    showDialog("已复制总数", "当前混合表格的总数和项目明细已复制到剪贴板。", "");
  } else {
    showDialog("复制失败", "浏览器没有允许写入剪贴板，请手动查看或导出表格。", "");
  }
}
async function copyMixedConversionDetailText(event) {
  const text = buildMixedConversionDetailText();
  if (!text) return showDialog("暂无可复制内容", "请先选择小组和成员。", "");
  const button = event?.currentTarget || $("copyMixedConversionDetailBtn");
  const originalText = button?.textContent || "";
  if (button) {
    button.textContent = "复制中...";
    button.disabled = true;
  }
  const ok = await copyTextToClipboard(text);
  if (button) {
    button.textContent = ok ? "已复制" : originalText;
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  }
  if (ok) {
    showDialog("已复制换算细节", "每个项目的数量、总数日量和换算天数已复制到剪贴板。", "");
  } else {
    showDialog("复制失败", "浏览器没有允许写入剪贴板，请手动查看或导出表格。", "");
  }
}
function mixedMonthlyActualStyledCells(part, itemNames) {
  return [
    ...itemNames.map((name) => styledTotalCell(part.items?.[name] || 0, "sItem")),
    styledTotalCell(part.productTotal || 0, "sTotal"),
    styledTotalCell(part.video || 0, "sItem"),
    styledTotalCell(part.ai || 0, "sItem"),
    styledTotalCell(part.weighted || 0, "sTotal"),
    styledCell(fmtTotalConversion(part.totalConversion || 0), "sTotal"),
    styledCell(`${fmt(part.totalConversionSaturation || 0)}%`, (part.totalConversionSaturation || 0) >= 100 ? "sDiffGood" : "sItem"),
    styledTotalCell(part.quota || 0, "sQuota"),
    styledTotalCell(part.diff || 0, cleanTotalValue(part.diff || 0) >= 0 ? "sDiffGood" : "sDiffBad")
  ];
}
function mixedMonthlyDeltaStyledCells(delta, itemNames) {
  return [
    ...itemNames.map((name) => {
      const value = cleanTotalValue(delta.items?.[name] || 0);
      return styledCell(value, value >= 0 ? "sDiffGood" : "sDiffBad");
    }),
    styledTotalCell(delta.productTotal || 0, cleanTotalValue(delta.productTotal || 0) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(delta.video || 0, cleanTotalValue(delta.video || 0) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(delta.ai || 0, cleanTotalValue(delta.ai || 0) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(delta.weighted || 0, cleanTotalValue(delta.weighted || 0) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledCell(signedText(delta.totalConversion || 0), Number(delta.totalConversion || 0) >= 0 ? "sDiffGood" : "sDiffBad")
  ];
}
function mixedMonthlyPlanStyledCells(plan, itemNames) {
  return [
    ...itemNames.map((name) => styledTotalCell(plan.items?.[name] || 0, "sItem")),
    styledTotalCell(plan.productTotal || 0, "sTotal"),
    styledTotalCell(plan.video || 0, "sItem"),
    styledTotalCell(plan.ai || 0, "sItem"),
    styledTotalCell(plan.weighted || 0, "sTotal"),
    styledCell(fmtTotalConversion(plan.totalConversion || 0), "sTotal"),
    styledCell(`${fmt(plan.totalConversionSaturation || 0)}%`, (plan.totalConversionSaturation || 0) >= 100 ? "sDiffGood" : "sItem"),
    styledTotalCell(plan.quota || 0, "sQuota"),
    styledTotalCell(plan.actual || 0, "sTotal"),
    styledCell(`${fmt(plan.rate || 0)}%`, cleanTotalValue(plan.diff || 0) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(plan.diff || 0, cleanTotalValue(plan.diff || 0) >= 0 ? "sDiffGood" : "sDiffBad")
  ];
}
function mixedMonthlyReportColumns(itemCount) {
  const actual = [...Array.from({ length: itemCount }, () => 60), 68, 64, 64, 78, 82, 64, 72, 70];
  const delta = [...Array.from({ length: itemCount }, () => 60), 76, 64, 64, 72, 82];
  const plan = [...Array.from({ length: itemCount }, () => 60), 82, 70, 70, 78, 82, 64, 82, 76, 58, 76];
  return [72, ...actual, ...actual, ...delta, ...plan];
}
function mixedMonthlyReportExportBlock(group, report) {
  const { info, itemNames, rows, total } = mixedMonthlyReportData(report);
  const labels = mixedMonthlyReportLabels(itemNames);
  const blockWidth = 1 + labels.actual.length * 2 + labels.delta.length + labels.plan.length;
  const planTitle = `${info.next.label.replace("汇总", "计划")} · ${rangeText(info.next)}`;
  const rowCells = (row) => [
    styledCell(row.member, row.member === "合计" ? "sDate" : "sItem"),
    ...mixedMonthlyActualStyledCells(row.current, itemNames),
    ...mixedMonthlyActualStyledCells(row.previous, itemNames),
    ...mixedMonthlyDeltaStyledCells(row.delta, itemNames),
    ...mixedMonthlyPlanStyledCells(row.plan, itemNames)
  ];
  const exportRows = [
    [styledCell(`人员月度总览｜${group || "未分组"}｜${info.current.label} 对比 ${info.previous.label}｜计划期 ${rangeText(info.next)}`, "sTitle", { mergeAcross: blockWidth - 1 })],
    [
      styledCell("姓名", "sHeader"),
      styledCell(`${info.current.label} · ${rangeText(info.current)}`, "sHeader", { mergeAcross: labels.actual.length - 1 }),
      styledCell(`${info.previous.label} · ${rangeText(info.previous)}`, "sHeader", { mergeAcross: labels.actual.length - 1 }),
      styledCell("差额：当前 - 上期", "sHeader", { mergeAcross: labels.delta.length - 1 }),
      styledCell(planTitle, "sHeader", { mergeAcross: labels.plan.length - 1 })
    ],
    ["姓名", ...labels.actual, ...labels.actual, ...labels.delta, ...labels.plan].map((label) => styledCell(label, "sHeader")),
    rowCells(total),
    ...rows.map((row) => rowCells(row))
  ];
  return { rows: exportRows, columns: mixedMonthlyReportColumns(itemNames.length), blockWidth };
}
function mergeColumnWidths(...widthSets) {
  const maxLength = Math.max(...widthSets.map((set) => set.length), 0);
  return Array.from({ length: maxLength }, (_, index) => Math.max(...widthSets.map((set) => Number(set[index] || 0)), 48));
}
function mixedExportTypeValue() {
  const value = $("mixedExportType")?.value || "all";
  return ["all", "monthly", "detail", "checkin"].includes(value) ? value : "all";
}
function mixedExportTypeLabel(type) {
  return {
    all: "全部表格",
    monthly: "人员月度总览",
    detail: "混合明细",
    checkin: "小组打卡表"
  }[type] || "全部表格";
}
function mixedCheckinExportGroup(report, fallbackGroup) {
  const groups = report.groups || [];
  if (groups.includes(mixedCheckinGroup)) return mixedCheckinGroup;
  if (groups.includes(fallbackGroup)) return fallbackGroup;
  return groups[0] || fallbackGroup || "";
}
function mixedCheckinExportBlock(exportPeriods, group, report) {
  const members = membersForGroupValue(group, report);
  const periods = checkinPeriods();
  const blockWidth = 2 + periods.length;
  const rows = [
    [styledCell(`小组打卡表｜${group || "未分组"}`, "sTitle", { mergeAcross: blockWidth - 1 })]
  ];
  exportPeriods.forEach((period, index) => {
    if (index > 0) rows.push([styledCell("", "sSpacer", { mergeAcross: blockWidth - 1 })]);
    rows.push([styledCell(`${period.label}｜${period.start} 至 ${period.end}`, "sTitle", { mergeAcross: blockWidth - 1 })]);
    rows.push(["日期", "成员", ...periods.map((item) => `${item.label}打卡`)].map((label) => styledCell(label, "sHeader")));
    period.days.forEach((day) => {
      members.forEach((member) => {
        const rec = recordForReport(report, day, member);
        rows.push([
          styledCell(day.slice(5), "sDate"),
          styledCell(member, "sItem"),
          ...periods.map((item) => styledCell(checkinDisplay(rec?.checkins?.[item.key]), mixedExportCheckinStyle(rec?.checkins?.[item.key])))
        ]);
      });
    });
  });
  return { rows, columns: [54, 90, ...periods.map(() => 74)], blockWidth };
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
  const header = [`${index + 1} ${member}`, ...periods.map((period) => `${period.label}打卡`), ...itemNames, "原始", "成品量", "一级定额", "完全定额", "换算工作量", "工作量定额", "工作量差额", "尽本分时长", "一级差额", "视频成品", "AI成品", "状态", "备注"];
  const itemTotals = Object.fromEntries(itemNames.map((name) => [name, 0]));
  const records = days.map((day) => {
    const rec = recordForReport(report, day, member);
    const items = rec?.items || {};
    itemNames.forEach((name) => {
      itemTotals[name] += Number(items[name] || 0);
    });
    const totals = totalsForItems(items, itemNames, report);
    const products = productTotalsForItems(items, itemNames, report);
    const productTotal = productTotalValue(products);
    const quota = memberQuota(member, day);
    const completeQuota = memberCompleteQuota(member, day);
    const workloadQuota = memberWorkloadQuota(member, day);
    const dutyHours = dutyHoursValue(rec);
    const diff = productTotal - quota;
    const completeDiff = productTotal - completeQuota;
    const status = rec?.status || quotaStatusFromTotals(productTotal, quota, completeQuota);
    return { day, rec, items, raw: totals.raw, weighted: totals.weighted, productTotal, quota, completeQuota, workloadQuota, workloadDiff: totals.weighted - workloadQuota, dutyHours, diff, completeDiff, video: products.video, ai: products.ai, status };
  });
  const totalRaw = records.reduce((sum, row) => sum + row.raw, 0);
  const totalProduct = records.reduce((sum, row) => sum + row.productTotal, 0);
  const totalWeighted = records.reduce((sum, row) => sum + row.weighted, 0);
  const totalQuota = records.reduce((sum, row) => sum + row.quota, 0);
  const totalCompleteQuota = records.reduce((sum, row) => sum + row.completeQuota, 0);
  const totalWorkloadQuota = records.reduce((sum, row) => sum + row.workloadQuota, 0);
  const totalWorkloadDiff = totalWeighted - totalWorkloadQuota;
  const totalDutyHours = records.reduce((sum, row) => sum + Number(row.dutyHours || 0), 0);
  const totalDiff = totalProduct - totalQuota;
  const totalStatus = quotaStatusFromTotals(totalProduct, totalQuota, totalCompleteQuota);
  const totalVideo = records.reduce((sum, row) => sum + row.video, 0);
  const totalAi = records.reduce((sum, row) => sum + row.ai, 0);
  const blockWidth = header.length;
  const title = `${index + 1} ${member}｜${group || "未分组"}｜成品量 ${fmtTotal(totalProduct)}｜一级定额 ${fmtTotal(totalQuota)}｜完全定额 ${fmtTotal(totalCompleteQuota)}｜状态 ${totalStatus}｜一级差额 ${fmtTotal(totalDiff)}｜换算工作量 ${fmtTotal(totalWeighted)}｜工作量定额 ${fmtTotal(totalWorkloadQuota)}｜工作量差额 ${totalWorkloadQuota ? signedTotalText(totalWorkloadDiff) : "未设置"}`;
  const rows = [
    [styledCell(title, "sTitle", { mergeAcross: blockWidth - 1 })],
    header.map((label) => styledCell(label, "sHeader")),
    [
      styledCell("合计", "sDate"),
      ...periods.map(() => styledCell("", "sCheckinBlank")),
      ...itemNames.map((name) => styledTotalCell(itemTotals[name] || 0, "sItem")),
      styledTotalCell(totalRaw, "sTotal"),
      styledTotalCell(totalProduct, "sTotal"),
      styledTotalCell(totalQuota, "sQuota"),
      styledTotalCell(totalCompleteQuota, "sQuota"),
      styledTotalCell(totalWeighted, "sTotal"),
      styledTotalCell(totalWorkloadQuota, "sQuota"),
      styledTotalCell(totalWorkloadDiff, totalWorkloadQuota ? (cleanTotalValue(totalWorkloadDiff) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
      styledTotalCell(totalDutyHours, "sTotal"),
      styledTotalCell(totalDiff, cleanTotalValue(totalDiff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledTotalCell(totalVideo, "sTotal"),
      styledTotalCell(totalAi, "sTotal"),
      styledCell(totalStatus, mixedExportStatusStyle(totalStatus)),
      styledCell("", "sNote")
    ],
    ...records.map(({ day, rec, items, raw, productTotal, quota, completeQuota, weighted, workloadQuota, workloadDiff, dutyHours, diff, video, ai, status }) => [
      styledCell(day.slice(5), "sDate"),
      ...periods.map((period) => styledCell(checkinDisplay(rec?.checkins?.[period.key]), mixedExportCheckinStyle(rec?.checkins?.[period.key]))),
      ...itemNames.map((name) => styledCell(Number(items[name] || 0) || "", "sItem")),
      styledTotalCell(raw, "sTotal"),
      styledTotalCell(productTotal, "sTotal"),
      styledTotalCell(quota, "sQuota"),
      styledTotalCell(completeQuota, "sQuota"),
      styledTotalCell(weighted, "sTotal"),
      styledTotalCell(workloadQuota, "sQuota"),
      styledTotalCell(workloadDiff, workloadQuota ? (cleanTotalValue(workloadDiff) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
      styledTotalCell(dutyHours, "sTotal"),
      styledTotalCell(diff, cleanTotalValue(diff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledTotalCell(video, "sTotal"),
      styledTotalCell(ai, "sTotal"),
      styledCell(status || "", mixedExportStatusStyle(status || "")),
      styledCell(rec?.reason || rec?.harvest || rec?.diary || "", "sNote")
    ])
  ];
  return { rows, blockWidth };
}
function mixedExportGroupBlock(days, members, itemNames, report) {
  const records = days.map((day) => {
    let weighted = 0;
    let quota = 0;
    let completeQuota = 0;
    let workloadQuota = 0;
    let video = 0;
    let ai = 0;
    members.forEach((member) => {
      const rec = recordForReport(report, day, member);
      const items = rec?.items || {};
      const totals = totalsForItems(items, itemNames, report);
      const products = productTotalsForItems(items, itemNames, report);
      weighted += totals.weighted;
      video += products.video;
      ai += products.ai;
      quota += memberQuota(member, day);
      completeQuota += memberCompleteQuota(member, day);
      workloadQuota += memberWorkloadQuota(member, day);
    });
    const productTotal = productTotalValue({ video, ai });
    const diff = productTotal - quota;
    const workloadDiff = weighted - workloadQuota;
    const status = quotaStatusFromTotals(productTotal, quota, completeQuota);
    return { day, weighted, workloadQuota, workloadDiff, productTotal, quota, completeQuota, diff, completeDiff: productTotal - completeQuota, status, video, ai };
  });
  const totalWeighted = records.reduce((sum, row) => sum + row.weighted, 0);
  const totalProduct = records.reduce((sum, row) => sum + row.productTotal, 0);
  const totalQuota = records.reduce((sum, row) => sum + row.quota, 0);
  const totalCompleteQuota = records.reduce((sum, row) => sum + row.completeQuota, 0);
  const totalWorkloadQuota = records.reduce((sum, row) => sum + row.workloadQuota, 0);
  const totalWorkloadDiff = totalWeighted - totalWorkloadQuota;
  const totalDiff = totalProduct - totalQuota;
  const totalStatus = quotaStatusFromTotals(totalProduct, totalQuota, totalCompleteQuota);
  const totalVideo = records.reduce((sum, row) => sum + row.video, 0);
  const totalAi = records.reduce((sum, row) => sum + row.ai, 0);
  const rows = [
    [styledCell("全组合计", "sTitle", { mergeAcross: 10 })],
    ["日期", "全组成品量", "全组一级定额", "全组完全定额", "全组换算工作量", "全组工作量定额", "全组工作量差额", "全组一级差额", "状态", "视频成品", "AI成品"].map((label) => styledCell(label, "sHeader")),
    [
      styledCell("合计", "sDate"),
      styledTotalCell(totalProduct, "sTotal"),
      styledTotalCell(totalQuota, "sQuota"),
      styledTotalCell(totalCompleteQuota, "sQuota"),
      styledTotalCell(totalWeighted, "sTotal"),
      styledTotalCell(totalWorkloadQuota, "sQuota"),
      styledTotalCell(totalWorkloadDiff, cleanTotalValue(totalWorkloadDiff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledTotalCell(totalDiff, cleanTotalValue(totalDiff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell(totalStatus, mixedExportStatusStyle(totalStatus)),
      styledTotalCell(totalVideo, "sTotal"),
      styledTotalCell(totalAi, "sTotal")
    ],
    ...records.map((row) => [
      styledCell(row.day.slice(5), "sDate"),
      styledTotalCell(row.productTotal, "sTotal"),
      styledTotalCell(row.quota, "sQuota"),
      styledTotalCell(row.completeQuota, "sQuota"),
      styledTotalCell(row.weighted, "sTotal"),
      styledTotalCell(row.workloadQuota, "sQuota"),
      styledTotalCell(row.workloadDiff, cleanTotalValue(row.workloadDiff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledTotalCell(row.diff, cleanTotalValue(row.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell(row.status, mixedExportStatusStyle(row.status)),
      styledTotalCell(row.video, "sTotal"),
      styledTotalCell(row.ai, "sTotal")
    ])
  ];
  return { rows, blockWidth: 11, totalWeighted, totalWorkloadQuota, totalWorkloadDiff, totalProduct, totalQuota, totalCompleteQuota, totalDiff, totalStatus, totalVideo, totalAi };
}
function mixedExportItemColumnWidths(itemNames) {
  return itemNames.map((name) => Math.min(112, Math.max(60, String(name || "").length * 11)));
}
function mixedExportMemberBlockWidth(itemNames, periods = checkinPeriods()) {
  return 1 + periods.length + itemNames.length + 12;
}
function mixedExportColumnWidths(blockWidth, itemCount, memberCount) {
  const block = [46, ...checkinPeriods().map(() => 48), ...Array.from({ length: itemCount }, () => 68), 74, 70, 70, 82, 82, 82, 74, 74, 74, 74, 58, 112];
  return Array.from({ length: memberCount }, (_, index) => [
    ...block.slice(0, blockWidth),
    ...(index < memberCount - 1 ? [12] : [])
  ]).flat();
}
function mixedExportColumns(blockWidth, itemCount, memberCount) {
  return [48, 70, 70, 80, 70, 12, ...mixedExportColumnWidths(blockWidth, itemCount, memberCount)];
}
function mixedXlsxRow(cells, height, extra = {}) {
  return { cells, ...(height ? { height } : {}), ...extra };
}
function mixedExportRecordNote(rec) {
  return rec?.reason || rec?.harvest || rec?.diary || "";
}
function mixedExportDailyReportText(productTotal, quota, diff, note, dutyHours = 0, weighted = 0) {
  const cleanedDiff = cleanTotalValue(diff);
  const title = cleanedDiff >= 0 ? "超额/达标" : "未达标";
  const lines = [
    `${title}`,
    `成品定额：${fmtTotal(quota)}`,
    `成品量：${fmtTotal(productTotal)}`,
    `换算工作量：${fmtTotal(weighted)}`,
    `尽本分时长：${fmtDutyHours(dutyHours)}`,
    `差额：${signedTotalText(cleanedDiff)}`
  ];
  if (note) lines.push(`备注：${note}`);
  return lines.join("\n");
}
function mixedExportGroupTotals(days, members, itemNames, report) {
  const result = {
    items: Object.fromEntries(itemNames.map((name) => [name, 0])),
    raw: 0,
    weighted: 0,
    productTotal: 0,
    quota: 0,
    completeQuota: 0,
    workloadQuota: 0,
    workloadDiff: 0,
    diff: 0,
    completeDiff: 0,
    status: "待审核",
    video: 0,
    ai: 0,
    dutyHours: 0
  };
  days.forEach((day) => {
    members.forEach((member) => {
      const rec = recordForReport(report, day, member);
      const items = rec?.items || {};
      itemNames.forEach((name) => {
        result.items[name] += Number(items[name] || 0);
      });
      const totals = totalsForItems(items, itemNames, report);
      const products = productTotalsForItems(items, itemNames, report);
      result.raw += totals.raw;
      result.weighted += totals.weighted;
      result.video += products.video;
      result.ai += products.ai;
      result.quota += memberQuota(member, day);
      result.completeQuota += memberCompleteQuota(member, day);
      result.workloadQuota += memberWorkloadQuota(member, day);
      result.dutyHours += dutyHoursValue(rec);
    });
  });
  result.productTotal = productTotalValue({ video: result.video, ai: result.ai });
  result.diff = result.productTotal - result.quota;
  result.completeDiff = result.productTotal - result.completeQuota;
  result.workloadDiff = result.weighted - result.workloadQuota;
  result.status = quotaStatusFromTotals(result.productTotal, result.quota, result.completeQuota);
  return result;
}
function mixedExportGroupDayTotals(day, members, itemNames, report) {
  return mixedExportGroupTotals([day], members, itemNames, report);
}
function mixedExportMemberDay(member, day, itemNames, report) {
  const rec = recordForReport(report, day, member);
  const items = rec?.items || {};
  const totals = totalsForItems(items, itemNames, report);
  const products = productTotalsForItems(items, itemNames, report);
  const productTotal = productTotalValue(products);
  const quota = memberQuota(member, day);
  const completeQuota = memberCompleteQuota(member, day);
  const workloadQuota = memberWorkloadQuota(member, day);
  const dutyHours = dutyHoursValue(rec);
  const diff = productTotal - quota;
  const completeDiff = productTotal - completeQuota;
  const workloadDiff = totals.weighted - workloadQuota;
  const status = rec?.status || quotaStatusFromTotals(productTotal, quota, completeQuota);
  return { rec, items, raw: totals.raw, weighted: totals.weighted, productTotal, quota, completeQuota, workloadQuota, workloadDiff, dutyHours, diff, completeDiff, video: products.video, ai: products.ai, status, note: mixedExportRecordNote(rec) };
}
function mixedExportMemberTotalCells(member, days, itemNames, periods, report) {
  const total = aggregateMemberRange(member, days, report, itemNames);
  return [
    styledCell("合计", "sDate"),
    ...periods.map(() => styledCell("", "sCheckinBlank")),
    ...itemNames.map((name) => styledTotalCell(total.items?.[name] || 0, "sItem")),
    styledTotalCell(total.productTotal || 0, "sTotal"),
    styledTotalCell(total.quota, "sQuota"),
    styledTotalCell(total.completeQuota, "sQuota"),
    styledTotalCell(total.weighted, "sTotal"),
    styledTotalCell(total.workloadQuota || 0, "sQuota"),
    styledTotalCell(total.workloadDiff || 0, total.workloadQuota ? (cleanTotalValue(total.workloadDiff || 0) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
    styledTotalCell(total.dutyHours || 0, "sTotal"),
    styledTotalCell(total.diff, cleanTotalValue(total.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(total.video, "sTotal"),
    styledTotalCell(total.ai, "sTotal"),
    styledCell(total.status || "", mixedExportStatusStyle(total.status || "")),
    styledCell("", "sNote")
  ];
}
function mixedExportMemberDayCells(member, day, itemNames, periods, report) {
  const row = mixedExportMemberDay(member, day, itemNames, report);
  const status = row.status || (row.productTotal ? quotaStatusFromTotals(row.productTotal, row.quota, row.completeQuota) : "");
  return [
    styledCell(day.slice(5), "sDate"),
    ...periods.map((period) => styledCell(checkinDisplay(row.rec?.checkins?.[period.key]), mixedExportCheckinStyle(row.rec?.checkins?.[period.key]))),
    ...itemNames.map((name) => styledCell(Number(row.items[name] || 0) || "", "sItem")),
    styledTotalCell(row.productTotal, "sTotal"),
    styledTotalCell(row.quota, "sQuota"),
    styledTotalCell(row.completeQuota, "sQuota"),
    styledTotalCell(row.weighted, "sTotal"),
    styledTotalCell(row.workloadQuota, "sQuota"),
    styledTotalCell(row.workloadDiff, row.workloadQuota ? (cleanTotalValue(row.workloadDiff) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
    styledTotalCell(row.dutyHours, "sTotal"),
    styledTotalCell(row.diff, cleanTotalValue(row.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
    styledTotalCell(row.video, "sTotal"),
    styledTotalCell(row.ai, "sTotal"),
    styledCell(status, mixedExportStatusStyle(status)),
    styledCell(row.note, "sNote")
  ];
}
function mixedHorizontalDetailSheet(exportPeriods, group, members, itemNames, periods, report) {
  const summaryWidth = 9;
  const spacerWidth = 1;
  const blockWidth = mixedExportMemberBlockWidth(itemNames, periods);
  const columns = [48, 70, 70, 80, 82, 82, 82, 70, 58, 12];
  const itemWidths = mixedExportItemColumnWidths(itemNames);
  const memberColumns = [48, ...periods.map(() => 48), ...itemWidths, 74, 70, 70, 82, 82, 82, 74, 74, 74, 74, 58, 112];
  members.forEach((_, index) => {
    columns.push(...memberColumns);
    if (index < members.length - 1) columns.push(12);
  });
  const rows = [];
  const validations = [];
  const values = normalizeCheckinOptions(report.checkinOptions || defaultData.checkinOptions);
  exportPeriods.forEach((period, periodIndex) => {
    const sectionStart = rows.length;
    const groupTotal = mixedExportGroupTotals(period.days, members, itemNames, report);
    const memberTotals = members.map((member) => aggregateMemberRange(member, period.days, report, itemNames));
    const collapsed = periodIndex > 0;
    const titleCells = [
      styledCell(`${period.label}｜${period.start} 至 ${period.end}`, "sTitle", { mergeAcross: summaryWidth - 1 }),
      styledCell("", "sSpacer"),
      ...members.flatMap((member, index) => {
        const total = memberTotals[index] || {};
        return [
          styledCell(`名字：${member}｜成品量 ${fmtTotal(total.productTotal || 0)}｜一级定额 ${fmtTotal(total.quota || 0)}｜完全定额 ${fmtTotal(total.completeQuota || total.quota || 0)}｜状态 ${total.status || ""}｜一级差额 ${signedTotalText(total.diff || 0)}｜换算 ${fmtTotal(total.weighted || 0)}｜工作量定额 ${fmtTotal(total.workloadQuota || 0)}｜工作量差额 ${total.workloadQuota ? signedTotalText(total.workloadDiff || 0) : "未设置"}`, "sTitle", { mergeAcross: blockWidth - 1 }),
          ...(index < members.length - 1 ? [styledCell("", "sSpacer")] : [])
        ];
      })
    ];
    rows.push(mixedXlsxRow(titleCells, 35.25, collapsed ? { collapsed: true } : {}));
    const headerCells = [
      ...["日期", "全组一级定额", "全组完全定额", "全组成品量", "全组换算工作量", "全组工作量定额", "全组工作量差额", "全组一级差额", "状态"].map((label) => styledCell(label, "sHeader")),
      styledCell("", "sSpacer"),
      ...members.flatMap((_, index) => [
        ...["日期", ...periods.map((item) => `${item.label}打卡`), ...itemNames, "成品量", "一级定额", "完全定额", "换算工作量", "工作量定额", "工作量差额", "尽本分时长", "一级差额", "视频成品", "AI成品", "状态", "备注"].map((label) => styledCell(label, "sHeader")),
        ...(index < members.length - 1 ? [styledCell("", "sSpacer")] : [])
      ])
    ];
    rows.push(mixedXlsxRow(headerCells, 30.75, collapsed ? { outlineLevel: 1, hidden: true } : {}));
    const totalCells = [
      styledCell("合计", "sDate"),
      styledTotalCell(groupTotal.quota, "sQuota"),
      styledTotalCell(groupTotal.completeQuota, "sQuota"),
      styledTotalCell(groupTotal.productTotal, "sTotal"),
      styledTotalCell(groupTotal.weighted, "sTotal"),
      styledTotalCell(groupTotal.workloadQuota || 0, "sQuota"),
      styledTotalCell(groupTotal.workloadDiff || 0, groupTotal.workloadQuota ? (cleanTotalValue(groupTotal.workloadDiff || 0) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
      styledTotalCell(groupTotal.diff, cleanTotalValue(groupTotal.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell(groupTotal.status || "", mixedExportStatusStyle(groupTotal.status || "")),
      styledCell("", "sSpacer"),
      ...members.flatMap((member, index) => [
        ...mixedExportMemberTotalCells(member, period.days, itemNames, periods, report),
        ...(index < members.length - 1 ? [styledCell("", "sSpacer")] : [])
      ])
    ];
    rows.push(mixedXlsxRow(totalCells, 39, collapsed ? { outlineLevel: 1, hidden: true } : {}));
    period.days.forEach((day) => {
      const groupDay = mixedExportGroupDayTotals(day, members, itemNames, report);
      const dayCells = [
        styledCell(day.slice(5), "sDate"),
        styledTotalCell(groupDay.quota, "sQuota"),
        styledTotalCell(groupDay.completeQuota, "sQuota"),
        styledTotalCell(groupDay.productTotal, "sTotal"),
        styledTotalCell(groupDay.weighted, "sTotal"),
        styledTotalCell(groupDay.workloadQuota || 0, "sQuota"),
        styledTotalCell(groupDay.workloadDiff || 0, groupDay.workloadQuota ? (cleanTotalValue(groupDay.workloadDiff || 0) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
        styledTotalCell(groupDay.diff, cleanTotalValue(groupDay.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
        styledCell(groupDay.status || "", mixedExportStatusStyle(groupDay.status || "")),
        styledCell("", "sSpacer"),
        ...members.flatMap((member, index) => [
          ...mixedExportMemberDayCells(member, day, itemNames, periods, report),
          ...(index < members.length - 1 ? [styledCell("", "sSpacer")] : [])
        ])
      ];
      rows.push(mixedXlsxRow(dayCells, 39, collapsed ? { outlineLevel: 1, hidden: true } : {}));
    });
    const recordStartRow = sectionStart + 4;
    const recordEndRow = recordStartRow + period.days.length - 1;
    if (recordEndRow >= recordStartRow) {
      members.forEach((_, memberIndex) => {
        const blockStartCol = summaryWidth + spacerWidth + 1 + memberIndex * (blockWidth + spacerWidth);
        periods.forEach((__, checkinIndex) => {
          const col = columnName(blockStartCol + 1 + checkinIndex);
          validations.push({ sqref: `${col}${recordStartRow}:${col}${recordEndRow}`, values });
        });
      });
    }
    if (periodIndex < exportPeriods.length - 1) {
      rows.push(mixedXlsxRow([styledCell("", "sSpacer", { mergeAcross: Math.max(columns.length - 1, 0) })], 8));
    }
  });
  return { name: "混合明细", rows, columns, validations };
}
function mixedTotalsExportSheet(exportPeriods, group, members, itemNames, report) {
  const header = ["范围", "成员", "成品量", "一级定额", "完全定额", "换算工作量", "工作量定额", "工作量差额", "尽本分时长", "一级差额", "状态", "视频成品", "AI成品", ...itemNames];
  const columns = [128, 86, 74, 74, 74, 82, 82, 82, 82, 74, 58, 74, 74, ...mixedExportItemColumnWidths(itemNames)];
  const rows = [
    mixedXlsxRow([styledCell(`总数｜${group || "未分组"}`, "sTitle", { mergeAcross: header.length - 1 })], 32),
    mixedXlsxRow(header.map((label) => styledCell(label, "sHeader")), 30)
  ];
  exportPeriods.forEach((period, periodIndex) => {
    const groupTotal = mixedExportGroupTotals(period.days, members, itemNames, report);
    rows.push(mixedXlsxRow([
      styledCell(`${period.label}\n${period.start} 至 ${period.end}`, "sDate"),
      styledCell("全组", "sDate"),
      styledTotalCell(groupTotal.productTotal, "sTotal"),
      styledTotalCell(groupTotal.quota, "sQuota"),
      styledTotalCell(groupTotal.completeQuota, "sQuota"),
      styledTotalCell(groupTotal.weighted, "sTotal"),
      styledTotalCell(groupTotal.workloadQuota || 0, "sQuota"),
      styledTotalCell(groupTotal.workloadDiff || 0, groupTotal.workloadQuota ? (cleanTotalValue(groupTotal.workloadDiff || 0) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
      styledTotalCell(groupTotal.dutyHours || 0, "sTotal"),
      styledTotalCell(groupTotal.diff, cleanTotalValue(groupTotal.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
      styledCell(groupTotal.status || "", mixedExportStatusStyle(groupTotal.status || "")),
      styledTotalCell(groupTotal.video, "sTotal"),
      styledTotalCell(groupTotal.ai, "sTotal"),
      ...itemNames.map((name) => styledTotalCell(groupTotal.items[name] || 0, "sItem"))
    ], 28));
    members.forEach((member) => {
      const total = aggregateMemberRange(member, period.days, report, itemNames);
      rows.push(mixedXlsxRow([
        styledCell(period.label, "sItem"),
        styledCell(member, "sItem"),
        styledTotalCell(total.productTotal || 0, "sTotal"),
        styledTotalCell(total.quota, "sQuota"),
        styledTotalCell(total.completeQuota, "sQuota"),
        styledTotalCell(total.weighted, "sTotal"),
        styledTotalCell(total.workloadQuota || 0, "sQuota"),
        styledTotalCell(total.workloadDiff || 0, total.workloadQuota ? (cleanTotalValue(total.workloadDiff || 0) >= 0 ? "sDiffGood" : "sDiffBad") : "sItem"),
        styledTotalCell(total.dutyHours || 0, "sTotal"),
        styledTotalCell(total.diff, cleanTotalValue(total.diff) >= 0 ? "sDiffGood" : "sDiffBad"),
        styledCell(total.status || "", mixedExportStatusStyle(total.status || "")),
        styledTotalCell(total.video, "sTotal"),
        styledTotalCell(total.ai, "sTotal"),
        ...itemNames.map((name) => styledTotalCell(total.items?.[name] || 0, "sItem"))
      ], 24));
    });
    if (periodIndex < exportPeriods.length - 1) rows.push(mixedXlsxRow([styledCell("", "sSpacer", { mergeAcross: header.length - 1 })], 8));
  });
  return { name: "总数", rows, columns };
}
function buildMixedTableWorkbookXml() {
  const report = selectedReportData();
  return withReportData(report, () => {
    const exportType = mixedExportTypeValue();
    const exportPeriods = mixedTableExportPeriods(report);
    const start = exportPeriods[exportPeriods.length - 1]?.start || currentDate;
    const end = exportPeriods[0]?.end || currentDate;
    const group = $("mixedTableGroup")?.value || mixedTableGroup || report.groups?.[0] || "";
    const members = membersForGroupValue(group, report);
    const itemNames = groupVisibleItems(group, report);
    const periods = checkinPeriods();
    const name = `${group || "混合"}${mixedExportTypeLabel(exportType)}`;
    if (!members.length) {
      return {
        group,
        start,
        end,
        exportType,
        name,
        sheets: [{ name: "混合明细", rows: [[styledCell("暂无成员", "sTitle")]], columns: [120] }]
      };
    }
    const detailSheet = mixedHorizontalDetailSheet(exportPeriods, group, members, itemNames, periods, report);
    const totalsSheet = mixedTotalsExportSheet(exportPeriods, group, members, itemNames, report);
    const monthlyBlock = mixedMonthlyReportExportBlock(group, report);
    const monthlySheet = { name: "人员月度总览", rows: monthlyBlock.rows, columns: monthlyBlock.columns };
    const checkinBlock = mixedCheckinExportBlock(exportPeriods, mixedCheckinExportGroup(report, group), report);
    const checkinSheet = { name: "小组打卡", rows: checkinBlock.rows, columns: checkinBlock.columns };
    const sheets = [];
    if (exportType === "all") sheets.push(detailSheet, totalsSheet, monthlySheet, checkinSheet);
    if (exportType === "detail") sheets.push(detailSheet);
    if (exportType === "monthly") sheets.push(monthlySheet);
    if (exportType === "checkin") sheets.push(checkinSheet);
    return { group, start, end, exportType, name, sheets };
  });
}
function exportMixedTableWorkbook() {
  saveFormSilently();
  const { group, start, end, exportType, name, sheets, rows, columns, validations } = buildMixedTableWorkbookXml();
  const workbookSheets = sheets?.length ? sheets : [{ name, rows, columns, validations }];
  downloadBlob(buildXlsxWorkbookSheets(workbookSheets), `mixed_table_${exportType}_${group || "all"}_${start}_${end}.xlsx`);
}
function buildCsvBackups() {
  const itemNames = configuredItems();
  const rows = [["日期", "成员", ...itemNames, "原始", "成品量", "一级定额", "完全定额", "换算工作量", "尽本分时长", "一级差额", "视频成品", "AI成品", "状态", "备注"]];
  const visibleMembers = new Set(reportMembers(data));
  Object.values(data.records)
    .filter((rec) => visibleMembers.has(rec.member))
    .sort((a, b) => `${a.date}|${a.member}`.localeCompare(`${b.date}|${b.member}`))
    .forEach((rec) => {
      const quota = memberQuota(rec.member, rec.date);
      const completeQuota = memberCompleteQuota(rec.member, rec.date);
      const products = productTotalsForItems(rec.items || {}, itemNames, data);
      const productTotal = productTotalValue(products);
      const weighted = totalsForItems(rec.items || {}, itemNames, data).weighted;
      rows.push([
        rec.date,
        rec.member,
        ...itemNames.map((name) => rec.items?.[name] || 0),
        rec.raw_total || 0,
        productTotal,
        quota,
        completeQuota,
        weighted,
        dutyHoursValue(rec),
        productTotal - quota,
        products.video,
        products.ai,
        rec.status || "",
        rec.reason || rec.harvest || rec.diary || ""
      ]);
    });
  const summary = [["成员", "总成品量", "总一级定额", "总完全定额", "总换算工作量", "总尽本分时长", "总一级差额", "状态", "视频成品", "AI成品", ...itemNames]];
  reportMembers(data).forEach((member) => {
    const records = Object.values(data.records).filter((rec) => rec.member === member);
    const weighted = records.reduce((sum, rec) => sum + totalsForItems(rec.items || {}, itemNames, data).weighted, 0);
    const quota = records.reduce((sum, rec) => sum + memberQuota(member, rec.date), 0);
    const completeQuota = records.reduce((sum, rec) => sum + memberCompleteQuota(member, rec.date), 0);
    const dutyHours = records.reduce((sum, rec) => sum + dutyHoursValue(rec), 0);
    const products = records.reduce((sum, rec) => {
      const next = productTotalsForItems(rec.items || {}, itemNames, data);
      sum.video += next.video;
      sum.ai += next.ai;
      return sum;
    }, { video: 0, ai: 0 });
    const productTotal = productTotalValue(products);
    summary.push([
      member,
      productTotal,
      quota,
      completeQuota,
      weighted,
      dutyHours,
      productTotal - quota,
      quotaStatusFromTotals(productTotal, quota, completeQuota),
      products.video,
      products.ai,
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
function safeBackupBaseName(value = defaultData.sheetBackupBaseName) {
  return String(value || defaultData.sheetBackupBaseName || "daily_report")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "daily_report";
}
function backupMimeType(name = "") {
  if (/\.json$/i.test(name)) return "application/json;charset=utf-8";
  if (/\.xls$/i.test(name)) return "application/vnd.ms-excel;charset=utf-8";
  return "text/csv;charset=utf-8";
}
function buildSheetBackupFileSet() {
  const base = safeBackupBaseName(data.sheetBackupBaseName || defaultData.sheetBackupBaseName);
  const stamp = todayLocalKey();
  const csvFiles = buildCsvBackups();
  return [
    { latestName: `${base}_3months_latest.xls`, archiveName: `${base}_3months_${stamp}.xls`, downloadName: `${base}_3months_${stamp}.xls`, text: buildThreeMonthWorkbookXml() },
    { latestName: `${base}_records_latest.csv`, archiveName: `${base}_records_${stamp}.csv`, downloadName: `${base}_records_${stamp}.csv`, text: csvFiles[0].text },
    { latestName: `${base}_summary_latest.csv`, archiveName: `${base}_summary_${stamp}.csv`, downloadName: `${base}_summary_${stamp}.csv`, text: csvFiles[1].text },
    { latestName: `${base}_data_latest.json`, archiveName: `${base}_data_${stamp}.json`, downloadName: `${base}_data_${stamp}.json`, text: JSON.stringify(normalize(data), null, 2) }
  ];
}
async function writeTextFileToDirectory(dir, name, text) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
async function writeSheetBackupsToDirectory(dir, files) {
  if (!dir || !(await hasCloudPermission(dir))) {
    throw new Error("没有表格备份文件夹写入权限，请重新选择表格备份文件夹。");
  }
  const stamp = todayLocalKey();
  const archiveRoot = await dir.getDirectoryHandle("daily_report_archives", { create: true });
  const archiveDir = await archiveRoot.getDirectoryHandle(stamp, { create: true });
  for (const file of files) {
    await writeTextFileToDirectory(dir, file.latestName, file.text);
    await writeTextFileToDirectory(archiveDir, file.archiveName, file.text);
  }
  await writeTextFileToDirectory(dir, `${safeBackupBaseName(data.sheetBackupBaseName)}_manifest.json`, JSON.stringify({
    updated_at: new Date().toISOString(),
    archive_date: stamp,
    record_count: Object.keys(data.records || {}).length,
    latest_files: files.map((file) => file.latestName),
    archive_folder: `daily_report_archives/${stamp}`
  }, null, 2));
  return `${dir.name || "备份文件夹"}\\daily_report_archives\\${stamp}`;
}
function renderSheetBackupStatus() {
  if ($("sheetBackupFolderStatus")) {
    $("sheetBackupFolderStatus").textContent = sheetBackupDirHandle
      ? `已选择：${sheetBackupLocationLabel || sheetBackupDirHandle.name || "表格备份文件夹"}`
      : "未选择表格备份文件夹；未选择时手动备份仍会下载文件。";
  }
  if ($("sheetBackupBaseNameInput") && !$("sheetBackupBaseNameInput").value) {
    $("sheetBackupBaseNameInput").value = data.sheetBackupBaseName || defaultData.sheetBackupBaseName;
  }
}
async function chooseSheetBackupFolder() {
  if (!("showDirectoryPicker" in window)) return alert("当前浏览器不支持选择文件夹，请用新版 Chrome/Edge。");
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  if (!(await hasCloudPermission(dir))) return alert("没有获得这个文件夹的写入权限，请重新选择。");
  sheetBackupDirHandle = dir;
  sheetBackupLocationLabel = dir.name || "表格备份文件夹";
  await saveDirectoryHandle("sheetBackupDirectory", dir);
  renderSheetBackupStatus();
  showDialog("表格备份文件夹已选择", `以后会写入固定最新版，并在 daily_report_archives 里每天保留一份。\n\n当前文件夹：${sheetBackupLocationLabel}`, "");
}
async function backupSheets(silent = false) {
  collectAdminSettings();
  const files = buildSheetBackupFileSet();
  if (sheetBackupDirHandle) {
    try {
      const folder = await writeSheetBackupsToDirectory(sheetBackupDirHandle, files);
      if (!silent) showDialog("表格备份已完成", `固定最新版和今日归档已写入：${folder}`, "");
      return { written: true, folder };
    } catch (error) {
      if (!silent) showDialog("表格备份失败", error.message || "无法写入表格备份文件夹。", "");
      if (silent) return { written: false, error: error.message || "backup failed" };
    }
  }
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.writeCsvBackup(files.map((file) => ({ name: file.downloadName, text: file.text })));
    if (result?.folder) {
      if (!silent) showDialog("表格备份已生成", `表格、CSV 和 JSON 已写入：${result.folder}。放在 Google Drive 同步目录里后，可用 Google 表格打开。`, "");
      return { written: true, folder: result.folder };
    }
  }
  if (silent) return { written: false, error: "no-folder" };
  files.forEach((file) => {
    const blob = new Blob([file.text], { type: backupMimeType(file.downloadName) });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.downloadName;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  return { written: true, downloaded: true };
}
function parseDelimitedRows(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}
function parseCsvRows(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
  return parseDelimitedRows(text, delimiter);
}
function importHeaderKey(value) {
  return String(value || "").replace(/^\ufeff/, "").replace(/[\s\n\r：:]/g, "").trim();
}
function importCellText(value) {
  return String(value ?? "").replace(/^\ufeff/, "").replace(/\u00a0/g, " ").trim();
}
function importNumber(value) {
  const text = importCellText(value).replace(/,/g, "").replace(/%$/, "");
  if (!text || /^[-–—]$/.test(text)) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}
function excelSerialDateKey(value) {
  const text = importCellText(value).replace(/,/g, "");
  if (!/^\d{4,5}(?:\.\d+)?$/.test(text)) return "";
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return "";
  const date = new Date(Math.round((serial - 25569) * 86400000));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizeImportedDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateKeyFromDate(value);
  const text = importCellText(value).replace(/[./]/g, "-");
  const match = text.match(/(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  return excelSerialDateKey(text);
}
function importRangeFromText(value) {
  const text = importCellText(value).replace(/[./]/g, "-");
  const dates = Array.from(text.matchAll(/(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})/g)).map((match) => normalizeImportedDateKey(match[0]));
  return dates.length >= 2 ? { start: dates[0], end: dates[1] } : null;
}
function importDateFromMonthDay(value, range = null) {
  const text = importCellText(value).replace(/[./]/g, "-");
  const full = normalizeImportedDateKey(text);
  if (full) return full;
  const match = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const month = String(Number(match[1])).padStart(2, "0");
  const day = String(Number(match[2])).padStart(2, "0");
  const years = Array.from(new Set([
    range?.start?.slice(0, 4),
    range?.end?.slice(0, 4),
    currentDate.slice(0, 4)
  ].filter(Boolean)));
  for (const year of years) {
    const candidate = `${year}-${month}-${day}`;
    if (!range || (candidate >= range.start && candidate <= range.end)) return candidate;
  }
  return `${years[0] || currentDate.slice(0, 4)}-${month}-${day}`;
}
function importCheckinValue(value, day) {
  const text = importCellText(value);
  if (!text || /未打卡/.test(text)) return null;
  const time = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] || "";
  const status = text.split(/\s+/).find((part) => part && !/^\d{1,2}:\d{2}/.test(part)) || text.replace(time, "").trim();
  if (!status) return null;
  const hhmm = time ? time.slice(0, 5) : "";
  return {
    status: normalizeCheckinStatus(status),
    time: hhmm,
    iso: hhmm ? `${day}T${hhmm}:00` : "",
    updated_at: hhmm ? `${day}T${hhmm}:00` : ""
  };
}
function importIsMetadataHeader(label) {
  const key = importHeaderKey(label);
  if (!key) return true;
  if (/打卡$/.test(key)) return true;
  return new Set([
    "日期", "成员", "姓名", "分组", "原始", "换算", "完成", "完成数", "完成总数", "总完成", "工作量", "换算工作量",
    "成品量", "定额", "成品定额", "默认定额", "默认成品定额", "当日定额", "当天成品定额", "尽本分时长", "本分时长", "差额", "视频成品", "AI成品", "状态", "备注",
    "全组完成", "全组成品量", "全组定额", "全组成品定额", "全组换算工作量", "全组差额"
  ]).has(key);
}
function importKnownRuleName(target, itemName) {
  const name = importCellText(itemName);
  if (!name || importIsMetadataHeader(name)) return "";
  const rules = target.rules || {};
  if (rules[name] !== undefined) return name;
  const key = importHeaderKey(name);
  const normalizedMatch = Object.keys(rules).find((ruleName) => importHeaderKey(ruleName) === key);
  if (normalizedMatch) return normalizedMatch;
  const aliases = {
    "动画量": ["动画"],
    "模板": ["模板套数"],
    "钩子": ["开场钩子", "简单钩子"],
    "形式化": ["形式化视频"],
    "gork视频": ["grok视频", "gork视频"]
  };
  const candidates = aliases[name] || aliases[key] || [];
  return candidates.find((candidate) => rules[candidate] !== undefined) || "";
}
function importEnsureItem(target, itemName, stats, sourceRules = null, sourceProductRules = null) {
  const name = importCellText(itemName);
  const resolved = importKnownRuleName(target, name);
  if (!name || importIsMetadataHeader(name)) return "";
  if (!resolved) {
    if (Array.isArray(stats.skippedItemNames)) {
      if (!stats.skippedItemNames.includes(name)) stats.skippedItemNames.push(name);
      stats.skippedItems = stats.skippedItemNames.length;
    } else {
      stats.skippedItems = (stats.skippedItems || 0) + 1;
    }
    return "";
  }
  if (resolved !== name && stats.mappedItems && typeof stats.mappedItems === "object") stats.mappedItems[name] = resolved;
  return resolved;
}
function importEnsureMember(target, member, group, stats) {
  const name = importCellText(member);
  if (!name || name === "合计") return "";
  const hidden = isMemberHidden(name, target);
  const groupName = importCellText(group) || target.memberGroups?.[name] || target.groups?.[0] || "1组";
  if (!target.groups.includes(groupName)) target.groups.push(groupName);
  if (!target.members.includes(name) && !hidden) {
    target.members.push(name);
    stats.members += 1;
    if (Array.isArray(stats.newMembers) && !stats.newMembers.includes(name)) stats.newMembers.push(name);
  }
  if (!hidden || !target.memberGroups?.[name]) target.memberGroups[name] = groupName;
  if (!Array.isArray(target.groupItems[groupName])) target.groupItems[groupName] = Object.keys(target.rules || {});
  if (!Array.isArray(target.memberItems[name])) target.memberItems[name] = Object.keys(target.rules || {});
  return name;
}
function importedRecordHasContent(items = {}, checkins = {}, note = "", dutyHours = 0) {
  return Object.values(items || {}).some((value) => Number(value || 0) !== 0)
    || Object.values(checkins || {}).some(Boolean)
    || Boolean(importCellText(note))
    || normalizeDutyHours(dutyHours) > 0;
}
function mergeImportedRecord(existing, imported, rules = defaultData.rules) {
  if (!existing) return { record: imported, changed: true };
  const merged = clone(existing);
  merged.items = { ...(merged.items || {}) };
  merged.checkins = sanitizeCheckins(merged.checkins || {});
  let changed = false;

  Object.entries(imported.items || {}).forEach(([name, value]) => {
    const nextValue = Number(value || 0);
    if (!nextValue) return;
    const currentValue = Number(merged.items?.[name] || 0);
    if (!currentValue) {
      merged.items[name] = nextValue;
      changed = true;
    }
  });

  Object.entries(imported.checkins || {}).forEach(([slot, value]) => {
    if (!value) return;
    const current = normalizeMergedCheckin(checkinSlotValue(merged.checkins, slot));
    if (!current) {
      merged.checkins[slot] = value;
      changed = true;
    }
  });
  merged.checkins = sanitizeCheckins(merged.checkins || {});

  const importedNote = importCellText(imported.reason || imported.harvest || imported.diary || "");
  const existingNote = importCellText(merged.reason || merged.harvest || merged.diary || "");
  if (importedNote && !existingNote) {
    merged.reason = importedNote;
    changed = true;
  }

  const importedDutyHours = normalizeDutyHours(imported.duty_hours ?? imported.dutyHours);
  if (importedDutyHours && !dutyHoursValue(merged)) {
    merged.duty_hours = importedDutyHours;
    changed = true;
  }

  const importedStatus = importCellText(imported.status || "");
  const existingStatus = importCellText(merged.status || "");
  if (importedStatus && (!existingStatus || existingStatus === "待审核")) {
    merged.status = importedStatus;
    changed = true;
  }

  if (changed) {
    const totals = mergedEntryTotals(merged.items || {}, rules || {});
    merged.raw_total = totals.raw;
    merged.weighted_total = totals.weighted;
    merged.updated_at = new Date().toISOString();
  }
  return { record: merged, changed };
}
function importApplyRecord(target, stats, record) {
  const day = importCellText(record.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    stats.skipped += 1;
    return;
  }
  const rawItems = {};
  Object.entries(record.items || {}).forEach(([name, amount]) => {
    const value = importNumber(amount);
    if (value) rawItems[name] = value;
  });
  const checkins = {};
  Object.entries(record.checkins || {}).forEach(([slot, value]) => {
    const normalized = importCheckinValue(value, day);
    if (normalized) checkins[slot] = normalized;
  });
  const note = importCellText(record.note || "");
  const dutyHours = normalizeDutyHours(record.duty_hours ?? record.dutyHours);
  if (!importedRecordHasContent(rawItems, checkins, note, dutyHours)) {
    stats.emptyRows = (stats.emptyRows || 0) + 1;
    return;
  }

  const member = importEnsureMember(target, record.member, record.group, stats);
  if (!member) {
    stats.skipped += 1;
    return;
  }
  const items = {};
  Object.entries(rawItems).forEach(([name, value]) => {
    const itemName = importEnsureItem(target, name, stats, record.sourceRules, record.sourceProductRules);
    if (itemName) items[itemName] = value;
  });
  if (!importedRecordHasContent(items, checkins, note, dutyHours)) {
    stats.emptyRows = (stats.emptyRows || 0) + 1;
    return;
  }
  const totals = mergedEntryTotals(items, target.rules || {});
  const imported = {
    date: day,
    member,
    items,
    raw_total: totals.raw,
    weighted_total: totals.weighted,
    quota_total: record.quota_total === undefined ? memberQuota(member, day) : importNumber(record.quota_total),
    duty_hours: dutyHours,
    status: importCellText(record.status || "") || "待审核",
    reason: note,
    harvest: "",
    diary: "",
    checkins: sanitizeCheckins(checkins),
    updated_at: new Date().toISOString()
  };
  const key = `${day}|${member}`;
  const firstSeen = !stats.seenRecordKeys?.has(key);
  if (!stats.seenRecordKeys) stats.seenRecordKeys = new Set();
  stats.seenRecordKeys.add(key);
  const merged = mergeImportedRecord(target.records[key], imported, target.rules || {});
  if (!merged.changed) {
    stats.unchanged = (stats.unchanged || 0) + 1;
    return;
  }
  target.records[key] = merged.record;
  markPendingCloudRecord(day, member);
  if (firstSeen) stats.records += 1;
  if (firstSeen) stats.checkins += Object.keys(checkins).length;
}
function importHeaderMap(row) {
  const map = {};
  row.forEach((cell, index) => {
    const key = importHeaderKey(cell);
    if (key && map[key] === undefined) map[key] = index;
  });
  return map;
}
function importRowsFromRecordTable(target, stats, rows, range = null) {
  let imported = 0;
  rows.forEach((row, rowIndex) => {
    const map = importHeaderMap(row);
    if (map["日期"] === undefined || (map["成员"] === undefined && map["姓名"] === undefined)) return;
    const memberIndex = map["成员"] ?? map["姓名"];
    const itemColumns = row
      .map((label, index) => ({ label: importCellText(label), index }))
      .filter(({ label }) => label && !importIsMetadataHeader(label));
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      const source = rows[index] || [];
      const date = importDateFromMonthDay(source[map["日期"]], range);
      const member = importCellText(source[memberIndex]);
      if (!date || !member || member === "合计") continue;
      const items = {};
      itemColumns.forEach(({ label, index: cellIndex }) => {
        items[label] = source[cellIndex];
      });
      importApplyRecord(target, stats, {
        date,
        member,
        group: source[map["分组"]],
        items,
        raw_total: source[map["原始"]],
        weighted_total: source[map["换算工作量"] ?? map["工作量"] ?? map["完成"] ?? map["完成总数"]],
        quota_total: source[map["成品定额"] ?? map["定额"]],
        duty_hours: source[map["尽本分时长"] ?? map["本分时长"]],
        status: source[map["状态"]],
        note: source[map["备注"]],
        checkins: {
          morning: source[map["上午打卡"] ?? map["上午"]],
          noon: source[map["下午打卡"] ?? map["中午打卡"] ?? map["中午"] ?? map["下午"]],
          evening: source[map["晚上打卡"] ?? map["晚打卡"] ?? map["晚上"]]
        }
      });
      imported += 1;
    }
  });
  return imported;
}
function importMixedDetailRows(target, stats, rows) {
  let range = null;
  let imported = 0;
  rows.forEach((row, rowIndex) => {
    const rowText = row.map(importCellText).join(" ");
    const nextRange = importRangeFromText(rowText);
    if (nextRange) range = nextRange;
    row.forEach((cell, startIndex) => {
      const title = importCellText(cell);
      if (!/^\d+\s+.+/.test(title)) return;
      const segment = row.slice(startIndex, startIndex + 60).map(importCellText);
      const workOffset = segment.findIndex((label) => ["换算工作量", "工作量"].includes(importHeaderKey(label)));
      const rawOffset = segment.findIndex((label) => importHeaderKey(label) === "原始");
      if (workOffset < 0 && rawOffset < 0) return;
      const member = title.replace(/^\d+\s+/, "").trim();
      const endIndex = row.findIndex((value, index) => index > startIndex && /^\d+\s+.+/.test(importCellText(value)));
      const blockEnd = endIndex > startIndex ? endIndex : Math.min(row.length, startIndex + segment.length);
      const headerCells = row.slice(startIndex, blockEnd).map(importCellText);
      const metaAt = (key) => headerCells.findIndex((label) => importHeaderKey(label) === key);
      const valueAt = (nextRow, key) => {
        const offset = metaAt(key);
        return offset >= 0 ? nextRow[startIndex + offset] : "";
      };
      const itemColumns = headerCells
        .map((label, offset) => ({ label, offset }))
        .filter(({ label, offset }) => offset > 0 && label && !importIsMetadataHeader(label));
      for (let nextRowIndex = rowIndex + 1; nextRowIndex < rows.length; nextRowIndex += 1) {
        const nextRow = rows[nextRowIndex] || [];
        const date = importDateFromMonthDay(nextRow[startIndex], range);
        if (!date) continue;
        const items = {};
        itemColumns.forEach(({ label, offset }) => {
          items[label] = nextRow[startIndex + offset];
        });
        importApplyRecord(target, stats, {
          date,
          member,
          items,
          raw_total: valueAt(nextRow, "原始"),
          weighted_total: valueAt(nextRow, "换算工作量") || valueAt(nextRow, "工作量"),
          quota_total: valueAt(nextRow, "成品定额") || valueAt(nextRow, "定额"),
          duty_hours: valueAt(nextRow, "尽本分时长") || valueAt(nextRow, "本分时长"),
          status: valueAt(nextRow, "状态"),
          note: valueAt(nextRow, "备注"),
          checkins: {
            morning: valueAt(nextRow, "上午打卡"),
            noon: valueAt(nextRow, "下午打卡"),
            evening: valueAt(nextRow, "晚上打卡")
          }
        });
        imported += 1;
      }
    });
  });
  return imported;
}
function importLegacyHeaderSlot(label) {
  const key = importHeaderKey(label);
  if (["上午", "早", "早打卡", "上午打卡"].includes(key)) return "morning";
  if (["下午", "中午", "中", "午", "下午打卡", "中午打卡", "中打卡", "午打卡"].includes(key)) return "noon";
  if (["晚上", "晚", "晚打卡", "晚上打卡"].includes(key)) return "evening";
  return "";
}
function importLegacyIsMetadataHeader(label) {
  const key = importHeaderKey(label);
  if (!key) return true;
  if (importLegacyHeaderSlot(key)) return true;
  if (importIsMetadataHeader(label)) return true;
  return new Set(["没完成的原因", "未完成原因", "没完成原因", "原因", "收获", "日记"]).has(key);
}
function importLegacyMemberName(value) {
  const text = importCellText(value);
  if (!text || /^\d{1,2}月份?$/.test(text) || normalizeImportedDateKey(text)) return "";
  if (/^\d+(?:\.\d+)?$/.test(text)) return "";
  if (/^[|｜]?\s*名字[:：]/.test(text) || /[|｜].*工作量/.test(text)) return "";
  if (importLegacyIsMetadataHeader(text)) return "";
  return text;
}
function importLegacyMemberBlockStarts(nameRow = [], headerRow = []) {
  const starts = [];
  nameRow.forEach((cell, index) => {
    const member = importLegacyMemberName(cell);
    if (!member) return;
    const headerKeys = Array.from({ length: 45 }, (_, offset) => importHeaderKey(headerRow[index + offset]));
    const hasCheckin = headerKeys.some((key) => importLegacyHeaderSlot(key));
    const hasMetric = headerKeys.some((key) => ["完成总数", "总完成", "成品量", "换算工作量", "工作量", "成品定额", "定额", "差额"].includes(key));
    const hasItems = headerKeys.some((key) => key && !importLegacyIsMetadataHeader(key));
    if (hasCheckin && (hasMetric || hasItems)) starts.push({ member, index });
  });
  return starts;
}
function importLegacyGroupFromSheetName(sheetName = "") {
  const text = importCellText(sheetName);
  if (!text || /^工作表\d+$/.test(text)) return "";
  return text
    .replace(/(?:19|20)?\d{2}年.*$/, "")
    .replace(/\d{1,2}月份?.*$/, "")
    .replace(/[-_｜|\s]+$/, "")
    .trim();
}
function importLegacyHorizontalRows(target, stats, rows, sheetName = "") {
  let imported = 0;
  const group = importLegacyGroupFromSheetName(sheetName);
  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    const nameRow = rows[rowIndex] || [];
    const headerRow = rows[rowIndex + 1] || [];
    const starts = importLegacyMemberBlockStarts(nameRow, headerRow);
    if (!starts.length) continue;
    let sectionEnd = rows.length;
    for (let index = rowIndex + 2; index < rows.length - 1; index += 1) {
      if (importLegacyMemberBlockStarts(rows[index] || [], rows[index + 1] || []).length) {
        sectionEnd = index;
        break;
      }
    }
    starts.forEach(({ member, index: startIndex }, blockIndex) => {
      const blockEnd = starts[blockIndex + 1]?.index ?? Math.max(headerRow.length, startIndex + 1);
      const headerCells = Array.from({ length: Math.max(blockEnd - startIndex, 0) }, (_, offset) => importCellText(headerRow[startIndex + offset]));
      const offsetFor = (keys) => {
        const allowed = new Set(keys.map(importHeaderKey));
        return headerCells.findIndex((label) => allowed.has(importHeaderKey(label)));
      };
      const valueAt = (row, keys) => {
        const offset = offsetFor(Array.isArray(keys) ? keys : [keys]);
        return offset >= 0 ? row[startIndex + offset] : "";
      };
      const itemColumns = headerCells
        .map((label, offset) => ({ label, offset }))
        .filter(({ label }) => label && !importLegacyIsMetadataHeader(label));
      for (let dataRowIndex = rowIndex + 2; dataRowIndex < sectionEnd; dataRowIndex += 1) {
        const source = rows[dataRowIndex] || [];
        const date = importDateFromMonthDay(source[0]);
        if (!date) continue;
        const items = {};
        itemColumns.forEach(({ label, offset }) => {
          items[label] = source[startIndex + offset];
        });
        importApplyRecord(target, stats, {
          date,
          member,
          group,
          items,
          weighted_total: valueAt(source, ["换算工作量", "工作量", "完成总数", "总完成"]),
          quota_total: valueAt(source, ["成品定额", "定额", "当天成品定额", "当日定额", "默认成品定额", "默认定额"]),
          duty_hours: valueAt(source, ["尽本分时长", "本分时长"]),
          status: valueAt(source, ["状态"]),
          note: valueAt(source, ["备注", "没完成的原因", "未完成原因", "没完成原因", "原因"]),
          checkins: {
            morning: valueAt(source, ["上午打卡", "早打卡", "上午", "早"]),
            noon: valueAt(source, ["下午打卡", "中午打卡", "中打卡", "下午", "中午", "中"]),
            evening: valueAt(source, ["晚上打卡", "晚打卡", "晚上", "晚"])
          }
        });
        imported += 1;
      }
    });
    rowIndex = sectionEnd - 1;
  }
  return imported;
}
function textWorkbookSheets(text, fileName = "") {
  const source = String(text || "");
  if (/<table[\s>]/i.test(source) && !/<Workbook[\s>]/i.test(source)) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return Array.from(doc.querySelectorAll("table")).map((table, index) => ({
      name: `表格${index + 1}`,
      rows: Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((cell) => cell.textContent || ""))
    }));
  }
  if (/<Workbook[\s>]/i.test(source) || /<Worksheet[\s>]/i.test(source)) {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    return Array.from(doc.getElementsByTagNameNS("*", "Worksheet")).map((sheet, index) => ({
      name: sheet.getAttribute("ss:Name") || sheet.getAttribute("Name") || `工作表${index + 1}`,
      rows: Array.from(sheet.getElementsByTagNameNS("*", "Row")).map((row) => {
        const values = [];
        let column = 0;
        Array.from(row.getElementsByTagNameNS("*", "Cell")).forEach((cell) => {
          const explicit = Number(cell.getAttribute("ss:Index") || cell.getAttribute("Index") || 0);
          if (explicit > 0) column = explicit - 1;
          const dataNode = cell.getElementsByTagNameNS("*", "Data")[0];
          values[column] = dataNode?.textContent || "";
          column += 1;
        });
        return values;
      })
    }));
  }
  return [{ name: fileName || "CSV", rows: parseCsvRows(source) }];
}
function zipValue(bytes, offset, size) {
  let value = 0;
  for (let index = 0; index < size; index += 1) value += bytes[offset + index] << (index * 8);
  return value >>> 0;
}
async function unzipEntryBytes(bytes, method, start, size) {
  const chunk = bytes.slice(start, start + size);
  if (method === 0) return chunk;
  if (method !== 8 || typeof DecompressionStream !== "function") throw new Error("这个 .xlsx 使用了压缩格式，当前浏览器不能直接解析；请从 Google 表格下载当前工作表 CSV 后导入。");
  for (const format of ["deflate-raw", "deflate"]) {
    try {
      const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {}
  }
  throw new Error("无法解压这个 .xlsx；请从 Google 表格下载 CSV 后导入。");
}
async function unzipXlsxEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (zipValue(bytes, index, 4) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error("不是有效的 xlsx 文件。");
  const entries = zipValue(bytes, endOffset + 10, 2);
  let centralOffset = zipValue(bytes, endOffset + 16, 4);
  const decoder = new TextDecoder();
  const files = {};
  for (let entryIndex = 0; entryIndex < entries; entryIndex += 1) {
    if (zipValue(bytes, centralOffset, 4) !== 0x02014b50) break;
    const method = zipValue(bytes, centralOffset + 10, 2);
    const compressedSize = zipValue(bytes, centralOffset + 20, 4);
    const nameLength = zipValue(bytes, centralOffset + 28, 2);
    const extraLength = zipValue(bytes, centralOffset + 30, 2);
    const commentLength = zipValue(bytes, centralOffset + 32, 2);
    const localOffset = zipValue(bytes, centralOffset + 42, 4);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    const localNameLength = zipValue(bytes, localOffset + 26, 2);
    const localExtraLength = zipValue(bytes, localOffset + 28, 2);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files[name] = await unzipEntryBytes(bytes, method, dataStart, compressedSize);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function xlsxColumnIndex(ref = "") {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0] || "";
  return letters.split("").reduce((sum, char) => sum * 26 + char.toUpperCase().charCodeAt(0) - 64, 0) || 1;
}
function xlsxSheetRows(xml, sharedStrings = []) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS("*", "row")).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagNameNS("*", "c")).forEach((cell) => {
      const index = xlsxColumnIndex(cell.getAttribute("r")) - 1;
      const type = cell.getAttribute("t") || "";
      let value = "";
      if (type === "s") {
        const sharedIndex = Number(cell.getElementsByTagNameNS("*", "v")[0]?.textContent || 0);
        value = sharedStrings[sharedIndex] || "";
      } else if (type === "inlineStr") {
        value = Array.from(cell.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join("");
      } else {
        value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || "";
      }
      values[index] = value;
    });
    return values;
  });
}
function xlsxWorksheetEntries(entries, decoder) {
  const workbookXml = entries["xl/workbook.xml"] ? decoder.decode(entries["xl/workbook.xml"]) : "";
  const relsXml = entries["xl/_rels/workbook.xml.rels"] ? decoder.decode(entries["xl/_rels/workbook.xml.rels"]) : "";
  if (!workbookXml || !relsXml) return [];
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const rels = {};
  Array.from(relsDoc.getElementsByTagNameNS("*", "Relationship")).forEach((rel) => {
    const id = rel.getAttribute("Id") || "";
    const target = rel.getAttribute("Target") || "";
    if (!id || !target) return;
    const cleanTarget = target.replace(/^\//, "");
    rels[id] = cleanTarget.startsWith("xl/") ? cleanTarget : `xl/${cleanTarget}`;
  });
  const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
  return Array.from(workbookDoc.getElementsByTagNameNS("*", "sheet")).map((sheet, index) => {
    const relId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "";
    return {
      name: sheet.getAttribute("name") || `工作表${index + 1}`,
      path: rels[relId] || `xl/worksheets/sheet${index + 1}.xml`
    };
  });
}
async function xlsxWorkbookSheets(file) {
  const entries = await unzipXlsxEntries(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const sharedXml = entries["xl/sharedStrings.xml"] ? decoder.decode(entries["xl/sharedStrings.xml"]) : "";
  const sharedStrings = sharedXml ? Array.from(new DOMParser().parseFromString(sharedXml, "application/xml").getElementsByTagNameNS("*", "si")).map((si) => Array.from(si.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join("")) : [];
  const sheetEntries = xlsxWorksheetEntries(entries, decoder);
  const fallbackEntries = Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort()
    .map((path, index) => ({ name: `工作表${index + 1}`, path }));
  return (sheetEntries.length ? sheetEntries : fallbackEntries)
    .filter((sheet) => entries[sheet.path])
    .map((sheet) => ({ name: sheet.name, rows: xlsxSheetRows(decoder.decode(entries[sheet.path]), sharedStrings) }));
}
async function fileToWorkbookSheets(file) {
  const name = file.name || "";
  if (/\.xlsx$/i.test(name)) return xlsxWorkbookSheets(file);
  return textWorkbookSheets(await file.text(), name);
}
function importJsonBackupToData(sourceData) {
  const backup = normalize(sourceData);
  const target = normalize(data);
  const stats = { records: 0, members: 0, newMembers: [], items: 0, skippedItems: 0, skippedItemNames: [], mappedItems: {}, checkins: 0, skipped: 0, emptyRows: 0, unchanged: 0, seenRecordKeys: new Set() };
  target.dailyQuotas = mergeDailyQuotas(backup.dailyQuotas, target.dailyQuotas, "admin");
  target.monthlyPlans = mergeMonthlyPlans(backup.monthlyPlans, target.monthlyPlans);
  target.freeTable = mergeFreeTable(backup.freeTable, target.freeTable);
  target.fbSpecialties = mergeFbSpecialties(backup.fbSpecialties, target.fbSpecialties);
  target.checkinOptions = normalizeCheckinOptions([...(data.checkinOptions || []), ...(backup.checkinOptions || [])]);
  Object.entries(backup.records || {}).forEach(([, record]) => {
    importApplyRecord(target, stats, {
      ...record,
      group: backup.memberGroups?.[record.member] || record.group || "",
      sourceRules: backup.rules || {},
      sourceProductRules: backup.productRules || {}
    });
  });
  return { data: normalize(target), stats };
}
function importWorkbookToData(sheets) {
  const target = normalize(data);
  const stats = { records: 0, members: 0, newMembers: [], items: 0, skippedItems: 0, skippedItemNames: [], mappedItems: {}, checkins: 0, skipped: 0, emptyRows: 0, unchanged: 0, seenRecordKeys: new Set() };
  sheets.forEach((sheet) => {
    const rows = (sheet.rows || []).filter((row) => row.some((cell) => importCellText(cell)));
    importRowsFromRecordTable(target, stats, rows);
    importMixedDetailRows(target, stats, rows);
    importLegacyHorizontalRows(target, stats, rows, sheet.name || "");
  });
  return { data: normalize(target), stats };
}
function importNewMemberConfirmText(stats = {}) {
  const lines = [];
  const names = Array.isArray(stats.newMembers) ? stats.newMembers : [];
  if (names.length) {
    const preview = names.slice(0, 20).join("、");
    const more = names.length > 20 ? ` 等 ${names.length} 人` : "";
    lines.push(`将新增成员：${preview}${more}`);
    lines.push("导入后可在“管理员 > 成员与分组”勾选多余成员并隐藏。");
  }
  const mappedItems = stats.mappedItems && typeof stats.mappedItems === "object" ? Object.entries(stats.mappedItems) : [];
  if (mappedItems.length) {
    const preview = mappedItems.slice(0, 12).map(([from, to]) => `${from}→${to}`).join("、");
    const more = mappedItems.length > 12 ? ` 等 ${mappedItems.length} 项` : "";
    lines.push(`已合并旧项目名：${preview}${more}`);
  }
  const skippedItems = Array.isArray(stats.skippedItemNames) ? stats.skippedItemNames : [];
  if (skippedItems.length) {
    const preview = skippedItems.slice(0, 20).join("、");
    const more = skippedItems.length > 20 ? ` 等 ${skippedItems.length} 项` : "";
    lines.push(`已跳过旧表多余项目：${preview}${more}`);
    lines.push("只导入当前管理员项目中已有的项目列。");
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}
async function importData(file) {
  try {
    if (!file) return;
    if (/\.json$/i.test(file.name || "")) {
      const text = await file.text();
      const result = importJsonBackupToData(JSON.parse(String(text || "{}")));
      const newMemberText = importNewMemberConfirmText(result.stats);
      const confirmed = confirm(`可从 JSON 备份安全补充 ${result.stats.records} 条记录、${result.stats.checkins} 个打卡、${result.stats.members} 个新成员、${result.stats.skippedItems || 0} 个旧项目已跳过。${newMemberText}\n\n当前项目分类、分组项目勾选、成员项目配置会以现在软件里的最新设置为准，不会被旧备份覆盖或删除。\n\n确定合并导入吗？导入前会自动备份当前数据。`);
      if (!confirmed) return;
      createBackup("JSON 安全合并导入前备份");
      data = result.data;
    } else {
      const sheets = await fileToWorkbookSheets(file);
      const result = importWorkbookToData(sheets);
      if (!result.stats.records) throw new Error("没有识别到可恢复的每日记录。请在 Google 表格里切到“全部记录”工作表，下载 CSV 后再导入。");
      const newMemberText = importNewMemberConfirmText(result.stats);
      const confirmed = confirm(`可补充 ${result.stats.records} 条记录、${result.stats.checkins} 个打卡、${result.stats.members} 个新成员。已自动跳过 ${result.stats.emptyRows || 0} 条空白/全0行、${result.stats.skippedItems || 0} 个旧项目，保留 ${result.stats.unchanged || 0} 条已有数据。${newMemberText}\n\n当前项目分类、分组项目勾选、成员项目配置会以现在软件里的最新设置为准，不会被旧表格覆盖或删除。\n\n确定合并导入到当前日记软件吗？导入前会自动备份当前数据。`);
      if (!confirmed) return;
      createBackup("表格恢复导入前备份");
      data = result.data;
    }
    persistLocal();
    ensureCurrentMemberVisible();
    loadForm();
    render();
    showDialog("导入完成", `已恢复到本机数据，共 ${Object.keys(data.records || {}).length} 条记录。确认无误后，可以点击“中心回灌云同步”写回云端。`, "");
  } catch (error) {
    showDialog("导入失败", error.message || "无法导入这个文件。", "");
  }
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
  showDialog("配置已保存", result.cloudDbWritten ? `项目、成品定额和成员名单已经写入${cloudSyncProviderLabel()}。其他成员同步后会自动更新。` : "项目、成品定额和成员名单已经写入共享数据。其他成员同步后会自动更新。", "");
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
  $("exportOverviewBriefsBtn").onclick = exportSelectedOverviewBriefs;
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
    renderMemberQuotas();
    renderOverview();
    scheduleSave("admin");
  };
  if ($("completeQuotaInput")) $("completeQuotaInput").oninput = () => {
    data.completeQuota = $("completeQuotaInput").value === "" ? "" : Number($("completeQuotaInput").value || 0);
    preview();
    renderMemberQuotas();
    renderOverview();
    scheduleSave("admin");
  };
  if ($("workloadQuotaInput")) $("workloadQuotaInput").oninput = () => {
    data.workloadQuota = $("workloadQuotaInput").value === "" ? "" : Number($("workloadQuotaInput").value || 0);
    preview();
    renderMemberQuotas();
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
  if ($("dailyCompleteQuotaInput")) $("dailyCompleteQuotaInput").oninput = () => {
    setDailyMemberCompleteQuota(currentMember, currentDate, $("dailyCompleteQuotaInput").value);
    preview();
    renderOverview();
    persistLocal();
    scheduleRecordCloudSave();
  };
  if ($("dailyWorkloadQuotaInput")) $("dailyWorkloadQuotaInput").oninput = () => {
    setDailyMemberWorkloadQuota(currentMember, currentDate, $("dailyWorkloadQuotaInput").value);
    saveFormSilently();
    preview();
    renderOverview();
    persistLocal();
    scheduleRecordCloudSave();
  };
  if ($("dutyHoursInput")) $("dutyHoursInput").oninput = () => {
    saveFormSilently();
    renderOverview();
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
  if ($("dateCompleteQuotaInput")) $("dateCompleteQuotaInput").oninput = () => {
    setDailyDefaultCompleteQuota($("adminQuotaDate").value || currentDate, $("dateCompleteQuotaInput").value);
    renderMemberQuotas();
    preview();
    renderOverview();
    scheduleSave("admin");
  };
  if ($("dateWorkloadQuotaInput")) $("dateWorkloadQuotaInput").oninput = () => {
    setDailyDefaultWorkloadQuota($("adminQuotaDate").value || currentDate, $("dateWorkloadQuotaInput").value);
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
  if ($("sheetBackupBaseNameInput")) $("sheetBackupBaseNameInput").onchange = () => { collectAdminSettings(); renderSheetBackupStatus(); scheduleSave("admin"); };
  if ($("chooseSheetBackupFolderBtn")) $("chooseSheetBackupFolderBtn").onclick = () => chooseSheetBackupFolder().catch((err) => alert(`选择表格备份文件夹失败：${err.message}`));
  if ($("sheetBackupNowBtn")) $("sheetBackupNowBtn").onclick = async () => {
    if ($("sheetBackupToggle")) $("sheetBackupToggle").checked = true;
    collectAdminSettings();
    renderSheetBackupStatus();
    persistLocal();
    await backupSheets(false);
    scheduleSave("admin");
  };
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
  $("mixedTableRangeMode").onchange = () => {
    mixedTableRangeMode = $("mixedTableRangeMode").value || "week";
    mixedExportMonths = [];
    applyMixedTableDefaultRange();
    renderMixedOverviewTable();
  };
  ["mixedTableStart", "mixedTableEnd"].forEach((id) => {
    $(id).onchange = () => {
      mixedTableRangeMode = "custom";
      if ($("mixedTableRangeMode")) $("mixedTableRangeMode").value = "custom";
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
    data.productRules[name] = defaultProductRuleFor(name);
    if (!data.totalConversionRules || typeof data.totalConversionRules !== "object") data.totalConversionRules = {};
    data.totalConversionRules[name] = 0;
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
  $("addFreeSheetRowBtn").onclick = addFreeTableRow;
  $("addFreeSheetColumnBtn").onclick = addFreeTableColumn;
  $("removeFreeSheetRowBtn").onclick = removeFreeTableRow;
  $("removeFreeSheetColumnBtn").onclick = removeFreeTableColumn;
  $("clearFreeSheetBtn").onclick = clearFreeTable;
  $("addSpecialtyBtn").onclick = addSpecialty;
  $("deleteSpecialtyBtn").onclick = deleteActiveSpecialty;
  $("saveSpecialtyBtn").onclick = saveActiveSpecialty;
  $("addSpecialtyReelBtn").onclick = addSpecialtyReel;
  ["specialtyFbUrl", "specialtyName", "specialtyAvatarUrl", "specialtyBannerUrl", "specialtyVideoOwner", "specialtyOperator", "specialtyTier", "specialtyStatus", "specialtyCategory", "specialtyNotes"].forEach((id) => {
    $(id).onchange = saveActiveSpecialty;
  });
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
  $("syncTodayToMixedBtn").onclick = syncTodayToMixedTable;
  $("copyMixedSummaryBtn").onclick = copyMixedSummaryText;
  $("copyMixedConversionDetailBtn").onclick = copyMixedConversionDetailText;
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
    markPendingCloudRecord(currentDate, currentMember);
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
