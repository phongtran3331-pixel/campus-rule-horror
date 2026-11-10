import { useEffect, useRef, useState } from "react";
import type { Faction } from "../lib/client";

const STORY: string[] = [
  "转学手续办完的当晚，你收到一条没有发件人的短信：",
  "「欢迎转入本校。请务必通读学生手册，每一条都要记住。」",
  "本校实行学生自主管理。自管委员会掌管校规、巡视与处分。",
  "没有人见过委员会的全貌。他们就在你们中间。",
  "白天，探索校园，搜集物资，活下去。",
  "每天中午，全体到食堂集会——讨论，然后投票。",
  "把混在你们中间的人，一个一个找出来。",
  "而在那之前……先遵守规则。",
  "违规者将被通报、处分。至于处分的尽头是什么，没人知道。",
  "现在，翻开你的学生证。",
];

/** 打字机音效：短促方波，音量很轻 */
function clickSound(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 1400 + Math.random() * 300;
  gain.gain.setValueAtTime(0.015, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

export function IntroSequence({ name, faction, chairs, onDone }: {
  name: string;
  faction: Faction | null;
  chairs: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [lineIdx, setLineIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const [identityChars, setIdentityChars] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const storyDone = lineIdx >= STORY.length;
  const identityText = faction === "chair"
    ? "身份：自管委理事长"
    : "身份：自管委干事";
  const identityDone = identityChars >= identityText.length;

  // 故事段落打字
  useEffect(() => {
    if (storyDone) return;
    const line = STORY[lineIdx];
    if (chars < line.length) {
      const t = setTimeout(() => {
        setChars((c) => c + 1);
        if (audioRef.current) clickSound(audioRef.current);
      }, skipped ? 8 : 45);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setLineIdx((i) => i + 1); setChars(0); }, skipped ? 60 : 750);
    return () => clearTimeout(t);
  }, [lineIdx, chars, storyDone, skipped]);

  // 身份逐字（更慢）
  useEffect(() => {
    if (!storyDone || faction === null || identityDone) return;
    const t = setTimeout(() => {
      setIdentityChars((c) => c + 1);
      if (audioRef.current) clickSound(audioRef.current);
    }, skipped ? 15 : 170);
    return () => clearTimeout(t);
  }, [storyDone, faction, identityChars, identityDone, skipped]);

  // 首次交互解锁音频
  useEffect(() => {
    const unlock = () => {
      if (!audioRef.current) audioRef.current = new AudioContext();
      audioRef.current.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  return (
    <div className="intro" onClick={() => setSkipped(true)}>
      <div className="intro-inner">
        {STORY.slice(0, storyDone ? STORY.length : lineIdx + 1).map((line, i) => {
          const shown = i < lineIdx ? line : line.slice(0, chars);
          return (
            <p key={i} className={`intro-line ${i === STORY.length - 1 ? "intro-final" : ""} ${shown.length >= line.length ? "full" : ""}`}>
              {shown || " "}
            </p>
          );
        })}

        {storyDone && faction !== null && (
          <p className="intro-identity">
            {identityText.slice(0, identityChars)}
            <span className="intro-caret">▌</span>
          </p>
        )}
        {storyDone && faction === null && <p className="intro-line">……</p>}

        {storyDone && identityDone && (
          <div className="intro-role">
            {faction === "chair" && chairs.length > 0 && (
              <p className="intro-mates">你的同伴：{chairs.map((c) => c.name).join("、")}</p>
            )}
            <button className="btn-primary" onClick={(e) => { e.stopPropagation(); onDone(); }}>
              收好学生证，进入校园
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
