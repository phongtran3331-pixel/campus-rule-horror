import { Component, useEffect, useReducer, useState, type ReactNode } from "react";
import { colyseus, type AccuseStateMsg, type Faction, type GameOverMsg, type GameRoom, type RoleMsg, type RoomInit, type RuleMsg, type RuleSwapMsg } from "./lib/client";
import type { Player } from "../../server/src/schema/GameState";
import { PhaseBanner } from "./components/PhaseBanner";
import { Terminal } from "./components/Terminal";
import { IntroSequence } from "./components/IntroSequence";
import { ExploreOverlay } from "./components/ExploreOverlay";

/** 错误边界：任何渲染异常显示引导页而不是黑屏 */
class ErrorBoundary extends Component<{ children: ReactNode }, { err: string }> {
  state = { err: "" };
  static getDerivedStateFromError(e: unknown) { return { err: String(e) }; }
  render() {
    if (this.state.err) {
      return (
        <div className="lobby">
          <div className="lobby-card">
            <h2 style={{ letterSpacing: 3 }}>连接出现异常</h2>
            <p className="sub" style={{ marginTop: 10 }}>对局界面载入失败，请刷新页面重新进入。</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [debugRoom, setDebugRoom] = useState(false);
  const [solo, setSolo] = useState(false);
  const [view, setView] = useState<"hub" | "lobby" | "solo">("hub");
  const enter = (r: GameRoom, debug: boolean, soloMode = false) => { setDebugRoom(debug); setSolo(soloMode); setRoom(r); };
  return (
    <ErrorBoundary>
      {room ? (
        <GameScreen room={room} debugRoom={debugRoom} solo={solo} onLeave={() => setRoom(null)} />
      ) : view === "hub" ? (
        <Hub onEnter={() => setView("lobby")} onSolo={() => setView("solo")} />
      ) : (
        <Lobby solo={view === "solo"} onEnter={enter} onBack={() => setView("hub")} />
      )}
    </ErrorBoundary>
  );
}

// ---------- 主页（ATTO_page：各项目统一入口） ----------

function Hub({ onEnter, onSolo }: { onEnter: () => void; onSolo: () => void }) {
  return (
    <div className="lobby">
      <header className="lobby-head">
        <span className="lobby-badge">ATTO_PAGE</span>
        <h1 className="lobby-title">ATTO_page</h1>
        <p className="lobby-sub">我的项目主页 —— <em>从这里出发</em></p>
      </header>

      <div className="hub-grid">
        <button className="hub-card live" onClick={onEnter}>
          <span className="hub-card-tag">联机游戏 · 可玩</span>
          <h2>校园规则怪谈</h2>
          <p>自管委在看着你 —— 多人联网规则怪谈生存。开房间，邀好友，遵守规则活到最后。</p>
          <span className="hub-card-go">进入 ›</span>
        </button>
        <button className="hub-card live alt" onClick={onSolo}>
          <span className="hub-card-tag">单人 · 试玩测试</span>
          <h2>单人试玩</h2>
          <p>不等匹配直接开局：9 人局其余 8 席挂机补位，规则、时段、投票、生存与正式对局完全一致。</p>
          <span className="hub-card-go">进入 ›</span>
        </button>
        <div className="hub-card soon">
          <span className="hub-card-tag">筹备中</span>
          <h2>2521 学习网站</h2>
          <p>正在搬运中，敬请期待。</p>
        </div>
        <div className="hub-card soon">
          <span className="hub-card-tag">虚位以待</span>
          <h2>更多项目</h2>
          <p>下一个想做什么？</p>
        </div>
      </div>
    </div>
  );
}

// ---------- 大厅 ----------

function Lobby({ onEnter, onBack, solo = false }: {
  onEnter: (r: GameRoom, debug: boolean, soloMode?: boolean) => void;
  onBack: () => void;
  solo?: boolean;
}) {
  const [name, setName] = useState(solo ? "测试员" : "");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [faction, setFaction] = useState<"student" | "chair">("student");
  const [code, setCode] = useState("");
  const [fast, setFast] = useState(solo);
  const [debug, setDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const opts = () => solo
    ? ({ name, gender, timeScale: fast ? 30 : 1, debug: true, solo: true, soloFaction: faction })
    : ({ name, gender, timeScale: fast ? 30 : 1, debug });

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const r = await colyseus.create("game", opts());
      if (solo) r.send("start"); // 单人试玩：跳过匹配直接开局
      onEnter(r, debug, solo);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  const join = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      onEnter(await colyseus.joinById(code.trim(), opts()), debug);
    } catch { setErr("房间不存在或已关闭，请检查邀请码"); setBusy(false); }
  };

  return (
    <div className="lobby">
      <button className="hub-back" onClick={onBack}>‹ ATTO_page 主页</button>
      <header className="lobby-head">
        <span className="lobby-badge">CAMPUS RULE HORROR</span>
        <h1 className="lobby-title">校园规则怪谈</h1>
        <p className="lobby-sub">{solo
          ? <>单人试玩 —— <em>其余 8 席挂机补位，内容与正式对局一致</em></>
          : <>自管委在看着你 —— <em>遵守规则，活到最后</em></>}</p>
      </header>

      <div className="lobby-card">
        <label className="field">
          <span>你的名字</span>
          <input placeholder="输入名字（≤12 字）" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span>性别</span>
          <div className="seg">
            <button type="button" className={gender === "male" ? "on" : ""} onClick={() => setGender("male")}>男生</button>
            <button type="button" className={gender === "female" ? "on" : ""} onClick={() => setGender("female")}>女生</button>
          </div>
        </div>

        {solo && (
          <div className="field">
            <span>你的身份</span>
            <div className="seg">
              <button type="button" className={faction === "student" ? "on" : ""} onClick={() => setFaction("student")}>干事</button>
              <button type="button" className={faction === "chair" ? "on" : ""} onClick={() => setFaction("chair")}>理事长</button>
            </div>
          </div>
        )}

        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? "正在进入校园…" : solo ? "进入单人试玩" : "创建房间"}
        </button>

        {!solo && (
          <>
            <div className="divider"><span>或凭邀请码加入</span></div>

            <div className="join-row">
              <input className="code-input" placeholder="邀请码（区分大小写）" value={code}
                maxLength={10} onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && join()} />
              <button className="btn-ghost" disabled={busy || !code.trim()} onClick={join}>加入房间</button>
            </div>
          </>
        )}

        {err && <p className="err">{err}</p>}

        <details className="debug">
          <summary>{solo ? "节奏设置" : "对局设置"}</summary>
          <label><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> 快节奏演示模式（完整流程快速体验）</label>
          {!solo && <label><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> 调试 · 允许直接开局（人数不足也可开始）</label>}
        </details>
      </div>
    </div>
  );
}

