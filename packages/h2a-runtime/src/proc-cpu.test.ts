import { describe, expect, it } from "vitest";

import {
  busiestDescendant,
  parseProcStat,
  readProcessTreeCpuMs,
  readWorkerPid,
  sumTreeCpuMs,
  type ProcEntry,
} from "./proc-cpu.js";

/** Build a /proc/<pid>/stat line with the fields this module actually reads. */
function statLine(options: {
  pid: number;
  comm: string;
  ppid: number;
  utime: number;
  stime: number;
}): string {
  const after = [
    "S", // state
    String(options.ppid),
    "0", // pgrp
    "0", // session
    "0", // tty_nr
    "-1", // tpgid
    "0", // flags
    "0", // minflt
    "0", // cminflt
    "0", // majflt
    "0", // cmajflt
    String(options.utime),
    String(options.stime),
  ];
  return `${options.pid} (${options.comm}) ${after.join(" ")}\n`;
}

describe("parseProcStat", () => {
  it("reads ppid and CPU at 100Hz", () => {
    const parsed = parseProcStat(
      statLine({ pid: 42, comm: "node", ppid: 7, utime: 30, stime: 20 }),
    );
    expect(parsed).toEqual({ ppid: 7, cpuMs: 500 });
  });

  it("survives a comm containing spaces and parentheses", () => {
    // Splitting from the start shifts every field for "(my app)" — the classic
    // /proc parsing bug, and it would silently mis-read ppid AND cpu.
    const parsed = parseProcStat(
      statLine({ pid: 42, comm: "my app (x)", ppid: 9, utime: 10, stime: 0 }),
    );
    expect(parsed).toEqual({ ppid: 9, cpuMs: 100 });
  });

  it("returns undefined on garbage rather than a fake zero", () => {
    expect(parseProcStat("not a stat line")).toBeUndefined();
    expect(parseProcStat("")).toBeUndefined();
  });
});

describe("sumTreeCpuMs", () => {
  const entries: ProcEntry[] = [
    { pid: 100, ppid: 1, cpuMs: 10 }, // pane's shell
    { pid: 101, ppid: 100, cpuMs: 200 }, // the agent
    { pid: 102, ppid: 101, cpuMs: 5 }, // a tool it spawned
    { pid: 900, ppid: 1, cpuMs: 999 }, // unrelated
  ];

  it("totals the whole tree, because the agent may be a child of the pane shell", () => {
    expect(sumTreeCpuMs(100, entries)).toBe(215);
  });

  it("returns undefined for an unknown root, so 'cannot tell' is never 'idle'", () => {
    expect(sumTreeCpuMs(4242, entries)).toBeUndefined();
  });

  it("terminates on a cyclic snapshot", () => {
    const cyclic: ProcEntry[] = [
      { pid: 1, ppid: 2, cpuMs: 1 },
      { pid: 2, ppid: 1, cpuMs: 2 },
    ];
    expect(sumTreeCpuMs(1, cyclic)).toBe(3);
  });
});

describe("busiestDescendant", () => {
  it("names the child doing the work, not the idle wrapper", () => {
    // The MEASURED case: a launch reported pid 3392709 (node wrapper, 0s of CPU
    // after 37s) while its child codex 3392862 had burned 13s. A liveness check
    // on the reported pid calls a working agent dead.
    const entries: ProcEntry[] = [
      { pid: 3392709, ppid: 1, cpuMs: 0 }, // the wrapper the launch reports
      { pid: 3392862, ppid: 3392709, cpuMs: 13_000 }, // codex, actually working
      { pid: 999, ppid: 1, cpuMs: 99_000 }, // unrelated: must never win
    ];
    expect(busiestDescendant(3392709, entries)).toBe(3392862);
  });

  it("returns the root when it has no children", () => {
    expect(busiestDescendant(7, [{ pid: 7, ppid: 1, cpuMs: 5 }])).toBe(7);
  });

  it("returns undefined for an unknown root", () => {
    expect(
      busiestDescendant(42, [{ pid: 7, ppid: 1, cpuMs: 5 }]),
    ).toBeUndefined();
  });

  it("terminates on a cyclic snapshot", () => {
    expect(
      busiestDescendant(1, [
        { pid: 1, ppid: 2, cpuMs: 1 },
        { pid: 2, ppid: 1, cpuMs: 9 },
      ]),
    ).toBe(2);
  });
});

describe("readWorkerPid", () => {
  it("reads /proc once and names the busy child", () => {
    const result = readWorkerPid(100, {
      listPids: () => [100, 101],
      readStat: (pid) =>
        statLine({
          pid,
          comm: pid === 100 ? "node" : "codex",
          ppid: pid === 100 ? 1 : 100,
          utime: pid === 100 ? 0 : 1_300,
          stime: 0,
        }),
    });
    expect(result).toBe(101);
  });
});

describe("readProcessTreeCpuMs", () => {
  it("skips processes that exited between listing and reading", () => {
    const result = readProcessTreeCpuMs(100, {
      listPids: () => [100, 101, 777],
      readStat: (pid) =>
        pid === 777
          ? undefined // raced away
          : statLine({
              pid,
              comm: "node",
              ppid: pid === 100 ? 1 : 100,
              utime: 10,
              stime: 0,
            }),
    });
    expect(result).toBe(200);
  });
});
