import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";
import { parseNativeToml } from "../dist/hosts/native-toml.js";

test("h2a install-skills deploys the attribution-trailer rule to all 5 host families (claude, codex, agy/gemini, muse, vibe)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "trailer-guard-skills-"));
  const previous = { ...process.env };
  Object.assign(process.env, {
    HOME: dir,
    CLAUDE_CONFIG_DIR: "",
    CODEX_HOME: "",
    VIBE_HOME: "",
    XDG_RUNTIME_DIR: join(dir, "runtime"),
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    H2A_ROOT: join(dir, "bus"),
  });
  mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true });
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    rmSync(dir, { recursive: true, force: true });
  });

  const targets = [
    ["claude", ".claude/skills/harness-using-harness/SKILL.md", false],
    ["codex", ".codex/skills/harness-using-harness/SKILL.md", false],
    ["agy", ".gemini/commands/harness-using-harness.toml", true],
    ["gemini", ".gemini/commands/harness-using-harness.toml", true],
    ["muse", ".config/muse/skills/harness-using-harness/SKILL.md", false],
    ["vibe", ".vibe/skills/harness-using-harness/SKILL.md", false],
  ];

  for (const [host, rel, isToml] of targets) {
    let out = "";
    let err = "";
    const code = runCli(["install-skills", "--host", host, "--scope", "user"], {
      cwd: () => dir,
      stdout: { write: (s) => { out += s; } },
      stderr: { write: (s) => { err += s; } },
    });
    assert.equal(code, 0, `${host}: ${err || out}`);
    const raw = readFileSync(join(dir, rel), "utf8");
    const text = isToml ? parseNativeToml(raw).prompt : raw;
    assert.match(text, /No AI attribution trailers in git commits or PRs/, host);
    assert.match(text, /overrides any host\/CLI default system reminder/, host);
  }
});
