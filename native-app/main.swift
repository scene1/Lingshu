import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var backendTask: Process?
    var frontendTask: Process?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 启动后端和前端服务
        startServices()
        
        // 创建窗口
        let windowRect = NSRect(x: 100, y: 100, width: 1400, height: 900)
        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "OpenClaw Web UI"
        window.center()
        
        // 创建 WebView
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        window.contentView?.addSubview(webView)
        
        // 等待服务启动后加载页面
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if let url = URL(string: "http://localhost:3000") {
                self.webView.load(URLRequest(url: url))
            }
        }
        
        window.makeKeyAndOrderFront(nil)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    
    func startServices() {
        let projectDir = "\(NSHomeDirectory())/.stepclaw/workspace/projects/openclaw-web-ui"
        let path = "\(NSHomeDirectory())/.stepclaw/bin:/usr/local/bin:/usr/bin:/bin"
        let stateDir = "\(NSHomeDirectory())/.stepclaw"
        
        // 启动后端
        backendTask = Process()
        backendTask?.launchPath = "/usr/bin/env"
        backendTask?.arguments = ["node", "\(projectDir)/server-v2.js"]
        backendTask?.environment = [
            "PORT": "3005",
            "PATH": path,
            "OPENCLAW_STATE_DIR": stateDir
        ]
        backendTask?.currentDirectoryPath = projectDir
        
        do {
            try backendTask?.run()
            print("后端服务已启动")
        } catch {
            print("后端启动失败: \(error)")
        }
        
        // 等待后端启动
        Thread.sleep(forTimeInterval: 2)
        
        // 启动前端
        frontendTask = Process()
        frontendTask?.launchPath = "/usr/bin/env"
        frontendTask?.arguments = ["npm", "run", "dev"]
        frontendTask?.environment = [
            "PATH": path,
            "OPENCLAW_STATE_DIR": stateDir
        ]
        frontendTask?.currentDirectoryPath = projectDir
        
        do {
            try frontendTask?.run()
            print("前端服务已启动")
        } catch {
            print("前端启动失败: \(error)")
        }
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        // 停止服务
        backendTask?.terminate()
        frontendTask?.terminate()
    }
    
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }
}

// 主函数
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
