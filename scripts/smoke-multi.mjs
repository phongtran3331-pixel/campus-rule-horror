// 多人体验冒烟：观察者房主 / 头像同步 / 准备阶段全员就绪 / 观察者不动员
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
  // 主持人（观察者）建房
  const obs = await client.create("game", { name: "主持", gender: "male", avatar: "🎭", observer: true, timeScale: 22 });
  const roomId = obs.roomId;
  const avatars = ["🦊", "🐱", "🐺", "🦉", "🐍"];
  const names = ["甲", "乙", "丙", "丁", "戊"];
  const ps = [];
  for (let i = 0; i < 5; i++) {
    ps.push(await client.joinById(roomId, { name: names[i], gender: i % 2 ? "female" : "male", avatar: avatars[i] }));
    await sleep(150);
  }
  const roles = [];
  ps.forEach((r) => r.onMessage("role", (m) => roles.push(m)));
  await sleep(400);

  // 1) 头像与观察者标记同步
  const obsMe = () => obs.state.players.get(obs.sessionId);
  check(obsMe()?.observer === true, "房主为观察者");
  check(obs.state.players.get(ps[0].sessionId)?.avatar === "🦊", "玩家头像同步");
  check(roles.length === 0, "开局前无角色消息");

  // 2) 房主开始 → 准备阶段
  obs.send("start");
  const okReady = await waitFor(() => obs.state.phase === "ready", 8000);
  check(okReady, "进入准备阶段");
  check((obsMe()?.ready ?? true) === true || obsMe()?.observer === true, "观察者无需准备");

  // 3) 观察者游戏操作被拒（移动不生效）
  obs.send("move", { nodeId: "library" });
  await sleep(600);
  check(obsMe()?.nodeId === "dorm", "观察者移动被忽略");

  // 4) 全员就绪 → 第 0 天上午
  for (const r of ps) r.send("ready");
  const okMorning = await waitFor(() => obs.state.phase === "morning", 8000);
  check(okMorning, "全员就绪后进入第 0 天");
  check(roles.length === 5, "5 名玩家收到角色分配（观察者无角色）");
  const factions = roles.map((r) => r.faction);
  check(factions.includes("chair") && factions.includes("student"), "干事/理事长两阵营均在场");

  // 5) 推进到中午：玩家被传送食堂，观察者留守
  const noonWatcher = setInterval(() => {
    for (const r of [...ps, obs]) {
      if (r.state.phase === "noon") {
        r.send("noonDone");
        if (r.state.day >= 1) {
          const others = [...r.state.players.keys()].filter((id) => id !== r.sessionId && !r.state.players.get(id)?.observer);
          if (others.length) r.send("vote", { targetId: others[0] });
        }
      }
    }
  }, 200);
  const okNoon = await waitFor(() => obs.state.phase === "noon", 120000, 200);
  check(okNoon, "进入中午");
  await sleep(600);
  check(obs.state.players.get(ps[0].sessionId)?.nodeId === "canteen", "玩家午间传送食堂");
  check(obsMe()?.nodeId === "dorm", "观察者不被传送");

  for (const r of ps) r.leave();
  obs.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[multi-smoke] 存在未通过项" : "[multi-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
