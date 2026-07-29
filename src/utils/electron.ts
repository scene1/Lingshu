// Electron API 类型定义
declare global {
  interface Window {
    electronAPI?: {
      exec: (command: string) => Promise<{ success: boolean; output?: string; error?: string }>
      executeSkill: (skillName: string, params?: string) => Promise<{ success: boolean; output?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      openApp: (appName: string) => Promise<{ success: boolean; error?: string }>
      getSystemInfo: () => Promise<{ platform: string; arch: string; hostname: string; homedir: string; username: string }>
      isElectron: boolean
      platform: string
    }
    electron?: {
      exec: (command: string) => Promise<{ success: boolean; output?: string; error?: string }>
      executeSkill: (skillName: string, params?: string) => Promise<{ success: boolean; output?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      openApp: (appName: string) => Promise<{ success: boolean; error?: string }>
      getSystemInfo: () => Promise<{ platform: string; arch: string; hostname: string; homedir: string; username: string }>
      isElectron: boolean
      platform: string
    }
  }
}

// 检测是否在 Electron 环境中
export const isElectron = (): boolean => {
  return !!(window.electronAPI?.isElectron || window.electron?.isElectron)
}

// 获取 Electron API
export const getElectronAPI = () => {
  return window.electronAPI || window.electron
}

// 执行 OpenClaw 命令
export const execOpenClaw = async (command: string): Promise<{ success: boolean; output?: string; error?: string }> => {
  const api = getElectronAPI()
  if (!api) {
    return { success: false, error: '不在 Electron 环境中' }
  }
  return api.exec(command)
}

// 执行 Skill
export const executeSkill = async (skillName: string, params?: string): Promise<{ success: boolean; output?: string; error?: string }> => {
  const api = getElectronAPI()
  if (!api) {
    return { success: false, error: '不在 Electron 环境中，无法执行本地 Skill' }
  }
  return api.executeSkill(skillName, params)
}

// 打开外部链接
export const openExternal = async (url: string): Promise<void> => {
  const api = getElectronAPI()
  if (api) {
    await api.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

// 打开本地应用
export const openApp = async (appName: string): Promise<{ success: boolean; error?: string }> => {
  const api = getElectronAPI()
  if (!api) {
    return { success: false, error: '不在 Electron 环境中，无法打开本地应用' }
  }
  return api.openApp(appName)
}

// 获取系统信息
export const getSystemInfo = async (): Promise<{ platform: string; arch: string; hostname: string; homedir: string; username: string } | null> => {
  const api = getElectronAPI()
  if (!api) {
    return null
  }
  return api.getSystemInfo()
}

// 常用 Skills 快捷调用
export const skills = {
  // 打开飞书
  openFeishu: () => executeSkill('feishu', 'open'),
  
  // 查询天气
  getWeather: (city?: string) => executeSkill('weather', city || ''),
  
  // 打开 Chrome
  openChrome: () => openApp('chrome'),
  
  // 打开微信
  openWechat: () => openApp('wechat'),
  
  // 打开 VS Code
  openVSCode: () => openApp('vscode'),
  
  // 执行代码
  runCode: (code: string) => executeSkill('code', code)
}
