// 端到端冒烟测试（M2 规则引擎/检举/投票/结算 + M3 生存/社区系统）
// 流程：建房 → 开局分阵营（角色私发）→ M3 探索/购物/用药/预约/档案/抹规
//      → F1 违规 → 理事长夜间检举 → 换规 → Day1 投票放逐 → 饥饿衰减 → Day4 结算。
// 用法：先启动服务端（默认 ws://127.0.0.1:2567），再 `node scripts/smoke.mjs`
import { createRequire } from "node:module";

const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const names = ["甲", "乙", "丙", "丁", "戊"];
const SCALE = 40; // 加速对局：全程约 85 秒（社区操作需要宽松的时段窗口）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed = true;
};

async function main() {
  // 1. 建房 + 4 人凭邀请码加入
  const host = await client.create("game", { name: names[0], gender: "male", timeScale: SCALE });
  const others = [];
  for (let i = 1; i < 5; i++) {
    others.push(await client.joinById(host.roomId, { name: names[i], gender: i % 2 ? "female" : "male" }));
  }
  const all = [host, ...others];
  console.log(`[smoke] 房间 ${host.roomId}，${all.length} 人在线`);

  // 2. 等待 init + 角色私发 + 首个时段
  const roles = {};
  const notices = [];
  all.forEach((r) => {
    r.onMessage("role", (d) => { roles[r.sessionId] = d; });
    r.onMessage("notice", (m) => notices.push(m.text));
  });
  const initP = new Promise((res) => host.onMessage("init", res));
  const firstPhaseP = new Promise((res) => host.onMessage("phase", (m) => res(m)));
  host.send("start");
  const [init] = await Promise.all([initP, firstPhaseP]);
  await sleep(300);
  const nChair = Object.values(roles).filter((r) => r.faction === "chair").length;
  const nStudent = Object.values(roles).filter((r) => r.faction === "student").length;
  console.log(`[smoke] 板上规则 ${init.ruleBoard.length} 条（固定 ${init.fixedRules.length} 不随 init 下发详情校验）`);
  check(nChair === 2 && nStudent === 3, `阵营分配 2 理事长 + 3 干事（实际 ${nChair}/${nStudent}）`);
  const chairs = Object.entries(roles).filter(([, r]) => r.faction === "chair").map(([id]) => id);
  check(chairs.length === 2 && roles[chairs[0]].chairs.length === 2, "理事长可见同伴名单（2 人）");
  check(roles[Object.keys(roles).find((id) => roles[id].faction === "student")].chairs.length === 0, "干事不可见理事长名单");
  // 阵营机密不进同步状态
  let factionLeak = false;
  host.state.players.forEach((p) => { if ("faction" in p) factionLeak = true; });
  check(!factionLeak, "同步状态不泄露 faction 字段");

  // 4. F1 违规：找一名干事，宿舍→食堂→宿舍（上午进入宿舍违规）——先做，抢占上午窗口
  const stuIds = Object.keys(roles).filter((id) => roles[id].faction === "student");
  const studentId = stuIds[0];
  const stu = all.find((r) => r.sessionId === studentId);
  const chiefId = chairs.sort((a, b) => all.findIndex((r) => r.sessionId === a) - all.findIndex((r) => r.sessionId === b))[0];
  const chief = all.find((r) => r.sessionId === chiefId);
  notices.length = 0;
  stu.send("move", { nodeId: "canteen" });
  await sleep(200);
  stu.send("move", { nodeId: "dorm" });
  await sleep(300);
  check(notices.some((t) => t.includes("违反了校规")), "F1 上午返回宿舍触发匿名通报");

  // 3. M3 生存与社区（Day0 上午窗口内完成）
  const stuClients = stuIds.map((id) => all.find((r) => r.sessionId === id));
  const [jia, yi, bing] = stuClients;
  const meJia = () => host.state.players.get(jia.sessionId);
  const apBefore = meJia().ap;
  jia.send("explore");
  await sleep(150);
  check(meJia().ap === apBefore - 1, `探索消耗 1 AP（${apBefore} → ${meJia().ap}）`);
  // 甲：宿舍→食堂→超市，买食物并进食
  jia.send("move", { nodeId: "canteen" });
  await sleep(100);
  jia.send("move", { nodeId: "market" });
  await sleep(100);
  const coinsBefore = meJia().coins;
  const foodBeforeBuy = meJia().food;
  jia.send("buy", { item: "food" });
  await sleep(150);
  check(meJia().food === foodBeforeBuy + 1 && meJia().coins === coinsBefore - 5, `超市购食物（币 ${coinsBefore} → ${meJia().coins}，食物 ${foodBeforeBuy} → ${meJia().food}）`);
  const foodBeforeEat = meJia().food;
  jia.send("eat", { nodeId: "market" });
  await sleep(150);
  check(meJia().food === foodBeforeEat - 1, "进食消耗食物 ×1");
  // 乙：领钥匙、预约上午段、去社区查档案（调查两名干事是否同阵营）
  yi.send("debug", { give: "key_office" });
  await sleep(100);
  yi.send("bookSlot", { slot: "am" });
  await sleep(100);
  yi.send("bookSlot", { slot: "pm" }); // 应被拒绝：每天限一段
  await sleep(100);
  yi.send("move", { nodeId: "community" });
  await sleep(150);
  notices.length = 0;
  yi.send("officeArchive", { aId: stuIds[0], bId: stuIds[1] });
  await sleep(200);
  check(
    notices.some((t) => t.includes("同一阵营")),
    "办公室档案：两名干事同阵营判定已私发",
  );
  bing.send("debug", { give: "key_cce" });
  await sleep(100);
  bing.send("bookSlot", { slot: "am" });
  await sleep(100);
  bing.send("move", { nodeId: "community" });
  await sleep(150);
  const eraseP = new Promise((res) => host.onMessage("ruleSwap", (d) => res(d)));
  const boardBeforeErase = init.ruleBoard.length;
  notices.length = 0;
  bing.send("cceErase", { ruleId: init.ruleBoard[1].id });
  const erased = await Promise.race([eraseP.then(() => true), sleep(400).then(() => false)]);
  check(erased, "策创部抹除规则后广播 ruleSwap");
  if (erased) check((await eraseP).board.length === boardBeforeErase - 1, "板上规则 5 → 4");
  await sleep(200); // 等待通报消息全量到达
  check(notices.some((t) => t.includes("字迹淡了下去")), "抹规通报不透露操作者");
  // 理事长：自由移动不耗 AP、购物假装成功
  const aChair = all.find((r) => r.sessionId === chairs[1]);
  const chairApBefore = host.state.players.get(aChair.sessionId).ap;
  aChair.send("move", { nodeId: "canteen" });
  await sleep(100);
  aChair.send("move", { nodeId: "market" });
  await sleep(150);
  const chairState = host.state.players.get(aChair.sessionId);
  check(chairState.ap === chairApBefore && chairState.nodeId === "market", "理事长移动不耗 AP");
  const chairCoinsBefore = chairState.coins;
  aChair.send("buy", { item: "food" });
  await sleep(150);
  check(host.state.players.get(aChair.sessionId).food === 0 && host.state.players.get(aChair.sessionId).coins === chairCoinsBefore, "理事长假装购物（币与食物不变）");

  // 夜间：编号最小理事长检举该干事（Day0 弹药 ≥1，命中扣 25）
  const hpBefore = stu.state.players.get(studentId).hp;
  const nightP = new Promise((res) => host.onMessage("phase", (m) => { if (m.phase === "night" && m.day === 0) res(m); }));
  await nightP;
  chief.send("accuse", { targetId: studentId });
  await sleep(400);
  const hpAfter = stu.state.players.get(studentId).hp;
  check(hpAfter === hpBefore - 25, `检举成功 HP ${hpBefore} → ${hpAfter}（应 -25）`);
  check(notices.some((t) => t.includes("检举成立")), "夜间通报检举成立");

  // 5. 换规：先检举过，理事长可用备选池互换一条规则并广播
  const swapSeen = new Promise((res) => host.onMessage("ruleSwap", (d) => res(d)));
  const onBoard = new Set(init.ruleBoard.map((r) => r.id));
  const poolIds = Array.from({ length: 12 }, (_, i) => `R${i + 1}`).filter((id) => !onBoard.has(id));
  check(poolIds.length === 7, `备选池 ${poolIds.length} 条（应 7）`);
  chief.send("swapRule", { outId: init.ruleBoard[0].id, inId: poolIds[0] });
  const swapped = await Promise.race([swapSeen.then(() => true), sleep(600).then(() => false)]);
  const boardIds = swapped ? (await swapSeen).board.map((r) => r.id) : [];
  check(swapped, "换规广播生效（理事长互换备选池规则）");
  if (swapped) check(!boardIds.includes(init.ruleBoard[0].id) && boardIds.includes(poolIds[0]), `${poolIds[0]} 已上板替换原第 1 条`);

  // 6. Day1 清晨：过夜饥饿衰减校验（早晨时段过后）
  const morn1P = new Promise((res) => host.onMessage("phase", (m) => { if (m.phase === "morning" && m.day === 1) res(m); }));
  await morn1P;
  await sleep(200);
  check(Math.round(host.state.players.get(jia.sessionId).hunger) === 67, `过夜饥饿衰减（甲 ${Math.round(host.state.players.get(jia.sessionId).hunger)}，应 67）`);

  // 7. Day1 午间全员投票放逐一人（全投丁）
  const ding = all[3].sessionId;
  const noonP = new Promise((res) => host.onMessage("phase", (m) => { if (m.phase === "noon" && m.day === 1) res(m); }));
  await noonP;
  all.forEach((r) => r.send("vote", { targetId: ding }));
  await sleep(250);
  // 丁（若存活）不能自投，由其余 4 票决定
  const noonEndP = new Promise((res) => host.onMessage("phase", (m) => { if (m.phase === "afternoon" && m.day === 1) res(m); }));
  await noonEndP;
  await sleep(300);
  check(all[3].state.players.get(ding).alive === false, "Day1 午间投票：丁被放逐");
  check(notices.some((t) => t.includes("出局")), "放逐结果已广播（含身份公示）");

  // 8. 跑到 Day4 终投结算
  const overP = new Promise((res) => host.onMessage("gameover", res));
  const gameover = await overP;
  check(["chair", "student"].includes(gameover.winner), `Day4 结算完成，胜方 = ${gameover.winner}`);
  console.log(`[smoke] 结算详情：${gameover.detail}`);

  if (failed) throw new Error("存在未通过项");
  console.log("[smoke] 全部通过 ✓");
  process.exit(0);
}

main().catch((e) => { console.error("[smoke] 失败:", e.message ?? e); process.exit(1); });
