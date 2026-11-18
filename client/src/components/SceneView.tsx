import { useEffect, useRef, useState } from "react";
import type { GameRoom } from "../lib/client";

interface SceneJson {
  situations: Record<string, string>;
  events: Record<string, { choice: string; result: string; result_taken?: string }>;
}
interface SceneResult {
  sceneId: string; eventId: string; taken: boolean; fake: boolean;
  text: string; op?: string | null;
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

          {/* {操作} 事件长出真实控件：货表 / 回收选物 / 功能入口 */}
          {result.op && !result.fake && (
            <OpPanel room={room} sceneId={nodeId} op={result.op} />
          )}
        </div>
      )}
    </div>
  );
}

/** {操作} 控件面板：按关键词分发到既有消息通道 */
function OpPanel({ room, sceneId, op }: { room: GameRoom; sceneId: string; op: string }) {
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const buyMatch = op.match(/购买——(.+)/);
  const shopItems = buyMatch
    ? buyMatch[1].split("/").map((s) => s.trim()).map((s) => {
        const m = s.match(/^(.+?)(\d+)$/);
        return m ? { name: m[1], price: Number(m[2]) } : null;
      }).filter(Boolean) as Array<{ name: string; price: number }>
    : [];

  // 已知功能映射：点击事件文本即触发对应系统
  const actions: Array<{ label: string; run: () => void }> = [];
  if (op.includes("回收") && op.includes("背包")) actions.push({ label: "打开背包选择回收物", run: () => send("packRecycle", { refs: promptRefs("输入要回收的物品编号（段#号，逗号分隔，如 普#5,普#6）") }) });
  if (op.includes("社区预约")) actions.push({ label: "预约上午段", run: () => send("bookSlot", { slot: "am" }) });
  if (op.includes("社区预约")) actions.push({ label: "预约下午段", run: () => send("bookSlot", { slot: "pm" }) });
  if (op.includes("档案调查")) actions.push({ label: "档案调查（选两人）", run: () => {
    const a = window.prompt("档案A：输入玩家编号（名单见档案页）"); if (!a) return;
    const b = window.prompt("档案B：输入玩家编号"); if (!b) return;
    send("officeArchive", { aId: a.trim(), bId: b.trim() });
  } });
  if (op.includes("查阅昨日社区预约")) actions.push({ label: "调阅昨日预约", run: () => send("deptBookings") });
  if (op.includes("抹除一条随机规则")) actions.push({ label: "抹除规则", run: () => {
    const r = window.prompt("要抹除的规则编号（如 R2，看规则板）"); if (r) send("cceErase", { ruleId: r.trim() });
  } });
  if (op.includes("校园墙")) actions.push({ label: "盗入校园墙", run: () => {
    const c = window.prompt("三选一：1 破译规则 / 2 三好学生表彰 / 3 匿名担保"); if (!c) return;
    const act = c.trim() === "2" ? "commend" : c.trim() === "3" ? "guarantee" : "decode";
    let targetId = "";
    if (act !== "decode") { const t = window.prompt("对象玩家编号"); if (!t) return; targetId = t.trim(); }
    send("press", { action: act, targetId });
  } });
  if (op.includes("回复健康值50或精神值30")) actions.push({ label: "回复健康值 50", run: () => send("cafe", { kind: "hp" }) });
  if (op.includes("回复健康值50或精神值30")) actions.push({ label: "回复精神值 30", run: () => send("cafe", { kind: "san" }) });
  if (op.includes("校验今日预约时段")) actions.push({ label: "刷闸机进入", run: () => send("bookSlot", { slot: "am" }) });
  if (op.includes("调监控")) actions.push({ label: "调监控", run: () => send("camera") });
  if (op.includes("查询机器使用记录") || op.includes("记录调阅")) actions.push({ label: "调阅设施记录", run: () => {
    const f = window.prompt("设施：超市售货机/校医院药房/图书馆闸机/操场闸机/体育馆闸机/社区闸机/行政楼影像室/网络中心");
    if (f) send("inspectLog", { facility: f.trim() });
  } });
  if (op.includes("剪断网线")) actions.push({ label: "剪断网线", run: () => send("cutNet") });
  if (op.includes("修复网线")) actions.push({ label: "修复网线", run: () => send("repairNet") });
  if (op.includes("处理伤口")) actions.push({ label: "处理伤口", run: () => send("buyMedicine") });

  if (!shopItems.length && !actions.length) return null;
  return (
    <div className="sv-op">
      {shopItems.length > 0 && (
        <div className="sv-op-shop">
          {shopItems.map((it) => (
            <button key={it.name} className="sv-op-btn" onClick={() => send("sceneBuy", { sceneId, name: it.name })}>
              {it.name} · {it.price}币
            </button>
          ))}
        </div>
      )}
      {actions.map((a) => (
        <button key={a.label} className="sv-op-btn" onClick={a.run}>{a.label}</button>
      ))}
    </div>
  );
}

function promptRefs(hint: string): string[] {
  const raw = window.prompt(hint);
  if (!raw) return [];
  return raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
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
