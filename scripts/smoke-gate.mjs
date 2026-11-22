// 图书馆闸机进出记录冒烟：真实移动才记录、传送不计、仅本人可查
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
  const r = await client.create("game", { name: "闸机测试", gender: "female", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const results = [];
  r.onMessage("sceneResult", (m) => { if (m.sceneId === "library") results.push(m); });
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  const me = () => r.state.players.get(r.sessionId);
  await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 60000, 150);
  const gateResults = () => results.filter((m) => m.eventId === "__gate");

  // 1. 第一次进入图书馆 → 触发事件 21 拿操作 → 查询 → 1 条进馆
  r.send("move", { nodeId: "library" });
  if (!(await waitFor(() => me().nodeId === "library", 8000))) throw new Error("进馆失败");
  r.send("sceneEvent", { sceneId: "library", eventId: "21" });
  await waitFor(() => results.some((m) => m.eventId === "21"), 5000);
  check(results.some((m) => m.eventId === "21" && /闸机/.test(m.text)), "闸机事件 21 返回描述文本");
  const n0 = gateResults().length;
  r.send("gateLog");
  await waitFor(() => gateResults().length > n0, 5000);
  check(gateResults().some((m) => /进馆/.test(m.text)), "首次查询：进馆记录");
  check(gateResults().every((m) => !/出馆/.test(m.text)), "首次查询：无出馆记录");

  // 2. 离开再回来 → 查询应有 进/出/进 三条
  r.send("move", { nodeId: "field" });
  await waitFor(() => me().nodeId === "field", 8000);
  r.send("move", { nodeId: "library" });
  await waitFor(() => me().nodeId === "library", 8000);
  const n1 = gateResults().length;
  r.send("gateLog");
  await waitFor(() => gateResults().length > n1, 5000);
  const lines = (gateResults().at(-1)?.text ?? "");
  check(/进馆/.test(lines) && /出馆/.test(lines), "往返后查询：进/出/进齐全");
  check((lines.match(/进馆/g) ?? []).length === 2 && (lines.match(/出馆/g) ?? []).length === 1, `记录条数正确（文本：${lines.replace(/\n/g, " | ")}）`);

  // 3. noon 强制传送不计入：传送前后本人记录条数不变
  r.__allowNoonEnd = false;
  const waitNoon = async () => waitFor(() => r.state.phase === "noon", 120000, 150);
  await waitNoon();
  check(me().nodeId === "canteen", "noon 自动传送食堂");
  const n2 = gateResults().length;
  r.send("lunch", { eat: false });
  await waitFor(() => r.state.lunchOpen === false, 5000);
  r.__allowNoonEnd = true;
  r.send("noonDone");
  await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 120);
  check(me().nodeId === "library", "讨论结束回到图书馆（传送前位置）");
  const n3 = gateResults().length;
  r.send("gateLog");
  await waitFor(() => gateResults().length > n3, 5000);
  const lines2 = gateResults().at(-1)?.text ?? "";
  check((lines2.match(/进馆/g) ?? []).length === 2 && (lines2.match(/出馆/g) ?? []).length === 1, "noon 传送未产生新记录（仍 进/出/进 三条）");

  // 4. 查询须本人在馆内
  r.send("move", { nodeId: "dorm" });
  await waitFor(() => me().nodeId === "dorm", 8000);
  r.send("gateLog");
  await sleep(800);
  check(gateResults().length === n3 + 1, "身处馆外时查询被拒（无新 sceneResult）");

  r.leave();
  console.log(failed ? "\nFAILED" : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
