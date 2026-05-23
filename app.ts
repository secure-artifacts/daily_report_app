type StatusText = "自动判断" | "达标" | "不达标" | "待审核";

type ReportRecord = {
  date: string;
  member: string;
  text: string;
  raw_total: number;
  weighted_total: number;
  status: StatusText | string;
  reason: string;
  harvest: string;
  diary: string;
  items: Record<string, number>;
  updated_at: string;
};

type ReportData = {
  version: number;
  updated_at: string;
  quota: number;
  rules: Record<string, number>;
  members: string[];
  memberQuotas: Record<string, number | "">;
  adminPassword?: string;
  records: Record<string, ReportRecord>;
};

type BackupItem = {
  id: string;
  created_at: string;
  label: string;
  data: ReportData;
};

type DesktopBridge = {
  isDesktop: boolean;
  getCloudData: () => Promise<any>;
  chooseCloudFolder: (initialData: ReportData) => Promise<any>;
  writeCloudData: (data: ReportData) => Promise<any>;
  pollCloudData: () => Promise<any>;
};

declare global {
  interface Window {
    desktopApp?: DesktopBridge;
  }
}

const defaultData: ReportData = {
  version: 2,
  updated_at: "",
  quota: 3,
  rules: { "视频": 1, "音频": 1, "字幕": 0.25, "图片": 0 },
  members: ["成员A"],
  memberQuotas: {},
  adminPassword: "999",
  records: {}
};

const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
let data: ReportData = loadLocal();
let currentMember = data.members[0] || "成员A";
let currentDate = new Date().toISOString().slice(0, 10);
let fileHandle: FileSystemFileHandle | null = null;
let cloudDirHandle: FileSystemDirectoryHandle | null = null;
let lastFileModified = 0;
let pendingDialogField = "";
let activeView = "entry";
let saveTimer = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number | string | undefined) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const recordKey = () => `${currentDate}|${currentMember}`;
const desktopApp = window.desktopApp || null;

function normalize(source: Partial<ReportData> | null): ReportData {
  const loaded = source || {};
  const members = Array.isArray(loaded.members) && loaded.members.length ? loaded.members.map(String) : ["成员A"];
  const rules = loaded.rules && typeof loaded.rules === "object" ? loaded.rules : clone(defaultData.rules);
  const memberQuotas = { ...(loaded.memberQuotas || {}) };
  return {
    ...clone(defaultData),
    ...loaded,
    version: 2,
    quota: Number(loaded.quota ?? defaultData.quota),
    rules,
    members,
    memberQuotas,
    adminPassword: String(loaded.adminPassword || defaultData.adminPassword),
    records: loaded.records || {}
  };
}

function loadLocal(): ReportData {
  try {
    const saved = JSON.parse(localStorage.getItem("dailyReportData") || "null");
    return normalize(saved);
  } catch {
    return clone(defaultData);
  }
}

