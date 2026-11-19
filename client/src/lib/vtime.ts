// 虚拟时刻换算：1 现实分钟 = 60 虚拟分钟；按时段窗口比例推进，每半小时一跳
// 讨论时段（noon）停止计时，时刻固定在 11:00
import type { GameState } from "../../../server/src/schema/GameState";

// 各时段的虚拟时刻窗口 [起, 止]（小时）
const WINDOWS: Record<string, [number, number]> = {
  morning: [8, 11],     // 08:00–11:00 上午探索
  noon: [11, 14],       // 11:00–14:00 午间讨论（不计时，结束后跳至 14:00）
  afternoon: [14, 17],  // 14:00–17:00 下午探索
  evening: [17, 21],    // 17:00–21:00 晚间探索
  night: [21, 23],      // 21:00–23:00 夜间讨论与检举
};

export function virtualClock(s: Pick<GameState, "phase" | "phaseStartedAt" | "phaseEndsAt">): string {
  if (s.phase === "noon") return "11:00"; // 讨论时段停止计时
  const w = WINDOWS[s.phase];
  if (!w || !w[0] && w[0] !== 0) return "--:--";
  if (!s.phaseStartedAt || !s.phaseEndsAt || s.phaseEndsAt <= s.phaseStartedAt) return "--:--";
  const ratio = Math.min(1, Math.max(0, (Date.now() - s.phaseStartedAt) / (s.phaseEndsAt - s.phaseStartedAt)));
  const t = w[0] + (w[1] - w[0]) * ratio;
  const hh = Math.floor(t);
  const mm = t - hh >= 0.5 ? "30" : "00";
  return `${String(hh).padStart(2, "0")}:${mm}`;
}
