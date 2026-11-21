import { useEffect, useState, type ReactNode } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import { ITEM_CATALOG, type ItemDef } from "../../../server/src/data/items";
import type { AccuseStateMsg, Faction, GameRoom, RoomInit, RuleMsg } from "../lib/client";
import { virtualClock } from "../lib/vtime";

interface Msg { kind: string; from?: string; text: string }

interface Props {
  room: GameRoom;
  me: Player | undefined;
  myFaction: Faction | null;
  phase: string;
  day: number;
  endsAt: number;
  startedAt: number;
  netDown: boolean;
  players: Array<[string, Player]>;
  msgs: Msg[];
  onSendChat: (t: string) => void;
  onOpenExplore: () => void;
  init: RoomInit | null;
  accuse: AccuseStateMsg | null;
  rulePool: RuleMsg[];
  chairs: Array<{ id: string; name: string }>;
  nodeName: string;
}

const PHASE_LABEL: Record<string, string> = {
  lobby: "集合", morning: "上午", noon: "中午", afternoon: "下午",
  evening: "晚上", night: "深夜", ended: "结束",
};

const APPS = [
  { id: "bag",      name: "背包",     icon: "🎒" },
  { id: "chat",     name: "聊天",     icon: "💬" },
  { id: "wall",     name: "校园墙",   icon: "📰" },
  { id: "tasks",    name: "任务",     icon: "📋" },
  { id: "explore",  name: "自由探索", icon: "🧭" },
  { id: "notes",    name: "备忘录",   icon: "📝" },
  { id: "booking",  name: "校园预约", icon: "📅" },
  { id: "profile",  name: "档案信息", icon: "🪪" },
] as const;
type AppId = (typeof APPS)[number]["id"];

