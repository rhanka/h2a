import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCli } from "../dist/index.js";

const FIXTURE_TGZ = fileURLToPath(new URL("./fixtures/sentropic-h2a-0.98.0.tgz", import.meta.url));
const EXPECTED_SHA256 = "3de15d2ebce30ef5b27748ad06696844980c3c3d2ac5dfd4c6f5f7ff8c66d9a3";

async function load0980Cli() {
  const content = readFileSync(FIXTURE_TGZ);
  const actualHash = createHash("sha256").update(content).digest("hex");
  assert.equal(actualHash, EXPECTED_SHA256, "0.98.0 fixture SHA256 integrity check");
  const targetDir = fileURLToPath(new URL("../../../.qual-tmp/h2a-v0980", import.meta.url));
  mkdirSync(targetDir, { recursive: true });
  execFileSync("tar", ["-xzf", FIXTURE_TGZ, "-C", targetDir]);
  const entryPath = join(targetDir, "package", "dist", "index.js");
  const mod = await import(pathToFileURL(entryPath).href);
  process.on("exit", () => {
    try { rmSync(targetDir, { recursive: true, force: true }); } catch {}
  });
  return { runCli0980: mod.runCli, targetDir };
}

const { runCli0980, targetDir: targetDir0980 } = await load0980Cli();

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

