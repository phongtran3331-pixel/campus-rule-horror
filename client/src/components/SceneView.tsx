import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Player } from "../../../server/src/schema/GameState";
import type { GameRoom } from "../lib/client";

// 回收定价 wiki：普通/高价值按 Wiki 价值；关键道具仅「褶皱的咖啡券」可收（40）；消耗品不收
interface WikiItem { seg: string; num?: number; value: number | null; weight: number; desc: string }
let wikiCache: Record<string, WikiItem> | null = null;
function loadWiki(): Promise<Record<string, WikiItem>> {
  if (wikiCache) return Promise.resolve(wikiCache);
  return fetch("wiki.json").then((r) => (r.ok ? r.json() : {})).then((j) => { wikiCache = j; return j; }).catch(() => ({}));
}
function refNameOf(wiki: Record<string, WikiItem>, ref: string): string {
  const hit = Object.keys(wiki).find((k) => wiki[k].seg === ref.split("#")[0] && wiki[k].num === Number(ref.split("#")[1]));
  if (hit) return hit;
  // 关段物品 wiki 无编号，按条目顺序补 关#1..N
  const seg = ref.split("#")[0];
  const n = Number(ref.split("#")[1]);
  const ordered = Object.keys(wiki).filter((k) => wiki[k].seg === seg && (wiki[k].num == null));
  return ordered[n - 1] ?? ref;
}
function recyclePrice(wiki: Record<string, WikiItem>, ref: string): number | null {
  const name = refNameOf(wiki, ref);
  const w = wiki[name];
  if (!w) return null;
  if (w.seg === "普" || w.seg === "高") return w.value ?? 1;
  if (name === "褶皱的咖啡券") return 40;
  return null;
}

// 房间卡配色：名称散列 → 色相（同一房间颜色稳定，不同房间错开）
const roomHue = (name: string): number => {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
};

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
// 关键物品贴图（与 Terminal.tsx 背包一致）
const ITEM_IMG: Record<string, string> = {
  "关#1": "assets/items/key-community.png",
  "关#6": "assets/items/key-locker.png",
  "关#7": "assets/items/key-master.png",
};
// 每房间只注册一次消息监听（避免 StrictMode 双挂载与切节点残留）
const wiredRooms = new WeakSet<object>();
let lastResult: (SceneResult & { eventId: string }) | null = null;
let lastQuiz: QuizMsg | null = null;
let lastEntered: { sceneId: string; room: string } | null = null;

type Screen = { k: "hub" } | { k: "room"; id: string } | { k: "result" };

/**
 * 全屏场景界面（文游式）：
 * 上方叙事文本，中间当前可选行动；点选后选项消失，结果文本浮现，再长出新的选项。
 * 屏幕状态机：hub（房间列表/平铺）→ room（房间内）→ result（事件结果+子分支）。
 */
