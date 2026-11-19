import { useEffect, useRef, useState } from "react";
import type { GameRoom } from "../lib/client";

interface SceneEv { choice: string; result: string; result_taken?: string; room?: string; children?: string[] }
interface SceneJson {
  situations: Record<string, string>;
  rooms?: Record<string, string>;
  intro?: string;
  events: Record<string, SceneEv>;
}
interface SceneResult {
  sceneId: string; eventId: string; taken: boolean; fake: boolean;
  text: string; op?: string | null;
  grants: Array<{ name: string; ref: string }>;
  states: Record<string, number>;
}
interface QuizMsg { sceneId: string; eventId: string; question: string; numeric: boolean; rule: string }

interface TextBlock { main: string; grants?: string[]; states?: string[]; fake?: boolean; taken?: boolean }

const strip = (s: string) => s.replace(/\{[^}]*\}/g, "").trim();
const STATE_CN: Record<string, string> = { ap: "行动值", hunger: "饥饿值", hp: "健康值", san: "精神值" };
// 每房间只注册一次消息监听（避免 StrictMode 双挂载与切节点残留）
const wiredRooms = new WeakSet<object>();
let lastResult: (SceneResult & { eventId: string }) | null = null;
let lastQuiz: QuizMsg | null = null;

type Screen = { k: "hub" } | { k: "room"; id: string } | { k: "result" };

/**
 * 全屏场景界面（文游式）：
 * 上方叙事文本，中间当前可选行动；点选后选项消失，结果文本浮现，再长出新的选项。
 * 屏幕状态机：hub（房间列表/平铺）→ room（房间内）→ result（事件结果+子分支）。
 */
