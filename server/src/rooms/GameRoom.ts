import { Room, Client } from "colyseus";
import { GameState, Player, type Faction } from "../schema/GameState.js";
import { EDGES, NODES } from "../data/map.js";
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

interface JoinOptions {
  name?: string;
  gender?: string;
  timeScale?: number;
}

const DAY_TOTAL = 4; // 0..4，Day4 中午终投后直接结算

export class GameRoom extends Room<GameState> {
  maxClients = 12; // 9–12 人局
  private timer!: PhaseTimer;
  private timeScale = 1;

  // ---------- 服务端私有数据（规则引擎状态，均不同步） ----------
  private factionOf = new Map<string, Faction>();          // 阵营（机密）
  private recs = new Map<string, DayRecord>();             // 每人当日行为记录
  private prevNode = new Map<string, string>();            // 每人上一节点（R2）
  private votes = new Map<string, string>();               // 当前午间投票 voterId -> targetId
  private board: Rule[] = [];                              // 板上随机规则（可被换走）
  private pool: Rule[] = [];                               // 备选池（理事长换规来源）
  private todayViolationEvents = 0;                        // 今日干事违规事件数 = 夜间检举弹药数
  private accuse = { attempts: 0, failures: 0, swapped: false }; // 夜间检举状态（每晚重置）
  private callTargets = new Set<string>();                 // 今夜被呼唤的学生（F7）

  onCreate(options: JoinOptions) {
    this.setState(new GameState());
    this.timeScale = options.timeScale ?? 1;
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
    // M2 流程：投票 / 检举 / 换规
    this.onMessage("vote", (client, msg: { targetId?: string }) => this.onVote(client, msg));
    this.onMessage("accuse", (client, msg: { targetId?: string }) => this.onAccuse(client, msg));
    this.onMessage("swapRule", (client, msg: { outId?: string; inId?: string }) => this.onSwapRule(client, msg));
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new Player();
    p.name = String(options.name || `同学${this.state.players.size + 1}`).slice(0, 12);
    p.gender = options.gender === "female" ? "female" : "male";
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.broadcast("notice", { text: `${p.name} 进入了校园（${this.state.players.size} 人在线）` });
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (this.state.phase === "lobby") {
      this.state.players.delete(client.sessionId);
      this.factionOf.delete(client.sessionId);
      if (this.state.hostId === client.sessionId) {
        this.state.hostId = this.state.players.keys().next().value ?? "";
      }
    } else if (p) {
      p.connected = false; // 游戏中掉线保留角色
    }
  }

  onDispose() {
    this.timer.stop();
  }

  // ---------- 开局 ----------

