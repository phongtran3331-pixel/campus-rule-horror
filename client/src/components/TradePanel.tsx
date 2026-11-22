import { useEffect, useMemo, useState } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import type { GameRoom } from "../lib/client";

// 图标暂用开源 Twemoji 网图（cdn.jsdelivr.net），素材就位后可整体替换为本地图
function twemojiSrc(emoji: string): string {
  const hex = [...emoji].map((c) => c.codePointAt(0)!.toString(16)).filter((h) => h !== "fe0f").join("-");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${hex}.png`;
}

interface Goods { ref?: string; kind?: string; name: string; base: number; icon: string }
interface ShopDef { title: string; goods: Goods[] }
type ShopFile = Record<string, ShopDef>;

interface Props {
  room: GameRoom;
  me: Player;
  shop: string;          // "market" | "clinic"（即节点 id）
  onClose: () => void;
}

/** 超市 / 药房交易面板：当日全局统一价（逐日累积随机涨价）、全局库存、余额校验 */
export function TradePanel({ room, me, shop, onClose }: Props) {
  const [file, setFile] = useState<ShopFile | null>(null);
  const [wiki, setWiki] = useState<Record<string, { desc?: string; effect?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetch("shop.json").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead && j) setFile(j); }).catch(() => {});
    fetch("wiki.json").then((r) => (r.ok ? r.json() : {})).then((j) => { if (!dead) setWiki(j); }).catch(() => {});
    return () => { dead = true; };
  }, []);

  const def = file?.[shop];
  const state = room.state;
  const dayN = state.day + 1;

  const priceOf = (g: Goods) => state.shopPrices.get(`${shop}:${g.ref ?? g.kind ?? g.name}`) ?? g.base;
  const stockOf = (g: Goods) => state.shopStock.get(`${shop}:${g.ref ?? g.kind ?? g.name}`) ?? 0;

  const effectText = (name: string) => {
    const eff = wiki[name]?.effect ?? "";
    return eff.replace(/(饥饿|HP|SAN|AP)([+-]\d+)/g, "$1 $2");
  };

  const buy = (g: Goods) => {
    const key = g.ref ?? g.kind ?? g.name;
    setBusy(key);
    room.send("shopBuy", { shop, key });
    window.setTimeout(() => setBusy((b) => (b === key ? null : b)), 450);
  };

  const goods = useMemo(() => def?.goods ?? [], [def]);
  if (!def) return null;

  return (
    <div className="tp-root" onClick={onClose}>
      <div className="tp-card" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head">
          <div>
            <h3 className="tp-title">{def.title}</h3>
            <p className="tp-sub">第 {dayN} 日 · 今日全校统一价 · 存货全场共享</p>
          </div>
          <div className="tp-side">
            <span className="tp-coins">🪙 {Math.round(me.coins)}</span>
            <button className="t-back" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="tp-grid">
          {goods.map((g) => {
            const price = priceOf(g);
            const stock = stockOf(g);
            const up = price > g.base;
            const soldOut = stock <= 0;
            return (
              <div key={g.ref ?? g.kind} className={`tp-item${soldOut ? " out" : ""}`}>
                <img className="tp-icon" src={twemojiSrc(g.icon)} alt={g.name} draggable={false}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <div className="tp-info">
                  <span className="tp-name">{g.name}</span>
                  <span className="tp-desc">{wiki[g.name]?.desc ?? ""}</span>
                  <span className="tp-fx">{effectText(g.name)}</span>
                </div>
                <div className="tp-act">
                  <span className={`tp-price${up ? " up" : ""}`}>{price} 币{up ? " ↑" : ""}</span>
                  <span className="tp-stock">{soldOut ? "售罄" : `余 ${stock}`}</span>
                  <button
                    className="tp-buy"
                    disabled={soldOut || busy === (g.ref ?? g.kind)}
                    onClick={() => buy(g)}
                  >购买</button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="tp-foot">价格随存活天数逐日上涨。买定离手，概不还价。</p>
      </div>
    </div>
  );
}
