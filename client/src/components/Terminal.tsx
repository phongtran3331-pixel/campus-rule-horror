import { useEffect, useState, type ReactNode } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import { ITEM_CATALOG, type ItemDef } from "../../../server/src/data/items";
import type { Faction, GameRoom, RoomInit } from "../lib/client";
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
        <button className={`t-chip t-statchip${showStats ? " on" : ""}`} onClick={() => setShowStats((v) => !v)}>
          {props.netDown ? "📵" : "📶"} 状态
        </button>
      </div>

      {/* 状态面板（点右上「状态」展开） */}
      {showStats && me && (
        <div className="t-stats">
          <Stat label="HP" v={me.hp} max={100} cls="hp" />
          <Stat label="SAN" v={me.san} max={100} cls="san" />
          <Stat label="AP" v={me.ap} max={15} cls="ap" />
          <Stat label="饥饿" v={me.hunger} max={100} cls="hunger" />
          <Stat label="币" v={me.coins} max={100} cls="coins" showNum />
        </div>
      )}

      {/* 桌面 / 应用 */}
      <div className="t-screen">
        {app === null ? (
          <>
            <div className="t-clock">{endsAt > 0 && phase !== "lobby" ? clock : vtime}</div>
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
  const { room, me, myFaction, phase, day, players, msgs, onSendChat, init } = p;
  if (!me) return null;
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const at = me.nodeId;
  const askTarget = (title: string): string | null => {
    const list = players.filter(([, q]) => q.alive);
    const input = window.prompt(`${title}\n${list.map(([, q], i) => `${i + 1}. ${q.name}`).join("  ")}`, "1");
    const i = Number(input) - 1;
    return list[i] ? list[i][0] : null;
  };

  switch (app) {
    case "bag":
      return <BagGrid me={me} />;

    case "chat":
      return (
        <>
          <div className="chat-log t-fill">
            {msgs.filter((m) => m.kind !== "notice").map((m, i) => (
              <div key={i} className={m.kind}>
                {m.kind === "chat" ? <><b>{m.from}：</b>{m.text}</> : <i className="dm">{m.from} 私信：{m.text}</i>}
              </div>
            ))}
          </div>
          <ChatInput onSend={onSendChat} />
        </>
      );

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
      return (
        <div className="row wrap">
          <button className="btn-primary eo-open" onClick={() => p.onOpenExplore()}>打开校园地图</button>
          {me.medicine > 0 && (
            <>
              <Btn label="服药 · 恢复 HP" onClick={() => send("useMedicine", { kind: "hp" })} />
              <Btn label="服药 · 恢复 SAN" onClick={() => send("useMedicine", { kind: "san" })} />
            </>
          )}
          <Btn label="私聊 / 转账" onClick={() => {
            const t = askTarget("私聊谁？");
            if (!t) return;
            const text = window.prompt("内容（可空）") ?? "";
            const coins = Number(window.prompt("转账金额（可 0）") ?? 0);
            send("dm", { targetId: t, text, coins: Number.isFinite(coins) ? coins : 0 });
          }} />
          {phase === "noon" && day > 0 && (
            <Btn label="投票放逐" danger onClick={() => {
              const t = askTarget("投票放逐谁？");
              if (t) send("vote", { targetId: t });
            }} />
          )}
          {phase === "night" && myFaction === "chair" && (
            <Btn label="检举" danger onClick={() => {
              const t = askTarget("检举谁？");
              if (t) send("accuse", { targetId: t });
            }} />
          )}
        </div>
      );

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
      if (at !== "community") return <p className="t-empty">请前往学生社区后使用本功能。</p>;
      if (myFaction !== "student") return <p className="t-empty">理事长无需预约。</p>;
      return (
        <div className="row wrap">
          <Btn label="预约上午段" onClick={() => send("bookSlot", { slot: "am" })} />
          <Btn label="预约下午段" onClick={() => send("bookSlot", { slot: "pm" })} />
          <Btn label="办公室 · 查档案" onClick={() => {
            const a = askTarget("档案：第一人编号");
            if (!a) return;
            const b = askTarget("档案：第二人编号");
            if (b) send("officeArchive", { aId: a, bId: b });
          }} />
          <Btn label="社区部 · 预约记录" onClick={() => send("deptBookings")} />
          <Btn label="策创部 · 抹除规矩" onClick={() => {
            const ruleId = window.prompt("输入要抹除的规矩编号（如 R3）");
            if (ruleId) send("cceErase", { ruleId: ruleId.trim().toUpperCase() });
          }} />
          <Btn label="宣传部 · 破译规矩" onClick={() => send("press", { action: "decode" })} />
          <Btn label="宣传部 · 表彰" onClick={() => {
            const t = askTarget("表彰谁？");
            if (t) send("press", { action: "commend", targetId: t });
          }} />
          <Btn label="宣传部 · 匿名担保" onClick={() => {
            const t = askTarget("担保谁？");
            if (t) send("press", { action: "guarantee", targetId: t });
          }} />
          <Btn label="咖啡屋（☕1）" onClick={() => send("cafe", { kind: "hp" })} />
        </div>
      );

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

/** 实体背包：40 格网格，按物品目录顺序填充 */
function BagGrid({ me }: { me: Player }) {
  const [sel, setSel] = useState<ItemDef | null>(null);
  const countOf = (def: ItemDef): number => {
    if (def.src === "items") return me.items.get(def.id) ?? 0;
    if (def.src === "field:junk") return me.junk;
    if (def.src.startsWith("field:key_")) return me.keys.split(",").filter(Boolean).includes(def.id) ? 1 : 0;
    const field = def.src.replace("field:", "") as "food" | "medicine" | "scissors" | "coffee" | "cards";
    return me[field] ?? 0;
  };
  const cells = ITEM_CATALOG.map((def) => ({ def, n: countOf(def) }));
  return (
    <>
      <div className="bag-grid">
        {cells.map(({ def, n }) => (
          <button
            key={def.id}
            className={`bag-slot${n > 0 ? " has" : ""}${sel?.id === def.id ? " sel" : ""}`}
            disabled={n === 0}
            onClick={() => setSel(def)}
          >
            <span className="bag-icon">{def.icon}</span>
            {n > 0 && <span className="bag-n">{n}</span>}
          </button>
        ))}
      </div>
      <div className="bag-detail">
        {sel ? (
          <>
            <b>{sel.name}{countOf(sel) > 0 ? ` ×${countOf(sel)}` : ""}</b>
            <p>{sel.desc}</p>
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
