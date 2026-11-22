// 回收站实装冒烟：wiki 口径回收 / 拒收 / 批量 SAN / 事件 AP
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
  const r = await client.create("game", { name: "收", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const notices = [];
  const results = [];
  r.onMessage("notice", (m) => notices.push(m.text));
  r.onMessage("sceneResult", (m) => results.push(m));
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
  const waitExplore = async () => waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 100);
  const settle = (ms = 900) => new Promise((res) => setTimeout(res, ms));

  // 备货：普#1(3币) 高#3(150币) 耗#1(拒) 关#1(拒) 关#4 咖啡券(40币)
  for (const g of ["pack:普#1", "pack:高#3", "pack:耗#1", "pack:关#1", "pack:关#4"]) { r.send("debug", { give: g }); await settle(250); }
  check((me().pack.get("普#1") ?? 0) === 1 && (me().pack.get("关#4") ?? 0) === 1, "备货入包");

  await waitExplore();
  r.send("move", { nodeId: "recycle" });
  await waitFor(() => me().nodeId === "recycle", 8000);

  // 1) 混合回收：普/高/咖啡券成交，耗与关键道具退回
  const coins0 = me().coins;
  const n0 = notices.length;
  r.send("packRecycle", { refs: ["普#1", "高#3", "耗#1", "关#1", "关#4"] });
  await waitFor(() => notices.length > n0, 5000);
  const got = notices[notices.length - 1];
  check(me().coins - coins0 === 3 + 150 + 40, `按 wiki 价值成交（+${me().coins - coins0} 币）`);
  check(/未拆封的牛奶|破旧的钥匙/.test(got), `拒收消耗品与关键道具（${got.slice(0, 40)}…）`);
  check((me().pack.get("普#1") ?? 0) === 0 && (me().pack.get("高#3") ?? 0) === 0 && (me().pack.get("关#4") ?? 0) === 0, "成交品已出包");
  check((me().pack.get("耗#1") ?? 0) === 1 && (me().pack.get("关#1") ?? 0) === 1, "拒收件留在背包");

  // 2) 批量 >5 件：SAN 惩罚
  for (let i = 0; i < 6; i++) { r.send("debug", { give: "pack:普#2" }); await settle(200); }
  const san0 = me().san;
  const n1 = notices.length;
  r.send("packRecycle", { refs: ["普#2", "普#2", "普#2", "普#2", "普#2", "普#2"] });
  await waitFor(() => notices.length > n1, 5000);
  check(me().san < san0, `批量回收 SAN 下降（${san0}→${me().san}）`);
  check((me().pack.get("普#2") ?? 0) === 0, "批量件已出包");

  // 3) 场景事件进入消耗 AP：回收站「看价目屏」-1
  const ap0 = me().ap;
  const nr = results.length;
  r.send("sceneEvent", { sceneId: "recycle", eventId: "2" });
  await waitFor(() => results.length > nr, 5000);
  check(me().ap === ap0 - 1, `事件进入 -1 AP（${ap0}→${me().ap}）`);

  r.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[recycle-smoke] 存在未通过项" : "[recycle-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
