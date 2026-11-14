#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校园怪谈全校园节点树自动生成程序
=================================

核心思想
--------
以场景节点 X 为起点，按五个离散等级参数，自动生成：
    场景层级（X -> P）  ->  事件入口（P -> Y）  ->  随机事件树（Y -> Y ... -> END）

五个离散等级变量
----------------
    N_P      场景子节点数
    mu_D     平均事件深度
    sigma_D  事件深度标准差（方差 = sigma_D^2）
    mu_B     子节点平均出度
    mu_R     事件平均初度

三个模块
--------
    模块 A  场景结构生成器      -> CampusTreeGenerator._gen_scenes
    模块 B  事件树生成器        -> CampusTreeGenerator._gen_entries / _grow
    模块 C  结构导出与校验器    -> validate / compute_stats / render_*

输出文件
--------
    campus_tree.txt     完整节点树（含 END）
    campus_params.txt   XYP 事件参数表
    campus_stats.txt    结构统计与校验结果
    campus_tree.json    机器可读全量导出

事件参数表格式
--------------
    X[NUM]：子节点个数
    P[NUM]：父节点，子节点个数
    Y[NUM]：{a=父节点,b=深度,c=K,d=出度}

    说明：
        a  父节点编号（P 或 Y），
        b  事件深度，入口 Y 为 1，子 Y 为父 Y 深度 + 1，
        c  参数 K（事件结算系数，深度基线 + 0~2 随机扰动），
        d  子 Y 节点个数，不包含 END。
    END 不进入参数表，不计为 Y 节点，也不计入父节点的 d。

用法示例
--------
    python 节点图.py                 # 默认：只生成体育馆（8 子节点，固定）
    python 节点图.py --list          # 列出全部 15 个场景预设
    python 节点图.py --all --seed 42 # 全量生成 15 棵树（含教学楼A/B/C），输出各自子目录 + ALL_SUMMARY.txt
    python 节点图.py --scene 图书馆 --seed 42
    python 节点图.py --custom --np 5 --depth 5 --var 1 --branch 2 --entry 2 --max-nodes 5000
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import statistics
import sys
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional, Tuple

sys.setrecursionlimit(20000)

__version__ = "1.0.0"


# ======================================================================
# 一、离散等级表
# ======================================================================

LEVELS: Dict[int, Dict[str, object]] = {
    1: {"name": "Ⅰ 简单",   "np": (1, 3),   "mu_d": 2.0, "sigma_d": 0.5, "mu_b": 1.2, "mu_r": 1.0},
    2: {"name": "Ⅱ 较低",   "np": (2, 5),   "mu_d": 3.0, "sigma_d": 1.0, "mu_b": 1.5, "mu_r": 2.0},
    3: {"name": "Ⅲ 普通",   "np": (3, 8),   "mu_d": 4.0, "sigma_d": 1.5, "mu_b": 1.8, "mu_r": 3.0},
    4: {"name": "Ⅳ 复杂",   "np": (5, 12),  "mu_d": 5.0, "sigma_d": 2.0, "mu_b": 2.2, "mu_r": 4.0},
    5: {"name": "Ⅴ 高复杂", "np": (8, 16),  "mu_d": 7.0, "sigma_d": 2.5, "mu_b": 2.5, "mu_r": 5.0},
}

# ======================================================================
# 一之二、全校园 14+1 场景预设表
# ======================================================================
# 固定功能性场景：fixed=True，子节点（P）固定为名称池全量，事件树简单
# 重点调试场景：fixed=False，子节点数按 N_P 等级随机抽取，事件树按等级生成
#   教学楼（多）= A/B/C 三座分别生成
#
# 用法：python 节点图.py            -> 只生成体育馆（兼容原默认）
#       python 节点图.py --all      -> 生成全部 15 棵树（含教学楼A/B/C）
#       python 节点图.py --scene 图书馆 --seed 42
#       python 节点图.py --list     -> 列出全部场景预设

@dataclass(frozen=True)
class ScenePreset:
    np_level: int
    depth_level: int
    var_level: int
    branch_level: int
    entry_level: int
    pool: Tuple[str, ...]          # P 节点（探索子位置）名称池
    fixed: bool = False            # True = 子节点数固定为 len(pool)
    note: str = ""

    def levels(self) -> Dict[str, int]:
        return {"np": self.np_level, "depth": self.depth_level, "var": self.var_level,
                "branch": self.branch_level, "entry": self.entry_level}


