// 规则系统冒烟：R8 发言计数（每时段第 9 条起违规且只通报一次）、违规 30 秒保护期、
// F1 上午宿舍（移动触发 + 11:00 清场判定）、校规文本不泄露判定方法
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
const VIOL = /有学生违反了校规/;

async function main() {
  // ---- 规则文本不泄露判定方法 ----
  {
    const src = (await import("node:fs")).readFileSync(new URL("../server/src/data/rules.ts", import.meta.url), "utf8");
    const texts = [...src.matchAll(/\btext:\s*"([^"]+)"/g)].map((m) => m[1]);
    const details = [...src.matchAll(/\bdetail:\s*"([^"]+)"/g)].map((m) => m[1]);
    const LEAK = /\d+\s*(条|次|点|币)|超过|低于|高于|\d+\s*AP|记名|恰好|第\s*9|阈值|计数/;
    const leaked = texts.filter((t) => LEAK.test(t));
    check(texts.length === 20, `共 ${texts.length} 条展示文本（应 20）`);
    check(leaked.length === 0, `校规展示文本无判定方法泄露${leaked.length ? "（泄露：" + leaked.join(" / ") + "）" : ""}`);
    check(details.length === 12, `每条随机规则均有破译详解（${details.length}/12）`);
  }

  // ---- 实局：强制上板 R8（发言限制）+ R6（校门封闭） ----
  const r = await client.create("game", { name: "规则测试", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student", forceBoard: ["R8", "R6"] });
  let boardOk = false;
  r.onMessage("init", (m) => { boardOk = m.ruleBoard.some((x) => x.id === "R8") && m.ruleBoard.some((x) => x.id === "R6"); });
  const notices = [];
  r.onMessage("notice", (m) => notices.push(m.text));
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  await waitFor(() => boardOk, 5000); // init 消息与状态补丁到达顺序不保证，等待赋值
  check(boardOk, "调试房 forceBoard 强制上板 R8+R6");
  const me = () => r.state.players.get(r.sessionId);
  await waitFor(() => r.state.phase === "morning", 60000, 150);
  const violCount = () => notices.filter((t) => VIOL.test(t)).length;

  // 上午：全程待宿舍不动。前 8 条发言无违规；第 9 条起违规；第 10 条不重复通报
  check(me().nodeId === "dorm", "开局位于宿舍");
  for (let i = 1; i <= 8; i++) { r.send("chat", { text: `第${i}条` }); await sleep(120); }
  await sleep(600);
  check(violCount() === 0, `前 8 条发言无违规通报（实际 ${violCount()}）`);
  r.send("chat", { text: "第9条" });
  await waitFor(() => violCount() === 1, 5000);
  check(violCount() === 1, "第 9 条发言触发 R8 违规通报");
  r.send("chat", { text: "第10条" });
  await sleep(800);
  check(violCount() === 1, "第 10 条不重复通报（每时段一次）");

  // 11:00 清场判定：整个上午待在宿舍 → F1 违规；30 秒保护期内同规则不再触发
  await waitFor(() => r.state.phase === "noon", 120000, 150);
  check(violCount() === 2, `11:00 清场：滞留宿舍触发 F1（实际通报 ${violCount()}）`);
  check(me().nodeId === "canteen", "noon 自动传送食堂");

  // 中午门控
  r.send("lunch", { eat: false });
  await waitFor(() => r.state.lunchOpen === false, 5000);
  r.send("noonDone");
  await waitFor(() => r.state.phase === "afternoon", 90000, 120);
  check(me().nodeId === "dorm", "讨论结束返回宿舍（noon 前位置）");

  // 下午：R8 计数按时段重置；R6 校门违规 + 30 秒保护期
  for (let i = 1; i <= 8; i++) { r.send("chat", { text: `下午第${i}条` }); await sleep(120); }
  await sleep(600);
  check(violCount() === 2, "下午前 8 条发言无违规（计数已按时段重置）");
  r.send("chat", { text: "下午第9条" });
  await waitFor(() => violCount() === 3, 5000);
  check(violCount() === 3, "下午第 9 条再次触发 R8（时段独立计数）");

  r.send("move", { nodeId: "gate" });
  await waitFor(() => me().nodeId === "gate", 8000);
  await waitFor(() => violCount() === 4, 5000);
  check(violCount() === 4, "下午进校门触发 R6 违规");
  r.send("move", { nodeId: "field" });
  await waitFor(() => me().nodeId === "field", 8000);
  r.send("move", { nodeId: "gate" }); // 30 秒保护期内再进
  await waitFor(() => me().nodeId === "gate", 8000);
  await sleep(1200);
  check(violCount() === 4, "30 秒保护期内重复违规不通报");

  r.leave();
  console.log(failed ? "\nFAILED" : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
