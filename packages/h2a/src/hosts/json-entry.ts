/** Edit one JSON member without serializing any surrounding bytes. */
type Member = { key: string; start: number; end: number };
type ObjectSpan = { end: number; members: Member[] };

export function replaceJsonEntry(raw: string, path: readonly string[], value: unknown): string {
  JSON.parse(raw); // Validate the whole document before locating byte spans.
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(raw[cursor] ?? "") && cursor < raw.length) cursor++; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < raw.length) {
      const ch = raw[cursor++];
      if (ch === "\\") cursor++;
      else if (ch === '"') return JSON.parse(raw.slice(start, cursor)) as string;
    }
    throw new Error("unterminated JSON string");
  };
  const skip = (): void => {
    whitespace();
    if (raw[cursor] === '"') { string(); return; }
    if (raw[cursor] === "{" || raw[cursor] === "[") {
      const close = raw[cursor++] === "{" ? "}" : "]";
      while (cursor < raw.length && raw[cursor] !== close) {
        if (raw[cursor] === '"') string();
        else if (raw[cursor] === "{" || raw[cursor] === "[") skip();
        else cursor++;
      }
      cursor++;
      return;
    }
    while (cursor < raw.length && !/[\s,}\]]/.test(raw[cursor])) cursor++;
  };
  const object = (start: number): ObjectSpan => {
    cursor = start;
    whitespace();
    if (raw[cursor++] !== "{") throw new Error("host config path must be a JSON object");
    const members: Member[] = [];
    const keys = new Set<string>();
    for (;;) {
      whitespace();
      if (raw[cursor] === "}") return { end: cursor, members };
      const key = string();
      if (keys.has(key)) throw new Error(`duplicate JSON member ${key}; refusing an ambiguous edit`);
      keys.add(key);
      whitespace();
      cursor++; // colon; JSON.parse already validated it
      whitespace();
      const valueStart = cursor;
      skip();
      members.push({ key, start: valueStart, end: cursor });
      whitespace();
      if (raw[cursor] === ",") cursor++;
    }
  };
  const edit = (start: number, remaining: readonly string[]): string => {
    const span = object(start);
    const member = span.members.find((m) => m.key === remaining[0]);
    if (member) {
      if (remaining.length > 1) return edit(member.start, remaining.slice(1));
      return raw.slice(0, member.start) + JSON.stringify(value) + raw.slice(member.end);
    }
    const nested = remaining.slice(1).reduceRight<unknown>((v, key) => ({ [key]: v }), value);
    const entry = `${JSON.stringify(remaining[0])}:${JSON.stringify(nested)}`;
    const last = span.members.at(-1);
    const at = last?.end ?? span.end;
    return raw.slice(0, at) + (last ? "," : "") + entry + raw.slice(at);
  };
  if (!path.length) throw new Error("JSON entry path is required");
  return edit(0, path);
}
