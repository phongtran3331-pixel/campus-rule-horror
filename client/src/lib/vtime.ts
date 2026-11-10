// 虚拟时刻换算：1 现实分钟 = 30 虚拟分钟；按时段窗口比例推进，每半小时一跳
import type { GameState } from "../../../server/src/schema/GameState";

// 各时段的虚拟时刻窗口 [起, 止]（小时）
const WINDOWS: Record<string, [number, number]> = {
  morning: [8, 11],     // 08:00–11:00
  noon: [11, 13],       // 11:00–13:00
  afternoon: [13, 17],// 13:00–17:00
  evening: [17, 21],    // 17:00–21:00
  night: [21, 23],      // 21:00–23:00
};

export function virtualClock(s: Pick<GameState, "phase" | "phaseStartedAt" | "phaseEndsAt">): string {
  const w = WINDOWS[s.phase];
  if (!w || !w[0] && w[0] !== 0) return "--:--";
  if (!s.phaseStartedAt || !s.phaseEndsAt || s.phaseEndsAt <= s.phaseStartedAt) return "--:--";
  const ratio = Math.min(1, Math.max(0, (Date.now() - s.phaseStartedAt) / (s.phaseEndsAt - s.phaseStartedAt)));
  const t = w[0] + (w[1] - w[0]) * ratio;
  const hh = Math.floor(t);
  const mm = t - hh >= 0.5 ? "30" : "00";
  return `${String(hh).padStart(2, "0")}:${mm}`;
}