function readBackups(): BackupItem[] {
  try {
    const items = JSON.parse(localStorage.getItem("dailyReportBackups") || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeBackups(items: BackupItem[]) {
  localStorage.setItem("dailyReportBackups", JSON.stringify(items));
}

function pruneBackups() {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  writeBackups(readBackups().filter((item) => new Date(item.created_at).getTime() >= cutoff).slice(0, 80));
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
}

async function persistEverywhere(_mode = "records") {
  persistLocal();
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.writeCloudData(data);
    if (result?.path) {
      lastFileModified = result.mtime || lastFileModified;
      $("syncLabel").textContent = `软件同步：${result.path}`;
    }
    return;
  }
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    const file = await fileHandle.getFile();
    lastFileModified = file.lastModified;
    $("syncLabel").textContent = `共享文件：${file.name}`;
  } catch {
    $("syncLabel").textContent = "共享文件写入失败，已保存到本地浏览器";
  }
}
function openCloudDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dailyReportCloud", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveCloudDirectory(dir: FileSystemDirectoryHandle) {
  try {
    const db = await openCloudDb();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(dir, "directory");
  } catch {}
}
async function loadCloudDirectory(): Promise<FileSystemDirectoryHandle | null> {
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
async function hasCloudPermission(dir: FileSystemDirectoryHandle) {
  const options = { mode: "readwrite" } as const;
  if ((await dir.queryPermission?.(options)) === "granted") return true;
  return (await dir.requestPermission?.(options)) === "granted";
}
async function useCloudDirectory(dir: FileSystemDirectoryHandle, shouldSave = true) {
  if (!(await hasCloudPermission(dir))) return false;
  cloudDirHandle = dir;
  const handle = await dir.getFileHandle("report_data.json", { create: true });
  fileHandle = handle;
  const file = await handle.getFile();
  lastFileModified = file.lastModified;
  const text = await file.text();
  createBackup("连接云端文件夹前备份");
  if (text.trim()) data = normalize(JSON.parse(text));
  persistLocal();
  $("syncLabel").textContent = `云端文件夹：${dir.name}\\report_data.json`;
  if (!data.members.includes(currentMember)) currentMember = data.members[0];
  loadForm();
  render();
  if (!text.trim()) await persistEverywhere();
  if (shouldSave) await saveCloudDirectory(dir);
  return true;
}
async function restoreCloudDirectory() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.getCloudData();
    if (!result || result.error) return;
    if (result.text?.trim()) data = normalize(JSON.parse(result.text));
    lastFileModified = result.mtime || 0;
    $("syncLabel").textContent = `软件同步：${result.path}`;
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    persistLocal();
    loadForm();
    render();
    return;
  }
  if (!("showDirectoryPicker" in window) || !("indexedDB" in window)) return;
  const dir = await loadCloudDirectory();
  if (dir) await useCloudDirectory(dir, false);
}

function scheduleSave(mode = "records") {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistEverywhere(mode), 180);
}

function memberQuota(member: string) {
  const own = data.memberQuotas?.[member];
  return own === "" || own === undefined || own === null ? Number(data.quota || 0) : Number(own);
}

function configuredItems() {
  return Object.keys(data.rules);
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

function normalizeNumberText(value: string) {
  const full = "０１２３４５６７８９．，";
  const half = "0123456789..";
  return value.replace(/[０-９．，]/g, (char) => half[full.indexOf(char)] || char).replace(/,/g, ".");
}

function currentRecord(): ReportRecord {
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
      updated_at: ""
    };
  }
  return data.records[recordKey()];
}

