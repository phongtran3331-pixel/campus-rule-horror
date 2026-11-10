// 校规数据：8 固定 + 12 随机池（详见 docs/校园规矩明细.md v1.4）
export interface Rule {
  id: string;      // F1..F8 / R1..R12
  name: string;
  text: string;    // 规则板显示文本
  kind: "fixed" | "random";
  detail?: string; // 宣传部破译后的详细说明（M4 校园墙功能）
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
  { id: "R1", name: "男女不得独处", kind: "random", text: "男女生不得单独相处。", detail: "R1 详解：同一房间内（含 A 类节点同一子房间）只剩一男一女两人即违规。第三人进入可解除；离开房间即解除。" },
  { id: "R2", name: "禁止尾随", kind: "random", text: "不要跟着别人。", detail: "R2 详解：你跟随他人从同一节点移动到同一节点，且抵达时该节点只剩你们两人，即算尾随。错开时间或结伴同行可避免。" },
  { id: "R3", name: "体育馆宵禁", kind: "random", text: "19:00 后体育馆关闭。", detail: "R3 详解：晚间时段进入体育馆即违规；晚间结束时仍在体育馆内同样违规。" },
  { id: "R4", name: "图书馆午休", kind: "random", text: "图书馆 11:00–13:00 闭馆。", detail: "R4 详解：午间时段进入图书馆即违规；午间结束时仍在馆内同样违规。" },
  { id: "R5", name: "宿舍禁食", kind: "random", text: "宿舍内禁止进食。", detail: "R5 详解：在宿舍节点执行进食动作即违规（食堂套餐与随身食物都算）。" },
  { id: "R6", name: "校门封闭", kind: "random", text: "白天禁止在学校大门逗留。门卫在记名。", detail: "R6 详解：上午或下午时段进入学校大门节点即违规，门卫会记名。" },
  { id: "R7", name: "行政楼准入", kind: "random", text: "生命值高于 80 者禁止进入行政楼。", detail: "R7 详解：进入行政楼时生命值高于 80 即违规。受伤后再去，或者干脆别去。" },
  { id: "R8", name: "限时安静", kind: "random", text: "上午和下午公共频道发言各不得超过 8 条。", detail: "R8 详解：上午与下午各自计数，公共频道发言超过 8 条即违规（第 9 条起算，每时段只通报一次）。" },
  { id: "R9", name: "红校服礼节", kind: "random", text: "见到红色校服的同学，点头致意即可，不要搭话。", detail: "R9 详解：与红色校服同学搭话即违规。点头致意不算搭话。" },
  { id: "R10", name: "讨论禁止离场", kind: "random", text: "午间讨论期间不要离开食堂。", detail: "R10 详解：午间讨论期间从食堂节点离开即违规。投票前请留在原地。" },
  { id: "R11", name: "精神自检", kind: "random", text: "SAN 低于 40 的同学每天必须用药或运动。", detail: "R11 详解：每日晚间结束时 SAN 低于 40 且当天没有运动或用药记录，即违规。" },
  { id: "R12", name: "门牌确认", kind: "random", text: "每天回到宿舍后，请确认门牌号。门牌号不会自己变。", detail: "R12 详解：每日晚间结束时人在宿舍且当天没有执行确认门牌，即违规。门牌号不会自己变——但幻觉会。" },
];

/** 开局抽 5 条随机规则上板（v1.4：其余 7 条留备选池供理事长互换） */
export function drawRuleBoard(rand: () => number = Math.random): { board: Rule[]; pool: Rule[] } {
  const shuffled = [...RANDOM_POOL].sort(() => rand() - 0.5);
  return { board: shuffled.slice(0, 5), pool: shuffled.slice(5) };
}
