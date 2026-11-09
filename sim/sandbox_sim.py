# -*- coding: utf-8 -*-
"""《校园规则怪谈：自管委》沙盘推演蒙特卡洛模拟
9 人局：6 干事 + 3 理事长；Day0  Grace（不投票不检举），Day1-3 投票，Day4 最终投票后结算。
"""
import random
from collections import Counter


def clamp(x, a, b):
    return max(a, min(b, x))


def simulate(cfg, rng):
    n_total = cfg.get('n_total', 9)
    n_chair = cfg.get('n_chair', 3)
    chair_idx = set(rng.sample(range(n_total), n_chair))
    st_idx = [i for i in range(n_total) if i not in chair_idx]
    abilities = {c: a for c, a in zip(sorted(chair_idx), rng.sample(
        ['spy', 'faker', 'judge', 'backstage'], n_chair))}

    hp = {i: 100.0 for i in range(9)}
    san = {i: 100.0 for i in range(9)}
    alive = set(range(9))
    pv_base = {i: cfg['pvs'][k] for k, i in enumerate(st_idx)}

    revealed = set()          # 被公开坐实的理事长
    elim = Counter()          # vote / accuse / state
    viol_by_day = Counter()
    shots = hits = dmg = swaps = 0
    used_backstage = used_faker = False
    faker_target = None

    # v1.4 互换制：换规造成次日"新规则混乱"（一次性违规率加成），
    # persistent 模式下理事长把诱捕规则留在板上形成持续漂移
    drift = 0.0
    confuse = {}              # day -> 次日混乱加成

    def violators_of(d, v_today):
        return [i for i in st_idx if i in alive and v_today.get(i, False)]

    for d in [0, 1, 2, 3, 4]:
        v_today = {}          # student -> 今日是否违规
        # ---------- 白天 ----------
        if d < 4:
            for i in st_idx:
                if i not in alive:
                    continue
                p = clamp(pv_base[i] + 0.05 * d + drift + confuse.get(d, 0.0)
                          + rng.gauss(0, 0.03), 0.02, 0.9)
                v = rng.random() < p
                v_today[i] = v
                if v:
                    san[i] -= 20
                    viol_by_day[d] += 1
                san[i] -= abs(rng.gauss(6, 5)) / cfg.get('loot_mult', 1.0)   # 事件精神磨损
                if rng.random() < 0.25:
                    hp[i] -= abs(rng.gauss(8, 5)) / cfg.get('loot_mult', 1.0)  # 事件身体磨损
                if rng.random() < 0.03:
                    hp[i] -= 10 / cfg.get('loot_mult', 1.0)   # 饥饿疏忽
            for i in list(alive):                         # 状态淘汰
                if hp[i] <= 0 or san[i] <= 0:
                    alive.discard(i)
                    elim['state'] += 1

            # ---------- 检举（Day1-3，弹药制） ----------
            if 1 <= d <= 3:
                nviol = viol_by_day[d]
                if not used_backstage and nviol > 0 and \
                        any(abilities[c] == 'backstage' for c in chair_idx if c in alive):
                    nviol -= 1
                    used_backstage = True
                chairs_alive = [c for c in chair_idx if c in alive]
                rng.shuffle(chairs_alive)
                pool = nviol  # 共享池；per_chair 模式下每人独立等量
                obs_p = 0.65 if cfg['monitoring'] == 'free' else 0.45
                for c in chairs_alive:
                    ammo = (nviol if cfg['ammo_mode'] == 'per_chair' else pool)
                    if abilities[c] == 'judge':
                        ammo += 1
                    fails = 0
                    while ammo > 0 and fails < 2:
                        cands = [i for i in st_idx if i in alive]
                        if not cands:
                            break
                        known = violators_of(d, v_today)
                        known = [i for i in known if rng.random() < obs_p]
                        if abilities[c] == 'spy' and rng.random() < 0.5:
                            known = violators_of(d, v_today)
                        if known:
                            weights = [1.0 / (hp[i] + 25) for i in known]
                            t = rng.choices(known, weights)[0]
                        else:
                            t = rng.choice(cands)
                        shots += 1
                        ammo -= 1
                        if cfg['ammo_mode'] == 'shared':
                            pool -= 1
                        if v_today.get(t, False):        # 命中（目标今日确实违规）
                            hits += 1
                            if rng.random() < 0.2:       # 担保/护身符免疫
                                continue
                            deal = cfg.get('dmg_base', 25) + cfg.get('dmg_step', 5) * d
                            hp[t] -= deal
                            dmg += deal
                            if hp[t] <= 0:
                                alive.discard(t)
                                elim['accuse'] += 1
                        else:
                            fails += 1

            # ---------- 规则更换（v1.4 互换制，Day1-3 检举结算后） ----------
            if cfg.get('swap') and 1 <= d <= 3 and \
                    any(c in alive for c in chair_idx):
                if rng.random() < cfg.get('swap_p', 0.7):
                    swaps += 1
                    confuse[d + 1] = cfg.get('swap_confuse', 0.12)
                    if cfg.get('swap_persistent'):
                        drift += cfg.get('swap_drift', 0.04)

        # ---------- 夜晚讨论 + 投票（Day1-4） ----------
        if d >= 1:
            # 信息流：档案/推理坐实一名理事长
            rp = cfg.get('reveal_p', 0.30)
            if rng.random() < (0.15 if d == 1 else rp):
                unrevealed = [c for c in chair_idx if c in alive and c not in revealed]
                if unrevealed:
                    revealed.add(rng.choice(unrevealed))
            # 伪证者：一次性带票
            if not used_faker and any(abilities[c] == 'faker' for c in chair_idx if c in alive) and d >= 2:
                used_faker = True
                cands = [i for i in st_idx if i in alive]
                if cands:
                    faker_target = rng.choice(cands)

            votes = Counter()
            rec = [c for c in chair_idx if c in alive and c in revealed]
            for i in list(alive):
                if i in chair_idx:
                    continue
                cands = list(alive - {i})
                if not cands:
                    continue
                if rec and rng.random() < 0.75:
                    votes[rng.choice(rec)] += 1.0
                elif faker_target in alive and faker_target != i and rng.random() < 0.5:
                    votes[faker_target] += 1.0
                else:
                    votes[rng.choice(cands)] += 1.0
            # 理事长归票协同：集火 HP 最低的学生
            cands = [i for i in st_idx if i in alive]
            if cands and any(c in alive for c in chair_idx):
                tgt = rng.choices(cands, [1.0 / (hp[i] + 25) for i in cands])[0]
                for c in chair_idx:
                    if c in alive:
                        votes[tgt] += 1.0
            if votes:
                top = votes.most_common()
                best = top[0][1]
                tied = [k for k, v in top if v == best]
                if len(tied) > 1 and rng.random() < 0.6:
                    pass                                     # 平票，平安夜
                else:
                    out = rng.choice(tied)
                    alive.discard(out)
                    elim['vote'] += 1
                    if out in chair_idx:
                        revealed.add(out)

        if not any(c in alive for c in chair_idx):
            return {'winner': 'student', 'day_end': d, 'elim': elim,
                    'shots': shots, 'hits': hits, 'dmg': dmg, 'swaps': swaps,
                    'viol': sum(viol_by_day.values()), 'revealed': len(revealed),
                    'st_alive': sum(1 for i in st_idx if i in alive),
                    'ch_alive': 0}

        # 深夜恢复（物资丰度放大恢复量）
        lm = cfg.get('loot_mult', 1.0)
        for i in st_idx:
            if i in alive:
                if hp[i] < 60:
                    hp[i] = min(100, hp[i] + 20 * lm)
                if san[i] < 40:
                    san[i] = min(100, san[i] + 10 * lm)

    ch_alive = sum(1 for c in chair_idx if c in alive)
    st_alive = sum(1 for i in st_idx if i in alive)
    winner = 'chair' if ch_alive >= st_alive else 'student'
    return {'winner': winner, 'day_end': 4, 'elim': elim,
            'shots': shots, 'hits': hits, 'dmg': dmg, 'swaps': swaps,
            'viol': sum(viol_by_day.values()), 'revealed': len(revealed),
            'st_alive': st_alive, 'ch_alive': ch_alive}


