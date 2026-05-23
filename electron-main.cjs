const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const APP_DIR = __dirname;
const SETTINGS_FILE = path.join(APP_DIR, "desktop_settings.json");
const DATA_FILE_NAME = "report_data.json";

let mainWindow;
let cloudDir = "";
let lastMtime = 0;

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function dataPath() {
  return cloudDir ? path.join(cloudDir, DATA_FILE_NAME) : "";
}

function ensureDataFile(initialData) {
  const target = dataPath();
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, JSON.stringify(initialData || {}, null, 2), "utf8");
  }
  lastMtime = fs.statSync(target).mtimeMs;
}

function readCloudData() {
  const target = dataPath();
  if (!target || !fs.existsSync(target)) return null;
  lastMtime = fs.statSync(target).mtimeMs;
  return {
    path: target,
    folder: cloudDir,
    mtime: lastMtime,
    text: fs.readFileSync(target, "utf8")
  };
}

function createWindow() {
  const settings = readSettings();
  cloudDir = settings.cloudDir || "";

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: "小组报数日记",
    backgroundColor: "#f5f4ef",
    webPreferences: {
      preload: path.join(APP_DIR, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(APP_DIR, "index.html"));
}

ipcMain.handle("cloud:get", () => {
  if (!cloudDir) return null;
  try {
    ensureDataFile();
    return readCloudData();
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle("cloud:choose-folder", async (_event, initialData) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Google Drive 本地同步文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  cloudDir = result.filePaths[0];
  writeSettings({ ...readSettings(), cloudDir });
  ensureDataFile(initialData);
  return readCloudData();
});

ipcMain.handle("cloud:write", (_event, data) => {
  if (!cloudDir) return null;
  ensureDataFile(data);
  const target = dataPath();
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, target);
  return readCloudData();
});

ipcMain.handle("cloud:write-csv", (_event, files) => {
  if (!cloudDir) return null;
  const backupDir = path.join(cloudDir, "sheet_backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const written = [];
  for (const file of files || []) {
    const safeName = String(file.name || "report.csv").replace(/[\\/:*?"<>|]/g, "_");
    const target = path.join(backupDir, safeName);
    fs.writeFileSync(target, String(file.text || ""), "utf8");
    written.push(target);
  }
  return { folder: backupDir, files: written };
});

ipcMain.handle("cloud:poll", () => {
  const target = dataPath();
  if (!target || !fs.existsSync(target)) return null;
  const mtime = fs.statSync(target).mtimeMs;
  if (mtime && mtime !== lastMtime) return readCloudData();
  return { path: target, folder: cloudDir, mtime: lastMtime, unchanged: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
