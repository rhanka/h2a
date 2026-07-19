import { describe, expect, it, vi } from "vitest";

const listLocalSessions = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessions };
});

const { launchLayout } = await import("./restore.js");

describe("launchLayout prefix collision", () => {
  it("skips the tab instead of emitting a bare-slug attach command", () => {
    listLocalSessions.mockReturnValue([
      {
        name: "h2a-proj",
        slug: "proj",
        profile: "claude",
        path: "/repo/proj",
        attached: false,
      },
      {
        name: "remote-proj",
        slug: "proj",
        profile: "claude",
        path: "/repo/proj",
        attached: false,
      },
    ]);
    const write = vi.fn(() => true);

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            {
              cwd: "/repo/proj",
              label: "proj",
              tool: "claude",
              sid: "conv-1",
            },
          ],
        },
      ],
      { write } as unknown as NodeJS.WriteStream,
      { reattach: true },
    );

    expect(result).toEqual({ opened: 0, skippedLive: ["proj"] });
    const output = write.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("h2a attach h2a-proj");
    expect(output).toContain("h2a attach remote-proj");
    expect(output).not.toContain("h2a attach 'proj'");
  });
});
