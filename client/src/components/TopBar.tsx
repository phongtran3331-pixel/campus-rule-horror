import type { Player } from "../../../server/src/schema/GameState";

const items: Array<{ key: keyof Player; label: string }> = [
  { key: "hp", label: "HP" },
  { key: "san", label: "SAN" },
  { key: "ap", label: "AP" },
  { key: "hunger", label: "饥饿" },
  { key: "coins", label: "币" },
];

export function TopBar({ me }: { me: Player | undefined }) {
  return (
    <div className="topbar">
      {items.map(({ key, label }) => {
        const v = me ? Math.round(Number(me[key])) : "--";
        const max = key === "ap" ? 15 : 100;
        const pct = me ? Math.max(0, Math.min(100, (Number(me[key]) / max) * 100)) : 0;
        return (
          <div className="stat" key={key}>
            <span className="stat-label">{label}</span>
            <div className="bar"><div className={`bar-fill ${key}`} style={{ width: `${pct}%` }} /></div>
            <span className="stat-val">{v}</span>
          </div>
        );
      })}
      <span className="who">{me?.name}{me?.faction === "chair" ? " · 理事长" : me?.faction === "student" ? " · 干事" : ""}</span>
    </div>
  );
}
