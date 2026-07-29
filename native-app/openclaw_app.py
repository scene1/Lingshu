#!/usr/bin/env python3
"""
OpenClaw Web UI - 原生桌面应用
使用 PyQt6 封装 Web UI
"""

import sys
import os
import subprocess
import time
from PyQt6.QtWidgets import QApplication, QMainWindow, QMessageBox
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtCore import QUrl, Qt
from PyQt6.QtGui import QIcon

class OpenClawApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("OpenClaw Web UI")
        self.setGeometry(100, 100, 1400, 900)
        
        # 启动服务
        self.start_services()
        
        # 创建 WebView
        self.web_view = QWebEngineView()
        self.setCentralWidget(self.web_view)
        
        # 加载页面
        self.web_view.load(QUrl("http://localhost:3000"))
        
        # 显示窗口
        self.show()
    
    def start_services(self):
        """启动后端和前端服务"""
        home = os.path.expanduser("~")
        project_dir = f"{home}/.stepclaw/workspace/projects/openclaw-web-ui"
        
        # 设置环境变量
        env = os.environ.copy()
        env["OPENCLAW_STATE_DIR"] = f"{home}/.stepclaw"
        env["PATH"] = f"{home}/.stepclaw/bin:{env.get('PATH', '')}"
        
        # 检查后端
        try:
            import urllib.request
            urllib.request.urlopen("http://localhost:3005/api/instances", timeout=2)
        except:
            # 启动后端
            subprocess.Popen(
                ["node", "server-v2.js"],
                cwd=project_dir,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(2)
        
        # 检查前端
        try:
            import urllib.request
            urllib.request.urlopen("http://localhost:3000", timeout=2)
        except:
            # 启动前端
            subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=project_dir,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(3)

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("OpenClaw Web UI")
    
    window = OpenClawApp()
    
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
