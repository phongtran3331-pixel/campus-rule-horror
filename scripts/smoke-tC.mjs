// 教学楼C 冒烟：深度探索 / 查询卡核验消耗 / 答题
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
  const quizzes = [];
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  r.onMessage("role", () => {});
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) throw new Error("未进入探索时段");
  const me = () => r.state.players.get(r.sessionId);

  // 1) tC 深度探索：c046b → 破旧的钥匙 + SAN-3 + AP-1
  r.send("move", { nodeId: "tC" });
  await waitFor(() => me().nodeId === "tC");
  const san0 = me().san;
  let n = results.length;
  r.send("sceneEvent", { sceneId: "tC", eventId: "c046b" });
  await waitFor(() => results.length > n);
  let res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "关#1") && me().san === san0 - 3, "c046b 获破旧钥匙且 SAN-3");

  // 2) 无查询卡点 c062 → deny
  n = results.length;
  r.send("sceneEvent", { sceneId: "tC", eventId: "c062" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.grants.length === 0 && res.text.includes("识别区"), `c062 无查询卡回 deny：「${res.text.slice(0, 18)}…」`);

  // 3) 去 tB 拿查询卡（y034b2 强行拉开）
  r.send("move", { nodeId: "tB" });
  await waitFor(() => me().nodeId === "tB");
  n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y034b2" });
  await waitFor(() => results.length > n);
  check([...me().pack.keys()].includes("关#5"), "tB y034b2 获得查询卡");

  // 4) 回 tC：c062a 消耗查询卡得金笔
  r.send("move", { nodeId: "tC" });
  await waitFor(() => me().nodeId === "tC");
  n = results.length;
  r.send("sceneEvent", { sceneId: "tC", eventId: "c062a" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "高#21") && ![...me().pack.keys()].includes("关#5"), "c062a 得金笔并消耗查询卡");

  // 5) 答题 c060a（dynamic_alive）
  r.send("move", { nodeId: "tC" });
  n = results.length;
  r.send("sceneEvent", { sceneId: "tC", eventId: "c060a" });
  await waitFor(() => quizzes.length > 0 || results.length > n);
  check(quizzes.length > 0, "c060a 返回答题");
  if (quizzes.length) {
    const alive = [...r.state.players.values()].filter((p) => p.alive).length;
    r.send("sceneEvent", { sceneId: "tC", eventId: "c060a", answer: String(alive) });
    await waitFor(() => results.length > n);
    res = results[results.length - 1];
    check(res.grants.some((g) => g.ref === "高#11"), `c060a 答对获单反相机（存活 ${alive}）`);
  }

  // 6) 三楼深度：c059c → 咖啡券 + SAN-4
  n = results.length;
  r.send("sceneEvent", { sceneId: "tC", eventId: "c059c" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.grants.some((g) => g.name === "褶皱的咖啡券"), "c059c 获褶皱的咖啡券");

  r.leave();
  console.log(failed ? "[tC-smoke] 存在未通过项" : "[tC-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
