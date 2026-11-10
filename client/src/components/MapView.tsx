import type { Player } from "../../../server/src/schema/GameState";

interface Props {
  nodes: Array<{ id: string; name: string; x: number; y: number; type: "A" | "B" }>;
  edges: Array<[string, string]>;
  players: Array<[string, Player]>;
  myId: string;
  phase: string;
  netDown: boolean;
  onMove: (nodeId: string) => void;
}

/** 校园俯瞰图（白/夜两版）+ 节点热区；断网时全员位置不可见（滤镜状态，不重绘底图） */
export function MapView({ nodes, edges, players, myId, phase, netDown, onMove }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = players.find(([id]) => id === myId)?.[1];
  const isNight = phase === "evening" || phase === "night";
  const countAt = (nodeId: string) => players.filter(([, p]) => p.alive && p.nodeId === nodeId).length;
  const adjacent = new Set(
    edges.filter(([a, b]) => a === me?.nodeId || b === me?.nodeId).flatMap(([a, b]) => [a, b])
  );

  return (
    <div className={`card map ${netDown ? "netdown" : ""}`}>
      <img
        className="map-bg"
        src={isNight ? "/assets/map-evening.jpg" : "/assets/map-day.jpg"}
        alt="校园地图"
        draggable={false}
      />
      {netDown && <div className="map-netdown-mask">断网中 · 位置服务不可用</div>}
      <svg viewBox="0 0 100 100" className="map-svg" preserveAspectRatio="none">
        {nodes.map((n) => {
          const isMe = me?.nodeId === n.id;
          const canMove = me?.alive && adjacent.has(n.id) && !isMe;
          const c = countAt(n.id);
          return (
            <g key={n.id} onClick={() => canMove && onMove(n.id)} className={canMove ? "node clickable" : "node"}>
              <circle cx={n.x} cy={n.y} r={2.6} className={`node-circle ${n.type} ${isMe ? "me" : ""}`} />
              <text x={n.x} y={n.y - 3.4} className="node-name">{n.name}</text>
              {!netDown && c > 0 && <text x={n.x} y={n.y + 4.8} className="node-count">{c}人</text>}
            </g>
          );
        })}
        {!netDown &&
          players
            .filter(([id, p]) => p.alive)
            .map(([id, p]) => {
              const n = byId.get(p.nodeId);
              if (!n) return null;
              // 同节点堆叠：按索引错位，避免完全重叠
              const sameNode = players.filter(([, q]) => q.alive && q.nodeId === p.nodeId);
              const idx = sameNode.findIndex(([sid]) => sid === id);
              const off = (idx - (sameNode.length - 1) / 2) * 3.2;
              const isMe = id === myId;
              return (
                <circle
                  key={id}
                  cx={n.x + off}
                  cy={n.y + 1.8}
                  r={1.5}
                  className={`player-dot ${isMe ? "me" : ""}`}
                >
                  <title>{`${p.name}${isMe ? "（你）" : ""}`}</title>
                </circle>
              );
            })}
      </svg>
      {netDown && <p className="hint">网络中断：所有定位服务已离线</p>}
    </div>
  );
}