SCENE_PRESETS: "Dict[str, ScenePreset]" = {
    # ---------- 固定功能性用途（事件树简单，结构固定） ----------
    "学生社区": ScenePreset(2, 2, 1, 2, 2, ("前台", "办公室", "社区部", "策创部", "宣传部", "时光里的咖啡屋"), True, "预约制，功能集中于各房间"),
    "操场":     ScenePreset(2, 2, 1, 2, 2, ("跑道", "看台", "篮球架", "沙坑", "旗杆下", "器材室"), True),
    "宿舍":     ScenePreset(2, 2, 1, 2, 2, ("101寝室", "值班室", "公共水房", "洗衣房", "楼道杂物间", "天台"), True),
    "食堂":     ScenePreset(2, 2, 1, 2, 2, ("打饭窗口", "餐桌区", "后厨门口", "小卖部", "倒餐台", "角落卡座"), True),
    "回收站":   ScenePreset(2, 2, 1, 1, 2, ("废纸堆", "瓶罐区", "旧家具区", "电子废物箱", "管理员小屋"), True),
    "超市":     ScenePreset(2, 2, 1, 2, 2, ("售货机", "食品货架", "工具角", "冷柜", "收银台"), True),
    "校医院":   ScenePreset(2, 2, 1, 2, 2, ("药房", "输液室", "诊室", "处置室", "病历柜"), True),
    # ---------- 体育馆（原默认示例，8 子节点固定） ----------
    "体育馆":   ScenePreset(3, 3, 3, 3, 3, ("器械区", "羽毛球场", "篮球场", "乒乓球台", "看台", "更衣室", "器材室", "走廊"), True, "原默认场景"),
    # ---------- 重点调试：教学楼（多） ----------
    "教学楼A": ScenePreset(4, 3, 3, 3, 3, ("一楼大厅", "101教室", "102教室", "103教室", "201教室", "202教室", "阶梯教室", "实验室", "楼梯间", "天台", "洗手间", "走廊尽头", "教师办公室"), False, "怪谈密度高"),
    "教学楼B": ScenePreset(4, 3, 3, 3, 3, ("一楼大厅", "101教室", "102教室", "103教室", "201教室", "202教室", "阶梯教室", "实验室", "楼梯间", "天台", "洗手间", "走廊尽头", "教师办公室"), False, "怪谈密度高"),
    "教学楼C": ScenePreset(4, 3, 3, 3, 3, ("一楼大厅", "101教室", "102教室", "103教室", "201教室", "202教室", "阶梯教室", "实验室", "楼梯间", "天台", "洗手间", "走廊尽头", "教师办公室"), False, "怪谈密度高"),
    # ---------- 重点调试：图书馆（中） ----------
    "图书馆":   ScenePreset(3, 4, 2, 3, 3, ("门禁闸机", "文学区", "理科区", "报刊角", "自习区", "古籍室", "还书台", "书架深处"), False),
    # ---------- 重点调试：行政楼 / 学校大门 / 小树林（少） ----------
    "行政楼":   ScenePreset(2, 3, 2, 2, 2, ("一楼大厅", "影像室", "网络中心", "档案室", "教务处", "楼梯间"), False),
    "学校大门": ScenePreset(1, 2, 2, 1, 1, ("门楼", "保安室", "传达室", "公告栏", "人行道闸"), False),
    "小树林":   ScenePreset(2, 3, 3, 2, 2, ("石板路口", "凉亭", "歪脖子树", "深处空地", "长椅", "灌木丛"), False, "新增场景"),
}


# ======================================================================
# 二、参数与约束
# ======================================================================

@dataclass
class GenParams:
    """五个离散等级变量（分别设置，可组合出不同生成风格）。"""

    np_level: int = 3       # 场景子节点数 N_P
    depth_level: int = 3    # 平均事件深度 mu_D
    var_level: int = 3      # 事件深度方差 sigma_D^2（等级对应 sigma_D）
    branch_level: int = 3   # 子节点平均出度 mu_B
    entry_level: int = 3    # 事件平均初度 mu_R

    @property
    def np_range(self) -> Tuple[int, int]:
        return LEVELS[self.np_level]["np"]  # type: ignore[return-value]

    @property
    def mu_d(self) -> float:
        return float(LEVELS[self.depth_level]["mu_d"])  # type: ignore[arg-type]

    @property
    def sigma_d(self) -> float:
        return float(LEVELS[self.var_level]["sigma_d"])  # type: ignore[arg-type]

    @property
    def mu_b(self) -> float:
        return float(LEVELS[self.branch_level]["mu_b"])  # type: ignore[arg-type]

    @property
    def mu_r(self) -> float:
        return float(LEVELS[self.entry_level]["mu_r"])  # type: ignore[arg-type]

    def describe(self) -> Dict[str, object]:
        return {
            "N_P": {"level": self.np_level, "name": LEVELS[self.np_level]["name"], "range": list(self.np_range)},
            "mu_D": {"level": self.depth_level, "value": self.mu_d},
            "sigma_D^2": {"level": self.var_level, "sigma": self.sigma_d, "variance": self.sigma_d ** 2},
            "mu_B": {"level": self.branch_level, "value": self.mu_b},
            "mu_R": {"level": self.entry_level, "value": self.mu_r},
        }


