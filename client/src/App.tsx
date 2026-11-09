import { useEffect, useReducer, useState } from "react";
import { colyseus, type Faction, type GameOverMsg, type GameRoom, type RoleMsg, type RoomInit, type RuleSwapMsg } from "./lib/client";
import type { Player } from "../../server/src/schema/GameState";
import { TopBar } from "./components/TopBar";
import { PhaseBanner } from "./components/PhaseBanner";
import { MapView } from "./components/MapView";
import { RuleBoard } from "./components/RuleBoard";
import { PlayerList } from "./components/PlayerList";
import { ChatPanel } from "./components/ChatPanel";

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
      <h1>校园规则怪谈：自管委</h1>
      <p className="sub">规则怪谈 × 社交推理 × 生存 · 9–12 人 · 邀请码制</p>
      <div className="card">
        <input placeholder="你的名字" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <label><input type="radio" checked={gender === "male"} onChange={() => setGender("male")} /> 男生</label>
          <label><input type="radio" checked={gender === "female"} onChange={() => setGender("female")} /> 女生</label>
        </div>
        <label className="row"><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> 测试加速 ×30（开发调试用）</label>
        <button disabled={busy} onClick={create}>创建房间</button>
        <div className="divider">或</div>
        <div className="row">
          <input placeholder="邀请码" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button disabled={busy} onClick={join}>加入房间</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <p className="foot">M1 框架版 · 素材未就位（CSS 占位）</p>
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
              onMove={(nodeId) => room.send("move", { nodeId })}
            />
          ) : (
            <div className="card">等待房主开始…</div>
          )}
          {!started && (
            <div className="card">
              <p>邀请码：<b className="code">{room.roomId}</b>（{players.length} 人在线）</p>
              {isHost
                ? <button onClick={() => room.send("start")}>开始对局（≥5 人）</button>
                : <p>等待房主开始…</p>}
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
