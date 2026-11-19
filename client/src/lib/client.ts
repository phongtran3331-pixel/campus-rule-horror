import { Client, Room } from "colyseus.js";
import type { GameState } from "../../../server/src/schema/GameState";

export type Faction = "student" | "chair";

export interface RuleMsg { id: string; name: string; text: string }

export interface RoleMsg {
  faction: Faction;
  chairs: Array<{ id: string; name: string }>; // 仅理事长可见同伴名单
  pool?: RuleMsg[];                            // 仅理事长：备选规则池（换规用）
}

export interface RuleSwapMsg {
  board: RuleMsg[];
}

/** 夜间检举状态（全员可见；夜间通报本就公开成败） */
export interface AccuseStateMsg {
  attempts: number;  // 已用弹药
  ammo: number;      // 今日弹药上限 = 干事违规事件数
  failures: number;  // 连续失败计数（2 次终止今晚检举权）
  swapped: boolean;  // 今晚是否已换规
}

export interface GameOverMsg {
  winner: Faction;
  detail: string;
  reason: string;
  chairs: string[];
  students: string[];
}

// 服务端直连：开发环境 ws://<本机>:2567；部署时以 VITE_SERVER_URL 覆盖
const url =
  import.meta.env.VITE_SERVER_URL ??
  `ws://${location.hostname}:2567`;

export const colyseus = new Client(url);

export type GameRoom = Room<GameState>;

export interface RoomInit {
  nodes: Array<{ id: string; name: string; x: number; y: number; type: "A" | "B"; desc: string }>;
  edges: Array<[string, string]>;
  fixedRules: RuleMsg[];
  ruleBoard: RuleMsg[];
  dayTotal: number;
  lootMult: number;
}
