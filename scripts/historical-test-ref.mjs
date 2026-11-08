import { spawnSync } from "node:child_process";

export const LEGACY_HOST_REF = "89bbd9af1033153b6654c272e126d91e0fa42683^";
export const IDENTITY_BASE_REF = "e3fc1a52eb8bc8e5794ced5e17e201e1bcfa99d2";
// MH L0 heritage snapshot (proc-identity leaf, runtime closure audit). The
// legacy v0.98.5 marker reader reads that same commit era through IDENTITY_BASE_REF.
export const L0_HERITAGE_REF = "0b9cf8862be689380c3bcb6e7cb35dc1e10b5cbf";

export function ensureHistoricalGitRef(repo, ref) {
  const present = () => spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: repo, stdio: "ignore" }).status === 0;
  if (present()) return;
  const sha = ref.endsWith("^") ? ref.slice(0, -1) : ref;
  // GitHub upload-pack requires full object IDs. A parent expression also
  // needs the fetched commit's parent: depth one cannot satisfy it.
  const depth = ref.endsWith("^") ? 2 : 1;
  // Concurrent test files may ensure different refs at the same time
  // (node --test runs them in parallel); a shallow fetch collides on
  // .git/shallow.lock and the loser fails while the sibling fetch runs.
  // Retry: the lock is transient and presence is rechecked first so a
  // sibling that already provided the ref ends the loop immediately.
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 12; attempt++) {
    if (present()) return;
    const fetched = spawnSync("git", ["fetch", `--depth=${depth}`, "origin", sha], { cwd: repo, stdio: "inherit" });
    if (fetched.status === 0 && present()) return;
    Atomics.wait(sleeper, 0, 0, 500);
  }
  if (present()) return;
  throw new Error(`cannot provide historical ref ${ref}; fetch --depth=${depth} origin ${sha} first`);
}
