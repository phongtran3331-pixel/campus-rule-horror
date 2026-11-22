import type { Player } from "../../../server/src/schema/GameState";
import type { Faction } from "../lib/client";

export function AvatarChip({ avatar, size = 22 }: { avatar: string; size?: number }) {
  const isImg = avatar.startsWith("data:") || avatar.startsWith("/") || avatar.startsWith("assets/");
  if (isImg) return <img className="avatar-img" src={avatar} style={{ width: size, height: size }} alt="" draggable={false} />;
  return <span className="avatar-emoji" style={{ fontSize: size * 0.72, width: size, height: size }}>{avatar || "❔"}</span>;
}

export function PlayerList({ players, myId, myFaction }: { players: Array<[string, Player]>; myId: string; myFaction: Faction | null }) {
  return (
    <div className="card players">
      <h3>在线 {players.filter(([, p]) => p.connected).length} 人</h3>
      <ul>
        {players.map(([id, p]) => (
          <li key={id} className={!p.alive ? "dead" : ""}>
            <AvatarChip avatar={p.avatar} size={22} />
            <span className="pl-name">
              {p.name}{id === myId ? "（你）" : ""}
              {!p.alive ? " · 已淘汰" : p.connected ? "" : " · 掉线"}
              {id === myId && myFaction === "chair" ? " · 理事长" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
