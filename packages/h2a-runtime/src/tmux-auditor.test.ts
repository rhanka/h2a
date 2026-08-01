import { describe, expect, it } from "vitest";

import { listH2aStatusSurfaces } from "./tmux.js";

describe("fleet status-surface reader", () => {
  it("enumerates every marker in one FORMAT invocation", () => {
    let calls = 0;
    const records = listH2aStatusSurfaces((_command, args) => {
      calls += 1;
      expect(args).toEqual(["list-sessions", "-F", "#{session_name} #{@h2a_status_surface}"]);
      return {
        status: 0,
        stdout: "h2a-a v1\nh2a-b \n",
      };
    });

    expect(calls).toBe(1);
    expect(records).toEqual([
      { sessionName: "h2a-a", marker: "v1" },
      { sessionName: "h2a-b" },
    ]);
  });
});
