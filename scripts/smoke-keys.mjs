// 钥匙体系专项冒烟：锁判定 / 保安答题发钥匙 / 全局库存
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
  const r = await client.create("game", { name: "钥", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const results = [];
  const quizzes = [];
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  r.onMessage("role", () => {});
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) throw new Error("未进入探索时段");
  const me = () => r.state.players.get(r.sessionId);
  const noonWatcher = setInterval(() => {
    if (r.state.phase === "noon") {
      r.send("noonDone");
      if (r.state.day >= 1) {
        const other = [...r.state.players.keys()].find((id) => id !== r.sessionId);
        if (other) r.send("vote", { targetId: other });
      }
    }
  }, 200);
  const waitExplore = async () => {
    await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 100);
  };
  const settle = (ms = 800) => new Promise((res) => setTimeout(res, ms));
  const fire = async (sceneId, eventId, extra = {}) => {
    const n = results.length;
    await waitExplore(); r.send("sceneEvent", { sceneId, eventId, ...extra });
    await waitFor(() => results.length > n, 8000);
    await settle();
    return results[results.length - 1];
  };
  const hasKey = (ref) => (me().pack.get(ref) ?? 0) > 0;

  // 1) 无钥匙：社区部门门拒绝
  r.send("move", { nodeId: "community" });
  await waitFor(() => me().nodeId === "community");
  let res = await fire("community", "3");
  check(/没有一把咬得进|对不上/.test(res.text), `无钥匙开办公室被拒（deny=${res.text.slice(0, 24)}…）`);

  // 2) 无钥匙：tA 锁柜 / tB 铁皮柜拒绝
  r.send("move", { nodeId: "tA" });
  await waitFor(() => me().nodeId === "tA");
  res = await fire("tA", "y007c");
  check(/锁孔是新的|纹丝不动/.test(res.text), "无储物柜钥匙开 tA 锁柜被拒");
  r.send("move", { nodeId: "tB" });
  await waitFor(() => me().nodeId === "tB");
  res = await fire("tB", "y035c");
  check(/连晃都不晃/.test(res.text), "无钥匙开 tB 铁皮柜被拒");

  // 3) 校门保安答题（单人局=今日第 1 个）→ 获得破旧的钥匙(关#1)
  r.send("move", { nodeId: "gate" });
  await waitFor(() => me().nodeId === "gate");
  res = await fire("gate", "3"); // 红绳钥匙触发保安提问
  if (quizzes.length > 0) {
    // 提问与作答之间可能跨过中午（玩家被自动带去食堂）：回大门再作答
    r.send("move", { nodeId: "gate" });
    await waitFor(() => me().nodeId === "gate");
    res = await fire("gate", "3", { answer: "1" });
    check(res.grants.some((g) => g.ref === "关#1") && hasKey("关#1"), `保安答题答对获得破旧的钥匙（grants=${JSON.stringify(res.grants)} text=${res.text.slice(0, 20)}…）`);
  } else {
    check(false, "校门红绳事件未触发答题");
  }

  // 4) 持有关#1：社区办公室可开；但开不了储物柜（用途隔离）
  r.send("move", { nodeId: "community" });
  await waitFor(() => me().nodeId === "community");
  res = await fire("community", "3");
  check(/档案/.test(res.text) && !/咬得进|对不上/.test(res.text), "持破旧钥匙可开社区办公室");
  r.send("move", { nodeId: "tA" });
  await waitFor(() => me().nodeId === "tA");
  res = await fire("tA", "y007c");
  check(/锁孔是新的|纹丝不动/.test(res.text), "破旧钥匙开不了储物柜（用途隔离生效）");

  // 5) 全局库存：关#1 总库存 5（wiki ×5），发放后递减——重复领取同事件被 claimed 拦截
  r.send("move", { nodeId: "gate" });
  await waitFor(() => me().nodeId === "gate");
  res = await fire("gate", "3", { answer: "1" });
  check(/来晚了|什么都没有剩下/.test(res.text) || res.taken, `同事件重复领取被拦截（taken=${res.taken} text=${res.text.slice(0, 20)}…）`);

  r.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[keys-smoke] 存在未通过项" : "[keys-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