export function SceneView({ room, nodeId, san, me, onExit }: { room: GameRoom; nodeId: string; san: number; me: Player; onExit: () => void }) {
  const [scene, setScene] = useState<SceneJson | null>(null);
  const [screen, setScreen] = useState<Screen>({ k: "hub" });
  const [text, setText] = useState<TextBlock | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(SceneResult & { eventId: string }) | null>(null);
  const [quiz, setQuiz] = useState<QuizMsg | null>(null);
  const [grantModal, setGrantModal] = useState<{ names: string[]; refs: string[] } | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  // 轮询闭包只认首次渲染：nodeId / scene 必须走 ref，否则切节点后 sceneEntered 被丢弃、rooms 还是空对象
  const nodeIdRef = useRef(nodeId);
  const sceneRef = useRef(scene);
  nodeIdRef.current = nodeId;
  sceneRef.current = scene;

  useEffect(() => {
    let dead = false;
    setScene(null); setScreen({ k: "hub" }); setText(null); setResult(null); setQuiz(null); setBusy(null); setGrantModal(null);
    fetch(`scenes/${nodeId}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) setScene(j); }).catch(() => {});
    return () => { dead = true; };
  }, [nodeId]);

  useEffect(() => {
    if (wiredRooms.has(room)) return;
    wiredRooms.add(room);
    room.onMessage("sceneResult", (r: SceneResult) => { lastResult = { ...r, eventId: r.eventId }; lastQuiz = null; });
    room.onMessage("sceneQuiz", (q: QuizMsg) => { lastQuiz = q; });
    room.onMessage("sceneEntered", (m: { sceneId: string; room: string }) => { lastEntered = m; });
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
          states: Object.entries(r.states).filter(([k, v]) => typeof v === "number" && STATE_CN[k]).length
            ? Object.entries(r.states)
                .filter(([k, v]) => typeof v === "number" && STATE_CN[k])
                .map(([k, v]) => `${STATE_CN[k]} ${v > 0 ? "+" : ""}${v}`)
            : undefined,
          fake: r.fake || undefined,
          taken: r.taken || undefined,
        });
        // 获得物资：弹窗确认收下或丢弃
        if (r.grants.length && !r.taken && !r.fake) {
          setGrantModal({ names: r.grants.map((g) => g.name), refs: r.grants.map((g) => g.ref) });
        }
      }
      if (lastQuiz) { setQuiz(lastQuiz); lastQuiz = null; setBusy(null); }
      if (lastEntered) {
        const m = lastEntered; lastEntered = null;
        if (m.sceneId === nodeIdRef.current) {
          setBusy(null);
          setScreen({ k: "room", id: m.room });
          setText({ main: sceneRef.current?.rooms?.[m.room] ?? "" });
          setResult(null); setQuiz(null);
        }
      }
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
  // 进房间：干事 -1 AP（服务端判定），成功回 sceneEntered 后切屏；无回应 2.5s 解除等待
  const enterRoom = (name: string) => {
    if (busy) return;
    setBusy(`room:${name}`);
    room.send("sceneRoom", { sceneId: nodeId, room: name });
    window.setTimeout(() => setBusy((b) => (b === `room:${name}` ? null : b)), 2500);
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
  // kind: sq = 圆角正方形地点卡（房间）；rect = 圆角长方形事件卡；dim = 暗色导航
  type Opt = { key: string; label: string; run: () => void; kind: "sq" | "rect" | "dim" };
  const opts: Opt[] = [];
  if (!busy && !quiz) {
    if (screen.k === "hub") {
      if (!hasRooms) {
        for (const id of topIds) opts.push({ key: `e:${id}`, label: strip(scene.events[id].choice), run: () => clickEvent(id), kind: "rect" });
        opts.push({ key: "exit-hub0", label: "回到大地图", run: onExit, kind: "dim" });
      } else {
        for (const id of topIds) {
          const ev = scene.events[id];
          if (!ev.room) opts.push({ key: `e:${id}`, label: strip(ev.choice), run: () => clickEvent(id), kind: "rect" });
        }
        // 幻觉入口：SAN≤30 时教学楼多出「不存在的 404 教室」
        if (/^t[A-C]$/.test(nodeId) && san <= 30) {
          opts.push({ key: "illusion", label: "走廊尽头多出一间 404 教室……", run: () => clickEvent("__illusion"), kind: "dim" });
        }
        opts.push({ key: "exit-hub", label: "回到大地图", run: onExit, kind: "dim" });
      }
    } else if (screen.k === "room") {
      for (const id of topIds) {
        const ev = scene.events[id];
        if (ev.room === screen.id) opts.push({ key: `e:${id}`, label: strip(ev.choice), run: () => clickEvent(id), kind: "rect" });
      }
      // 退回只能回到选择子节点的位置（地点列表），不能越级回大地图
      opts.push({ key: "back-hub1", label: "返回地点列表", run: goHub, kind: "dim" });
    } else {
      // result 屏幕：子分支 + 操作控件；END 后只能返回地点列表（子节点选择界面），不能退回房间或大地图
      const ev = result ? scene.events[result.eventId] : null;
      if (result && ev?.children) {
        for (const c of ev.children) {
          const ce = scene.events[c];
          if (ce) opts.push({ key: `c:${c}`, label: strip(ce.choice), run: () => clickEvent(c), kind: "rect" });
        }
      }
      if (result?.op && !result.fake) {
        for (const a of opActions(room, nodeId, result.op)) opts.push({ key: `op:${a.label}`, label: a.label, run: a.run, kind: "rect" });
      }
      opts.push({ key: "back-hub2", label: "返回地点列表", run: goHub, kind: "dim" });
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
        ) : screen.k === "hub" && hasRooms ? (
          <>
            {/* 地点卡片：圆角正方形，进入 -1 AP（干事） */}
            <div className="sv2-cards">
              {roomNames.map((name, i) => (
                <button
                  key={name}
                  className="sv2-card"
                  style={{ "--h": roomHue(name), animationDelay: `${i * 40}ms` } as CSSProperties}
                  disabled={busy !== null}
                  onClick={() => enterRoom(name)}
                >
                  <span className="sv2-card-name">{name}</span>
                  <span className="sv2-card-cost">-1 AP</span>
                </button>
              ))}
            </div>
            {opts.filter((o) => o.kind !== "sq").map((o) => (
              <button key={o.key} className={`sv2-opt${o.kind === "dim" ? " dim" : ""}`} disabled={busy !== null} onClick={o.run}>
                {o.label}
              </button>
            ))}
          </>
        ) : (
          <>
            {/* 回收站：交易入口（2x2 圆角方块，不消耗 AP） */}
            {screen.k === "hub" && nodeId === "recycle" && (
              <div className="sv2-cards">
                <button
                  className="sv2-card sv2-card-trade"
                  style={{ "--h": 150, animationDelay: "0ms" } as CSSProperties}
                  disabled={busy !== null}
                  onClick={() => setTradeOpen(true)}
                >
                  <span className="sv2-card-name">交易</span>
                </button>
              </div>
            )}
            {opts.map((o) => (
              <button key={o.key} className={`sv2-opt${o.kind === "dim" ? " dim" : ""}`} disabled={busy !== null} onClick={o.run}>
                {o.label}
              </button>
            ))}
            {busy && !text && <p className="sv2-dots">……</p>}
          </>
        )}
      </div>

      {grantModal && (
        <div className="sv2-mask">
          <div className="sv2-modal">
            <p className="sv2-modal-title">获得物品</p>
            <div className="sv2-modal-items">
              {grantModal.refs.map((ref, i) => (
                <div key={ref} className="sv2-modal-item">
                  {ITEM_IMG[ref] && <img src={ITEM_IMG[ref]} alt={grantModal.names[i]} />}
                  <span>{grantModal.names[i]}</span>
                </div>
              ))}
            </div>
            <div className="sv2-modal-btns">
              <button className="sv2-opt" onClick={() => setGrantModal(null)}>收下</button>
              <button
                className="sv2-opt danger"
                onClick={() => { room.send("packDrop", { refs: grantModal.refs }); setGrantModal(null); }}
              >
                丢弃
              </button>
            </div>
          </div>
        </div>
      )}

      {tradeOpen && (
        <div className="sv2-mask">
          <RecyclePanel me={me} room={room} onClose={() => setTradeOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** 打字机文本：逐字浮现，点击一次立即显示全文 */
function TypeText({ text }: { text: string }) {
  const [n, setN] = useState(0);
  const full = useRef(false);
  const safe = text ?? "";
  useEffect(() => { setN(0); full.current = false; }, [text]);
  useEffect(() => {
    if (n >= safe.length) return;
    const t = setTimeout(() => setN((v) => Math.min(v + 2, safe.length)), 18);
    return () => clearTimeout(t);
  }, [n, safe]);
  const done = n >= safe.length;
  return (
    <p
      className="sv2-main"
      onClick={() => { if (!done) { setN(safe.length); full.current = true; } }}
    >
      {safe.slice(0, n)}
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
    const a = window.prompt("档案A：输入玩家名字"); if (!a) return;
    const b = window.prompt("档案B：输入玩家名字"); if (!b) return;
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
    if (act !== "decode") { const t = window.prompt("对象玩家名字"); if (!t) return; targetId = t.trim(); }
    send("press", { action: act, targetId });
  } });
  if (op.includes("回复健康值50或精神值30")) actions.push({ label: "回复健康值 50", run: () => send("cafe", { kind: "hp" }) });
  if (op.includes("回复健康值50或精神值30")) actions.push({ label: "回复精神值 30", run: () => send("cafe", { kind: "san" }) });
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

/** 回收站交易面板：按 Wiki 价值回收普通/高价值物品与咖啡券；消耗品、其余关键道具不收；一次超过 5 件会掉 SAN */
function RecyclePanel({ me, room, onClose }: { me: Player; room: GameRoom; onClose: () => void }) {
  const [wiki, setWiki] = useState<Record<string, WikiItem> | null>(wikiCache);
  const [qty, setQty] = useState<Record<string, number>>({});
  useEffect(() => { loadWiki().then(setWiki); }, []);

  const entries = [...me.pack.entries()]
    .map(([ref, n]) => ({ ref, n, name: wiki ? refNameOf(wiki, ref) : ref, price: wiki ? recyclePrice(wiki, ref) : null }))
    .sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  const tradable = entries.filter((e) => e.price != null);

  const total = tradable.reduce((s, e) => s + (e.price ?? 0) * (qty[e.ref] ?? 0), 0);
  const count = tradable.reduce((s, e) => s + (qty[e.ref] ?? 0), 0);

  const confirm = () => {
    const refs: string[] = [];
    for (const e of tradable) for (let i = 0; i < (qty[e.ref] ?? 0); i++) refs.push(e.ref);
    if (refs.length) room.send("packRecycle", { refs });
    onClose();
  };

  return (
    <div className="sv2-modal sv2-trade">
      <p className="sv2-modal-title">交易 · 地磅</p>
      {!wiki ? <p className="sv2-dots">……</p> : tradable.length === 0 ? (
        <p className="sv2-trade-empty">背包里没有能出手的货。</p>
      ) : (
        <div className="sv2-trade-list">
          {tradable.map((e) => (
            <div key={e.ref} className="sv2-trade-row">
              <span className="sv2-trade-name">{e.name}</span>
              <span className="sv2-trade-have">×{e.n}</span>
              <span className="sv2-trade-price">{e.price} 币</span>
              <span className="sv2-trade-qty">
                <button onClick={() => setQty((q) => ({ ...q, [e.ref]: Math.max(0, (q[e.ref] ?? 0) - 1) }))}>−</button>
                <b>{qty[e.ref] ?? 0}</b>
                <button onClick={() => setQty((q) => ({ ...q, [e.ref]: Math.min(e.n, (q[e.ref] ?? 0) + 1) }))}>＋</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="sv2-trade-rule">消耗品与关键道具不收，咖啡券除外。一次递超过五件，老板会盯着你多看一眼。</p>
      <div className="sv2-modal-btns">
        <button className="sv2-opt" disabled={count === 0} onClick={confirm}>出掉（{count} 件 · {total} 币）</button>
        <button className="sv2-opt dim" onClick={onClose}>再想想</button>
      </div>
    </div>
  );
}