// ---------- 对局 ----------

interface Msg { kind: string; from?: string; text: string }
function GameScreen({ room, debugRoom, solo, onLeave }: { room: GameRoom; debugRoom: boolean; solo: boolean; onLeave: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [init, setInit] = useState<RoomInit | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [myFaction, setMyFaction] = useState<Faction | null>(null);
  const [chairs, setChairs] = useState<Array<{ id: string; name: string }>>([]);
  const [introDone, setIntroDone] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [gameover, setGameover] = useState<GameOverMsg | null>(null);
  const [accuse, setAccuse] = useState<AccuseStateMsg | null>(null);
  const [rulePool, setRulePool] = useState<RuleMsg[]>([]);

  useEffect(() => {
    room.onStateChange(() => force());
    room.onMessage("init", (d: RoomInit) => setInit(d));
    room.onMessage("role", (d: RoleMsg) => { setMyFaction(d.faction); setChairs(d.chairs); if (d.pool) setRulePool(d.pool); });
    room.onMessage("ruleSwap", (d: RuleSwapMsg) => setInit((s) => (s ? { ...s, ruleBoard: d.board } : s)));
    room.onMessage("rulePool", (d: { pool: RuleMsg[] }) => setRulePool(d.pool));
    room.onMessage("accuseState", (d: AccuseStateMsg) => setAccuse(d));
    room.onMessage("gameover", (d: GameOverMsg) => setGameover(d));
    room.onMessage("dm", (m: { from: string; text: string; coins: number }) =>
      setMsgs((s) => [...s.slice(-99), { kind: "dm", from: m.from, text: `${m.text}${m.coins > 0 ? `（附 ${m.coins} 币）` : ""}` }]));
    room.onMessage("chat", (m: { from: string; text: string }) =>
      setMsgs((s) => [...s.slice(-99), { kind: "chat", from: m.from, text: m.text }]));
    room.onMessage("notice", (m: { text: string }) =>
      setMsgs((s) => [...s.slice(-99), { kind: "notice", text: m.text }]));
    return () => { room.leave(); };
  }, [room]);

  const s = room.state;
  // 状态同步到达前的首帧渲染保护（网络延迟时 state/players 尚未就绪）
  if (!s || !(s as { players?: unknown }).players) {
    return (
      <div className="game">
        <PhaseBanner day={0} phase="lobby" endsAt={0} />
        <div className="card" style={{ marginTop: 10 }}>正在进入校园…</div>
      </div>
    );
  }
  const me = s.players.get(room.sessionId) as Player | undefined;
  const players = [...s.players.entries()] as Array<[string, Player]>;
  const isHost = room.sessionId === s.hostId;
  const started = s.phase !== "lobby";

  return (
    <div className="game">
      <PhaseBanner day={s.day} phase={s.phase} endsAt={s.phaseEndsAt} />
      {started && !introDone && me && (
        <IntroSequence
          name={me.name}
          faction={myFaction}
          chairs={chairs}
          onDone={() => setIntroDone(true)}
        />
      )}
      {gameover && (
        <GameOverPanel gameover={gameover} players={players} myId={room.sessionId} />
      )}
      <div className="main phone-main">
        <div className="phone-col">
          {!started && !solo && (
            <div className="card waiting">
              <h3>对局房间</h3>
              <p className="waiting-code"><b>{room.roomId}</b></p>
              <p className="sub">把邀请码发给同学 · {players.length} 人在线</p>
              {isHost ? (
                <button className="btn-primary" disabled={players.length < 5 && !debugRoom}
                  onClick={() => room.send("start")}>
                  {debugRoom || players.length >= 5
                    ? "开始对局"
                    : `开始对局（还差 ${5 - players.length} 人）`}
                </button>
              ) : (
                <p className="sub">等待房主开始…</p>
              )}
            </div>
          )}
          {solo && started && <div className="solo-chip">单人试玩 · 其余 8 席挂机</div>}
          <Terminal
            room={room}
            me={me}
            myFaction={myFaction}
            phase={s.phase}
            day={s.day}
            endsAt={s.phaseEndsAt}
            startedAt={s.phaseStartedAt}
            netDown={s.netDown}
            players={players}
            msgs={msgs}
            onSendChat={(t) => room.send("chat", { text: t })}
            onOpenExplore={() => setExploreOpen(true)}
            init={init}
            accuse={accuse}
            rulePool={rulePool}
            chairs={chairs}
            nodeName={init?.nodes.find((n) => n.id === me?.nodeId)?.name ?? ""}
          />
        </div>
      </div>
      {started && exploreOpen && init && me && (
        <ExploreOverlay
          room={room}
          nodes={init.nodes}
          edges={init.edges}
          me={me}
          myFaction={myFaction}
          phase={s.phase}
          netDown={s.netDown}
          onClose={() => setExploreOpen(false)}
        />
      )}
      <button className="leave" onClick={onLeave}>离开</button>
    </div>
  );
}


/** 结算页：胜负公告 + 身份公示 + 全员归宿 */
function GameOverPanel({ gameover, players, myId }: {
  gameover: GameOverMsg;
  players: Array<[string, Player]>;
  myId: string;
}) {
  // 以名字对应身份（服务端按名字公示）
  const nameSet = (names: string[]) => new Set(names);
  const chairNames = nameSet(gameover.chairs);
  const aliveStudentNames = nameSet(gameover.students);
  const rows = players.map(([id, q]) => ({
    id, name: q.name,
    isChair: chairNames.has(q.name),
    alive: q.alive,
    survivedAsStudent: aliveStudentNames.has(q.name),
    isMe: id === myId,
  }));
  return (
    <div className={`gameover ${gameover.winner}`}>
      <span className="go-badge">{gameover.winner === "chair" ? "理事长阵营大获全胜" : "干事阵营获胜"}</span>
      <h2>{gameover.detail}</h2>
      <p className="go-reason">{gameover.reason}</p>

      <div className="go-table">
        {rows.map((r) => (
          <div key={r.id} className={`go-row${r.isChair ? " chair" : ""}${r.alive ? "" : " dead"}`}>
            <span className="go-name">{r.name}{r.isMe ? "（你）" : ""}</span>
            <span className="go-fate">
              {r.isChair ? "理事长" : r.alive ? (r.survivedAsStudent ? "存活干事" : "干事") : "干事"}
            </span>
            <span className="go-status">{r.alive ? "在册" : "已出局"}</span>
          </div>
        ))}
      </div>

      <p className="go-sub">
        理事长：{gameover.chairs.join("、") || "无"} ｜ 存活干事：{gameover.students.join("、") || "无"}
      </p>
      <button className="btn-primary" onClick={() => location.reload()}>返回 ATTO_page 主页</button>
    </div>
  );
}
