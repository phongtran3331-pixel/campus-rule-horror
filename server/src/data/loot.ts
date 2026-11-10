// 物资与物价配置（M3）：探索掉落表、商店价格、回收价值
// 物资丰度系数 lootMult 由沙盘定稿 ×1.5（docs/沙盘推演报告.md），开局经 init 下发
export interface LootResult {
  junk?: number;      // 杂物件数
  junkValue?: number; // 杂物总价值（×lootMult 后取整）
  food?: number;
  medicine?: number;
  scissors?: number;
  coffee?: number;
  card?: number;
  key?: string;       // 社区房间钥匙
}

export const LOOT_MULT = 1.5;

// 概率（理事长假装探索时不下发任何实际内容）
const TABLE: Array<[keyof LootResult & string, number]> = [
  ["junk", 0.46],
  ["food", 0.2],
  ["medicine", 0.09],
  ["scissors", 0.07],
  ["coffee", 0.06],
  ["card", 0.04],
  ["key", 0.08],
];

export const COMMUNITY_KEYS = ["key_office", "key_dept", "key_cce", "key_press"] as const;

export const PRICES = {
  food: 5,       // 超市：食物
  scissors: 15,  // 超市：剪刀
  medicine: 12,  // 校医院：药物（hp/san 同价，用药时选择效果）
  meal: 3,       // 食堂：午间套餐（+40 饥饿，20% 概率食物有问题）
  gym: 5,        // 体育馆入场费（运动效果优于操场）
} as const;

/** 探索一次（1 AP）：按权重抽一类物资；已集齐钥匙则钥匙格转为杂物 */
export function rollLoot(
  ownedKeys: ReadonlySet<string>,
  mult: number = LOOT_MULT,
  rand: () => number = Math.random,
): LootResult {
  let x = rand();
  let kind: string = "junk";
  for (const [k, w] of TABLE) {
    if ((x -= w) < 0) { kind = k; break; }
  }
  if (kind === "key") {
    const missing = COMMUNITY_KEYS.filter((k) => !ownedKeys.has(k));
    if (missing.length === 0) kind = "junk";
    else return { key: missing[Math.floor(rand() * missing.length)] };
  }
  switch (kind) {
    case "food": return { food: 1 };
    case "medicine": return { medicine: 1 };
    case "scissors": return { scissors: 1 };
    case "coffee": return { coffee: 1 };
    case "card": return { card: 1 };
    default: {
      const n = 1 + (rand() < 0.5 ? 1 : 0); // 1–2 件
      const v = Math.max(1, Math.round((2 + rand() * 3) * mult)); // 单件 2–5 币 × 丰度
      return { junk: n, junkValue: n * v };
    }
  }
}