export function Terminal(props: Props) {
  const [app, setApp] = useState<AppId | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);

  const { me, phase, day, endsAt, startedAt, nodeName } = props;
  const remain = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const clock = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;
  const vtime = virtualClock({ phase: phase as never, phaseStartedAt: startedAt, phaseEndsAt: endsAt });

  return (
    <div className="terminal">
      {/* 状态栏：左时间卡 / 中位置 / 右状态卡 */}
      <div className="t-statusbar">
        <button className="t-chip t-time" onClick={() => setApp("tasks")} title="今日日程">
          <b>{vtime}</b>
          <span>Day {day} · {PHASE_LABEL[phase] ?? phase}</span>
        </button>
        <span className="t-pos">📍 {nodeName}</span>
        <button className={`t-chip t-statchip${showStats ? " on" : ""}${props.netDown ? " netdown" : ""}`} onClick={() => setShowStats((v) => !v)}>
          {props.netDown ? "📵 断网" : "📶 状态"}
        </button>
      </div>

      {/* 状态面板（点右上「状态」展开） */}
      {showStats && me && (
        <div className="t-stats">
          <Stat label="❤️ HP" v={me.hp} max={100} cls="hp" />
          <Stat label="🧠 SAN" v={me.san} max={100} cls="san" />
          <Stat label="⚡ AP" v={me.ap} max={15} cls="ap" />
          <Stat label="🍚 饥饿" v={me.hunger} max={100} cls="hunger" />
          <Stat label="🪙 币" v={me.coins} max={100} cls="coins" showNum />
        </div>
      )}

      {/* 桌面 / 应用 */}
      <div className="t-screen">
        {app === null ? (
          <>
            <div className="t-clock">{endsAt > 0 && phase !== "lobby" ? clock : vtime}</div>
            {/* 阶段直达入口：当前最重要的事放桌面顶部 */}
            {phase === "noon" && day > 0 && (
              <button className="t-cta vote" onClick={() => setApp("explore")}>🗳️ 午间投票进行中 — 点我前往</button>
            )}
            {phase === "night" && props.myFaction === "chair" && (
              <button className="t-cta chair" onClick={() => setApp("explore")}>🎯 理事长夜间行动 — 点我前往</button>
            )}
            {phase === "evening" && !props.netDown && (
              <button className="t-cta" onClick={() => setApp("explore")}>🌆 21:00 前务必返回宿舍</button>
            )}
            <div className="t-grid">
              {APPS.map((a) => (
                <button key={a.id} className="t-app" onClick={() => setApp(a.id)}>
                  <span className="t-icon">{a.icon}</span>
                  <span className="t-name">{a.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="t-appview">
            <div className="t-appbar">
              <button className="t-back" onClick={() => setApp(null)}>‹</button>
              <span>{APPS.find((a) => a.id === app)!.name}</span>
              <span style={{ width: 28 }} />
            </div>
            <div className="t-appbody">{renderApp(app, props)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, v, max, cls, showNum }: { label: string; v: number; max: number; cls: string; showNum?: boolean }) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div className="t-stat">
      <span className="t-stat-label">{label}</span>
      <div className="t-bar"><div className={`t-bar-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
      {showNum && <span className="t-stat-num">{Math.round(v)}</span>}
    </div>
  );
}

function Btn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button className={danger ? "act danger" : "act"} onClick={onClick}>{label}</button>;
}

function renderApp(app: AppId, p: Props): ReactNode {
  const { room, me, myFaction, phase, day, players, msgs, onSendChat, init, chairs } = p;
  if (!me) return null;
  const send = (type: string, msg?: unknown) => room.send(type, msg);

  switch (app) {
    case "bag":
      return <BagGrid me={me} room={room} />;

    case "chat":
      return <ChatPanel msgs={msgs} onSendChat={onSendChat} room={room} players={players} meId={room.sessionId} />;

    case "wall":
      return (
        <div className="chat-log t-fill">
          {msgs.filter((m) => m.kind === "notice").slice(-30).map((m, i) => (
            <div key={i} className="notice">{m.text}</div>
          ))}
        </div>
      );

    case "tasks":
      return (
        <table className="t-table">
          <tbody>
            <tr className={phase === "morning" ? "now" : ""}><td>上午</td><td>08:00–11:00 探索校园</td></tr>
            <tr className={phase === "noon" ? "now" : ""}><td>中午</td><td>11:00–13:00 食堂集会{day > 0 ? "与投票" : "（今日不投票）"}</td></tr>
            <tr className={phase === "afternoon" ? "now" : ""}><td>下午</td><td>13:00–17:00 探索校园</td></tr>
            <tr className={phase === "evening" ? "now" : ""}><td>晚上</td><td>17:00–21:00 收尾，21:00 前回宿舍</td></tr>
            <tr className={phase === "night" ? "now" : ""}><td>深夜</td><td>21:00–23:00 熄灯巡视</td></tr>
          </tbody>
        </table>
      );

    case "explore":
      return <ExplorePanel p={p} />;

    case "notes":
      return (
        <>
          <h3>固定规矩（{init?.fixedRules.length ?? 0} 条）</h3>
          <ul className="t-list">
            {(init?.fixedRules ?? []).map((r) => <li key={r.id}><b>{r.id} {r.name}</b>　{r.text}</li>)}
          </ul>
          <h3 style={{ marginTop: 12 }}>随机规矩（{init?.ruleBoard.length ?? 0} 条）</h3>
          <ul className="t-list">
            {(init?.ruleBoard ?? []).map((r) => <li key={r.id}><b>{r.id} {r.name}</b>　{r.text}</li>)}
          </ul>
        </>
      );

    case "booking":
      return <BookingApp p={p} />;

    case "profile": {
      return (
        <>
          <ul className="t-list">
            <li>姓名：{me.name}</li>
            <li>性别：{me.gender === "female" ? "女生" : "男生"}</li>
            <li>身份：{myFaction === "chair" ? "自管委理事长" : myFaction === "student" ? "自管委干事" : "—"}</li>
            <li>状态：{me.alive ? "在册" : "已出局"}</li>
            <li>当前位置：{p.nodeName}</li>
          </ul>
          <h3 style={{ marginTop: 12 }}>在校名单（{players.filter(([, q]) => q.connected).length} 人）</h3>
          <ul className="t-list">
            {players.map(([id, q], i) => (
              <li key={id} className={!q.alive ? "dead" : ""}>
                {i + 1}. {q.name}{!q.alive ? " · 已出局" : q.connected ? "" : " · 离线"}
              </li>
            ))}
          </ul>
        </>
      );
    }
  }
}

/** 实体背包：真实物品（pack=场景文本获得，wiki.json 描述）为主，旧掉落计数为杂物袋 */
interface WikiItem { seg: string; num?: number; count?: string; value: number | null; weight: number; desc: string; effect?: string }
const SEG_ORDER: Record<string, number> = { 普: 0, 高: 1, 关: 2, 耗: 3 };
// 关键物品贴图（ref → 图片），无图物品仍用段色块
const ITEM_IMG: Record<string, string> = {
  "关#1": "assets/items/key-community.png",
  "关#6": "assets/items/key-locker.png",
  "关#7": "assets/items/key-master.png",
};
let wikiCache: Record<string, WikiItem> | null = null;
function loadWiki(): Promise<Record<string, WikiItem>> {
  if (wikiCache) return Promise.resolve(wikiCache);
  return fetch("wiki.json").then((r) => (r.ok ? r.json() : {})).then((j) => { wikiCache = j; return j; }).catch(() => ({}));
}

function BagGrid({ me, room }: { me: Player; room: GameRoom }) {
  const [wiki, setWiki] = useState<Record<string, WikiItem> | null>(wikiCache);
  const [sel, setSel] = useState<{ kind: "pack"; ref: string } | { kind: "legacy"; def: ItemDef } | null>(null);
  useEffect(() => { loadWiki().then(setWiki); }, []);

  // pack 排序：段序 → 编号；负重合计
  const packEntries = [...me.pack.entries()].sort((a, b) => {
    const [sa, na] = a[0].split("#"); const [sb, nb] = b[0].split("#");
    return (SEG_ORDER[sa] - SEG_ORDER[sb]) || (Number(na) - Number(nb));
  });
  const packWeight = packEntries.reduce((sum, [ref, n]) => sum + (wiki?.[refName(ref)]?.weight ?? 0) * n, 0);
  function refName(ref: string): string {
    if (!wiki) return ref;
    const hit = Object.keys(wiki).find((k) => wiki[k].seg === ref.split("#")[0] && wiki[k].num === Number(ref.split("#")[1]));
    return hit ?? ref;
  }

  const legacyCount = (def: ItemDef): number => {
    if (def.src === "items") return me.items.get(def.id) ?? 0;
    if (def.src === "field:junk") return me.junk;
    if (def.src.startsWith("field:key_")) return me.keys.split(",").filter(Boolean).includes(def.id) ? 1 : 0;
    const field = def.src.replace("field:", "") as "food" | "medicine" | "scissors" | "coffee" | "cards";
    return me[field] ?? 0;
  };
  const legacyCells = ITEM_CATALOG.map((def) => ({ def, n: legacyCount(def) })).filter((c) => c.n > 0);

  return (
    <>
      <div className="bag-meta">
        <span>背包负重 {packWeight.toFixed(1)}</span>
        <span className="bag-meta-dim">负重越高，饥饿消耗越快</span>
      </div>
      <div className="bag-grid">
        {packEntries.map(([ref, n]) => {
          const name = refName(ref);
          const w = wiki?.[name];
          return (
            <button
              key={ref}
              className={`bag-slot has seg-${ref.split("#")[0]}${sel?.kind === "pack" && sel.ref === ref ? " sel" : ""}`}
              onClick={() => setSel({ kind: "pack", ref })}
            >
              <span className="bag-icon">
                {ITEM_IMG[ref] ? <img src={ITEM_IMG[ref]} alt={name} /> : name.slice(0, 2)}
              </span>
              <span className="bag-n">{n}</span>
            </button>
          );
        })}
        {legacyCells.map(({ def, n }) => (
          <button
            key={def.id}
            className={`bag-slot has legacy${sel?.kind === "legacy" && sel.def.id === def.id ? " sel" : ""}`}
            onClick={() => setSel({ kind: "legacy", def })}
          >
            <span className="bag-icon">{def.icon}</span>
            <span className="bag-n">{n}</span>
          </button>
        ))}
        {packEntries.length + legacyCells.length === 0 && <p className="t-empty">背包是空的。去探索吧。</p>}
      </div>
      <div className="bag-detail">
        {sel?.kind === "pack" ? (
          (() => {
            const name = refName(sel.ref);
            const w = wiki?.[name];
            const n = me.pack.get(sel.ref) ?? 0;
            return (
              <>
                {ITEM_IMG[sel.ref] && <img className="bag-photo" src={ITEM_IMG[sel.ref]} alt={name} />}
                <b>{name} ×{n}</b>
                <span className="bag-ref">{sel.ref}{w?.value != null ? ` · 回收价 ${w.value} 币` : ""}{w?.weight ? ` · 负重 ${w.weight}` : ""}</span>
                <p>{w?.desc ?? "一件来路不明的物品。"}</p>
                {w?.effect && <p className="bag-effect">{w.effect}</p>}
                {w?.seg === "耗" && n > 0 && (
                  <button
                    className="bag-use"
                    onClick={() => room.send("usePack", { ref: sel.ref })}
                  >
                    使用（剩 {n}）
                  </button>
                )}
              </>
            );
          })()
        ) : sel?.kind === "legacy" ? (
          <>
            <b>{sel.def.name}{legacyCount(sel.def) > 0 ? ` ×${legacyCount(sel.def)}` : ""}</b>
            <p>{sel.def.desc}</p>
          </>
        ) : (
          <p className="t-empty">选择一个物品查看详情。</p>
        )}
      </div>
    </>
  );
}

function ChatInput({ onSend }: { onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const go = () => { if (text.trim()) { onSend(text.trim()); setText(""); } };
  return (
    <div className="row">
      <input value={text} placeholder="公共频道发言…" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
      <button onClick={go}>发送</button>
    </div>
  );
}


/** 午间放逐投票：名单点选 + 确认（不再用 prompt） */
function VotePanel({ room, me, players, chairs }: {
  room: GameRoom; me: Player;
  players: Array<[string, Player]>; chairs: Array<{ id: string; name: string }>;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);
  const chairIds = new Set(chairs.map((c) => c.id));
  const myId = room.sessionId;

  return (
    <div className="vp">
      <p className="vp-title">午间放逐投票{voted ? "（已投）" : ""}</p>
      {!voted ? (
        <>
          <div className="vp-list">
            {players.filter(([id, q]) => q.alive && id !== myId).map(([id, q]) => (
              <button key={id} className={`vp-pick${sel === id ? " sel" : ""}`} onClick={() => setSel(id)}>
                {q.name}{chairIds.has(id) ? " · 理事长?" : ""}
              </button>
            ))}
          </div>
          <button className="act danger" disabled={!sel} onClick={() => {
            if (!sel) return;
            room.send("vote", { targetId: sel });
            setVoted(true);
          }}>确认放逐{sel ? ` ${players.find(([id]) => id === sel)?.[1].name ?? ""}` : "（先点选一人）"}</button>
        </>
      ) : (
        <p className="vp-done">票已记录。等待唱票，结果将广播公示。</p>
      )}
    </div>
  );
}

/** 第 0 日午间：讨论不计时，全员确认后跳入 14:00 */
function NoonConfirm({ room }: { room: GameRoom }) {
  const [done, setDone] = useState(false);
  return (
    <div className="vp">
      <p className="vp-title">午间讨论（第 0 日不投票）</p>
      {!done ? (
        <button className="act" onClick={() => { room.send("noonDone"); setDone(true); }}>讨论结束，确认进入 14:00</button>
      ) : (
        <p className="vp-done">已确认。等待其他人确认……</p>
      )}
    </div>
  );
}

/** 理事长夜间面板：弹药状态 / 检举（两步确认）/ 换规（板上规则 ↔ 备选池） */
function ChairPanel({ room, me, players, chairs, board, pool, accuse }: {
  room: GameRoom; me: Player;
  players: Array<[string, Player]>; chairs: Array<{ id: string; name: string }>;
  board: RuleMsg[]; pool: RuleMsg[]; accuse: AccuseStateMsg | null;
}) {
  const [accuseTarget, setAccuseTarget] = useState<string | null>(null);
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);
  const chairIds = new Set(chairs.map((c) => c.id));
  const ammo = accuse?.ammo ?? 0;
  const attempts = accuse?.attempts ?? 0;
  const failures = accuse?.failures ?? 0;
  const stopped = failures >= 2 || attempts >= ammo; // 弹药尽或两次失败即停
  const canSwap = !accuse?.swapped && attempts > 0;

  return (
    <div className="cp">
      <p className="cp-status">
        今晚弹药 <b>{ammo - attempts}</b>/{ammo} 发 · 失败 {failures}/2 · 换规 {accuse?.swapped ? "已用" : "可用"}
        {attempts === 0 && ammo === 0 && "（今日无人违规，无弹可用）"}
      </p>

      {/* 检举：先点人，再确认 */}
      <div className="cp-sec">
        <p className="cp-sec-title">检举{stopped ? "（今晚已终止）" : ""}</p>
        {!stopped && (
          <>
            <div className="vp-list">
              {players.filter(([id, q]) => q.alive && id !== room.sessionId).map(([id, q]) => (
                <button key={id} className={`vp-pick${accuseTarget === id ? " sel" : ""}`} onClick={() => setAccuseTarget(id)}>
                  {q.name}{chairIds.has(id) ? " · 理事长" : ""}
                </button>
              ))}
            </div>
            <button className="act danger" disabled={!accuseTarget} onClick={() => {
              if (!accuseTarget) return;
              room.send("accuse", { targetId: accuseTarget });
              setAccuseTarget(null);
            }}>确认检举{accuseTarget ? ` ${players.find(([id]) => id === accuseTarget)?.[1].name ?? ""}` : "（先点选一人）"}</button>
          </>
        )}
      </div>

      {/* 换规：废止一条 + 换上一条，两步 */}
      <div className="cp-sec">
        <p className="cp-sec-title">校规修正（每夜一次）{!canSwap && attempts === 0 ? "（须先检举一次）" : accuse?.swapped ? "（今晚已修正）" : ""}</p>
        {canSwap && (
          <>
            <p className="cp-hint">第一步 · 废止现行随机规矩一条：</p>
            <div className="vp-list">
              {board.map((r) => (
                <button key={r.id} className={`vp-pick rule${outId === r.id ? " sel" : ""}`} onClick={() => setOutId(r.id)}>
                  {r.id} {r.text}
                </button>
              ))}
            </div>
            <p className="cp-hint">第二步 · 从备选池换上一条：</p>
            <div className="vp-list">
              {pool.map((r) => (
                <button key={r.id} className={`vp-pick rule${inId === r.id ? " sel" : ""}`} onClick={() => setInId(r.id)}>
                  {r.id} {r.text}
                </button>
              ))}
            </div>
            <button className="act" disabled={!outId || !inId} onClick={() => {
              if (!outId || !inId) return;
              room.send("swapRule", { outId, inId });
              setOutId(null); setInId(null);
            }}>广播修正内容{outId && inId ? "" : "（先各选一条）"}</button>
            <button className="act ghost" onClick={() => { setOutId(null); setInId(null); }}>今晚不修正</button>
          </>
        )}
      </div>
    </div>
  );
}


/** 通用：存活玩家单选名单（替代 window.prompt 输编号） */
function PlayerPicker({ players, meId, sel, onSel }: {
  players: Array<[string, Player]>; meId: string; sel: string | null; onSel: (id: string) => void;
}) {
  return (
    <div className="vp-list">
      {players.filter(([id, q]) => q.alive && id !== meId).map(([id, q]) => (
        <button key={id} className={`vp-pick${sel === id ? " sel" : ""}`} onClick={() => onSel(id)}>{q.name}</button>
      ))}
    </div>
  );
}

/** 私聊 + 转账内联表单 */
function DmForm({ room, players, meId }: { room: GameRoom; players: Array<[string, Player]>; meId: string }) {
  const [target, setTarget] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [coins, setCoins] = useState("0");
  const sendDm = () => {
    if (!target) return;
    room.send("dm", { targetId: target, text, coins: Math.max(0, Number(coins) || 0) });
    setText(""); setCoins("0");
  };
  return (
    <div className="dm-form">
      <p className="cp-hint">选择私聊对象：</p>
      <PlayerPicker players={players} meId={meId} sel={target} onSel={setTarget} />
      <input value={text} placeholder="私信内容（可空）" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendDm()} />
      <div className="row">
        <input value={coins} inputMode="numeric" placeholder="转账金额" style={{ width: 110 }}
          onChange={(e) => setCoins(e.target.value)} />
        <button className="act" disabled={!target} onClick={sendDm}>发送</button>
      </div>
    </div>
  );
}

/** 聊天页：公共频道 + 可展开私聊 */
function ChatPanel({ msgs, onSendChat, room, players, meId }: {
  msgs: Msg[]; onSendChat: (t: string) => void; room: GameRoom;
  players: Array<[string, Player]>; meId: string;
}) {
  const [dmOpen, setDmOpen] = useState(false);
  return (
    <>
      <div className="chat-log t-fill">
        {msgs.filter((m) => m.kind !== "notice").map((m, i) => (
          <div key={i} className={m.kind}>
            {m.kind === "chat" ? <><b>{m.from}：</b>{m.text}</> : <i className="dm">{m.from} 私信：{m.text}</i>}
          </div>
        ))}
      </div>
      <button className="act ghost" onClick={() => setDmOpen((v) => !v)}>{dmOpen ? "收起私聊" : "私聊 / 转账"}</button>
      {dmOpen && <DmForm room={room} players={players} meId={meId} />}
      <ChatInput onSend={onSendChat} />
    </>
  );
}

/** 探索页：地图入口 / 服药 / 私聊 / 投票 / 理事长面板 */
function ExplorePanel({ p }: { p: Props }) {
  const { room, me, myFaction, phase, day, players, init, chairs } = p;
  const [dmOpen, setDmOpen] = useState(false);
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  if (!me) return null;
  return (
    <div className="row wrap">
      <button className="btn-primary eo-open" onClick={() => p.onOpenExplore()}>打开校园地图</button>
      {me.medicine > 0 && (
        <>
          <Btn label="服药 · 恢复 HP" onClick={() => send("useMedicine", { kind: "hp" })} />
          <Btn label="服药 · 恢复 SAN" onClick={() => send("useMedicine", { kind: "san" })} />
        </>
      )}
      <Btn label="私聊 / 转账" onClick={() => setDmOpen((v) => !v)} />
      {dmOpen && <DmForm room={room} players={players} meId={room.sessionId} />}
      {phase === "noon" && day === 0 && (
        <NoonConfirm room={room} />
      )}
      {phase === "noon" && day > 0 && (
        <VotePanel room={room} me={me} players={players} chairs={chairs} />
      )}
      {phase === "night" && myFaction === "chair" && (
        <ChairPanel room={room} me={me} players={players} chairs={chairs}
          board={init?.ruleBoard ?? []} pool={p.rulePool} accuse={p.accuse} />
      )}
    </div>
  );
}

/** 学生社区页：预约 + 四房间功能（点选式，无 prompt） */
function BookingApp({ p }: { p: Props }) {
  const { room, me, myFaction, players, init } = p;
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const [archA, setArchA] = useState<string | null>(null);
  const [archB, setArchB] = useState<string | null>(null);
  const [eraseId, setEraseId] = useState<string | null>(null);
  const [pressTarget, setPressTarget] = useState<string | null>(null);
  const [pressKind, setPressKind] = useState<"commend" | "guarantee" | null>(null);
  if (!me) return null;
  if (me.nodeId !== "community") return <p className="t-empty">请前往学生社区后使用本功能。</p>;
  if (myFaction !== "student") return <p className="t-empty">理事长无需预约。</p>;
  const meId = room.sessionId;

  return (
    <div className="bk">
      <div className="cp-sec">
        <p className="cp-sec-title">闸机预约（每天一段，每段≤3 人）</p>
        <div className="row wrap">
          <Btn label="预约上午段" onClick={() => send("bookSlot", { slot: "am" })} />
          <Btn label="预约下午段" onClick={() => send("bookSlot", { slot: "pm" })} />
        </div>
        <Btn label="社区部 · 调阅昨日预约" onClick={() => send("deptBookings")} />
      </div>

      <div className="cp-sec">
        <p className="cp-sec-title">办公室 · 档案调查（查两人是否同阵营，每天一份）</p>
        <p className="cp-hint">第一人：</p>
        <PlayerPicker players={players} meId={meId} sel={archA} onSel={setArchA} />
        <p className="cp-hint">第二人：</p>
        <PlayerPicker players={players} meId={meId} sel={archB} onSel={setArchB} />
        <Btn label="提交档案调查" onClick={() => {
          if (archA && archB) { send("officeArchive", { aId: archA, bId: archB }); setArchB(null); }
        }} />
      </div>

      <div className="cp-sec">
        <p className="cp-sec-title">策创部 · 抹除随机规矩（理事长不会知道）</p>
        <div className="vp-list">
          {(init?.ruleBoard ?? []).filter((r) => r.id.startsWith("R")).map((r) => (
            <button key={r.id} className={`vp-pick rule${eraseId === r.id ? " sel" : ""}`} onClick={() => setEraseId(r.id)}>
              {r.id} {r.text}
            </button>
          ))}
        </div>
        <Btn label={eraseId ? `抹除 ${eraseId}` : "先选一条规矩"} danger onClick={() => {
          if (eraseId) { send("cceErase", { ruleId: eraseId }); setEraseId(null); }
        }} />
      </div>

      <div className="cp-sec">
        <p className="cp-sec-title">宣传部 · 校园墙</p>
        <div className="row wrap">
          <Btn label="破译两条规矩" onClick={() => send("press", { action: "decode" })} />
          <Btn label="三好学生表彰" onClick={() => setPressKind(pressKind === "commend" ? null : "commend")} />
          <Btn label="匿名担保" onClick={() => setPressKind(pressKind === "guarantee" ? null : "guarantee")} />
        </div>
        {pressKind && (
          <>
            <p className="cp-hint">{pressKind === "commend" ? "表彰对象（次日 15 AP + 1.5 票归票权）：" : "担保对象（今日违规则免检举，否则双方 -25HP/-25SAN）："}</p>
            <PlayerPicker players={players} meId={meId} sel={pressTarget} onSel={setPressTarget} />
            <Btn label={pressKind === "commend" ? "发布表彰" : "发布担保"} onClick={() => {
              if (pressTarget) { send("press", { action: pressKind, targetId: pressTarget }); setPressTarget(null); setPressKind(null); }
            }} />
          </>
        )}
      </div>

      <div className="cp-sec">
        <p className="cp-sec-title">时光里的咖啡屋</p>
        <div className="row wrap">
          <Btn label="☕ 回复健康值 50" onClick={() => send("cafe", { kind: "hp" })} />
          <Btn label="☕ 回复精神值 30" onClick={() => send("cafe", { kind: "san" })} />
        </div>
      </div>
    </div>
  );
}
