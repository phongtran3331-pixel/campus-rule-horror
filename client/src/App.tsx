import { Component, useEffect, useReducer, useState, type ReactNode } from "react";
import { colyseus, type Faction, type GameOverMsg, type GameRoom, type RoleMsg, type RoomInit, type RuleSwapMsg } from "./lib/client";
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
  const enter = (r: GameRoom, debug: boolean) => { setDebugRoom(debug); setRoom(r); };
  return (
    <ErrorBoundary>
      {room ? <GameScreen room={room} debugRoom={debugRoom} onLeave={() => setRoom(null)} /> : <Lobby onEnter={enter} />}
    </ErrorBoundary>
  );
}

// ---------- 大厅 ----------

function Lobby({ onEnter }: { onEnter: (r: GameRoom, debug: boolean) => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [code, setCode] = useState("");
  const [fast, setFast] = useState(false);
  const [debug, setDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const opts = () => ({ name, gender, timeScale: fast ? 30 : 1, debug });

  const create = async () => {
    setBusy(true); setErr("");
    try {
      onEnter(await colyseus.create("game", opts()), debug);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
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
      <header className="lobby-head">
        <span className="lobby-badge">CAMPUS RULE HORROR</span>
        <h1 className="lobby-title">校园规则怪谈</h1>
        <p className="lobby-sub">自管委在看着你 —— <em>遵守规则，活到最后</em></p>
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

        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? "正在进入校园…" : "创建房间"}
        </button>

        <div className="divider"><span>或凭邀请码加入</span></div>

        <div className="join-row">
          <input className="code-input" placeholder="邀请码（区分大小写）" value={code}
            maxLength={10} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()} />
          <button className="btn-ghost" disabled={busy || !code.trim()} onClick={join}>加入房间</button>
        </div>

        {err && <p className="err">{err}</p>}

        <details className="debug">
          <summary>对局设置</summary>
          <label><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> 快节奏演示模式（完整流程快速体验）</label>
          <label><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> 调试 · 允许直接开局（人数不足也可开始）</label>
        </details>
      </div>
    </div>
  );
}

// ---------- 对局 ----------

interface Msg { kind: string; from?: string; text: string }
function GameScreen({ room, debugRoom, onLeave }: { room: GameRoom; debugRoom: boolean; onLeave: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [init, setInit] = useState<RoomInit | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [myFaction, setMyFaction] = useState<Faction | null>(null);
  const [chairs, setChairs] = useState<Array<{ id: string; name: string }>>([]);
  const [introDone, setIntroDone] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [gameover, setGameover] = useState<GameOverMsg | null>(null);

  useEffect(() => {
    room.onStateChange(() => force());
    room.onMessage("init", (d: RoomInit) => setInit(d));
    room.onMessage("role", (d: RoleMsg) => { setMyFaction(d.faction); setChairs(d.chairs); });
    room.onMessage("ruleSwap", (d: RuleSwapMsg) => setInit((s) => (s ? { ...s, ruleBoard: d.board } : s)));
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
        <div className={`gameover ${gameover.winner}`}>
          <h2>{gameover.winner === "chair" ? "理事长阵营大获全胜" : "干事阵营获胜"}</h2>
          <p>{gameover.detail}</p>
          <p className="sub">{gameover.reason} · 理事长：{gameover.chairs.join("、") || "无"} · 存活干事：{gameover.students.join("、") || "无"}</p>
        </div>
      )}
      <div className="main phone-main">
        <div className="phone-col">
          {!started && (
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
