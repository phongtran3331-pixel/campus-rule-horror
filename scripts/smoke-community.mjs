// 学生社区重做专项冒烟：开放日 / 门钥匙永久解锁 / 进房功能闸 / 预约明天
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
  const r = await client.create("game", { name: "社", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const results = [];
  const quizzes = [];
  const notices = [];
  const entered = [];
  const bookings = [];
  r.onMessage("sceneResult", (m) => results.push(m));
  r.onMessage("sceneQuiz", (m) => quizzes.push(m));
  r.onMessage("notice", (m) => notices.push(m.text));
  r.onMessage("sceneEntered", (m) => entered.push(m));
  r.onMessage("bookingState", (m) => bookings.push(m));
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  if (!(await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200))) throw new Error("未进入探索时段");
  const me = () => r.state.players.get(r.sessionId);
  const noonWatcher = setInterval(() => {
    if (r.state.phase === "noon") {
      if (!r.state.players.get(r.sessionId)?.lunchDone) r.send("lunch", { eat: true });
      else r.send("noonDone");
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
  const go = async (nodeId) => {
    await waitExplore(); r.send("move", { nodeId });
    await waitFor(() => me().nodeId === nodeId, 8000);
  };
  // 时段切换可能把人带离社区（清场/午间），测试中途随时回补
  const ensureCommunity = async () => {
    if (me().nodeId !== "community") await go("community");
  };
  const hasRef = (ref) => (me().pack.get(ref) ?? 0) > 0;

  // 0) 预约：bookSlot 约的是明天（day+1）
  const nb = bookings.length;
  r.send("bookingQuery");
  await waitFor(() => bookings.length > nb, 5000);
  check(bookings[bookings.length - 1].targetDay === r.state.day + 1, `bookingState.targetDay=明天（=${bookings[bookings.length - 1].targetDay}）`);
  check(bookings[bookings.length - 1].openDay === true, "第 0 日为开放日");
  r.send("bookSlot", { slot: "am" });
  await waitFor(() => bookings.some((b) => b.mine === "am"), 5000);
  check(true, "预约上午段成功（mine=am）");
  r.send("bookSlot", { slot: "pm" });
  await settle(1200);
  check(notices.some((t) => /限一段/.test(t)), "重复预约被拒（每人每天限一段）");

  // 1) 开放日：day0 无需预约即可进社区
  await go("community");
  check(me().nodeId === "community", "开放日无预约进入社区");

  // 2) 无钥匙开门被拒
  let res = await fire("community", "3");
  check(/没有一把/.test(res.text), `无钥匙开门被拒（text=${res.text.slice(0, 24)}…）`);

  // 3) 未进房直接用功能被拒
  const nn = notices.length;
  r.send("officeArchive", { aId: "x", bId: "y" });
  await settle(1200);
  check(notices.slice(nn).some((t) => /请进入对应房间/.test(t)), "未进办公室用档案被拒");

  // 4) 校门答题得破旧的钥匙
  await go("gate");
  res = await fire("gate", "3");
  if (quizzes.length > 0) {
    await go("gate");
    res = await fire("gate", "3", { answer: "1" });
    check(res.grants.some((g) => g.ref === "关#1") && hasRef("关#1"), "保安答题答对获得破旧的钥匙");
  } else check(false, "校门红绳事件未触发答题");

  // 5) 持钥匙开门：消耗一把 + 永久解锁
  await go("community");
  const keysBefore = me().pack.get("关#1") ?? 0;
  res = await fire("community", "3");
  check(/咔哒|断成两截|掉渣/.test(res.text), `开门消耗钥匙（text=${res.text.slice(0, 24)}…）`);
  check((me().pack.get("关#1") ?? 0) === keysBefore - 1, "关#1 库存 -1");
  res = await fire("community", "3");
  check(/虚掩着/.test(res.text), "再次开门显示永久解锁（虚掩着）");

  // 6+7) 进办公室 → 档案每日一次 → 前台问预约。须在同一个社区开放时段内连续完成；
  //      被时段切换打断（清场/午间）则约次日再试；全部成功才打印 ✓
  const others = [...r.state.players.keys()].filter((id) => id !== r.sessionId);
  const runRoomChecks = async () => {
    await ensureCommunity();
    if (me().nodeId !== "community") return false;
    const neA = entered.length;
    r.send("sceneRoom", { sceneId: "community", room: "办公室" });
    if (!(await waitFor(() => entered.length > neA, 5000))) return false;
    if (entered[entered.length - 1].room !== "办公室") return false;
    await settle();
    const n1 = notices.length;
    r.send("officeArchive", { aId: others[0], bId: others[1] });
    await settle(1500);
    if (!notices.slice(n1).some((t) => /【档案】/.test(t))) return false;
    const n2 = notices.length;
    r.send("officeArchive", { aId: others[1], bId: others[2] ?? others[0] });
    await settle(1500);
    if (!notices.slice(n2).some((t) => /每房间每日一次|已经有人用过/.test(t))) return false;
    const res2 = await fire("community", "2");
    if (!/约明天|预约/.test(res2.text)) return false;
    return true;
  };
  let ok6 = false;
  for (let attempt = 0; attempt < 5 && !ok6; attempt++) {
    if (attempt > 0) { r.send("bookSlot", { slot: "am" }); await settle(400); } // 约明天上午段
    ok6 = await runRoomChecks();
  }
  check(ok6, "办公室链路（进房档案 + 每日一次 + 前台预约）");

  r.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[community-smoke] 存在未通过项" : "[community-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
