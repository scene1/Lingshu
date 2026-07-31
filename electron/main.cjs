const { app, BrowserWindow, ipcMain, shell, session } = require('electron')
const path = require('path')
const { fork, execFile } = require('child_process')
const os = require('os')
const http = require('http')

// 保持窗口对象的全局引用，防止被垃圾回收
let mainWindow = null
let backendProcess = null

// 后端端口
const BACKEND_PORT = Number(process.env.LINGSHU_BACKEND_PORT || process.env.OPENCLAW_BACKEND_PORT || 3105)
const FRONTEND_DEV_URL = process.env.LINGSHU_FRONTEND_URL || process.env.OPENCLAW_FRONTEND_URL || 'http://127.0.0.1:3000'
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const BACKEND_READY_TIMEOUT_MS = Number(process.env.LINGSHU_BACKEND_READY_TIMEOUT_MS || 15000)

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

// 创建主窗口
function createWindow({ backendReady = true } = {}) {
  mainWindow = new BrowserWindow({
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

  // 加载本地前端或远程前端
  const isDev = process.env.NODE_ENV === 'development'
  
  if (isDev) {
    mainWindow.loadURL(FRONTEND_DEV_URL)
    if (process.env.LINGSHU_DEVTOOLS === '1' || process.env.OPENCLAW_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    // 生产环境：后端服务内嵌在 Electron 主进程中通过 fork 启动
    // server.cjs 会 serve 前端 dist 静态文件，直接加载后端 URL
    if (backendReady) {
      mainWindow.loadURL(BACKEND_URL)
    } else {
      mainWindow.loadURL(`data:text/html;charset=utf-8,${buildBackendErrorHtml()}`)
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalLingshuUrl(url)) {
      mainWindow.loadURL(url)
    } else {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalLingshuUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('页面加载失败:', errorCode, errorDescription, validatedURL)
    if (!isDev) {
      mainWindow.loadURL(`data:text/html;charset=utf-8,${buildBackendErrorHtml()}`)
    }
  })

  // 加载完成后再显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // 窗口关闭时处理
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 启动后端服务（使用 fork，不需要系统 PATH 上的 node）
function startBackend() {
  const serverPath = path.join(__dirname, '..', 'server-v2.js')
  
  console.log('启动后端服务（fork）...', serverPath)
  
  backendProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: BACKEND_PORT.toString() },
    stdio: 'pipe'
  })

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[后端] ${data.toString().trim()}`)
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[后端错误] ${data.toString().trim()}`)
  })

  backendProcess.on('message', (msg) => {
    console.log('[后端消息]', msg)
  })

  backendProcess.on('close', (code) => {
    console.log(`后端进程退出，代码: ${code}`)
  })

  backendProcess.on('error', (err) => {
    console.error('后端进程启动失败:', err)
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
      OPENCLAW_STATE_DIR: path.join(os.homedir(), '.stepclaw'),
      PATH: `${path.join(os.homedir(), '.stepclaw', 'bin')}:${process.env.PATH}`
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

// IPC 处理 - 打开本地应用
ipcMain.handle('open-app', async (event, appName) => {
  assertTrustedSender(event)
  const appNames = {
    feishu: ['Lark', '飞书'],
    wechat: ['WeChat', '微信'],
    chrome: ['Google Chrome'],
    safari: ['Safari'],
    terminal: ['Terminal'],
    finder: ['Finder'],
    vscode: ['Visual Studio Code']
  }
  const candidates = appNames[appName]
  if (!candidates) return { success: false, error: '不支持的应用' }

  return new Promise((resolve, reject) => {
    const tryOpen = (index = 0) => {
      if (index >= candidates.length) {
        reject({ success: false, error: '应用不存在或无法打开' })
        return
      }
      execFile('open', ['-a', candidates[index]], (error) => {
        if (error) tryOpen(index + 1)
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

// 应用就绪
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ownerUrl = webContents.getURL()
    const allowed = isInternalLingshuUrl(ownerUrl) && ['media', 'microphone'].includes(permission)
    callback(allowed)
  })

  // 启动后端
  startBackend()

  const backendReady = await waitForBackendReady()
  if (!backendReady) {
    console.error(`后端服务启动超时：${BACKEND_URL}`)
  }
  createWindow({ backendReady })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 应用退出前清理
app.on('before-quit', () => {
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
