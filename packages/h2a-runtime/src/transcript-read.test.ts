import { appendFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCustomTitleCacheForTests,
  readFirstLine,
  readLastCustomTitle,
} from "./transcript-read.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "h2a-transcript-read-"));
  clearCustomTitleCacheForTests();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const titleLine = (title: string): string =>
  JSON.stringify({ type: "custom-title", customTitle: title, sessionId: "s" });

/** The former whole-file implementation: the oracle of the bounded scan. */
function referenceLastTitle(path: string): string | undefined {
  let title: string | undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"custom-title"')) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; customTitle?: unknown };
      if (obj.type === "custom-title" && typeof obj.customTitle === "string") title = obj.customTitle;
    } catch {
      /* keep the last good title */
    }
  }
  return title;
}

describe("readFirstLine: the cost follows the line, never the file", () => {
  it("should return the first line of a file without its newline", () => {
    expect(readFirstLine(file("a.jsonl", '{"cwd":"/x"}\n{"second":true}\n'))).toBe('{"cwd":"/x"}');
  });

  it("should return the whole content when the file has no newline", () => {
    expect(readFirstLine(file("b.jsonl", '{"only":1}'))).toBe('{"only":1}');
  });

  it("should return a first line longer than one read chunk, multi-byte characters intact", () => {
    const long = `{"text":"${"é".repeat(70_000)}"}`;
    expect(readFirstLine(file("c.jsonl", `${long}\nrest\n`))).toBe(long);
  });

  it("should return an empty first line and undefined for an absent file", () => {
    expect(readFirstLine(file("d.jsonl", "\nsecond\n"))).toBe("");
    expect(readFirstLine(join(dir, "absent.jsonl"))).toBeUndefined();
  });

  it("should return the first line of a file with megabytes behind it", () => {
    const head = '{"cwd":"/big"}';
    const path = file("e.jsonl", Buffer.concat([Buffer.from(`${head}\n`), Buffer.alloc(8 * 1024 * 1024, 0x20)]));
    expect(readFirstLine(path)).toBe(head);
  });
});