function parseEntry(text: string) {
  const items: Record<string, number> = {};
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
function entryTotals(items: Record<string, number>) {
  const raw = Object.values(items).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const weighted = Object.entries(items).reduce((sum, [name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return sum + Number(amount || 0) * (Number.isFinite(weight) ? weight : 1);
  }, 0);
  return { raw, weighted };
}
function itemsToText(items: Record<string, number>) {
  return Object.entries(items)
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([name, amount]) => `${name}：${Number(amount || 0)}`)
    .join("\n");
}
function readEntryInputs() {
  const inputs = $("entryInputs").querySelectorAll<HTMLInputElement>("input[data-entry-item]");
  if (!inputs.length) return parseEntry($<HTMLTextAreaElement>("entryText").value).items;
  const items: Record<string, number> = {};
  inputs.forEach((input) => {
    const name = input.dataset.entryItem || "";
    if (!name) return;
    items[name] = Number(input.value || 0);
  });
  return items;
}
function filterItemsByRules(items: Record<string, number>) {
  const filtered: Record<string, number> = {};
  configuredItems().forEach((name) => {
    filtered[name] = Number(items[name] || 0);
  });
  return filtered;
}
function renderEntryInputs(seedItems = readEntryInputs()) {
  const names = configuredItems();
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
  $("entryInputs").querySelectorAll<HTMLInputElement>("input[data-entry-item]").forEach((input) => {
    input.addEventListener("input", () => {
      $<HTMLTextAreaElement>("entryText").value = itemsToText(readEntryInputs());
      preview();
    });
  });
  $<HTMLTextAreaElement>("entryText").value = itemsToText(readEntryInputs());
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
  $("previewBody").innerHTML = Object.entries(parsed.items).map(([name, amount]) => {
    const weight = Number(data.rules[name] ?? 1);
    return `<tr><td>${escapeHtml(name)}</td><td>${fmt(amount)}</td><td>${fmt(weight)}</td><td>${fmt(amount * weight)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">还没有可统计的报数。</td></tr>`;
}

function loadForm() {
  const rec = currentRecord();
  $<HTMLInputElement>("dateInput").value = currentDate;
  $<HTMLInputElement>("quotaInput").value = String(data.quota);
  $<HTMLTextAreaElement>("entryText").value = rec.text || "";
  renderEntryInputs(Object.keys(rec.items || {}).length ? rec.items : parseEntry(rec.text || "").items);
  $<HTMLSelectElement>("statusSelect").value = ["自动判断", "达标", "不达标", "待审核"].includes(rec.status) ? rec.status : "自动判断";
  $<HTMLTextAreaElement>("reasonText").value = rec.reason || "";
  $<HTMLTextAreaElement>("harvestText").value = rec.harvest || "";
  $<HTMLTextAreaElement>("diaryText").value = rec.diary || "";
  preview();
}

function saveFormSilently() {
  data.quota = Number($<HTMLInputElement>("quotaInput").value || 0);
  const items = readEntryInputs();
  const parsed = { items, ...entryTotals(items) };
  $<HTMLTextAreaElement>("entryText").value = itemsToText(items);
  const quota = memberQuota(currentMember);
  const autoStatus = parsed.weighted >= quota ? "达标" : "不达标";
  const selected = $<HTMLSelectElement>("statusSelect").value;
  const rec = currentRecord();
  Object.assign(rec, {
    date: currentDate,
    member: currentMember,
    text: itemsToText(items),
    raw_total: parsed.raw,
    weighted_total: parsed.weighted,
    status: selected === "自动判断" ? autoStatus : selected,
    reason: $<HTMLTextAreaElement>("reasonText").value.trim(),
    harvest: $<HTMLTextAreaElement>("harvestText").value.trim(),
    diary: $<HTMLTextAreaElement>("diaryText").value.trim(),
    items: parsed.items,
    updated_at: new Date().toISOString()
  });
  scheduleSave();
  return { rec, autoStatus };
}

function saveAndAudit() {
  createBackup("保存前备份");
  const { rec, autoStatus } = saveFormSilently();
  render();
  if (autoStatus === "不达标" && !rec.reason) {
    showDialog("今天未达标", "还没有达到定额，可以写一下原因或补救计划。", "reason");
  } else if (autoStatus === "达标" && !rec.harvest) {
    showDialog("达标啦 ✓", "今天达标或超额了，可以写一点收获。", "harvest");
  } else {
    showDialog("已保存", "数据已同步到本地；如果已选择共享文件，也会写入云端同步目录。", "");
  }
}

function renderMembers() {
  $("memberList").innerHTML = "";
  data.members.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = `member ${name === currentMember ? "active" : ""}`;
    btn.innerHTML = `<span>${escapeHtml(name)}</span><span class="badge">${memberTodayStatus(name)}</span>`;
    btn.onclick = () => {
      saveFormSilently();
      currentMember = name;
      loadForm();
      render();
    };
    $("memberList").appendChild(btn);
  });
  $("memberCard").textContent = currentMember;
}

function memberTodayStatus(name: string) {
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
    row.querySelector("button")!.onclick = () => {
      createBackup(`删除项目 ${name} 前备份`);
      delete data.rules[name];
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
  data.members.forEach((name) => {
    const row = document.createElement("div");
    row.className = "quota-row";
    const own = data.memberQuotas[name] ?? "";
    row.innerHTML = `
      <input value="${escapeAttr(name)}" aria-label="成员">
      <input type="number" step="0.01" min="0" placeholder="${fmt(data.quota)}" value="${own === "" ? "" : Number(own)}" aria-label="成员定额">
      <button class="icon" title="删除成员">×</button>
    `;
    const inputs = row.querySelectorAll("input");
    inputs[0].onchange = () => renameMember(name, inputs[0].value.trim());
    inputs[1].oninput = () => {
      data.memberQuotas[name] = inputs[1].value === "" ? "" : Number(inputs[1].value);
      renderOverview();
      scheduleSave();
    };
    row.querySelector("button")!.onclick = () => removeMember(name);
    $("memberQuotaBox").appendChild(row);
  });
}

function renameRule(oldName: string, newName: string, weight: number) {
  if (!newName) return renderRules();
  delete data.rules[oldName];
  data.rules[newName] = Number.isFinite(weight) ? weight : 1;
  renderRules();
  renderEntryInputs(filterItemsByRules(readEntryInputs()));
  preview();
  scheduleSave();
}

function renameMember(oldName: string, newName: string) {
  if (!newName || data.members.includes(newName)) return renderMemberQuotas();
  data.members = data.members.map((name) => name === oldName ? newName : name);
  if (data.memberQuotas[oldName] !== undefined) {
    data.memberQuotas[newName] = data.memberQuotas[oldName];
    delete data.memberQuotas[oldName];
  }
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
  scheduleSave();
}

function addMember(name: string) {
  if (!name || data.members.includes(name)) return;
  saveFormSilently();
  data.members.push(name);
  currentMember = name;
  $<HTMLInputElement>("memberName").value = "";
  loadForm();
  render();
  scheduleSave();
}

function removeMember(name: string) {
  if (data.members.length <= 1) return alert("至少保留一个成员。");
  if (!confirm(`确定删除成员“${name}”？历史记录会保留。`)) return;
  data.members = data.members.filter((item) => item !== name);
  delete data.memberQuotas[name];
  if (currentMember === name) currentMember = data.members[0];
  loadForm();
  render();
  scheduleSave();
}

function renderOverview() {
  const itemNames = configuredItems();
  const rows = data.members.map((member) => {
    const rec = data.records[`${currentDate}|${member}`];
    const quota = memberQuota(member);
    const weighted = Number(rec?.weighted_total || 0);
    const status = rec?.status || "待审核";
    const passed = status === "达标" || weighted >= quota;
    const rate = quota > 0 ? Math.min(100, Math.round((weighted / quota) * 100)) : 100;
    const items = rec?.items || {};
    return { member, rec, quota, weighted, passed, rate, items };
  });
  const pass = rows.filter((row) => row.passed).length;
  const fail = rows.length - pass;
  const totalWeighted = rows.reduce((sum, row) => sum + row.weighted, 0);
  const totalQuota = rows.reduce((sum, row) => sum + row.quota, 0);
  const teamPassed = totalWeighted >= totalQuota;
  const itemTotals = itemNames.reduce<Record<string, number>>((totals, name) => {
    totals[name] = rows.reduce((sum, row) => sum + Number(row.items[name] || 0), 0);
    return totals;
  }, {});
  $("overviewTitle").textContent = `${currentDate} 达标情况`;
  $("passCount").textContent = String(pass);
  $("failCount").textContent = String(fail);
  $("passRate").textContent = rows.length ? `${Math.round(pass / rows.length * 100)}%` : "0%";
  $("teamTotal").textContent = fmt(totalWeighted);
  $("teamQuota").textContent = `${fmt(totalQuota)} ${teamPassed ? "✓" : ""}`;
  $("overviewHint").textContent = `${rows.length} 位成员 · 小组${teamPassed ? "已完成" : "未完成"}总定额`;
  $("overviewGrid").innerHTML = rows.map((row) => `
    <article class="person-card ${row.passed ? "pass" : "fail"}">
      <div class="person-top">
        <span>${escapeHtml(row.member)}</span>
        <span class="status ${row.passed ? "pass" : "fail"}">${row.passed ? "达标" : "未达"}</span>
      </div>
      <div class="progress" title="${row.rate}%"><span style="--w:${row.rate}%"></span></div>
      <div class="hint">换算 ${fmt(row.weighted)} / 定额 ${fmt(row.quota)}</div>
      <div class="hint">${escapeHtml(row.rec?.reason || row.rec?.harvest || "暂无备注")}</div>
    </article>
  `).join("");
  $("detailHint").textContent = itemNames.map((name) => `${name} ${fmt(itemTotals[name])}`).join(" · ");
  $("detailHead").innerHTML = `
    <tr>
      <th>成员</th>
      ${itemNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
      <th>原始</th>
      <th>换算</th>
      <th>定额</th>
      <th>状态</th>
      <th>备注</th>
    </tr>
  `;
  $("detailBody").innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.member)}</td>
      ${itemNames.map((name) => `<td>${fmt(row.items[name] || 0)}</td>`).join("")}
      <td>${fmt(row.rec?.raw_total || 0)}</td>
      <td>${fmt(row.weighted)}</td>
      <td>${fmt(row.quota)}</td>
      <td>${row.passed ? "达标" : "未达"}</td>
      <td>${escapeHtml(row.rec?.reason || row.rec?.harvest || "")}</td>
    </tr>
  `).join("") + `
    <tr>
      <th>合计</th>
      ${itemNames.map((name) => `<th>${fmt(itemTotals[name])}</th>`).join("")}
      <th>${fmt(rows.reduce((sum, row) => sum + Number(row.rec?.raw_total || 0), 0))}</th>
      <th>${fmt(totalWeighted)}</th>
      <th>${fmt(totalQuota)}</th>
      <th>${teamPassed ? "完成" : "未完成"}</th>
      <th></th>
    </tr>
  `;
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
      const item = readBackups().find((backup) => backup.id === (btn as HTMLButtonElement).dataset.backup);
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

function render() {
  renderMembers();
  renderRules();
  renderMemberQuotas();
  renderEntryInputs(readEntryInputs());
  renderOverview();
  renderHistory();
  renderBackups();
  $<HTMLInputElement>("quotaInput").value = String(data.quota);
  preview();
}

function setView(view: string) {
  activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", (tab as HTMLElement).dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  renderOverview();
}

function showDialog(title: string, message: string, field: string) {
  pendingDialogField = field;
  $("dialogTitle").textContent = title;
  $("dialogMessage").textContent = message;
  $<HTMLTextAreaElement>("dialogText").value = "";
  $("dialogText").classList.toggle("hidden", !field);
  $("dialog").classList.add("show");
}

function closeDialog() {
  $("dialog").classList.remove("show");
}

async function chooseSharedFile() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.chooseCloudFolder(data);
    if (!result) return;
    if (result.error) throw new Error(result.error);
    createBackup("切换云端文件夹前备份");
    if (result.text?.trim()) data = normalize(JSON.parse(result.text));
    lastFileModified = result.mtime || 0;
    $("syncLabel").textContent = `软件同步：${result.path}`;
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    persistLocal();
    loadForm();
    render();
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
  let handle: FileSystemFileHandle;
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
  createBackup(createNew ? "新建云端文件前备份" : "切换云端文件前备份");
  if (text.trim()) data = normalize(JSON.parse(text));
  persistLocal();
  $("syncLabel").textContent = `共享文件：${file.name}`;
  if (!data.members.includes(currentMember)) currentMember = data.members[0];
  loadForm();
  render();
  if (!text.trim() || createNew) await persistEverywhere();
}

async function pollSharedFile() {
  if (desktopApp?.isDesktop) {
    const result = await desktopApp.pollCloudData();
    if (!result || result.unchanged) return;
    if (result.error) {
      $("syncLabel").textContent = `软件同步暂时不可读：${result.error}`;
      return;
    }
    createBackup("云端刷新前备份");
    data = normalize(JSON.parse(result.text || "{}"));
    lastFileModified = result.mtime || lastFileModified;
    $("syncLabel").textContent = `软件同步：${result.path}`;
    if (!data.members.includes(currentMember)) currentMember = data.members[0];
    loadForm();
    render();
    return;
  }
  if (!fileHandle) return;
  try {
    const file = await fileHandle.getFile();
    if (file.lastModified && file.lastModified !== lastFileModified) {
      lastFileModified = file.lastModified;
      createBackup("云端刷新前备份");
      data = normalize(JSON.parse(await file.text()));
      if (!data.members.includes(currentMember)) currentMember = data.members[0];
      loadForm();
      render();
    }
  } catch {
    $("syncLabel").textContent = "共享文件暂时不可读，继续使用本地副本";
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

function importData(file: File) {
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

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s] || s));
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function bindEvents() {
  $<HTMLInputElement>("dateInput").value = currentDate;
  $<HTMLInputElement>("dateInput").onchange = () => {
    saveFormSilently();
    currentDate = $<HTMLInputElement>("dateInput").value;
    loadForm();
    render();
  };
  $<HTMLInputElement>("quotaInput").oninput = () => {
    data.quota = Number($<HTMLInputElement>("quotaInput").value || 0);
    preview();
    renderOverview();
    scheduleSave("admin");
  };
  $<HTMLTextAreaElement>("entryText").oninput = preview;
  $<HTMLSelectElement>("statusSelect").onchange = saveFormSilently;
  $<HTMLTextAreaElement>("reasonText").onchange = saveFormSilently;
  $<HTMLTextAreaElement>("harvestText").onchange = saveFormSilently;
  $<HTMLTextAreaElement>("diaryText").onchange = saveFormSilently;
  $("saveBtn").onclick = saveAndAudit;
  $("addRuleBtn").onclick = () => {
    data.rules[nextRuleName()] = 1;
    renderRules();
    renderEntryInputs(readEntryInputs());
    scheduleSave("admin");
  };
  $("addMemberBtn").onclick = () => addMember($<HTMLInputElement>("memberName").value.trim());
  $("compactToggle").onchange = () => $("app").classList.toggle("compact", $<HTMLInputElement>("compactToggle").checked);
  $("openFileBtn").onclick = () => chooseSharedFile().catch((err) => alert(`打开失败：${err.message}`));
  $("exportBtn").onclick = exportData;
  $("backupBtn").onclick = () => setView("admin");
  $("importBtn").onclick = () => $<HTMLInputElement>("importFile").click();
  $<HTMLInputElement>("importFile").onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) importData(file);
  };
  $("dialogSkip").onclick = closeDialog;
  $("dialogSave").onclick = () => {
    const rec = currentRecord();
    if (pendingDialogField === "reason") {
      rec.reason = $<HTMLTextAreaElement>("dialogText").value.trim();
      $<HTMLTextAreaElement>("reasonText").value = rec.reason;
    }
    if (pendingDialogField === "harvest") {
      rec.harvest = $<HTMLTextAreaElement>("dialogText").value.trim();
      $<HTMLTextAreaElement>("harvestText").value = rec.harvest;
    }
    persistEverywhere();
    renderHistory();
    closeDialog();
  };
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView((tab as HTMLElement).dataset.view || "entry"));
  });
}

pruneBackups();
createBackup("每日自动备份");
bindEvents();
loadForm();
render();
setView(activeView);
restoreCloudDirectory();
window.setInterval(pollSharedFile, 1800);
