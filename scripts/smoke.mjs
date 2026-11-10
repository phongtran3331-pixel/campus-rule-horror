// 端到端冒烟测试（M2 规则引擎/检举/投票/结算 + M3 生存/社区 + M4 信息战）
// 状态断言一律 waitFor 轮询；时段/结算事件用早期注册的 recorder 记录，
// 杜绝"监听注册晚于事件"导致的永久挂起。
// 用法：先启动服务端（默认 ws://127.0.0.1:2567），再 `node scripts/smoke.mjs`
import { createRequire } from "node:module";

const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const names = ["甲", "乙", "丙", "丁", "戊"];
const SCALE = 22; // 加速对局：全程约 150 秒，上午窗口 8 秒

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 5000, step = 60) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(step);
  }
  return false;
};
let failed = false;
const check = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed = true;
};
const stOf = (room, id) => room.state.players.get(id);

async function main() {
  // 1. 建房 + 4 人凭邀请码加入
  const host = await client.create("game", { name: names[0], gender: "male", timeScale: SCALE });
  const others = [];
  for (let i = 1; i < 5; i++) {
    others.push(await client.joinById(host.roomId, { name: names[i], gender: i % 2 ? "female" : "male" }));
  }
  const all = [host, ...others];
  console.log(`[smoke] 房间 ${host.roomId}，${all.length} 人在线`);

  // 2. 事件 recorder（先注册，永不漏事件）
  const roles = {};
  const notices = [];
  const phases = [];
  let gameover = null;
  all.forEach((r) => {
    r.onMessage("role", (d) => { roles[r.sessionId] = d; });
    r.onMessage("notice", (m) => notices.push(m.text));
  });
  host.onMessage("phase", (m) => { phases.push(m); console.log(`[smoke] · 时段 ${m.phase} Day${m.day} @${Math.round((Date.now() - t0) / 100) / 10}s`); });
  host.onMessage("gameover", (g) => { gameover = g; console.log(`[smoke] · 结算 winner=${g.winner}`); });
  const t0 = Date.now();
  const waitPhase = (phase, day, timeout = 60000) => waitFor(() => phases.some((m) => m.phase === phase && m.day === day), timeout);
  const arrive = async (room, id, nodeId, timeout = 8000) => waitFor(() => stOf(room, id).nodeId === nodeId, timeout);

  const initP = new Promise((res) => host.onMessage("init", res));
  host.send("start");
  const init = await initP;
  // 预热：等角色私发 + 状态同步就绪，避免开局消息积压
  await waitFor(() => Object.keys(roles).length === 5 && stOf(host, host.sessionId)?.ap === 10, 6000);

  const stuIds = Object.keys(roles).filter((id) => roles[id].faction === "student");
  const stuClients = stuIds.map((id) => all.find((r) => r.sessionId === id));
  const [jia, yi, bing] = stuClients;
  const chairs = Object.entries(roles).filter(([, r]) => r.faction === "chair").map(([id]) => id);
  const chiefId = [...chairs].sort((a, b) => all.findIndex((r) => r.sessionId === a) - all.findIndex((r) => r.sessionId === b))[0];
  const chief = all.find((r) => r.sessionId === chiefId);
  const aChair = all.find((r) => r.sessionId === chairs[1]);

  // ---- 上午时限敏感操作：立刻全部发出 ----
  const studentId = stuIds[0];
  const stu = stuClients[0];
  notices.length = 0;
  stu.send("move", { nodeId: "canteen" });          // F1 第一步
  jia.send("explore");
  yi.send("debug", { give: "key_office" });
  yi.send("bookSlot", { slot: "am" });
  yi.send("move", { nodeId: "community" });
  bing.send("debug", { give: "key_cce" });
  bing.send("bookSlot", { slot: "am" });
  bing.send("move", { nodeId: "community" });

  // ---- 断言 ----
  check(stuIds.length === 3 && chairs.length === 2, `阵营分配 2 理事长 + 3 干事（实际 ${chairs.length}/${stuIds.length}）`);
  console.log(`[smoke] 板上规则 ${init.ruleBoard.length} 条`);
  check(roles[chairs[0]].chairs.length === 2, "理事长可见同伴名单（2 人）");
  check(roles[stuIds[0]].chairs.length === 0, "干事不可见理事长名单");
  let factionLeak = false;
  host.state.players.forEach((p) => { if ("faction" in p) factionLeak = true; });
  check(!factionLeak, "同步状态不泄露 faction 字段");

  // F1：上午回到宿舍 → 违规
  await arrive(stu, studentId, "canteen", 5000);
  stu.send("move", { nodeId: "dorm" });
  check(await waitFor(() => notices.some((t) => t.includes("违反了校规")), 4000), "F1 上午返回宿舍触发匿名通报");
  await arrive(stu, studentId, "dorm", 3000);
  check(await waitFor(() => stOf(host, jia.sessionId).ap <= 9, 3000), "探索消耗 1 AP");

  // 办公室档案（社区，需预约+钥匙）
  await arrive(yi, yi.sessionId, "community", 5000);
  notices.length = 0;
  yi.send("officeArchive", { aId: stuIds[0], bId: stuIds[1] });
  check(await waitFor(() => notices.some((t) => t.includes("同一阵营")), 4000), "办公室档案：两名干事同阵营判定已私发");

  // 策创部抹规
  await arrive(bing, bing.sessionId, "community", 5000);
  notices.length = 0;
  bing.send("cceErase", { ruleId: init.ruleBoard[1].id });
  check(await waitFor(() => notices.some((t) => t.includes("字迹淡了下去")), 4000), "策创部抹除规则（通报不透露操作者）");

  // M3 交易（无时段限制，甲回食堂→超市）
  jia.send("move", { nodeId: "canteen" });
  await arrive(jia, jia.sessionId, "canteen", 5000);
  jia.send("move", { nodeId: "market" });
  await arrive(jia, jia.sessionId, "market", 5000);
  const coinsBefore = stOf(host, jia.sessionId).coins;
  const foodBeforeBuy = stOf(host, jia.sessionId).food;
  jia.send("buy", { item: "food" });
  check(await waitFor(() => stOf(host, jia.sessionId).food === foodBeforeBuy + 1 && stOf(host, jia.sessionId).coins === coinsBefore - 5, 4000),
    `超市购食物（币 ${coinsBefore} → ${stOf(host, jia.sessionId).coins}）`);
  const foodBeforeEat = stOf(host, jia.sessionId).food;
  jia.send("eat", { nodeId: "market" });
  check(await waitFor(() => stOf(host, jia.sessionId).food === foodBeforeEat - 1, 3000), "进食消耗食物 ×1");

  // 理事长：自由移动不耗 AP、购物假装成功
  const chairApBefore = stOf(host, aChair.sessionId).ap;
  aChair.send("move", { nodeId: "canteen" });
  await arrive(aChair, aChair.sessionId, "canteen", 5000);
  aChair.send("move", { nodeId: "market" });
  await arrive(aChair, aChair.sessionId, "market", 5000);
  const chairCoinsBefore = stOf(host, aChair.sessionId).coins;
  aChair.send("buy", { item: "food" });
  await sleep(400);
  check(stOf(host, aChair.sessionId).ap === chairApBefore, "理事长移动不耗 AP");
  check(stOf(host, aChair.sessionId).food === 0 && stOf(host, aChair.sessionId).coins === chairCoinsBefore, "理事长假装购物（币与食物不变）");

  // 5. 夜间检举（弹药=今日违规数）
  const hpBefore = stOf(stu, studentId).hp;
  await waitPhase("night", 0);
  chief.send("accuse", { targetId: studentId });
  check(await waitFor(() => stOf(stu, studentId).hp === hpBefore - 25, 4000), `检举成功 HP ${hpBefore} → ${stOf(stu, studentId).hp}（应 -25）`);

  // 6. 换规
  const onBoard = new Set(init.ruleBoard.map((r) => r.id));
  const poolIds = Array.from({ length: 12 }, (_, i) => `R${i + 1}`).filter((id) => !onBoard.has(id));
  check(poolIds.length === 7, `备选池 ${poolIds.length} 条（应 7）`);
  const swapP = new Promise((res) => host.onMessage("ruleSwap", (d) => res(d)));
  chief.send("swapRule", { outId: init.ruleBoard[0].id, inId: poolIds[0] });
  const swappedBoard = await Promise.race([swapP, sleep(2000).then(() => null)]);
  check(!!swappedBoard && !swappedBoard.board.includes(init.ruleBoard[0].id), `换规生效（${poolIds[0]} 上板）`);

  // 7. Day1 清晨：过夜饥饿衰减
  await waitPhase("morning", 1);
  check(await waitFor(() => Math.round(stOf(host, jia.sessionId).hunger) === 67, 4000), `过夜饥饿衰减（甲 ${Math.round(stOf(host, jia.sessionId).hunger)}，应 67）`);

  // 8. M4 信息战（Day1 上午）
  for (const g of ["scissors", "card", "key_press"]) bing.send("debug", { give: g });
  bing.send("move", { nodeId: "tA" });
  await arrive(bing, bing.sessionId, "tA", 5000);
  bing.send("move", { nodeId: "admin" });
  await arrive(bing, bing.sessionId, "admin", 5000);
  bing.send("cutNet");
  check(await waitFor(() => host.state.netDown === true, 4000), "剪断网线 → 断网状态生效");
  bing.send("repairNet");
  check(await waitFor(() => host.state.netDown === false, 4000), "修复网线（1 AP）→ 断网解除");
  notices.length = 0;
  bing.send("camera");
  check(await waitFor(() => notices.some((t) => t.includes("【监控】")), 4000), "影像室监控：全图位置已私发");
  bing.send("inspectLog", { facility: "超市售货机" });
  check(await waitFor(() => notices.some((t) => t.includes("【调阅记录】")), 4000), "查阅卡调阅设施记录（仅时间）");
  bing.send("bookSlot", { slot: "am" });
  bing.send("move", { nodeId: "tA" });
  await arrive(bing, bing.sessionId, "tA", 5000);
  bing.send("move", { nodeId: "community" });
  await arrive(bing, bing.sessionId, "community", 5000);
  notices.length = 0;
  bing.send("press", { action: "decode" });
  check(await waitFor(() => notices.some((t) => t.includes("详解")), 4000), "校园墙破译：2 条规则详细说明已广播");

  // 私聊转账（乙 → 甲 3 币）
  const jiaCoinsBefore = stOf(host, jia.sessionId).coins;
  let dmGot = false;
  jia.onMessage("dm", () => { dmGot = true; });
  yi.send("dm", { targetId: jia.sessionId, text: "别信戊", coins: 3 });
  check(await waitFor(() => dmGot && stOf(host, jia.sessionId).coins === jiaCoinsBefore + 3, 4000), "私聊送达且转账 +3 币");

  // 9. Day1 午间全员投票放逐（全投丁）
  const ding = all[3].sessionId;
  await waitPhase("noon", 1);
  all.forEach((r) => r.send("vote", { targetId: ding }));
  await waitPhase("afternoon", 1);
  check(await waitFor(() => stOf(all[3], ding).alive === false, 4000), "Day1 午间投票：丁被放逐");
  check(notices.some((t) => t.includes("出局")), "放逐结果已广播（含身份公示）");

  // 10. 等结算（学生不进食会在数日饿死，理事长胜是预期结果）
  await waitFor(() => gameover !== null, 120000, 500);
  check(!!gameover && ["chair", "student"].includes(gameover.winner), `结算完成，胜方 = ${gameover?.winner}`);
  console.log(`[smoke] 结算详情：${gameover?.detail}`);

  if (failed) throw new Error("存在未通过项");
  console.log("[smoke] 全部通过 ✓");
  process.exit(0);
}

main().catch((e) => { console.error("[smoke] 失败:", e.message ?? e); process.exit(1); });
