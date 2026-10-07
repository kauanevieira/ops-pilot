import { useEffect, useState, type KeyboardEvent } from "react";

interface Props {
  disabled: boolean;
  inFlight: boolean;
  onSend: (text: string) => void;
}

export function Composer({ disabled, inFlight, onSend }: Props) {
  const [text, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!inFlight) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [inFlight]);

  function submit() {
    const trimmed = text.trim();
    if (disabled || trimmed === "") return;
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      {inFlight && (
        <div className="thinking" aria-live="polite">
          pensando… {elapsed}s
        </div>
      )}
      <div className="composer-inner">
        <textarea
          aria-label="Mensagem"
          placeholder="Pergunte ao OpsPilot…"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn-primary" disabled={disabled || text.trim() === ""} onClick={submit}>
          Enviar
        </button>
      </div>
    </div>
  );
}
