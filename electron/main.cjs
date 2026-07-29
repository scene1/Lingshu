const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { exec, fork } = require('child_process')
const os = require('os')

// 保持窗口对象的全局引用，防止被垃圾回收
let mainWindow = null
let backendProcess = null

// 后端端口
const BACKEND_PORT = Number(process.env.OPENCLAW_BACKEND_PORT || 3105)
const FRONTEND_DEV_URL = process.env.OPENCLAW_FRONTEND_URL || 'http://127.0.0.1:3000'
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`

function isInternalOpenClawUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) && ['3000', String(BACKEND_PORT)].includes(parsed.port)
  } catch (_) {
    return false
  }
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false // 允许跨域
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
    if (process.env.OPENCLAW_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    // 生产环境：后端服务内嵌在 Electron 主进程中通过 fork 启动
    // server.cjs 会 serve 前端 dist 静态文件，直接加载后端 URL
    mainWindow.loadURL(BACKEND_URL)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalOpenClawUrl(url)) {
      mainWindow.loadURL(url)
    } else {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalOpenClawUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
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

// IPC 处理 - 执行 OpenClaw 命令
ipcMain.handle('openclaw-exec', async (event, command) => {
  return new Promise((resolve, reject) => {
    exec(command, { env: { ...process.env, PATH: `${os.homedir()}/.stepclaw/bin:${process.env.PATH}` } }, (error, stdout, stderr) => {
      if (error) {
        reject({ success: false, error: error.message, stderr })
      } else {
        resolve({ success: true, output: stdout })
      }
    })
  })
})

// IPC 处理 - 执行 Skill
ipcMain.handle('execute-skill', async (event, skillName, params = '') => {
  return new Promise((resolve, reject) => {
    const command = `export OPENCLAW_STATE_DIR=${os.homedir()}/.stepclaw && export PATH=${os.homedir()}/.stepclaw/bin:$PATH && openclaw skills run ${skillName} "${params}"`
    
    exec(command, (error, stdout, stderr) => {
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
  if (mainWindow && isInternalOpenClawUrl(url)) {
    mainWindow.loadURL(url)
    return
  }
  shell.openExternal(url)
})

// IPC 处理 - 打开本地应用
ipcMain.handle('open-app', async (event, appName) => {
  const commands = {
    'feishu': 'open -a "Lark" || open -a "飞书"',
    'wechat': 'open -a "WeChat" || open -a "微信"',
    'chrome': 'open -a "Google Chrome"',
    'safari': 'open -a "Safari"',
    'terminal': 'open -a "Terminal"',
    'finder': 'open -a "Finder"',
    'vscode': 'open -a "Visual Studio Code"'
  }
  
  const command = commands[appName] || `open -a "${appName}"`
  
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        reject({ success: false, error: error.message })
      } else {
        resolve({ success: true })
      }
    })
  })
})

// IPC 处理 - 获取系统信息
ipcMain.handle('get-system-info', async () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    username: os.userInfo().username
  }
})

// 应用就绪
app.whenReady().then(() => {
  // 启动后端
  startBackend()
  
  // 等待后端启动完成
  setTimeout(() => {
    createWindow()
  }, 2000)

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
