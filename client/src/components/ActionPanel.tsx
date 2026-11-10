import type { Player } from "../../../server/src/schema/GameState";
import type { Faction } from "../lib/client";

interface Props {
  room: { send: (type: string, msg?: unknown) => void };
  me: Player | undefined;
  myFaction: Faction | null;
  phase: string;
  day: number;
  netDown: boolean;
  players: Array<[string, Player]>;
}

/** 节点动作面板：根据当前所在节点与时段给出可用操作（M3/M4 功能入口） */
export function ActionPanel({ room, me, myFaction, phase, day, netDown, players }: Props) {
  if (!me || !me.alive) return null;
  const send = (type: string, msg?: unknown) => room.send(type, msg);
  const at = me.nodeId;
  const busy = phase === "lobby" || phase === "ended";
  const Btn = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button className={danger ? "act danger" : "act"} disabled={busy} onClick={onClick}>{label}</button>
  );
  const askTarget = (title: string): string | null => {
    const list = players.filter(([id, p]) => p.alive && id !== undefined);
    const input = window.prompt(`${title}\n${list.map(([, p], i) => `${i + 1}. ${p.name}`).join("  ")}`, "1");
    const i = Number(input) - 1;
    return list[i] ? list[i][0] : null;
  };

  return (
    <div className="card actions">
      <h3>行动</h3>
      <div className="row wrap">
        <Btn label="探索（1 AP）" onClick={() => send("explore")} />
        {me.food > 0 && <Btn label={`进食（🍞${me.food}）`} onClick={() => send("eat", { nodeId: at })} />}
        {me.medicine > 0 && (
          <>
            <Btn label={`服药回HP（💊${me.medicine}）`} onClick={() => send("useMedicine", { kind: "hp" })} />
            <Btn label="服药回SAN" onClick={() => send("useMedicine", { kind: "san" })} />
          </>
        )}
        {at === "market" && <Btn label="买食物（5币）" onClick={() => send("buy", { item: "food" })} />}
        {at === "market" && <Btn label="买剪刀（15币）" onClick={() => send("buy", { item: "scissors" })} />}
        {at === "clinic" && <Btn label="买药（12币）" onClick={() => send("buyMedicine")} />}
        {at === "recycle" && me.junk > 0 && <Btn label={`卖杂物（🗑${me.junk}）`} onClick={() => send("recycle")} />}
        {at === "canteen" && phase === "noon" && <Btn label="午间套餐（3币）" onClick={() => send("meal")} />}
        {(at === "field" || at === "gym") && <Btn label="运动" onClick={() => send("exercise")} />}
        {at === "dorm" && <Btn label="确认门牌" onClick={() => send("doorplate")} />}

        {at === "community" && myFaction === "student" && (
          <>
            <Btn label="预约上午段" onClick={() => send("bookSlot", { slot: "am" })} />
            <Btn label="预约下午段" onClick={() => send("bookSlot", { slot: "pm" })} />
            <Btn label="办公室·档案" onClick={() => {
              const a = askTarget("档案：第一人编号");
              if (!a) return;
              const b = askTarget("档案：第二人编号");
              if (b) send("officeArchive", { aId: a, bId: b });
            }} />
            <Btn label="社区部·预约记录" onClick={() => send("deptBookings")} />
            <Btn label="策创部·抹除规则" onClick={() => {
              const ruleId = window.prompt("输入要抹除的规则编号（如 R3）");
              if (ruleId) send("cceErase", { ruleId: ruleId.trim().toUpperCase() });
            }} />
            <Btn label="宣传部·破译规则" onClick={() => send("press", { action: "decode" })} />
            <Btn label="宣传部·表彰" onClick={() => {
              const t = askTarget("表彰谁？");
              if (t) send("press", { action: "commend", targetId: t });
            }} />
            <Btn label="宣传部·匿名担保" onClick={() => {
              const t = askTarget("担保谁？");
              if (t) send("press", { action: "guarantee", targetId: t });
            }} />
            <Btn label="咖啡屋（☕1）" onClick={() => send("cafe", { kind: "hp" })} />
          </>
        )}

        {at === "admin" && (
          <>
            <Btn label="调监控" onClick={() => send("camera")} />
            <Btn label="调阅设施记录（🪪1）" onClick={() => {
              const f = window.prompt("设施名：超市售货机 / 校医院药房 / 图书馆闸机 / 操场闸机 / 体育馆闸机 / 社区闸机 / 行政楼影像室 / 网络中心");
              if (f) send("inspectLog", { facility: f.trim() });
            }} />
            {me.scissors > 0 && !netDown && <Btn label="剪网线" danger onClick={() => send("cutNet")} />}
            {netDown && <Btn label="修复网线（1 AP）" onClick={() => send("repairNet")} />}
          </>
        )}

        <Btn label="私聊/转账" onClick={() => {
          const t = askTarget("私聊谁？");
          if (!t) return;
          const text = window.prompt("内容（可空）") ?? "";
          const coins = Number(window.prompt("转账金额（可 0）") ?? 0);
          send("dm", { targetId: t, text, coins: Number.isFinite(coins) ? coins : 0 });
        }} />
        {phase === "noon" && day > 0 && (
          <Btn label="投票" onClick={() => {
            const t = askTarget("投票放逐谁？");
            if (t) send("vote", { targetId: t });
          }} />
        )}
        {phase === "night" && myFaction === "chair" && (
          <Btn label="检举" danger onClick={() => {
            const t = askTarget("检举谁？");
            if (t) send("accuse", { targetId: t });
          }} />
        )}
      </div>
    </div>
  );
}
