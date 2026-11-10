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
}

export const NODES: MapNode[] = [
  { id: "dorm",      name: "宿舍",       x: 13, y: 51, type: "B" },
  { id: "canteen",   name: "食堂",       x: 44, y: 37, type: "B" },
  { id: "clinic",    name: "校医院",     x: 94, y: 59, type: "B" },
  { id: "market",    name: "超市",       x: 68, y: 70, type: "B" },
  { id: "tA",        name: "教学楼A",    x: 66, y: 29, type: "A" },
  { id: "tB",        name: "教学楼B",    x: 77, y: 24, type: "A" },
  { id: "tC",        name: "教学楼C",    x: 81, y: 31, type: "A" },
  { id: "library",   name: "图书馆",     x: 39, y: 71, type: "A" },
  { id: "field",     name: "操场",       x: 24, y: 26, type: "B" },
  { id: "community", name: "学生社区",   x: 46, y: 12, type: "A" },
  { id: "recycle",   name: "回收站",     x: 11, y: 18, type: "B" },
  { id: "gym",       name: "体育馆",     x: 28, y: 9,  type: "A" },
  { id: "admin",     name: "行政楼",     x: 69, y: 53, type: "A" },
  { id: "gate",      name: "学校大门",   x: 45, y: 84, type: "B" },
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