export function SceneView({ room, nodeId, san }: { room: GameRoom; nodeId: string; san: number }) {
  const [scene, setScene] = useState<SceneJson | null>(null);
  const [screen, setScreen] = useState<Screen>({ k: "hub" });
  const [text, setText] = useState<TextBlock | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(SceneResult & { eventId: string }) | null>(null);
  const [quiz, setQuiz] = useState<QuizMsg | null>(null);

  useEffect(() => {
    let dead = false;
    setScene(null); setScreen({ k: "hub" }); setText(null); setResult(null); setQuiz(null); setBusy(null);
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
      if (lastResult) {
        const r = lastResult; lastResult = null;
        setResult(r); setQuiz(null); setBusy(null);
        setScreen({ k: "result" });
        setText({
          main: r.text,
          grants: r.grants.length ? r.grants.map((g) => g.name) : undefined,
          states: Object.keys(r.states).length
            ? Object.entries(r.states).map(([k, v]) => `${STATE_CN[k]} ${v > 0 ? "+" : ""}${v}`)
            : undefined,
          fake: r.fake || undefined,
          taken: r.taken || undefined,
        });
      }
      if (lastQuiz) { setQuiz(lastQuiz); lastQuiz = null; setBusy(null); }
    }, 300);
    return () => clearInterval(t);
  }, []);

  // 场景载入后写入入口文本
  useEffect(() => {
    if (!scene) return;
    setText({ main: scene.intro ?? Object.values(scene.situations)[0] ?? "" });
  }, [scene]);

  if (!scene) return <p className="sv-empty">这里一片寂静。</p>;

  const rooms = scene.rooms ?? {};
  const roomNames = Object.keys(rooms);
  const hasRooms = roomNames.length > 0;
  // 被 children 引用的事件不直接出现在任何列表
  const childIds = new Set<string>();
  for (const ev of Object.values(scene.events)) ev.children?.forEach((c) => childIds.add(c));
  const topIds = Object.keys(scene.events).filter((id) => !childIds.has(id));

  const clickEvent = (eventId: string) => {
    if (busy) return;
    setBusy(eventId);
    setQuiz(null);
    room.send("sceneEvent", { sceneId: nodeId, eventId });
  };
  const answerQuiz = (answer: string) => {
    if (!quiz || !answer.trim()) return;
    setBusy(quiz.eventId);
    const q = quiz;
    setQuiz(null);
    room.send("sceneEvent", { sceneId: q.sceneId, eventId: q.eventId, answer: answer.trim() });
  };
  const goRoom = (id: string) => {
    setScreen({ k: "room", id });
    setText({ main: rooms[id] });
    setResult(null); setQuiz(null);
  };
  const goHub = () => {
    setScreen({ k: "hub" });
    setText({ main: scene.intro ?? Object.values(scene.situations)[0] ?? "" });
    setResult(null); setQuiz(null);
  };

  // —— 组装当前屏幕的选项 ——
  type Opt = { key: string; label: string; run: () => void; dim?: boolean };
  const opts: Opt[] = [];
  if (!busy && !quiz) {
    if (screen.k === "hub") {
      if (hasRooms) {
        for (const name of roomNames) opts.push({ key: `r:${name}`, label: `走进${name}`, run: () => goRoom(name) });
        for (const id of topIds) {
          const ev = scene.events[id];
          if (!ev.room) opts.push({ key: `e:${id}`, label: strip(ev.choice), run: () => clickEvent(id) });
        }
        // 幻觉入口：SAN≤30 时教学楼多出「不存在的 404 教室」
        if (/^t[A-C]$/.test(nodeId) && san <= 30) {
          opts.push({ key: "illusion", label: "走廊尽头多出一间 404 教室……", run: () => clickEvent("__illusion"), dim: true });
        }
      } else {
        for (const id of topIds) opts.push({ key: `e:${id}`, label: strip(scene.events[id].choice), run: () => clickEvent(id) });
      }
    } else if (screen.k === "room") {
      for (const id of topIds) {
        const ev = scene.events[id];
        if (ev.room === screen.id) opts.push({ key: `e:${id}`, label: strip(ev.choice), run: () => clickEvent(id) });
      }
      opts.push({ key: "back-hub", label: "退出来", run: goHub, dim: true });
    } else {
      // result 屏幕：子分支 + 操作控件 + 归位选项
      const ev = result ? scene.events[result.eventId] : null;
      if (result && ev?.children) {
        for (const c of ev.children) {
          const ce = scene.events[c];
          if (ce) opts.push({ key: `c:${c}`, label: strip(ce.choice), run: () => clickEvent(c) });
        }
      }
      if (result?.op && !result.fake) {
        for (const a of opActions(room, nodeId, result.op)) opts.push({ key: `op:${a.label}`, label: a.label, run: a.run });
      }
      const roomOf = result ? scene.events[result.eventId]?.room : undefined;
      if (roomOf) opts.push({ key: "back-room", label: `留在${roomOf}`, run: () => goRoom(roomOf), dim: true });
      opts.push({ key: "back-hub2", label: hasRooms ? "去别的房间" : "继续", run: goHub, dim: true });
    }
  }

  return (
    <div className="sv2">
      <div className={`sv2-text${text?.taken ? " taken" : ""}`}>
        {text ? (
          <>
            <TypeText text={text.main} />
            {text.grants && <p className="sv2-grants">获得：{text.grants.join("、")}</p>}
            {text.states && <p className="sv2-states">{text.states.join("，")}</p>}
            {text.fake && <p className="sv2-fake">（你记住了这里的一切。它不会少，你也不会多。）</p>}
          </>
        ) : (
          busy && <p className="sv2-dots">……</p>
        )}
      </div>

      <div className="sv2-opts">
        {quiz ? (
          <div className="sv2-quiz">
            <p className="sv2-quiz-q">{quiz.question}</p>
            <QuizFill numeric={quiz.numeric} onSubmit={answerQuiz} />
            <p className="sv2-quiz-rule">判定：{quiz.rule}</p>
          </div>
        ) : (
          <>
            {opts.map((o) => (
              <button key={o.key} className={`sv2-opt${o.dim ? " dim" : ""}`} disabled={busy !== null} onClick={o.run}>
                {o.label}
              </button>
            ))}
            {busy && !text && <p className="sv2-dots">……</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** 打字机文本：逐字浮现，点击一次立即显示全文 */
function TypeText({ text }: { text: string }) {
  const [n, setN] = useState(0);
  const full = useRef(false);
  useEffect(() => { setN(0); full.current = false; }, [text]);
  useEffect(() => {
    if (n >= text.length) return;
    const t = setTimeout(() => setN((v) => Math.min(v + 2, text.length)), 18);
    return () => clearTimeout(t);
  }, [n, text]);
  const done = n >= text.length;
  return (
    <p
      className="sv2-main"
      onClick={() => { if (!done) { setN(text.length); full.current = true; } }}
    >
      {text.slice(0, n)}
      {!done && <span className="sv2-caret">▌</span>}
    </p>
  );
}

/** {操作} 解析为选项动作（与旧 OpPanel 同一套消息通道） */
function opActions(room: GameRoom, sceneId: string, op: string): Array<{ label: string; run: () => void }> {
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const actions: Array<{ label: string; run: () => void }> = [];
  const buyMatch = op.match(/购买——(.+)/);
  if (buyMatch) {
    for (const s of buyMatch[1].split("/")) {
      const m = s.trim().match(/^(.+?)(\d+)$/);
      if (m) actions.push({ label: `${m[1].trim()} · ${m[2]}币`, run: () => send("sceneBuy", { sceneId, name: m[1].trim() }) });
    }
  }
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
  return actions;
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
