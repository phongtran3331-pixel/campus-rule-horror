// 规则引擎：把固定规则 F1–F8 与随机规则 R1–R12 翻译为可程序化判定
// 判定原则（docs/校园规矩明细.md v1.4）：
//   · 每条规则必须可通过操作或配合避免；不可避免者已调整
//   · 违规只广播匿名通报（不显示是哪一条），理事长须熟记规则才能抓人
//   · 部分规则附带即时惩罚（INSTANT_PENALTY）
import type { Phase } from "./PhaseTimer.js";

// ---------- 玩家动作（客户端 → 房间 → 引擎） ----------
export type Action =
  | { type: "move"; from: string; to: string }
  | { type: "enterRoom"; roomId: string }        // 进入 A 类节点子房间，roomId = "<nodeId>:<房号>"
  | { type: "eat"; nodeId: string }              // 进食（随身食物/食堂）
  | { type: "brawl"; nodeId: string }            // 使用杠铃杆（打闹）
  | { type: "exercise" }                         // 操场/体育馆运动
  | { type: "medicine" }                         // 用药（校医院药物）
  | { type: "doorplate" }                        // 回宿舍确认门牌（R12）
  | { type: "respondCall" }                      // 夜间回应呼唤（F7）
  | { type: "talkRed" }                          // 与红色校服同学搭话（R9）
  | { type: "chat" };                            // 公共频道发言（R8 计数）

// ---------- 当日行为记录（服务端私有，不同步给客户端） ----------
export interface DayRecord {
  violations: string[];  // 今日违规的规则 id（同一条可多次）
  exercised: boolean;    // 今日是否运动过（R11 免责）
  medicined: boolean;    // 今日是否用药过（R11 免责）
  doorplate: boolean;    // 回宿舍后是否确认过门牌（R12）
  voted: boolean;        // 今日午间是否投过票（F8）
  chats: number;         // 当前时段公共频道发言数（R8）
  r8Fired: boolean;      // R8 本时段已通报过（只记一次，避免刷屏刷弹药）
}

export function newDayRecord(): DayRecord {
  return { violations: [], exercised: false, medicined: false, doorplate: false, voted: false, chats: 0, r8Fired: false };
}

// ---------- 引擎上下文 ----------
export interface PlayerSnap {
  id: string;
  gender: string;   // male | female（R1 判定）
  nodeId: string;
  hp: number;
  san: number;
}

export interface EngineCtx {
  day: number;
  phase: Phase;
  players: PlayerSnap[];            // 全部存活玩家（含 me）
  meId: string;
  prevNode: ReadonlyMap<string, string>;  // 每人上一次所在节点（R2 尾随判定）
  rec: DayRecord;
}

export const TEACHING = ["tA", "tB", "tC"];
export const DORM = "dorm";

// F2 上课中教室：按日轮换（进错当场惩罚）
const CLASS_IN_SESSION: Record<number, string[]> = {
  0: ["tA:201", "tA:303"],
  1: ["tB:202"],
  2: ["tC:301", "tA:104"],
  3: ["tB:304"],
  4: ["tA:202"],
};

/** 即时惩罚：违规同时当场扣除（F2 打扰教学） */
export const INSTANT_PENALTY: Record<string, { hp?: number; san?: number }> = {
  F2: { hp: 10, san: 10 },
};

const me = (ctx: EngineCtx) => ctx.players.find((p) => p.id === ctx.meId)!;
const occupants = (ctx: EngineCtx, nodeId: string) => ctx.players.filter((p) => p.nodeId === nodeId);

/**
 * 动作即时判定：给定生效规则 id，判断该动作是否违规。
 * 位置类规则只在动作发生的瞬间判定（进入即算），停留类规则见 phaseEndViolations。
 */
export function checkAction(ruleId: string, action: Action, ctx: EngineCtx): boolean {
  const m = me(ctx);
  switch (ruleId) {
    case "F1": // 上午禁止出现在宿舍
      return action.type === "move" && action.to === DORM && ctx.phase === "morning";
    case "F2": // 进入上课中的教室
      return action.type === "enterRoom" && (CLASS_IN_SESSION[ctx.day] ?? []).includes(action.roomId);
    case "F3": // 教学楼内禁止进食
      return action.type === "eat" && TEACHING.includes(action.nodeId);
    case "F4": // 教学楼/图书馆禁止打闹
      return action.type === "brawl" && [...TEACHING, "library"].includes(action.nodeId);
    case "F6": // 进入不存在的教室（404）
      return action.type === "enterRoom" && /(^|:)404$/.test(action.roomId);
    case "F7": // 熄灯后不应答呼唤
      return action.type === "respondCall";
    case "R1": { // 男女生不得单独相处：move 后目标节点恰好一男一女
      if (action.type !== "move") return false;
      const occ = occupants(ctx, action.to);
      return (
        occ.length === 2 &&
        occ.some((p) => p.gender === "male") &&
        occ.some((p) => p.gender === "female")
      );
    }
    case "R2": { // 禁止尾随：A 跟着 B 从同一节点来到同一节点，且抵达时只剩两人
      if (action.type !== "move") return false;
      const occ = occupants(ctx, action.to).filter((p) => p.id !== m.id);
      if (occ.length !== 1) return false;
      const b = occ[0];
      return ctx.prevNode.get(m.id) !== undefined && ctx.prevNode.get(m.id) === ctx.prevNode.get(b.id);
    }
    case "R3": // 体育馆宵禁：晚间进入体育馆
      return action.type === "move" && action.to === "gym" && ctx.phase === "evening";
    case "R4": // 图书馆午休：午间进入图书馆
      return action.type === "move" && action.to === "library" && ctx.phase === "noon";
    case "R5": // 宿舍禁食
      return action.type === "eat" && action.nodeId === DORM;
    case "R6": // 白天禁止在大门逗留
      return action.type === "move" && action.to === "gate" && (ctx.phase === "morning" || ctx.phase === "afternoon");
    case "R7": // 生命值高于 80 者禁止进入行政楼
      return action.type === "move" && action.to === "admin" && m.hp > 80;
    case "R8": // 上午/下午公共频道发言不得超过 8 条（第 9 条起违规，每时段通报一次）
      return action.type === "chat" && (ctx.phase === "morning" || ctx.phase === "afternoon");
    case "R9": // 见到红色校服不要搭话
      return action.type === "talkRed";
    case "R10": // 午间讨论期间不要离开食堂
      return action.type === "move" && action.from === "canteen" && ctx.phase === "noon";
    default:
      return false;
  }
}

/**
 * 时段结束判定：返回 me 在 phase 结束时因"停留状态/未完成义务"违规的规则 id 列表。
 * 由 GameRoom 在 noon / evening 结束时对每个干事调用。
 */
export function phaseEndViolations(ctx: EngineCtx): string[] {
  const m = me(ctx);
  const out: string[] = [];
  switch (ctx.phase) {
    case "noon":
      if (!ctx.rec.voted) out.push("F8");            // 禁止空票
      if (m.nodeId === "library") out.push("R4");    // 午间闭馆停留
      break;
    case "evening":
      if (m.nodeId !== DORM) out.push("F5");         // 21:00 前必须回到宿舍
      if (m.nodeId === "gym") out.push("R3");        // 宵禁停留
      if (m.san < 40 && !ctx.rec.exercised && !ctx.rec.medicined) out.push("R11"); // 精神自检
      if (m.nodeId === DORM && !ctx.rec.doorplate) out.push("R12"); // 门牌确认
      break;
    default:
      break;
  }
  return out;
}
