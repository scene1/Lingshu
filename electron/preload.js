// Electron Preload Script
// 在渲染进程中暴露安全的 API

const { contextBridge, ipcRenderer } = require('electron')

// 暴露给前端的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 旧接口保留返回形态，但不再允许渲染进程传入任意 shell 命令
  exec: async () => ({ success: false, error: '任意命令执行已禁用，请使用后端 API 或受限 IPC' }),
  
  // 执行 Skill
  executeSkill: (skillName, params) => ipcRenderer.invoke('execute-skill', skillName, params),
  
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExportedFile: (filePath) => ipcRenderer.invoke('desktop:open-exported-file', filePath),
  
  // 打开本地应用
  openApp: (appName) => ipcRenderer.invoke('open-app', appName),

  // 桌面增强能力
  getDesktopCapabilities: () => ipcRenderer.invoke('desktop:get-capabilities'),
  captureScreenshot: () => ipcRenderer.invoke('desktop:capture-screenshot'),
  readClipboardFiles: () => ipcRenderer.invoke('desktop:read-clipboard-files'),
  writeClipboardText: (value) => ipcRenderer.invoke('desktop:write-clipboard-text', value),
  openNewChatWindow: (route) => ipcRenderer.invoke('desktop:new-chat-window', route),
  showDesktopNotification: (payload) => ipcRenderer.invoke('desktop:show-notification', payload),
  onDesktopAction: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('desktop-action', listener)
    return () => ipcRenderer.removeListener('desktop-action', listener)
  },
  
  // 获取系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // 平台检测
  isElectron: true,
  platform: process.platform
})
