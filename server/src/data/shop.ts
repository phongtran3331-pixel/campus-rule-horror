// 商店目录：超市 / 校医院药房（高价、逐日累积随机涨价 8%–18%、全局统一、全局库存）
// 数据源 client/public/shop.json（与客户端交易面板同一份）
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShopGoods {
  ref?: string;   // wiki 消耗品 ref（入实体背包，usePack 使用）
  kind?: string;  // 特殊种类（如 field:scissors → 传统字段）
  name: string;
  base: number;   // 第 1 日标价
  icon: string;   // emoji（客户端转 twemoji 网图）
}
export interface ShopDef { title: string; npc: string; goods: ShopGoods[] }

const SHOP_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "client", "public", "shop.json");

export type ShopKey = "market" | "clinic";
export const SHOP_NODE: Record<ShopKey, string> = { market: "market", clinic: "clinic" };

export function loadShops(): Record<ShopKey, ShopDef> {
  try { return JSON.parse(readFileSync(SHOP_PATH, "utf-8")); } catch { return { market: { title: "超市", npc: "marketBoss", goods: [] }, clinic: { title: "药房", npc: "doctor", goods: [] } }; }
}

/** 商品在价格/库存表中的键 */
export const goodsKey = (g: ShopGoods): string => g.ref ?? g.kind ?? g.name;

/** 每日涨价：8%–18% 随机，向上取整，当日全局统一 */
export function nextPrice(prev: number, rand: () => number = Math.random): number {
  return Math.ceil(prev * (1 + 0.08 + rand() * 0.10));
}

export const SHOP_STOCK_INIT = 4;
export const SHOP_STOCK_MAX = 6;
export const SHOP_RESTOCK = 2;
