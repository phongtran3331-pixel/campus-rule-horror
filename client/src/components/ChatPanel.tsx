import { useState } from "react";

export interface Msg { kind: string; from?: string; text: string }

export function ChatPanel({ msgs, onSend }: { msgs: Msg[]; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="card chat">
      <h3>频道（公共占位）</h3>
      <div className="chat-log">
        {msgs.map((m, i) => (
          <div key={i} className={m.kind}>
            {m.kind === "chat" ? <><b>{m.from}：</b>{m.text}</> : <i>{m.text}</i>}
          </div>
        ))}
      </div>
      <div className="row">
        <input
          value={text}
          placeholder="说点什么…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onSend(text.trim()); setText(""); } }}
        />
        <button onClick={() => { if (text.trim()) { onSend(text.trim()); setText(""); } }}>发送</button>
      </div>
    </div>
  );
}
