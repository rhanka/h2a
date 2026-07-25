import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function repoRoot() {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
function projectName(root = repoRoot()) {
  return path.basename(root);
}
function h2aBin(root) {
  const installed = process.env.FOCUS_H2A_BIN?.trim();
  if (installed) return installed;
  return path.join(root, "packages", "h2a", "dist", "bin.js");
}
const CLI_HOST_PREFIX = /^(claude|codex|gemini|agy|hermes|opencode):/;
function liveSessionsForProject(root, project) {
  const bin = h2aBin(root);
  if (!existsSync(bin)) return [];
  try {
    const out = execFileSync("node", [bin, "sessions"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
    return arr.filter((x) => x.state === "live").filter((x) => (x.instance ?? "").includes(`:${project}:`)).filter((x) => CLI_HOST_PREFIX.test(x.instance ?? "")).sort((a, b) => (b.heartbeatAt ?? "").localeCompare(a.heartbeatAt ?? "")).map((x) => x.instance);
  } catch {
    return [];
  }
}
function resolveLiveTarget(root, project) {
  const live = liveSessionsForProject(root, project);
  const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim();
  return emitter && live.includes(emitter) ? emitter : live[0];
}
function putEnvelope(root, target, envelope) {
  const out = execFileSync(
    "node",
    [h2aBin(root), "inbox", "put", "--instance", target, "--json", JSON.stringify(envelope)],
    { cwd: root, encoding: "utf8" }
  );
  try {
    return { recipientLive: Boolean(JSON.parse(out).recipientLive) };
  } catch {
    return { recipientLive: false };
  }
}

export { resolveLiveTarget as a, projectName as b, putEnvelope as p, repoRoot as r };
//# sourceMappingURL=h2a-bus.js-WrEfPDF2.js.map
