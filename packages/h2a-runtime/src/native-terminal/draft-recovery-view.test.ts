import { describe, expect, it } from "vitest";
import xtermMod from "@xterm/headless";

import {
  DraftRecoveryView,
  draftExportBytes,
  inertDraftLines,
  type DraftRecoveryAction,
  type DraftRecoveryLabels,
  type DraftRecoveryRecord,
} from "./draft-recovery-view.js";
import type { PanelInputEvent } from "./panel-input.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

const LABELS: DraftRecoveryLabels = {
  title: "Draft kept — restitution to resume",
  submission: { pending: "pending", submitted: "submitted", uncertain: "uncertain", refused: "refused" },
  draft: {
    untouched: "untouched",
    "restoring-on-ready": "restoring-on-ready",
    restored: "restored",
    "saved-for-recovery": "saved-for-recovery",
  },
  message: "message",
  draftWord: "draft",
  bytes: "bytes",
  purged: "content purged after proven restitution",
  retainedKeystrokes: "keystrokes retained after import failure",
  actions: { export: "Export raw", replace: "Put the draft back", delete: "Delete the copy" },
  confirm: "Enter: confirm · Esc: cancel",
  hint: "Tab: action · Enter: run · Esc: close",
};

// CSI, OSC and HTML inside a draft: the D-A17 stimulus.
const HOSTILE =
  "first line  \r\n" +
  "\x1b[2J\x1b[H\x1b]0;pwned\x07\x1b]52;c;cHduZWQ=\x07" +
  "<script>alert(1)</script>\t<b>bold</b>\n" +
  "é vs é · 👩\u200d💻 · 漢字\n" +
  "\u202eevil\u202c\x7f\u009b31m\n" +
  "\n" +
  "last";

function record(overrides: Partial<DraftRecoveryRecord> = {}): DraftRecoveryRecord {
  return {
    sessionId: "h2a-api",
    applicationIncarnation: "app-3",
    requestId: "req-01",
    submission: "submitted",
    draft: "saved-for-recovery",
    byteLength: Buffer.byteLength(HOSTILE),
    content: Buffer.from(HOSTILE, "utf8"),
    ...overrides,
  };
}

function view(rec = record()): {
  view: DraftRecoveryView;
  actions: DraftRecoveryAction[];
  closed: number[];
} {
  const actions: DraftRecoveryAction[] = [];
  const closed: number[] = [];
  return {
    view: new DraftRecoveryView(rec, LABELS, {
      onAction: (action) => actions.push(action),
      onClose: () => closed.push(1),
    }),
    actions,
    closed,
  };
}

const key = (event: PanelInputEvent): PanelInputEvent => event;
const TAB = key({ type: "tab", shift: false });
const ENTER = key({ type: "enter" });
const ESCAPE = key({ type: "escape" });
const DOWN = key({ type: "nav", direction: "down" });
const UP = key({ type: "nav", direction: "up" });

