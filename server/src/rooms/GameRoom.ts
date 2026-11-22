import { Room, Client } from "colyseus";
import { GameState, Player, type Faction } from "../schema/GameState.js";
import { EDGES, NODES, nodeDistance } from "../data/map.js";
import { FIXED_RULES, drawRuleBoard, type Rule } from "../data/rules.js";
import { PhaseTimer, PHASE_ORDER, type Phase } from "../logic/PhaseTimer.js";
import {
  INSTANT_PENALTY,
  checkAction,
  newDayRecord,
  phaseEndViolations,
  type Action,
  type DayRecord,
  type EngineCtx,
} from "../logic/RuleEngine.js";
import { PRICES, rollLoot } from "../data/loot.js";
import { exploreText, FOOD_NAMES, JUNK_NAMES, MEDICINE_NAMES, NPC, pick } from "../data/flavor.js";
import { ITEM_CATALOG, rollTreasure } from "../data/items.js";
import { loadScenes, loadWiki, loadShop, refToName, parseEvent, parseQuizBranch, type SceneData, type StateDelta } from "../logic/SceneEngine.js";
import { loadShops, goodsKey, nextPrice, SHOP_NODE, SHOP_STOCK_INIT, SHOP_STOCK_MAX, SHOP_RESTOCK, type ShopKey } from "../data/shop.js";

export interface JoinOptions {
  name?: string;
  gender?: string;
  avatar?: string; // 头像：emoji 或图片 dataURL
  observer?: boolean; // 主持人：创建房间但不参战
  timeScale?: number;
  debug?: boolean; // 调试房：房主可无视人数直接开局
  solo?: boolean;        // 单人试玩：跳过匹配直接开局，空位由挂机玩家补齐
  soloFaction?: "student" | "chair"; // 单人试玩自选身份
  forceBoard?: string[]; // 仅调试房：强制上板的随机规则 id（便于规则测试，正式局忽略）
}

const DAY_TOTAL = 4; // 0..4，Day4 中午终投后直接结算

const ROOM_NAMES: Record<string, string> = {
  key_office: "办公室",
  key_dept: "社区部",
  key_cce: "策创部",
};

export class GameRoom extends Room<GameState> {
  maxClients = 12; // 9–12 人局
  private timer!: PhaseTimer;
  private timeScale = 1;
  private debugMode = false; // 调试房：房主可直接开局
  private soloFaction: Faction | null = null; // 单人试玩身份（null = 正常对局）
  private forceBoard: string[] | null = null;   // 调试房强制上板规则 id

  // ---------- 服务端私有数据（规则引擎状态，均不同步） ----------
  private factionOf = new Map<string, Faction>();          // 阵营（机密）
  private recs = new Map<string, DayRecord>();             // 每人当日行为记录
  // 违规保护期：同一玩家对同一条规则违规后 30 秒内不再重复判（避免连续触发卡死/刷弹药）
  private violCooldown = new Map<string, number>();        // key = `${id}:${ruleId}` → 上次违规时间戳
  private prevNode = new Map<string, string>();            // 每人上一节点（R2）
  // 图书馆闸机：实际通行日志（enter/leave 独立记录，永久保留，不可篡改；传送不计）
  private gateLog: Array<{ id: string; day: number; action: "enter" | "leave"; t: string; seq: number }> = [];
  private gateSeq = 0;
  // 饥饿实时结算：8:00–11:00 / 14:00–21:00（早/下午/晚探索时段）按游戏小时 5.4 点持续扣除，每日合计 54
  private hungerTimer: ReturnType<typeof setInterval> | null = null;
  private hungerLast = 0;
  private votes = new Map<string, string>();               // 当前午间投票 voterId -> targetId
  private board: Rule[] = [];                              // 板上随机规则（可被换走）
  private pool: Rule[] = [];                               // 备选池（理事长换规来源）
  private todayViolationEvents = 0;                        // 今日干事违规事件数 = 夜间检举弹药数
  private accuse = { attempts: 0, failures: 0, swapped: false }; // 夜间检举状态（每晚重置）
  private callTargets = new Set<string>();                 // 今夜被呼唤的学生（F7）
  // M3：社区预约（key=day）与房间每日使用记录（共享，每房间每天一次）
  private bookings = new Map<number, { am: string[]; pm: string[] }>();
  private communityDoors = new Map<string, boolean>();     // 四部门门：破旧的钥匙一次性消耗，全局永久解锁
  private static readonly DEPT_ROOMS = ["办公室", "社区部", "策创部", "宣传部"];
  private static readonly DOOR_EVENTS: Record<string, string> = { "3": "办公室", "5": "社区部", "7": "策创部", "9": "宣传部" };
  private roomUsed = new Set<string>();
  // M4：网络中心 / 设施日志 / 表彰与担保
  private netTimer?: NodeJS.Timeout;                       // 断网自动恢复
  private facilityLog: Array<{ facility: string; day: number; phase: string; label: string }> = [];
  private commend: { id: string; day: number } | null = null;  // 三好学生表彰
  private guarantee = new Map<string, string>();           // targetId -> guarantorId（当日匿名担保）
  private pendingApBonus = new Set<string>();              // 表彰兑现：次日 AP 30
  // M5：交互文本库——子房间位置追踪（仅叙事用，不进同步状态）
  private subroom = new Map<string, string>();             // sessionId -> "<nodeId>:<房号>"
  // M6：真实场景文本——服务端只判状态与编号，文案客户端渲染
  private scenes: Record<string, SceneData> = loadScenes();
  private wiki = loadWiki();
  private shop = loadShop(this.wiki, this.scenes);
  private shops = loadShops();
  private refName = refToName(this.wiki);
  // 关段物品 wiki 无编号，按条目顺序补 关#1..N 映射（与 keyStock 同一口径）
  private segRefName = (() => {
    const m = new Map<string, string>();
    const seq: Record<string, number> = {};
    for (const [name, w] of Object.entries(this.wiki)) {
      if (w.num != null) continue;
      const n = (seq[w.seg] = (seq[w.seg] ?? 0) + 1);
      m.set(`${w.seg}#${n}`, name);
    }
    return m;
  })();
  private nameOfRef = (ref: string): string | undefined => this.refName.get(ref) ?? this.segRefName.get(ref);
  private claimed = new Set<string>();                     // 先到先得："sceneId:eventId"（全局一次性）
  // 关键物品全局库存：按 Wiki 编号序（与 refToName 同序）从 count "×N" 解析，"若干" 视为无限
  private keyStock = (() => {
    const stock = new Map<string, number>();
    const seq: Record<string, number> = {};
    for (const [name, w] of Object.entries(this.wiki)) {
      if (w.seg !== "关") continue;
      const n = (seq[w.seg] = (seq[w.seg] ?? 0) + 1);
      const m = /^×(\d+)/.exec(w.count ?? "");
      stock.set(`关#${n}`, m ? parseInt(m[1], 10) : Infinity);
    }
    return stock;
  })();
  private visits = new Map<string, Set<string>>();           // dynamic_visit：本日各节点到访去重集合
  private recycleBatch = new Map<string, number>();          // 回收站：本日累计捡拾件数（每日重置）
  private noonDone = new Set<string>();                      // 午间确认：在线存活者全员确认/投票后跳入 14:00

  onCreate(options: JoinOptions) {
    this.setState(new GameState());
    // 商店初始价与全局库存（第 1 日 = 标价）
    for (const [shop, def] of Object.entries(this.shops)) {
      for (const g of def.goods) {
        this.state.shopPrices.set(`${shop}:${goodsKey(g)}`, g.base);
        this.state.shopStock.set(`${shop}:${goodsKey(g)}`, SHOP_STOCK_INIT);
      }
    }
    this.timeScale = options.timeScale ?? 1;
    this.debugMode = !!options.debug;
    if (Array.isArray(options.forceBoard)) this.forceBoard = options.forceBoard.map(String);
    if (options.solo && (options.soloFaction === "chair" || options.soloFaction === "student")) {
      this.soloFaction = options.soloFaction;
      this.debugMode = true; // 单人必为调试房：允许直接开局
    }
    this.timer = new PhaseTimer(this.timeScale);

    this.onMessage("start", (client) => this.startGame(client));
    this.onMessage("chat", (client, msg: { text?: string }) => this.onChat(client, msg));
    this.onMessage("move", (client, msg: { nodeId?: string }) => this.onMove(client, msg));
    // M2 动作：全部走规则引擎判定（理事长免疫校规）
    this.onMessage("eat", (client, msg: { nodeId?: string }) => this.onAction(client, { type: "eat", nodeId: String(msg?.nodeId ?? "") }));
    this.onMessage("brawl", (client, msg: { nodeId?: string }) => this.onAction(client, { type: "brawl", nodeId: String(msg?.nodeId ?? "") }));
    this.onMessage("enterRoom", (client, msg: { roomId?: string }) => this.onAction(client, { type: "enterRoom", roomId: String(msg?.roomId ?? "") }));
    this.onMessage("exercise", (client) => this.onAction(client, { type: "exercise" }));
    this.onMessage("medicine", (client) => this.onAction(client, { type: "medicine" }));
    this.onMessage("doorplate", (client) => this.onAction(client, { type: "doorplate" }));
    this.onMessage("respondCall", (client) => this.onAction(client, { type: "respondCall" }));
    this.onMessage("talkRed", (client) => this.onAction(client, { type: "talkRed" }));
    // M2 流程：投票 / 检举 / 换规 / 午间确认
    this.onMessage("vote", (client, msg: { targetId?: string }) => this.onVote(client, msg));
    this.onMessage("noonDone", (client) => this.onNoonDone(client));
    // 食堂午餐结算（noon 期间随时可选，不阻塞讨论）
    this.onMessage("lunch", (client, msg: { eat?: boolean }) => this.onLunch(client, msg));
    // 开局准备阶段：就绪确认
    this.onMessage("ready", (client) => this.onReady(client));
    this.onMessage("accuse", (client, msg: { targetId?: string }) => this.onAccuse(client, msg));
    this.onMessage("swapRule", (client, msg: { outId?: string; inId?: string }) => this.onSwapRule(client, msg));
    // M3：探索 / 交易 / 生存
    this.onMessage("explore", (client) => this.onExplore(client));
    // M6：场景文本事件（含答题与先到先得结算）
    this.onMessage("sceneEvent", (client, msg: { sceneId?: string; eventId?: string; answer?: string }) => this.onSceneEvent(client, msg));
    // M6：进入场景内房间（干事 -1 AP，理事长免费）
    this.onMessage("sceneRoom", (client, msg: { sceneId?: string; room?: string }) => this.onSceneRoom(client, msg));
    // M6：背包交互——购买（货表来自场景文案）/ 回收站选物变现 / 使用消耗品
    this.onMessage("sceneBuy", (client, msg: { sceneId?: string; name?: string }) => this.onSceneBuy(client, msg));
    this.onMessage("packRecycle", (client, msg: { refs?: string[] }) => this.onPackRecycle(client, msg));
    this.onMessage("packDrop", (client, msg: { refs?: string[] }) => this.onPackDrop(client, msg));
    this.onMessage("usePack", (client, msg: { ref?: string }) => this.onUsePack(client, msg));
    this.onMessage("buyMedicine", (client) => this.onBuyMedicine(client));
    this.onMessage("useMedicine", (client, msg: { kind?: string }) => this.onUseMedicine(client, msg));
    // 超市 / 药房交易面板（shop.json 货表 + 每日涨价 + 全局库存）
    this.onMessage("shopBuy", (client, msg: { shop?: string; key?: string }) => this.onShopBuy(client, msg));
    this.onMessage("gateLog", (client) => this.onGateLog(client));
    this.onMessage("recycle", (client) => this.onRecycle(client));
    // M3：学生社区（预约制 + 四房间）
    this.onMessage("bookSlot", (client, msg: { slot?: string }) => this.onBookSlot(client, msg));
    this.onMessage("bookingQuery", (client) => this.onBookingQuery(client));
    this.onMessage("officeArchive", (client, msg: { aId?: string; bId?: string }) => this.onOfficeArchive(client, msg));
    this.onMessage("deptBookings", (client) => this.onDeptBookings(client));
    this.onMessage("cceErase", (client, msg: { ruleId?: string }) => this.onCceErase(client, msg));
    this.onMessage("cafe", (client, msg: { kind?: string }) => this.onCafe(client, msg));
    // M4：信息战——网络中心 / 行政楼影像室 / 宣传部校园墙 / 私聊转账
    this.onMessage("cutNet", (client) => this.onCutNet(client));
    this.onMessage("repairNet", (client) => this.onRepairNet(client));
    this.onMessage("camera", (client) => this.onCamera(client));
    this.onMessage("inspectLog", (client, msg: { facility?: string }) => this.onInspectLog(client, msg));
    this.onMessage("press", (client, msg: { action?: string; targetId?: string; kind?: string }) => this.onPress(client, msg));
    this.onMessage("dm", (client, msg: { targetId?: string; text?: string; coins?: number }) => this.onDm(client, msg));
    // 调试（仅加速测试局可用，正式局 timeScale=1 时注册被跳过）
    if (this.timeScale > 1) {
      this.onMessage("debug", (client, msg: { give?: string }) => this.onDebug(client, msg));
    }
  }

