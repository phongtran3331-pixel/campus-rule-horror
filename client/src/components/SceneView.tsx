import { useEffect, useRef, useState } from "react";
import type { GameRoom } from "../lib/client";

interface SceneJson {
  situations: Record<string, string>;
  events: Record<string, { choice: string; result: string; result_taken?: string }>;
}
interface SceneResult {
  sceneId: string; eventId: string; taken: boolean; fake: boolean;
  text: string;
  grants: Array<{ name: string; ref: string }>;
  states: Record<string, number>;
}
interface QuizMsg { sceneId: string; eventId: string; question: string; numeric: boolean; rule: string }

const strip = (s: string) => s.replace(/\{[^}]*\}/g, "").trim();
const STATE_CN: Record<string, string> = { ap: "行动值", hunger: "饥饿值", hp: "健康值", san: "精神值" };
// 每房间只注册一次消息监听（避免 StrictMode 双挂载与切节点残留）
const wiredRooms = new WeakSet<object>();
let lastResult: (SceneResult & { eventId: string }) | null = null;
let lastQuiz: QuizMsg | null = null;

/** 节点场景界面：situation 环视 + 事件选项 + 结果渲染（服务端只回编号与纯文本） */
export function SceneView({ room, nodeId }: { room: GameRoom; nodeId: string }) {
  const [scene, setScene] = useState<SceneJson | null>(null);
  const [look, setLook] = useState<string>("");        // 环视文本
  const [busy, setBusy] = useState<string | null>(null); // 进行中事件 id
  const [result, setResult] = useState<(SceneResult & { eventId: string }) | null>(null);
  const [quiz, setQuiz] = useState<QuizMsg | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    setScene(null); setLook(""); setResult(null); setQuiz(null);
    fetch(`scenes/${nodeId}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) setScene(j); }).catch(() => {});
    return () => { dead = true; };
  }, [nodeId]);

  useEffect(() => {
    if (wiredRooms.has(room)) return;
    wiredRooms.add(room);
    room.onMessage("sceneResult", (r: SceneResult) => { lastResult = { ...r, eventId: r.eventId }; lastQuiz = null; });
    room.onMessage("sceneQuiz", (q: QuizMsg) => { lastQuiz = q; });
  }, [room]);

  // 轮询式消费消息（房间级单监听，组件挂载后每 300ms 同步一次）
  useEffect(() => {
    const t = setInterval(() => {
      if (lastResult) { setResult(lastResult); lastResult = null; setQuiz(null); setBusy(null); }
      if (lastQuiz) { setQuiz(lastQuiz); lastQuiz = null; setBusy(null); }
    }, 300);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [result]);

  if (!scene) return <p className="sv-empty">这里一片寂静。</p>;
  const situations = Object.entries(scene.situations);
  const events = Object.entries(scene.events);

  const clickEvent = (eventId: string) => {
    if (busy) return;
    setBusy(eventId);
    setResult(null);
    room.send("sceneEvent", { sceneId: nodeId, eventId });
  };
  const answerQuiz = (answer: string) => {
    if (!quiz || !answer.trim()) return;
    setBusy(quiz.eventId);
    setQuiz(null);
    room.send("sceneEvent", { sceneId: quiz.sceneId, eventId: quiz.eventId, answer: answer.trim() });
  };

  return (
    <div className="sv">
      {situations.length > 0 && (
        <div className="sv-look">
          <div className="sv-chips">
            {situations.map(([k]) => (
              <button key={k} className="sv-chip" onClick={() => setLook(strip(situations.find(([x]) => x === k)![1]))}>
                看看{k}
              </button>
            ))}
          </div>
          {look && <p className="sv-look-text">{look}</p>}
        </div>
      )}

      <div className="sv-events">
        {events.map(([id, ev]) => (
          <button key={id} className="sv-event" disabled={busy !== null} onClick={() => clickEvent(id)}>
            {strip(ev.choice)}
          </button>
        ))}
      </div>

      {quiz && (
        <div className="sv-quiz">
          <p className="sv-quiz-q">{quiz.question}</p>
          <QuizFill numeric={quiz.numeric} onSubmit={answerQuiz} />
          <p className="sv-quiz-rule">{quiz.rule}</p>
        </div>
      )}

      {result && (
        <div ref={resultRef} className={`sv-result${result.taken ? " taken" : ""}`}>
          <p className="sv-result-text">{result.text}</p>
          {result.grants.length > 0 && (
            <p className="sv-grants">获得：{result.grants.map((g) => g.name).join("、")}</p>
          )}
          {Object.keys(result.states).length > 0 && (
            <p className="sv-states">
              {Object.entries(result.states).map(([k, v]) => `${STATE_CN[k]} ${v > 0 ? "+" : ""}${v}`).join("，")}
            </p>
          )}
          {result.fake && <p className="sv-fake">（你记住了这里的一切。它不会少，你也不会多。）</p>}
        </div>
      )}
    </div>
  );
}

/** 填空答题输入：数字题用数字键盘，回车或按钮提交 */
function QuizFill({ numeric, onSubmit }: { numeric: boolean; onSubmit: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="sv-quiz-fill">
      <input
        className="sv-quiz-input"
        type={numeric ? "number" : "text"}
        inputMode={numeric ? "numeric" : "text"}
        placeholder={numeric ? "填一个数字" : "写下答案"}
        value={v}
        autoFocus
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(v); }}
      />
      <button className="sv-quiz-go" disabled={!v.trim()} onClick={() => onSubmit(v)}>作答</button>
    </div>
  );
}
