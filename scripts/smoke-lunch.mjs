// 食堂午餐结算冒烟：用餐扣币/饥饿恢复/结算一次/午间传送与回位/贫困拒绝必扣 SAN
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

async function join(name) {
  const r = await client.create("game", { name, gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const notices = [];
  r.onMessage("notice", (m) => notices.push(m.text));
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  const watcher = setInterval(() => {
    if (r.state.phase === "noon" && r.__allowNoonEnd) {
      r.send("noonDone");
      if (r.state.day >= 1) {
        const other = [...r.state.players.keys()].find((id) => id !== r.sessionId);
        if (other) r.send("vote", { targetId: other });
      }
    }
  }, 200);
  r.__watcher = watcher;
  return { r, notices };
}
const me = (r) => r.state.players.get(r.sessionId);
const waitNoon = async (r) => waitFor(() => r.state.phase === "noon", 120000, 150);
const waitExplore = async (r) => waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 120);

async function roomA() {
  // 路径一：用餐扣币 + 饥饿恢复 + 结算一次 + 传送/回位
  const { r, notices } = await join("午餐甲");
  r.__allowNoonEnd = false; // 先手动控制 noon 结束
  await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200);
  r.send("move", { nodeId: "library" });
  await waitFor(() => me(r).nodeId === "library", 8000);

  await waitNoon(r);
  check(me(r).nodeId === "canteen", "noon 开始自动传送食堂");
  check(r.state.lunchOpen === true, "noon 开始即进入午餐询问（lunchOpen）");
  // 讨论未开放：noonDone 被门控拒绝
  r.send("noonDone");
  await sleep(600);
  check(r.state.phase === "noon" && r.state.lunchOpen === true, "全员选完前讨论不开放");
  const coins0 = me(r).coins, hunger0 = me(r).hunger, n0 = notices.length;
  r.send("lunch", { eat: true });
  await waitFor(() => notices.length > n0, 5000);
  await waitFor(() => r.state.lunchOpen === false, 5000);
  check(r.state.lunchOpen === false, "全员选完午餐后开放讨论");
  check(notices.slice(n0).some((t) => /午餐下肚/.test(t)), "收到个人午餐结算通知");
  await waitFor(() => me(r).coins === coins0 - 10, 5000);
  check(me(r).coins === coins0 - 10, `用餐扣 10 币（${coins0}→${me(r).coins}）`);
  check(me(r).hunger === Math.min(100, hunger0 + 40), `第 0 日饥饿封顶 100（${hunger0}→${me(r).hunger}）`);
  // 结算不重复
  r.send("lunch", { eat: true });
  await sleep(800);
  check(me(r).coins === coins0 - 10, "重复结算被拒（币不再扣）");

  r.__allowNoonEnd = true;
  r.send("noonDone");
  await waitExplore(r);
  check(me(r).nodeId === "library", "讨论结束返回 noon 前位置（图书馆）");

  // 第 1 日：饥饿已随探索时段实时累计扣除（无隔夜统一结算）
  r.__allowNoonEnd = false; // 抢先关掉 watcher，避免第 1 日 noon 被立即收束
  await waitNoon(r);
  const h1 = me(r).hunger, c1 = me(r).coins, n1 = notices.length;
  check(h1 > 0 && h1 < 90, `饥饿已按探索时段实时累计扣除（${h1}）`);
  r.send("lunch", { eat: true });
  await waitFor(() => notices.length > n1, 5000);
  await waitFor(() => me(r).coins === c1 - 10, 5000);
  check(me(r).coins === c1 - 10, "次日用餐再扣 10 币");
  const gain = me(r).hunger - h1;
  check(gain >= 20 && gain <= 40, `饥饿 +20~40（实际 +${gain}）`);
  r.leave();
  clearInterval(r.__watcher);
}

async function roomB() {
  // 路径二：余额 <10 拒绝午餐 → SAN 必降、不扣币
  const { r, notices } = await join("午餐乙");
  r.__allowNoonEnd = false;
  await waitNoon(r);
  r.send("debug", { give: "coins-" });
  await waitFor(() => me(r).coins < 10, 5000);
  check(me(r).coins < 10, `余额压至 10 以下（${me(r).coins}）`);
  const san0 = me(r).san, coins0 = me(r).coins, n0 = notices.length;
  r.send("lunch", { eat: false });
  await waitFor(() => notices.length > n0, 5000);
  await waitFor(() => r.state.lunchOpen === false, 5000);
  check(r.state.lunchOpen === false, "拒绝午餐同样计入全员选择");
  await waitFor(() => me(r).san < san0, 5000);
  check(me(r).san < san0, `贫困拒绝 SAN 下降（${san0}→${me(r).san}）`);
  check(me(r).coins === coins0, "拒绝不扣币");
  // 贫困状态下尝试用餐：被拒且不结算
  r.send("lunch", { eat: true });
  await sleep(800);
  check(me(r).coins === coins0, "余额不足无法用餐（不扣币）");
  r.leave();
  clearInterval(r.__watcher);
}

async function main() {
  await roomA();
  await roomB();
  console.log(failed ? "[lunch-smoke] 存在未通过项" : "[lunch-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
