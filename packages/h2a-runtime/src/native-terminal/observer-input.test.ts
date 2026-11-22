import { describe, expect, it } from "vitest";

import {
  OBSERVER_INPUT_PENDING_TIMEOUT_MS,
  OBSERVER_REPORT_FAMILIES,
  ObserverInputClassifier,
} from "./observer-input.js";

const REPORT_SAMPLES: readonly string[] = [
  "\x1b[12;34R",
  "\x1b[?12;34R",
  "\x1b[?1;2c",
  "\x1b[>0;10;0c",
  "\x1bP!|434f4445\x1b\\",
  "\x1b[0n",
  "\x1b[?997;1n",
  "\x1b[2004;2$y",
  "\x1b[?2004;2$y",
  "\x1bP>|xterm(388)\x1b\\",
  "\x1bP0+r5465\x1b\\",
  "\x1bP1+r5465=31\x1b\\",
  "\x1bP0$r\x1b\\",
  "\x1bP1$r0m\x1b\\",
  "\x1b[?31u",
  "\x1b[4;480;640t",
  "\x1b[6;16;8t",
  "\x1b[8;40;120t",
  "\x1b[48;40;120;640;480t",
  "\x1b]lTitle\x1b\\",
  "\x1b]LIcon\x07",
  "\x1b]4;1;rgb:ff/00/00\x1b\\",
  "\x1b]10;rgb:ff/ff/ff\x07",
  "\x1b]11;rgb:00/00/00\x1b\\",
  "\x1b]12;rgb:00/ff/00\x07",
  "\x1b[I",
  "\x1b[O",
  "\x1b[<0;10;10M",
  "\x1b[<0;10;10m",
  "\x1b[32;10;10M",
  "\x1b[M !#",
];

describe("LH-05 observer input classifier", () => {
  it("LH-05 classifies every family in the closed report table as report", () => {
    expect(OBSERVER_REPORT_FAMILIES.length).toBe(10);
    const classifier = new ObserverInputClassifier();
    for (const sample of REPORT_SAMPLES) {
      const res = classifier.feed(Buffer.from(sample, "latin1"), 1_000);
      expect(res, sample).toEqual({ kind: "report" });
    }
  });

  it("LH-05 reassembles fragmented reports byte by byte without premature classification", () => {
    const classifier = new ObserverInputClassifier();
    for (const sample of REPORT_SAMPLES) {
      const buf = Buffer.from(sample, "latin1");
      for (let i = 0; i < buf.length - 1; i += 1) {
        const res = classifier.feed(buf.subarray(i, i + 1), 1_000 + i);
        expect(res.kind, `${sample} byte ${i}`).toBe("pending");
      }
      const last = classifier.feed(buf.subarray(buf.length - 1), 2_000);
      expect(last, `${sample} last byte`).toEqual({ kind: "report" });
    }
  });

  it("LH-05 classifies keystrokes, arrows, F5, kitty keys without question mark, and UTF-8 as keystroke", () => {
    const classifier = new ObserverInputClassifier();
    for (const key of [
      Buffer.from("x"),
      Buffer.from("\r"),
      Buffer.from([0x03]),
      Buffer.from("\x1b[A"),
      Buffer.from("\x1b[15~"),
      Buffer.from("\x1b[97;5u"),
      Buffer.from("€", "utf8"),
    ]) {
      expect(classifier.feed(key, 1_000).kind).toBe("keystroke");
    }
  });

  it("LH-05 holds bare ESC for 25ms, triggers keystroke on expiry, and accepts report before expiry", () => {
    const classifier = new ObserverInputClassifier();
    const pending = classifier.feed(Buffer.from([0x1b]), 1_000);
    expect(pending).toEqual({
      kind: "pending",
      deadlineMs: 1_000 + OBSERVER_INPUT_PENDING_TIMEOUT_MS,
    });
    expect(classifier.expirePending()).toEqual({ kind: "keystroke" });

    expect(classifier.feed(Buffer.from([0x1b]), 2_000).kind).toBe("pending");
    expect(classifier.feed(Buffer.from("[I"), 2_010)).toEqual({ kind: "report" });
    expect(classifier.expirePending()).toBeNull();
  });

  it("LH-05 holds unfinished ESC[, ESC], ESCP until 25ms expiry unless completed as a report", () => {
    for (const [prefix, suffix] of [
      ["\x1b[", "I"],
      ["\x1b]", "10;rgb:00/00/00\x07"],
      ["\x1bP", ">|term\x1b\\"],
    ] as const) {
      const classifier = new ObserverInputClassifier();
      const pending = classifier.feed(Buffer.from(prefix), 500);
      expect(pending).toEqual({ kind: "pending", deadlineMs: 525 });
      expect(classifier.expirePending()).toEqual({ kind: "keystroke" });

      expect(classifier.feed(Buffer.from(prefix), 600).kind).toBe("pending");
      expect(classifier.feed(Buffer.from(suffix), 610)).toEqual({ kind: "report" });
    }
  });

  it("LH-05 tracks bracketed paste start and end across blocks", () => {
    const classifier = new ObserverInputClassifier();
    expect(classifier.feed(Buffer.from("\x1b[200~hello"), 100)).toEqual({
      kind: "keystroke",
      pasteStarted: true,
    });
    expect(classifier.isInBracketedPaste()).toBe(true);
    expect(classifier.consumePasteDiscard(Buffer.from(" world"))).toBe(false);
    expect(classifier.isInBracketedPaste()).toBe(true);
    expect(classifier.consumePasteDiscard(Buffer.from("\x1b[201~"))).toBe(true);
    expect(classifier.isInBracketedPaste()).toBe(false);
  });

  it("LH-05 classifies mixed report plus keystroke in one block as keystroke", () => {
    const classifier = new ObserverInputClassifier();
    expect(classifier.feed(Buffer.from("\x1b[Ix"), 100).kind).toBe("keystroke");
  });

  it("LH-05 classifies oversized CSI (65B) and OSC (1025B) as keystroke", () => {
    const classifier = new ObserverInputClassifier();
    const longCsi = Buffer.from(`\x1b[${"1".repeat(63)}`);
    expect(longCsi.length).toBe(65);
    expect(classifier.feed(longCsi, 100).kind).toBe("keystroke");

    const longOsc = Buffer.from(`\x1b]10;${"a".repeat(1020)}`);
    expect(longOsc.length).toBe(1025);
    expect(classifier.feed(longOsc, 200).kind).toBe("keystroke");
  });

  it("LH-05 classifies ambiguous CSI 1;2R as report", () => {
    const classifier = new ObserverInputClassifier();
    expect(classifier.feed(Buffer.from("\x1b[1;2R"), 100)).toEqual({ kind: "report" });
  });
});
