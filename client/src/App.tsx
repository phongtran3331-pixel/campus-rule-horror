import { useEffect, useReducer, useState } from "react";
import { colyseus, type Faction, type GameOverMsg, type GameRoom, type RoleMsg, type RoomInit, type RuleSwapMsg } from "./lib/client";
import type { Player } from "../../server/src/schema/GameState";
import { TopBar } from "./components/TopBar";
import { PhaseBanner } from "./components/PhaseBanner";
import { MapView } from "./components/MapView";
import { RuleBoard } from "./components/RuleBoard";
import { PlayerList } from "./components/PlayerList";
import { ChatPanel } from "./components/ChatPanel";
import { ActionPanel } from "./components/ActionPanel";

export default function App() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  return room ? <GameScreen room={room} onLeave={() => setRoom(null)} /> : <Lobby onEnter={setRoom} />;
}

// ---------- 大厅 ----------

function Lobby({ onEnter }: { onEnter: (r: GameRoom) => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [code, setCode] = useState("");
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const opts = () => ({ name, gender, timeScale: fast ? 30 : 1 });

  const create = async () => {
    setBusy(true); setErr("");
    try {
      onEnter(await colyseus.create("game", opts()));
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      onEnter(await colyseus.joinById(code.trim(), opts()));
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
          <small>部分校规与身份判定会用到</small>
        </div>

        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? "正在连接服务器…" : "创建房间"}
        </button>

        <div className="divider"><span>或凭邀请码加入</span></div>

        <div className="join-row">
          <input className="code-input" placeholder="邀请码" value={code}
            maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && join()} />
          <button className="btn-ghost" disabled={busy || !code.trim()} onClick={join}>加入房间</button>
        </div>

        {err && <p className="err">{err}</p>}

        <details className="debug">
          <summary>调试选项</summary>
          <label><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> 测试加速 ×30（开发用）</label>
        </details>
      </div>

      <p className="foot">规则怪谈 × 社交推理 × 生存 · 9–12 人 · 邀请码制</p>
    </div>
  );
}

// ---------- 对局 ----------

interface Msg { kind: string; from?: string; text: string }
function GameScreen({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [init, setInit] = useState<RoomInit | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [myFaction, setMyFaction] = useState<Faction | null>(null);
  const [gameover, setGameover] = useState<GameOverMsg | null>(null);

  useEffect(() => {
    room.onStateChange(() => force());
    room.onMessage("init", (d: RoomInit) => setInit(d));
    room.onMessage("role", (d: RoleMsg) => setMyFaction(d.faction));
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
  const me = s.players.get(room.sessionId) as Player | undefined;
  const players = [...s.players.entries()] as Array<[string, Player]>;
  const isHost = room.sessionId === s.hostId;
  const started = s.phase !== "lobby";

  return (
    <div className="game">
      <TopBar me={me} myFaction={myFaction} />
      <PhaseBanner day={s.day} phase={s.phase} endsAt={s.phaseEndsAt} />
      {gameover && (
        <div className={`gameover ${gameover.winner}`}>
          <h2>{gameover.winner === "chair" ? "理事长阵营大获全胜" : "干事阵营获胜"}</h2>
          <p>{gameover.detail}</p>
          <p className="sub">{gameover.reason} · 理事长：{gameover.chairs.join("、") || "无"} · 存活干事：{gameover.students.join("、") || "无"}</p>
        </div>
      )}
      <div className="main">
        <div className="col left">
          {init ? (
            <MapView
              nodes={init.nodes}
              edges={init.edges}
              players={players}
              myId={room.sessionId}
              phase={s.phase}
              netDown={s.netDown}
              onMove={(nodeId) => room.send("move", { nodeId })}
            />
          ) : (
            <div className="card">等待房主开始…</div>
          )}
          {started && (
            <ActionPanel
              room={room}
              me={me}
              myFaction={myFaction}
              phase={s.phase}
              day={s.day}
              netDown={s.netDown}
              players={players}
            />
          )}
          {!started && (
            <div className="card waiting">
              <h3>对局房间</h3>
              <p className="waiting-code"><b>{room.roomId}</b></p>
              <p className="sub">把邀请码发给同学 · {players.length} 人在线</p>
              {isHost ? (
                <button className="btn-primary" disabled={players.length < 5}
                  onClick={() => room.send("start")}>
                  开始对局{players.length < 5 ? `（还差 ${5 - players.length} 人）` : ""}
                </button>
              ) : (
                <p className="sub">等待房主开始…</p>
              )}
            </div>
          )}
        </div>
        <div className="col right">
          {init && <RuleBoard fixedRules={init.fixedRules} ruleBoard={init.ruleBoard} />}
          <PlayerList players={players} myId={room.sessionId} myFaction={myFaction} />
          <ChatPanel msgs={msgs} onSend={(t) => room.send("chat", { text: t })} />
        </div>
      </div>
      <button className="leave" onClick={onLeave}>离开</button>
    </div>
  );
}
