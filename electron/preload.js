// Electron Preload Script
// 在渲染进程中暴露安全的 API

const { contextBridge, ipcRenderer } = require('electron')

// 暴露给前端的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 执行 OpenClaw 命令
  exec: (command) => ipcRenderer.invoke('openclaw-exec', command),
  
  // 执行 Skill
  executeSkill: (skillName, params) => ipcRenderer.invoke('execute-skill', skillName, params),
  
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 打开本地应用
  openApp: (appName) => ipcRenderer.invoke('open-app', appName),
  
  // 获取系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // 平台检测
  isElectron: true,
  platform: process.platform
})

// 旧版兼容（直接挂载到 window）
window.electron = {
  exec: (command) => ipcRenderer.invoke('openclaw-exec', command),
  executeSkill: (skillName, params) => ipcRenderer.invoke('execute-skill', skillName, params),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openApp: (appName) => ipcRenderer.invoke('open-app', appName),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  isElectron: true,
  platform: process.platform
}
