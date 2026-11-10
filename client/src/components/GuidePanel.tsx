/** 主持人引导面板：以校园广播与主持人的口吻，按天数与时段给出正式引导 */
export function GuidePanel({ day, phase, started }: { day: number; phase: string; started: boolean }) {
  let text: string;
  if (!started) {
    text = day === 0
      ? "【主持人】人齐后由房主开始。今天白天先熟悉校园：移动、探索、看规则板。今晚不检举、中午不投票，从明天起对局正式展开。"
      : "【主持人】等待房主开始本日行动。";
  } else if (phase === "morning") {
    text = day === 0
      ? "【校园广播】现在是上午。各位同学可自由探索校园，搜集物资、记住校规。中午全员到食堂集合。"
      : "【校园广播】现在是上午。八点起宿舍封闭，请勿逗留。中午 11:30 前，请自行前往食堂。";
  } else if (phase === "noon") {
    text = day === 0
      ? "【主持人】第一天午餐会只讨论不投票。说说昨晚的见闻——谁出现在不该出现的地方？"
      : "【主持人】午餐会开始。讨论今日疑点，然后投出一名你认定为理事长的人。弃权按违规处理。";
  } else if (phase === "afternoon") {
    text = "【校园广播】现在是下午。利用最后的行动值补给自己。晚间 21:00 宿舍熄灯前必须回到寝室。";
  } else if (phase === "evening") {
    text = "【校园广播】现在是晚上。请尽快返回宿舍，确认门牌，不要应答任何呼唤。";
  } else if (phase === "night") {
    text = "【校园广播】熄灯后请留在床位。理事长正在巡视——违规者将被通报。";
  } else {
    text = "【主持人】对局已结束。";
  }
  return (
    <div className="guide">
      <span>{text}</span>
    </div>
  );
}
