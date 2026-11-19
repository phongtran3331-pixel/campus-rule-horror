// 一昼夜流程计时：1 现实分钟 = 60 虚拟分钟
// morning 08:00–11:00 探索；noon 11:00 起讨论（停止计时，全员确认/投票后跳入 14:00）；
// afternoon 14:00–17:00、evening 17:00–21:00 探索；night 夜间讨论与检举。timeScale 供测试加速。
export const PHASE_MINUTES: Record<string, number> = {
  morning: 3,
  noon: 0,      // 0 = 不计时
  afternoon: 3,
  evening: 4,
  night: 2,
};
export const PHASE_ORDER = ["morning", "noon", "afternoon", "evening", "night"] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export class PhaseTimer {
  private timer?: NodeJS.Timeout;

  constructor(private readonly timeScale: number) {}

  start(phase: Phase, day: number, onExpire: (phase: Phase, day: number) => void) {
    this.stop();
    const minutes = PHASE_MINUTES[phase];
    if (!minutes) return 0; // 不计时时段（讨论）：由全员确认/投票结束
    const ms = (minutes * 60_000) / this.timeScale;
    this.timer = setTimeout(() => onExpire(phase, day), ms);
    return Date.now() + ms;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
