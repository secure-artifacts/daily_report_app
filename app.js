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
  checkinOptions: ["准时上线", "迟到"],
  adminPassword: "999",
  sheetBackupEnabled: true,
  backupCleanupEnabled: false,
  autoUpdateEnabled: true,
  autoAudit: true,
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
let cloudPassword = "";
let lastCloudSnapshot = null;
let pollTimer = 0;
let pendingDialogField = "";
let activeView = "entry";
let saveTimer = 0;
let adminUnlocked = false;
let showAllEntryItems = false;
let appUnlocked = false;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const recordKey = () => `${currentDate}|${currentMember}`;
const cloudApiBase = String(window.DAILY_REPORT_API_URL || "").replace(/\/$/, "");
const checkinPeriods = [
  { key: "morning", label: "早" },
  { key: "noon", label: "中" },
  { key: "evening", label: "晚" }
];
function todayLocalKey() {
  const now = new Date();
  return dateKeyFromDate(now);
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
  const checkinOptions = Array.isArray(loaded.checkinOptions) && loaded.checkinOptions.length
    ? Array.from(new Set(loaded.checkinOptions.map((item) => String(item).trim()).filter(Boolean)))
    : clone(defaultData.checkinOptions);
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
    adminPassword: String(loaded.adminPassword || defaultData.adminPassword),
    sheetBackupEnabled: loaded.sheetBackupEnabled !== false,
    backupCleanupEnabled: loaded.backupCleanupEnabled === true,
    autoUpdateEnabled: loaded.autoUpdateEnabled !== false,
    autoAudit: loaded.autoAudit !== false,
    reviewMessages: {
      pass: Array.isArray(loaded.reviewMessages?.pass) ? loaded.reviewMessages.pass : clone(defaultData.reviewMessages.pass),
      fail: Array.isArray(loaded.reviewMessages?.fail) ? loaded.reviewMessages.fail : clone(defaultData.reviewMessages.fail)
    },
    records: loaded.records || {}
  };
}
function loadLocal() {
  return normalize(defaultData);
}
function readBackups() {
  return [];
}
function pruneBackups() {}
function createBackup(_label = "自动备份") {}
function persistLocal() {
  data.updated_at = new Date().toISOString();
}
function newerRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(a.updated_at || "") >= String(b.updated_at || "") ? a : b;
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
    merged.records[key] = newerRecord(remote.records[key], local.records[key]);
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
    merged.autoUpdateEnabled = local.autoUpdateEnabled !== false;
    merged.autoAudit = local.autoAudit !== false;
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
    merged.autoUpdateEnabled = remote.autoUpdateEnabled !== false;
    merged.autoAudit = remote.autoAudit !== false;
    merged.reviewMessages = clone(remote.reviewMessages || local.reviewMessages || defaultData.reviewMessages);
  }
  return normalize(merged);
}
async function readRemoteData() {
  if (!cloudPassword) return lastCloudSnapshot;
  const result = await cloudRequest("/api/data");
  return result.data || result;
}
async function persistEverywhere(mode = "records") {
  if (!appUnlocked) return;
  persistLocal();
  const remoteData = await readRemoteData().catch(() => null);
  data = mergeCloudData(remoteData, data, mode);
  persistLocal();
  const result = await cloudRequest("/api/data", {
    method: "PUT",
    body: JSON.stringify({ data })
  });
  data = normalize(result.data || data);
  lastCloudSnapshot = clone(data);
  $("syncLabel").textContent = `云端已同步 · ${new Date().toLocaleTimeString("zh-CN")}`;
}
async function cloudRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  if (options.body) headers["Content-Type"] = "application/json";
  if (cloudPassword) headers["X-App-Password"] = cloudPassword;
  const response = await fetch(`${cloudApiBase}${path}`, {
    cache: "no-store",
    ...options,
    headers
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) {
    throw new Error(payload?.error || `云端请求失败：${response.status}`);
  }
  return payload || {};
}
async function unlockCloud(password) {
  const result = await cloudRequest("/api/unlock", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return normalize(result.data || result);
}
function scheduleSave(mode = "records") {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistEverywhere(mode), 180);
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
  const daily = data.dailyQuotas?.[day];
  const dailyOwn = quotaValue(daily?.members?.[member]);
  if (dailyOwn !== null) return dailyOwn;
  const dailyDefault = quotaValue(daily?.default);
  if (dailyDefault !== null) return dailyDefault;
  const own = quotaValue(data.memberQuotas?.[member]);
  return own === null ? Number(data.quota || 0) : own;
}
function checkinOptions() {
  if (!Array.isArray(data.checkinOptions) || !data.checkinOptions.length) {
    data.checkinOptions = clone(defaultData.checkinOptions);
  }
  data.checkinOptions = Array.from(new Set(data.checkinOptions.map((item) => String(item).trim()).filter(Boolean)));
  if (!data.checkinOptions.length) data.checkinOptions = clone(defaultData.checkinOptions);
  return data.checkinOptions;
}
function defaultCheckins() {
  return Object.fromEntries(checkinPeriods.map((period) => [period.key, ""]));
}
function recordCheckins(rec) {
  if (!rec.checkins || typeof rec.checkins !== "object") rec.checkins = defaultCheckins();
  checkinPeriods.forEach((period) => {
    rec.checkins[period.key] = String(rec.checkins[period.key] || "");
  });
  return rec.checkins;
}
function checkinSummaryText(checkins) {
  return checkinPeriods
    .map((period) => `${period.label}:${checkins?.[period.key] || "未打卡"}`)
    .join(" · ");
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
  return data.members.filter((member) => (data.memberGroups?.[member] || data.groups[0]) === group);
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
function periodKeys(endKey, days) {
  return Array.from({ length: days }, (_, index) => addDays(endKey, index - days + 1));
}
function recordFor(day, member) {
  return data.records[`${day}|${member}`] || null;
}
function aggregatePeriod(days, scope, member) {
  const group = $("analysisGroup")?.value || data.groups[0];
  const members = scope === "member" ? [member] : scope === "group" ? groupMembers(group) : data.members;
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
  return Object.keys(data.rules);
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
      checkins: defaultCheckins(),
      updated_at: ""
    };
  }
  recordCheckins(data.records[recordKey()]);
  return data.records[recordKey()];
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
    });
  });
  $("entryText").value = itemsToText(readEntryInputs());
  $("selectedItemsBtn").classList.toggle("active", !showAllEntryItems);
  $("allItemsBtn").classList.toggle("active", showAllEntryItems);
}
function readCheckinInputs() {
  const rec = currentRecord();
  const current = recordCheckins(rec);
  $("checkinInputs")?.querySelectorAll("select[data-checkin-period]").forEach((select) => {
    current[select.dataset.checkinPeriod] = select.value;
  });
  return current;
}
function renderCheckinInputs() {
  const rec = currentRecord();
  const current = recordCheckins(rec);
  const options = checkinOptions();
  $("checkinInputs").innerHTML = checkinPeriods.map((period) => `
    <label class="checkin-field">
      <span>${period.label}打卡</span>
      <select data-checkin-period="${period.key}">
        <option value="">未打卡</option>
        ${options.map((option) => `<option value="${escapeAttr(option)}" ${current[period.key] === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </label>
  `).join("");
  $("checkinInputs").querySelectorAll("select[data-checkin-period]").forEach((select) => {
    select.onchange = () => {
      saveFormSilently();
      renderOverview();
      scheduleSave("records");
    };
  });
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
  $("statusPill").textContent = passed ? "达标 ✓" : "不达标";
  $("statusPill").className = `status ${passed ? "pass" : "fail"}`;
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
  renderCheckinInputs();
  $("statusSelect").value = ["自动判断", "达标", "不达标", "待审核"].includes(rec.status) ? rec.status : "自动判断";
  $("reasonText").value = rec.reason || "";
  $("harvestText").value = rec.harvest || "";
  $("diaryText").value = rec.diary || "";
  preview();
}
function saveFormSilently() {
  data.quota = Number($("quotaInput").value || 0);
  if ($("dailyQuotaInput")) setDailyMemberQuota(currentMember, currentDate, $("dailyQuotaInput").value);
  const items = readEntryInputs();
  const checkins = readCheckinInputs();
  const parsed = { items, ...entryTotals(items) };
  $("entryText").value = itemsToText(items);
  const quota = memberQuota(currentMember);
  const autoStatus = parsed.weighted >= quota ? "达标" : "不达标";
  const selected = $("statusSelect").value;
  const rec = currentRecord();
  const finalStatus = data.autoAudit === false
    ? (selected === "自动判断" ? "待审核" : selected)
    : (selected === "自动判断" ? autoStatus : selected);
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
    items: parsed.items,
    checkins,
    updated_at: new Date().toISOString()
  });
  persistLocal();
  return { rec, autoStatus };
}
function pickReviewMessage(type) {
  const list = data.reviewMessages?.[type] || defaultData.reviewMessages[type];
  return list[Math.floor(Math.random() * list.length)] || (type === "pass" ? "恭喜达标" : "很遗憾不达标");
}
async function saveAndAudit() {
  createBackup("保存前备份");
  const { rec, autoStatus } = saveFormSilently();
  await persistEverywhere("records");
  if (data.sheetBackupEnabled !== false) await backupSheets(true);
  render();
  if (!data.autoAudit) {
    showDialog("已提交", "记录已同步云端，等待管理员审核。", "");
  } else if (autoStatus === "不达标") {
    showDialog(pickReviewMessage("fail"), "记录已提交云端。还没有达到定额，可以写一下原因或补救计划。", rec.reason ? "" : "reason");
  } else if (autoStatus === "达标") {
    showDialog(pickReviewMessage("pass"), "记录已提交云端。今天达标或超额了，可以写一点收获。", rec.harvest ? "" : "harvest");
  } else {
    showDialog("已提交", "记录已同步云端。", "");
  }
}
function renderMembers() {
  $("memberList").innerHTML = "";
  data.groups.forEach((group) => {
    const members = groupMembers(group);
    const box = document.createElement("section");
    box.className = "member-group";
    box.innerHTML = `
      <div class="member-group-head">
        <span>${escapeHtml(group)} · ${members.length}</span>
        <button title="给 ${escapeAttr(group)} 添加成员" data-add-group-member="${escapeAttr(group)}">+</button>
      </div>
    `;
    members.forEach((name) => {
      const btn = document.createElement("button");
      btn.className = `member ${name === currentMember ? "active" : ""}`;
      btn.innerHTML = `<span><span>${escapeHtml(name)}</span></span><span class="badge">${memberTodayStatus(name)}</span>`;
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
  $("memberGroupBox").innerHTML = data.members.map((name, index) => {
    const group = data.memberGroups?.[name] || data.groups[0] || "";
    return `
      <div class="member-group-row">
        <input value="${escapeAttr(name)}" data-member-name="${escapeAttr(name)}" aria-label="成员">
        <select data-member-group="${escapeAttr(name)}">
          ${data.groups.map((item) => `<option value="${escapeAttr(item)}" ${item === group ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
        </select>
        <button class="icon" data-move-up="${escapeAttr(name)}" ${index === 0 ? "disabled" : ""} title="上移">↑</button>
        <button class="icon" data-move-down="${escapeAttr(name)}" ${index === data.members.length - 1 ? "disabled" : ""} title="下移">↓</button>
        <button class="icon" data-remove-member="${escapeAttr(name)}" title="删除成员">×</button>
      </div>
    `;
  }).join("");
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
function renderCheckinOptionsConfig() {
  $("checkinOptionBox").innerHTML = checkinOptions().map((name) => `
    <div class="option-row">
      <input value="${escapeAttr(name)}" data-checkin-option="${escapeAttr(name)}" aria-label="打卡选项">
      <button class="icon" data-remove-checkin-option="${escapeAttr(name)}" title="删除选项">×</button>
    </div>
  `).join("");
  $("checkinOptionBox").querySelectorAll("input[data-checkin-option]").forEach((input) => {
    input.onchange = () => renameCheckinOption(input.dataset.checkinOption, input.value.trim());
  });
  $("checkinOptionBox").querySelectorAll("button[data-remove-checkin-option]").forEach((button) => {
    button.onclick = () => removeCheckinOption(button.dataset.removeCheckinOption);
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
function addCheckinOption(name) {
  const value = String(name || "").trim();
  if (!value || checkinOptions().includes(value)) return;
  data.checkinOptions.push(value);
  $("checkinOptionInput").value = "";
  renderCheckinOptionsConfig();
  renderCheckinInputs();
  renderOverview();
  scheduleSave("admin");
}
function renameCheckinOption(oldName, newName) {
  const next = String(newName || "").trim();
  if (!next || (next !== oldName && checkinOptions().includes(next))) return renderCheckinOptionsConfig();
  data.checkinOptions = checkinOptions().map((item) => item === oldName ? next : item);
  Object.values(data.records || {}).forEach((rec) => {
    const checkins = recordCheckins(rec);
    checkinPeriods.forEach((period) => {
      if (checkins[period.key] === oldName) checkins[period.key] = next;
    });
  });
  render();
  scheduleSave("admin");
}
function removeCheckinOption(name) {
  if (checkinOptions().length <= 1) return alert("至少保留一个打卡选项。");
  if (!confirm(`确定删除打卡选项“${name}”？已使用该选项的记录会改为未打卡。`)) return;
  data.checkinOptions = checkinOptions().filter((item) => item !== name);
  Object.values(data.records || {}).forEach((rec) => {
    const checkins = recordCheckins(rec);
    checkinPeriods.forEach((period) => {
      if (checkins[period.key] === name) checkins[period.key] = "";
    });
  });
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
  if (!confirm(`确定删除成员“${name}”？历史记录会保留。`)) return;
  data.members = data.members.filter((item) => item !== name);
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
function renderOverview() {
  $("overviewDateInput").value = currentDate;
  const itemNames = configuredItems();
  const rows = data.members.map((member) => {
    const rec = data.records[`${currentDate}|${member}`];
    const quota = memberQuota(member, currentDate);
    const weighted = Number(rec?.weighted_total || 0);
    const status = rec?.status || "待审核";
    const passed = status === "达标" || weighted >= quota;
    const rate = quota > 0 ? Math.min(100, Math.round((weighted / quota) * 100)) : 100;
    const items = rec?.items || {};
    const checkins = rec ? recordCheckins(rec) : defaultCheckins();
    return { member, rec, quota, weighted, passed, rate, items, checkins };
  });
  const pass = rows.filter((row) => row.passed).length;
  const fail = rows.length - pass;
  const totalWeighted = rows.reduce((sum, row) => sum + row.weighted, 0);
  const totalQuota = rows.reduce((sum, row) => sum + row.quota, 0);
  const teamPassed = totalWeighted >= totalQuota;
  const itemTotals = itemNames.reduce((totals, name) => {
    totals[name] = rows.reduce((sum, row) => sum + Number(row.items[name] || 0), 0);
    return totals;
  }, {});
  $("overviewTitle").textContent = `${currentDate} 达标情况`;
  $("passCount").textContent = String(pass);
  $("failCount").textContent = String(fail);
  $("passRate").textContent = rows.length ? `${Math.round(pass / rows.length * 100)}%` : "0%";
  $("teamTotal").textContent = fmt(totalWeighted);
  $("teamQuota").textContent = `${fmt(totalQuota)} ${teamPassed ? "✓" : ""}`;
  $("teamDiff").textContent = `${totalWeighted - totalQuota >= 0 ? "+" : ""}${fmt(totalWeighted - totalQuota)}`;
  $("overviewHint").textContent = `${rows.length} 位成员 · 小组${teamPassed ? "已完成" : "未完成"}总定额`;
  $("overviewGrid").innerHTML = rows.map((row) => `
    <article class="person-card ${row.passed ? "pass" : "fail"}">
      <div class="person-top">
        <span>${escapeHtml(row.member)}</span>
        <span class="status ${row.passed ? "pass" : "fail"}">${row.passed ? "达标" : "未达"}</span>
      </div>
      <div class="progress" title="${row.rate}%"><span style="--w:${row.rate}%"></span></div>
      <div class="hint">换算 ${fmt(row.weighted)} / 定额 ${fmt(row.quota)}</div>
      <div class="hint">差额 ${row.weighted - row.quota >= 0 ? "+" : ""}${fmt(row.weighted - row.quota)}</div>
      <div class="hint">${escapeHtml(checkinSummaryText(row.checkins))}</div>
      <div class="hint">${escapeHtml(row.rec?.reason || row.rec?.harvest || "暂无备注")}</div>
    </article>
  `).join("");
  renderGroupCheckinSummary(rows);
  $("detailHint").textContent = itemNames.map((name) => `${name} ${fmt(itemTotals[name])}`).join(" · ");
  $("detailHead").innerHTML = `
    <tr>
      <th>成员</th>
      ${checkinPeriods.map((period) => `<th>${period.label}打卡</th>`).join("")}
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
      <th>原始</th>
      <th>换算</th>
      <th>定额</th>
      <th>差额</th>
      <th>状态</th>
      <th>备注</th>
    </tr>
  `;
  $("detailBody").innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.member)}</td>
      ${checkinPeriods.map((period) => `<td>${escapeHtml(row.checkins?.[period.key] || "未打卡")}</td>`).join("")}
      ${itemNames.map((name) => `<td>${fmt(row.items[name] || 0)}</td>`).join("")}
      <td>${fmt(row.rec?.raw_total || 0)}</td>
      <td>${fmt(row.weighted)}</td>
      <td>${fmt(row.quota)}</td>
      <td>${row.weighted - row.quota >= 0 ? "+" : ""}${fmt(row.weighted - row.quota)}</td>
      <td>${row.passed ? "达标" : "未达"}</td>
      <td>${escapeHtml(row.rec?.reason || row.rec?.harvest || "")}</td>
    </tr>
  `).join("") + `
    <tr>
      <th>合计</th>
      ${checkinPeriods.map(() => `<th></th>`).join("")}
      ${itemNames.map((name) => `<th>${fmt(itemTotals[name])}</th>`).join("")}
      <th>${fmt(rows.reduce((sum, row) => sum + Number(row.rec?.raw_total || 0), 0))}</th>
      <th>${fmt(totalWeighted)}</th>
      <th>${fmt(totalQuota)}</th>
      <th>${totalWeighted - totalQuota >= 0 ? "+" : ""}${fmt(totalWeighted - totalQuota)}</th>
      <th>${teamPassed ? "完成" : "未完成"}</th>
      <th></th>
    </tr>
  `;
  renderAnalytics();
}
function renderGroupCheckinSummary(rows) {
  const rowMap = new Map(rows.map((row) => [row.member, row]));
  const options = checkinOptions();
  $("groupCheckinSummary").innerHTML = data.groups.map((group) => {
    const members = groupMembers(group);
    const memberRows = members.map((member) => rowMap.get(member)).filter(Boolean);
    const allDone = memberRows.filter((row) => checkinPeriods.every((period) => row.checkins?.[period.key])).length;
    const anyLate = memberRows.filter((row) => checkinPeriods.some((period) => row.checkins?.[period.key] === "迟到")).length;
    const periodRows = checkinPeriods.map((period) => {
      const counts = options.map((option) => {
        const count = memberRows.filter((row) => row.checkins?.[period.key] === option).length;
        return `${option} ${count}`;
      });
      const missing = memberRows.filter((row) => !row.checkins?.[period.key]).length;
      return `<div><strong>${period.label}打卡</strong><span>${counts.join(" · ")} · 未打卡 ${missing}</span></div>`;
    }).join("");
    return `
      <article class="checkin-summary-card">
        <div class="checkin-summary-head">
          <strong>${escapeHtml(group)}</strong>
          <span>${members.length} 人 · 全部完成 ${allDone} · 有迟到 ${anyLate}</span>
        </div>
        <div class="checkin-summary-lines">${periodRows}</div>
      </article>
    `;
  }).join("") || `<div class="hint">还没有分组。</div>`;
}
function renderHistory() {
  const rows = Object.values(data.records).sort((a, b) => `${b.date}|${b.member}`.localeCompare(`${a.date}|${a.member}`));
  $("historyCount").textContent = `${rows.length} 条记录`;
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
function renderAnalysisMemberOptions() {
  const select = $("analysisMember");
  const current = select.value || currentMember;
  select.innerHTML = data.members.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = data.members.includes(current) ? current : currentMember;
  const groupSelect = $("analysisGroup");
  const currentGroup = groupSelect.value || data.groups[0];
  groupSelect.innerHTML = data.groups.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
  groupSelect.value = data.groups.includes(currentGroup) ? currentGroup : data.groups[0];
}
function renderAnalytics() {
  renderAnalysisMemberOptions();
  const scope = $("analysisScope").value || "team";
  const member = $("analysisMember").value || currentMember;
  const range = Math.max(1, Math.min(62, Number($("analysisCustomDays").value || $("analysisRange").value || 7)));
  const compareMode = $("analysisCompare").value || "previous";
  $("analysisMember").disabled = scope !== "member";
  $("analysisGroup").disabled = scope !== "group";
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
  const label = scope === "member" ? member : scope === "group" ? $("analysisGroup").value : "团队";
  const compareLabel = { previous: `当前 ${range} 天 vs 前 ${range} 天`, thisWeek: "本周累计", lastMonth: "对比上月同期" }[compareMode] || `当前 ${range} 天 vs 前 ${range} 天`;
  $("analysisHint").textContent = `${label} · ${compareMode === "thisWeek" ? "本周" : `${range} 天`} · ${compareLabel}`;
  $("analysisSummary").innerHTML = `
    <div class="analysis-card"><span>完成量</span><strong>${fmt(current.weighted)}</strong></div>
    <div class="analysis-card"><span>周期定额</span><strong>${fmt(current.quota)}</strong></div>
    <div class="analysis-card ${current.diff >= 0 ? "good" : "bad"}"><span>周期差额</span><strong>${current.diff >= 0 ? "+" : ""}${fmt(current.diff)}</strong></div>
    <div class="analysis-card ${weightedDelta >= 0 ? "good" : "bad"}"><span>完成量对比</span><strong>${weightedDelta >= 0 ? "+" : ""}${fmt(weightedDelta)}</strong></div>
  `;
  $("compareSummary").innerHTML = `
    <div class="analysis-card"><span>当前段</span><strong>${fmt(current.weighted)}</strong></div>
    <div class="analysis-card"><span>对比段</span><strong>${fmt(previous.weighted)}</strong></div>
    <div class="analysis-card ${weightedDelta >= 0 ? "good" : "bad"}"><span>完成量差</span><strong>${weightedDelta >= 0 ? "+" : ""}${fmt(weightedDelta)}</strong></div>
    <div class="analysis-card ${diffDelta >= 0 ? "good" : "bad"}"><span>差额变化</span><strong>${diffDelta >= 0 ? "+" : ""}${fmt(diffDelta)}</strong></div>
  `;
  renderMiniBars("compareChart", [
    { label: `${days[0].slice(5)}-${days[days.length - 1].slice(5)}`, weighted: current.weighted },
    { label: `${compareDays[0].slice(5)}-${compareDays[compareDays.length - 1].slice(5)}`, weighted: previous.weighted }
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
function renderPersonalTable(days, aggregate, scope, member) {
  const itemNames = configuredItems();
  const members = scope === "member" ? [member] : scope === "group" ? groupMembers($("analysisGroup").value) : data.members;
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
      const quota = memberQuota(name, currentDate);
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
      <th>${scope === "member" ? escapeHtml(member) : "团队"}</th>
      ${itemNames.map((name) => `<th>${fmt(aggregate.itemTotals[name] || 0)}</th>`).join("")}
      <th>${fmt(aggregate.weighted)}</th>
      <th>${fmt(aggregate.quota)}</th>
      <th>${aggregate.diff >= 0 ? "+" : ""}${fmt(aggregate.diff)}</th>
    </tr>
  `);
  $("personalBody").innerHTML = rows.join("");
}
function renderBackups() {
  $("backupList").innerHTML = `
    <div class="hint">网页端不写入浏览器本地缓存或本地备份。记录、配置和打卡选项仅在解锁后写入云端数据接口。</div>
  `;
}
function renderAdminSettings() {
  $("autoAuditToggle").checked = data.autoAudit !== false;
  $("sheetBackupToggle").checked = data.sheetBackupEnabled !== false;
  $("backupCleanupToggle").checked = data.backupCleanupEnabled === true;
  $("autoUpdateToggle").checked = data.autoUpdateEnabled !== false;
  $("passMessagesInput").value = (data.reviewMessages?.pass || defaultData.reviewMessages.pass).join("\n");
  $("failMessagesInput").value = (data.reviewMessages?.fail || defaultData.reviewMessages.fail).join("\n");
}
function collectAdminSettings() {
  data.autoAudit = $("autoAuditToggle").checked;
  data.sheetBackupEnabled = $("sheetBackupToggle").checked;
  data.backupCleanupEnabled = $("backupCleanupToggle").checked;
  data.autoUpdateEnabled = $("autoUpdateToggle").checked;
  data.reviewMessages = {
    pass: $("passMessagesInput").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 30),
    fail: $("failMessagesInput").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 30)
  };
  if (!data.reviewMessages.pass.length) data.reviewMessages.pass = clone(defaultData.reviewMessages.pass);
  if (!data.reviewMessages.fail.length) data.reviewMessages.fail = clone(defaultData.reviewMessages.fail);
}
function render() {
  renderMembers();
  renderRules();
  renderMemberQuotas();
  renderMemberGroups();
  renderMemberItemConfig();
  renderCheckinOptionsConfig();
  renderEntryInputs(readEntryInputs());
  renderCheckinInputs();
  renderOverview();
  renderHistory();
  renderBackups();
  renderAdminSettings();
  $("quotaInput").value = String(data.quota);
  preview();
}
function setView(view) {
  if (!appUnlocked) return;
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
  $("dialog").classList.add("show");
}
function closeDialog() {
  $("dialog").classList.remove("show");
}
function renderUpdateState(state = {}) {
  const text = $("updateStatusText");
  if (!text) return;
  text.textContent = state.message || "网页版本已移除软件自动更新；请通过服务器部署更新代码。";
  const installButton = $("installUpdateBtn");
  if (installButton) installButton.disabled = true;
  if (state.autoCheck !== undefined && $("autoUpdateToggle")) {
    $("autoUpdateToggle").checked = state.autoCheck !== false;
  }
}
function initSoftwareUpdates() {
  renderUpdateState();
  if ($("checkUpdateBtn")) $("checkUpdateBtn").disabled = true;
  if ($("installUpdateBtn")) $("installUpdateBtn").disabled = true;
}
async function unlockApp() {
  const password = $("appPasswordInput").value;
  if (!password) {
    $("lockHint").textContent = "请输入密码";
    $("appPasswordInput").select();
    return;
  }
  $("lockHint").textContent = "正在连接云端...";
  $("unlockBtn").disabled = true;
  try {
    cloudPassword = password;
    data = await unlockCloud(password);
    lastCloudSnapshot = clone(data);
    currentMember = data.members.includes(currentMember) ? currentMember : data.members[0];
    appUnlocked = true;
    adminUnlocked = true;
    $("lockScreen").classList.add("hidden");
    $("appPasswordInput").value = "";
    $("syncLabel").textContent = `云端已连接 · ${new Date().toLocaleTimeString("zh-CN")}`;
    loadForm();
    render();
    setView(activeView);
    startCloudPolling();
  } catch (err) {
    cloudPassword = "";
    $("lockHint").textContent = err.message.includes("Failed to fetch")
      ? "云端接口不可用，请通过 npm start 或已部署的网址访问。"
      : err.message;
    $("appPasswordInput").select();
  } finally {
    $("unlockBtn").disabled = false;
  }
}
async function refreshCloudData(forceRender = true) {
  if (!appUnlocked || !cloudPassword) return;
  const remote = normalize(await readRemoteData());
  const remoteStamp = String(remote.updated_at || "");
  const localStamp = String(data.updated_at || "");
  if (!forceRender && remoteStamp && remoteStamp === localStamp) return;
  const shouldRender = forceRender || Boolean(remoteStamp && remoteStamp !== localStamp);
  data = mergeCloudData(remote, data, "records");
  lastCloudSnapshot = clone(remote);
  if (!data.members.includes(currentMember)) currentMember = data.members[0];
  if (shouldRender) {
    loadForm();
    render();
  }
  $("syncLabel").textContent = `云端已刷新 · ${new Date().toLocaleTimeString("zh-CN")}`;
}
function startCloudPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => refreshCloudData(false).catch(() => {
    $("syncLabel").textContent = "云端暂时不可读，等待下次刷新";
  }), 3000);
}
async function chooseSharedFile() {
  await refreshCloudData(true);
}
async function pollSharedFile() {
  try {
    await refreshCloudData(false);
  } catch {
    $("syncLabel").textContent = "云端暂时不可读，等待下次刷新";
  }
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
  const header = ["日期", "成员", "分组", ...checkinPeriods.map((period) => `${period.label}打卡`), ...itemNames, "原始", "换算", "定额", "差额", "状态", "备注"];
  const recordRow = (rec) => {
    const quota = memberQuota(rec.member, rec.date);
    const checkins = recordCheckins(rec);
    return [
      rec.date,
      rec.member,
      data.memberGroups?.[rec.member] || "",
      ...checkinPeriods.map((period) => checkins[period.key] || "未打卡"),
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
  const rows = [["日期", "成员", ...checkinPeriods.map((period) => `${period.label}打卡`), ...itemNames, "原始", "换算", "定额", "差额", "状态", "备注"]];
  Object.values(data.records)
    .sort((a, b) => `${a.date}|${a.member}`.localeCompare(`${b.date}|${b.member}`))
    .forEach((rec) => {
      const quota = memberQuota(rec.member, rec.date);
      rows.push([
        rec.date,
        rec.member,
        ...checkinPeriods.map((period) => recordCheckins(rec)[period.key] || "未打卡"),
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
  reader.onload = async () => {
    createBackup("导入前备份");
    data = normalize(JSON.parse(String(reader.result || "{}")));
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    await persistEverywhere("admin");
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
  await persistEverywhere("admin");
  if (nextPassword) cloudPassword = nextPassword;
  render();
  $("adminSaveStatus").textContent = `配置已保存并同步 · ${new Date().toLocaleString("zh-CN")}`;
  showDialog("配置已保存", "项目、定额、成员名单和打卡选项已经写入云端。其他成员刷新后会自动更新。", "");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s] || s));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
function bindEvents() {
  $("dateInput").value = currentDate;
  $("dateInput").onchange = () => {
    saveFormSilently();
    currentDate = $("dateInput").value;
    loadForm();
    render();
  };
  $("overviewDateInput").onchange = () => {
    saveFormSilently();
    currentDate = $("overviewDateInput").value || todayLocalKey();
    $("dateInput").value = currentDate;
    loadForm();
    render();
  };
  $("unlockBtn").onclick = unlockApp;
  $("appPasswordInput").onkeydown = (event) => {
    if (event.key === "Enter") unlockApp();
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
    scheduleSave("records");
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
  $("entryText").oninput = preview;
  $("statusSelect").onchange = saveFormSilently;
  $("reasonText").onchange = saveFormSilently;
  $("harvestText").onchange = saveFormSilently;
  $("diaryText").onchange = saveFormSilently;
  $("saveBtn").onclick = () => activeView === "admin" ? saveAdminConfig() : saveAndAudit();
  $("adminSaveBtn").onclick = saveAdminConfig;
  $("autoAuditToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("sheetBackupToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("backupCleanupToggle").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("autoUpdateToggle").onchange = () => {
    collectAdminSettings();
    renderUpdateState();
    scheduleSave("admin");
  };
  $("checkUpdateBtn").onclick = () => renderUpdateState({ message: "网页版本请在服务器上部署新版代码。" });
  $("installUpdateBtn").onclick = () => renderUpdateState({ message: "网页版本没有本地安装包更新流程。" });
  $("passMessagesInput").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  $("failMessagesInput").onchange = () => { collectAdminSettings(); scheduleSave("admin"); };
  ["analysisScope", "analysisGroup", "analysisMember", "analysisRange", "analysisCustomDays", "analysisCompare", "rangeStart", "rangeEnd"].forEach((id) => {
    $(id).onchange = renderAnalytics;
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
  $("addCheckinOptionBtn").onclick = () => addCheckinOption($("checkinOptionInput").value);
  $("checkinOptionInput").onkeydown = (event) => {
    if (event.key === "Enter") addCheckinOption($("checkinOptionInput").value);
  };
  $("compactToggle").onchange = () => $("app").classList.toggle("compact", $("compactToggle").checked);
  $("openFileBtn").onclick = () => chooseSharedFile().catch((err) => alert(`打开失败：${err.message}`));
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
}
bindEvents();
initSoftwareUpdates();
$("syncLabel").textContent = "云端未解锁";
