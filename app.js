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
  checkinOptions: ["上线", "请假", "熬夜迟到", "听交通", "聚会", "上班", "干农活", "值日"],
  timezones: [
    { name: "北京时间", offset: "+08:00" },
    { name: "罗马时间", offset: "+02:00" }
  ],
  adminPassword: "999",
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
let cloudDbStatusText = "未连接 Vercel 云数据库";
let cloudDbLastMeta = null;
let cloudHistoryEvents = [];
let cloudDbPollTimer = 0;
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
let overviewDetailGroup = "";
let overviewDetailMember = "";
let checkinViewGroup = "";
let checkinViewMember = "";
let pendingDialogField = "";
let activeView = "entry";
let saveTimer = 0;
let draftTimer = 0;
let recordCloudSaveTimer = 0;
let adminUnlocked = false;
let showAllEntryItems = false;
let appUnlocked = false;
let collapsedGroups = JSON.parse(localStorage.getItem("dailyReportCollapsedGroups") || "{}");
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const recordKey = () => `${currentDate}|${currentMember}`;
const desktopApp = window.desktopApp || null;
const syncPollMs = 3000;
function todayLocalKey() {
  const now = new Date();
  return dateKeyFromDate(now);
}
function normalizeCheckinStatus(status) {
  const text = String(status || "").trim();
  if (text === "准时上线") return "上线";
  if (text === "迟到") return "熬夜迟到";
  return text;
}
function normalizeCheckinOptions(options) {
  const source = Array.isArray(options) && options.length ? options : defaultData.checkinOptions;
  return Array.from(new Set(source.map(normalizeCheckinStatus).filter(Boolean)));
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
    records: loaded.records || {}
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
    merged.adminPassword = String(local.adminPassword || "999");
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
    merged.adminPassword = String(remote.adminPassword || local.adminPassword || "999");
    merged.sheetBackupEnabled = remote.sheetBackupEnabled !== false;
    merged.backupCleanupEnabled = remote.backupCleanupEnabled === true;
    merged.autoAudit = remote.autoAudit === true;
    merged.deletedMembers = { ...(local.deletedMembers || {}), ...(remote.deletedMembers || {}) };
    merged.reviewMessages = clone(remote.reviewMessages || local.reviewMessages || defaultData.reviewMessages);
  }
  Object.keys(merged.records || {}).forEach((key) => {
    const member = merged.records[key]?.member || String(key).split("|").slice(1).join("|");
    if (merged.deletedMembers?.[member]) delete merged.records[key];
  });
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
    if (cloudDbResult?.written) {
      setSyncStatus("已写入 Vercel 云库，未选择文件夹备份");
      return { written: true, cloudDbWritten: true, folderWritten: false };
    }
    setSyncStatus("未选择云端文件夹，也未写入 Vercel 云库，只保存了本地草稿");
    return { written: false, reason: "missing-cloud-target" };
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
      setSyncStatus("已写入 Vercel 云库，文件夹备份写入失败");
      return { written: true, cloudDbWritten: true, folderWritten: false, reason: "folder-write-failed" };
    }
    setSyncStatus("写入失败，已保存到本地缓存");
    return { written: false, reason: "write-failed" };
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
function scheduleDraftSave() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveFormSilently(), 220);
}
function scheduleRecordCloudSave() {
  window.clearTimeout(recordCloudSaveTimer);
  if (!appSessionPassword && !fileHandle && !desktopApp?.isDesktop) return;
  recordCloudSaveTimer = window.setTimeout(() => {
    persistEverywhere("records").catch(() => {});
  }, 1200);
}
function preserveActiveDraft() {
  if (!appUnlocked || activeView !== "entry" || !$("entryInputs") || !$("dateInput")) return;
  try {
    saveFormSilently();
  } catch {
    // The draft saver is best-effort before refresh; normal editing can continue.
  }
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
  const dbReady = Boolean(appSessionPassword && cloudDatabaseAvailable() && !/未配置|失败|不可用/.test(cloudDbStatusText));
  box.innerHTML = `
    <div><span>云端挂载</span><strong>${escapeHtml(cloudLocationLabel || "未选择")}</strong></div>
    <div><span>后台刷新</span><strong>${escapeHtml(syncStatusText)}</strong></div>
    <div><span>Vercel 云库</span><strong>${escapeHtml(cloudDbStatusText)}</strong></div>
    <div><span>本地草稿</span><strong>${recordCount} 条 · ${escapeHtml(cachedAt)}</strong></div>
    <div><span>同步状态</span><strong>${dbReady ? "Vercel 云库主同步" : (connected ? `${syncPollMs / 1000} 秒刷新` : "未连接时不会进入团队总数据")}</strong></div>
  `;
}
function cloudDatabaseAvailable() {
  return window.location.protocol !== "file:" && typeof fetch === "function";
}
function cloudDataMetaText(meta) {
  if (!meta) return "";
  const updatedAt = meta.updated_at ? new Date(meta.updated_at).toLocaleString("zh-CN") : "未知时间";
  const count = Number(meta.record_count || 0);
  return `${count} 条 · ${updatedAt}`;
}
function setCloudDbStatus(message, meta) {
  cloudDbStatusText = message || cloudDbStatusText;
  if (meta !== undefined) cloudDbLastMeta = meta;
  renderSyncPanel();
}
async function callCloudData(action, payload = {}, token = appSessionPassword) {
  if (!cloudDatabaseAvailable()) throw new Error("请通过 Vercel 或本地开发服务器打开网页，直接打开本地文件不能使用 Vercel 云同步。");
  const syncToken = String(token || appSessionPassword || cloudBackupToken || "").trim();
  if (!syncToken) throw new Error("请先输入应用密码。");
  const response = await fetch("/api/cloud-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Team-Token": syncToken
    },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok || result.ok === false) throw new Error(result.error || `Vercel 云同步失败：${response.status}`);
  return result;
}
async function verifyAppPassword(password) {
  const candidate = String(password || "").trim();
  if (!candidate) return { ok: false, error: "请输入应用密码" };
  if (!cloudDatabaseAvailable()) {
    return candidate === String(data.adminPassword || "999")
      ? { ok: true, source: "local" }
      : { ok: false, error: "密码不正确" };
  }
  try {
    const response = await fetch("/api/app-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: candidate })
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (response.ok && result.ok) return { ok: true, source: "vercel-env" };
    if (response.status !== 404) return { ok: false, error: result.error || "密码不正确" };
  } catch {
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
  if (!appSessionPassword) {
    try {
      const response = await fetch("/api/cloud-data", { cache: "no-store" });
      const result = await response.json();
      if (!result.configured) setCloudDbStatus("未配置 DATABASE_URL");
      else if (!result.protected) setCloudDbStatus("未配置 TEAM_SYNC_TOKEN");
      else setCloudDbStatus("已配置，登录后自动同步");
    } catch {
      setCloudDbStatus("未检测到云同步 API");
    }
    return;
  }
  try {
    const result = await callCloudData("pull", {}, appSessionPassword);
    setCloudDbStatus(result.data ? `已连接 · ${cloudDataMetaText(result.meta)}` : "已连接，云库暂无数据", result.meta || null);
  } catch (error) {
    setCloudDbStatus(`连接失败：${error.message}`);
    if (!silent) alert(`Vercel 云同步检查失败：${error.message}`);
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
  try {
    if (!beforeUnlock) preserveActiveDraft();
    const result = await callCloudData("pull", {}, syncToken);
    if (result.data) {
      if (!silent) createBackup("Vercel 云库刷新前备份");
      data = mergeCloudData(result.data, data, "records");
      persistLocal();
      if (!data.members.includes(currentMember)) currentMember = data.members[0] || currentMember;
      if (!beforeUnlock) {
        loadForm();
        render();
      }
      setCloudDbStatus(`已读取 Vercel 云库 · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta || null);
      return { pulled: true, data };
    }
    setCloudDbStatus("云库暂无数据，首次保存会创建");
    return { pulled: false, reason: "empty-cloud" };
  } catch (error) {
    setCloudDbStatus(`读取失败：${error.message}`);
    if (!silent) alert(`Vercel 云同步读取失败：${error.message}`);
    return { pulled: false, reason: error.message };
  }
}
async function saveCloudDatabaseData(mode = "records", silent = false) {
  if (!cloudDatabaseAvailable()) {
    setCloudDbStatus("本地文件打开不可用");
    return { written: false, reason: "not-available" };
  }
  if (!appSessionPassword) {
    setCloudDbStatus("未登录，不能写入 Vercel 云库");
    return { written: false, reason: "missing-token" };
  }
  try {
    const result = await callCloudData("save", { data: normalize(data), mode, actor: currentMember }, appSessionPassword);
    if (result.data) {
      data = normalize(result.data);
      persistLocal();
    }
    setCloudDbStatus(`已写入 Vercel 云库 · ${new Date().toLocaleTimeString("zh-CN")}`, result.meta || null);
    return { written: true, meta: result.meta || null };
  } catch (error) {
    setCloudDbStatus(`写入失败：${error.message}`);
    if (!silent) alert(`Vercel 云同步写入失败：${error.message}`);
    return { written: false, reason: error.message };
  }
}
function startCloudDbPolling() {
  window.clearInterval(cloudDbPollTimer);
  if (!appSessionPassword || !cloudDatabaseAvailable()) return;
  cloudDbPollTimer = window.setInterval(() => {
    pullCloudDatabaseData({ silent: true }).catch(() => {});
  }, 12000);
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
  showDialog("云端历史已恢复", "已经把团队数据恢复到选中的历史版本，并写回 Vercel 云库。", "");
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
  Object.values(report.records || {}).forEach((record) => {
    if (report.deletedMembers?.[record?.member]) return;
    if (record?.member) members.add(record.member);
  });
  Object.keys(report.deletedMembers || {}).forEach((member) => members.delete(member));
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
function recordFor(day, member) {
  return reportData().records[`${day}|${member}`] || null;
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
  Object.assign(rec, {
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
  });
  persistLocal();
  scheduleRecordCloudSave();
  return { rec, autoStatus };
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
    showDialog("未同步到总数据", "这次只保存到了本机浏览器缓存。请确认 Vercel 已配置 DATABASE_URL 和 TEAM_SYNC_TOKEN，或点击顶部“云端文件夹”选择团队共享文件夹后重新提交。", "");
  } else if (result.cloudDbWritten && !result.folderWritten) {
    showDialog("已提交到 Vercel 云库", "记录已经写入 Vercel 云数据库，等待管理员人工审核。当前没有写入文件夹备份。", "");
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
  if (!confirm(`确定删除成员“${name}”？会同时删除这个成员的历史记录、定额和分组配置。`)) return;
  data.members = data.members.filter((item) => item !== name);
  data.deletedMembers = data.deletedMembers || {};
  data.deletedMembers[name] = new Date().toISOString();
  delete data.memberQuotas[name];
  delete data.memberGroups[name];
  delete data.memberItems[name];
  Object.values(data.dailyQuotas || {}).forEach((entry) => {
    if (entry.members) delete entry.members[name];
  });
  Object.keys(data.records || {}).forEach((key) => {
    if (data.records[key]?.member === name || key.endsWith(`|${name}`)) delete data.records[key];
  });
  if (currentMember === name) currentMember = data.members[0];
  loadForm();
  render();
  scheduleSave("admin");
}
function renderOverview() {
  if (!reportDataOverride) return withReportData(selectedReportData(), renderOverview);
  const report = reportData();
  renderReportSourceTabs();
  renderOverviewGroupPicker(report);
  if ($("overviewScopeHint")) $("overviewScopeHint").textContent = `当前查看：${selectedReportLabel()} · ${overviewGroupLabel(report)}`;
  $("overviewDateInput").value = currentDate;
  const itemNames = configuredItems();
  const selectedGroups = selectedOverviewGroups(report);
  const selectedGroupSet = new Set(selectedGroups);
  const visibleGroups = report.groups.filter((group) => selectedGroupSet.has(group));
  const allRows = reportMembers(report).map((member) => {
    const rec = report.records[`${currentDate}|${member}`];
    const quota = memberQuota(member, currentDate);
    const weighted = Number(rec?.weighted_total || 0);
    const status = rec?.status || "待审核";
    const passed = status === "达标" || weighted >= quota;
    const rate = quota > 0 ? Math.min(100, Math.round((weighted / quota) * 100)) : 100;
    const items = rec?.items || {};
    return { member, rec, quota, weighted, passed, rate, items, checkins: rec?.checkins || {} };
  });
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
  $("overviewTitle").textContent = `${currentDate} ${overviewGroupLabel(report)}达标情况`;
  $("passCount").textContent = String(pass);
  $("failCount").textContent = String(fail);
  $("passRate").textContent = rows.length ? `${Math.round(pass / rows.length * 100)}%` : "0%";
  $("teamTotal").textContent = fmt(totalWeighted);
  $("teamQuota").textContent = `${fmt(totalQuota)} ${teamPassed ? "✓" : ""}`;
  $("teamDiff").textContent = `${totalWeighted - totalQuota >= 0 ? "+" : ""}${fmt(totalWeighted - totalQuota)}`;
  $("overviewHint").textContent = `${overviewGroupLabel(report)} · ${rows.length} 位成员 · ${teamPassed ? "已完成" : "未完成"}总定额`;
  const rowCard = (row) => `
    <article class="person-card ${row.passed ? "pass" : "fail"}" data-overview-member="${escapeAttr(row.member)}" title="点击查看个人今日">
      <div class="person-top">
        <span>${escapeHtml(row.member)}</span>
        <span class="status ${row.passed ? "pass" : "fail"}">${row.passed ? "达标" : "未达"}</span>
      </div>
      <div class="progress" title="${row.rate}%"><span style="--w:${row.rate}%"></span></div>
      <div class="hint">换算 ${fmt(row.weighted)} / 定额 ${fmt(row.quota)}</div>
      <div class="hint">差额 ${row.weighted - row.quota >= 0 ? "+" : ""}${fmt(row.weighted - row.quota)}</div>
      <div class="hint">${escapeHtml(checkinSummary(row.checkins))}</div>
      <div class="hint">${escapeHtml(row.rec?.reason || row.rec?.harvest || "暂无备注")}</div>
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
      if (!data.members.includes(card.dataset.overviewMember)) {
        showDialog("汇总成员", "这个成员来自高级管理员汇总视图。请切回对应来源文件夹后再编辑个人记录。", "");
        return;
      }
      currentMember = card.dataset.overviewMember;
      loadForm();
      setView("entry");
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
  const detailRaw = detailSourceRows.reduce((sum, row) => sum + Number(row.rec?.raw_total || 0), 0);
  const detailWeighted = detailSourceRows.reduce((sum, row) => sum + row.weighted, 0);
  const detailQuota = detailSourceRows.reduce((sum, row) => sum + row.quota, 0);
  const detailPassed = detailWeighted >= detailQuota;
  const detailLabel = overviewDetailMember || (overviewDetailGroup === "__all__" ? "全部成员合计" : `${overviewDetailGroup}全部成员`);
  $("detailHint").textContent = `${detailLabel}：${itemNames.map((name) => `${name} ${fmt(detailTotals[name])}`).join(" · ")}`;
  $("detailHead").innerHTML = `
    <tr>
      <th>成员</th>
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
      <th>原始</th>
      <th>换算</th>
      <th>定额</th>
      <th>差额</th>
      <th>状态</th>
      <th>打卡</th>
      <th>备注</th>
    </tr>
  `;
  const detailRows = [
    { label: `${overviewGroupLabel(report)}合计`, items: itemTotals, raw: rows.reduce((sum, row) => sum + Number(row.rec?.raw_total || 0), 0), weighted: totalWeighted, quota: totalQuota, diff: totalWeighted - totalQuota, status: teamPassed ? "完成" : "未完成", checkins: "", note: "" },
    { label: detailLabel, items: detailTotals, raw: detailRaw, weighted: detailWeighted, quota: detailQuota, diff: detailWeighted - detailQuota, status: detailPassed ? "完成" : "未完成", checkins: "", note: "" },
    ...detailSourceRows.map((row) => ({ label: row.member, items: row.items, raw: Number(row.rec?.raw_total || 0), weighted: row.weighted, quota: row.quota, diff: row.weighted - row.quota, status: row.passed ? "达标" : "未达", checkins: checkinSummary(row.checkins), note: row.rec?.reason || row.rec?.harvest || "" }))
  ].filter(Boolean);
  $("detailBody").innerHTML = detailRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      ${itemNames.map((name) => `<td>${fmt(row.items[name] || 0)}</td>`).join("")}
      <td>${fmt(row.raw || 0)}</td>
      <td>${fmt(row.weighted)}</td>
      <td>${fmt(row.quota)}</td>
      <td>${row.diff >= 0 ? "+" : ""}${fmt(row.diff)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.checkins)}</td>
      <td>${escapeHtml(row.note)}</td>
    </tr>
  `).join("");
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
function renderCheckinOverview() {
  const report = reportData();
  if (!$("checkinHead")) return;
  const pick = renderGroupMemberSelectors("checkinViewGroup", "checkinViewMember", checkinViewGroup, checkinViewMember);
  checkinViewGroup = pick.group;
  checkinViewMember = pick.member;
  if (!$("checkinViewStart").value) $("checkinViewStart").value = `${currentDate.slice(0, 7)}-01`;
  if (!$("checkinViewEnd").value) $("checkinViewEnd").value = currentDate;
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
      const rec = report.records?.[`${day}|${member}`];
      const group = report.memberGroups?.[member] || report.groups?.[0] || "";
      rows.push(`
        <tr>
          <td>${escapeHtml(day)}</td>
          <td>${escapeHtml(group)}</td>
          <td>${escapeHtml(member)}</td>
          ${checkinPeriods().map((period) => `<td>${escapeHtml(checkinDisplay(rec?.checkins?.[period.key]))}</td>`).join("")}
        </tr>
      `);
    });
  });
  $("checkinBody").innerHTML = rows.join("") || `<tr><td colspan="6" class="hint">暂无打卡记录。</td></tr>`;
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
  renderReportSourceTabs();
  $("quotaInput").value = String(data.quota);
  preview();
}
function setView(view) {
  if (view === "admin" && !adminUnlocked) {
    const password = prompt("请输入管理员密码");
    if (password !== String(data.adminPassword || "999")) {
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
  renderReportSourceTabs();
  renderOverview();
  renderHistory();
}
async function unlockSuperAdmin() {
  const password = prompt("请输入管理员密码以提升高级管理员权限");
  if (password !== String(data.adminPassword || "999")) return alert("管理员密码不正确。");
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
}
async function chooseSummaryFolder() {
  if (!("showDirectoryPicker" in window)) return alert("当前浏览器不支持选择文件夹，请用新版 Chrome/Edge。");
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  if (!(await hasCloudPermission(dir))) return;
  summaryDirHandle = dir;
  summaryLocationLabel = dir.name || "汇总文件夹";
  await saveSummaryFolders();
  renderSummaryFolders();
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
  showDialog("汇总完成", `已经把 ${count} 个来源文件夹写入汇总文件夹。当前组文件夹数据没有被替换。`, "");
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
    showDialog("配置未同步", "请确认 Vercel 云同步已配置，或选择团队共享的云端文件夹。未连接云端时，配置只会留在本机浏览器缓存里。", "");
    return;
  }
  $("adminSaveStatus").textContent = `配置已保存并同步 · ${new Date().toLocaleString("zh-CN")}`;
  showDialog("配置已保存", result.cloudDbWritten ? "项目、定额和成员名单已经写入 Vercel 云数据库。其他成员同步后会自动更新。" : "项目、定额和成员名单已经写入共享数据。其他成员同步后会自动更新。", "");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s] || s));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
function bindEvents() {
  $("dateInput").value = currentDate;
  $("dateInput").onchange = () => selectDate($("dateInput").value);
  $("overviewDateInput").onchange = () => {
    selectDate($("overviewDateInput").value || todayLocalKey());
  };
  ["monthInput", "overviewMonthInput"].forEach((id) => {
    $(id).onchange = () => selectDate(sameDayInMonth($(id).value || monthKeyFromDateKey(currentDate)));
  });
  $("prevMonthBtn").onclick = () => selectDate(shiftMonth(currentDate, -1));
  $("nextMonthBtn").onclick = () => selectDate(shiftMonth(currentDate, 1));
  $("overviewPrevMonthBtn").onclick = () => selectDate(shiftMonth(currentDate, -1));
  $("overviewNextMonthBtn").onclick = () => selectDate(shiftMonth(currentDate, 1));
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
  ["checkinViewGroup", "checkinViewMember", "checkinViewStart", "checkinViewEnd"].forEach((id) => {
    $(id).onchange = () => {
      checkinViewGroup = $("checkinViewGroup").value;
      checkinViewMember = $("checkinViewMember").value;
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
}
pruneBackups();
createBackup("每日自动备份");
bindEvents();
loadForm();
render();
setView(activeView);
restoreCloudDirectory();
refreshCloudDatabaseStatus(true);
refreshCloudBackupStatus(true);
startCloudPolling();
window.addEventListener("focus", () => {
  pollSharedFile(true);
  if (appUnlocked) pullCloudDatabaseData({ silent: true }).catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    pollSharedFile(true);
    if (appUnlocked) pullCloudDatabaseData({ silent: true }).catch(() => {});
  }
});
