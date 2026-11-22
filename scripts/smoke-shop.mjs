// 超市 / 药房交易面板冒烟：当日价购买 / 全局库存 / 余额校验 / 使用生效 / 次日涨价
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
  const r = await client.create("game", { name: "购物", gender: "male", timeScale: 22, debug: true, solo: true, soloFaction: "student" });
  const notices = [];
  r.onMessage("notice", (m) => notices.push(m.text));
  r.send("start");
  if (!(await waitFor(() => r.state.phase !== "lobby", 8000))) throw new Error("开局失败");
  const me = () => r.state.players.get(r.sessionId);
  const noonWatcher = setInterval(() => {
    if (r.state.phase === "noon") {
      if (!me()?.lunchDone) r.send("lunch", { eat: true });
      else r.send("noonDone");
      if (r.state.day >= 1) {
        const other = [...r.state.players.keys()].find((id) => id !== r.sessionId);
        if (other) r.send("vote", { targetId: other });
      }
    }
  }, 200);
  const waitExplore = async () => waitFor(() => ["morning", "afternoon", "evening"].includes(r.state.phase), 90000, 120);
  const settle = (ms = 400) => new Promise((res) => setTimeout(res, ms));

  await waitExplore();
  r.send("debug", { give: "coins" });
  await settle();
  r.send("move", { nodeId: "market" });
  await waitFor(() => me().nodeId === "market", 8000);

  // 初始价与库存
  check(r.state.shopPrices.get("market:耗#1") === 35, "牛奶第 1 日标价 35");
  check(r.state.shopStock.get("market:耗#1") === 4, "牛奶初始库存 4");
  check(r.state.shopPrices.get("market:field:scissors") === 25, "剪刀在架（25 币）");

  // 购买牛奶：扣币入包，库存 -1
  const c0 = me().coins;
  r.send("shopBuy", { shop: "market", key: "耗#1" });
  await waitFor(() => (me().pack.get("耗#1") ?? 0) === 1, 5000);
  check(me().coins === c0 - 35, `购买扣当日价（${c0}→${me().coins}）`);
  check(r.state.shopStock.get("market:耗#1") === 3, "全局库存 -1");
  // 购买剪刀：走传统字段
  const c1 = me().coins;
  r.send("shopBuy", { shop: "market", key: "field:scissors" });
  await waitFor(() => me().scissors === 1, 5000);
  check(me().coins === c1 - 25, "剪刀扣 25 币");
  // 库存买空：补足货币再扫 3 件牛奶 → 售罄
  for (let i = 0; i < 3; i++) { r.send("debug", { give: "coins" }); await settle(250); }
  for (let i = 0; i < 3; i++) { r.send("shopBuy", { shop: "market", key: "耗#1" }); await settle(350); }
  await waitFor(() => r.state.shopStock.get("market:耗#1") === 0, 5000);
  check(r.state.shopStock.get("market:耗#1") === 0, "库存可买空");
  const c2 = me().coins, n0 = notices.length;
  r.send("shopBuy", { shop: "market", key: "耗#1" });
  await waitFor(() => notices.length > n0, 5000);
  check(/卖完了/.test(notices[notices.length - 1] ?? ""), "售罄拒绝购买");
  check(me().coins === c2, "售罄不扣币");
  // 余额不足：扣光后买贵货
  r.send("debug", { give: "coins-" }); await settle(); r.send("debug", { give: "coins-" }); await settle();
  check(me().coins < 45, `余额压至 45 以下（${me().coins}）`);
  const c3 = me().coins, n1 = notices.length;
  r.send("shopBuy", { shop: "market", key: "耗#8" }); // 巧克力 45
  await waitFor(() => notices.length > n1, 5000);
  check(/钱不够/.test(notices[notices.length - 1] ?? ""), "余额不足拒绝");
  check(me().coins === c3 && (me().pack.get("耗#8") ?? 0) === 0, "拒购不动币与包");

  // 使用牛奶：wiki 效果 饥饿+20 SAN+5（压 SAN 到 25 验证）
  r.send("debug", { give: "san20" });
  await waitFor(() => me().san === 25, 5000);
  r.send("usePack", { ref: "耗#1" });
  await waitFor(() => me().san === 30, 5000);
  check(me().san === 30, "使用牛奶 SAN +5（25→30）");
  await waitFor(() => (me().pack.get("耗#1") ?? 0) === 3, 5000);
  check((me().pack.get("耗#1") ?? 0) === 3, "消耗品用掉一件");

  // 跨店：药房买止痛药
  r.send("move", { nodeId: "clinic" });
  await waitFor(() => me().nodeId === "clinic", 8000);
  check(r.state.shopPrices.get("clinic:耗#3") === 90, "药房止痛药 90 币在架");
  r.send("debug", { give: "coins" });
  await settle();
  r.send("debug", { give: "coins" });
  await settle();
  r.send("shopBuy", { shop: "clinic", key: "耗#3" });
  await waitFor(() => (me().pack.get("耗#3") ?? 0) === 1, 5000);
  check((me().pack.get("耗#3") ?? 0) === 1, "跨店购买入包");

  // 次日涨价：第 1 日牛奶价 ≥ ceil(35×1.08)=38
  await waitFor(() => r.state.day >= 1 && ["morning", "afternoon"].includes(r.state.phase), 150000, 200);
  const p1 = r.state.shopPrices.get("market:耗#1");
  check(p1 >= 38, `第 2 日累积涨价（35→${p1}）`);
  check(r.state.shopStock.get("market:耗#1") >= 2, "次日补货");

  r.leave();
  clearInterval(noonWatcher);
  console.log(failed ? "[shop-smoke] 存在未通过项" : "[shop-smoke] 全部通过 ✓");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
