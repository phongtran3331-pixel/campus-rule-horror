// M6 场景文本链路冒烟：答题判定 / 先到先得 / dynamic_visit / 状态结算 / 理事长假交互
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 6000, step = 60) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step); }
  return false;
};
let failed = false;
const check = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) failed = true; };
// 加速局时段流转快，sceneEvent 仅探索时段可用：触发前等待进入探索时段
const EXPLORE_PHASES = ["morning", "afternoon", "evening"];
const waitExplore = (r) => waitFor(() => EXPLORE_PHASES.includes(r.state.phase), 120000, 200);

async function main() {
  const host = await client.create("game", { name: "甲", gender: "male", timeScale: 22, debug: true });
  const b = await client.joinById(host.roomId, { name: "乙", gender: "female" });
  const c = await client.joinById(host.roomId, { name: "丙", gender: "male" });
  const all = [host, b, c];

  const quiz = {}; const results = {}; const roles = {};
  for (const r of all) {
    r.onMessage("sceneQuiz", (m) => { quiz[r.sessionId] = m; });
    r.onMessage("sceneResult", (m) => { (results[r.sessionId] = results[r.sessionId] || []).push(m); });
    r.onMessage("role", (d) => { roles[r.sessionId] = d; });
  }
  host.send("start");
  if (!(await waitFor(() => Object.keys(roles).length === 3 && host.state.phase !== "lobby", 8000))) {
    console.log("✗ 开局失败（debug 房应直接开局）");
    process.exit(1);
  }
  const stu = all.find((r) => roles[r.sessionId].faction === "student");
  const aChair = all.find((r) => roles[r.sessionId].faction === "chair" && r !== stu);
  console.log(`  · 阵营：stu=${stu.sessionId.slice(0,4)} b=${b.sessionId.slice(0,4)}(${roles[b.sessionId].faction}) aChair=${aChair.sessionId.slice(0,4)}`);

  // 甲乙丙 全部移动到学校大门（dynamic_visit 应计 3）
  for (const r of all) r.send("move", { nodeId: "gate" });
  await waitFor(() => all.every((r) => r.state.players.get(r.sessionId).nodeId === "gate"));

  // 1) 干事触发 Y3 答题：应先收到 sceneQuiz
  stu.send("sceneEvent", { sceneId: "gate", eventId: "3" });
  check(await waitFor(() => quiz[stu.sessionId]), "答题事件先返回题目（sceneQuiz）");
  const q = quiz[stu.sessionId];
  check(q.question.includes("第几个来的") && q.numeric === true, `题目为数字填空题：${q.question}`);

  // 2) 实际到访 3 人 → 正确答案应为选项 3；故意答 1（错误）
  stu.send("sceneEvent", { sceneId: "gate", eventId: "3", answer: "1" });
  await waitFor(() => (results[stu.sessionId] || []).some((m) => m.eventId === "3" && m.text));
  let r3 = results[stu.sessionId].find((m) => m.eventId === "3");
  check(r3.text.includes("不再看你"), `答错返回答错分支文案：「${r3.text.slice(0, 24)}…」`);

  // 3) 答对（选项 3）：获得破旧的钥匙，pack 有 关#1
  stu.send("sceneEvent", { sceneId: "gate", eventId: "3", answer: "3" });
  await waitFor(() => (results[stu.sessionId] || []).filter((m) => m.eventId === "3").length >= 2);
  r3 = results[stu.sessionId].filter((m) => m.eventId === "3")[1];
  check(r3.grants.some((g) => g.ref === "关#1"), `答对获得破旧的钥匙：${JSON.stringify(r3.grants)}`);
  check(await waitFor(() => stu.state.players.get(stu.sessionId).pack.get("关#1") === 1), "pack 已入库 关#1");

  // 4) 先到先得：干事自己再答对 → 空态文案（3 人局仅 1 名干事）
  stu.send("sceneEvent", { sceneId: "gate", eventId: "3", answer: "3" });
  await waitFor(() => (results[stu.sessionId] || []).filter((m) => m.eventId === "3").length >= 3);
  const rb = (results[stu.sessionId] || []).filter((m) => m.eventId === "3").pop();
  check(rb.taken === true && rb.grants.length === 0, `点位被占回空态：「${rb.text.slice(0, 16)}…」`);
  check(stu.state.players.get(stu.sessionId).pack.get("关#1") === 1, "被占点位物品未重复发放");

  // 5) 理事长假交互：对 gate Y7 应回 fake，且不占用点位
  aChair.send("sceneEvent", { sceneId: "gate", eventId: "7" });
  await waitFor(() => (results[aChair.sessionId] || []).some((m) => m.eventId === "7"));
  const r7 = results[aChair.sessionId].find((m) => m.eventId === "7");
  check(r7.fake === true && r7.grants.length === 0, `理事长假交互（fake=${r7.fake}，无获得）`);

  // 6) 幻觉：SAN 压到 25 → 教学楼出现 404 教室事件；消耗 1AP，SAN 再扣（-4 得物 / -8 空）
  await waitExplore(stu);
  stu.send("debug", { give: "san20" });
  await waitFor(() => stu.state.players.get(stu.sessionId).san === 25);
  stu.send("move", { nodeId: "tA" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "tA");
  const apB = stu.state.players.get(stu.sessionId).ap;
  stu.send("sceneEvent", { sceneId: "tA", eventId: "__illusion" });
  check(await waitFor(() => (results[stu.sessionId] || []).some((m) => m.eventId === "__illusion")), "幻觉事件返回结果");
  const ri = (results[stu.sessionId] || []).find((m) => m.eventId === "__illusion");
  check(ri.states.ap === -1 && (ri.states.san === -4 || ri.states.san === -8), `幻觉结算（AP-1，SAN ${ri.states.san}）`);
  check(stu.state.players.get(stu.sessionId).ap === apB - 1, `幻觉消耗 1 AP（${apB} → ${stu.state.players.get(stu.sessionId).ap}）`);
  // 同日二次触发：得物分支应回空态；空分支本就不占位，再出结果也算正常
  stu.send("sceneEvent", { sceneId: "tA", eventId: "__illusion" });
  await waitFor(() => (results[stu.sessionId] || []).filter((m) => m.eventId === "__illusion").length >= 2);
  const ri2 = (results[stu.sessionId] || []).filter((m) => m.eventId === "__illusion")[1];
  check(ri2.taken === (ri.states.san === -4), `二次进入空态一致（首回 SAN${ri.states.san}，二次 taken=${ri2.taken}）`);

  // 7) 状态结算：干事前往教学楼B 触发事件 8（跺脚亮灯 SAN-3）
  stu.send("move", { nodeId: "tB" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "tB");
  stu.send("sceneEvent", { sceneId: "tB", eventId: "8" });
  await waitFor(() => (results[stu.sessionId] || []).some((m) => m.eventId === "8"));
  const r8 = (results[stu.sessionId] || []).find((m) => m.eventId === "8");
  check(r8.states && r8.states.san === -4, `SAN 结算正确（payload ${JSON.stringify(r8.states)}）`);

  // 7) 行政楼门禁：干事无通行卡被拒；debug 发 关#3（行政楼通行卡）后放行
  stu.send("move", { nodeId: "admin" });
  await sleep(400);
  check(stu.state.players.get(stu.sessionId).nodeId === "tB", "干事无通行卡进行政楼被拒");
  stu.send("debug", { give: "pack:关#3" });
  await waitFor(() => stu.state.players.get(stu.sessionId).pack.get("关#3") === 1);
  stu.send("move", { nodeId: "admin" });
  check(await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "admin"), "持通行卡放行行政楼");

  // 8) 超市购买：触发购买事件拿 {操作} 货表 → sceneBuy 扣币入 pack（牛奶 = 耗#1，8 币）
  stu.send("debug", { give: "ap" }); // 幻觉+多段移动后补 AP，避免移动被拒
  stu.send("debug", { give: "coins" });
  await waitFor(() => stu.state.players.get(stu.sessionId).coins >= 50);
  const coins0 = stu.state.players.get(stu.sessionId).coins;
  stu.send("move", { nodeId: "market" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "market");
  await waitExplore(stu);
  stu.send("sceneEvent", { sceneId: "market", eventId: "1" });
  await waitFor(() => (results[stu.sessionId] || []).some((m) => m.eventId === "1" && m.op));
  const r1 = (results[stu.sessionId] || []).find((m) => m.eventId === "1");
  check(r1.op.includes("购买——"), `购买事件回传货表（op=${r1.op.slice(0, 24)}…）`);
  stu.send("sceneBuy", { sceneId: "market", name: "未拆封的牛奶" });
  check(await waitFor(() => stu.state.players.get(stu.sessionId).pack.get("耗#1") === 1), "牛奶入背包（耗#1）");
  check(stu.state.players.get(stu.sessionId).coins === coins0 - 8, `扣币 8（${coins0} → ${stu.state.players.get(stu.sessionId).coins}）`);

  // 9) 使用消耗品：牛奶 饥饿+15，背包扣减
  const hunger0 = stu.state.players.get(stu.sessionId).hunger;
  stu.send("usePack", { ref: "耗#1" });
  check(await waitFor(() => !stu.state.players.get(stu.sessionId).pack.get("耗#1")), "使用后背包扣减");
  check(stu.state.players.get(stu.sessionId).hunger === Math.min(100, hunger0 + 15), `饥饿 +15（${hunger0} → ${stu.state.players.get(stu.sessionId).hunger}）`);

  // 10) 回收站：debug 塞 6 件杂物 → 一次回收超 5 件触发 SAN 惩罚
  for (let i = 0; i < 6; i++) stu.send("debug", { give: "junk" }); // legacy junk，不入 pack，改用 pack 杂物
  stu.send("debug", { give: "pack:普#1" }); stu.send("debug", { give: "pack:普#1" });
  stu.send("debug", { give: "pack:普#2" }); stu.send("debug", { give: "pack:普#2" });
  stu.send("debug", { give: "pack:普#3" }); stu.send("debug", { give: "pack:普#3" });
  await waitFor(() => stu.state.players.get(stu.sessionId).pack.get("普#3") === 2);
  stu.send("move", { nodeId: "recycle" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "recycle");
  await waitExplore(stu);
  const san0 = stu.state.players.get(stu.sessionId).san;
  stu.send("packRecycle", { refs: ["普#1", "普#1", "普#2", "普#2", "普#3", "普#3"] });
  check(await waitFor(() => !stu.state.players.get(stu.sessionId).pack.get("普#1")), "6 件杂物全部回收出背包");
  check(stu.state.players.get(stu.sessionId).san < san0, `一次超 5 件触发 SAN 惩罚（${san0} → ${stu.state.players.get(stu.sessionId).san}）`);

  console.log(failed ? "[scene-smoke] 存在未通过项" : "[scene-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
