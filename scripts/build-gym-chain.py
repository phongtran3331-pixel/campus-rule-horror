# -*- coding: utf-8 -*-
"""体育馆追加杠铃杆获取链 Y148—Y152（追加到现有场景，不动原有事件）
链式嵌套：杠铃架 → 垫子 → 深度移开(AP-1,SAN-2) → 铁丝卡扣 → 静态答题得杠铃杆(关#2)
"""
import json, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, "output", "体育馆", "campus_text.json")

data = json.load(open(SCENE, encoding="utf-8"))
events = data["events"]
rooms = data.get("rooms", {})

ROOM = "器材室"
if ROOM not in rooms:
    print(f"校验失败：体育馆场景没有房间「{ROOM}」，现有：{list(rooms.keys())}")
    sys.exit(1)

def ev(eid, choice, result, room=None, children=None, need=None, needAny=None, consume=None, deny=None, taken=None):
    e = {"choice": choice, "result": result}
    if room: e["room"] = room
    if children: e["children"] = children
    if need: e["need"] = need
    if needAny: e["needAny"] = needAny
    if consume: e["consume"] = consume
    if deny: e["deny"] = deny
    if taken: e["result_taken"] = taken
    events[eid] = e  # 幂等：直接覆盖

ev("y148", "检查墙边的杠铃架", "杠铃架靠墙摆放，杠铃片整齐叠在一旁。一个卡位空着，架子底部的灰尘上有一道明显的拖动痕迹。拖痕没有延伸到门口，一直通向叠放的旧垫子。",
   ROOM, ["y149"])
ev("y149", "查看垫子底下", "你弯腰掀起最外层垫子，下面还有几层压得很实。最底下露出一块铁质盖板，边缘有半枚卡扣。盖板周围的灰被擦掉了两道，像有人刚检查过。",
   children=["y150"])
ev("y150", "移开垫子深入检查", "你把垫子逐一挪开，露出完整的铁质盖板。盖板比想象中沉，边缘缠着一圈细铁丝，你花了一些时间才看清卡扣旁的刻字：「两次之内，找出重球。」",
   children=["y150a", "y150b"])
ev("y150a", "继续检查（-1 AP）", "这不是普通器材室的维修标记。你记下了刻字的位置。{状态:精神值-2，行动值-1}",
   children=["y151"])
ev("y150b", "先把垫子放回去", "你把垫子挪回原位。灰尘上的拖痕还指向这里。")
ev("y151", "解开铁丝卡扣", "你沿着卡扣一点点拆开铁丝，金属摩擦声在器材室里格外清晰。卡扣松动了，盖板没有弹开，暗格里传出一声轻微的金属碰撞。盖板内侧贴着一张折叠题签。",
   children=["y152"])
ev("y152", "展开题签并作答",
   "你展开题签：「六个外观相同的球，其中一个偏重。只用天平，最少称几次能保证找出偏重的球？」{答题:六个外观相同的球，其中一个偏重。只用天平，最少称几次能保证找出偏重的球？|选项:1次,2次,3次,4次|规则:预设正确选项=第2项|答对:天平停在水平位置。暗格弹开，一根杠铃杆横放在里面。你伸手将它取出，杆身比普通器材更沉，握持处留着一圈深色痕迹。获得物品:杠铃杆(关#2)；状态:精神值+5|答错:题签上的字迹突然晕开，暗格里的金属声停了。你还没来得及再看一眼，题签化成了灰。状态:精神值-6，健康值-3}")

# ---------- 校验 ----------
wiki = json.load(open(os.path.join(ROOT, "client", "public", "wiki.json"), encoding="utf-8"))
errs = []
for eid, e in events.items():
    for c in (e.get("children") or []):
        if c not in events: errs.append(f"{eid} children 指向不存在的事件: {c}")
    for m in re.finditer(r"(?:获得物品?|\{获得):([^()（）]+)\((普|高|关|耗)#(\d+)\)\}?", e["result"]):
        name = m.group(1).strip()
        if name not in wiki: errs.append(f"{eid}: Wiki 缺物品「{name}」")
if "杠铃杆" not in wiki or wiki["杠铃杆"].get("seg") != "关":
    errs.append("Wiki 中杠铃杆不是关段物品")

if errs:
    print("校验失败：")
    for x in errs: print(" -", x)
    sys.exit(1)

with open(SCENE, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(f"OK 追加 y148—y152，体育馆事件总数 {len(events)}")