describe("S1 draft recovery view (r4 §3.6, D-A17)", () => {
  it("should make every control, bidi and format character visible and inert", () => {
    const lines = inertDraftLines(Buffer.from(HOSTILE, "utf8"));
    expect(lines).toEqual([
      "first line  ␍",
      "␛[2J␛[H␛]0;pwned␇␛]52;c;cHduZWQ=␇<script>alert(1)</script>␉<b>bold</b>",
      "é vs é · 👩⟨U+200D⟩💻 · 漢字",
      "⟨U+202E⟩evil⟨U+202C⟩␡⟨9B⟩31m",
      "",
      "last",
    ]);
    for (const line of lines) {
      expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u);
    }
  });

  it("should keep invalid UTF-8 visible instead of dropping it", () => {
    expect(inertDraftLines(Uint8Array.from([0x61, 0xff, 0xfe, 0x62]))).toEqual(["a��b"]);
  });

  it("should export the saved bytes exactly, including CRLF, tabs and trailing spaces", () => {
    const rec = record();
    const exported = draftExportBytes(rec);
    expect(exported).toBeDefined();
    expect(Buffer.compare(exported!, Buffer.from(HOSTILE, "utf8"))).toBe(0);
    expect(exported!.byteLength).toBe(rec.byteLength);
    // The export is a copy: mutating it never alters the record.
    exported![0] = 0;
    expect(Buffer.compare(Buffer.from(rec.content!), Buffer.from(HOSTILE, "utf8"))).toBe(0);
    expect(draftExportBytes(record({ content: undefined }))).toBeUndefined();
  });

  it("should render the message state, the length and the complete text, scrollable", () => {
    const { view: v } = view();
    const width = 40;
    const first = v.render(width, 14);
    expect(first[0]).toContain("Draft kept");
    expect(first.join("\n")).toContain("h2a-api");
    expect(first.join("\n")).toContain("message: submitted");
    expect(first.join("\n")).toContain("draft: saved-for-recovery");
    expect(first.join("\n")).toContain(`${Buffer.byteLength(HOSTILE)} bytes`);
    expect(first.join("\n")).toContain("first line");
    // Scrolling reaches the last line of the draft; nothing is truncated away.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      for (const line of v.render(width, 14)) seen.add(line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
      v.handleKey(DOWN);
    }
    const all = [...seen].join("\n");
    expect(all).toContain("last");
    expect(all).toContain("</script>");
    for (let i = 0; i < 60; i += 1) v.handleKey(UP);
    expect(v.render(width, 14).join("\n")).toContain("first line");
  });

  it("should stay inert when painted into a terminal that would execute the draft", async () => {
    const { view: v } = view();
    const term = new XtermTerminal({ cols: 60, rows: 30, allowProposedApi: true });
    const responses: string[] = [];
    const titles: string[] = [];
    const clipboard: string[] = [];
    let bells = 0;
    term.onData((data) => responses.push(data));
    term.onTitleChange((title) => titles.push(title));
    term.onBell(() => {
      bells += 1;
    });
    term.parser.registerOscHandler(52, (payload) => {
      clipboard.push(payload);
      return true;
    });
    let painted = "";
    for (let page = 0; page < 6; page += 1) {
      painted += v.render(60, 24).join("\r\n") + "\r\n";
      for (let i = 0; i < 8; i += 1) v.handleKey(DOWN);
    }
    await new Promise<void>((resolve) => term.write(painted, resolve));
    expect(titles).toEqual([]);
    expect(clipboard).toEqual([]);
    expect(bells).toBe(0);
    expect(responses).toEqual([]);
    term.dispose();
  });

  it("should run the export directly and require a confirmation for replace and delete", () => {
    const { view: v, actions, closed } = view();
    v.render(40, 14);
    // Export is selected first and changes nothing at the host: no confirmation.
    expect(v.handleKey(ENTER)).toBe(true);
    expect(actions).toEqual(["export"]);

    v.handleKey(TAB);
    v.handleKey(ENTER);
    expect(actions).toEqual(["export"]);
    expect(v.render(40, 14).join("\n")).toContain("Enter: confirm");
    // Esc cancels the pending confirmation without closing the view.
    v.handleKey(ESCAPE);
    expect(actions).toEqual(["export"]);
    expect(closed).toEqual([]);
    v.handleKey(ENTER);
    v.handleKey(ENTER);
    expect(actions).toEqual(["export", "replace"]);

    v.handleKey(TAB);
    v.handleKey(ENTER);
    v.handleKey(ENTER);
    expect(actions).toEqual(["export", "replace", "delete"]);

    // Esc with nothing pending closes the view.
    v.handleKey(ESCAPE);
    expect(closed).toEqual([1]);
  });

  it("should report retained keystrokes after a failed import and a purged content", () => {
    const failed = view(record({ submission: "uncertain", retainedKeystrokes: 3 })).view;
    const text = failed.render(48, 16).join("\n");
    expect(text).toContain("message: uncertain");
    expect(text).toContain("3 keystrokes retained after import failure");

    const purged = view(record({ draft: "restored", content: undefined })).view;
    const purgedText = purged.render(48, 16).join("\n");
    expect(purgedText).toContain("content purged after proven restitution");
    expect(purgedText).not.toContain("first line");
    expect(purgedText).not.toContain("Put the draft back");
  });

  it("should accept a refreshed record and a status line without losing the scroll position", () => {
    const { view: v } = view();
    v.render(40, 14);
    for (let i = 0; i < 3; i += 1) v.handleKey(DOWN);
    v.setStatus("exported: /private/path");
    v.update(record({ submission: "submitted", draft: "restoring-on-ready" }));
    const text = v.render(40, 14).join("\n");
    expect(text).toContain("draft: restoring-on-ready");
    expect(text).toContain("exported: /private/path");
    expect(text).not.toContain("first line");
  });
});
