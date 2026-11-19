$game = $false; $page = $false
try { $game = (Invoke-WebRequest http://127.0.0.1:2567/healthz -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
try { $page = (Invoke-WebRequest http://127.0.0.1:7100/ -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
if (-not $game -or -not $page) {
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tsx|static-server' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
  Start-Sleep -Seconds 2
  & C:\atto\start.ps1
  "restarted at $(Get-Date)" | Set-Content C:\atto\logs\watchdog.log -Encoding UTF8
}
