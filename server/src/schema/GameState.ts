import { MapSchema, Schema, type } from "@colyseus/schema";

// 阵营为服务端私有（社交推理核心机密），经 "role" 私发消息告知本人，不进同步状态
export type Faction = "none" | "student" | "chair";

export class Player extends Schema {
  @type("string") name = "";
  @type("string") gender = ""; // male | female（R1 判定需要）
  @type("string") avatar = "";  // 头像：emoji 或图片 dataURL / 路径
  @type("boolean") observer = false; // 主持人：开房间但不参战，可观战全员位置
  @type("boolean") ready = false;    // 开局前的准备就绪确认
  @type("boolean") lunchDone = false; // 今日午餐是否已结算
  @type("string") nodeId = "dorm";
  @type("number") hp = 100;
  @type("number") san = 100;
  @type("number") ap = 20;
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
  @type({ map: "number" }) pack = new MapSchema<number>();  // 场景文本背包：物品 ref「段#号」→ 数量
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") hostId = "";
  @type("string") phase: "lobby" | "ready" | "morning" | "noon" | "afternoon" | "evening" | "night" | "ended" = "lobby";
  @type("number") day = 0;                    // 0..4，Day4 后结算
  @type("number") phaseEndsAt = 0;            // epoch ms，0 = 未计时
  @type("number") phaseStartedAt = 0;         // 本时段开始 epoch ms（客户端换算虚拟时刻）
  @type("boolean") netDown = false;           // M4：网络中心被破坏，全员失去玩家位置视野
  @type("boolean") lunchOpen = false;          // noon：午餐询问进行中，全员选完才进入讨论
  @type({ map: "number" }) shopPrices = new MapSchema<number>(); // 「market:耗#1」→ 当日价
  @type({ map: "number" }) shopStock = new MapSchema<number>();  // 「market:耗#1」→ 全局库存
  @type("string") rulesVersion = "v1.4";
}
