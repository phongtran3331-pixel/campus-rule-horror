$game = $false; $page = $false
try { $game = (Invoke-WebRequest http://127.0.0.1:2567/healthz -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
try { $page = (Invoke-WebRequest http://127.0.0.1:7100/ -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
if (-not $game -or -not $page) {
  # 按监听端口清掉旧进程（比 CIM Terminate 可靠，后者在无头会话中不稳定）
  $pids = netstat -ano | Select-String ":7100\s.*LISTENING|:2567\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
  foreach ($p in $pids) { taskkill /F /PID $p 2>&1 | Out-Null }
  Start-Sleep -Seconds 2
  & C:\atto\start.ps1
  "restarted at $(Get-Date)" | Set-Content C:\atto\logs\watchdog.log -Encoding UTF8
}
