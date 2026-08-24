const { app, BrowserWindow, ipcMain, shell, session, globalShortcut, desktopCapturer, screen, Notification, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const { fork, execFile } = require('child_process')
const os = require('os')
const http = require('http')
const { autoUpdater } = require('electron-updater')

// 设置应用名称（否则 macOS 菜单栏和 Dock 显示 "Electron"）
app.setName('灵枢')

// 保持窗口对象的全局引用，防止被垃圾回收
let mainWindow = null
let backendProcess = null
const appWindows = new Set()
const UPDATE_REPOSITORY_URL = 'https://github.com/scene1/Lingshu/releases'
let updateState = {
  supported: false,
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: '',
  releaseDate: '',
  progress: 0,
  message: '尚未检查更新',
  repositoryUrl: UPDATE_REPOSITORY_URL,
  checkedAt: ''
}

// 后端端口
const BACKEND_PORT = Number(process.env.LINGSHU_BACKEND_PORT || process.env.OPENCLAW_BACKEND_PORT || 3005)
const FRONTEND_DEV_URL = process.env.LINGSHU_FRONTEND_URL || process.env.OPENCLAW_FRONTEND_URL || 'http://127.0.0.1:3000'
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const BACKEND_READY_TIMEOUT_MS = Number(process.env.LINGSHU_BACKEND_READY_TIMEOUT_MS || 15000)
const LINGSHU_WORKSPACE_DIR = path.join(os.homedir(), 'Lingshu', 'workspace')
const SCREENSHOT_DIR = process.env.LINGSHU_SCREENSHOT_DIR || path.join(LINGSHU_WORKSPACE_DIR, 'uploads', 'screenshots')
const EXPORT_DIR_CANDIDATES = [
  process.env.LINGSHU_DATA_DIR ? path.join(process.env.LINGSHU_DATA_DIR, 'exports') : '',
  process.env.OPENCLAW_DATA_DIR ? path.join(process.env.OPENCLAW_DATA_DIR, 'exports') : '',
  path.join(LINGSHU_WORKSPACE_DIR, 'openclaw-web-ui-data', 'exports'),
  path.join(LINGSHU_WORKSPACE_DIR, 'lingshu-app-data', 'exports')
].filter(Boolean).map(item => path.resolve(item))
const DESKTOP_SHORTCUTS = {
  focus: 'CommandOrControl+Shift+L',
  screenshotAsk: 'CommandOrControl+Shift+S',
  newChatWindow: 'CommandOrControl+Shift+N'
}

function openApplicationCandidate(candidate) {
  if (process.platform === 'darwin') {
    return execFile('open', ['-a', candidate])
  }
  if (process.platform === 'win32') {
    return execFile('cmd', ['/c', 'start', '', candidate], { windowsHide: true })
  }
  return execFile('xdg-open', [candidate])
}

function isInternalLingshuUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) && ['3000', String(BACKEND_PORT)].includes(parsed.port)
  } catch (_) {
    return false
  }
}

function isTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  return isInternalLingshuUrl(senderUrl)
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) {
    throw new Error('Untrusted renderer origin')
  }
}

function publicUpdateState() {
  return { ...updateState }
}

function broadcastUpdateState() {
  for (const win of appWindows) {
    if (!win.isDestroyed()) win.webContents.send('app-update-state', publicUpdateState())
  }
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  broadcastUpdateState()
  return publicUpdateState()
}

function updaterErrorMessage(error) {
  const raw = String(error?.message || error || '')
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED/i.test(raw)) {
    return '无法连接更新服务，请检查网络后重试'
  }
  if (/404|latest(-mac)?\.yml/i.test(raw)) {
    return '当前发布版本缺少更新元数据，请从 GitHub Releases 手动下载'
  }
  if (/signature|code sign|not signed/i.test(raw)) {
    return '更新包签名验证失败，已停止安装'
  }
  return '检查更新失败，请稍后重试'
}

