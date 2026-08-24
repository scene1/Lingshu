-- 灵枢 (Lingshu) App 启动器
-- 通过 Electron 二进制直接启动，绕过环境变量污染

set projectDir to (system attribute "HOME") & "/Desktop/资料/lingshuproject"
set electronBin to projectDir & "/electron-dist/Electron.app/Contents/MacOS/Electron"
set stateDir to (system attribute "HOME") & "/Lingshu"

try
    do shell script "curl -s http://127.0.0.1:3005/api/health > /dev/null"
    display notification "后端服务已在运行" with title "灵枢"
on error
    display notification "正在启动灵枢..." with title "灵枢"
    -- 清除 ELECTRON_RUN_AS_NODE 和 NODE_OPTIONS，然后直接启动 Electron 二进制
    do shell script "cd " & quoted form of projectDir & " && unset ELECTRON_RUN_AS_NODE && unset NODE_OPTIONS && export NODE_ENV=production && " & quoted form of electronBin & " electron/main.cjs > /tmp/lingshu-electron.log 2>&1 &"
    delay 3
end try

display notification "灵枢已启动" with title "灵枢"
