// 场景文本引擎：加载 campus_text.json，解析 {} 机制标注，驱动答题判定与结算
// 数据契约见 docs/网站落地建议.md —— 服务端只存状态与编号，文案由客户端渲染
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface SceneEvent {
  choice: string;
  result: string;
  result_taken?: string;
}
export interface SceneData {
  situations: Record<string, string>;
  events: Record<string, SceneEvent>;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "client", "public", "scenes");

export function loadScenes(): Record<string, SceneData> {
  const out: Record<string, SceneData> = {};
  if (!existsSync(DATA_DIR)) return out;
  for (const f of readdirSyncSafe(DATA_DIR)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try {
      out[f.replace(".json", "")] = JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8"));
    } catch { /* 跳过坏文件 */ }
  }
  return out;
}

export interface WikiEntry { seg: string; num?: number; count?: string; value: number | null; weight: number; desc: string; effect?: string }
/** wiki.json：名称 → 属性（客户端 public，服务端同读） */
export function loadWiki(): Record<string, WikiEntry> {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, "..", "wiki.json"), "utf-8"));
  } catch { return {}; }
}
/** 反查：段#号 → 名称 */
export function refToName(wiki: Record<string, WikiEntry>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [name, w] of Object.entries(wiki)) {
    if (w.num != null) m.set(`${w.seg}#${w.num}`, name);
  }
  return m;
}

