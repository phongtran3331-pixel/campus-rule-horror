import { useEffect, useState } from "react";

const NAMES: Record<string, string> = {
  lobby: "大厅", morning: "上午", noon: "中午 · 讨论投票",
  afternoon: "下午", evening: "晚上", night: "深夜", ended: "已结束",
};

export function PhaseBanner({ day, phase, endsAt }: { day: number; phase: string; endsAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const remain = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  return (
    <div className="phase">
      <span>Day {day}</span>
      <span className="phase-name">{NAMES[phase] ?? phase}</span>
      {endsAt > 0 && phase !== "lobby" && <span className="clock">{mm}:{ss}</span>}
    </div>
  );
}