@dataclass
class Constraints:
    """生成时的硬性约束，防止结构失控。"""

    min_depth: int = 1              # 最小事件深度
    max_depth: int = 12             # 最大事件深度
    max_branch: int = 6             # 最大事件出度
    max_scene_children: int = 20    # 最大场景子节点数
    max_entries: int = 8            # 单场景最大初始事件数
    max_nodes: int = 3000           # 最大事件节点总数（上限仅兜底，正常应自然生成完毕）
    continue_prob: float = 0.6      # 未达目标深度时的强制续接概率

    def validate(self) -> None:
        if self.min_depth < 1:
            raise ValueError("min_depth 必须 >= 1")
        if self.max_depth < self.min_depth:
            raise ValueError("max_depth 不能小于 min_depth")
        if self.max_branch < 1:
            raise ValueError("max_branch 必须 >= 1")
        if self.max_scene_children < 1:
            raise ValueError("max_scene_children 必须 >= 1")
        if self.max_entries < 1:
            raise ValueError("max_entries 必须 >= 1")
        if self.max_nodes < 1:
            raise ValueError("max_nodes 必须 >= 1")
        if not (0.0 <= self.continue_prob <= 1.0):
            raise ValueError("continue_prob 必须在 [0, 1] 区间")


# ======================================================================
# 三、节点数据结构
# ======================================================================

@dataclass
class XNode:
    num: int
    name: str = ""                                     # 场景名
    children: List[int] = field(default_factory=list)  # P 编号


@dataclass
class PNode:
    num: int
    parent: int                                        # 所属 X 编号
    name: str = ""                                     # 探索子位置名
    situation: str = ""                                # 进入时场景描述（由创作 AI 填写）
    children: List[int] = field(default_factory=list)  # 初始 Y 编号（= 第一层选项）


@dataclass
class YNode:
    """事件节点 = 一个选项：choice 为选项文本，result 为选中后的结果文本。
    子 Y（children）= 该结果之后出现的下一层选项；无子 Y 则事件链结束。"""
    num: int
    parent: int                                        # 父节点编号
    parent_kind: str                                   # "P" 或 "Y"
    depth: int
    K: int
    choice: str = ""                                   # 选项文本（创作 AI 填写）
    result: str = ""                                   # 结果文本（创作 AI 填写）
    children: List[int] = field(default_factory=list)  # 子 Y 编号（下一层选项）
    quiz: bool = False                                   # True = 深入探索答题节点（程序标记，创作 AI 出题）


# ======================================================================
# 四、生成器（模块 A + 模块 B）
# ======================================================================

