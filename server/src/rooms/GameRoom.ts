import { Room, Client } from "colyseus";
import { GameState, Player } from "../schema/GameState.js";
import { EDGES, NODES } from "../data/map.js";
import { FIXED_RULES, drawRuleBoard } from "../data/rules.js";
import { PhaseTimer, PHASE_ORDER, type Phase } from "../logic/PhaseTimer.js";

interface JoinOptions {
  name?: string;
  gender?: string;
  timeScale?: number;
}

export class GameRoom extends Room<GameState> {
  maxClients = 12; // 9–12 人局
  private timer!: PhaseTimer;
  private timeScale = 1;

  onCreate(options: JoinOptions) {
    this.setState(new GameState());
    this.timeScale = options.timeScale ?? 1;
    this.timer = new PhaseTimer(this.timeScale);

    this.onMessage("start", (client) => this.startGame(client));
    this.onMessage("chat", (client, msg: { text?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && msg?.text) {
        this.broadcast("chat", { from: p.name, text: String(msg.text).slice(0, 200) });
      }
    });
    // M1 占位：移动 / 交互 / 投票 / 检举等动作接口在后续里程碑接入规则引擎
    this.onMessage("move", (client, msg: { nodeId?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || this.state.phase === "lobby") return;
      const target = NODES.find((n) => n.id === msg?.nodeId);
      const ok = target && EDGES.some(([a, b]) => (a === p.nodeId && b === target.id) || (b === p.nodeId && a === target.id));
      if (ok && p.ap >= 1) {
        p.nodeId = target.id;
        p.ap -= 1;
      }
    });
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

  // ---------- 流程 ----------

  private startGame(client: Client) {
    if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
    const ids = [...this.state.players.keys()];
    if (ids.length < 5) return;

    // 阵营分配：≥9 人 3 理事长，5–8 人 2 理事长（7:3 体验局见沙盘推演报告附 3）
    const nChair = ids.length >= 9 ? 3 : 2;
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    shuffled.forEach((id, i) => {
      this.state.players.get(id)!.faction = i < nChair ? "chair" : "student";
    });

    const { board, pool } = drawRuleBoard();
    this.broadcast("init", {
      nodes: NODES,
      edges: EDGES,
      fixedRules: FIXED_RULES,
      ruleBoard: board,
      rulePool: pool, // 仅服务端持有，客户端不推送（理事长更换权后续由服务端裁决）
      dayTotal: 4,
      lootMult: 1.5, // 沙盘定稿：物资丰度 ×1.5
    });

    this.state.day = 0;
    this.enterPhase("morning", 0);
  }

  private enterPhase(phase: Phase, day: number) {
    this.state.phase = phase;
    this.state.phaseEndsAt = this.timer.start(phase, day, () => this.onPhaseEnd(phase, day));
    this.broadcast("phase", { phase, day, endsAt: this.state.phaseEndsAt });

    // M1 占位：时段切换时重置 AP 等数值逻辑在规则引擎接入后补齐
    if (phase === "morning") {
      this.state.players.forEach((p) => { if (p.alive) p.ap = 10; });
    }
  }

  private onPhaseEnd(phase: Phase, day: number) {
    const idx = PHASE_ORDER.indexOf(phase);
    if (idx < PHASE_ORDER.length - 1) {
      this.enterPhase(PHASE_ORDER[idx + 1] as Phase, day);
    } else if (day < 4) {
      this.state.day = day + 1;
      this.enterPhase("morning", day + 1);
    } else {
      this.state.phase = "ended";
      this.timer.stop();
      // M1 占位：胜负判定（理事长全灭 / Day4 结算比例）后续接入
      this.broadcast("notice", { text: "对局结束（胜负结算待规则引擎接入）" });
    }
  }
}
