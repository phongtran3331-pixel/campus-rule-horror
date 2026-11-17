// 文本数据同步：output/<场景>/campus_text.json → client/public/scenes/<nodeId>.json + wiki.json
// 场景目录名 → 地图节点 id（须与 server/src/data/map.ts 的 NODES 一致）
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE2NODE = {
  "学校大门": "gate", "食堂": "canteen", "校医院": "clinic", "超市": "market",
  "教学楼A": "tA", "教学楼B": "tB", "教学楼C": "tC", "图书馆": "library",
  "操场": "field", "学生社区": "community", "回收站": "recycle",
  "体育馆": "gym", "行政楼": "admin", "宿舍": "dorm", "小树林": "woods",
};
const NODE2NAME = Object.fromEntries(Object.entries(SCENE2NODE).map(([k, v]) => [v, k]));

const outDir = join(root, "client", "public", "scenes");
mkdirSync(outDir, { recursive: true });
const index = {};
for (const dir of readdirSync(join(root, "output"))) {
  const src = join(root, "output", dir, "campus_text.json");
  if (!existsSync(src)) continue;
  const nodeId = SCENE2NODE[dir];
  if (!nodeId) { console.warn(`[sync] 未映射场景目录: ${dir}`); continue; }
  const data = JSON.parse(readFileSync(src, "utf-8"));
  copyFileSync(src, join(outDir, `${nodeId}.json`));
  index[nodeId] = { name: dir, situations: Object.keys(data.situations).length, events: Object.keys(data.events).length };
}

// wiki.json：从 docs/物品Wiki_原始.txt 解析四张表 → 名称 → 属性
const wikiText = readFileSync(join(root, "docs", "物品Wiki_原始.txt"), "utf-8");
const wiki = {};
let section = "";
for (const line of wikiText.split("\n")) {
  const sm = line.match(/^## ([一二三四])、/);
  if (sm) { section = { "一": "普", "二": "高", "三": "关", "四": "耗" }[sm[1]]; continue; }
  if (!line.startsWith("|") || line.startsWith("|---")) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (section === "关") {
    // 关表无 # 列：| 物品 | 数量 | 价值 | 负重 | 描述与用途 | 可能来源 |
    const [name, count, value, weight, desc] = cells;
    if (!name || name === "物品") continue;
    wiki[name] = { seg: "关", count, value: value === "—" ? null : Number(value) || null, weight: Number(weight) || 0, desc };
  } else if (section && cells[0] && /^\d+$/.test(cells[0])) {
    const [num, name, value, weight, desc] = cells;
    wiki[name] = { seg: section, num: Number(num), value: section === "耗" ? null : Number(value) || 0, weight: Number(weight) || 0, desc, effect: section === "耗" ? cells[2] : undefined };
  }
}
writeFileSync(join(outDir, "..", "wiki.json"), JSON.stringify(wiki, null, 1));
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(`[sync] 场景 ${Object.keys(index).length} 个，wiki 条目 ${Object.keys(wiki).length} 条`);