  private startGame(client: Client) {
    if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
    const ids = [...this.state.players.keys()];
    if (ids.length < 5) return;

    // 阵营分配：≥9 人 3 理事长，5–8 人 2 理事长（7:3 体验局见沙盘推演报告附 3）
    const nChair = ids.length >= 9 ? 3 : 2;
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    shuffled.forEach((id, i) => this.factionOf.set(id, i < nChair ? "chair" : "student"));

    const { board, pool } = drawRuleBoard();
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
      });
    });

    this.state.day = 0;
    this.enterPhase("morning", 0);
  }

  // ---------- 时段推进 ----------

  private enterPhase(phase: Phase, day: number) {
    this.state.phase = phase;
    this.state.phaseEndsAt = this.timer.start(phase, day, () => this.onPhaseEnd(phase, day));
    this.broadcast("phase", { phase, day, endsAt: this.state.phaseEndsAt });

    if (phase === "morning") {
      this.state.players.forEach((p, id) => {
        if (!p.alive) return;
        p.ap = 10;
        this.recs.set(id, newDayRecord());       // 每日记录清零
        this.prevNode.set(id, p.nodeId);
      });
      this.todayViolationEvents = 0;
      this.votes.clear();
    }
    if (phase === "noon") {
      // 集体自动前往食堂（不消耗 AP）
      this.state.players.forEach((p) => { if (p.alive) p.nodeId = "canteen"; });
      this.broadcast("notice", { text: `午间讨论开始${day === 0 ? "（第 0 日不投票）" : "，请全员投票（弃权视为违规）"}` });
    }
    if (phase === "night") {
      this.accuse = { attempts: 0, failures: 0, swapped: false };
      this.callTargets.clear();
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
    }
  }

  private onPhaseEnd(phase: Phase, day: number) {
    if (this.state.phase === "ended") return;

    // 时段结束类违规判定（noon/evening，针对干事）
    if (phase === "noon" || phase === "evening") {
      for (const id of this.aliveIds()) {
        if (this.factionOf.get(id) !== "student") continue;
        const ctx = this.makeCtx(id);
        for (const ruleId of phaseEndViolations(ctx)) this.violate(id, ruleId);
      }
    }
    if (phase === "noon") {
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
    if (!p || !p.alive || this.state.phase === "lobby") return;
    const target = NODES.find((n) => n.id === msg?.nodeId);
    const ok = target && EDGES.some(([a, b]) => (a === p.nodeId && b === target.id) || (b === p.nodeId && a === target.id));
    if (!ok || p.ap < 1) return;

    const from = p.nodeId;
    p.nodeId = target.id;
    p.ap -= 1;
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

  /** 通用动作入口：行为记录 + 规则引擎判定 */
  private onAction(client: Client, action: Action) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || this.state.phase === "lobby") return;
    const rec = this.recs.get(client.sessionId);
    if (action.type === "exercise" && rec) rec.exercised = true;
    if (action.type === "medicine" && rec) rec.medicined = true;
    if (action.type === "doorplate" && rec) {
      if (p.nodeId !== "dorm") return; // 只有在宿舍才能确认门牌
      rec.doorplate = true;
      this.sendNoticeTo(client.sessionId, "你确认了门牌号。今天它没有变。");
      return;
    }
    this.runChecks(client.sessionId, action);
  }

  private onVote(client: Client, msg: { targetId?: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    if (this.state.phase !== "noon" || this.state.day === 0) return;
    const targetId = String(msg?.targetId ?? "");
    const t = this.state.players.get(targetId);
    if (!t || !t.alive || targetId === client.sessionId) return; // 不允许自投
    this.votes.set(client.sessionId, targetId);
    const rec = this.recs.get(client.sessionId);
    if (rec) rec.voted = true;
    this.sendNoticeTo(client.sessionId, `投票已记录。当前已投 ${this.votes.size} 人`);
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
    if (guilty) {
      const dmg = 25 + 5 * this.state.day;
      t.hp -= dmg;
      this.broadcast("notice", { text: `【夜间通报】理事长检举成立：${t.name} 今日确有违规，HP -${dmg}（余 ${Math.max(0, Math.round(t.hp))}）。检举成功，可继续检举或更换一条规则。` });
      if (t.hp <= 0) this.eliminate(targetId, "检举处决");
    } else {
      this.accuse.failures++;
      const left = 2 - this.accuse.failures;
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
    const ctx = this.makeCtx(id);
    for (const ruleId of this.activeRuleIds()) {
      let hit = false;
      if (action.type === "chat") {
        // R8 单独计数：第 9 条起违规，每时段只通报一次
        const rec = this.recs.get(id)!;
        rec.chats++;
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

  /** 记违规：匿名通报（不显示哪一条），干事违规事件数 = 夜间弹药 */
  private violate(id: string, ruleId: string) {
    if (this.factionOf.get(id) !== "student") return;
    const rec = this.recs.get(id);
    rec?.violations.push(ruleId);
    this.todayViolationEvents++;
    this.broadcast("notice", { text: "【通报】一名学生违反了校规。" });
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
    this.votes.forEach((target, voter) => {
      if (!this.state.players.get(voter)?.alive) return;
      tally.set(target, (tally.get(target) ?? 0) + 1);
    });
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
    this.state.players.forEach((p, id) => { if (p.alive) out.push(id); });
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
