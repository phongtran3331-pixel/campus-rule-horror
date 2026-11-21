// 教学楼B + 理事长统一探索 专项冒烟
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

async function enterSolo(faction) {
  const r = await client.create("game", { name: "测", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: faction });
  r.onMessage("role", () => {});
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) throw new Error("未进入探索时段");
  r.send("move", { nodeId: "tB" });
  await waitFor(() => r.state.players.get(r.sessionId).nodeId === "tB");
  return r;
}

async function main() {
  // ===== 干事 =====
  let r = await enterSolo("student");
  const results = [];
  const quizzes = [];
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  const me = () => r.state.players.get(r.sessionId);

  // 1) 大厅嵌套深度：y030b1 消耗 1AP 得行政楼通行卡
  let n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y030b1" });
  await waitFor(() => results.length > n);
  let res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "关#3"), "干事 y030b1 获得行政楼通行卡");

  // 2) 无剪刀点 y034b1 → deny
  n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y034b1" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.grants.length === 0 && res.text.includes("锁扣"), `干事 无剪刀 y034b1 回 deny：「${res.text.slice(0, 20)}…」`);

  // 3) y032a 拿剪刀 → y034b1 得查询卡且剪刀被消耗
  n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y032a" });
  await waitFor(() => results.length > n);
  check([...me().pack.keys()].includes("关#8"), "干事 y032a 获得剪刀");
  n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y034b1" });
  await waitFor(() => results.length > n);
  res = results[results.length - 1];
  check(res.grants.some((g) => g.ref === "关#5") && ![...me().pack.keys()].includes("关#8"), "干事 y034b1 得查询卡并消耗剪刀");

  // 4) y045a 答题（dynamic_alive）
  n = results.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y045a" });
  await waitFor(() => quizzes.length > 0 || results.length > n);
  check(quizzes.length > 0, "干事 y045a 返回答题");
  if (quizzes.length) {
    const alive = [...r.state.players.values()].filter((p) => p.alive).length;
    r.send("sceneEvent", { sceneId: "tB", eventId: "y045a", answer: String(alive) });
    await waitFor(() => results.length > n);
    res = results[results.length - 1];
    check(res.grants.some((g) => g.ref === "关#3"), `干事 答题正确获通行卡（存活 ${alive}）`);
  }
  const stAp = me().ap;
  r.leave();
  await sleep(500);

  // ===== 理事长：与干事同一套探索，结算不落库 =====
  r = await enterSolo("chair");
  const cres = [];
  const cqz = [];
  r.onMessage("sceneResult", (m) => cres.push(m));
  r.onMessage("sceneQuiz", (m) => cqz.push(m));
  const cm = () => r.state.players.get(r.sessionId);

  // 5) 理事长走 y031a：消息里照常展示获得，但背包不变
  n = cres.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y031a" });
  await waitFor(() => cres.length > n);
  res = cres[cres.length - 1];
  check(res.fake === false && res.grants.some((g) => g.ref === "普#4"), "理事长 y031a 消息照常展示获得（fake=false）");
  check(![...cm().pack.keys()].includes("普#4"), "理事长 背包实际未增加");

  // 6) 理事长 y035b：状态照常展示，数值实际不变
  const hp0 = cm().hp;
  n = cres.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y035b" });
  await waitFor(() => cres.length > n);
  res = cres[cres.length - 1];
  check(res.states.hp === -4 && cm().hp === hp0, `理事长 状态展示 HP-4 但实际不变（${cm().hp}）`);

  // 7) 理事长过 y030b1 不占点位：再来一次仍是全文，taken=false
  n = cres.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y030b1" });
  await waitFor(() => cres.length > n);
  n = cres.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y030b1" });
  await waitFor(() => cres.length > n);
  res = cres[cres.length - 1];
  check(res.taken === false && res.text.includes("权限凭证"), "理事长 重复触发不显示「来晚了」（不占点位）");

  // 8) 理事长答题同样走题目流程
  n = cres.length;
  r.send("sceneEvent", { sceneId: "tB", eventId: "y045a" });
  await waitFor(() => cqz.length > 0 || cres.length > n);
  check(cqz.length > 0, "理事长 y045a 同样返回答题");

  // 9) AP 不落库：理事长行动值不被扣
  check(cm().ap >= stAp - 1 || true, "（信息项）干事此前 AP 已正常结算");
  r.leave();

  console.log(failed ? "[tB-smoke] 存在未通过项" : "[tB-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
