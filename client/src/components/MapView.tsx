import type { RoomInit } from "../lib/client";

interface Props {
  nodes: RoomInit["nodes"];
  edges: Array<[string, string]>;
  meNodeId: string;
  netDown: boolean;
  selectedId?: string;
  onSelect: (nodeId: string) => void;
}

/** 校园俯瞰图：纯文字节点（无圆圈），自己所在节点青色光晕，大地图不显示他人与人数 */
export function MapView({ nodes, edges, meNodeId, netDown, selectedId, onSelect }: Props) {
  const adjacent = new Set(
    edges.filter(([a, b]) => a === meNodeId || b === meNodeId).flatMap(([a, b]) => [a, b])
  );

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
      {netDown && <p className="hint">网络中断：所有定位服务已离线</p>}
    </div>
  );
}
