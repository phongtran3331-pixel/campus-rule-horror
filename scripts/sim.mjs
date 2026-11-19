// 平衡性沙盘：N 局加速 Bot 对局，统计阵营胜率
// 用法：node scripts/sim.mjs [局数=6] [timescale=60]
// ⚠ 局限：Bot 投票/检举完全随机，胜负手（投票推理）被随机化抹平——
// 本脚本只用于调参对比（同策略改 lootMult 前后对照），不能标定真人胜率。
// 基准结论（2026-11-18）：随机行为下理事长 ~0 胜，真人局平衡点以 docs/沙盘推演报告.md 为准（lootMult=1.5）。
// Bot 策略刻意简单（干事：探索/进食/回宿舍/随机移动；理事长：随机检举/随机换规/随机投票），
// 胜率只看相对偏差：明显偏离 55% 才调物资丰度（lootMult），方向参考 docs/沙盘推演报告.md
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAMES = Number(process.argv[2] ?? 6);
const SCALE = Number(process.argv[3] ?? 60);
const PLAYERS = 9; // 9 人局：3 理事长（正式配置）

const waitFor = async (fn, t = 30000, s = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { if (fn()) return true; await sleep(s); }
  return false;
};
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const aliveOthers = (st, meId) => [...st.players.entries()].filter(([id, q]) => q.alive && id !== meId).map(([id]) => id);
const STUDENT_NODES = ["tA", "tB", "tC", "library", "gym", "field", "woods", "market", "admin", "community", "recycle"];

async function playOne(gameIdx) {
  const host = await client.create("game", { name: `G${gameIdx}P1`, gender: "male", timeScale: SCALE, debug: true });
  const rooms = [host];
  for (let i = 2; i <= PLAYERS; i++) rooms.push(await client.joinById(host.roomId, { name: `G${gameIdx}P${i}`, gender: i % 2 ? "female" : "male" }));

  const roles = {};
  let over = null;
  const boards = {};
  for (const r of rooms) {
    r.onMessage("role", (d) => roles[r.sessionId] = d);
    r.onMessage("gameover", (d) => over = d);
    r.onMessage("ruleSwap", (d) => boards[r.sessionId] = d.board);
  }
  host.send("start");
  if (!(await waitFor(() => Object.keys(roles).length === PLAYERS && host.state.phase !== "lobby", 15000))) {
    console.log(`  局${gameIdx}: 开局失败`); for (const r of rooms) r.leave(); return null;
  }

  let done = false;
  over = null;
  const tick = setInterval(() => {
    if (over) { clearInterval(tick); done = true; return; }
    const phase = host.state.phase;
    for (const r of rooms) {
      const me = r.state.players.get(r.sessionId);
      if (!me || !me.alive) continue;
      const isChair = roles[r.sessionId]?.faction === "chair";
      try {
        if (phase === "morning" || phase === "afternoon" || phase === "evening") {
          if (isChair) {
            if (Math.random() < 0.35) r.send("move", { nodeId: rnd(STUDENT_NODES) });
            if (Math.random() < 0.25) r.send("sceneEvent", { sceneId: me.nodeId, eventId: String(1 + Math.floor(Math.random() * 5)) });
          } else {
            const roll = Math.random();
            if (roll < 0.3) r.send("explore");
            else if (roll < 0.4 && me.nodeId !== "dorm") r.send("move", { nodeId: "dorm" });
            else if (roll < 0.55) r.send("move", { nodeId: rnd(STUDENT_NODES) });
            else if (roll < 0.65 && me.nodeId === "market") r.send("buy", { item: "food" });
            else if (roll < 0.75) r.send("sceneEvent", { sceneId: me.nodeId, eventId: String(1 + Math.floor(Math.random() * 5)) });
            else if (me.hunger < 45) r.send("eat", { nodeId: me.nodeId });
          }
        }
        if (phase === "noon") {
          // 讨论不计时：第 0 日全员确认，之后每日全员投票，时间才跳入 14:00
          if (host.state.day === 0) r.send("noonDone");
          else { const t = rnd(aliveOthers(r.state, r.sessionId)); if (t) r.send("vote", { targetId: t }); }
        }
        if (phase === "night" && isChair && Math.random() < 0.6) {
          const t = rnd(aliveOthers(r.state, r.sessionId));
          if (t) r.send("accuse", { targetId: t });
          const board = boards[r.sessionId] ?? [];
          if (board.length && Math.random() < 0.4) {
            const pool = roles[r.sessionId]?.pool ?? [];
            if (pool.length) r.send("swapRule", { outId: rnd(board).id, inId: rnd(pool).id });
          }
        }
      } catch { /* 房间可能已销毁 */ }
    }
  }, 800);

  await waitFor(() => over, 600000, 500);
  clearInterval(tick);
  for (const r of rooms) { try { r.leave(); } catch { /* noop */ } }
  return over;
}

async function main() {
  const stats = { chair: 0, student: 0, null: 0 };
  for (let g = 1; g <= GAMES; g++) {
    const over = await playOne(g);
    if (!over) { stats.null++; console.log(`  局${g}: 超时/异常`); continue; }
    stats[over.winner]++;
    console.log(`  局${g}: ${over.winner === "chair" ? "理事长" : "干事"}胜 — ${over.detail}`);
  }
  const total = stats.chair + stats.student;
  console.log(`\n[sim] ${GAMES} 局完成：理事长 ${stats.chair} 胜 / 干事 ${stats.student} 胜 / 异常 ${stats.null}`);
  if (total > 0) console.log(`[sim] 理事长胜率 ${(stats.chair / total * 100).toFixed(0)}%（目标 ~55%）`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
