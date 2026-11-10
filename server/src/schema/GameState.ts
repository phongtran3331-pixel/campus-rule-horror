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
  // 背包（M3）：数量均同步给本人客户端
  @type("number") food = 0;        // 食物（进食 +30 饥饿）
  @type("number") medicine = 0;    // 药物（用药 +30HP 或 +20SAN）
  @type("number") scissors = 0;    // 剪刀（剪网线，M4 网络中心用）
  @type("number") coffee = 0;      // 咖啡券（咖啡屋 +50HP 或 +30SAN）
  @type("number") junk = 0;        // 杂物件数
  @type("number") junkValue = 0;   // 杂物总价值（回收站变现）
  @type("number") cards = 0;       // 行政楼查阅卡（M4 影像室用）
  @type("string") keys = "";       // 社区房间钥匙，逗号分隔：key_office/key_dept/key_cce/key_press
  @type({ map: "number" }) items = new MapSchema<number>(); // 实体背包：物品目录 id → 数量
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") hostId = "";
  @type("string") phase: "lobby" | "morning" | "noon" | "afternoon" | "evening" | "night" | "ended" = "lobby";
  @type("number") day = 0;                    // 0..4，Day4 后结算
  @type("number") phaseEndsAt = 0;            // epoch ms，0 = 未计时
  @type("number") phaseStartedAt = 0;         // 本时段开始 epoch ms（客户端换算虚拟时刻）
  @type("boolean") netDown = false;           // M4：网络中心被破坏，全员失去玩家位置视野
  @type("string") rulesVersion = "v1.4";
}
