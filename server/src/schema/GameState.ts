import { MapSchema, Schema, type } from "@colyseus/schema";

// 阵营为服务端私有（社交推理核心机密），经 "role" 私发消息告知本人，不进同步状态
export type Faction = "none" | "student" | "chair";

export class Player extends Schema {
  @type("string") name = "";
  @type("string") gender = ""; // male | female（R1 判定需要）
  @type("string") nodeId = "dorm";
  @type("number") hp = 100;
  @type("number") san = 100;
  @type("number") ap = 10;
  @type("number") hunger = 100;
  @type("number") coins = 20;
  @type("boolean") alive = true;
  @type("boolean") connected = true;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") hostId = "";
  @type("string") phase: "lobby" | "morning" | "noon" | "afternoon" | "evening" | "night" | "ended" = "lobby";
  @type("number") day = 0;                    // 0..4，Day4 后结算
  @type("number") phaseEndsAt = 0;            // epoch ms，0 = 未计时
  @type("string") rulesVersion = "v1.4";
}
