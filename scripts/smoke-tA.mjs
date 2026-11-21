// 教学楼A need/consume/deny 机制专项冒烟
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
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
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("role", () => {});
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) { console.log("✗ 开局失败"); process.exit(1); }
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) { console.log("✗ 未进入探索时段"); process.exit(1); }

  r.send("move", { nodeId: "tA" });
  await waitFor(() => r.state.players.get(r.sessionId).nodeId === "tA");
  const me = () => r.state.players.get(r.sessionId);

  // 1) 深度入口无前置物品 → deny 文案，无结算
  const n0 = results.length;
  r.send("sceneEvent", { sceneId: "tA", eventId: "10105" });
  await waitFor(() => results.length > n0);
  let res = results[results.length - 1];
  check(res.text.includes("回声都是实的") && res.grants.length === 0, `无半截粉笔进 10105 回 deny：「${res.text.slice(0, 24)}…」`);

  // 2) 普通事件拿半截粉笔（10101a）
  r.send("sceneEvent", { sceneId: "tA", eventId: "10101a" });
  await waitFor(() => results.length > n0 + 1);
  res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "普#1"), "10101a 获得半截粉笔");

  // 3) 持有前置后 10105 正常出分支动作文本
  r.send("sceneEvent", { sceneId: "tA", eventId: "10105" });
  await waitFor(() => results.length > n0 + 2);
  res = results[results.length - 1];
  check(res.text.includes("空洞的回声"), `持半截粉笔 10105 通过前置：「${res.text.slice(0, 20)}…」`);

  // 4) 分支撬夹层：-1AP + 半张教师名单
  const apBefore = me().ap;
  r.send("sceneEvent", { sceneId: "tA", eventId: "10105a" });
  await waitFor(() => results.length > n0 + 3);
  res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "普#8") && me().ap === apBefore - 1, `10105a 得名单且 AP ${apBefore}→${me().ap}`);

  // 5) 无剪刀点 20404a → deny
  const n1 = results.length;
  r.send("sceneEvent", { sceneId: "tA", eventId: "20404a" });
  await waitFor(() => results.length > n1);
  res = results[results.length - 1];
  check(res.grants.length === 0 && res.text.length > 0, `无剪刀 20404a 被拒：「${res.text.slice(0, 20)}…」`);

  // 6) 答题分支首次返回题目（20304a）
  const quizzes = [];
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  const n2 = results.length;
  r.send("sceneEvent", { sceneId: "tA", eventId: "20304a" });
  await waitFor(() => quizzes.length > 0 || results.length > n2);
  check(quizzes.length > 0, "20304a 返回答题（dynamic_alive 题）");
  if (quizzes.length) {
    const alive = [...r.state.players.values()].filter((p) => p.alive).length;
    r.send("sceneEvent", { sceneId: "tA", eventId: "20304a", answer: String(alive) });
    await waitFor(() => results.length > n2);
    res = results[results.length - 1];
    check(res.grants.some((g) => g.ref === "关#3"), `答题正确获行政楼通行卡（存活 ${alive} 人）`);
  }

  // 7) consume：先拿剪刀（20203b），再 20404a 应消耗剪刀并获得储物柜钥匙
  r.send("sceneEvent", { sceneId: "tA", eventId: "20203b" });
  await waitFor(() => results.length > n2 + 1 || results.length > results.length);
  await sleep(400);
  const hasScis = [...me().pack.keys()].includes("关#8");
  check(hasScis, "20203b 获得剪刀(关#8)");
  if (hasScis) {
    const n3 = results.length;
    r.send("sceneEvent", { sceneId: "tA", eventId: "20404a" });
    await waitFor(() => results.length > n3);
    res = results[results.length - 1];
    check(res.grants.some((g) => g.ref === "关#6"), "20404a 获得储物柜钥匙");
    check(![...me().pack.keys()].includes("关#8"), "20404a 结算后剪刀已消耗");
  }

  console.log(failed ? "[tA-smoke] 存在未通过项" : "[tA-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
