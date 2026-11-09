interface Rule { id: string; name: string; text: string }

export function RuleBoard({ fixedRules, ruleBoard }: { fixedRules: Rule[]; ruleBoard: Rule[] }) {
  return (
    <div className="card rules">
      <h3>规则板（{fixedRules.length + ruleBoard.length} 条）</h3>
      <details>
        <summary>固定规矩（{fixedRules.length} 条，不可更换）</summary>
        <ul>{fixedRules.map((r) => <li key={r.id}><b>{r.id} {r.name}</b>　{r.text}</li>)}</ul>
      </details>
      <details open>
        <summary>随机规矩（{ruleBoard.length} 条，可被理事长更换）</summary>
        <ul>{ruleBoard.map((r) => <li key={r.id}><b>{r.id} {r.name}</b>　{r.text}</li>)}</ul>
      </details>
    </div>
  );
}
