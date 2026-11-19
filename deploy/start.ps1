$ErrorActionPreference = "SilentlyContinue"
$env:PATH = 'C:\atto\node;' + $env:PATH
New-Item -ItemType Directory -Force C:\atto\logs | Out-Null
Start-Process -FilePath C:\atto\node\node.exe `
  -ArgumentList 'C:\atto\app\node_modules\tsx\dist\cli.mjs','--tsconfig','tsconfig.json','src\index.ts' `
  -WorkingDirectory 'C:\atto\app\server' -WindowStyle Hidden `
  -RedirectStandardOutput 'C:\atto\logs\game.log' -RedirectStandardError 'C:\atto\logs\game.err.log'
Start-Process -FilePath C:\atto\node\node.exe `
  -ArgumentList 'C:\atto\app\scripts\static-server.mjs','client\dist','7100' `
  -WorkingDirectory 'C:\atto\app' -WindowStyle Hidden `
  -RedirectStandardOutput 'C:\atto\logs\page.log' -RedirectStandardError 'C:\atto\logs\page.err.log'
