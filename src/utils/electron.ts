// Electron API 类型定义
declare global {
  interface Window {
    electronAPI?: {
      exec: (command: string) => Promise<{ success: boolean; output?: string; error?: string }>
      executeSkill: (skillName: string, params?: string) => Promise<{ success: boolean; output?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      openExportedFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>
      openApp: (appName: string) => Promise<{ success: boolean; error?: string }>
      getDesktopCapabilities: () => Promise<DesktopCapabilities>
      captureScreenshot: () => Promise<DesktopScreenshotResult>
      readClipboardFiles?: () => Promise<DesktopClipboardFilesResult>
      writeClipboardText?: (value: string) => Promise<{ success: boolean; error?: string }>
      openNewChatWindow: (route?: string) => Promise<{ success: boolean; error?: string }>
      showDesktopNotification: (payload: DesktopNotificationPayload) => Promise<{ success: boolean; error?: string }>
      onDesktopAction: (callback: (event: DesktopActionEvent) => void) => () => void
      getUpdateState?: () => Promise<AppUpdateState>
      checkForUpdates?: () => Promise<AppUpdateState>
      downloadUpdate?: () => Promise<AppUpdateState>
      installUpdate?: () => Promise<{ success: boolean; state: AppUpdateState }>
      onUpdateState?: (callback: (state: AppUpdateState) => void) => () => void
      getSystemInfo: () => Promise<{ platform: string; arch: string; hostname: string; homedir: string; username: string }>
      isElectron: boolean
      platform: string
    }
    electron?: {
      exec: (command: string) => Promise<{ success: boolean; output?: string; error?: string }>
      executeSkill: (skillName: string, params?: string) => Promise<{ success: boolean; output?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      openExportedFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>
      openApp: (appName: string) => Promise<{ success: boolean; error?: string }>
      getDesktopCapabilities: () => Promise<DesktopCapabilities>
      captureScreenshot: () => Promise<DesktopScreenshotResult>
      readClipboardFiles?: () => Promise<DesktopClipboardFilesResult>
      writeClipboardText?: (value: string) => Promise<{ success: boolean; error?: string }>
      openNewChatWindow: (route?: string) => Promise<{ success: boolean; error?: string }>
      showDesktopNotification: (payload: DesktopNotificationPayload) => Promise<{ success: boolean; error?: string }>
      onDesktopAction: (callback: (event: DesktopActionEvent) => void) => () => void
      getUpdateState?: () => Promise<AppUpdateState>
      checkForUpdates?: () => Promise<AppUpdateState>
      downloadUpdate?: () => Promise<AppUpdateState>
      installUpdate?: () => Promise<{ success: boolean; state: AppUpdateState }>
      onUpdateState?: (callback: (state: AppUpdateState) => void) => () => void
      getSystemInfo: () => Promise<{ platform: string; arch: string; hostname: string; homedir: string; username: string }>
      isElectron: boolean
      platform: string
    }
  }
}

export interface DesktopCapabilities {
  isElectron: boolean
  shortcuts: Record<string, string>
  screenshotDir?: string
  canCaptureScreen?: boolean
  canOpenNewWindow?: boolean
}

export interface DesktopScreenshotResult {
  success: boolean
  url?: string
  filePath?: string
  width?: number
  height?: number
  capturedAt?: string
  error?: string
}

export interface DesktopClipboardFile {
  name: string
  path: string
  size?: number
  modifiedAt?: string
}

export interface DesktopClipboardFilesResult {
  success: boolean
  files?: DesktopClipboardFile[]
  error?: string
}

export interface DesktopActionEvent {
  action: string
  payload?: DesktopScreenshotResult | Record<string, unknown>
  timestamp?: string
}

export interface DesktopNotificationPayload {
  title: string
  body?: string
  content?: string
  route?: string
  silent?: boolean
}

export type AppUpdateStatus = 'unsupported' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateState {
  supported: boolean
  status: AppUpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseDate?: string
  progress: number
  message: string
  repositoryUrl: string
  checkedAt?: string
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

export const openExportedFile = async (filePath?: string, fallbackUrl?: string): Promise<void> => {
  const api = getElectronAPI()
  if (api?.openExportedFile && filePath) {
    await api.openExportedFile(filePath)
    return
  }
  if (fallbackUrl) {
    if (api?.openExternal && /^https?:\/\//i.test(fallbackUrl)) {
      await api.openExternal(fallbackUrl)
    } else {
      window.open(fallbackUrl, '_blank')
    }
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

export const getDesktopCapabilities = async (): Promise<DesktopCapabilities | null> => {
  const api = getElectronAPI()
  if (!api?.getDesktopCapabilities) return null
  return api.getDesktopCapabilities()
}

export const getUpdateState = async (): Promise<AppUpdateState | null> => {
  return getElectronAPI()?.getUpdateState?.() || null
}

export const checkForUpdates = async (): Promise<AppUpdateState | null> => {
  return getElectronAPI()?.checkForUpdates?.() || null
}

export const downloadUpdate = async (): Promise<AppUpdateState | null> => {
  return getElectronAPI()?.downloadUpdate?.() || null
}

export const installUpdate = async (): Promise<{ success: boolean; state: AppUpdateState } | null> => {
  return getElectronAPI()?.installUpdate?.() || null
}

export const captureScreenshot = async (): Promise<DesktopScreenshotResult> => {
  const api = getElectronAPI()
  if (!api?.captureScreenshot) {
    return { success: false, error: '不在 Electron 环境中，无法截图' }
  }
  return api.captureScreenshot()
}

export const readClipboardFiles = async (): Promise<DesktopClipboardFilesResult> => {
  const api = getElectronAPI()
  if (!api?.readClipboardFiles) {
    return { success: false, files: [], error: '当前环境不支持读取系统剪贴板文件' }
  }
  return api.readClipboardFiles()
}

export const openNewChatWindow = async (route = '/'): Promise<{ success: boolean; error?: string }> => {
  const api = getElectronAPI()
  if (!api?.openNewChatWindow) {
    window.open(route, '_blank')
    return { success: true }
  }
  return api.openNewChatWindow(route)
}

export const showDesktopNotification = async (payload: DesktopNotificationPayload): Promise<{ success: boolean; error?: string }> => {
  const api = getElectronAPI()
  if (!api?.showDesktopNotification) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission === 'granted') {
        new Notification(payload.title, { body: payload.body || payload.content || '' })
        return { success: true }
      }
    }
    return { success: false, error: '当前环境不支持桌面通知' }
  }
  return api.showDesktopNotification(payload)
}

export const onDesktopAction = (callback: (event: DesktopActionEvent) => void): (() => void) => {
  const api = getElectronAPI()
  if (!api?.onDesktopAction) return () => {}
  return api.onDesktopAction(callback)
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
