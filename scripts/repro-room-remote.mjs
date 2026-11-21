// 复现：大厅房间卡片 sceneRoom 点击无响应
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("colyseus.js");
const client = new Client("ws://192.144.254.107:2567");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000, step = 60) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step); }
  return false;
};
async function main() {
  const r = await client.create("game", { name: "测", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  r.onMessage("sceneEntered", (m) => console.log("sceneEntered:", JSON.stringify(m)));
  r.onMessage("notice", (m) => console.log("notice:", m.text ?? m));
  r.send("start");
  await waitFor(() => r.state.phase !== "lobby");
  console.log("phase:", r.state.phase);
  await waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 120000, 200);
  console.log("explore phase:", r.state.phase, "AP:", r.state.players.get(r.sessionId).ap);
  r.send("move", { nodeId: "gym" });
  await waitFor(() => r.state.players.get(r.sessionId).nodeId === "gym");
  console.log("nodeId:", r.state.players.get(r.sessionId).nodeId);
  r.send("sceneRoom", { sceneId: "gym", room: "羽毛球场" });
  await sleep(3000);
  console.log("done waiting");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
