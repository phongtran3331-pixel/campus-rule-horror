import type { Player } from "../../../server/src/schema/GameState";
import type { RoomInit } from "../lib/client";

interface Props {
  nodes: RoomInit["nodes"];
  edges: Array<[string, string]>;
  meNodeId: string;
  netDown: boolean;
  selectedId?: string;
  players?: Array<[string, Player]>;  // 实时位置：节点处漂浮头像
  meId?: string;
  hideOthers?: boolean;               // 设置：隐藏其他玩家位置（自己仍可见）
  onSelect: (nodeId: string) => void;
}

function AvatarDot({ avatar }: { avatar: string }) {
  const isImg = avatar.startsWith("data:") || avatar.startsWith("/") || avatar.startsWith("assets/");
  if (isImg) return <img className="map-av-img" src={avatar} alt="" draggable={false} />;
  return <span className="map-av-emoji">{avatar || "❔"}</span>;
}

/** 校园俯瞰图：纯文字节点（无圆圈），自己所在节点青色光晕；同节点玩家以漂浮头像实时显示（断网或设置隐藏时不可见） */
export function MapView({ nodes, edges, meNodeId, netDown, selectedId, players, meId, hideOthers, onSelect }: Props) {
  const adjacent = new Set(
    edges.filter(([a, b]) => a === meNodeId || b === meNodeId).flatMap(([a, b]) => [a, b])
  );

  // 节点 → 在场玩家（观察者可见全员；玩家可见自己，他人按设置）
  const byNode = new Map<string, Array<{ id: string; q: Player }>>();
  if (players && !netDown) {
    for (const [id, q] of players) {
      if (!q.alive || q.observer) continue;
      if (hideOthers && meId != null && id !== meId) continue;
      const arr = byNode.get(q.nodeId) ?? [];
      arr.push({ id, q });
      byNode.set(q.nodeId, arr);
    }
  }

  return (
    <div className={`map ${netDown ? "netdown" : ""}`}>
      <img className="map-bg" src="assets/map-day.jpg" alt="校园地图" draggable={false} />
      {netDown && <div className="map-netdown-mask">断网中 · 位置服务不可用</div>}
      <svg viewBox="0 0 100 100" className="map-svg" preserveAspectRatio="none">
        <defs>
          <filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {nodes.map((n) => {
          const isMe = meNodeId === n.id;
          const cls = [
            "node-label",
            isMe ? "me" : "",
            selectedId === n.id ? "selected" : "",
            adjacent.has(n.id) || isMe ? "near" : "far",
          ].filter(Boolean).join(" ");
          return (
            <g key={n.id} onClick={() => onSelect(n.id)} className="node">
              {isMe && <ellipse cx={n.x} cy={n.y - 1.2} rx={7.5} ry={3.4} className="me-halo" />}
              <text x={n.x} y={n.y} className={cls} filter={isMe ? "url(#node-glow)" : undefined}>
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>
      {/* 漂浮头像层：同节点头像横向堆叠在名称上方 */}
      {!netDown && nodes.map((n) => {
        const here = byNode.get(n.id) ?? [];
        if (!here.length) return null;
        return (
          <div key={`av-${n.id}`} className="map-avs" style={{ left: `${n.x}%`, top: `${Math.max(2, n.y - 7)}%` }}>
            {here.slice(0, 4).map(({ id, q }) => (
              <span key={id} className={`map-av${id === meId ? " self" : ""}`} title={q.name}>
                <AvatarDot avatar={q.avatar} />
              </span>
            ))}
            {here.length > 4 && <span className="map-av more">+{here.length - 4}</span>}
          </div>
        );
      })}
      {netDown && <p className="hint">网络中断：所有定位服务已离线</p>}
    </div>
  );
}