  onJoin(client: Client, options: JoinOptions) {
    // 对局进行中：仅允许重连（sessionId 已有角色）；新来访者直接请出
    if (this.state.phase !== "lobby") {
      if (!this.state.players.has(client.sessionId)) {
        this.sendNoticeTo(client.sessionId, "对局进行中，无法中途加入。");
        client.leave();
        return;
      }
      const old = this.state.players.get(client.sessionId)!;
      old.connected = true;
      this.broadcast("notice", { text: `${old.name} 重新连线` });
      return;
    }
    const p = new Player();
    p.name = String(options.name || `同学${this.state.players.size + 1}`).slice(0, 12);
    p.gender = options.gender === "female" ? "female" : "male";
    p.avatar = String(options.avatar ?? "").slice(0, 120_000); // dataURL 头像（canvas 已压到 96px）
    p.observer = !!options.observer && this.state.players.size === 0 && !this.soloFaction; // 仅首位进房者可任主持人，且单人试玩不可
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.broadcast("notice", { text: `${p.name}${p.observer ? "（主持人）" : ""} 进入了校园（${this.state.players.size} 人在线）` });
  }

  onLeave(client: Client, consented?: boolean) {
    const p = this.state.players.get(client.sessionId);
    if (this.state.phase === "lobby") {
      this.state.players.delete(client.sessionId);
      this.factionOf.delete(client.sessionId);
      if (this.state.hostId === client.sessionId) {
        this.state.hostId = this.state.players.keys().next().value ?? "";
      }
    } else if (p) {
      p.connected = false; // 游戏中掉线保留角色
      this.maybeEndLunch(); // 掉线者不再阻塞午餐询问
      // 非主动离开（掉线/刷新）给 120 秒重连窗口，重连即恢复原角色
      if (!consented && p.alive) {
        this.allowReconnection(client, 120)
          .then(() => {
            const cur = this.state.players.get(client.sessionId);
            if (cur && !cur.connected) {
              cur.connected = true;
              this.broadcast("notice", { text: `${cur.name} 重新连线` });
            }
          })
          .catch(() => { /* 超时未归，角色保留但离线 */ });
      }
    }
  }

  onDispose() {
    this.timer.stop();
    if (this.netTimer) clearTimeout(this.netTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.hungerTimer) clearInterval(this.hungerTimer);
  }

  /** 虚拟时刻（与客户端 vtime 同口径，闸机日志用） */
  private vtimeNow(): string {
    const W: Record<string, [number, number]> = {
      morning: [8, 11], noon: [11, 14], afternoon: [14, 17], evening: [17, 21], night: [21, 23],
    };
    if (this.state.phase === "noon") return "11:00"; // 讨论时段停止计时
    const w = W[this.state.phase];
    if (!w || !this.state.phaseStartedAt || !this.state.phaseEndsAt || this.state.phaseEndsAt <= this.state.phaseStartedAt) return "--:--";
    const ratio = Math.min(1, Math.max(0, (Date.now() - this.state.phaseStartedAt) / (this.state.phaseEndsAt - this.state.phaseStartedAt)));
    const t = w[0] + (w[1] - w[0]) * ratio;
    const hh = Math.floor(t);
    const mm = t - hh >= 0.5 ? "30" : "00";
    return `${String(hh).padStart(2, "0")}:${mm}`;
  }

  /** 饥饿实时结算：探索时段（8–11、14–21）每游戏小时 -5.4，每日合计 -54；<40 缓慢掉 SAN，<20 缓慢掉 HP */
  private startHungerClock() {
    this.hungerLast = Date.now();
    this.hungerTimer = setInterval(() => this.tickHunger(), 1000);
  }

  private tickHunger() {
    const now = Date.now();
    const dt = (now - this.hungerLast) / 1000;
    this.hungerLast = now;
    if (this.state.phase === "ended") return;
    if (this.state.phase !== "morning" && this.state.phase !== "afternoon" && this.state.phase !== "evening") return;
    const gh = (dt * this.timeScale) / 60; // 本秒经过的游戏小时数
    const dead: Array<[string, string]> = [];
    this.state.players.forEach((p, id) => {
      if (!p.alive || p.observer || this.factionOf.get(id) === "chair") return;
      p.hunger = Math.max(0, p.hunger - 5.4 * gh);
      if (p.hunger <= 0) { dead.push([id, "饥饿归零"]); return; }
      if (p.hunger < 20) p.hp = Math.max(0, p.hp - 1.2 * gh);
      else if (p.hunger < 40) p.san = Math.max(0, p.san - 0.6 * gh);
      if (p.hp <= 0) dead.push([id, "伤重不治"]);
      else if (p.san <= 0) dead.push([id, "精神崩溃"]);
    });
    dead.forEach(([id, cause]) => this.eliminate(id, cause));
  }

  // ---------- 开局 ----------

  private startGame(client: Client) {
    if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
    const soloMode = this.soloFaction !== null; // 单人试玩：其余座位由挂机玩家补齐
    this.startHungerClock(); // 饥饿实时结算（探索时段生效，noon/night 暂停）
    // 主持人（观察者）不参战：仅非观察者计入玩家人数与阵营分配
    const ids = [...this.state.players.keys()].filter((id) => !this.state.players.get(id)!.observer);
    if (ids.length < 5 && !this.debugMode && !soloMode) return;

    if (soloMode) {
      // 补齐 9 人局：真人按选择定身份，8 个挂机玩家占满其余座位
      const want = this.soloFaction === "chair" ? "chair" : "student";
      this.factionOf.set(client.sessionId, want);
      const BOT_NAMES = ["周棋", "何霜", "方勉", "许昼", "韩杳", "冯遥", "邓灯", "曾隅"];
      for (let i = 0; i < 8; i++) {
        const bot = new Player();
        bot.name = BOT_NAMES[i];
        bot.gender = i % 2 === 0 ? "male" : "female";
        bot.connected = false; // 全员列表中显示为离线（挂机）
        this.state.players.set(`bot-${i + 1}`, bot);
        ids.push(`bot-${i + 1}`);
      }
      // 3 个理事长席位：真人占一席则其余两席在挂机玩家里随机
      const chairSeats = 3;
      const pool = ids.filter((id) => this.factionOf.get(id) == null);
      const shuffledBots = pool.sort(() => Math.random() - 0.5);
      const needChairs = chairSeats - (want === "chair" ? 1 : 0);
      shuffledBots.forEach((id, i) => this.factionOf.set(id, i < needChairs ? "chair" : "student"));
    } else {
      // 阵营分配：≥9 人 3 理事长，5–8 人 2 理事长（7:3 体验局见沙盘推演报告附 3）
      const nChair = ids.length >= 9 ? 3 : 2;
      const shuffled = [...ids].sort(() => Math.random() - 0.5);
      shuffled.forEach((id, i) => this.factionOf.set(id, i < nChair ? "chair" : "student"));
    }

    // 调试房可强制上板规则（测试用）；正式局随机抽板
    const forced = this.debugMode && Array.isArray(this.forceBoard) ? this.forceBoard : null;
    const { board, pool } = drawRuleBoard(forced);
    this.board = board;
    this.pool = pool;
    this.broadcast("init", {
      nodes: NODES,
      edges: EDGES,
      fixedRules: FIXED_RULES,
      ruleBoard: board,
      dayTotal: DAY_TOTAL,
      lootMult: 1.5, // 沙盘定稿：物资丰度 ×1.5
    });
    // 角色私发（理事长互相可见名单，干事只知自己是干事）
    const chairs = ids.filter((id) => this.factionOf.get(id) === "chair");
    ids.forEach((id) => {
      const f = this.factionOf.get(id)!;
      this.clients.find((c) => c.sessionId === id)?.send("role", {
        faction: f,
        chairs: f === "chair" ? chairs.map((c) => ({ id: c, name: this.state.players.get(c)!.name })) : [],
        pool: f === "chair" ? this.pool : [], // 理事长需掌握备选规则池（换规用）
      });
    });

    if (soloMode) {
      // 单人试玩跳过准备阶段，直接入第 0 天
      this.state.day = 0;
      this.enterPhase("morning", 0);
      return;
    }
    // 准备阶段：1 分钟（随测试倍速缩放）查看界面与校规，全员就绪后提前开始
    this.state.day = 0;
    this.state.players.forEach((p) => { p.ready = false; });
    this.state.phase = "ready";
    this.state.phaseStartedAt = Date.now();
    const readyMs = 60_000 / this.timeScale;
    this.state.phaseEndsAt = Date.now() + readyMs;
    this.timer.stop();
    this.readyTimer = setTimeout(() => this.beginDay0(), readyMs);
    this.broadcast("phase", { phase: "ready", day: 0, endsAt: this.state.phaseEndsAt });
    this.broadcast("notice", { text: "对局即将开始：你有 1 分钟查看界面与校规，点击「准备就绪」。" });
  }

  private readyTimer?: NodeJS.Timeout;