def run(cfg, n=20000):
    rng = random.Random(42)
    agg = Counter()
    win = Counter()
    for _ in range(n):
        r = simulate(cfg, rng)
        win[r['winner']] += 1
        agg['shots'] += r['shots']
        agg['hits'] += r['hits']
        agg['dmg'] += r['dmg']
        agg['viol'] += r['viol']
        agg['revealed'] += r['revealed']
        agg['st_alive'] += r['st_alive']
        agg['accuse'] += r['elim']['accuse']
        agg['vote'] += r['elim']['vote']
        agg['state'] += r['elim']['state']
        agg['swaps'] += r.get('swaps', 0)
    hit_rate = agg['hits'] / agg['shots'] if agg['shots'] else 0
    return {
        '干事胜率': win['student'] / n,
        '理事长胜率': win['chair'] / n,
        '场均换规次数': agg['swaps'] / n,
        '场均检举次数': agg['shots'] / n,
        '检举命中率': hit_rate,
        '场均检举伤害': agg['dmg'] / n,
        '场均检举淘汰': agg['accuse'] / n,
        '场均投票淘汰': agg['vote'] / n,
        '场均状态淘汰': agg['state'] / n,
        '场均违规总数': agg['viol'] / n,
        '场均坐实理事长数': agg['revealed'] / n,
        '结束时干事存活': agg['st_alive'] / n,
    }


