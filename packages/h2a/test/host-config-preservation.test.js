import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../dist/index.js";

const healthy = () => ({ ok: true, hosts: [{ host: "claude", ok: true, unrepaired: [] }] });
function setup(path, extra = []) {
  let stderr = "";
  const code = runCli(["host", "setup", "--host", "claude", "--write", path, ...extra], {
    stdout: { write() {} }, stderr: { write(text) { stderr += text; } }
  }, { doctorHostInstallations: healthy });
  return { code, stderr };
}

test("host setup preserves graphify-ts, Track and every byte outside the h2a value, with a backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-config-preserve-"));
  try {
    const path = join(dir, "host.json");
    const prefix = '{\r\n "theme" : "雪", "mcpServers" : { "graphify-ts" : { "command" : "npx", "args" : ["graphify-ts"] }, "track-mcp": {"command":"track-mcp"}, "h2a" : ';
    const suffix = ' , "immo" : { "command" : "immo" } }\r\n}\r\n';
    const original = prefix + '{"command":"old-h2a"}' + suffix;
    writeFileSync(path, original, { mode: 0o640 });
    assert.equal(setup(path).code, 0);
    const written = readFileSync(path, "utf8");
    assert.ok(written.startsWith(prefix));
    assert.ok(written.endsWith(suffix));
    assert.equal(JSON.parse(written).mcpServers["graphify-ts"].command, "npx");
    assert.equal(JSON.parse(written).mcpServers["track-mcp"].command, "track-mcp");
    assert.equal(statSync(path).mode & 0o777, 0o640, "existing mode is preserved");
    const backups = readdirSync(dir).filter(name => name.startsWith("host.json.backup-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dir, backups[0]), "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("host setup refuses a git-tracked config unless --allow-tracked is explicit", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-config-tracked-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const path = join(dir, ".mcp.json");
    const original = '{"mcpServers":{"graphify-ts":{"command":"npx"}}}\n';
    writeFileSync(path, original);
    execFileSync("git", ["-C", dir, "add", ".mcp.json"]);
    assert.equal(setup(path).code, 2);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.equal(setup(path, ["--allow-tracked"]).code, 0);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).mcpServers["graphify-ts"].command, "npx");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("host setup refuses malformed and ambiguous configs even with --force", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-config-invalid-"));
  try {
    for (const original of ['{broken', '{"mcpServers":{},"mcpServers":{"graphify-ts":{}}}']) {
      const path = join(dir, "host.json");
      writeFileSync(path, original);
      assert.equal(setup(path, ["--force"]).code, 2);
      assert.equal(readFileSync(path, "utf8"), original);
    }
    assert.equal(existsSync(join(dir, "host.json.backup")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("host setup refuses undecodable UTF-8 instead of changing foreign bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-config-encoding-"));
  try {
    const path = join(dir, "host.json");
    const original = Buffer.concat([Buffer.from('{"foreign":"'), Buffer.from([0xff]), Buffer.from('","mcpServers":{}}')]);
    writeFileSync(path, original);
    assert.equal(setup(path).code, 2);
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(readdirSync(dir), ["host.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