  /** 全员就绪或倒计时结束 → 第 0 天上午 */
  private beginDay0() {
    if (this.state.phase !== "ready") return;
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = undefined; }
    this.enterPhase("morning", 0);
  }

  private onReady(client: Client) {
    if (this.state.phase !== "ready") return;
    const p = this.state.players.get(client.sessionId);
    if (!p || p.observer || p.ready) return;
    p.ready = true;
    const players = [...this.state.players.values()].filter((q) => !q.observer);
    const nReady = players.filter((q) => q.ready).length;
    this.broadcast("notice", { text: `${p.name} 已准备（${nReady}/${players.length}）` });
    if (nReady >= players.length) this.beginDay0();
  }

  // ---------- 时段推进 ----------

  private enterPhase(phase: Phase, day: number) {
    this.state.phase = phase;
    this.violCooldown.clear(); // 违规保护期按时段清零：每个时段重新计 30 秒
    this.state.phaseStartedAt = Date.now();
    this.state.phaseEndsAt = this.timer.start(phase, day, () => this.onPhaseEnd(phase, day));
    this.broadcast("phase", { phase, day, endsAt: this.state.phaseEndsAt });

    if (phase === "morning") {
      this.state.players.forEach((p, id) => {
        if (!p.alive || p.observer) return;
        p.ap = this.pendingApBonus.has(id) ? 30 : 20; // 表彰兑现：次日 30 AP
        this.recs.set(id, newDayRecord());       // 每日记录清零
        this.prevNode.set(id, p.nodeId);
      });
      this.todayViolationEvents = 0;
      this.votes.clear();
      this.roomUsed.clear();                      // 社区房间功能每日刷新
      this.bookings.delete(day - 2);              // 预约记录保留到次日供社区部查询，之后清理
      this.visits.clear();                        // dynamic_visit 每日重置
      this.recycleBatch.clear();                  // 回收站批次数每日重置
      // 商店逐日累积随机涨价 8%–18%（当日全局统一）+ 少量补货
      if (day >= 1) {
        for (const [k, v] of [...this.state.shopPrices.entries()]) this.state.shopPrices.set(k, nextPrice(v));
        for (const [k, v] of [...this.state.shopStock.entries()]) this.state.shopStock.set(k, Math.min(SHOP_STOCK_MAX, v + SHOP_RESTOCK));
      }
    }
    if (phase === "afternoon") {
      // R8 按时段独立计数：进入下午时清零发言数与通报标记
      this.recs.forEach((rec) => { rec.chats = 0; rec.r8Fired = false; });
    }
    if (phase === "noon") {
      this.noonDone.clear();
      this.state.lunchOpen = true;
      // 集体自动前往食堂（不消耗 AP）；主持人留观
      this.state.players.forEach((p, pid) => {
        if (!p.alive || p.observer) return;
        this.prevNode.set(pid, p.nodeId);
        p.nodeId = "canteen";
        p.lunchDone = false;
        let v = this.visits.get("canteen");
        if (!v) { v = new Set(); this.visits.set("canteen", v); }
        v.add(pid);
      });
      this.broadcast("notice", { text: "十一点整。所有人都停下了手里的事，朝食堂走去。" });
    }
    if (phase === "evening") {
      // 社区清场：下午段结束，非理事长留在社区的被请回宿舍
      this.state.players.forEach((p, pid) => {
        if (!p.alive || p.nodeId !== "community") return;
        if (this.factionOf.get(pid) === "chair") return;
        p.nodeId = "dorm";
        this.subroom.delete(pid);
        this.sendNoticeTo(pid, "社区开始清场。你被请回了宿舍。");
      });
    }
    if (phase === "night") {
      this.accuse = { attempts: 0, failures: 0, swapped: false };
      this.callTargets.clear();
      // M4：表彰兑现评估——今日受表彰的干事若无违规，明日 AP 上限 15
      this.pendingApBonus.clear();
      if (this.commend && this.factionOf.get(this.commend.id) === "student") {
        if ((this.recs.get(this.commend.id)?.violations.length ?? 0) === 0) {
          this.pendingApBonus.add(this.commend.id);
        }
      }
      // F7：随机挑至多 2 名干事，听到有人叫名字（是否回应由玩家决定）
      const students = this.aliveIds().filter((id) => this.factionOf.get(id) === "student");
      const picked = [...students].sort(() => Math.random() - 0.5).slice(0, 2);
      picked.forEach((id) => {
        this.callTargets.add(id);
        this.clients.find((c) => c.sessionId === id)?.send("call", { text: "……夜色里有人在叫你的名字。要回应吗？" });
      });
      const chief = this.chiefChairId();
      if (chief) {
        this.broadcast("notice", { text: `理事长讨论时间。今日弹药：${this.todayViolationEvents} 发（每有一处干事违规 +1 发）` });
      }
      this.pushAccuseState();
    }
  }

  private onPhaseEnd(phase: Phase, day: number) {
    if (this.state.phase === "ended") return;

    // 时段结束类违规判定（morning/noon/evening，针对干事）
    if (phase === "morning" || phase === "noon" || phase === "evening") {
      for (const id of this.aliveIds()) {
        if (this.factionOf.get(id) !== "student") continue;
        const ctx = this.makeCtx(id);
        for (const ruleId of phaseEndViolations(ctx)) this.violate(id, ruleId);
      }
    }
    // M4：担保惩戒——被担保者今日若无违规，担保双方各 -25HP/-25SAN
    if (phase === "evening") {
      this.guarantee.forEach((guarantor, target) => {
        const t = this.state.players.get(target);
        const g = this.state.players.get(guarantor);
        const violated = (this.recs.get(target)?.violations.length ?? 0) > 0;
        if (!violated && t?.alive && g?.alive) {
          t.hp -= 25; t.san -= 25;
          g.hp -= 25; g.san -= 25;
          this.broadcast("notice", { text: "【校园墙】匿名担保落空：被担保者今日并无违规，担保双方各受 -25HP/-25SAN 惩戒。" });
          if (t.hp <= 0) this.eliminate(target, "担保惩戒");
          if (g.hp <= 0) this.eliminate(guarantor, "担保惩戒");
        }
      });
      this.guarantee.clear();
    }
    if (phase === "noon") {
      // 讨论结束：全员从食堂回到午间传送前的位置
      this.state.players.forEach((p, pid) => {
        if (!p.alive || p.observer) return;
        p.nodeId = this.prevNode.get(pid) ?? "dorm";
      });
      if (day === 0) {
        // 第 0 日不投票
      } else {
        this.resolveVote(day);
      }
      if ((this.state.phase as string) === "ended") return; // 结算可能在对局中途触发（理事长全灭）
    }
    // Day4：中午终投后直接进入结算（跳过后续时段）
    if (phase === "noon" && day >= DAY_TOTAL) {
      this.settle("Day4 终投完成");
      return;
    }

    const idx = PHASE_ORDER.indexOf(phase);
    if (idx < PHASE_ORDER.length - 1) {
      this.enterPhase(PHASE_ORDER[idx + 1] as Phase, day);
    } else if (day < DAY_TOTAL) {
      this.state.day = day + 1;
      this.enterPhase("morning", day + 1);
    } else {
      this.settle("天数耗尽");
    }
  }

  // ---------- 消息处理 ----------

  private onChat(client: Client, msg: { text?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || this.state.phase === "lobby" || !msg?.text) return;
    this.broadcast("chat", { from: p.name, text: String(msg.text).slice(0, 200) });
    this.runChecks(client.sessionId, { type: "chat" });
  }

  private onMove(client: Client, msg: { nodeId?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer || this.state.phase === "lobby") return;
    const target = NODES.find((n) => n.id === msg?.nodeId);
    if (!target || target.id === p.nodeId) return;
    // 距离计费：近端 1 AP，远端 2 AP（无需逐节点步行，可直达任意节点）
    const dist = nodeDistance(p.nodeId, target.id);
    const cost = dist <= 1 ? 1 : 2;
    if (process.env.SMOKE_DEBUG) console.log(`[mv ${(Date.now() % 100000) / 1000}s] ${p.name} ${p.nodeId}->${msg?.nodeId} dist=${dist} ap=${p.ap} phase=${this.state.phase}`);
    const isChair = this.factionOf.get(client.sessionId) === "chair";
    if (!isChair && p.ap < cost) { this.sendNoticeTo(client.sessionId, `行动值不足（前往${target.name}需 ${cost} AP）。`); return; }
    // 体育馆入场费（5 币；理事长不受任何数值约束，免费）
    if (target.id === "gym" && !isChair) {
      if (p.coins < PRICES.gym) { this.sendNoticeTo(client.sessionId, "体育馆入场费 5 币，你的钱不够。"); return; }
      p.coins -= PRICES.gym;
    }
    // 行政楼门禁：干事需通行卡或万能钥匙
    if (target.id === "admin" && !isChair && !this.hasAdminPass(client.sessionId)) {
      this.sendNoticeTo(client.sessionId, "行政楼门禁亮红：需要行政楼通行卡。");
      return;
    }
    // 学生社区：仅上午/下午开放（中午、晚上关闭）。第 0 日为开放日；第 N 日需预约了第 N 日对应时段
    if (target.id === "community" && !isChair) {
      if (this.state.phase !== "morning" && this.state.phase !== "afternoon") {
        this.sendNoticeTo(client.sessionId, "学生社区只在上午、下午开放（中午及晚上清场）。");
        return;
      }
      if (this.state.day >= 1) {
        const b = this.bookings.get(this.state.day);
        const ok = this.state.phase === "morning" ? b?.am.includes(client.sessionId) : b?.pm.includes(client.sessionId);
        if (!ok) {
          this.sendNoticeTo(client.sessionId, `你未预约第 ${this.state.day} 日的${this.state.phase === "morning" ? "上午" : "下午"}段。打开「校园预约」应用可约明天的时段。`);
          return;
        }
      }
    }

    const from = p.nodeId;
    p.nodeId = target.id;
    // 图书馆闸机进出记录：真实移动才记，传送（noon 等）不计
    if (from === "library" || target.id === "library") {
      this.gateLog.push({
        id: client.sessionId,
        day: this.state.day,
        action: target.id === "library" ? "enter" : "leave",
        t: this.vtimeNow(),
        seq: ++this.gateSeq,
      });
    }
    this.subroom.delete(client.sessionId); // 换节点即离开原房间
    // dynamic_visit：本日节点到访去重（含强制传送）
    let v = this.visits.get(target.id);
    if (!v) { v = new Set(); this.visits.set(target.id, v); }
    v.add(client.sessionId);
    if (!isChair) p.ap -= cost; // 理事长自由活动不耗 AP
    this.runChecks(client.sessionId, { type: "move", from, to: target.id });
    // R1 单独相处：双向违规（同节点另一性别玩家同样违规）
    if (this.activeRuleIds().includes("R1")) {
      const occ = this.aliveIds().filter((id) => this.state.players.get(id)!.nodeId === target.id);
      if (occ.length === 2) {
        const g = occ.map((id) => this.state.players.get(id)!.gender);
        if (g[0] !== g[1]) occ.forEach((id) => this.violate(id, "R1"));
      }
    }
    this.prevNode.set(client.sessionId, from);
  }

  /** 图书馆闸机记录查询：须本人身处图书馆，仅返回自己的进出记录 */
  private onGateLog(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer || this.state.phase === "lobby") return;
    if (p.nodeId !== "library") { this.sendNoticeTo(client.sessionId, "闸机不在这里。"); return; }
    const mine = this.gateLog.filter((g) => g.id === client.sessionId).sort((a, b) => a.seq - b.seq);
    const text = mine.length
      ? "闸机的屏幕闪了一下，绿光扫过你的脸，逐行吐出你的名字：\n"
        + mine.map((g) => `第 ${g.day + 1} 日 ${g.t}　${g.action === "enter" ? "进馆" : "出馆"}`).join("\n")
      : "闸机的屏幕闪了一下，绿光扫过你的脸。上面没有你的名字——至少今天没有。";
    client.send("sceneResult", {
      sceneId: "library", eventId: "__gate", taken: false, fake: false,
      op: null, grants: [], states: {}, text,
    });
  }

  /** 通用动作入口：行为记录 + 规则引擎判定 */
  private onAction(client: Client, action: Action) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || this.state.phase === "lobby") return;
    const rec = this.recs.get(client.sessionId);
    const isChair = this.factionOf.get(client.sessionId) === "chair";
    if (action.type === "exercise") {
      if (isChair) { this.sendNoticeTo(client.sessionId, "你做了个运动的姿势。没有人敢看你。"); return; }
      const spot = p.nodeId === "field" ? 1 : p.nodeId === "gym" ? 1.5 : 0;
      if (!spot) { this.sendNoticeTo(client.sessionId, "这里无法运动（去操场或体育馆）。"); return; }
      if (rec) rec.exercised = true; // R11 精神自检免责
      this.log(p.nodeId === "gym" ? "体育馆闸机" : "操场闸机", "运动记录");
      p.hunger = Math.max(0, p.hunger - 8);
      p.hp = Math.min(100, p.hp + 4 * spot);
      p.san = Math.min(100, p.san + 6 * spot);
      this.sendNoticeTo(client.sessionId, `运动完毕：HP +${4 * spot}，SAN +${6 * spot}，饥饿 -8。`);
      return;
    }
    if (action.type === "medicine") {
      this.sendNoticeTo(client.sessionId, "请用 useMedicine 并指定 kind: hp | san。");
      return;
    }
    if (action.type === "eat") {
      if (isChair) { this.sendNoticeTo(client.sessionId, "你装作吃了点东西。食物不会真的少。"); return; }
      if (p.food <= 0) { this.sendNoticeTo(client.sessionId, "没有食物。去超市购买，或在食堂吃午间套餐。"); return; }
      p.food -= 1;
      p.hunger = Math.min(100, p.hunger + 30);
      this.sendNoticeTo(client.sessionId, `吃了些东西：饥饿 +30（现 ${Math.round(p.hunger)}）。`);
      // 进食仍需过规则引擎（F3 教学楼禁食 / R5 宿舍禁食）
    }
    if (action.type === "doorplate" && rec) {
      if (p.nodeId !== "dorm") return; // 只有在宿舍才能确认门牌
      rec.doorplate = true;
      this.sendNoticeTo(client.sessionId, "你确认了门牌号。今天它没有变。");
      return;
    }
    if (action.type === "enterRoom" && action.roomId.startsWith(p.nodeId + ":")) {
      this.subroom.set(client.sessionId, action.roomId); // 记录子房间，供探索文本精确匹配
    }
    if (action.type === "talkRed" && !isChair) {
      this.sendNoticeTo(client.sessionId, pick(NPC.redUniform));
    }
    this.runChecks(client.sessionId, action);
  }

  /** 在线且存活的玩家（不含观察者） */
  private aliveConnected(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p, id) => { if (p.alive && p.connected && !p.observer) out.push(id); });
    return out;
  }

  /** 食堂午餐结算：noon 开始即全员询问；全员选完才进入讨论。每人每天一次 */
  private onLunch(client: Client, msg: { eat?: boolean }) {
    if (this.state.phase !== "noon" || !this.state.lunchOpen) return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer || p.lunchDone) return;
    const isChair = this.factionOf.get(client.sessionId) === "chair";
    p.lunchDone = true;
    const eat = msg?.eat !== false;
    // 理事长同款演出，结算不落库（窥屏不可分辨）
    if (isChair) {
      this.sendNoticeTo(client.sessionId, eat
        ? "午餐下肚：饥饿 +30。"
        : "你拒绝了今天的午餐。");
      this.maybeEndLunch();
      return;
    }
    if (eat) {
      if (p.coins < 10) {
        p.lunchDone = false;
        this.sendNoticeTo(client.sessionId, "代币不足 10，打饭窗口的阿姨摆了摆手。");
        return;
      }
      p.coins -= 10;
      const hungerGain = 20 + Math.floor(Math.random() * 21); // +20~40
      p.hunger = Math.min(100, p.hunger + hungerGain);
      const parts: string[] = [`午餐下肚：饥饿 +${hungerGain}。`];
      if (Math.random() < 0.15) {
        const dmg = 10 + Math.floor(Math.random() * 11); // -10~-20
        p.hp -= dmg;
        parts.push(`饭菜的味道不太对（HP -${dmg}）。`);
      }
      if (Math.random() < 0.20) {
        const dmg = 10 + Math.floor(Math.random() * 11); // -10~-20
        p.san -= dmg;
        parts.push("邻桌的人一直在看你。（SAN 下降）");
      }
      this.sendNoticeTo(client.sessionId, parts.join(""));
      if (p.hp <= 0) { this.eliminate(client.sessionId, "食堂午餐"); this.maybeEndLunch(); return; }
      if (p.san <= 0) { this.eliminate(client.sessionId, "精神崩溃"); this.maybeEndLunch(); return; }
      this.maybeEndLunch();
      return;
    }
    // 拒绝午餐
    if (p.coins < 10) {
      const dmg = 10 + Math.floor(Math.random() * 11); // -10~-20
      p.san -= dmg;
      this.sendNoticeTo(client.sessionId, `你空着肚子看完全场。胃酸灼得慌（SAN -${dmg}）。`);
    } else if (Math.random() < 0.25) {
      const dmg = 6 + Math.floor(Math.random() * 5); // -6~-10
      p.san -= dmg;
      this.sendNoticeTo(client.sessionId, `你拒绝了今天的午餐（SAN -${dmg}）。`);
    } else {
      this.sendNoticeTo(client.sessionId, "你拒绝了今天的午餐。");
    }
    if (p.san <= 0) { this.eliminate(client.sessionId, "精神崩溃"); }
    this.maybeEndLunch();
  }

  /** 全员选完午餐 → 关闭询问，开放讨论/投票 */
  private maybeEndLunch() {
    const all = this.aliveConnected();
    if (!all.length) return;
    if (all.every((id) => this.state.players.get(id)?.lunchDone)) {
      this.state.lunchOpen = false;
      this.broadcast("notice", {
        text: this.state.day === 0
          ? "餐盘收进后厨。午间讨论开始（第 0 日不投票）——全员确认后时间进入 14:00。"
          : "餐盘收进后厨。午间讨论开始——全员投票后时间进入 14:00。",
      });
    }
  }

  /** 午间确认：第 0 日不投票，全员确认后跳入 14:00；第 1 日起由投票收束（见 onVote） */
  private onNoonDone(client: Client) {
    if (this.state.phase !== "noon" || this.state.lunchOpen) return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer || !p.connected || this.state.day !== 0) return;
    this.noonDone.add(client.sessionId);
    const need = this.aliveConnected().length;
    this.broadcast("notice", { text: `${p.name} 确认讨论结束（${this.noonDone.size}/${need}）` });
    if (this.noonDone.size >= need) this.onPhaseEnd("noon", this.state.day);
  }

  private onVote(client: Client, msg: { targetId?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer) return;
    if (this.state.phase !== "noon" || this.state.day === 0 || this.state.lunchOpen) return;
    const targetId = String(msg?.targetId ?? "");
    const t = this.state.players.get(targetId);
    if (!t || !t.alive || targetId === client.sessionId) {
      this.sendNoticeTo(client.sessionId, "不能投自己，也不能投已出局的人。");
      return;
    }
    this.votes.set(client.sessionId, targetId);
    const rec = this.recs.get(client.sessionId);
    if (rec) rec.voted = true;
    this.sendNoticeTo(client.sessionId, `投票已记录。当前已投 ${this.votes.size} 人`);
    // 讨论不计时：在线存活者全员投出后，时间自动跳入 14:00
    if (this.votes.size >= this.aliveConnected().length) this.onPhaseEnd("noon", this.state.day);
  }

  /** 检举：仅编号最小的存活理事长，仅夜间；弹药 = 今日干事违规事件数 */
  private onAccuse(client: Client, msg: { targetId?: string }) {
    if (this.state.phase !== "night") return;
    if (client.sessionId !== this.chiefChairId()) return;
    const targetId = String(msg?.targetId ?? "");
    const t = this.state.players.get(targetId);
    if (!t || !t.alive) return;
    if (this.accuse.attempts >= this.todayViolationEvents) {
      this.sendNoticeTo(client.sessionId, `弹药已用尽（${this.todayViolationEvents} 发）。`);
      return;
    }
    this.accuse.attempts++;
    const rec = this.recs.get(targetId);
    const guilty = this.factionOf.get(targetId) === "student" && (rec?.violations.length ?? 0) > 0;
    if (guilty && this.guarantee.has(targetId)) {
      // 匿名担保生效：检举被抵消，按"未成立"处理（不暴露担保存在）
      this.accuse.failures++;
      const left = 2 - this.accuse.failures;
      this.pushAccuseState();
      this.broadcast("notice", { text: `【夜间通报】检举未成立，无事发生。${left > 0 ? `再失败 ${left} 次将停止今晚检举权。` : "今晚检举权终止。"}` });
      return;
    }
    if (guilty) {
      const dmg = 25 + 5 * this.state.day;
      t.hp -= dmg;
      this.pushAccuseState();
      this.broadcast("notice", { text: `【夜间通报】理事长检举成立：${t.name} 今日确有违规，HP -${dmg}（余 ${Math.max(0, Math.round(t.hp))}）。检举成功，可继续检举或更换一条规则。` });
      if (t.hp <= 0) this.eliminate(targetId, "检举处决");
    } else {
      this.accuse.failures++;
      const left = 2 - this.accuse.failures;
      this.pushAccuseState();
      this.broadcast("notice", { text: `【夜间通报】检举未成立，无事发生。${left > 0 ? `再失败 ${left} 次将停止今晚检举权。` : "今晚检举权终止。"}` });
    }
  }

  /** 换规：夜间、编号最小理事长、今晚已检举过、每夜一次；从备选池互换并广播 */
  private onSwapRule(client: Client, msg: { outId?: string; inId?: string }) {
    if (this.state.phase !== "night") return;
    if (client.sessionId !== this.chiefChairId()) return;
    if (this.accuse.attempts === 0) return;            // 必须先检举
    if (this.accuse.swapped) return;                   // 每夜一次
    const outId = String(msg?.outId ?? "");
    const inId = String(msg?.inId ?? "");
    const outIdx = this.board.findIndex((r) => r.id === outId);
    const inIdx = this.pool.findIndex((r) => r.id === inId);
    if (outIdx < 0 || inIdx < 0) return;
    const [outRule] = this.board.splice(outIdx, 1);
    const [inRule] = this.pool.splice(inIdx, 1);
    this.board.push(inRule);
    this.pool.push(outRule);
    this.accuse.swapped = true;
    // 广播具体修正内容（理事长可借此放烟雾弹）
    this.broadcast("ruleSwap", { board: this.board });
    this.broadcast("notice", { text: `【校规修正】${outRule.text} 即日起废止；新规定：${inRule.text}` });
    this.pushAccuseState();
    // 备选池已变，同步给全体理事长
    this.pushRulePool();
  }

  /** 检举状态推送：夜间进入 / 每次检举后 / 换规后（客户端理事长面板的数据源） */
  private pushAccuseState() {
    this.broadcast("accuseState", {
      attempts: this.accuse.attempts,
      ammo: this.todayViolationEvents,
      failures: this.accuse.failures,
      swapped: this.accuse.swapped,
    });
  }

  /** 备选规则池推送（仅理事长；换规后池子变化） */
  private pushRulePool() {
    const poolMsg = { pool: this.pool };
    for (const c of this.clients) {
      if (this.factionOf.get(c.sessionId) === "chair") c.send("rulePool", poolMsg);
    }
  }

  // ---------- M3：探索 / 交易 / 生存 ----------

  /** 探索（1 AP）：获得杂物或重要物品；理事长假装探索，无消耗无所得 */
  private onExplore(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer) return;
    if (!["morning", "afternoon", "evening"].includes(this.state.phase)) return;
    if (this.factionOf.get(client.sessionId) === "chair") {
      // 与干事同一表现：同样的掉落文案，只是不实际入包（窥屏无法分辨）
      const loot = rollLoot(new Set());
      const parts: string[] = [];
      if (loot.junk) {
        const pool = [...(JUNK_NAMES[p.nodeId] ?? JUNK_NAMES.dorm)];
        const names: string[] = [];
        for (let i = 0; i < loot.junk && pool.length; i++) names.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        parts.push(`${names.join("、")}（约 ${loot.junkValue} 币）`);
      }
      if (loot.food) parts.push(`${pick(FOOD_NAMES)} ×1`);
      if (loot.medicine) parts.push(`${pick(MEDICINE_NAMES)} ×1`);
      if (loot.scissors) parts.push("剪刀 ×1");
      if (loot.coffee) parts.push("咖啡券 ×1");
      if (loot.card) parts.push("查阅卡 ×1");
      const roomId = this.subroom.get(client.sessionId) ?? null;
      const scene = exploreText(roomId, p.nodeId, p.san);
      this.sendNoticeTo(client.sessionId, scene + (parts.length ? `\n探索收获：${parts.join("、")}。` : ""));
      return;
    }
    if (p.ap < 1) { this.sendNoticeTo(client.sessionId, "行动值不足。"); return; }
    p.ap -= 1;
    const owned = new Set(p.keys.split(",").filter(Boolean));
    const loot = rollLoot(owned);
    const parts: string[] = [];
    if (loot.junk) {
      p.junk += loot.junk; p.junkValue += loot.junkValue ?? 0;
      this.recycleBatch.set(client.sessionId, (this.recycleBatch.get(client.sessionId) ?? 0) + loot.junk);
      const pool = [...(JUNK_NAMES[p.nodeId] ?? JUNK_NAMES.dorm)];
      const names: string[] = [];
      for (let i = 0; i < loot.junk && pool.length; i++) names.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      parts.push(`${names.join("、")}（约 ${loot.junkValue} 币）`);
    }
    if (loot.food) { p.food += loot.food; parts.push(`${pick(FOOD_NAMES)} ×1`); }
    if (loot.medicine) { p.medicine += loot.medicine; parts.push(`${pick(MEDICINE_NAMES)} ×1`); }
    if (loot.scissors) { p.scissors += loot.scissors; parts.push("剪刀 ×1"); }
    if (loot.coffee) { p.coffee += loot.coffee; parts.push("咖啡券 ×1"); }
    if (loot.card) { p.cards += loot.card; parts.push("查阅卡 ×1"); }
    if (loot.key) { owned.add(loot.key); p.keys = [...owned].join(","); parts.push(`钥匙（${ROOM_NAMES[loot.key] ?? loot.key}）`); }
    // 背包物品：约 1/4 概率额外发现一件重要物品/物资（进实体背包）
    if (Math.random() < 0.25) {
      const tid = rollTreasure();
      p.items.set(tid, (p.items.get(tid) ?? 0) + 1);
      const def = ITEM_CATALOG.find((i) => i.id === tid);
      if (def) parts.push(`${def.name} ×1`);
    }
    const roomId = this.subroom.get(client.sessionId) ?? null;
    const scene = exploreText(roomId, p.nodeId, p.san);
    this.sendNoticeTo(client.sessionId, scene + (parts.length ? `\n探索收获：${parts.join("、")}。` : ""));
  }

  // ---------- M6：场景文本事件（真实探索文案 + 机制结算） ----------

  /**
   * 场景事件：客户端按 campus_text.json 渲染 choice，点击后提交到这里结算。
   * 理事长与干事共用同一套流程与文案；理事长结算不落库（详见 onSceneEvent 内注释）。
   */
  private onSceneEvent(client: Client, msg: { sceneId?: string; eventId?: string; answer?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    const sceneId = String(msg?.sceneId ?? "");
    const eventId = String(msg?.eventId ?? "");
    const scene = this.scenes[sceneId];
    const ev = scene?.events[eventId];
    if (process.env.SMOKE_DEBUG) console.log(`[scene] ${id} ${sceneId}/${eventId} node=${p?.nodeId} phase=${this.state.phase} ev=${!!ev} alive=${p?.alive}`);
    if (!p || !p.alive || p.observer) return;
    if (p.nodeId !== sceneId) return;
    const exploreOk = ["morning", "afternoon", "evening"].includes(this.state.phase);
    if (!exploreOk) { this.sendNoticeTo(id, "当前时段不能探索这里。"); return; }
    const isChair = this.factionOf.get(id) === "chair";

    // P1 幻觉：SAN≤30 的干事在教学楼会看到「不存在的 404 教室」（客户端幻觉入口，不走场景 JSON）
    if (!ev && eventId === "__illusion") {
      if (isChair || !sceneId.startsWith("t")) return;
      this.onIllusion(client, sceneId);
      return;
    }
    if (!ev) return;
    const parsed = parseEvent(ev);
    // 事件进入消耗 AP（与子节点进入同价）：自带 AP 成本标注的深度事件不重复收；
    // 交易类（购买/回收）不消耗；理事长免费（结算不落库）
    if (!isChair && parsed.states?.ap == null && !/购买|回收|交易/.test(parsed.op ?? "")) {
      if (p.ap < 1) { this.sendNoticeTo(id, "行动值不足（需 1 AP）。"); return; }
      p.ap -= 1;
    }

    // 理事长与干事共用同一套探索（防窥屏）：文本、分支、答题、获得与状态展示完全一致
    // 唯一差异：结算不落库——背包/数值不写、不占点位（不留下"被拿过"痕迹）、前置视为满足、
    // 不预检行动值与货币（AP 耗尽仍可行动、清零仍可购买）。窥屏看到的界面与干事无异。
    if (isChair) {
      const visitN = String(this.visits.get(sceneId)?.size ?? 1);
      let grants = parsed.grants;
      let states = parsed.states;
      let text = ev.result.replace(/\{今日到访\}/g, visitN).replace(/\{[^}]*\}/g, "").trim();
      if (parsed.quiz) {
        if (msg.answer == null) {
          client.send("sceneQuiz", {
            sceneId, eventId,
            question: parsed.quiz.question,
            numeric: parsed.quiz.ruleType !== "static",
            rule: parsed.quiz.rule,
          });
          return;
        }
        const body = (ev.result.match(/\{答题:(.*)\}$/)?.[1]) ?? "";
        const correct = this.isQuizCorrect(parsed.quiz, String(msg.answer ?? ""), sceneId);
        const branch = parseQuizBranch(body, correct ? "答对" : "答错");
        grants = branch.grants;
        states = branch.states;
        text = branch.text || (correct ? "回答正确。" : "回答错误。");
      }
      states = this.scaleStatesByDay(states); // 展示与干事口径一致（虽不落库）
      client.send("sceneResult", {
        sceneId, eventId, taken: false, fake: false,
        op: parsed.op ?? null,
        grants: grants.map((g) => ({ name: g.name, ref: g.ref })),
        states,
        text,
      });
      return;
    }

    // 学生社区四部门门：消耗破旧的钥匙(关#1)或万能钥匙(关#7)——一次消耗，全局永久解锁
    const deptRoom = sceneId === "community" ? GameRoom.DOOR_EVENTS[eventId] : undefined;
    if (deptRoom) { this.onCommunityDoor(client, eventId, deptRoom); return; }

    // 物品前置：need 全部持有 / needAny 至少一件；不满足回 deny 文案，不结算
    const lacksAll = (ev.need ?? []).filter((r) => (p.pack.get(r) ?? 0) < 1);
    const lacksAny = (ev.needAny ?? []).length > 0 && (ev.needAny ?? []).every((r) => (p.pack.get(r) ?? 0) < 1);
    if (lacksAll.length > 0 || lacksAny) {
      client.send("sceneResult", {
        sceneId, eventId, taken: false, fake: false, op: null,
        grants: [], states: {},
        text: ev.deny ?? "条件不满足，无法继续。",
      });
      return;
    }

    // 答题：首次提交返回题目（answer 缺省），客户端弹填空 UI 后再带答案提交
    if (parsed.quiz && msg.answer == null) {
      client.send("sceneQuiz", {
        sceneId, eventId,
        question: parsed.quiz.question,
        numeric: parsed.quiz.ruleType !== "static", // dynamic 题填数字，静态题填文本
        rule: parsed.quiz.rule,
      });
      return;
    }

    let grants = parsed.grants;
    let states = parsed.states;
    const key = `${sceneId}:${eventId}`;
    const visitN = String(this.visits.get(sceneId)?.size ?? 1);
    let text = ev.result.replace(/\{今日到访\}/g, visitN).replace(/\{[^}]*\}/g, "").trim();

    if (parsed.quiz) {
      const body = (ev.result.match(/\{答题:(.*)\}$/)?.[1]) ?? "";
      const correct = this.isQuizCorrect(parsed.quiz, String(msg.answer ?? ""), sceneId);
      const side = correct ? "答对" : "答错";
      const branch = parseQuizBranch(body, side);
      grants = branch.grants;
      states = branch.states;
      text = branch.text || (side === "答对" ? "回答正确。" : "回答错误。");
    }

    // 天数衰减：负向状态变化按天数加重（AP 为行动成本不缩放），展示与实际结算一致
    states = this.scaleStatesByDay(states);

    // 先到先得（含答题奖励）：判定后再查点位占用，领过即回空态文案
    if (grants.length && this.claimed.has(key)) {
      client.send("sceneResult", {
        sceneId, eventId, taken: true, grants: [], states: {},
        text: ev.result_taken ?? "来晚了，什么都没有剩下。",
      });
      return;
    }

    // 消耗预检：行动值与货币
    const apCost = Math.max(0, -(states.ap ?? 0));
    if (apCost > 0 && p.ap < apCost) { this.sendNoticeTo(id, `行动值不足（需 ${apCost} AP）。`); return; }
    if (parsed.coinCost && p.coins < parsed.coinCost) { this.sendNoticeTo(id, `钱不够（需 ${parsed.coinCost} 币）。`); return; }

    // 结算
    if (grants.length) this.claimed.add(key);
    if (parsed.coinCost) p.coins -= parsed.coinCost;
    if (states.ap) p.ap = Math.max(0, p.ap + states.ap);
    if (states.hunger) p.hunger = Math.min(100, Math.max(0, p.hunger + states.hunger));
    if (states.hp) p.hp = Math.min(100, Math.max(0, p.hp + states.hp));
    if (states.san) p.san = Math.min(100, Math.max(0, p.san + states.san));
    // 关键物品全局库存：关段物品共享库存，发尽则该次获得落空（先到先得之外的全局上限）
    let stockNote = "";
    const granted = grants.filter((g) => {
      const left = this.keyStock.get(g.ref);
      if (left == null) return true; // 非关段，无库存概念
      if (left <= 0) return false;
      this.keyStock.set(g.ref, left - 1);
      return true;
    });
    const shortBy = grants.length - granted.length;
    if (shortBy > 0) stockNote = " 你伸手去拿，却落了个空——东西已经不在这里了。";
    for (const g of granted) p.pack.set(g.ref, (p.pack.get(g.ref) ?? 0) + 1);
    for (const c of ev.consume ?? []) {
      const n = (p.pack.get(c) ?? 0) - 1;
      if (n <= 0) p.pack.delete(c); else p.pack.set(c, n);
    }

    // 食堂问题食物：{操作:随机判定——概率食物存在问题}（以文本标注为准，20% 概率 HP/SAN -10）
    let foodNote = "";
    if (parsed.foodRisk && Math.random() < 0.2) {
      p.hp = Math.max(0, p.hp - 10);
      p.san = Math.max(0, p.san - 10);
      foodNote = " 但今天的菜有点不对劲……（HP -10，SAN -10）";
    }
    if (p.hp <= 0) this.eliminate(id, "意外身亡");
    if (p.hunger <= 0) this.eliminate(id, "力竭");

    client.send("sceneResult", {
      sceneId, eventId, taken: false, fake: false,
      op: parsed.op ?? null,
      grants: granted.map((g) => ({ name: g.name, ref: g.ref })),
      states,
      text: text + stockNote + foodNote,
    });
  }

  /** 社区四部门门：破旧钥匙(关#1)优先、万能钥匙(关#7)亦可——一次性消耗，全局永久解锁 */
  private onCommunityDoor(client: Client, eventId: string, room: string) {
    const id = client.sessionId;
    const p = this.state.players.get(id)!;
    if (this.communityDoors.get(room)) {
      client.send("sceneResult", { sceneId: "community", eventId, taken: false, fake: false, op: null, grants: [], states: {}, text: `${room}的门虚掩着。锁早就坏了，不会再锁上。` });
      return;
    }
    const pack = p.pack;
    const used = (pack.get("关#1") ?? 0) > 0 ? "关#1" : (pack.get("关#7") ?? 0) > 0 ? "关#7" : null;
    if (!used) {
      client.send("sceneResult", { sceneId: "community", eventId, taken: false, fake: false, op: null, grants: [], states: {}, text: "锁孔比普通的锁大一圈。你手里的东西没有一把对得上。" });
      return;
    }
    const left = (pack.get(used) ?? 0) - 1;
    if (left > 0) pack.set(used, left); else pack.delete(used);
    this.communityDoors.set(room, true);
    this.log("学生社区", `${p.name} 打开了${room}`);
    client.send("sceneResult", { sceneId: "community", eventId, taken: false, fake: false, op: null, grants: [], states: {},
      text: used === "关#7" ? "万能钥匙插进锁孔就开始掉渣。锁舌弹开，钥匙断在里面——这扇门以后不会再锁了。" : "钥匙在锁孔里转到底，咔哒。你拔钥匙时它断成了两截——这扇门以后不会再锁了。" });
  }

  /**
   * 天数衰减：负向状态变化随天数推移加重，每天增加 |v|/5（截断取整），eff = v - day*trunc(|v|/5)；
   * 例：标注 -6，第 1 天 -7、第 2 天 -8；正向变化保持标注值；行动值（AP）属行动成本不缩放。
   */
  private scaleStatesByDay(states: StateDelta): StateDelta {
    const day = this.state.day;
    const scale = (v?: number): number | undefined =>
      v == null || v >= 0 ? v : v - day * Math.floor(Math.abs(v) / 5);
    const out: StateDelta = {};
    // 只带实际存在的状态键：msgpack 会把 undefined 编码为键保留、值为 undefined，客户端小字会显示 "xxx undefined"
    if (states.ap != null) out.ap = states.ap;
    if (states.hunger != null) out.hunger = scale(states.hunger);
    if (states.hp != null) out.hp = scale(states.hp);
    if (states.san != null) out.san = scale(states.san);
    return out;
  }

  /** 进入场景内房间：干事 -1 AP（理事长免费）；成功后回 sceneEntered 供客户端切屏 */
  private onSceneRoom(client: Client, msg: { sceneId?: string; room?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    const sceneId = String(msg?.sceneId ?? "");
    const room = String(msg?.room ?? "");
    if (!p || !p.alive || p.observer || p.nodeId !== sceneId) return;
    if (!this.scenes[sceneId]?.rooms?.[room]) return;
    const exploreOk = ["morning", "afternoon", "evening"].includes(this.state.phase);
    if (!exploreOk) { this.sendNoticeTo(id, "当前时段不能探索这里。"); return; }
    // 社区四部门门：钥匙一次性消耗、全局永久解锁；理事长可进入但不消耗
    if (sceneId === "community" && GameRoom.DEPT_ROOMS.includes(room) && this.factionOf.get(id) !== "chair") {
      if (!this.communityDoors.get(room)) {
        this.sendNoticeTo(id, "门锁着。需要有人用钥匙打开（消耗一把破旧的钥匙，永久开启）。");
        return;
      }
    }
    if (this.factionOf.get(id) !== "chair") {
      if (p.ap < 1) { this.sendNoticeTo(id, "行动值不足（需 1 AP）。"); return; }
      p.ap -= 1;
    }
    this.subroom.set(id, `${sceneId}:${room}`);
    client.send("sceneEntered", { sceneId, room });
  }

  // ---------- M6：背包交互 ----------

  /** 幻觉事件：不存在的 404 教室。SAN≤30 可见；每座教学楼每天一次；风险与机遇并存 */
  private onIllusion(client: Client, sceneId: string) {
    const id = client.sessionId;
    const p = this.state.players.get(id)!;
    if (p.san > 30) { this.sendNoticeTo(id, "你揉了揉眼睛。走廊尽头什么都没有。"); return; }
    if (p.ap < 1) { this.sendNoticeTo(id, "行动值不足（需 1 AP）。"); return; }
    const key = `${sceneId}:__illusion:${this.state.day}`;
    p.ap -= 1;
    if (this.claimed.has(key)) {
      client.send("sceneResult", {
        sceneId, eventId: "__illusion", taken: true, fake: false, op: null,
        grants: [], states: {},
        text: "404 的门虚掩着。你今天已经进去过一次了——至少你记得只进去过一次。",
      });
      return;
    }
    const looty = Math.random() < 0.4;
    if (looty) {
      this.claimed.add(key);
      // 从 wiki 高价值段随机一件（物品本不该"存在"，所以格外值钱）
      const highs = Object.entries(this.wiki).filter(([, w]) => w.seg === "高");
      const [name, w] = highs[Math.floor(Math.random() * highs.length)] ?? ["名牌钢笔", this.wiki["名牌钢笔"]];
      const ref = `${w?.seg ?? "高"}#${w?.num ?? 1}`;
      p.pack.set(ref, (p.pack.get(ref) ?? 0) + 1);
      p.san = Math.max(0, p.san - 4);
      if (p.san <= 0) { this.eliminate(id, "精神崩溃"); return; }
      client.send("sceneResult", {
        sceneId, eventId: "__illusion", taken: false, fake: false, op: null,
        grants: [{ name, ref }], states: { san: -4, ap: -1 },
        text: "404 教室里整整齐齐摆着一张课桌，桌上放着一件不属于这所学校的东西。你把它收进了包里。教室在你身后消失了。",
      });
    } else {
      p.san = Math.max(0, p.san - 8);
      if (p.san <= 0) { this.eliminate(id, "精神崩溃"); return; }
      const texts = [
        "404 教室里坐满了人，全部背对着你。你退出来的瞬间，忘了他们穿的是什么颜色。",
        "你在 404 的黑板上看到自己的名字，写在值日生一栏。你不记得今天轮到你。",
        "404 的讲台上放着一本点名册。你翻开的那页是空的，再翻一页，还是空的。你合上书，书脊上印着你的学号。",
      ];
      client.send("sceneResult", {
        sceneId, eventId: "__illusion", taken: false, fake: false, op: null,
        grants: [], states: { san: -8, ap: -1 },
        text: texts[Math.floor(Math.random() * texts.length)],
      });
    }
  }

  /** 场景货表购买：name 须命中本节点 {操作:购买} 清单；理事长假买（币与货都不动） */
  private onSceneBuy(client: Client, msg: { sceneId?: string; name?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const sceneId = String(msg?.sceneId ?? "");
    const name = String(msg?.name ?? "");
    const item = this.shop.find((s) => s.sceneId === sceneId && s.name === name);
    if (!item) return;
    if (p.nodeId !== sceneId) { this.sendNoticeTo(client.sessionId, "不在这里，买不到。"); return; }
    if (this.factionOf.get(client.sessionId) === "chair") {
      // 与干事同一表现：提示语一致，币与货都不实际变动（货币清零仍可购买）
      this.sendNoticeTo(client.sessionId, `买到了${name}（-${item.price} 币），已入背包。`);
      return;
    }
    if (p.coins < item.price) { this.sendNoticeTo(client.sessionId, `钱不够（需 ${item.price} 币）。`); return; }
    p.coins -= item.price;
    p.pack.set(item.ref, (p.pack.get(item.ref) ?? 0) + 1);
    this.log(sceneId === "clinic" ? "校医院药房" : sceneId === "market" ? "超市售货机" : "售货机", `购买 ${name}`);
    this.sendNoticeTo(client.sessionId, `买到了${name}（-${item.price} 币），已入背包。`);
  }

  /** 回收站选物变现：按 Wiki 回收价合计；单次提交超过 5 件随机 SAN -1~-20（文案承诺） */
  private onPackRecycle(client: Client, msg: { refs?: string[] }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "recycle") return;
    if (this.factionOf.get(client.sessionId) === "chair") return;
    const refs = (Array.isArray(msg?.refs) ? msg.refs.map(String) : []).filter(Boolean);
    if (!refs.length) { this.sendNoticeTo(client.sessionId, "背包里没有选中要回收的东西。"); return; }
    // Wiki 口径：普通/高价值物品按 Wiki 价值回收；关键道具仅「褶皱的咖啡券」可收（40）；消耗品与其余关键道具不收
    const priceOf = (ref: string): number | null => {
      const name = this.nameOfRef(ref);
      const w = name ? this.wiki[name] : undefined;
      if (!w) return null;
      if (w.seg === "普" || w.seg === "高") return w.value ?? 1;
      if (name === "褶皱的咖啡券") return 40;
      return null;
    };
    const denied = new Set<string>();
    let total = 0;
    let count = 0;
    for (const ref of refs) {
      const have = p.pack.get(ref) ?? 0;
      if (have <= 0) continue;
      const price = priceOf(ref);
      if (price == null) { denied.add(this.nameOfRef(ref) ?? ref); continue; }
      total += price;
      count++;
      if (have > 1) p.pack.set(ref, have - 1); else p.pack.delete(ref);
    }
    if (count === 0) {
      this.sendNoticeTo(client.sessionId, denied.size ? `这里不收：${[...denied].join("、")}。` : "这些东西不值钱。");
      return;
    }
    p.coins += total;
    let note = "";
    if (count > 5) {
      const dmg = 1 + Math.floor(Math.random() * 20);
      p.san = Math.max(0, p.san - dmg);
      note = ` 递得太多了，老板的眼睛在你脸上停了一秒。（SAN -${dmg}）`;
      if (p.san <= 0) { this.eliminate(client.sessionId, "精神崩溃"); return; }
    }
    const denyNote = denied.size ? ` 退回没收的：${[...denied].join("、")}。` : "";
    this.sendNoticeTo(client.sessionId, `回收了 ${count} 件物品，+${total} 币。${denyNote}${note}`);
  }

  /** 丢弃背包物品（场景获得弹窗「丢弃」按钮；每件扣 1 数量） */
  private onPackDrop(client: Client, msg: { refs?: string[] }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const refs = Array.isArray(msg?.refs) ? msg.refs.map(String) : [];
    const dropped: string[] = [];
    for (const ref of refs) {
      const have = p.pack.get(ref) ?? 0;
      if (have <= 0) continue;
      if (have > 1) p.pack.set(ref, have - 1); else p.pack.delete(ref);
      dropped.push(this.refName.get(ref) ?? ref);
    }
    if (dropped.length) this.sendNoticeTo(client.sessionId, `已丢弃：${dropped.join("、")}`);
  }

  /** 使用消耗品：效果取自 Wiki effect 文本（饥饿+15 / HP+8 / SAN+12 / AP+1） */
  private onUsePack(client: Client, msg: { ref?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    if (this.factionOf.get(client.sessionId) === "chair") { this.sendNoticeTo(client.sessionId, "你做了个使用的姿势。数值与你无关。"); return; }
    const ref = String(msg?.ref ?? "");
    const have = p.pack.get(ref) ?? 0;
    const name = this.refName.get(ref) ?? ref;
    const w = this.wiki[name];
    if (have <= 0 || !w) return;
    if (have > 1) p.pack.set(ref, have - 1); else p.pack.delete(ref);
    const applied: string[] = [];
    for (const m of (w.effect ?? "").matchAll(/(饥饿|HP|SAN|AP)([+-]\d+)/g)) {
      const v = Number(m[2]);
      if (m[1] === "AP") p.ap = Math.min(20, Math.max(0, p.ap + v));
      else if (m[1] === "饥饿") p.hunger = Math.min(100, Math.max(0, p.hunger + v));
      else if (m[1] === "HP") p.hp = Math.min(100, Math.max(0, p.hp + v));
      else p.san = Math.min(100, Math.max(0, p.san + v));
      applied.push(`${m[1]} ${v > 0 ? "+" : ""}${v}`);
    }
    if (p.hp <= 0) { this.eliminate(client.sessionId, "药物反应"); return; }
    this.sendNoticeTo(client.sessionId, applied.length ? `使用了${name}：${applied.join("，")}。` : `使用了${name}。没有什么发生。`);
  }

  /** 填空判定：dynamic 题与实际数值精确比对；静态题与正确选项文本比对（忽略大小写/空白） */
  private isQuizCorrect(quiz: NonNullable<ReturnType<typeof parseEvent>["quiz"]>, answer: string, sceneId: string): boolean {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
    if (quiz.ruleType === "static") {
      const expected = quiz.options[(quiz.staticAnswer ?? 1) - 1];
      return norm(answer) === norm(expected ?? "");
    }
    const actual =
      quiz.ruleType === "dynamic_visit" ? (this.visits.get(sceneId)?.size ?? 1)
      : quiz.ruleType === "dynamic_alive" ? this.aliveIds().length
      : quiz.ruleType === "dynamic_room" ? this.aliveIds().filter((x) => this.state.players.get(x)!.nodeId === sceneId).length
      : this.todayViolationEvents; // dynamic_report
    return Number(answer) === actual;
  }

  /** 校医院：药物 12 币（理事长假装购买） */
  private onBuyMedicine(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "clinic") return;
    if (this.factionOf.get(client.sessionId) === "chair") {
      // 与干事同一表现：提示语一致，币与货都不实际变动
      this.sendNoticeTo(client.sessionId, `${pick(NPC.doctor)}\n买到了${pick(MEDICINE_NAMES)}（-${PRICES.medicine} 币），用 useMedicine 恢复 HP 或 SAN。`);
      return;
    }
    if (p.coins < PRICES.medicine) { this.sendNoticeTo(client.sessionId, `钱不够（需 ${PRICES.medicine} 币）。`); return; }
    p.coins -= PRICES.medicine;
    p.medicine += 1;
    this.log("校医院药房", "药品 ×1");
    this.sendNoticeTo(client.sessionId, `${pick(NPC.doctor)}\n买到了${pick(MEDICINE_NAMES)}（-${PRICES.medicine} 币），用 useMedicine 恢复 HP 或 SAN。`);
  }

  /** 用药：+30HP 或 +20SAN（R11 精神自检免责） */
  private onUseMedicine(client: Client, msg: { kind?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.medicine <= 0) return;
    if (this.factionOf.get(client.sessionId) === "chair") return;
    const kind = msg?.kind === "san" ? "san" : "hp";
    p.medicine -= 1;
    if (kind === "hp") p.hp = Math.min(100, p.hp + 30); else p.san = Math.min(100, p.san + 20);
    const rec = this.recs.get(client.sessionId);
    if (rec) rec.medicined = true;
    this.sendNoticeTo(client.sessionId, kind === "hp" ? "服药后 HP +30。" : "服药后 SAN +20。");
  }

  /** 超市 / 药房交易面板购买：当日全局统一价、全局库存；理事长同款演出不落库 */
  private onShopBuy(client: Client, msg: { shop?: string; key?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.observer) return;
    const shop = String(msg?.shop ?? "") as ShopKey;
    const def = this.shops[shop];
    if (!def || p.nodeId !== SHOP_NODE[shop]) { this.sendNoticeTo(client.sessionId, "不在这里，买不到。"); return; }
    if (this.state.phase === "lobby" || this.state.phase === "ready") return;
    const key = String(msg?.key ?? "");
    const goods = def.goods.find((g) => goodsKey(g) === key);
    if (!goods) return;
    const fullKey = `${shop}:${key}`;
    const price = this.state.shopPrices.get(fullKey) ?? goods.base;
    const stock = this.state.shopStock.get(fullKey) ?? 0;
    const seller = NPC[def.npc as keyof typeof NPC];
    if (this.factionOf.get(client.sessionId) === "chair") {
      // 与干事同一表现：提示语一致，币与库存都不实际变动（货币清零仍可购买）
      this.sendNoticeTo(client.sessionId, `${pick(seller)}\n买到了${goods.name}（-${price} 币），已入背包。`);
      return;
    }
    if (stock <= 0) { this.sendNoticeTo(client.sessionId, `${goods.name}卖完了。明天也许会补货。`); return; }
    if (p.coins < price) { this.sendNoticeTo(client.sessionId, `钱不够（需 ${price} 币）。`); return; }
    p.coins -= price;
    this.state.shopStock.set(fullKey, stock - 1);
    if (goods.kind === "field:scissors") p.scissors += 1;
    else if (goods.ref) p.pack.set(goods.ref, (p.pack.get(goods.ref) ?? 0) + 1);
    this.log(def.title, `购买 ${goods.name}`);
    this.sendNoticeTo(client.sessionId, `${pick(seller)}\n买到了${goods.name}（-${price} 币），已入背包。`);
  }

  /** 回收站：杂物全部变现 */
  private onRecycle(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "recycle" || p.junk <= 0) return;
    if (this.factionOf.get(client.sessionId) === "chair") return;
    const v = p.junkValue;
    p.coins += v;
    p.junk = 0;
    p.junkValue = 0;
    // 回收站文本承诺：单次提交超过 5 件，随机 SAN -1~-20（本日累计捡拾数计）
    let batchNote = "";
    const batch = this.recycleBatch.get(client.sessionId) ?? 0;
    if (batch > 5) {
      const dmg = 1 + Math.floor(Math.random() * 20);
      p.san = Math.max(0, p.san - dmg);
      batchNote = ` 递得太多了，老板的眼睛在你脸上停了一秒。（SAN -${dmg}）`;
      if (p.san <= 0) { this.eliminate(client.sessionId, "精神崩溃"); return; }
    }
    this.recycleBatch.delete(client.sessionId);
    this.sendNoticeTo(client.sessionId, `${pick(NPC.recycleMan)}\n回收了杂物，+${v} 币。${batchNote}`);
  }

  // ---------- M3：学生社区（预约制） ----------

  /** 预约：每段 ≤3 人，每人每天一段；am=上午，pm=下午 */
  /** 校园预约：任意地点可约，约的是「明天」的上午/下午段（每段≤3人，每人每天限约一段） */
  private onBookSlot(client: Client, msg: { slot?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    if (this.factionOf.get(client.sessionId) === "chair") { this.sendNoticeTo(client.sessionId, "你不需要预约。门会为你开着。"); return; }
    const slot = msg?.slot === "pm" ? "pm" : "am";
    const target = this.state.day + 1; // 预约明天
    let b = this.bookings.get(target);
    if (!b) { b = { am: [], pm: [] }; this.bookings.set(target, b); }
    if (b.am.includes(client.sessionId) || b.pm.includes(client.sessionId)) {
      this.sendNoticeTo(client.sessionId, `第 ${target} 日你已约过一段，每人每天限一段。`);
      return;
    }
    if (b[slot].length >= 3) { this.sendNoticeTo(client.sessionId, "该时段已约满（每段最多 3 人）。"); return; }
    b[slot].push(client.sessionId);
    this.sendNoticeTo(client.sessionId, `预约成功：第 ${target} 日${slot === "am" ? "上午" : "下午"}段（第 ${b[slot].length}/3 位）。时段内刷闸机进入。`);
    this.pushBookingState();
  }

  /** 推送明日预约余量给全场（校园预约应用实时显示） */
  private pushBookingState() {
    const target = this.state.day + 1;
    const b = this.bookings.get(target);
    for (const c of this.clients) {
      const id = c.sessionId;
      c.send("bookingState", {
        targetDay: target,
        am: b?.am.length ?? 0,
        pm: b?.pm.length ?? 0,
        mine: b?.am.includes(id) ? "am" : b?.pm.includes(id) ? "pm" : null,
        openDay: this.state.day === 0, // 第 0 日社区开放日
      });
    }
  }

  private onBookingQuery(client: Client) {
    this.pushBookingStateFor(client.sessionId);
  }

  private pushBookingStateFor(id: string) {
    const target = this.state.day + 1;
    const b = this.bookings.get(target);
    this.clients.find((c) => c.sessionId === id)?.send("bookingState", {
      targetDay: target,
      am: b?.am.length ?? 0,
      pm: b?.pm.length ?? 0,
      mine: b?.am.includes(id) ? "am" : b?.pm.includes(id) ? "pm" : null,
      openDay: this.state.day === 0,
    });
  }

  /** 设施使用日志（M4 查阅卡调阅：只有时间与类别，没有姓名） */
  private log(facility: string, label: string) {
    this.facilityLog.push({ facility, day: this.state.day, phase: this.state.phase, label });
    if (this.facilityLog.length > 400) this.facilityLog.shift();
  }

  /** 人在社区且当前时段可停留（预约在 onMove 闸把关；理事长不受限） */
  private canUseCommunity(id: string): boolean {
    const p = this.state.players.get(id);
    if (!p || p.nodeId !== "community") return false;
    return this.state.phase === "morning" || this.state.phase === "afternoon";
  }

  /** 房间功能闸：理事长全免；必须物理进入对应房间（subroom 匹配）；每房间每日一次 */
  private roomCheck(id: string, room: string): boolean {
    if (this.factionOf.get(id) === "chair") return true; // 理事长直接进入，走假装交互分支
    if (!this.canUseCommunity(id)) { this.sendNoticeTo(id, "社区现在不开放。"); return false; }
    const sub = this.subroom.get(id);
    if (sub !== `community:${room}`) { this.sendNoticeTo(id, "请进入对应房间后使用。"); return false; }
    if (this.roomUsed.has(room)) { this.sendNoticeTo(id, "今天已经有人用过这里了（每房间每日一次）。"); return false; }
    return true;
  }

  private hasKey(id: string, key: string): boolean {
    if (this.state.players.get(id)?.keys.split(",").includes(key)) return true;
    // M6：破旧的钥匙(关#1)可开社区四房间；万能钥匙(关#7)通吃
    if (key.startsWith("key_")) {
      return (this.state.players.get(id)?.pack.get("关#1") ?? 0) > 0 || (this.state.players.get(id)?.pack.get("关#7") ?? 0) > 0;
    }
    return (this.state.players.get(id)?.pack.get("关#7") ?? 0) > 0;
  }

  /** 行政楼门禁：干事需行政楼通行卡(关#3)或万能钥匙(关#7) */
  private hasAdminPass(id: string): boolean {
    const pack = this.state.players.get(id)?.pack;
    return (pack?.get("关#3") ?? 0) > 0 || (pack?.get("关#7") ?? 0) > 0;
  }

  /** 按 sessionId 或玩家名字解析（客户端可传名字，取首个匹配）；返回 [sessionId, Player] */
  private resolvePlayer(ref: string): [string, Player] | undefined {
    const byId = this.state.players.get(ref);
    if (byId) return [ref, byId];
    for (const [sid, p] of this.state.players) if (p.name === ref) return [sid, p];
    return undefined;
  }

  /** 办公室档案：调查 2 名存活学生是否同一阵营（强信息点，每日一份） */
  private onOfficeArchive(client: Client, msg: { aId?: string; bId?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.factionOf.get(id) === "chair") {
      this.sendNoticeTo(id, "你翻开档案袋。里面有每个人的字迹样本、几张合影、一份没写完的检查……你都记住了。");
      return;
    }
    if (!this.roomCheck(id, "办公室")) return;
    const ra = this.resolvePlayer(String(msg?.aId ?? ""));
    const rb = this.resolvePlayer(String(msg?.bId ?? ""));
    if (!ra || !rb || !ra[1].alive || !rb[1].alive || ra[0] === rb[0]) { this.sendNoticeTo(id, "档案科找不到这两份档案。"); return; }
    this.roomUsed.add("办公室");
    this.log("社区闸机", "办公室调阅档案");
    const same = this.factionOf.get(ra[0]) === this.factionOf.get(rb[0]);
    this.sendNoticeTo(id, `【档案】${ra[1].name} 与 ${rb[1].name} ${same ? "属于同一阵营" : "不属于同一阵营"}。`);
  }

  /** 社区部：查询昨天的社区预约情况 */
  private onDeptBookings(client: Client) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.factionOf.get(id) === "chair") {
      this.sendNoticeTo(id, "预约簿摊在桌上。昨天每段的名字你都背下来了。");
      return;
    }
    if (!this.roomCheck(id, "社区部")) return;
    this.roomUsed.add("社区部");
    this.log("社区闸机", "社区部调阅记录");
    const y = this.bookings.get(this.state.day - 1);
    const fmt = (ids?: string[]) => (ids && ids.length ? ids.map((x) => this.state.players.get(x)?.name ?? "?").join("、") : "无人");
    this.sendNoticeTo(id, `【预约记录】昨日上午：${fmt(y?.am)}；昨日下午：${fmt(y?.pm)}。`);
  }

  /** 策创部：抹除一条板上随机规则（理事长不知道是谁做的） */
  private onCceErase(client: Client, msg: { ruleId?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.factionOf.get(id) === "chair") {
      this.sendNoticeTo(id, "你擦了擦一块白板。字迹还在。");
      return;
    }
    if (!this.roomCheck(id, "策创部")) return;
    const ruleId = String(msg?.ruleId ?? "");
    const idx = this.board.findIndex((r) => r.id === ruleId);
    if (idx < 0) { this.sendNoticeTo(id, "板上没有这条规则（只能抹除随机规则）。"); return; }
    this.board.splice(idx, 1);
    this.roomUsed.add("策创部");
    this.log("社区闸机", "策创部使用记录");
    this.broadcast("ruleSwap", { board: this.board });
    this.broadcast("notice", { text: "【校规】某条随机校规的字迹淡了下去，像从没写过。无人认领这件事。" });
    this.sendNoticeTo(id, `你抹去了「${ruleId}」。从明天起它不再生效。`);
  }

  /** 时光里的咖啡屋：消耗咖啡券，+50HP 或 +30SAN */
  private onCafe(client: Client, msg: { kind?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.factionOf.get(id) === "chair") {
      this.sendNoticeTo(id, "你坐在咖啡屋里，看着窗外。这里的时间好像慢一点。");
      return;
    }
    if (!this.roomCheck(id, "咖啡屋")) return; // 咖啡屋凭咖啡券，不查门（公共开放区）
    if (p.coffee <= 0) { this.sendNoticeTo(id, "需要一张咖啡券。"); return; }
    p.coffee -= 1;
    this.roomUsed.add("咖啡屋");
    this.log("社区闸机", "咖啡屋消费");
    const kind = msg?.kind === "san" ? "san" : "hp";
    if (kind === "hp") p.hp = Math.min(100, p.hp + 50); else p.san = Math.min(100, p.san + 30);
    this.sendNoticeTo(id, `${pick(NPC.cafeLady)}\n${kind === "hp" ? "一杯热咖啡下肚：HP +50。" : "你望着拉花发呆了一会儿：SAN +30。"}`);
  }

  // ---------- M4：信息战 ----------

  /** 网络中心（行政楼内）：剪刀剪断网线，全员失去玩家位置视野；4 分钟后自动恢复 */
  private onCutNet(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "admin") return;
    if (this.state.netDown) return;
    if (this.factionOf.get(client.sessionId) === "chair") {
      this.sendNoticeTo(client.sessionId, "你比量了一下网线。现在剪断对你要做的事没有帮助。");
      return;
    }
    if (p.scissors <= 0) { this.sendNoticeTo(client.sessionId, "需要一把剪刀（超市有售）。"); return; }
    p.scissors -= 1;
    this.state.netDown = true;
    this.log("网络中心", "网线被剪断");
    this.broadcast("notice", { text: "【校园网】网络连接中断。所有监控与位置服务不可用。" });
    this.netTimer = setTimeout(() => {
      if (this.state.netDown) {
        this.state.netDown = false;
        this.broadcast("notice", { text: "【校园网】网络已自动恢复。" });
      }
    }, 240_000 / this.timeScale);
  }

  /** 修复网线：行政楼，1 AP */
  private onRepairNet(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "admin" || !this.state.netDown) return;
    if (this.factionOf.get(client.sessionId) === "chair") { this.sendNoticeTo(client.sessionId, "你扶了扶网线。"); return; }
    if (p.ap < 1) { this.sendNoticeTo(client.sessionId, "行动值不足。"); return; }
    p.ap -= 1;
    this.state.netDown = false;
    if (this.netTimer) clearTimeout(this.netTimer);
    this.log("网络中心", "网线已修复");
    this.broadcast("notice", { text: "【校园网】网络已恢复（有人修复了线路）。" });
  }

  /** 行政楼影像室：全图人员位置（节点级）。干事每日 3 次，理事长不限次数随时可用 */
  private onCamera(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "admin") return;
    const isChair = this.factionOf.get(client.sessionId) === "chair";
    const rec = this.recs.get(client.sessionId);
    if (!isChair) {
      if (!rec) return;
      if (rec.camera >= 3) { this.sendNoticeTo(client.sessionId, "今日调取次数已用完（干事每日 3 次）。"); return; }
      rec.camera += 1;
    }
    this.log("行政楼影像室", "监控调取");
    const positions = this.aliveIds().map((id) => ({
      name: this.state.players.get(id)!.name,
      nodeId: this.state.players.get(id)!.nodeId,
    }));
    this.sendNoticeTo(client.sessionId, `【监控】${positions.map((x) => `${x.name}→${NODES.find((n) => n.id === x.nodeId)?.name ?? x.nodeId}`).join("；")}`);
  }

  /** 行政楼影像室调阅：消耗查阅卡 ×1 + 1 AP + 少量 SAN，查看某设施当日使用记录（只有时间，没有姓名） */
  private onInspectLog(client: Client, msg: { facility?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.nodeId !== "admin") return;
    const facility = String(msg?.facility ?? "");
    if (!facility) return;
    if (this.factionOf.get(client.sessionId) === "chair") {
      this.sendNoticeTo(client.sessionId, "你翻了翻记录本。每个时间点你都背下来了——反正不会少什么。");
      return;
    }
    if (p.cards <= 0) { this.sendNoticeTo(client.sessionId, "需要查阅卡 ×1（探索行政楼或教学楼可获得）。"); return; }
    if (p.ap < 1) { this.sendNoticeTo(client.sessionId, "行动值不足。"); return; }
    p.cards -= 1;
    p.ap -= 1;
    p.san = Math.max(0, p.san - 3);
    this.log("行政楼影像室", "记录调阅");
    const PHASE_CN: Record<string, string> = { morning: "上午", noon: "午间", afternoon: "下午", evening: "晚间", night: "夜间" };
    const rows = this.facilityLog.filter((e) => e.facility === facility && e.day === this.state.day);
    this.sendNoticeTo(
      client.sessionId,
      rows.length
        ? `【调阅记录】${facility} 今日：${rows.map((e) => `${PHASE_CN[e.phase] ?? e.phase}·${e.label}`).join("；")}。`
        : `【调阅记录】${facility} 今日暂无使用记录。`,
    );
  }

  /** 宣传部校园墙（需 key_press + 预约）：破译规则 / 三好学生表彰 / 匿名担保（三选一，房间每日一次） */
  private onPress(client: Client, msg: { action?: string; targetId?: string; kind?: string }) {
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.factionOf.get(id) === "chair") {
      this.sendNoticeTo(id, "你在校园墙上敲了敲。后台的发布界面你闭着眼都能操作。");
      return;
    }
    if (!this.roomCheck(id, "宣传部")) return;
    const action = String(msg?.action ?? "");
    if (action === "decode") {
      const withDetail = this.board.filter((r) => r.detail);
      if (!withDetail.length) { this.sendNoticeTo(id, "板上已无可破译的规则。"); return; }
      const picked = [...withDetail].sort(() => Math.random() - 0.5).slice(0, 2);
      this.roomUsed.add("宣传部");
      this.log("社区闸机", "校园墙发布");
      picked.forEach((r) => this.broadcast("notice", { text: `【校园墙·破译】${r.detail}` }));
    } else if (action === "commend") {
      const rt = this.resolvePlayer(String(msg?.targetId ?? ""));
      if (!rt || !rt[1].alive) return;
      this.roomUsed.add("宣传部");
      this.log("社区闸机", "校园墙发布");
      this.commend = { id: rt[0], day: this.state.day };
      this.broadcast("notice", { text: `【校园墙】经研究决定，授予 ${rt[1].name}「三好学生」表彰：下次午间讨论拥有 1.5 票与归票权。` });
    } else if (action === "guarantee") {
      const rt = this.resolvePlayer(String(msg?.targetId ?? ""));
      if (!rt || !rt[1].alive) return;
      this.roomUsed.add("宣传部");
      this.log("社区闸机", "校园墙发布");
      this.guarantee.set(rt[0], id);
      this.broadcast("notice", { text: "【校园墙】出现一条匿名担保。被担保者若今日违规，夜间将免于被检举；若无违规，担保双方各受 -25HP/-25SAN 的惩戒。" });
    }
  }

  /** 私聊 + 转账：仅收发双方可见 */
  private onDm(client: Client, msg: { targetId?: string; text?: string; coins?: number }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const targetId = String(msg?.targetId ?? "");
    const t = this.state.players.get(targetId);
    if (!t || !t.alive || targetId === client.sessionId) return;
    const coins = Math.max(0, Math.min(Number(msg?.coins ?? 0) || 0, p.coins));
    const text = String(msg?.text ?? "").slice(0, 200);
    if (process.env.SMOKE_DEBUG) console.log(`[dm] ${p.name} -> ${t?.name} text=${text} coins=${coins}`);
    if (!text && coins <= 0) return;
    p.coins -= coins;
    t.coins += coins;
    this.clients.find((c) => c.sessionId === targetId)?.send("dm", { from: p.name, text, coins });
    this.sendNoticeTo(client.sessionId, `私聊已送达 ${t.name}${coins > 0 ? `（附 ${coins} 币）` : ""}。`);
  }

  // ---------- M3：调试（仅 timeScale > 1 注册） ----------

  private onDebug(client: Client, msg: { give?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const g = String(msg?.give ?? "");
    if (g === "coins") p.coins += 50;
    else if (g === "coins-") p.coins = Math.max(0, p.coins - 50);
    else if (g === "food") p.food += 1;
    else if (g === "medicine") p.medicine += 1;
    else if (g === "coffee") p.coffee += 1;
    else if (g === "scissors") p.scissors += 1;
    else if (g === "card") p.cards += 1;
    else if (g === "junk") { p.junk += 1; p.junkValue += 3; }
    else if (g === "san20") { p.san = 25; } // 幻觉测试：压 SAN 到阈值下（留余量防回收惩罚击穿）
    else if (g === "ap") { p.ap += 5; }
    else if (g.startsWith("key_")) {
      const ks = new Set(p.keys.split(",").filter(Boolean));
      ks.add(g);
      p.keys = [...ks].join(",");
    }
    else if (g.startsWith("pack:")) {
      const ref = g.slice(5);
      p.pack.set(ref, (p.pack.get(ref) ?? 0) + 1);
    }
    this.sendNoticeTo(client.sessionId, `[debug] 已获得 ${g}`);
  }

  // ---------- 规则引擎接线 ----------

  private activeRuleIds(): string[] {
    return [...FIXED_RULES.map((r) => r.id), ...this.board.map((r) => r.id)];
  }

  private makeCtx(meId: string): EngineCtx {
    return {
      day: this.state.day,
      phase: this.state.phase as Phase,
      players: this.aliveIds().map((id) => {
        const p = this.state.players.get(id)!;
        return { id, gender: p.gender, nodeId: p.nodeId, hp: p.hp, san: p.san };
      }),
      meId,
      prevNode: this.prevNode,
      rec: this.recs.get(meId) ?? newDayRecord(),
    };
  }

  /** 干事动作 → 逐条生效规则判定；理事长免疫校规（其动作不触发任何判定） */
  private runChecks(id: string, action: Action) {
    if (this.factionOf.get(id) !== "student") return;
    // 发言计数在规则循环外执行一次（R8 按次结算，避免按规则条数重复计数）
    if (action.type === "chat") {
      const rec = this.recs.get(id);
      if (rec) rec.chats++;
    }
    const ctx = this.makeCtx(id);
    for (const ruleId of this.activeRuleIds()) {
      let hit = false;
      if (action.type === "chat") {
        // R8：第 9 条起违规，每时段只通报一次
        const rec = this.recs.get(id)!;
        if (ruleId === "R8" && rec.chats > 8 && !rec.r8Fired) {
          rec.r8Fired = true;
          hit = true;
        }
      } else {
        hit = checkAction(ruleId, action, ctx);
      }
      if (hit) this.violate(id, ruleId);
    }
    // 幻觉提示（F6 相关氛围）：SAN 过低进入教学楼
    if (action.type === "move" && ["tA", "tB", "tC"].includes(action.to)) {
      const p = this.state.players.get(id)!;
      if (p.san < 40) this.sendNoticeTo(id, "走廊尽头似乎多出了一间教室……门牌号是 404。");
    }
  }

  /** 记违规：校园墙匿名通报（不显示是谁、哪一条）；干事违规事件数 = 夜间弹药；30 秒保护期防重复 */
  private violate(id: string, ruleId: string) {
    if (this.factionOf.get(id) !== "student") return;
    const p0 = this.state.players.get(id);
    if (!p0 || !p0.connected) return; // 挂机/断线玩家不产生违规（不刷弹药、不刷屏）
    const key = `${id}:${ruleId}`;
    const now = Date.now();
    const last = this.violCooldown.get(key) ?? 0;
    if (now - last < 30_000) return; // 保护期内：不记录、不通报、不扣罚
    this.violCooldown.set(key, now);
    const rec = this.recs.get(id);
    rec?.violations.push(ruleId);
    this.todayViolationEvents++;
    this.broadcast("notice", { text: "【校园墙·通报】有学生违反了校规。" });
    const pen = INSTANT_PENALTY[ruleId];
    if (pen) {
      const p = this.state.players.get(id)!;
      if (pen.hp) p.hp -= pen.hp;
      if (pen.san) p.san -= pen.san;
      this.sendNoticeTo(id, `你受到了当场处罚（${ruleId}）：HP ${pen.hp ? `-${pen.hp} ` : ""}${pen.san ? `SAN -${pen.san}` : ""}。`);
    }
  }

  // ---------- 投票 / 淘汰 / 结算 ----------

  /** 午间投票：简单多数，平票则无人出局 */
  private resolveVote(day: number) {
    const abstain = this.aliveIds().filter((id) => !this.recs.get(id)?.voted);
    const tally = new Map<string, number>();
    const weightOf = (voter: string) => (this.commend && this.commend.id === voter && this.commend.day < day ? 1.5 : 1);
    this.votes.forEach((target, voter) => {
      if (!this.state.players.get(voter)?.alive) return;
      tally.set(target, (tally.get(target) ?? 0) + weightOf(voter));
    });
    const commended = this.commend && this.commend.day < day ? this.state.players.get(this.commend.id) : null;
    if (commended?.alive) {
      this.broadcast("notice", { text: `【表彰】${commended.name} 主持今日发言顺序并归票（1.5 票已计入）。` });
    }
    this.commend = null;
    let top: string | null = null;
    let topN = 0;
    let tie = false;
    tally.forEach((n, id) => {
      if (n > topN) { top = id; topN = n; tie = false; }
      else if (n === topN) tie = true;
    });
    if (abstain.length > 0) {
      this.broadcast("notice", { text: `【通报】${abstain.length} 名学生午间未投票（违规）。` });
    }
    if (!top || tie || topN === 0) {
      this.broadcast("notice", { text: `第 ${day} 日投票：平票或无人得票，今日无人出局。` });
      return;
    }
    const t = this.state.players.get(top!)!;
    this.broadcast("notice", { text: `第 ${day} 日投票结果：${t.name} 以 ${topN} 票出局。` });
    this.eliminate(top!, "投票出局");
  }

  private eliminate(id: string, cause: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    const faction = this.factionOf.get(id) === "chair" ? "理事长" : "干事";
    this.broadcast("notice", { text: `${p.name}（${faction}）因${cause}被淘汰。` });
    this.checkFactionEnd();
  }

  /** 阵营终局判定：理事长全灭 → 干事大获全胜；干事全灭 → 理事长获胜 */
  private checkFactionEnd() {
    const chairs = this.aliveIds().filter((id) => this.factionOf.get(id) === "chair").length;
    const students = this.aliveIds().filter((id) => this.factionOf.get(id) === "student").length;
    if (chairs === 0) this.settle("全部理事长已出局");
    else if (students === 0) this.settle("全部干事已出局");
  }

  /** 结算日判定：理事长数 ≥ 干事数 → 理事长大获全胜；否则存活干事获胜 */
  private settle(reason: string) {
    if (this.state.phase === "ended") return;
    const aliveChairs = this.aliveIds().filter((id) => this.factionOf.get(id) === "chair");
    const aliveStudents = this.aliveIds().filter((id) => this.factionOf.get(id) === "student");
    let winner: "chair" | "student";
    let detail: string;
    if (aliveChairs.length === 0) {
      winner = "student";
      detail = "所有理事长均已出局，干事阵营大获全胜。";
    } else if (aliveChairs.length >= aliveStudents.length) {
      winner = "chair";
      detail = `结算：理事长 ${aliveChairs.length} 人 ≥ 干事 ${aliveStudents.length} 人，理事长阵营大获全胜。`;
    } else {
      winner = "student";
      detail = `结算：存活干事 ${aliveStudents.length} 人 > 理事长 ${aliveChairs.length} 人，存活干事获胜。`;
    }
    this.state.phase = "ended";
    this.timer.stop();
    this.broadcast("gameover", {
      winner,
      detail,
      reason,
      chairs: aliveChairs.map((id) => this.state.players.get(id)!.name),
      students: aliveStudents.map((id) => this.state.players.get(id)!.name),
    });
  }

  // ---------- 工具 ----------

  private aliveIds(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p, id) => { if (p.alive && !p.observer) out.push(id); });
    return out;
  }

  /** 编号最小的存活理事长（join 顺序即编号），夜间检举/换规唯一操作者 */
  private chiefChairId(): string | null {
    for (const id of this.aliveIds()) {
      if (this.factionOf.get(id) === "chair") return id;
    }
    return null;
  }

  private sendNoticeTo(id: string, text: string) {
    this.clients.find((c) => c.sessionId === id)?.send("notice", { text });
  }
}
