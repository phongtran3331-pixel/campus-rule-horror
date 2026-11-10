# 校园规则怪谈：自管委

规则怪谈 × 社交推理 × 生存，多人联网（9–12 人，开房间 + 邀请码）。

## 技术栈

- **服务端** `server/`：Colyseus 0.16（WebSocket 房间）+ TypeScript + tsx
- **客户端** `client/`：React 18 + TypeScript + Vite（手机竖屏优先）
- 单仓 npm workspaces，根目录 `npm run dev` 同时拉起两端

## 快速开始

```bash
npm install        # 首次
npm run dev        # 服务端 ws://localhost:2567 + 客户端 http://localhost:7100
npm run typecheck  # 两端类型检查
node scripts/smoke.mjs  # 端到端冒烟（需服务端已启动）
```

- 创建房间后把**邀请码**（即房间 ID）发给好友即可加入；勾选"测试加速 ×30"用于开发调试。
- 资产目录 `client/public/assets/` 目前为占位，生成规范见 `docs/素材生成清单.md`。

## 文档索引

| 文件 | 内容 |
|---|---|
| `docs/玩法大纲.md` | 总规则 v1.9 |
| `docs/校园规矩明细.md` | 8 固定 + 12 随机规则池 v1.4（互换制） |
| `docs/地图与事件.md` | 14 节点地图与交互 |
| `docs/沙盘推演报告.md` | 蒙特卡洛平衡推演（含 v1.4 互换制与阵营比扫描） |
| `docs/素材生成清单.md` | 全部美术素材提示词与规格 |
| `manual/build/main.pdf` | 玩法详解暨交互手册 v2.1 |

## 里程碑

- M1：框架——房间/邀请码/在线人数、阵营分配、11 分钟时段循环、占位地图与规则板、聊天占位
- M2：规则引擎（违规判定、检举弹药制、投票放逐、终局结算）；阵营机密改私发，不同步
- **M3（当前）**：生存与社区——饥饿衰减与淘汰、探索掉落（×1.5 丰度）、超市/校医院/回收站/食堂进餐、
  学生社区预约制（每段 ≤3 人、每人每天一段）与四房间（办公室档案 / 社区部预约记录 / 策创部抹规 / 咖啡屋）、
  理事长自由行动（不耗 AP）与假装交互；`debug` 消息仅加速测试局（timeScale>1）注册
- M4：信息战——宣传部校园墙（破译 2 条规则详解 / 三好学生表彰 1.5 票 + 次日 15 AP / 匿名担保免检举或双惩）、
  行政楼影像室（监控每日 3 次，理事长不限；查阅卡调阅设施日志仅时间）、
  网络中心剪/修网线（断网 = 全员位置视野关闭，滤镜状态实现，4 分钟自动恢复）、私聊转账；
  设施使用日志（超市/校医院/闸机/影像室）支撑"留痕推理"；
  两张美术地图（白天/夜晚）就位并校准节点坐标，断网为重滤镜不重绘
- M5：素材全面接入、结算界面、发言顺序/归票权 UI、实测平衡校准

## 已知实现注记

- `uWebSockets.js` 是 Colyseus 的 GitHub 可选依赖，本机网络不可达，已在根 `package.json` 用 npm `overrides` 替换为 `ws`（生产部署如需 uWS 传输再评估）。
- tsx 需显式 `--tsconfig server/tsconfig.json`（workspace 根无 tsconfig，tsx 找不到装饰器配置）。
- schema 装饰器要求 `useDefineForClassFields: false`。

## 部署

- **客户端（GitHub Pages）**：推送 main 后 Actions 工作流 `.github/workflows/deploy-client.yml` 自动构建部署（vite `base` 由 `GH_PAGES` 环境变量切换）。首次需在仓库 Settings → Pages 将 Source 设为 "GitHub Actions"。
- **服务端**：Colyseus 需常驻进程，可选 Railway / Render / Fly.io 等；部署后以 `VITE_SERVER_URL=ws://<服务端地址>` 重新构建客户端，否则客户端默认连 `location.hostname:2567`。
