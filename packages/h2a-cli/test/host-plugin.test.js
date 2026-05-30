import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

function plugin(host, instance = "claude:p1") {
  let stdout = "";
  let stderr = "";
  const rc = runCli(["host", "plugin", "--host", host, "--instance", instance], {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) }
  });
  return { rc, stdout, stderr };
}

test("host plugin renders a push-capable stop hook for claude/codex/gemini", () => {
  for (const host of ["claude", "codex", "gemini"]) {
    const { rc, stdout } = plugin(host);
    assert.equal(rc, 0, `${host} should render`);
    const r = JSON.parse(stdout);
    assert.equal(r.host, host);
    assert.equal(r.push, true, `${host} can be push-notified`);
    assert.match(r.poll, /h2a drumbeat scan/); // poll is a manual fallback on push hosts too
    // The hook records a stop with the launch context D3 needs.
    assert.match(r.record, /h2a drumbeat record --instance claude:p1 --status paused/);
    assert.match(r.record, /\$TMUX_PANE/);
    assert.ok(r.mechanism && r.hint);
  }
});

test("host plugin marks agy as poll-only (no daemon) with a poll command", () => {
  const { rc, stdout } = plugin("agy");
  assert.equal(rc, 0);
  const r = JSON.parse(stdout);
  assert.equal(r.host, "agy");
  assert.equal(r.push, false);
  assert.match(r.poll, /h2a drumbeat scan/);
  assert.equal(r.mechanism, "agy-plugin-poll");
});