describe("readLastCustomTitle: the last valid title wins, read from the end", () => {
  it("should return the last title of several", () => {
    const path = file("t1.jsonl", [titleLine("first"), '{"type":"user"}', titleLine("second"), '{"type":"assistant"}', ""].join("\n"));
    expect(readLastCustomTitle(path)).toBe("second");
  });

  it("should return undefined when the transcript was never titled, is empty or is absent", () => {
    expect(readLastCustomTitle(file("t2.jsonl", '{"type":"user"}\n{"type":"assistant"}\n'))).toBeUndefined();
    expect(readLastCustomTitle(file("t3.jsonl", ""))).toBeUndefined();
    expect(readLastCustomTitle(join(dir, "absent.jsonl"))).toBeUndefined();
  });

  it("should skip a quoted mention and a malformed line that follow the real title", () => {
    const quoted = JSON.stringify({ type: "user", text: 'a tool printed {"type":"custom-title"} twice "custom-title"' });
    const path = file("t4.jsonl", [titleLine("real"), quoted, '{"type":"custom-title","customTitle":', ""].join("\n"));
    expect(readLastCustomTitle(path)).toBe("real");
  });

  it("should ignore a custom-title line whose title is not a string", () => {
    const path = file("t5.jsonl", [titleLine("kept"), '{"type":"custom-title","customTitle":42}', ""].join("\n"));
    expect(readLastCustomTitle(path)).toBe("kept");
  });

  it("should find a title that sits before megabytes of later output", () => {
    const filler = `${JSON.stringify({ type: "assistant", text: "x".repeat(4_000) })}\n`;
    const path = file("t6.jsonl", `${titleLine("early")}\n${filler.repeat(3_000)}`);
    expect(readLastCustomTitle(path)).toBe("early");
  });

  it("should find a title whose marker straddles a scan chunk boundary", () => {
    // The scan reads 4 MiB chunks from the end: place the marker across the
    // boundary of the last chunk for every offset of the marker.
    const chunk = 4 * 1024 * 1024;
    const line = `${titleLine("straddle")}\n`;
    const markerAt = line.indexOf('"custom-title"');
    for (const shift of [1, 7, 13]) {
      const tailLength = chunk - (line.length - markerAt) + shift;
      const path = file(`t7-${shift}.jsonl`, `${"h".repeat(100)}\n${line}${"t".repeat(tailLength - 1)}\n`);
      expect(readLastCustomTitle(path), `shift ${shift}`).toBe("straddle");
    }
  });

  it("should read a title on a line of several megabytes", () => {
    const big = JSON.stringify({ type: "custom-title", padding: "p".repeat(5 * 1024 * 1024), customTitle: "wide" });
    expect(readLastCustomTitle(file("t8.jsonl", `{"type":"user"}\n${big}\n{"type":"assistant"}\n`))).toBe("wide");
  });

  it("should answer like the former whole-file reader on generated transcripts", () => {
    let seed = 20_261_127;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let round = 0; round < 60; round += 1) {
      const lines: string[] = [];
      const count = Math.floor(random() * 40);
      for (let i = 0; i < count; i += 1) {
        const pick = random();
        if (pick < 0.15) lines.push(titleLine(`title-${round}-${i}`));
        else if (pick < 0.25) lines.push(JSON.stringify({ type: "user", text: 'says "custom-title" here' }));
        else if (pick < 0.3) lines.push('{"type":"custom-title","customTitle":"cut');
        else if (pick < 0.35) lines.push("");
        else lines.push(JSON.stringify({ type: "assistant", text: "é".repeat(Math.floor(random() * 300)) }));
      }
      const path = file(`g-${round}.jsonl`, lines.join("\n") + (random() < 0.5 ? "\n" : ""));
      expect(readLastCustomTitle(path), `round ${round}`).toBe(referenceLastTitle(path));
    }
  });

  it("should reuse the cached title while size and mtime hold, and re-read after a change", () => {
    const path = file("t9.jsonl", `${titleLine("one")}\n`);
    expect(readLastCustomTitle(path)).toBe("one");
    // Same size, same mtime, different bytes: the cached answer is served.
    const stamp = new Date(1_700_000_000_000);
    utimesSync(path, stamp, stamp);
    clearCustomTitleCacheForTests();
    expect(readLastCustomTitle(path)).toBe("one");
    writeFileSync(path, `${titleLine("two")}\n`);
    utimesSync(path, stamp, stamp);
    expect(readLastCustomTitle(path)).toBe("one");
    // A new mtime (or size) invalidates the entry.
    const later = new Date(1_700_000_100_000);
    utimesSync(path, later, later);
    expect(readLastCustomTitle(path)).toBe("two");
    writeFileSync(path, `${titleLine("three")}\n${titleLine("four")}\n`);
    expect(readLastCustomTitle(path)).toBe("four");
  });

  it("should search only the appended bytes of a transcript that grew, and keep the former title", () => {
    const filler = `${JSON.stringify({ type: "assistant", text: "x".repeat(2_000) })}\n`;
    const path = file("t10.jsonl", `${titleLine("kept")}\n${filler.repeat(50)}`);
    expect(readLastCustomTitle(path)).toBe("kept");
    // Plain output appended: the former title stands.
    appendFileSync(path, filler.repeat(20));
    expect(readLastCustomTitle(path)).toBe("kept");
    expect(readLastCustomTitle(path)).toBe(referenceLastTitle(path));
    // A rename appended: the new title wins.
    appendFileSync(path, `${titleLine("renamed")}\n${filler}`);
    expect(readLastCustomTitle(path)).toBe("renamed");
    expect(readLastCustomTitle(path)).toBe(referenceLastTitle(path));
  });

  it("should catch a title that was half-written at the previous read", () => {
    const full = titleLine("late");
    const cut = full.indexOf('"customTitle"') + 5;
    const path = file("t11.jsonl", `${titleLine("early")}\n{"type":"user"}\n${full.slice(0, cut)}`);
    // The open line is malformed for now: the earlier title answers.
    expect(readLastCustomTitle(path)).toBe("early");
    appendFileSync(path, `${full.slice(cut)}\n`);
    expect(readLastCustomTitle(path)).toBe("late");
  });

  it("should search the whole file again when it was rewritten rather than appended", () => {
    const path = file("t12.jsonl", `${titleLine("old")}\n{"type":"user","n":1}\n`);
    expect(readLastCustomTitle(path)).toBe("old");
    // Larger, but the former end no longer matches: nothing is assumed.
    writeFileSync(path, `{"type":"user","text":"${"y".repeat(200)}"}\n{"type":"assistant"}\n`);
    expect(readLastCustomTitle(path)).toBeUndefined();
    // Smaller file: same rule.
    writeFileSync(path, `${titleLine("z")}\n`);
    expect(readLastCustomTitle(path)).toBe("z");
  });

  it("should answer like the former reader across random appends", () => {
    let seed = 7_771;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const path = file("t13.jsonl", "");
    for (let step = 0; step < 200; step += 1) {
      const pick = random();
      const piece =
        pick < 0.1
          ? `${titleLine(`t-${step}`)}\n`
          : pick < 0.2
            ? titleLine(`open-${step}`).slice(0, 10 + Math.floor(random() * 30))
            : pick < 0.3
              ? "\n"
              : pick < 0.4
                ? `${JSON.stringify({ type: "user", text: 'quote "custom-title"' })}\n`
                : `${JSON.stringify({ type: "assistant", text: "é".repeat(Math.floor(random() * 200)) })}\n`;
      appendFileSync(path, piece);
      expect(readLastCustomTitle(path), `step ${step}`).toBe(referenceLastTitle(path));
    }
  });
});
