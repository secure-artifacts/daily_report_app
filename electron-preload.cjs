const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isDesktop: true,
  getCloudData: () => ipcRenderer.invoke("cloud:get"),
  chooseCloudFolder: (initialData) => ipcRenderer.invoke("cloud:choose-folder", initialData),
  writeCloudData: (data) => ipcRenderer.invoke("cloud:write", data),
  pollCloudData: () => ipcRenderer.invoke("cloud:poll"),
  writeCsvBackup: (files) => ipcRenderer.invoke("cloud:write-csv", files)
});
