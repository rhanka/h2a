import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionRegistry, agentVersion, listPresence, readInstalledSkillVersion } from "../dist/index.js";

// Slice #2: deployed-version visibility. The CLI self-upgrades but the skill does
// not — stamping {cli, skill} into presence at session open makes that drift
// visible in /h2a discover and h2a doctor without polling each host.

function homeWithSkill(host, content) {
  const home = mkdtempSync(join(tmpdir(), "h2a-home-"));
  const dir =
    host === "claude"
      ? join(home, ".claude", "skills", "h2a")
      : host === "codex"
        ? join(home, ".codex", "skills", "h2a")
        : join(home, ".gemini", "commands");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, host === "gemini" ? "h2a.toml" : "SKILL.md"), content, "utf8");
  return home;
}

test("readInstalledSkillVersion: reads the version stamp from the installed host skill", () => {
  const claudeHome = homeWithSkill("claude", "---\nname: h2a\nversion: 9.9.9\ndescription: x\n---\nbody");
  assert.equal(readInstalledSkillVersion("claude", claudeHome), "9.9.9");
  rmSync(claudeHome, { recursive: true, force: true });

  // gemini ships a TOML command file (`version = "x"`)
  const gemHome = homeWithSkill("gemini", 'name = "h2a"\nversion = "8.8.8"\n');
  assert.equal(readInstalledSkillVersion("gemini", gemHome), "8.8.8");
  rmSync(gemHome, { recursive: true, force: true });

  // best-effort: unknown host, missing file, and unstamped skill → undefined
  assert.equal(readInstalledSkillVersion("nope", "/tmp"), undefined);
  const empty = mkdtempSync(join(tmpdir(), "h2a-empty-"));
  assert.equal(readInstalledSkillVersion("claude", empty), undefined);
  const unstamped = homeWithSkill("claude", "---\nname: h2a\ndescription: x\n---\nbody");
  assert.equal(readInstalledSkillVersion("claude", unstamped), undefined);
  rmSync(empty, { recursive: true, force: true });
  rmSync(unstamped, { recursive: true, force: true });
});

test("agentVersion: stamps the running cli + the installed skill version", () => {
  const home = homeWithSkill("claude", "---\nname: h2a\nversion: 7.7.7\ndescription: x\n---\nb");
  const v = agentVersion("claude", home);
  assert.match(v.cli, /^\d+\.\d+\.\d+/, "cli version is a semver");
  assert.equal(v.skill, "7.7.7");
  // no host → cli only, no skill field
  assert.equal(agentVersion(undefined).skill, undefined);
  rmSync(home, { recursive: true, force: true });
});

test("session open stamps version into the presence record (so /h2a discover shows drift)", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-ver-")), ".h2a");
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    reg.open({
      instance: "claude:proj:abc123def456",
      host: "claude",
      version: { cli: "0.41.0", skill: "0.40.0" },
      interests: { scopes: ["scope:default"], negotiations: [] }
    });
    const rec = listPresence(root).find((r) => r.instance === "claude:proj:abc123def456");
    assert.ok(rec, "presence record present");
    assert.deepEqual(rec.version, { cli: "0.41.0", skill: "0.40.0" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
