// 校规数据：8 固定 + 12 随机池（详见 docs/校园规矩明细.md v1.4）
export interface Rule {
  id: string;      // F1..F8 / R1..R12
  name: string;
  text: string;    // 规则板显示文本
  kind: "fixed" | "random";
}

export const FIXED_RULES: Rule[] = [
  { id: "F1", name: "上午宿舍清空", kind: "fixed", text: "【8:00–11:00】上午，禁止出现在宿舍。" },
  { id: "F2", name: "禁止打扰教学", kind: "fixed", text: "特殊期间无需上课，禁止打扰老师的教学活动。" },
  { id: "F3", name: "教学楼禁食", kind: "fixed", text: "教学楼内禁止进食。" },
  { id: "F4", name: "教学区禁打闹", kind: "fixed", text: "教学楼与图书馆内禁止打闹。" },
  { id: "F5", name: "禁止夜不归宿", kind: "fixed", text: "21:00 前必须回到宿舍。行动值恰好归零时回到，也算合规。" },
  { id: "F6", name: "禁止进入不存在的教室", kind: "fixed", text: "教室编号为“楼层+序号”（如 301）。404 不存在。" },
  { id: "F7", name: "熄灯后不应答呼唤", kind: "fixed", text: "21:00 后听到有人叫你的名字，不要回应。" },
  { id: "F8", name: "禁止空票", kind: "fixed", text: "每天中午的投票必须投出一票。弃权视为违规。" },
];

export const RANDOM_POOL: Rule[] = [
  { id: "R1", name: "男女不得独处", kind: "random", text: "男女生不得单独相处。" },
  { id: "R2", name: "禁止尾随", kind: "random", text: "不要跟着别人。" },
  { id: "R3", name: "体育馆宵禁", kind: "random", text: "19:00 后体育馆关闭。" },
  { id: "R4", name: "图书馆午休", kind: "random", text: "图书馆 11:00–13:00 闭馆。" },
  { id: "R5", name: "宿舍禁食", kind: "random", text: "宿舍内禁止进食。" },
  { id: "R6", name: "校门封闭", kind: "random", text: "白天禁止在学校大门逗留。门卫在记名。" },
  { id: "R7", name: "行政楼准入", kind: "random", text: "生命值高于 80 者禁止进入行政楼。" },
  { id: "R8", name: "限时安静", kind: "random", text: "上午和下午公共频道发言各不得超过 8 条。" },
  { id: "R9", name: "红校服礼节", kind: "random", text: "见到红色校服的同学，点头致意即可，不要搭话。" },
  { id: "R10", name: "讨论禁止离场", kind: "random", text: "午间讨论期间不要离开食堂。" },
  { id: "R11", name: "精神自检", kind: "random", text: "SAN 低于 40 的同学每天必须用药或运动。" },
  { id: "R12", name: "门牌确认", kind: "random", text: "每天回到宿舍后，请确认门牌号。门牌号不会自己变。" },
];

/** 开局抽 5 条随机规则上板（v1.4：其余 7 条留备选池供理事长互换） */
export function drawRuleBoard(rand: () => number = Math.random): { board: Rule[]; pool: Rule[] } {
  const shuffled = [...RANDOM_POOL].sort(() => rand() - 0.5);
  return { board: shuffled.slice(0, 5), pool: shuffled.slice(5) };
}
