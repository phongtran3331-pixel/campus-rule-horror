// 物品目录：实体背包（40 格）的数据源
// src = "field:xxx"  读取玩家传统字段（food/medicine/.../keys）
// src = "items"      读取玩家 items 背包 Map（探索掉落的重要物品/物资）
export interface ItemDef {
  id: string;
  name: string;
  icon: string; // 临时占位，素材就位后替换为图片
  desc: string;
  src: string; // "field:food" | "field:key_office" | "items"
}

export const ITEM_CATALOG: ItemDef[] = [
  // ---------- 传统字段来源（机制物品） ----------
  { id: "food",        name: "补给食品",   icon: "🥫", desc: "能迅速果腹的东西。进食可恢复饥饿。", src: "field:food" },
  { id: "medicine",    name: "药物",       icon: "💊", desc: "校医院出品，白药片。恢复 HP 或 SAN。", src: "field:medicine" },
  { id: "scissors",    name: "剪刀",       icon: "✂️", desc: "锋利的剪刀。可以剪断网线与别的东西。", src: "field:scissors" },
  { id: "coffee",      name: "咖啡券",     icon: "☕", desc: "时光里的咖啡屋凭券入场。恢复 50 HP 或 30 SAN。", src: "field:coffee" },
  { id: "cards",       name: "查阅卡",     icon: "🪪", desc: "行政楼影像室凭卡调阅当日设施记录。", src: "field:cards" },
  { id: "junk",        name: "可回收杂物", icon: "🗑", desc: "看上去没用的东西。回收站按价收购。", src: "field:junk" },
  { id: "key_office",  name: "办公室钥匙", icon: "🗝", desc: "学生社区·办公室的钥匙。档案在这里。", src: "field:key_office" },
  { id: "key_dept",    name: "社区部钥匙", icon: "🗝", desc: "学生社区·社区部的钥匙。预约记录在这里。", src: "field:key_dept" },
  { id: "key_cce",     name: "策创部钥匙", icon: "🗝", desc: "学生社区·策创部的钥匙。可以抹除一条校规。", src: "field:key_cce" },
  { id: "key_press",   name: "宣传部钥匙", icon: "🗝", desc: "学生社区·宣传部的钥匙。校园墙在这里。", src: "field:key_press" },
  // ---------- 背包来源（探索可得的重要物品与物资） ----------
  { id: "snack",          name: "零食",       icon: "🍬", desc: "包装日期模糊的零食。吃了能垫垫肚子。", src: "items" },
  { id: "meal_ticket",    name: "明日饭票",   icon: "🎫", desc: "日期印着「明天」的饭票。明天的午饭有着落了。", src: "items" },
  { id: "first_aid",      name: "急救包",     icon: "🩹", desc: "绷带与碘伏。运动场上常备。", src: "items" },
  { id: "sedative",       name: "镇定剂",     icon: "🧪", desc: "标签空白的小药瓶。据说能让心静下来。", src: "items" },
  { id: "glucose",        name: "葡萄糖",     icon: "🥤", desc: "体育课后有人塞给你的。补充体力。", src: "items" },
  { id: "barbell",        name: "杠铃杆",     icon: "🏋", desc: "两端无片的杆。很重，挥起来更难。", src: "items" },
  { id: "amulet",         name: "护身符",     icon: "📿", desc: "黄纸折成的三角，红线缠边。捏着它，走廊没那么长。", src: "items" },
  { id: "rule_note",      name: "校规便签",   icon: "📄", desc: "纸上没有字，只有一行凸起的压痕。", src: "items" },
  { id: "note",           name: "牛皮笔记",   icon: "📓", desc: "前几页写满了，后面的纸页被撕掉了。", src: "items" },
  { id: "photo_old",      name: "旧照片",     icon: "🖼", desc: "合影里的人群看不清脸。其中一件校服你很眼熟。", src: "items" },
  { id: "name_tag",       name: "名牌",       icon: "🏷", desc: "别针名牌，名字栏是空白的。", src: "items" },
  { id: "blank_schedule", name: "空白课表",   icon: "📑", desc: "一张周三下午完全空白的课表。", src: "items" },
  { id: "sports_goods",   name: "体育物资",   icon: "⌚", desc: "护腕与秒表。回收站出高价收这个。", src: "items" },
  { id: "flashlight",     name: "手电",       icon: "🔦", desc: "电池仓有锈迹，光柱会抖。", src: "items" },
  { id: "batteries",      name: "电池",       icon: "🔋", desc: "两节，还是新的。", src: "items" },
  { id: "rope",           name: "尼龙绳",     icon: "🪢", desc: "十米长。别问为什么体育器材室会有这个。", src: "items" },
  { id: "tape",           name: "胶带",       icon: "🩹", desc: "能粘住纸，也能粘住别的。", src: "items" },
  { id: "whistle",        name: "哨子",       icon: "📯", desc: "体育老师的哨子。吹响它，所有人都听得见。", src: "items" },
  { id: "mirror",         name: "小镜子",     icon: "🪞", desc: "镜面有道裂纹。看走廊之前，先看看镜子。", src: "items" },
  { id: "chalk",          name: "粉笔",       icon: "🖍", desc: "一截白粉笔。可以在地上写字。", src: "items" },
  { id: "chess",          name: "象棋",       icon: "♟", desc: "缺了一枚帅。棋子背面刻着日期。", src: "items" },
  { id: "poker",          name: "扑克牌",     icon: "🃏", desc: "缺了大小王。牌面摸起来潮潮的。", src: "items" },
  { id: "novel",          name: "无名小说",   icon: "📕", desc: "图书馆藏书，借书卡上只有一个名字被反复填写。", src: "items" },
  { id: "walkman",        name: "随身听",     icon: "🎧", desc: "磁带转了一半卡住了。倒回去，是同一段倒带声。", src: "items" },
  { id: "rosary",         name: "念珠",       icon: "📿", desc: "不知道属于谁。数一遍是 33 颗，再数一遍不是。", src: "items" },
  { id: "umbrella",       name: "坏伞",       icon: "☂️", desc: "伞骨断了两根。晴天也带在身上吧。", src: "items" },
  { id: "textbook",       name: "旧课本",     icon: "📚", desc: "扉页名字被涂黑了，涂得很用力。", src: "items" },
  { id: "bottle",         name: "空瓶",       icon: "🍼", desc: "瓶底沉着一点白色的东西。", src: "items" },
  { id: "sticker",        name: "向日葵贴纸", icon: "🌻", desc: "自管委的徽章贴纸。花瓣的数目……你数过吗？", src: "items" },
  { id: "coin_old",       name: "旧校徽硬币", icon: "🪙", desc: "不是现在的校园币。钟楼图案比现在多一层。", src: "items" },
  { id: "letter",         name: "未寄出的信", icon: "✉️", desc: "信封没有署名，封口被反复拆开又粘上。", src: "items" },
];

// 探索时背包来源物品的掉落池（探索一次约 25% 概率额外获得一件）
export const TREASURE_POOL = [
  "snack", "first_aid", "glucose", "amulet", "rule_note", "note", "flashlight",
  "batteries", "mirror", "chalk", "chess", "poker", "novel", "umbrella",
  "textbook", "bottle", "sticker", "walkman", "sedative", "meal_ticket",
] as const;

export function rollTreasure(rand: () => number = Math.random): string {
  return TREASURE_POOL[Math.floor(rand() * TREASURE_POOL.length)];
}
