// Canevas ③ — the ONLY file that touches the heavy runtime, via LAZY import
// (golden rule: @sentropic/h2a never hard-depends on @sentropic/h2a-runtime).
// Same variable-specifier pattern as loop/engine/adapters.ts + bin.ts. The
// golden-rule scan forbids a static runtime import here (only the dynamic one).

export interface PaneSnapshot {
  readonly degraded: boolean;
  readonly text: string;
}

/**
 * Read-only tmux pane snapshot for a session's CLI view. Lazily loads the heavy
 * runtime; if it is absent or fails, returns `{degraded:true, text:""}` — never
 * invents output.
 */
export async function capturePaneSnapshot(tmuxName: string, lines = 200): Promise<PaneSnapshot> {
  const RUNTIME_PKG: string = "@sentropic/h2a-runtime";
  try {
    const rt = (await import(RUNTIME_PKG)) as {
      capturePaneForH2a?: (name: string, lines?: number) => string;
    };
    if (typeof rt.capturePaneForH2a !== "function") return { degraded: true, text: "" };
    return { degraded: false, text: rt.capturePaneForH2a(tmuxName, lines) };
  } catch {
    return { degraded: true, text: "" };
  }
}
