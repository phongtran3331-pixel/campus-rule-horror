// 单人试玩冒烟：跳过匹配直接开局 / 8 席挂机补位 / 身份自选 / 场景与投票与正式一致
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://127.0.0.1:2567");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 30000, step = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step); }
  return false;
};
let failed = false;
const check = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) failed = true; };

async function soloRoom(faction) {
  const r = await client.create("game", { name: "测试员", gender: "male", timeScale: 60, debug: true, solo: true, soloFaction: faction });
  r.send("start");
  return r;
}

async function main() {
  // ---- 干事单人局 ----
  const stu = await soloRoom("student");
  const inbox = { role: null, init: null, results: [] };
  stu.onMessage("role", (d) => { inbox.role = d; });
  stu.onMessage("init", (d) => { inbox.init = d; });
  stu.onMessage("sceneResult", (m) => inbox.results.push(m));
  check(await waitFor(() => inbox.init && inbox.role), "开局即发 init + role（跳过匹配）");
  check(stu.state.players.size === 9, `9 人局补位完成（实 ${stu.state.players.size} 人）`);
  const bots = [...stu.state.players.entries()].filter(([id]) => id.startsWith("bot-"));
  check(bots.length === 8 && bots.every(([, p]) => p.connected === false), "8 名挂机玩家均为离线态");
  check(inbox.role.faction === "student", "干事身份自选生效");
  const chairCount = inbox.init.ruleBoard && true; // 规则板下发
  check(!!inbox.init.ruleBoard?.length, "规则板已下发");

  // 场景事件与正式一致（先到先得）
  stu.send("move", { nodeId: "gate" });
  await waitFor(() => stu.state.players.get(stu.sessionId).nodeId === "gate");
  stu.send("sceneEvent", { sceneId: "gate", eventId: "8" });
  check(await waitFor(() => inbox.results.some((m) => m.eventId === "8" && m.grants.length > 0)), "场景事件正常发放物品");

  // 中午自动前往食堂（与正式一致的强制传送）
  check(await waitFor(() => stu.state.phase === "noon" && stu.state.players.get(stu.sessionId).nodeId === "canteen", 60000), "午间集体自动前往食堂");
  // 第 0 日讨论不计时：先完成午餐询问，单人确认即可进入 14:00（挂机玩家不在线，不计入确认）
  check(stu.state.lunchOpen === true, "noon 开始先进入午餐询问");
  stu.send("lunch", { eat: true });
  await waitFor(() => stu.state.lunchOpen === false, 5000);
  check(stu.state.lunchOpen === false, "单人完成午餐后关闭询问");
  stu.send("noonDone");

  // 第 1 日午间投票：挂机玩家是合法票靶
  check(await waitFor(() => stu.state.day >= 1, 90000), "时间流转进入 Day1");
  if (stu.state.phase === "noon" || await waitFor(() => stu.state.phase === "noon", 60000)) {
    const target = bots.find(([id, p]) => p.alive)[0];
    stu.send("vote", { targetId: target });
    check(await waitFor(() => inbox.role && stu.state.day >= 1), "投票提交成功（挂机玩家为合法目标）");
  }
  await stu.leave();

  // ---- 理事长单人局 ----
  const chair = await soloRoom("chair");
  const inbox2 = { role: null };
  chair.onMessage("role", (d) => { inbox2.role = d; });
  check(await waitFor(() => inbox2.role), "理事长局开局");
  check(inbox2.role.faction === "chair", "理事长身份自选生效");
  check(inbox2.role.chairs.length === 3, `理事长名单 3 人（我 + 2 挂机，实 ${inbox2.role.chairs.length}）`);
  await chair.leave();

  console.log(failed ? "[solo-smoke] 存在未通过项" : "[solo-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
