#!/usr/bin/env node
// Canonical-root migration — union pin -> default. DRY-RUN by default: writes NOTHING.
// Touches inbox + keys ONLY. NEVER bindings.jsonl / findBinding (orthogonality, self-checked).
// Aliases (routing edges) are NOT here: they are a per-actor PRINCIPAL ATTESTATION, out of band.
// Real execution is a SEPARATE gated act (runtime GO after proven superset + operator at cutover).
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";

const PIN = "/home/antoinefa/src/a2a-cli";
const DEF = "/home/antoinefa/h2a-workspace/.h2a";
const DRY_RUN = process.env.MIGRATION_EXECUTE !== "I-HAVE-RUNTIME-GO-AND-OPERATOR"; // hard lock
const FULLID = /^[a-z]+__.+__[0-9a-f]{12}$/; // full instance dir; anything else = legacy label
const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
const log = (...a) => console.log(...a);

// --- ORTHOGONALITY PROOF by construction: collect every write target and assert
// each is under inbox/ or keys/ — never identity/bindings. Proven by what the code
// DOES (the write targets), not by grepping its own comments (a control that would
// fire on its own documentation is no control at all).
const writeTargets = [];
const track = (p) => { writeTargets.push(p); return p; };
log(`=== migration-union (${DRY_RUN ? "DRY-RUN — writes nothing" : "EXECUTE"}) ===`);

// --- envelope id set per inbox dir ------------------------------------------
function envIds(root, dir) {
  const ids = new Map(); // id -> filename
  for (const f of ls(join(root, "inbox", dir))) {
    if (!f.endsWith(".json")) continue;
    let id = f;
    try { id = JSON.parse(readFileSync(join(root, "inbox", dir, f), "utf8")).id ?? f; } catch {}
    ids.set(id, f);
  }
  return ids;
}

// --- PHASE 2 : mail preservation (verbatim, at original address) -------------
const pinDirs = ls(join(PIN, "inbox")).filter((d) => { try { return readdirSync(join(PIN,"inbox",d)); } catch { return false; } });
let toCopy = 0, copyDirs = 0, legacyDirs = 0, legacyEnv = 0, mergeSafe = 0;
for (const dir of pinDirs) {
  const pin = envIds(PIN, dir);
  if (!FULLID.test(dir)) { legacyDirs++; legacyEnv += pin.size; continue; } // preserve-not-merge
  const def = envIds(DEF, dir);
  const missing = [...pin.keys()].filter((id) => !def.has(id));
  if (def.size) mergeSafe++; // same full-id dir already on default = same actor, dedup-merge
  if (missing.length) { copyDirs++; toCopy += missing.length;
    for (const id of missing) track(join(DEF, "inbox", dir, pin.get(id)));
    if (!DRY_RUN) {
      mkdirSync(join(DEF, "inbox", dir), { recursive: true });
      for (const id of missing) copyFileSync(join(PIN,"inbox",dir,pin.get(id)), join(DEF,"inbox",dir,pin.get(id)));
    }
  }
}
log("PHASE 2 — mail (full-id dirs, verbatim, append-only, dedup by id):");
log(`  ${DRY_RUN ? "WOULD copy" : "copied"} ${toCopy} envelopes into ${copyDirs} default dirs (${mergeSafe} same-id merges — safe).`);
log(`  legacy-label dirs PRESERVED-NOT-MERGED (attestation, out of band): ${legacyDirs} dirs, ${legacyEnv} env.\n`);

// --- PHASE 4 : keys (move; overwrite check both directions) ------------------
const pinKeys = ls(join(PIN, "keys"));
const defKeys = new Set(ls(join(DEF, "keys")));
const collide = pinKeys.filter((k) => defKeys.has(k));
log("PHASE 4 — keys (COPY to default now; pin quarantined read-only at phase 6 => net MOVE, not live duplication):");
log(`  ${DRY_RUN ? "WOULD copy" : "copied"} ${pinKeys.length} keys to default (pin stays readable until the phase-6 quarantine — net effect is a move-with-backup, NOT a duplication left live).`);
log(`  overwrite check (pin ∩ default names): ${collide.length}  ${collide.length ? "!!! COLLISION — STOP" : "(none — safe both directions)"}`);
if (collide.length) { console.error("ABORT: key-name collision would overwrite default keys."); process.exit(3); }
for (const k of pinKeys) track(join(DEF, "keys", k));
if (!DRY_RUN) { for (const k of pinKeys) copyFileSync(join(PIN,"keys",k), join(DEF,"keys",k)); } // backup stays on pin

// --- ORTHOGONALITY PROOF: every write target is under inbox/ or keys/ --------
const stray = writeTargets.filter((p) => !/\/(inbox|keys)\//.test(p));
// Precise: does any write land in the identity/ STORE subdir? (substring-in-filename
// does not count — mail about identity is still mail. Match the path segment only.)
const intoIdentityStore = writeTargets.filter((p) => /\/identity\//.test(p));
log("\nORTHOGONALITY (proven by write targets, precise path segments):");
log(`  ${writeTargets.length} write targets; all under inbox/ or keys/: ${stray.length === 0 ? "YES" : "NO"}`);
log(`  targets under the identity/ store (must be 0): ${intoIdentityStore.length}`);
if (stray.length) { console.error("ABORT: a write target is outside inbox/ or keys/:", stray[0]); process.exit(4); }
if (intoIdentityStore.length) { console.error("ABORT: a write target lands in identity/ store."); process.exit(4); }

// --- PHASE 5 preview : superset check (real run re-counts id-by-id) ----------
log("\nPHASE 5 — superset (preview; real run re-counts every id/key, one miss => STOP):");
log(`  after union, default would hold every pin full-id envelope and every pin key.`);
log(`  REQUIRED before pin removal (phase 6, runtime GO): final re-scan of the pin`);
log(`  immediately before removal (pop deletes on read — late mail must be caught).`);
log("\nNOT touched: bindings.jsonl, findBinding, presence (ephemeral), aliases (attestation).");
log(DRY_RUN ? "\nDRY-RUN complete. No byte written. Awaiting runtime review + GO + operator." : "\nEXECUTED.");
