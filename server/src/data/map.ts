// 地图数据：14 节点 + 连接（坐标已按美术底图 map_campus_day/evening 校准，百分比）
// 对应建筑：大门=南门门楼，食堂=中央玻璃楼，图书馆=喷泉南侧主楼，
// 教学楼群=东侧三连楼，校医院=东侧红十字楼，超市=东南红砖楼，
// 体育馆=西北穹顶，操场=西北田径场，宿舍=西侧长楼，学生社区=北侧小楼，
// 行政楼=中右独立楼，回收站=西北角小平房
export interface MapNode {
  id: string;
  name: string;
  x: number; // 0-100
  y: number;
  type: "A" | "B"; // A 类有子位置，B 类开放空间
  desc: string;
}

export const NODES: MapNode[] = [
  { id: "dorm",      name: "宿舍",       x: 13, y: 51, type: "B", desc: "你的床位在这里。21:00 前必须回来，熄灯之后的每一句话都会被记下来。" },
  { id: "canteen",   name: "食堂",       x: 44, y: 37, type: "B", desc: "每天中午，全体在这里集会。饭菜便宜，但没人保证今天厨师的心情。" },
  { id: "clinic",    name: "校医院",     x: 94, y: 59, type: "B", desc: "药品比外面便宜。白大褂们从不多问，也从不多答。" },
  { id: "market",    name: "超市",       x: 68, y: 70, type: "B", desc: "食物与工具，售货机全天开着。它记得每一次购买记录。" },
  { id: "tA",        name: "教学楼A",    x: 66, y: 29, type: "A", desc: "上课中的教室请勿打扰。走廊尽头的门牌，数一遍是十三间，再数一遍不是。" },
  { id: "tB",        name: "教学楼B",    x: 77, y: 24, type: "A", desc: "最高的教学楼。顶层楼梯间的灯总是坏的，报修了，没人来。" },
  { id: "tC",        name: "教学楼C",    x: 81, y: 31, type: "A", desc: "实验楼。下午五点后，储物柜里会传出很轻的声音。" },
  { id: "library",   name: "图书馆",     x: 39, y: 71, type: "A", desc: "保持安静。闸机记录每一次进出。书架之间，比看上去的要深。" },
  { id: "field",     name: "操场",       x: 24, y: 26, type: "B", desc: "跑步能让人忘掉一些事情。看台下面的空间，不属于跑道。" },
  { id: "community", name: "学生社区",   x: 46, y: 12, type: "A", desc: "预约才能进入。办公室、社区部、策创部、宣传部，还有一间咖啡屋。" },
  { id: "recycle",   name: "回收站",     x: 11, y: 18, type: "B", desc: "杂物在这里换成校园币。管理员收东西的时候，从不对视。" },
  { id: "gym",       name: "体育馆",     x: 28, y: 9,  type: "A", desc: "付费入场。器械区有几根没人认领的杠铃杆。" },
  { id: "admin",     name: "行政楼",    x: 69, y: 53, type: "A", desc: "影像室与网络中心都在这栋楼里。走廊上的监控，比教室里的多。" },
  { id: "gate",      name: "学校大门",   x: 45, y: 84, type: "B", desc: "校门一直开着。但至今，没有人走出去过。" },
];

// 连接关系（1 AP；沿校园道路）
export const EDGES: Array<[string, string]> = [
  ["dorm", "canteen"], ["dorm", "community"], ["dorm", "library"], ["dorm", "field"], ["dorm", "recycle"],
  ["field", "gym"], ["field", "canteen"],
  ["recycle", "gym"], ["recycle", "community"],
  ["community", "canteen"], ["community", "tA"],
  ["canteen", "library"], ["canteen", "market"], ["canteen", "gate"], ["canteen", "tA"],
  ["market", "library"], ["market", "gate"], ["market", "clinic"],
  ["tA", "tB"], ["tB", "tC"], ["tA", "admin"], ["tA", "library"], ["tC", "admin"], ["tC", "clinic"],
  ["admin", "gate"], ["admin", "clinic"], ["admin", "library"],
  ["library", "gate"],
];

/** 两节点间沿道路的最短步数（0 = 同一节点；用于移动 AP：近端 1，远端 2） */
export function nodeDistance(from: string, to: string): number {
  if (from === to) return 0;
  const adj = new Map<string, string[]>();
  for (const [a, b] of EDGES) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        if (m === to) return d;
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return 99;
}