function configureAutoUpdater() {
  const supported = app.isPackaged && ['darwin', 'win32'].includes(process.platform)
  setUpdateState({
    supported,
    currentVersion: app.getVersion(),
    status: supported ? 'idle' : 'unsupported',
    message: supported ? '可检查 GitHub Release 更新' : '当前环境不支持应用内更新'
  })
  if (!supported) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', progress: 0, message: '正在检查更新...' })
  })
  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      availableVersion: String(info?.version || ''),
      releaseDate: String(info?.releaseDate || ''),
      checkedAt: new Date().toISOString(),
      message: `发现新版本 v${info?.version || ''}`
    })
  })
  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'not-available',
      availableVersion: '',
      checkedAt: new Date().toISOString(),
      message: `当前已是最新版本 v${app.getVersion()}`
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)))
    setUpdateState({ status: 'downloading', progress: percent, message: `正在下载更新 ${Math.round(percent)}%` })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      availableVersion: String(info?.version || updateState.availableVersion || ''),
      progress: 100,
      message: '更新已下载，重启后安装'
    })
  })
  autoUpdater.on('error', (error) => {
    console.error('自动更新失败:', error)
    setUpdateState({ status: 'error', message: updaterErrorMessage(error) })
  })
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function isAllowedExportPath(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  return EXPORT_DIR_CANDIDATES.some(dir => isPathInside(dir, resolved))
}

function waitForBackendReady(timeoutMs = BACKEND_READY_TIMEOUT_MS) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`${BACKEND_URL}/api/health`, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false)
          return
        }
        setTimeout(check, 300)
      })
      req.setTimeout(1200, () => {
        req.destroy()
      })
    }
    check()
  })
}

