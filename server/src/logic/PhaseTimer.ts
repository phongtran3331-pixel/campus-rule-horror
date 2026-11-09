// 一昼夜流程计时（11 分钟四时段；timeScale 供测试加速，正式局 = 1）
export const PHASE_MINUTES: Record<string, number> = {
  morning: 3,
  noon: 3,
  afternoon: 3,
  evening: 2,
  night: 1,
};
export const PHASE_ORDER = ["morning", "noon", "afternoon", "evening", "night"] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export class PhaseTimer {
  private timer?: NodeJS.Timeout;

  constructor(private readonly timeScale: number) {}

  start(phase: Phase, day: number, onExpire: (phase: Phase, day: number) => void) {
    this.stop();
    const ms = (PHASE_MINUTES[phase] * 60_000) / this.timeScale;
    this.timer = setTimeout(() => onExpire(phase, day), ms);
    return Date.now() + ms;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
