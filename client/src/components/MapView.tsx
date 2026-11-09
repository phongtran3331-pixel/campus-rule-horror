import type { Player } from "../../../server/src/schema/GameState";

interface Props {
  nodes: Array<{ id: string; name: string; x: number; y: number; type: "A" | "B" }>;
  edges: Array<[string, string]>;
  players: Array<[string, Player]>;
  myId: string;
  onMove: (nodeId: string) => void;
}

/** SVG 占位地图：素材就位后替换为 map_campus_day.png 底图 + 节点热区 */
export function MapView({ nodes, edges, players, myId, onMove }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = players.find(([id]) => id === myId)?.[1];
  const countAt = (nodeId: string) => players.filter(([, p]) => p.alive && p.nodeId === nodeId).length;
  const adjacent = new Set(
    edges.filter(([a, b]) => a === me?.nodeId || b === me?.nodeId).flatMap(([a, b]) => [a, b])
  );

  return (
    <div className="card map">
      <svg viewBox="0 0 100 100" className="map-svg">
        {edges.map(([a, b]) => {
          const na = byId.get(a)!, nb = byId.get(b)!;
          return <line key={`${a}-${b}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} className="edge" />;
        })}
        {nodes.map((n) => {
          const isMe = me?.nodeId === n.id;
          const canMove = me?.alive && adjacent.has(n.id) && !isMe;
          const c = countAt(n.id);
          return (
            <g key={n.id} onClick={() => canMove && onMove(n.id)} className={canMove ? "node clickable" : "node"}>
              <circle cx={n.x} cy={n.y} r={3.4} className={`node-circle ${n.type} ${isMe ? "me" : ""}`} />
              <text x={n.x} y={n.y - 4.6} className="node-name">{n.name}</text>
              {c > 0 && <text x={n.x} y={n.y + 6.4} className="node-count">{c}人</text>}
            </g>
          );
        })}
      </svg>
      <p className="hint">点击进入相邻节点（1 AP）· 同节点玩家互相可见（占位实现）</p>
    </div>
  );
}
