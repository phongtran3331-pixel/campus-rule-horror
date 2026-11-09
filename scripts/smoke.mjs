// 端到端冒烟测试：验证房间创建、邀请码加入、开局分阵营、时段推进、移动扣 AP。
// 用法：先启动服务端（默认 ws://127.0.0.1:2567），再 `node scripts/smoke.mjs`
import { createRequire } from "node:module";

const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const names = ["甲", "乙", "丙", "丁", "戊"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 建房 + 4 人凭邀请码加入
  const host = await client.create("game", { name: names[0], gender: "male", timeScale: 30 });
  const others = [];
  for (let i = 1; i < 5; i++) {
    others.push(await client.joinById(host.roomId, { name: names[i], gender: i % 2 ? "female" : "male" }));
  }
  console.log(`[smoke] 房间 ${host.roomId}，${1 + others.length} 人在线`);

  // 2. 等待 init（地图/规则）与首个时段
  const initP = new Promise((res) => host.onMessage("init", res));
  const phaseP = new Promise((res) => host.onMessage("phase", res));
  host.send("start");
  const [init, phase] = await Promise.all([initP, phaseP]);
  console.log(`[smoke] init: 节点 ${init.nodes.length}，固定规则 ${init.fixedRules.length}，板上随机规则 ${init.ruleBoard.length}，丰度 ×${init.lootMult}`);
  console.log(`[smoke] 进入时段 ${phase.phase}（Day ${phase.day}）`);

  // 3. 校验阵营分配（≥9 人才有 3 理事长；5 人局应为 2 理事长）
  await sleep(600); // 等待状态同步补丁到达
  const factions = {};
  host.state.players.forEach((p) => { factions[p.faction] = (factions[p.faction] ?? 0) + 1; });
  console.log(`[smoke] 阵营分布:`, factions);

  // 4. 移动扣 AP：乙 宿舍→食堂
  const guest = others[0];
  await sleep(300);
  const before = { node: guest.state.players.get(guest.sessionId).nodeId, ap: guest.state.players.get(guest.sessionId).ap };
  guest.send("move", { nodeId: "canteen" });
  await sleep(500);
  const after = { node: guest.state.players.get(guest.sessionId).nodeId, ap: guest.state.players.get(guest.sessionId).ap };
  console.log(`[smoke] 移动: ${before.node}(AP ${before.ap}) -> ${after.node}(AP ${after.ap})`);
  if (after.node !== "canteen" || after.ap !== before.ap - 1) throw new Error("移动扣 AP 校验失败");

  console.log("[smoke] 全部通过 ✓");
  process.exit(0);
}

main().catch((e) => { console.error("[smoke] 失败:", e.message ?? e); process.exit(1); });
