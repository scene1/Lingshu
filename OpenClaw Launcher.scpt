-- OpenClaw 路由中枢启动器
-- 启动服务后打开 Electron App 窗口，而不是系统浏览器。

set projectDir to (system attribute "HOME") & "/.stepclaw/workspace/projects/openclaw-web-ui"
set pathEnv to (system attribute "HOME") & "/.stepclaw/bin:/usr/local/bin:/usr/bin:/bin"
set stateDir to (system attribute "HOME") & "/.stepclaw"

try
    do shell script "curl -s http://127.0.0.1:3005/api/instances > /dev/null"
    display notification "后端服务已在运行" with title "OpenClaw"
on error
    display notification "正在启动后端服务..." with title "OpenClaw"
    do shell script "cd " & quoted form of projectDir & " && export OPENCLAW_STATE_DIR=" & quoted form of stateDir & " && export PATH=" & quoted form of pathEnv & " && nohup node server-v2.js > backend.log 2>&1 &"
    delay 2
end try

try
    do shell script "curl -s http://127.0.0.1:3000 > /dev/null"
on error
    display notification "正在启动前端服务..." with title "OpenClaw"
    do shell script "cd " & quoted form of projectDir & " && export OPENCLAW_STATE_DIR=" & quoted form of stateDir & " && nohup npm run dev > frontend.log 2>&1 &"
    delay 3
end try

display notification "正在打开 OpenClaw 路由中枢..." with title "OpenClaw"
try
    do shell script "open -a " & quoted form of "OpenClaw 路由中枢"
on error
    do shell script "open -a " & quoted form of "OpenClaw Web UI"
end try
