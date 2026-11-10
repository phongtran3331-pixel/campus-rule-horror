// 一昼夜流程计时（实测 11 分钟过紧，探索时段翻倍：20 分钟五时段；timeScale 供测试加速，正式局 = 1）
// 虚拟时刻换算：1 现实分钟 = 30 虚拟分钟，时段虚拟窗口见 client/src/lib/vtime.ts
export const PHASE_MINUTES: Record<string, number> = {
  morning: 6,
  noon: 3,
  afternoon: 6,
  evening: 4,
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
