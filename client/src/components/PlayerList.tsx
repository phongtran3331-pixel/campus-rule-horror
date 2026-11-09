import type { Player } from "../../../server/src/schema/GameState";

export function PlayerList({ players, myId }: { players: Array<[string, Player]>; myId: string }) {
  return (
    <div className="card players">
      <h3>在线 {players.filter(([, p]) => p.connected).length} 人</h3>
      <ul>
        {players.map(([id, p]) => (
          <li key={id} className={!p.alive ? "dead" : ""}>
            {p.name}{id === myId ? "（你）" : ""}
            {!p.alive ? " · 已淘汰" : p.connected ? "" : " · 掉线"}
            {id === myId && p.faction === "chair" ? " · 理事长" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
