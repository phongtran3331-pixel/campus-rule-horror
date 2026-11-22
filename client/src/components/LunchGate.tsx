import { useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import type { GameRoom } from "../lib/client";

/** 黑底白粒子的午间氛围屏：传送进食堂先被询问「吃，还是不吃」 */
export function LunchGate({ room, players }: { room: GameRoom; players: Array<[string, Player]> }) {
  const [chosen, setChosen] = useState<"eat" | "refuse" | null>(null);
  const [typed, setTyped] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const total = players.filter(([, p]) => p.alive && !p.observer).length;
  const doneN = players.filter(([, p]) => p.alive && !p.observer && p.lunchDone).length;

  const lines = useMemo(() => [
    "十一点整。所有座位都坐满了人，没有人说话。",
    "你端着餐盘坐下，还是决定——",
  ], []);

  // 打字机
  useEffect(() => {
    const full = lines.join("\n");
    if (typed >= full.length) return;
    const t = setInterval(() => setTyped((n) => Math.min(full.length, n + 1)), 55);
    return () => clearInterval(t);
  }, [typed, lines]);
  const full = lines.join("\n");
  const typedText = full.slice(0, typed);
  const typingDone = typed >= full.length;

  // 白色粒子：缓慢上浮、轻微横摆、忽明忽暗
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = (cv.width = cv.clientWidth * devicePixelRatio);
    let h = (cv.height = cv.clientHeight * devicePixelRatio);
    const onResize = () => { w = cv.width = cv.clientWidth * devicePixelRatio; h = cv.height = cv.clientHeight * devicePixelRatio; };
    window.addEventListener("resize", onResize);
    const P = Array.from({ length: 90 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: (0.6 + Math.random() * 1.8) * devicePixelRatio,
      vy: (0.12 + Math.random() * 0.35) * devicePixelRatio,
      ph: Math.random() * Math.PI * 2,
      sp: 0.008 + Math.random() * 0.02,
    }));
    let raf = 0;
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      for (const pt of P) {
        pt.y -= pt.vy; pt.ph += pt.sp * 16;
        if (pt.y < -4) { pt.y = h + 4; pt.x = Math.random() * w; }
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(pt.ph));
        const sx = pt.x + Math.sin(pt.ph * 0.7) * 6 * devicePixelRatio;
        ctx.beginPath();
        ctx.arc(sx, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(235,235,245,${a.toFixed(3)})`;
        ctx.shadowColor = "rgba(255,255,255,0.8)";
        ctx.shadowBlur = 6 * devicePixelRatio;
        ctx.fill();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  const choose = (eat: boolean) => {
    setChosen(eat ? "eat" : "refuse");
    room.send("lunch", { eat });
  };

  return (
    <div className="lg-root">
      <canvas ref={canvasRef} className="lg-canvas" />
      <div className="lg-body">
        {!chosen ? (
          <>
            <p className="lg-text">{typedText}</p>
            {typingDone && (
              <div className="lg-ask">
                <p className="lg-q">打饭窗口的阿姨看向你：「吃，还是不吃？」</p>
                <div className="lg-btns">
                  <button className="lg-btn eat" onClick={() => choose(true)}>使用午餐 · 10 币</button>
                  <button className="lg-btn refuse" onClick={() => choose(false)}>拒绝</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="lg-wait">
            <p className="lg-text dim">{chosen === "eat" ? "你低头扒饭。没人说话。" : "你把餐盘推远了半寸。"}</p>
            <p className="lg-waitline">
              等待其他人<span className="lg-dots"><i>.</i><i>.</i><i>.</i></span>
              <b>{doneN}/{total}</b>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
