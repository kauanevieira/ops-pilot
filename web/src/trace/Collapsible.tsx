import { useState } from "react";

const MAX_CHARS = 600;
const MAX_LINES = 12;

/** FR-010: long content is folded by default and expandable. */
export function Collapsible({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const tooLong = text.length > MAX_CHARS || lines.length > MAX_LINES;
  if (!tooLong) return <div className="event-body">{text}</div>;

  const preview = `${lines.slice(0, MAX_LINES).join("\n").slice(0, MAX_CHARS)}…`;
  return (
    <>
      <div className="event-body">{open ? text : preview}</div>
      <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "mostrar menos" : "mostrar tudo"}
      </button>
    </>
  );
}
