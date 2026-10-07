function Value({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object") {
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);
    if (entries.length === 0) return <span>{Array.isArray(value) ? "[]" : "{}"}</span>;
    return (
      <ul className="args-tree">
        {entries.map(([key, item]) => (
          <li key={key}>
            <span className="args-key">{key}: </span>
            <Value value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return <span>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span>;
}

/** Tool arguments as a readable key/value tree — nested values are never `[object Object]`. */
export function ArgsTree({ args }: { args: Record<string, unknown> }) {
  if (Object.keys(args).length === 0) return <div className="args-key">(sem argumentos)</div>;
  return <Value value={args} />;
}