CONFIGS = {
    'A 基准(共享弹药+无限监控)': {'ammo_mode': 'shared', 'monitoring': 'free',
                                  'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50]},
    'B 按人弹药(每人=违规数)': {'ammo_mode': 'per_chair', 'monitoring': 'free',
                                   'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50]},
    'C 共享弹药+监控受限': {'ammo_mode': 'shared', 'monitoring': 'limited',
                              'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50]},
    'D 基准+学生更守规矩': {'ammo_mode': 'shared', 'monitoring': 'free',
                              'pvs': [0.08, 0.10, 0.15, 0.20, 0.25, 0.30]},
    'E 最坏情况(按人弹药+监控受限)': {'ammo_mode': 'per_chair', 'monitoring': 'limited',
                                       'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50]},
    'F 共享弹药+坐实率0.45': {'ammo_mode': 'shared', 'monitoring': 'free',
                                'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50], 'reveal_p': 0.45},
    'G 共享弹药+伤害20+4d': {'ammo_mode': 'shared', 'monitoring': 'free',
                               'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                               'dmg_base': 20, 'dmg_step': 4},
    'H 双调节(坐实0.45+伤害20+4d)': {'ammo_mode': 'shared', 'monitoring': 'free',
                                       'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                                       'reveal_p': 0.45, 'dmg_base': 20, 'dmg_step': 4},
    # ---- v1.4 互换制 ----
    'I 基准+互换制(仅次日混乱)': {'ammo_mode': 'shared', 'monitoring': 'free',
                                    'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                                    'swap': True, 'swap_persistent': False},
    'J 基准+互换制(持续诱捕漂移)': {'ammo_mode': 'shared', 'monitoring': 'free',
                                      'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                                      'swap': True, 'swap_persistent': True},
    'K 互换制+监控受限': {'ammo_mode': 'shared', 'monitoring': 'limited',
                            'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                            'swap': True, 'swap_persistent': True},
    # ---- v1.4 互换制调参 ----
    'L 互换混乱降到0.08': {'ammo_mode': 'shared', 'monitoring': 'free',
                             'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                             'swap': True, 'swap_persistent': True,
                             'swap_confuse': 0.08},
    'M 互换+广播可分析(坐实+0.06)': {'ammo_mode': 'shared', 'monitoring': 'free',
                                       'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.50],
                                       'swap': True, 'swap_persistent': True,
                                       'reveal_p': 0.36},
    # ---- 10 人局：7 干事 + 3 理事长 ----
    'N 10人局(7:3)基准': {'ammo_mode': 'shared', 'monitoring': 'free',
                             'n_total': 10, 'n_chair': 3,
                             'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.40, 0.50]},
    'O 10人局(7:3)+互换持续漂移': {'ammo_mode': 'shared', 'monitoring': 'free',
                                      'n_total': 10, 'n_chair': 3,
                                      'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.40, 0.50],
                                      'swap': True, 'swap_persistent': True},
    'P 10人局(7:3)+互换+广播分析': {'ammo_mode': 'shared', 'monitoring': 'free',
                                       'n_total': 10, 'n_chair': 3,
                                       'pvs': [0.12, 0.12, 0.28, 0.28, 0.28, 0.40, 0.50],
                                       'swap': True, 'swap_persistent': True,
                                       'reveal_p': 0.36},
}

if __name__ == '__main__':
    for name, cfg in CONFIGS.items():
        r = run(cfg)
        print(name)
        for k, v in r.items():
            print('   ', k, f'{v:.3f}')
