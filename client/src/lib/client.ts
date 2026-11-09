import { Client, Room } from "colyseus.js";
import type { GameState } from "../../../server/src/schema/GameState";

// 服务端直连：开发环境 ws://<本机>:2567；部署时以 VITE_SERVER_URL 覆盖
const url =
  import.meta.env.VITE_SERVER_URL ??
  `ws://${location.hostname}:2567`;

export const colyseus = new Client(url);

export type GameRoom = Room<GameState>;

export interface RoomInit {
  nodes: Array<{ id: string; name: string; x: number; y: number; type: "A" | "B" }>;
  edges: Array<[string, string]>;
  fixedRules: Array<{ id: string; name: string; text: string }>;
  ruleBoard: Array<{ id: string; name: string; text: string }>;
  dayTotal: number;
  lootMult: number;
}
