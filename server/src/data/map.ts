// 地图数据：14 节点 + 连接（详见手册 §5；坐标为 SVG 视图百分比，素材就位后由美术底图校准）
export interface MapNode {
  id: string;
  name: string;
  x: number; // 0-100
  y: number;
  type: "A" | "B"; // A 类有子位置，B 类开放空间
}

export const NODES: MapNode[] = [
  { id: "dorm",      name: "宿舍",       x: 12, y: 45, type: "B" },
  { id: "canteen",   name: "食堂",       x: 42, y: 48, type: "B" },
  { id: "clinic",    name: "校医院",     x: 25, y: 68, type: "B" },
  { id: "market",    name: "超市",       x: 45, y: 25, type: "B" },
  { id: "tA",        name: "教学楼A",    x: 72, y: 40, type: "A" },
  { id: "tB",        name: "教学楼B",    x: 86, y: 30, type: "A" },
  { id: "tC",        name: "教学楼C",    x: 86, y: 55, type: "A" },
  { id: "library",   name: "图书馆",     x: 60, y: 62, type: "A" },
  { id: "field",     name: "操场",       x: 55, y: 85, type: "B" },
  { id: "community", name: "学生社区",   x: 68, y: 12, type: "A" },
  { id: "recycle",   name: "回收站",     x: 25, y: 12, type: "B" },
  { id: "gym",       name: "体育馆",     x: 40, y: 8,  type: "A" },
  { id: "admin",     name: "行政楼",     x: 82, y: 78, type: "A" },
  { id: "gate",      name: "学校大门",   x: 55, y: 68, type: "B" },
];

// 连接关系（1 AP；与 manual §5 一致）
export const EDGES: Array<[string, string]> = [
  ["dorm", "canteen"], ["dorm", "gate"], ["dorm", "community"], ["dorm", "clinic"],
  ["clinic", "canteen"], ["canteen", "tA"], ["canteen", "market"], ["canteen", "field"], ["canteen", "community"],
  ["tA", "tB"], ["tB", "tC"], ["tA", "library"], ["library", "admin"], ["admin", "gate"],
  ["market", "recycle"], ["recycle", "gym"], ["field", "gym"],
];
