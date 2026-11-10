import { useState } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import type { Faction, GameRoom, RoomInit } from "../lib/client";
import { MapView } from "./MapView";

interface Props {
  room: GameRoom;
  nodes: RoomInit["nodes"];
  edges: Array<[string, string]>;
  me: Player;
  myFaction: Faction | null;
  phase: string;
  netDown: boolean;
  onClose: () => void;
}

/** 沿道路最短步数：1 = 近端，≥2 = 远端 */
function dist(edges: Array<[string, string]>, from: string, to: string): number {
  if (from === to) return 0;
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        if (m === to) return d;
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return 99;
}

function Btn({ label, onClick, danger, disabled }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return <button className={`act${danger ? " danger" : ""}`} disabled={disabled} onClick={onClick}>{label}</button>;
}

/** 自由探索全屏层：左地图 + 右节点卡；进入节点后切换到节点界面 */
export function ExploreOverlay({ room, nodes, edges, me, myFaction, phase, netDown, onClose }: Props) {
  const [selected, setSelected] = useState<string>(me.nodeId);
  const [view, setView] = useState<string | null>(null); // null = 地图；否则为节点界面 id
  const node = nodes.find((n) => n.id === (view ?? selected))!;
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const isChair = myFaction === "chair";
  const d = dist(edges, me.nodeId, selected);
  const cost = d <= 1 ? 1 : 2;

  return (
    <div className="eo">
      <div className="eo-top">
        <span className="eo-title">校园地图</span>
        {!isChair && <span className="eo-ap">行动值 {Math.round(me.ap)}</span>}
        <button className="eo-close" onClick={onClose}>收起地图 ✕</button>
      </div>

      <div className="eo-body">
        <div className="eo-map">
          <MapView
            nodes={nodes}
            edges={edges}
            meNodeId={me.nodeId}
            netDown={netDown}
            selectedId={view ?? selected}
            onSelect={(id) => { setView(null); setSelected(id); }}
          />
        </div>

        <div className="eo-side">
          {view === null ? (
            <div className="eo-card">
              <h3 className="eo-name">{node.name}</h3>
              <p className="eo-type">{node.type === "A" ? "建筑（内有房间）" : "开放区域"}</p>
              <p className="eo-desc">{node.desc}</p>
              {selected === me.nodeId ? (
                <Btn label={`进入${node.name}`} onClick={() => setView(selected)} />
              ) : (
                <>
                  <Btn
                    label={`前往 · ${cost} AP`}
                    disabled={!isChair && me.ap < cost}
                    onClick={() => send("move", { nodeId: selected })}
                  />
                  {!isChair && me.ap < cost && <p className="eo-warn">行动值不足</p>}
                </>
              )}
            </div>
          ) : (
            <NodeView
              room={room}
              node={node}
              me={me}
              phase={phase}
              netDown={netDown}
              onBack={() => setView(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function NodeView({ room, node, me, phase, netDown, onBack }: {
  room: GameRoom;
  node: RoomInit["nodes"][number];
  me: Player;
  phase: string;
  netDown: boolean;
  onBack: () => void;
}) {
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const at = node.id;
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="eo-card eo-node">
      <div className="eo-node-head">
        <button className="t-back" onClick={onBack}>‹</button>
        <h3 className="eo-name">{node.name}</h3>
      </div>

      <div className="eo-scene">
        {imgOk ? (
          <img
            src={`assets/nodes/${at}.jpg`}
            alt={node.name}
            onError={() => setImgOk(false)}
            draggable={false}
          />
        ) : (
          <div className="eo-scene-ph">{node.name}</div>
        )}
      </div>

      <p className="eo-desc">{node.desc}</p>

      <div className="row wrap eo-actions">
        <Btn label="探索（1 AP）" onClick={() => send("explore")} />
        {me.food > 0 && <Btn label={`进食（🍞${me.food}）`} onClick={() => send("eat", { nodeId: at })} />}
        {at === "dorm" && <Btn label="确认门牌" onClick={() => send("doorplate")} />}
        {at === "market" && <Btn label="买食物（5币）" onClick={() => send("buy", { item: "food" })} />}
        {at === "market" && <Btn label="买剪刀（15币）" onClick={() => send("buy", { item: "scissors" })} />}
        {at === "clinic" && <Btn label="买药（12币）" onClick={() => send("buyMedicine")} />}
        {at === "canteen" && phase === "noon" && <Btn label="午间套餐（3币）" onClick={() => send("meal")} />}
        {(at === "field" || at === "gym") && <Btn label="运动" onClick={() => send("exercise")} />}
        {at === "recycle" && me.junk > 0 && <Btn label={`卖杂物（🗑${me.junk}）`} onClick={() => send("recycle")} />}
        {at === "admin" && (
          <>
            <Btn label="调监控" onClick={() => send("camera")} />
            <Btn label="调阅设施记录（🪪1）" onClick={() => {
              const f = window.prompt("设施名：超市售货机 / 校医院药房 / 图书馆闸机 / 操场闸机 / 体育馆闸机 / 社区闸机 / 行政楼影像室 / 网络中心");
              if (f) send("inspectLog", { facility: f.trim() });
            }} />
            {me.scissors > 0 && !netDown && <Btn label="剪网线" danger onClick={() => send("cutNet")} />}
            {netDown && <Btn label="修复网线（1 AP）" onClick={() => send("repairNet")} />}
          </>
        )}
        {at === "community" && <p className="eo-warn">学生社区的功能在终端「校园预约」中。</p>}
      </div>
    </div>
  );
}
