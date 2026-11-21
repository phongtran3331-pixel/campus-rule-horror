// 教学楼A新版 + 天数衰减 + 体育馆杠铃杆链 专项冒烟
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://192.144.254.107:2567");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000, step = 60) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step); }
  return false;
};
let failed = false;
const check = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) failed = true; };

async function main() {
  const r = await client.create("game", { name: "测", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const results = [];
  const quizzes = [];
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  r.onMessage("role", () => {});
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) throw new Error("未进入探索时段");
  const me = () => r.state.players.get(r.sessionId);
  // 中午时段不计时：进入 noon 自动确认（第1天起还需投票），保证昼夜循环推进
  const noonWatcher = setInterval(() => {
    if (r.state.phase === "noon") {
      r.send("noonDone");
      if (r.state.day >= 1) {
        const other = [...r.state.players.keys()].find((id) => id !== r.sessionId);
        if (other) r.send("vote", { targetId: other });
      }
    }
  }, 200);
  // timeScale 22 下探索时段仅 8—11 秒：每次发事件前确保处于探索时段
  const waitExplore = async () => {
    await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 100);
  };
  // 状态补丁比 sceneResult 消息晚到：断言 state 数值前先等一小段
  const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

  // ===== 教学楼A 新结构 =====
  r.send("move", { nodeId: "tA" });
  await waitFor(() => me().nodeId === "tA");

  // 1) 第0天：SAN-6 原值结算
  const san0 = me().san;
  let n = results.length;
  await waitExplore(); r.send("sceneEvent", { sceneId: "tA", eventId: "y001c" });
  await waitFor(() => results.length > n);
  await waitFor(() => me().san === san0 - 6, 5000, 100); // 等状态同步到达再断言
  let res = results[results.length - 1];
  check(res.states.san === -6 && me().san === san0 - 6, `第0天 y001c SAN 标注-6 实扣-6（${san0}→${me().san}）`);
  check(!("ap" in res.states) && !("hp" in res.states), `states 不含 undefined 键（keys=${JSON.stringify(Object.keys(res.states))}）`);

  // 2) 深度探索：y002b1 得旧课本且 AP-1
  const ap0 = me().ap;
  n = results.length;
  await waitExplore(); r.send("sceneEvent", { sceneId: "tA", eventId: "y002b1" });
  await waitFor(() => results.length > n);
  await settle();
  res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "普#4") && me().ap === ap0 - 1,
    `y002b1 深度探索得旧课本且 AP-1（ap0=${ap0} 后=${me().ap} grants=${JSON.stringify(res.grants)} ev=${res.eventId}）`);

  // ===== 体育馆杠铃杆链 =====
  const coins0 = me().coins;
  r.send("move", { nodeId: "gym" });
  await waitFor(() => me().nodeId === "gym");
  n = results.length;
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y148" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.text.includes("拖动痕迹"), "y148 杠铃架拖痕入口");
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y149" });
  await waitFor(() => results.length > n + 1);
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y150" });
  await waitFor(() => results.length > n + 2);
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y150a" });
  await waitFor(() => results.length > n + 3);
  res = results[results.length - 1];
  check(res.states.san === -2 && res.states.ap === -1, `y150a 深度探索 SAN-2 AP-1（实扣 ${res.states.san}/${res.states.ap}）`);
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y151" });
  await waitFor(() => results.length > n + 4);
  await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y152" });
  await waitFor(() => quizzes.length > 0 || results.length > n + 5);
  check(quizzes.length > 0 && quizzes[0].rule.includes("预设正确选项=第2项"), "y152 返回答题（静态题）");
  if (quizzes.length) {
    await waitExplore(); r.send("sceneEvent", { sceneId: "gym", eventId: "y152", answer: "2次" });
    await waitFor(() => results.length > n + 5);
    await settle();
    res = results[results.length - 1];
    check(res.grants.some((g) => g.name === "杠铃杆"), "y152 答对获得杠铃杆(关#2)");
    check(me().coins === coins0 - 5, `体育馆入场费 5 币（${coins0}→${me().coins}）`);
  }

  // ===== 天数衰减 =====
  const ok = await waitFor(() => r.state.day >= 1 && ["morning", "afternoon", "evening"].includes(r.state.phase), 300000, 300);
  check(ok, `进入第 ${r.state.day} 天探索时段`);
  if (ok) {
    r.send("move", { nodeId: "tA" });
    await waitFor(() => me().nodeId === "tA");
    const san1 = me().san;
    n = results.length;
    await waitExplore(); r.send("sceneEvent", { sceneId: "tA", eventId: "y004a" });
    await waitFor(() => results.length > n);
    await settle();
    res = results[results.length - 1];
    const expect = -6 - r.state.day * Math.floor(6 / 5); // 负向随天数加重：-6→第1天-7
    check(res.states.san === expect && me().san === Math.max(0, san1 + expect),
      `第${r.state.day}天 y004a SAN 标注-6 → 实扣 ${res.states.san}（期望 ${expect}，san1=${san1} 后=${me().san}）`);
  }

  r.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[tA-smoke] 存在未通过项" : "[tA-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
