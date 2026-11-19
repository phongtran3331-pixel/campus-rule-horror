// 探索测试沙盒冒烟：test 房即开即探 / 场景事件 / 答题 / 视角切换 / 重置 / 永不淘汰
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
  const r = await client.create("test", { name: "测试员" });
  const inbox = { quiz: [], result: [], role: null, init: null, notice: [] };
  r.onMessage("sceneQuiz", (m) => inbox.quiz.push(m));
  r.onMessage("sceneResult", (m) => inbox.result.push(m));
  r.onMessage("role", (d) => { inbox.role = d; });
  r.onMessage("init", (d) => { inbox.init = d; });
  r.onMessage("notice", (m) => inbox.notice.push(m.text));

  check(await waitFor(() => inbox.init && inbox.role), "进房即收到 init + role（无需开局）");
  check(inbox.init.nodes.length > 0 && inbox.init.ruleBoard.length > 0, `规则板已抽好（随机 ${inbox.init.ruleBoard.length} 条）`);
  check(inbox.role.faction === "student", "默认干事身份");
  check(r.state.phase === "morning", "沙盒时段 = morning（探索开放）");

  // 1) 移动到大门并触发答题事件（Y3）
  r.send("move", { nodeId: "gate" });
  check(await waitFor(() => r.state.players.get(r.sessionId).nodeId === "gate"), "移动到大门口（AP 计费正常）");
  r.send("sceneEvent", { sceneId: "gate", eventId: "3" });
  check(await waitFor(() => inbox.quiz.length > 0), "答题事件先返回题目");
  const q = inbox.quiz[0];
  r.send("sceneEvent", { sceneId: "gate", eventId: "3", answer: "1" });
  check(await waitFor(() => inbox.result.some((m) => m.eventId === "3")), "带答案提交后返回结果分支");

  // 2) 触发场景（Y8 扯头发 → 普#47）拿物品入包
  r.send("sceneEvent", { sceneId: "gate", eventId: "8" });
  check(await waitFor(() => inbox.result.some((m) => m.eventId === "8" && m.grants.length > 0), 8000), "场景事件发放物品");
  check(await waitFor(() => r.state.players.get(r.sessionId).pack.get("普#47") === 1), "物品入背包（普#47）");

  // 3) 切换理事长视角 → 假交互 + 假买不落币
  r.send("sandboxRole");
  check(await waitFor(() => inbox.role?.faction === "chair"), "切换为理事长视角");
  r.send("sceneEvent", { sceneId: "gate", eventId: "2" });
  check(await waitFor(() => inbox.result.some((m) => m.eventId === "2" && m.fake === true)), "理事长视角为假交互（fake=true）");
  r.send("move", { nodeId: "market" });
  await waitFor(() => r.state.players.get(r.sessionId).nodeId === "market");
  const coinsBefore = r.state.players.get(r.sessionId).coins;
  r.send("sceneBuy", { sceneId: "market", name: "未拆封的牛奶" });
  check(await waitFor(() => inbox.notice.some((t) => t.includes("本来也不会少")), 6000), "理事长假买回提示");
  check(r.state.players.get(r.sessionId).coins === coinsBefore, "理事长视角币值不变（假买无消耗）");

  // 4) 切回干事 → 重置 → 点位恢复
  r.send("sandboxRole");
  await waitFor(() => inbox.role?.faction === "student");
  r.send("sandboxReset");
  check(await waitFor(() => inbox.notice.some((t) => t.includes("已重置"))), "重置指令生效");
  check(await waitFor(() => r.state.players.get(r.sessionId).coins === 100), "重置后资金回满 100");

  // 5) 永不淘汰：循环「重置 → 答错压 SAN → 404 幻觉」直到触发淘汰保护
  // （幻觉 40% 概率领物并占用当日点位，所以需要多轮回放）
  let revived = false;
  for (let cycle = 0; cycle < 6 && !revived; cycle++) {
    r.send("sandboxReset");
    await waitFor(() => r.state.players.get(r.sessionId).san === 100);
    r.send("move", { nodeId: "gate" });
    await waitFor(() => r.state.players.get(r.sessionId).nodeId === "gate");
    for (let i = 0; i < 5; i++) { r.send("sceneEvent", { sceneId: "gate", eventId: "3", answer: "99" }); await sleep(280); }
    const drained = r.state.players.get(r.sessionId).san;
    if (cycle === 0) check(drained <= 30, `答错惩罚累计（SAN ${Math.round(drained)} ≤ 30）`);
    r.send("move", { nodeId: "tA" });
    await waitFor(() => r.state.players.get(r.sessionId).nodeId === "tA");
    for (let i = 0; i < 10 && !revived; i++) {
      r.send("sceneEvent", { sceneId: "tA", eventId: "__illusion" });
      await sleep(350);
      revived = inbox.notice.some((t) => t.includes("不会出局"));
    }
  }
  check(revived, "状态归零触发淘汰保护（恢复而非出局）");
  check(r.state.players.get(r.sessionId).alive === true, "测试员始终存活");
  check(await waitFor(() => r.state.players.get(r.sessionId).ap >= 2, 6000), "AP 自动回补");

  // 6) 回收站链路
  r.send("move", { nodeId: "recycle" });
  await waitFor(() => r.state.players.get(r.sessionId).nodeId === "recycle");
  r.send("packRecycle", { refs: ["普#1"] }); // 背包未必有，应回提示而非崩溃
  check(await waitFor(() => inbox.notice.some((t) => t.includes("不值钱") || t.includes("没有选中")), 6000), "回收站空选回提示（无异常）");

  await r.leave();
  console.log(failed ? "[sandbox-smoke] 存在未通过项" : "[sandbox-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