export interface ShopItem { sceneId: string; name: string; price: number; ref: string }
/** 从场景文本 {操作:购买——名N/名N…} 解析货表（与文案同一份数据源） */
export function loadShop(wiki: Record<string, WikiEntry>, scenes: Record<string, SceneData>): ShopItem[] {
  // 名称 → 段#号 反查（refToName 是反向映射，不能直接用）
  const refOf = new Map<string, string>();
  for (const [name, w] of Object.entries(wiki)) {
    if (w.num != null) refOf.set(name, `${w.seg}#${w.num}`);
  }
  const out: ShopItem[] = [];
  for (const [sceneId, sc] of Object.entries(scenes)) {
    for (const ev of Object.values(sc.events)) {
      const text = `${ev.choice}\n${ev.result}`;
      for (const m of text.matchAll(/\{操作:购买——([^}]+)\}/g)) {
        for (const part of m[1].split("/")) {
          const pm = part.trim().match(/^(.+?)(\d+)$/);
          if (!pm) continue;
          const name = pm[1];
          const ref = refOf.get(name);
          if (ref) out.push({ sceneId, name, price: Number(pm[2]), ref });
        }
      }
    }
  }
  return out;
}
function readdirSyncSafe(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

// ---------- 标注解析 ----------

export interface Grant { name: string; seg: string; num: number; ref: string }
export interface StateDelta { ap?: number; hunger?: number; hp?: number; san?: number }
export interface QuizSpec {
  question: string; options: string[]; rule: string; ruleType: "static" | "dynamic_visit" | "dynamic_alive" | "dynamic_room" | "dynamic_report";
  staticAnswer?: number; // 静态题正确选项（1 起）
}
export interface ParsedEvent {
  grants: Grant[];
  states: StateDelta;
  quiz?: QuizSpec;
  op?: string;          // {操作:...} 原文
  foodRisk?: boolean;   // 含「食物存在问题」随机判定
  coinCost?: number;    // {操作:支付货币N}
  plain: string;        // 去掉标注的纯文本（客户端展示用不到，服务端调试可用）
}

const GRANT_RE = /(?:获得物品?|\{获得):([^()（）]+)\((普|高|关|耗)#(\d+)\)\}?/g;
const STATE_RE = /\{状态:([^}]+)\}/;
const QUIZ_RE = /\{答题:(.*)\}$/;
const OP_RE = /\{操作:([^}]*)\}/g;

export function parseEvent(ev: SceneEvent): ParsedEvent {
  const text = ev.result;
  const grants: Grant[] = [];
  for (const m of text.matchAll(GRANT_RE)) {
    grants.push({ name: m[1], seg: m[2], num: Number(m[3]), ref: `${m[2]}#${m[3]}` });
  }
  const states: StateDelta = {};
  const sm = text.match(STATE_RE);
  if (sm) {
    for (const part of sm[1].split(/[，,]/)) {
      const pm = part.trim().match(/^(行动值|饥饿值|健康值|精神值)([+-]\d+)/);
      if (!pm) continue;
      const v = Number(pm[2]);
      if (pm[1] === "行动值") states.ap = v;
      if (pm[1] === "饥饿值") states.hunger = v;
      if (pm[1] === "健康值") states.hp = v;
      if (pm[1] === "精神值") states.san = v;
    }
  }
  let quiz: QuizSpec | undefined;
  const qm = text.match(QUIZ_RE);
  if (qm) {
    const body = qm[1];
    const q = body.match(/^\s*([^|]+)/)?.[1]?.trim() ?? "";
    const options = body.match(/选项:([^|]+)/)?.[1]?.split(",").map((s) => s.trim()) ?? [];
    const rule = body.match(/规则:([^|]+)/)?.[1]?.trim() ?? "";
    const staticM = rule.match(/预设正确选项=第(\d+)项/);
    const ruleType = rule.startsWith("dynamic_visit") ? "dynamic_visit"
      : rule.startsWith("dynamic_alive") ? "dynamic_alive"
      : rule.startsWith("dynamic_room") ? "dynamic_room"
      : rule.startsWith("dynamic_report") ? "dynamic_report"
      : "static";
    quiz = { question: q, options, rule, ruleType, staticAnswer: staticM ? Number(staticM[1]) : undefined };
  }
  let op: string | undefined;
  let foodRisk = false;
  let coinCost = 0;
  for (const m of text.matchAll(OP_RE)) {
    op = m[1];
    if (op.includes("食物存在问题")) foodRisk = true;
    const cm = op.match(/支付货币(\d+)/);
    if (cm) coinCost = Number(cm[1]);
  }
  if (!op) {
    for (const m of ev.choice.matchAll(OP_RE)) {
      op = m[1];
      if (op.includes("食物存在问题")) foodRisk = true;
      const cm = op.match(/支付货币(\d+)/);
      if (cm) coinCost = Number(cm[1]);
    }
  }
  const plain = text.replace(GRANT_RE, "").replace(STATE_RE, "").replace(QUIZ_RE, "").replace(OP_RE, "");
  return { grants, states, quiz, op, foodRisk, coinCost, plain };
}

/** 答题分支解析：答对/答错各带独立文本与效果（分支内状态为无花括号写法「状态:…」） */
export function parseQuizBranch(body: string, side: "答对" | "答错"): { text: string; grants: Grant[]; states: StateDelta } {
  const re = new RegExp(`${side}:([^|}]*)`);
  const raw = body.match(re)?.[1] ?? "";
  const grants: Grant[] = [];
  for (const m of raw.matchAll(GRANT_RE)) {
    grants.push({ name: m[1], seg: m[2], num: Number(m[3]), ref: `${m[2]}#${m[3]}` });
  }
  const states: StateDelta = {};
  const sm = raw.match(/状态:([^|}]+)/);
  if (sm) {
    for (const part of sm[1].split(/[，,]/)) {
      const pm = part.trim().match(/^(行动值|饥饿值|健康值|精神值)([+-]\d+)/);
      if (!pm) continue;
      const v = Number(pm[2]);
      if (pm[1] === "行动值") states.ap = v;
      if (pm[1] === "饥饿值") states.hunger = v;
      if (pm[1] === "健康值") states.hp = v;
      if (pm[1] === "精神值") states.san = v;
    }
  }
  const text = raw.replace(GRANT_RE, "").replace(/状态:[^|}]+/g, "").trim();
  return { text, grants, states };
}