class CampusTreeGenerator:
    """场景结构生成器 + 事件树生成器。"""

    def __init__(
        self,
        params: GenParams,
        cons: Constraints,
        root_x: int = 1,
        seed: Optional[int] = None,
        scene_name: str = "",
        pool: Tuple[str, ...] = (),
        fixed_children: bool = False,
    ) -> None:
        self.params = params
        self.cons = cons
        self.root_x = root_x
        self.seed = seed
        self.rng = random.Random(seed)
        self.scene_name = scene_name
        self.pool = list(pool)
        self.fixed_children = fixed_children

        self.xs: Dict[int, XNode] = {}
        self.ps: Dict[int, PNode] = {}
        self.ys: Dict[int, YNode] = {}

        self._x_seq = 0
        self._p_seq = 0
        self._y_seq = 0

    # ------------------------------------------------------------------
    # 编号分配（全局唯一、连续）
    # ------------------------------------------------------------------

    def _next_x(self) -> int:
        self._x_seq += 1
        return self._x_seq

    def _next_p(self) -> int:
        self._p_seq += 1
        return self._p_seq

    def _next_y(self) -> int:
        self._y_seq += 1
        return self._y_seq

    # ------------------------------------------------------------------
    # 采样工具
    # ------------------------------------------------------------------

    def _poisson(self, lam: float) -> int:
        """泊松采样（小 lambda 用 Knuth 算法，大 lambda 用正态近似）。"""
        if lam <= 0:
            return 0
        if lam > 25:
            return max(0, int(round(self.rng.gauss(lam, math.sqrt(lam)))))
        limit = math.exp(-lam)
        k = 0
        p = 1.0
        while True:
            k += 1
            p *= self.rng.random()
            if p <= limit:
                return k - 1

    def _sample_target_depth(self) -> int:
        """按 mu_D / sigma_D 抽取一条事件链的目标深度。"""
        raw = self.rng.gauss(self.params.mu_d, self.params.sigma_d)
        target = int(round(raw))
        return max(self.cons.min_depth, min(self.cons.max_depth, target))

    def _sample_entry_count(self) -> int:
        """按 mu_R 抽取一个场景的初始事件数量（初度）。"""
        n = self._poisson(self.params.mu_r)
        return max(1, min(n, self.cons.max_entries))

    def _calc_k(self, depth: int) -> int:
        """参数 K：事件结算系数（深度基线 + 0~2 随机扰动）。"""
        return max(1, depth + self.rng.randint(0, 2))

    # ------------------------------------------------------------------
    # 第一阶段：生成场景层级（X -> P）
    # ------------------------------------------------------------------

    def _gen_scenes(self) -> None:
        np_min, np_max = self.params.np_range
        for _ in range(self.root_x):
            x = XNode(self._next_x(), name=self.scene_name)
            self.xs[x.num] = x

            if self.fixed_children:
                n_p = len(self.pool)  # 固定功能性场景：子节点 = 名称池全量
            else:
                n_p = self.rng.randint(np_min, np_max)
            n_p = max(1, min(n_p, self.cons.max_scene_children))

            # 子位置命名：从名称池无放回抽取，不足时用编号补位
            if self.pool:
                k = min(n_p, len(self.pool))
                names = self.rng.sample(self.pool, k)
                names += [f"未命名区域{i + 1}" for i in range(n_p - k)]
            else:
                names = [f"子位置{i + 1}" for i in range(n_p)]

            for i in range(n_p):
                p = PNode(self._next_p(), x.num, name=names[i])
                self.ps[p.num] = p
                x.children.append(p.num)

    # ------------------------------------------------------------------
    # 第二阶段：为可探索场景生成事件入口（P -> Y）
    # ------------------------------------------------------------------

    def _gen_entries(self) -> None:
        """轮询制分配事件链：先保证每个 P 至少一条，再逐轮补第二、第三条……
        避免节点总数触顶时靠后的 P 一条事件都分不到。"""
        ps = list(self.ps.values())
        round_idx = 0
        while len(self.ys) < self.cons.max_nodes:
            progressed = False
            for p in ps:
                if len(self.ys) >= self.cons.max_nodes:
                    return
                if round_idx == 0 or len(p.children) < self._sample_entry_count():
                    self._new_chain(p)
                    progressed = True
            if not progressed:
                break
            round_idx += 1
        # 兜底：任何 P 都不允许没有事件
        for p in ps:
            if not p.children and len(self.ys) < self.cons.max_nodes:
                self._new_chain(p)

    def _new_chain(self, p: PNode) -> None:
        """为场景 P 生成一条初始事件链。"""
        target = self._sample_target_depth()
        entry = self._create_y(parent=p.num, parent_kind="P", depth=1)
        p.children.append(entry.num)
        self._grow(entry, target)

    def _create_y(self, parent: int, parent_kind: str, depth: int) -> YNode:
        num = self._next_y()
        y = YNode(num=num, parent=parent, parent_kind=parent_kind, depth=depth, K=self._calc_k(depth))
        self.ys[num] = y
        return y

    # ------------------------------------------------------------------
    # 第三阶段：递归生成事件树（Y -> Y ... -> END）
    # ------------------------------------------------------------------

    def _grow(self, y: YNode, target: int) -> None:
        """随机深度目标 + 递归分支生成。"""
        if len(self.ys) >= self.cons.max_nodes:
            return
        if y.depth >= target or y.depth >= self.cons.max_depth:
            return

        k = self._poisson(self.params.mu_b)
        k = min(k, self.cons.max_branch)

        # 最小深度约束：不允许过早终止
        if y.depth < self.cons.min_depth:
            k = max(k, 1)

        # 未达目标深度时，允许以 continue_prob 强制续接
        if k == 0 and self.rng.random() < self.cons.continue_prob:
            k = 1

        for _ in range(k):
            if len(self.ys) >= self.cons.max_nodes:
                break
            child = self._create_y(parent=y.num, parent_kind="Y", depth=y.depth + 1)
            y.children.append(child.num)
            self._grow(child, target)

    # ------------------------------------------------------------------
    # 总入口
    # ------------------------------------------------------------------

    def build(self) -> "CampusTreeGenerator":
        self._gen_scenes()
        self._gen_entries()
        self._mark_quiz()
        return self

    # ------------------------------------------------------------------
    # 深入探索答题节点标记
    # ------------------------------------------------------------------

    def _p_ancestor(self, y: YNode) -> Optional[int]:
        """沿父链回溯 Y 所属的 P 编号（回溯上限防环）。"""
        hops = 0
        while y.parent_kind == "Y" and hops < 100:
            y = self.ys[y.parent]
            hops += 1
        return y.parent if y.parent_kind == "P" else None

    def _mark_quiz(self) -> None:
        """标记答题节点：必须是叶 Y 且深度 >= 2；密度约每 10 个 Y 一个，
        全场景至多 3 个；尽量分散在不同 P 子位置下（先来先占深度大的）。"""
        n_target = min(3, len(self.ys) // 10)
        if n_target <= 0:
            return
        cands = sorted(
            (y for y in self.ys.values() if not y.children and y.depth >= 2),
            key=lambda y: -y.depth,
        )
        chosen: List[YNode] = []
        used_p: set = set()
        for y in cands:  # 第一轮：每个 P 下只选一个
            if len(chosen) >= n_target:
                break
            p = self._p_ancestor(y)
            if p in used_p:
                continue
            used_p.add(p)
            y.quiz = True
            chosen.append(y)
        for y in cands:  # 第二轮：P 不够时同 P 补选
            if len(chosen) >= n_target:
                break
            if not y.quiz:
                y.quiz = True
                chosen.append(y)


# ======================================================================
# 五、校验器（模块 C）
# ======================================================================

def validate(gen: CampusTreeGenerator) -> List[str]:
    """结构合法性校验，返回错误列表（空列表表示通过）。"""
    errors: List[str] = []

    # 编号连续性
    if sorted(gen.xs) != list(range(1, len(gen.xs) + 1)):
        errors.append("X 编号不连续")
    if sorted(gen.ps) != list(range(1, len(gen.ps) + 1)):
        errors.append("P 编号不连续")
    if sorted(gen.ys) != list(range(1, len(gen.ys) + 1)):
        errors.append("Y 编号不连续")

    # X -> P
    for x in gen.xs.values():
        for pid in x.children:
            p = gen.ps.get(pid)
            if p is None:
                errors.append(f"X{x.num} 引用了不存在的 P{pid}")
            elif p.parent != x.num:
                errors.append(f"P{pid} 的父节点应为 X{x.num}，实际为 X{p.parent}")

    # P -> Y（入口）
    for p in gen.ps.values():
        if p.parent not in gen.xs:
            errors.append(f"P{p.num} 的父节点 X{p.parent} 不存在")
        elif p.num not in gen.xs[p.parent].children:
            errors.append(f"P{p.num} 未登记在 X{p.parent} 的子节点列表中")
        if not p.children:
            errors.append(f"P{p.num}（{p.name}）没有任何事件入口——子位置缺少事件")
        for yid in p.children:
            y = gen.ys.get(yid)
            if y is None:
                errors.append(f"P{p.num} 引用了不存在的 Y{yid}")
            elif y.parent != p.num or y.parent_kind != "P":
                errors.append(f"Y{yid} 的父引用应为 P{p.num}")
            elif y.depth != 1:
                errors.append(f"入口 Y{yid} 的深度应为 1，实际为 {y.depth}")

    # Y -> Y
    for y in gen.ys.values():
        if y.parent_kind == "P":
            if y.parent not in gen.ps:
                errors.append(f"Y{y.num} 的父节点 P{y.parent} 不存在")
        elif y.parent_kind == "Y":
            parent = gen.ys.get(y.parent)
            if parent is None:
                errors.append(f"Y{y.num} 的父节点 Y{y.parent} 不存在")
            elif y.num not in parent.children:
                errors.append(f"Y{y.num} 未登记在 Y{y.parent} 的子节点列表中")
            elif y.depth != parent.depth + 1:
                errors.append(f"Y{y.num} 深度 {y.depth} 与父节点 Y{y.parent} 深度 {parent.depth} 不衔接")
        else:
            errors.append(f"Y{y.num} 的 parent_kind 非法：{y.parent_kind}")

        # d 与 children 一致性
        if len(y.children) > 0 and y.depth >= gen.cons.max_depth:
            errors.append(f"Y{y.num} 已达最大深度仍产生子节点")

        # 答题节点必须是叶节点
        if y.quiz and y.children:
            errors.append(f"Y{y.num} 是答题节点但还有子节点")

    # 双向引用一致性
    for y in gen.ys.values():
        for cid in y.children:
            child = gen.ys.get(cid)
            if child is None:
                errors.append(f"Y{y.num} 引用了不存在的子节点 Y{cid}")
            elif child.parent != y.num:
                errors.append(f"Y{cid} 的父引用应为 Y{y.num}，实际为 {child.parent_kind}{child.parent}")

    return errors


# ======================================================================
# 六、统计（模块 C）
# ======================================================================

@dataclass
class Stats:
    x_count: int
    p_count: int
    y_count: int
    end_count: int
    node_total: int
    max_depth: int
    avg_depth: float
    depth_variance: float
    depth_std: float
    avg_branch: float
    max_branch: int
    avg_entry: float
    entry_min: int
    entry_max: int


def compute_stats(gen: CampusTreeGenerator) -> Stats:
    ys = list(gen.ys.values())
    depths = [y.depth for y in ys]
    branches = [len(y.children) for y in ys]
    entries = [len(p.children) for p in gen.ps.values()]
    end_count = sum(1 for y in ys if not y.children)

    avg_depth = statistics.fmean(depths) if depths else 0.0
    depth_var = statistics.pvariance(depths) if len(depths) > 1 else 0.0
    depth_std = math.sqrt(depth_var)
    avg_branch = statistics.fmean(branches) if branches else 0.0
    avg_entry = statistics.fmean(entries) if entries else 0.0

    return Stats(
        x_count=len(gen.xs),
        p_count=len(gen.ps),
        y_count=len(gen.ys),
        end_count=end_count,
        node_total=len(gen.xs) + len(gen.ps) + len(gen.ys) + end_count,
        max_depth=max(depths) if depths else 0,
        avg_depth=avg_depth,
        depth_variance=depth_var,
        depth_std=depth_std,
        avg_branch=avg_branch,
        max_branch=max(branches) if branches else 0,
        avg_entry=avg_entry,
        entry_min=min(entries) if entries else 0,
        entry_max=max(entries) if entries else 0,
    )


# ======================================================================
# 七、导出器（模块 C）
# ======================================================================

def _children_of(gen: CampusTreeGenerator, kind: str, num: int) -> List[Tuple[str, int]]:
    if kind == "X":
        return [("P", n) for n in gen.xs[num].children]
    if kind == "P":
        return [("Y", n) for n in gen.ps[num].children]
    return [("Y", n) for n in gen.ys[num].children]


def _render_children(gen: CampusTreeGenerator, kind: str, num: int, prefix: str, lines: List[str]) -> None:
    children = _children_of(gen, kind, num)
    for idx, (ckind, cnum) in enumerate(children):
        last = idx == len(children) - 1
        connector = "└── " if last else "├── "
        label = f"{ckind}{cnum}"
        if ckind == "P":
            label += f" {gen.ps[cnum].name}"
        elif ckind == "Y" and gen.ys[cnum].quiz:
            label += " [答题]"
        lines.append(prefix + connector + label)
        child_prefix = prefix + ("    " if last else "│   ")
        if ckind == "Y" and not gen.ys[cnum].children:
            lines.append(child_prefix + "└── END")
        else:
            _render_children(gen, ckind, cnum, child_prefix, lines)


def render_tree(gen: CampusTreeGenerator) -> str:
    """渲染完整节点树 TXT（含 END）。"""
    lines: List[str] = []
    for idx, xnum in enumerate(sorted(gen.xs)):
        if idx > 0:
            lines.append("")
        x = gen.xs[xnum]
        lines.append(f"X{x.num} {x.name}".rstrip())
        _render_children(gen, "X", x.num, "", lines)
    return "\n".join(lines) + "\n"


def render_params(gen: CampusTreeGenerator) -> str:
    """渲染 XYP 事件参数表。"""
    lines: List[str] = []
    lines.append("# X：场景名，子节点个数")
    for x in (gen.xs[n] for n in sorted(gen.xs)):
        lines.append(f"X{x.num}：场景={x.name}，子节点个数={len(x.children)}")

    lines.append("")
    lines.append("# P：名称，父节点，子节点个数")
    for p in (gen.ps[n] for n in sorted(gen.ps)):
        lines.append(f"P{p.num}：名称={p.name}，父节点=X{p.parent}，子节点个数={len(p.children)}")

    lines.append("")
    lines.append("# Y：{a=父节点,b=深度,c=K,d=出度,q=是否答题节点}")
    for y in (gen.ys[n] for n in sorted(gen.ys)):
        a = f"{y.parent_kind}{y.parent}"
        q = 1 if y.quiz else 0
        lines.append(f"Y{y.num}：{{a={a},b={y.depth},c={y.K},d={len(y.children)},q={q}}}")

    return "\n".join(lines) + "\n"


def render_stats(gen: CampusTreeGenerator, stats: Stats, errors: List[str]) -> str:
    """渲染结构统计与校验结果。"""
    p = gen.params
    lines: List[str] = []
    lines.append(f"=== 场景：{gen.scene_name or '（未命名）'} ===")
    lines.append("")
    lines.append("=== 生成参数 ===")
    lines.append(f"场景子节点数 N_P     : 等级 {p.np_level}（{LEVELS[p.np_level]['name']}），范围 {p.np_range[0]}~{p.np_range[1]}")
    lines.append(f"平均事件深度 mu_D    : 等级 {p.depth_level}，取值 {p.mu_d:.2f}")
    lines.append(f"深度标准差 sigma_D   : 等级 {p.var_level}，取值 {p.sigma_d:.2f}（方差 {p.sigma_d ** 2:.2f}）")
    lines.append(f"子节点平均出度 mu_B  : 等级 {p.branch_level}，取值 {p.mu_b:.2f}")
    lines.append(f"事件平均初度 mu_R    : 等级 {p.entry_level}，取值 {p.mu_r:.2f}")
    lines.append(f"随机种子 seed        : {gen.seed}")

    lines.append("")
    lines.append("=== 结构统计 ===")
    lines.append(f"X 场景节点数         : {stats.x_count}")
    lines.append(f"P 场景节点数         : {stats.p_count}")
    lines.append(f"Y 事件节点数         : {stats.y_count}")
    lines.append(f"END 终止标记数       : {stats.end_count}")
    lines.append(f"答题节点数           : {sum(1 for y in gen.ys.values() if y.quiz)}")
    lines.append(f"节点总数（含 END）   : {stats.node_total}")
    lines.append("")
    lines.append(f"平均事件深度         : {stats.avg_depth:.3f}")
    lines.append(f"深度方差             : {stats.depth_variance:.3f}")
    lines.append(f"深度标准差           : {stats.depth_std:.3f}")
    lines.append(f"最大事件深度         : {stats.max_depth}")
    lines.append("")
    lines.append(f"平均事件出度         : {stats.avg_branch:.3f}")
    lines.append(f"最大事件出度         : {stats.max_branch}")
    lines.append(f"平均事件初度         : {stats.avg_entry:.3f}")
    lines.append(f"初度范围             : {stats.entry_min} ~ {stats.entry_max}")
    lines.append(f"是否触顶 max_nodes   : {'是（结构可能被截断）' if len(gen.ys) >= gen.cons.max_nodes else '否（自然生成完毕）'}")
    lines.append(f"无事件的 P 子位置     : {sum(1 for p in gen.ps.values() if not p.children)}")

    lines.append("")
    lines.append("=== 约束 ===")
    c = gen.cons
    lines.append(f"min_depth={c.min_depth}, max_depth={c.max_depth}, max_branch={c.max_branch}")
    lines.append(f"max_scene_children={c.max_scene_children}, max_entries={c.max_entries}, max_nodes={c.max_nodes}")
    lines.append(f"continue_prob={c.continue_prob}")

    lines.append("")
    lines.append("=== 校验 ===")
    if errors:
        lines.append(f"未通过，共 {len(errors)} 项问题：")
        for e in errors:
            lines.append(f"  - {e}")
    else:
        lines.append("通过：结构合法")

    return "\n".join(lines) + "\n"


def render_json(gen: CampusTreeGenerator, stats: Stats, errors: List[str]) -> str:
    """机器可读全量导出。"""
    data = {
        "version": __version__,
        "seed": gen.seed,
        "params": gen.params.describe(),
        "constraints": asdict(gen.cons),
        "scene": gen.scene_name,
        "x": [{"num": x.num, "name": x.name, "children": x.children} for x in (gen.xs[n] for n in sorted(gen.xs))],
        "p": [{"num": p.num, "name": p.name, "parent": p.parent, "situation": p.situation, "children": p.children} for p in (gen.ps[n] for n in sorted(gen.ps))],
        "y": [
            {
                "num": y.num,
                "a": f"{y.parent_kind}{y.parent}",
                "b": y.depth,
                "c": y.K,
                "d": len(y.children),
                "choice": y.choice,
                "result": y.result,
                "quiz": y.quiz,
                "children": y.children,
            }
            for y in (gen.ys[n] for n in sorted(gen.ys))
        ],
        "stats": asdict(stats),
        "validation": {"ok": not errors, "errors": errors},
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


# ======================================================================
# 八、命令行入口
# ======================================================================

def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="校园怪谈全校园节点树自动生成程序（14+1 场景版）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--scene", default="体育馆", help="场景名（--list 查看全部）；单独生成该场景")
    ap.add_argument("--all", action="store_true", help="生成全部 15 棵树（输出到各自子目录）")
    ap.add_argument("--list", action="store_true", help="列出全部场景预设后退出")
    ap.add_argument("--custom", action="store_true", help="忽略场景预设，使用下方 --np/--depth 等等级参数")
    ap.add_argument("--root-x", type=int, default=1, help="X 场景根节点数量")
    ap.add_argument("--np", type=int, choices=[1, 2, 3, 4, 5], default=3, help="场景子节点数 N_P 等级（仅 --custom）")
    ap.add_argument("--depth", type=int, choices=[1, 2, 3, 4, 5], default=3, help="平均事件深度 mu_D 等级（仅 --custom）")
    ap.add_argument("--var", type=int, choices=[1, 2, 3, 4, 5], default=3, help="事件深度方差 sigma_D^2 等级（仅 --custom）")
    ap.add_argument("--branch", type=int, choices=[1, 2, 3, 4, 5], default=3, help="子节点平均出度 mu_B 等级（仅 --custom）")
    ap.add_argument("--entry", type=int, choices=[1, 2, 3, 4, 5], default=3, help="事件平均初度 mu_R 等级（仅 --custom）")
    ap.add_argument("--seed", type=int, default=None, help="随机种子基值（每个场景 = 基值 + 场景序，便于复现）")
    ap.add_argument("--out-dir", default="output", help="输出根目录")

    ap.add_argument("--min-depth", type=int, default=1, help="最小事件深度")
    ap.add_argument("--max-depth", type=int, default=12, help="最大事件深度")
    ap.add_argument("--max-branch", type=int, default=6, help="最大事件出度")
    ap.add_argument("--max-scene-children", type=int, default=20, help="最大场景子节点数")
    ap.add_argument("--max-entries", type=int, default=8, help="单场景最大初始事件数")
    ap.add_argument("--max-nodes", type=int, default=2000, help="最大事件节点总数")
    ap.add_argument("--continue-prob", type=float, default=0.6, help="未达目标深度时的强制续接概率")
    return ap


def _write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _gen_one(scene: str, preset: ScenePreset, args: argparse.Namespace, seed: int, out_dir: str) -> Tuple[Stats, List[str]]:
    """按预设生成单场景并落盘，返回 (统计, 校验错误)。"""
    lv = preset.levels()
    params = GenParams(
        np_level=args.np if args.custom else lv["np"],
        depth_level=args.depth if args.custom else lv["depth"],
        var_level=args.var if args.custom else lv["var"],
        branch_level=args.branch if args.custom else lv["branch"],
        entry_level=args.entry if args.custom else lv["entry"],
    )
    cons = Constraints(
        min_depth=args.min_depth,
        max_depth=args.max_depth,
        max_branch=args.max_branch,
        max_scene_children=args.max_scene_children,
        max_entries=args.max_entries,
        max_nodes=args.max_nodes,
        continue_prob=args.continue_prob,
    )
    cons.validate()

    gen = CampusTreeGenerator(
        params, cons, root_x=args.root_x, seed=seed,
        scene_name=scene, pool=preset.pool, fixed_children=preset.fixed and not args.custom,
    ).build()
    errors = validate(gen)
    stats = compute_stats(gen)

    _write(os.path.join(out_dir, "campus_tree.txt"), render_tree(gen))
    _write(os.path.join(out_dir, "campus_params.txt"), render_params(gen))
    _write(os.path.join(out_dir, "campus_stats.txt"), render_stats(gen, stats, errors))
    _write(os.path.join(out_dir, "campus_tree.json"), render_json(gen, stats, errors))
    return stats, errors


def main(argv: Optional[List[str]] = None) -> int:
    ap = build_arg_parser()
    args = ap.parse_args(argv)

    if args.list:
        print("场景预设表（--scene <名称> 单独生成；--all 全量生成）")
        for i, (name, p) in enumerate(SCENE_PRESETS.items(), 1):
            lv = p.levels()
            kind = "固定" if p.fixed else "随机"
            print(f"  {i:>2}. {name:<4} N_P等级{lv['np']} 深度{lv['depth']} 方差{lv['var']} 出度{lv['branch']} 初度{lv['entry']} "
                  f"子节点{kind}{len(p.pool)}个 {p.note}")
        return 0

    if args.root_x < 1:
        ap.error("--root-x 必须 >= 1")

    base_seed = args.seed if args.seed is not None else random.randrange(1, 10 ** 9)

    # 生成清单：(场景名, 预设, 种子)
    if args.all:
        targets = [(name, p, base_seed + i) for i, (name, p) in enumerate(SCENE_PRESETS.items())]
    else:
        if args.scene not in SCENE_PRESETS:
            ap.error(f"未知场景「{args.scene}」，用 --list 查看可用场景")
        targets = [(args.scene, SCENE_PRESETS[args.scene], base_seed)]

    all_ok = True
    summary: List[str] = []
    for scene, preset, seed in targets:
        out_dir = os.path.join(args.out_dir, scene) if args.all else args.out_dir
        try:
            stats, errors = _gen_one(scene, preset, args, seed, out_dir)
        except ValueError as exc:
            ap.error(str(exc))
        all_ok = all_ok and not errors
        summary.append(
            f"{scene:<4} seed={seed}  X={stats.x_count} P={stats.p_count} Y={stats.y_count} END={stats.end_count} "
            f"总节点={stats.node_total} 均深={stats.avg_depth:.2f} 均出度={stats.avg_branch:.2f} 均初度={stats.avg_entry:.2f} "
            f"{'通过' if not errors else f'失败({len(errors)})'}"
        )
        print(f"[校园怪谈] {scene}  seed={seed}  P={stats.p_count}  Y={stats.y_count}  "
              f"{'校验通过' if not errors else f'校验失败 {len(errors)} 项'}")
        print(f"  输出目录：{os.path.abspath(out_dir)}")

    if args.all:
        _write(os.path.join(args.out_dir, "ALL_SUMMARY.txt"),
               f"种子基值 base_seed={base_seed}\n\n" + "\n".join(summary) + "\n")
        print(f"\n[汇总] 共 {len(targets)} 个场景，详见 {os.path.abspath(os.path.join(args.out_dir, 'ALL_SUMMARY.txt'))}")

    return 0 if all_ok else 2


if __name__ == "__main__":
    sys.exit(main())