test("0.98.0 binary destruction reproduced on evidenced fixture and prevented by candidate byte-for-byte writer", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-config-repro-"));
  try {
    const path0980 = join(dir, "host-0980.json");
    const pathCandidate = join(dir, "host-candidate.json");

    // Evidenced fixture from repro0980.mjs containing graphify-ts and standalone track-mcp
    const original = '{\r\n  "mcpServers" : {\r\n    "graphify-ts" : {\r\n      "command": "npx",\r\n      "args": ["graphify-ts"]\r\n    },\r\n    "track-mcp": {\r\n      "command": "track-mcp"\r\n    },\r\n    "h2a": {\r\n      "command": "old-h2a"\r\n    }\r\n  }\r\n}\r\n';

    // 1. Direct execution of the published 0.98.0 binary
    writeFileSync(path0980, original, { mode: 0o640 });
    let out0980 = "", err0980 = "";
    const code0980 = runCli0980(
      ["host", "setup", "--host", "claude", "--write", path0980],
      { stdout: { write(s) { out0980 += s; } }, stderr: { write(s) { err0980 += s; } }, cwd: () => dir },
      { doctorHostInstallations: () => ({ ok: true, hosts: [{ host: "claude", ok: true, unrepaired: [] }] }) }
    );
    assert.equal(code0980, 0);
    const written0980 = readFileSync(path0980, "utf8");
    const parsed0980 = JSON.parse(written0980);
    // 0.98.0 destroys standalone track-mcp entry silently
    assert.equal(parsed0980.mcpServers["track-mcp"], undefined, "0.98.0 binary deleted standalone track-mcp entry");
    // 0.98.0 reformats the entire file and destroys CRLF line endings
    assert.notEqual(written0980, original);
    assert.equal(written0980.includes("\r\n"), false, "0.98.0 stripped CRLF line endings");
    // 0.98.0 creates zero backups
    const backups0980 = readdirSync(dir).filter(name => name.startsWith("host-0980.json.backup-"));
    assert.equal(backups0980.length, 0, "0.98.0 created no backup");

    // 2. Direct execution of the published 0.98.0 binary on airbus-genair-d2d production fixture
    const pathAirbus0980 = join(dir, "host-airbus-0980.json");
    const airbusOriginal = '{\n  "mcpServers": {\n    "graphify-ts": {\n      "command": "npx.cmd",\n      "args": [\n        "--yes",\n        "@mohammednagy/graphify-ts@0.23.1",\n        "serve",\n        "--stdio",\n        "C:\\\\Users\\\\kwil73px\\\\Documents\\\\GitHub\\\\d2d\\\\graphify-out\\\\graph.json"\n      ],\n      "env": {\n        "GRAPHIFY_TOOL_PROFILE": "core"\n      }\n    }\n  }\n}\n';
    writeFileSync(pathAirbus0980, airbusOriginal, { mode: 0o600 });
    const codeAirbus0980 = runCli0980(
      ["host", "setup", "--host", "claude", "--write", pathAirbus0980],
      { stdout: { write() {} }, stderr: { write() {} }, cwd: () => dir },
      { doctorHostInstallations: () => ({ ok: true, hosts: [{ host: "claude", ok: true, unrepaired: [] }] }) }
    );
    assert.equal(codeAirbus0980, 0);
    const writtenAirbus0980 = readFileSync(pathAirbus0980, "utf8");
    const parsedAirbus0980 = JSON.parse(writtenAirbus0980);
    // Under 0.98.0 host setup, graphify-ts is NOT deleted (graphifyPreserved: true), but file is reformatted without backup
    assert.deepEqual(parsedAirbus0980.mcpServers["graphify-ts"], JSON.parse(airbusOriginal).mcpServers["graphify-ts"]);
    const backupsAirbus0980 = readdirSync(dir).filter(name => name.startsWith("host-airbus-0980.json.backup-"));
    assert.equal(backupsAirbus0980.length, 0, "0.98.0 created no backup on airbus fixture");

    // 3. Candidate behavior on the exact same evidenced fixture
    writeFileSync(pathCandidate, original, { mode: 0o640 });
    assert.equal(setup(pathCandidate).code, 0);
    const writtenCandidate = readFileSync(pathCandidate, "utf8");
    const parsedCandidate = JSON.parse(writtenCandidate);
    // Candidate preserves both foreign entries: graphify-ts AND track-mcp
    assert.deepEqual(parsedCandidate.mcpServers["graphify-ts"], { command: "npx", args: ["graphify-ts"] });
    assert.deepEqual(parsedCandidate.mcpServers["track-mcp"], { command: "track-mcp" });
    // Candidate preserves CRLF line endings and surrounding bytes
    assert.ok(writtenCandidate.includes("\r\n"));
    assert.ok(writtenCandidate.includes('"graphify-ts"'));
    assert.ok(writtenCandidate.includes('"track-mcp"'));
    assert.equal(statSync(pathCandidate).mode & 0o777, 0o640, "candidate preserves file mode");
    // Candidate creates an exact backup
    const backupsCandidate = readdirSync(dir).filter(name => name.startsWith("host-candidate.json.backup-"));
    assert.equal(backupsCandidate.length, 1, "candidate created exact backup");
    assert.equal(readFileSync(join(dir, backupsCandidate[0]), "utf8"), original);

    // 4. Candidate behavior on the actual airbus-genair-d2d production fixture
    const pathAirbusCandidate = join(dir, "host-airbus-candidate.json");
    writeFileSync(pathAirbusCandidate, airbusOriginal, { mode: 0o600 });
    assert.equal(setup(pathAirbusCandidate).code, 0);
    const writtenAirbusCandidate = readFileSync(pathAirbusCandidate, "utf8");
    const parsedAirbusCandidate = JSON.parse(writtenAirbusCandidate);
    assert.deepEqual(parsedAirbusCandidate.mcpServers["graphify-ts"], JSON.parse(airbusOriginal).mcpServers["graphify-ts"]);
    assert.ok(writtenAirbusCandidate.includes("@mohammednagy/graphify-ts@0.23.1"));
    const backupsAirbusCandidate = readdirSync(dir).filter(name => name.startsWith("host-airbus-candidate.json.backup-"));
    assert.equal(backupsAirbusCandidate.length, 1, "candidate created exact backup for airbus fixture");
    assert.equal(readFileSync(join(dir, backupsAirbusCandidate[0]), "utf8"), airbusOriginal);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (targetDir0980 && existsSync(targetDir0980)) {
      rmSync(targetDir0980, { recursive: true, force: true });
    }
  }
});

