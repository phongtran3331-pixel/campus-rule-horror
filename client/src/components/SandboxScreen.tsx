import { useEffect, useReducer, useState } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import { type Faction, type GameRoom, type RoomInit } from "../lib/client";
import { PhaseBanner } from "./PhaseBanner";
import { ExploreOverlay } from "./ExploreOverlay";

interface Msg { kind: string; text: string }

/** 探索测试（单人沙盒）：全图自由探索，触发全部场景事件；无对局流程、永不淘汰 */
export function SandboxScreen({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [init, setInit] = useState<RoomInit | null>(null);
  const [myFaction, setMyFaction] = useState<Faction | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);

  useEffect(() => {
    room.onStateChange(() => force());
    room.onMessage("init", (d: RoomInit) => setInit(d));
    room.onMessage("role", (d: { faction: Faction }) => setMyFaction(d.faction));
    room.onMessage("notice", (m: { text: string }) =>
      setMsgs((s) => [...s.slice(-99), { kind: "notice", text: m.text }]));
    room.onMessage("chat", (m: { from: string; text: string }) =>
      setMsgs((s) => [...s.slice(-99), { kind: "notice", text: `${m.from}：${m.text}` }]));
    return () => { room.leave(); };
  }, [room]);

  const s = room.state;
  if (!s || !(s as { players?: unknown }).players || !init) {
    return (
      <div className="game">
        <PhaseBanner day={0} phase="lobby" endsAt={0} />
        <div className="card" style={{ marginTop: 10 }}>正在进入测试校园…</div>
      </div>
    );
  }
  const me = s.players.get(room.sessionId) as Player | undefined;
  if (!me) return <div className="game"><div className="card" style={{ marginTop: 10 }}>正在分配测试席位…</div></div>;

  const packCount = [...me.pack.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="game">
      <PhaseBanner day={s.day} phase={s.phase} endsAt={s.phaseEndsAt} />
      <ExploreOverlay
        room={room}
        nodes={init.nodes}
        edges={init.edges}
        me={me}
        myFaction={myFaction}
        phase={s.phase}
        netDown={s.netDown}
        onClose={() => {}}
        closable={false}
        toolbar={
          <>
            <span className="sb-chip">❤️ {Math.round(me.hp)}</span>
            <span className="sb-chip">🧠 {Math.round(me.san)}</span>
            <span className="sb-chip">⚡ {Math.round(me.ap)}</span>
            <span className="sb-chip">🍚 {Math.round(me.hunger)}</span>
            <span className="sb-chip">🪙 {Math.round(me.coins)}</span>
            <span className="sb-chip">🎒 {packCount}</span>
            <button className="sb-btn btn-ghost" onClick={() => room.send("sandboxRole")}>
              {myFaction === "chair" ? "切换为干事" : "切换为理事长"}
            </button>
            <button className="sb-btn btn-ghost" onClick={() => room.send("sandboxReset")}>重置点位</button>
            <button className="sb-btn btn-ghost" onClick={onLeave}>离开测试</button>
          </>
        }
      />
      {msgs.length > 0 && (
        <div className="sb-log">
          {msgs.slice(-3).map((m, i) => <p key={`${msgs.length}-${i}`}>{m.text}</p>)}
        </div>
      )}
    </div>
  );
}