test("host plugin --write claude merges an idempotent Stop hook into settings.json (DEC-102)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  const settings = join(dir, "settings.json");
  try {
    // Pre-existing settings with an unrelated hook → must be preserved.
    writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] } }), "utf8");
    const run = (extra = []) => {
      let stdout = "", stderr = "";
      const rc = runCli(["host", "plugin", "--host", "claude", "--instance", "claude:p1", "--write", settings, ...extra], {
        stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
      });
      return { rc, stdout, stderr };
    };
    const r1 = run();
    assert.equal(r1.rc, 0, r1.stderr);
    assert.equal(JSON.parse(r1.stdout).written, settings);
    let cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.equal(cfg.model, "opus"); // unrelated keys preserved
    assert.equal(cfg.hooks.Stop.length, 2); // unrelated hook + ours
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance claude:p1/);
    // Idempotent: a second write does not duplicate our hook.
    assert.equal(run().rc, 0);
    cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.equal(cfg.hooks.Stop.filter((e) => e.hooks[0].command.includes("h2a drumbeat record")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin --write gemini merges the Claude-format Stop hook into settings.json (DEC-103)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  const settings = join(dir, "settings.json");
  try {
    writeFileSync(settings, JSON.stringify({ security: { auth: {} } }), "utf8");
    let stdout = "", stderr = "";
    const rc = runCli(["host", "plugin", "--host", "gemini", "--instance", "gemini:p1", "--write", settings], {
      stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
    });
    assert.equal(rc, 0, stderr);
    assert.equal(JSON.parse(stdout).host, "gemini");
    const cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.ok(cfg.security); // unrelated keys preserved
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance gemini:p1/);
    assert.match(ours.hooks[0].command, /gemini -r/); // gemini's resume command
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin --write codex writes a valid Claude-format hooks.json + pluginHint (DEC-104)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  const hooksJson = join(dir, "hooks.json");
  try {
    let stdout = "", stderr = "";
    const rc = runCli(["host", "plugin", "--host", "codex", "--instance", "codex:p1", "--write", hooksJson], {
      stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
    });
    assert.equal(rc, 0, stderr);
    const out = JSON.parse(stdout);
    assert.equal(out.host, "codex");
    assert.match(out.pluginHint, /plugin\.json/);
    // The written file is a valid codex hooks.json: { hooks: { Stop: [...] } }
    const cfg = JSON.parse(readFileSync(hooksJson, "utf8"));
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance codex:p1/);
    assert.match(ours.hooks[0].command, /codex resume/); // codex's resume command
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin --scaffold codex writes the full local marketplace + emits the trust step (DEC-113)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-codex-"));
  const marketplaceDir = join(root, "h2a-mkt");
  try {
    const run = () => {
      let stdout = "", stderr = "";
      const rc = runCli(["host", "plugin", "--host", "codex", "--instance", "codex:p1", "--scaffold", marketplaceDir], {
        stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
      });
      return { rc, stdout, stderr };
    };
    const r1 = run();
    assert.equal(r1.rc, 0, r1.stderr);
    const out = JSON.parse(r1.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.host, "codex");
    assert.equal(out.scaffolded, marketplaceDir);
    assert.equal(out.mechanism, "codex-app-server");

    // codex loads a plugin from a MARKETPLACE dir, not a bare plugin dir: the
    // marketplace manifest lists the plugin via a relative source path.
    const marketplacePath = join(marketplaceDir, ".agents", "plugins", "marketplace.json");
    assert.ok(existsSync(marketplacePath), "marketplace.json written");
    const mkt = JSON.parse(readFileSync(marketplacePath, "utf8"));
    assert.ok(mkt.name, "marketplace has a name"); // the @<marketplace> selector
    assert.equal(mkt.plugins.length, 1);
    assert.equal(mkt.plugins[0].source.source, "local");
    assert.match(mkt.plugins[0].source.path, /h2a-drumbeat$/);
    assert.equal(mkt.plugins[0].policy.authentication, "ON_INSTALL"); // NONE is rejected by codex
    assert.equal(out.marketplace, marketplacePath);

    // The plugin manifest references the hooks via a relative path.
    const pluginDir = join(marketplaceDir, "plugins", "h2a-drumbeat");
    const manifestPath = join(pluginDir, ".codex-plugin", "plugin.json");
    assert.ok(existsSync(manifestPath), "plugin manifest written");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.name, mkt.plugins[0].name);
    assert.match(manifest.hooks, /hooks\.json$/); // points at ./hooks/hooks.json
    assert.equal(out.manifest, manifestPath);

    // The hooks.json is the Claude-format Stop hook (same merge as --write codex).
    const hooksPath = join(pluginDir, "hooks", "hooks.json");
    assert.ok(existsSync(hooksPath), "hooks.json written");
    const cfg = JSON.parse(readFileSync(hooksPath, "utf8"));
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance codex:p1/);
    assert.match(ours.hooks[0].command, /codex resume/);
    assert.equal(out.hooks, hooksPath);

    // The trust step is surfaced (not a silent gap): the exact CLI commands.
    assert.ok(Array.isArray(out.trust) && out.trust.length >= 2, "trust commands emitted");
    assert.ok(out.trust.some((c) => c.includes("codex plugin marketplace add") && c.includes(marketplaceDir)));
    // The install selector uses a concrete <name>@<marketplace> (no placeholder).
    assert.ok(out.trust.some((c) => c.includes(`codex plugin add ${manifest.name}@${mkt.name}`)));

    // Idempotent: re-running produces a single h2a Stop hook + one plugin entry.
    const r2 = run();
    assert.equal(r2.rc, 0, r2.stderr);
    const cfg2 = JSON.parse(readFileSync(hooksPath, "utf8"));
    assert.equal(cfg2.hooks.Stop.filter((e) => e.hooks[0].command.includes("h2a drumbeat record")).length, 1);
    assert.equal(JSON.parse(readFileSync(marketplacePath, "utf8")).plugins.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host plugin --scaffold is refused for non-codex hosts (manifest is codex-specific)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-codex-"));
  try {
    for (const host of ["claude", "gemini", "agy"]) {
      let stderr = "";
      const rc = runCli(["host", "plugin", "--host", host, "--instance", `${host}:p1`, "--scaffold", join(root, host)], {
        stdout: { write: () => {} }, stderr: { write: (c) => void (stderr += c) }
      });
      assert.equal(rc, 1, `${host} should refuse --scaffold`);
      assert.match(stderr, /--scaffold/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host plugin --write is refused for agy only (poll-only, no daemon)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  try {
    let stderr = "";
    const rc = runCli(["host", "plugin", "--host", "agy", "--instance", "agy:p1", "--write", join(dir, "x.json")], {
      stdout: { write: () => {} }, stderr: { write: (c) => void (stderr += c) }
    });
    assert.equal(rc, 1);
    assert.match(stderr, /not available for agy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin rejects an unknown host and requires --instance", () => {
  assert.equal(plugin("borg").rc, 1);
  const noInstance = runCli(["host", "plugin", "--host", "claude"], {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  });
  assert.equal(noInstance, 1);
});
