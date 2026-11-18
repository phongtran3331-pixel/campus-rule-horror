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

  // 6) 状态结算：干事前往教学楼B 触发事件 8（跺脚亮灯 SAN-3）
  stu.send("move", { nodeId: "tB" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "tB");
  stu.send("sceneEvent", { sceneId: "tB", eventId: "8" });
  await waitFor(() => (results[stu.sessionId] || []).some((m) => m.eventId === "8"));
  const r8 = (results[stu.sessionId] || []).find((m) => m.eventId === "8");
  check(r8.states && r8.states.san === -4, `SAN 结算正确（payload ${JSON.stringify(r8.states)}）`);

  console.log(failed ? "[scene-smoke] 存在未通过项" : "[scene-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