function buildBackendErrorHtml() {
  return encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>灵枢启动失败</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #1f2937; }
    .wrap { max-width: 760px; margin: 96px auto; padding: 32px; background: #fff; border-radius: 18px; box-shadow: 0 16px 50px rgba(15, 23, 42, .10); }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { line-height: 1.7; color: #4b5563; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
    pre { white-space: pre-wrap; background: #0f172a; color: #e5e7eb; padding: 16px; border-radius: 12px; overflow: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>灵枢后端没有启动成功</h1>
    <p>窗口已经打开，但内置服务 <code>${BACKEND_URL}</code> 在 ${Math.round(BACKEND_READY_TIMEOUT_MS / 1000)} 秒内没有响应，所以页面没有继续加载。</p>
    <p>建议先完全退出灵枢，再从终端运行下面命令查看日志：</p>
    <pre>/Applications/灵枢.app/Contents/MacOS/灵枢</pre>
  </div>
</body>
</html>`)
}

function buildAppUrl(route = '/', backendReady = true) {
  if (!backendReady) return `data:text/html;charset=utf-8,${buildBackendErrorHtml()}`
  const isDev = process.env.NODE_ENV === 'development'
  const baseUrl = isDev ? FRONTEND_DEV_URL : BACKEND_URL
  return new URL(route || '/', baseUrl).toString()
}

function showAndFocusWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function focusMainWindow(route) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ route })
    return
  }
  if (route) {
    mainWindow.loadURL(buildAppUrl(route))
  }
  showAndFocusWindow(mainWindow)
}

function createChatWindow(route = '/') {
  return createWindow({ route, asMain: false })
}

function sendDesktopAction(action, payload = {}) {
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : [...appWindows].find(win => !win.isDestroyed())
  if (!target) return false
  showAndFocusWindow(target)
  target.webContents.send('desktop-action', { action, payload, timestamp: new Date().toISOString() })
  return true
}

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

async function capturePrimaryScreen() {
  ensureScreenshotDir()
  const primary = screen.getPrimaryDisplay()
  const scaleFactor = primary.scaleFactor || 1
  const thumbnailSize = {
    width: Math.round(primary.size.width * scaleFactor),
    height: Math.round(primary.size.height * scaleFactor)
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  })
  const source = sources.find(item => String(item.display_id) === String(primary.id)) || sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    return { success: false, error: '截图失败：未获得屏幕内容，可能需要在系统设置中授予灵枢“屏幕录制”权限。' }
  }
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  const filePath = path.join(SCREENSHOT_DIR, filename)
  fs.writeFileSync(filePath, source.thumbnail.toPNG())
  return {
    success: true,
    filePath,
    url: `/uploads/screenshots/${filename}`,
    width: source.thumbnail.getSize().width,
    height: source.thumbnail.getSize().height,
    capturedAt: new Date().toISOString()
  }
}

function parseClipboardPathText(value = '') {
  return String(value || '')
    .split(/\r?\n|\0/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      if (item.startsWith('file://')) {
        try {
          return decodeURIComponent(new URL(item).pathname)
        } catch (_) {
          return ''
        }
      }
      return item
    })
    .filter(Boolean)
}

function readClipboardFormatAsPaths(format) {
  const paths = []
  try {
    if (format === 'FileNameW') {
      const raw = clipboard.readBuffer(format)
      if (raw?.length) paths.push(...parseClipboardPathText(raw.toString('utf16le')))
      return paths
    }
    if (format === 'FileName') {
      const raw = clipboard.readBuffer(format)
      if (raw?.length) paths.push(...parseClipboardPathText(raw.toString('utf8')))
      return paths
    }
    const text = clipboard.read(format)
    if (text) paths.push(...parseClipboardPathText(text))
  } catch (_) {}
  return paths
}

function readClipboardFiles() {
  const formats = clipboard.availableFormats()
  const candidatePaths = []
  for (const format of ['public.file-url', 'NSFilenamesPboardType', 'FileNameW', 'FileName', 'text/uri-list']) {
    if (!formats.includes(format)) continue
    candidatePaths.push(...readClipboardFormatAsPaths(format))
  }

  // Some file managers expose copied file URLs as plain text.
  candidatePaths.push(...parseClipboardPathText(clipboard.readText()))

  const unique = [...new Set(candidatePaths)]
  return unique.slice(0, 20).map(filePath => {
    try {
      const resolvedPath = fs.realpathSync(filePath)
      const stat = fs.statSync(resolvedPath)
      if (!stat.isFile()) return null
      return {
        name: path.basename(resolvedPath),
        path: resolvedPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      }
    } catch (_) {
      return null
    }
  }).filter(Boolean)
}

// 创建主窗口
function createWindow({ backendReady = true, route = '/', asMain = true } = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    },
    title: '灵枢',
    titleBarStyle: 'hiddenInset', // Mac 风格标题栏
    autoHideMenuBar: true,
    backgroundColor: '#f6f7fb',
    show: false // 先隐藏，等加载完成再显示
  })

  appWindows.add(win)
  if (asMain || !mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win
  }

  // 加载本地前端或远程前端
  const isDev = process.env.NODE_ENV === 'development'
  
  if (isDev) {
    win.loadURL(buildAppUrl(route, true))
    if (process.env.LINGSHU_DEVTOOLS === '1' || process.env.OPENCLAW_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
  } else {
    // 生产环境：后端服务内嵌在 Electron 主进程中通过 fork 启动
    // server.cjs 会 serve 前端 dist 静态文件，直接加载后端 URL
    if (backendReady) {
      win.loadURL(buildAppUrl(route, true))
    } else {
      win.loadURL(buildAppUrl(route, false))
    }
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalLingshuUrl(url)) {
      createChatWindow(new URL(url).pathname + new URL(url).search)
    } else {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalLingshuUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('页面加载失败:', errorCode, errorDescription, validatedURL)
    if (!isDev) {
      win.loadURL(buildAppUrl(route, false))
    }
  })

  // 捕获 renderer 进程的 console 输出
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levels = ['debug', 'log', 'warn', 'error']
    const label = levels[level] || 'log'
    console.log(`[Renderer ${label}] ${message} (${sourceId}:${line})`)
  })

  // 加载完成后再显示窗口
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  // 窗口关闭时处理
  win.on('closed', () => {
    appWindows.delete(win)
    if (mainWindow === win) {
      mainWindow = [...appWindows].find(item => !item.isDestroyed()) || null
    }
  })

  return win
}

// 启动后端服务（使用 fork，不需要系统 PATH 上的 node）
function startBackend() {
  // 打包后用 esbuild 预打包的 server-bundle.cjs（CommonJS，依赖已内联）
  // 开发模式用原始 server-v2.js（ESM）
  const serverFile = app.isPackaged ? 'server-bundle.cjs' : 'server-v2.js'
  // asar 打包后 __dirname 在 app.asar 内，fork 需要磁盘上的真实路径
  // asarUnpack 会将 server-bundle.cjs 解包到 app.asar.unpacked 目录
  let appDir = path.join(__dirname, '..')
  if (appDir.includes('app.asar')) {
    appDir = appDir.replace('app.asar', 'app.asar.unpacked')
  }
  const serverPath = path.join(appDir, serverFile)

  console.log('启动后端服务（fork）...', serverPath)

  // fork() 使用 Electron 二进制作为 execPath，必须设置 ELECTRON_RUN_AS_NODE=1
  // 否则 fork 出的进程会尝试启动另一个 Electron 窗口而不是运行 Node.js 脚本
  const cleanEnv = { ...process.env }
  cleanEnv.ELECTRON_RUN_AS_NODE = '1'
  delete cleanEnv.NODE_OPTIONS          // WorkBuddy 注入的 --use-system-ca 等会干扰
  cleanEnv.PORT = BACKEND_PORT.toString()
  cleanEnv.LINGSHU_APP_VERSION = app.getVersion()
  cleanEnv.LINGSHU_PRODUCT_NAME = app.getName()
  // 清除代理（系统代理会干扰外部 API 调用）
  delete cleanEnv.HTTP_PROXY
  delete cleanEnv.HTTPS_PROXY
  delete cleanEnv.http_proxy
  delete cleanEnv.https_proxy

  backendProcess = fork(serverPath, [], {
    cwd: appDir,
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  })

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[后端] ${data.toString().trim()}`)
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[后端错误] ${data.toString().trim()}`)
  })

  backendProcess.on('error', (err) => {
    console.error('后端进程启动失败:', err)
  })

  backendProcess.on('exit', (code, signal) => {
    console.log(`后端进程退出: code=${code}, signal=${signal}`)
    backendProcess = null
  })
}

// 停止后端服务
function stopBackend() {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
}

// IPC 处理 - 执行 Skill
ipcMain.handle('execute-skill', async (event, skillName, params = '') => {
  assertTrustedSender(event)
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      OPENCLAW_STATE_DIR: path.join(os.homedir(), 'Lingshu'),
      PATH: `${path.join(os.homedir(), 'Lingshu', 'bin')}:${process.env.PATH}`
    }
    execFile('openclaw', ['skills', 'run', String(skillName), String(params || '')], { env }, (error, stdout, stderr) => {
      if (error) {
        console.error('Skill 执行失败:', error)
        reject({ success: false, error: error.message, stderr })
      } else {
        resolve({ success: true, output: stdout })
      }
    })
  })
})

// IPC 处理 - 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  assertTrustedSender(event)
  if (mainWindow && isInternalLingshuUrl(url)) {
    mainWindow.loadURL(url)
    return
  }
  const parsed = new URL(url)
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error('Unsupported external URL protocol')
  }
  shell.openExternal(url)
})

ipcMain.handle('desktop:open-exported-file', async (event, filePath) => {
  assertTrustedSender(event)
  const targetPath = path.resolve(String(filePath || ''))
  if (!isAllowedExportPath(targetPath)) {
    throw new Error('只能打开灵枢导出目录中的文件')
  }
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error('导出文件不存在')
  }
  const error = await shell.openPath(targetPath)
  if (error) throw new Error(error)
  return { success: true }
})

ipcMain.handle('desktop:get-capabilities', async (event) => {
  assertTrustedSender(event)
  return {
    isElectron: true,
    shortcuts: DESKTOP_SHORTCUTS,
    screenshotDir: SCREENSHOT_DIR,
    canCaptureScreen: true,
    canOpenNewWindow: true
  }
})

ipcMain.handle('desktop:capture-screenshot', async (event) => {
  assertTrustedSender(event)
  return capturePrimaryScreen()
})

ipcMain.handle('desktop:read-clipboard-files', async (event) => {
  assertTrustedSender(event)
  return { success: true, files: readClipboardFiles() }
})

ipcMain.handle('desktop:write-clipboard-text', async (event, value = '') => {
  assertTrustedSender(event)
  const text = String(value || '')
  if (!text) return { success: false, error: '复制内容为空' }
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) {
    return { success: false, error: '复制内容超过 2MB 限制' }
  }
  clipboard.writeText(text)
  return { success: clipboard.readText() === text }
})

ipcMain.handle('desktop:new-chat-window', async (event, route = '/') => {
  assertTrustedSender(event)
  createChatWindow(route || '/')
  return { success: true }
})

ipcMain.handle('desktop:show-notification', async (event, payload = {}) => {
  assertTrustedSender(event)
  if (!Notification.isSupported()) {
    return { success: false, error: '当前系统不支持桌面通知' }
  }
  const title = String(payload.title || '灵枢通知').slice(0, 120)
  const body = String(payload.body || payload.content || '').slice(0, 500)
  const route = typeof payload.route === 'string' ? payload.route : ''
  const notification = new Notification({
    title,
    body,
    silent: payload.silent === true,
  })
  notification.on('click', () => {
    focusMainWindow(route || '/notifications')
  })
  notification.show()
  return { success: true }
})

// IPC 处理 - 打开本地应用
ipcMain.handle('open-app', async (event, appName) => {
  assertTrustedSender(event)
  const appNames = {
    feishu: process.platform === 'win32' ? ['Lark'] : ['Lark', '飞书'],
    wechat: process.platform === 'win32' ? ['WeChat'] : ['WeChat', '微信'],
    chrome: process.platform === 'win32' ? ['chrome', 'Google Chrome'] : ['Google Chrome'],
    safari: ['Safari'],
    terminal: process.platform === 'win32' ? ['cmd'] : ['Terminal'],
    finder: process.platform === 'win32' ? ['explorer'] : ['Finder'],
    vscode: process.platform === 'win32' ? ['Code', 'Visual Studio Code'] : ['Visual Studio Code']
  }
  const candidates = appNames[appName]
  if (!candidates) return { success: false, error: '不支持的应用' }

  return new Promise((resolve, reject) => {
    const tryOpen = (index = 0) => {
      if (index >= candidates.length) {
        reject({ success: false, error: '应用不存在或无法打开' })
        return
      }
      const child = openApplicationCandidate(candidates[index])
      child.on('error', () => tryOpen(index + 1))
      child.on('exit', (code) => {
        const failed = typeof code === 'number' && code !== 0
        if (failed) tryOpen(index + 1)
        else resolve({ success: true })
      })
    }
    tryOpen()
  })
})

// IPC 处理 - 获取系统信息
ipcMain.handle('get-system-info', async (event) => {
  assertTrustedSender(event)
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    username: os.userInfo().username
  }
})

ipcMain.handle('app-update:get-state', async (event) => {
  assertTrustedSender(event)
  return publicUpdateState()
})

ipcMain.handle('app-update:check', async (event) => {
  assertTrustedSender(event)
  if (!updateState.supported) return publicUpdateState()
  if (['checking', 'downloading'].includes(updateState.status)) return publicUpdateState()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.error('检查更新失败:', error)
    setUpdateState({ status: 'error', message: updaterErrorMessage(error) })
  }
  return publicUpdateState()
})

ipcMain.handle('app-update:download', async (event) => {
  assertTrustedSender(event)
  if (updateState.status !== 'available') return publicUpdateState()
  try {
    setUpdateState({ status: 'downloading', progress: 0, message: '正在准备下载更新...' })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    console.error('下载更新失败:', error)
    setUpdateState({ status: 'error', message: updaterErrorMessage(error) })
  }
  return publicUpdateState()
})

ipcMain.handle('app-update:install', async (event) => {
  assertTrustedSender(event)
  if (updateState.status !== 'downloaded') return { success: false, state: publicUpdateState() }
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return { success: true, state: publicUpdateState() }
})

function registerDesktopShortcuts() {
  globalShortcut.unregisterAll()

  globalShortcut.register(DESKTOP_SHORTCUTS.focus, () => {
    focusMainWindow('/')
  })

  globalShortcut.register(DESKTOP_SHORTCUTS.screenshotAsk, async () => {
    focusMainWindow('/')
    try {
      const result = await capturePrimaryScreen()
      sendDesktopAction('screenshot-captured', result)
    } catch (error) {
      sendDesktopAction('screenshot-captured', {
        success: false,
        error: error.message || '截图失败'
      })
    }
  })

  globalShortcut.register(DESKTOP_SHORTCUTS.newChatWindow, () => {
    createChatWindow('/')
  })
}

// 应用就绪
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ownerUrl = webContents.getURL()
    const allowed = isInternalLingshuUrl(ownerUrl) && ['media', 'microphone', 'notifications'].includes(permission)
    callback(allowed)
  })

  // 启动后端
  startBackend()

  const backendReady = await waitForBackendReady()
  if (!backendReady) {
    console.error(`后端服务启动超时：${BACKEND_URL}`)
  }
  createWindow({ backendReady })
  registerDesktopShortcuts()
  configureAutoUpdater()

  if (updateState.supported) {
    setTimeout(() => {
      if (updateState.status === 'idle') {
        autoUpdater.checkForUpdates().catch((error) => {
          console.error('启动更新检查失败:', error)
          setUpdateState({ status: 'error', message: updaterErrorMessage(error) })
        })
      }
    }, 10000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 应用退出前清理
app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  stopBackend()
})

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 防止多开
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
