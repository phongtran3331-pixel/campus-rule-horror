#!/usr/bin/env bash
# ATTO_page 一键部署：bash scripts/deploy.sh [setup|pack]
#   setup  首次：上传 + 装依赖 + 写 systemd 服务 + 启动
#   pack   仅打包上传（之后自行 ssh 更新）
#   无参   = pack + ssh 端解包 + npm ci + 重启（完整日常更新）
# 前提：服务器 ~/node/bin 下有用户级 Node（历史部署已装好）
set -euo pipefail

KEY="$HOME/.ssh/lizhuojia_ed25519"
HOST="lizhuojia@113.44.183.22"
MODE="${1:-full}"

pack() {
  echo "▶ 构建客户端…"
  npm run build
  echo "▶ 打包…"
  tar czf atto_page.tgz --exclude=node_modules --exclude='*/node_modules' \
    --exclude=.git --exclude=output --exclude=docs --exclude='*.tgz' .
  echo "▶ 上传…"
  scp -i "$KEY" -o StrictHostKeyChecking=no atto_page.tgz "$HOST:~/atto_page.tgz"
  rm atto_page.tgz
}

# 服务器端解包 + 装依赖（两段 heredoc 共用）
read -r -d '' REMOTE_COMMON <<'EOF' || true
set -e
cd ~/atto_page
tar xzf ~/atto_page.tgz && rm ~/atto_page.tgz
npm ci --no-audit --no-fund
EOF

# systemd 单元：一个服务同时托管游戏服务端(2567)与静态站点(7100)
read -r -d '' UNIT <<'EOF' || true
[Unit]
Description=ATTO_page (game server :2567 + static :7100)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/atto_page
Environment=PATH=%h/node/bin:/usr/local/bin:/usr/bin:/bin
Environment=PORT=2567
ExecStart=/bin/bash -c 'npm run start -w server & node scripts/static-server.mjs client/dist 7100 & wait'
Restart=always
RestartSec=5
MemoryMax=768M

[Install]
WantedBy=default.target
EOF

verify() {
  sleep 5
  systemctl --user is-active atto_page
  curl -sf http://127.0.0.1:2567/healthz && echo " <- server OK"
  curl -sf -o /dev/null -w "client HTTP %{http_code}\n" http://127.0.0.1:7100/
}

if [[ "$MODE" == "pack" || "$MODE" == "full" || "$MODE" == "setup" ]]; then
  pack
fi

if [[ "$MODE" == "setup" ]]; then
  echo "▶ 服务器端初始化…"
  ssh -i "$KEY" -o StrictHostKeyChecking=no "$HOST" "REMOTE_UNIT=$(printf '%q' "$UNIT")" 'bash -s' <<EOS
set -e
mkdir -p ~/atto_page
$REMOTE_COMMON
mkdir -p ~/.config/systemd/user
printf '%s\n' "\$REMOTE_UNIT" > ~/.config/systemd/user/atto_page.service
# 清掉旧命名残留
systemctl --user disable --now campus-game 2>/dev/null || true
rm -rf ~/app/campus-game
systemctl --user daemon-reload
systemctl --user enable --now atto_page
$(declare -f verify)
verify
EOS
  echo "✓ 首次部署完成：http://113.44.183.22:7100"
  exit 0
fi

echo "▶ 服务器端更新 + 重启…"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$HOST" 'bash -s' <<EOS
$REMOTE_COMMON
systemctl --user restart atto_page
$(declare -f verify)
verify
EOS
echo "✓ 更新完成：http://113.44.183.22:7100"
