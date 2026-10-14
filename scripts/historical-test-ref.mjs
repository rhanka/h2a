import { spawnSync } from "node:child_process";

export const LEGACY_HOST_REF = "89bbd9af1033153b6654c272e126d91e0fa42683^";
export const IDENTITY_BASE_REF = "e3fc1a52eb8bc8e5794ced5e17e201e1bcfa99d2";

export function ensureHistoricalGitRef(repo, ref) {
  const present = () => spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: repo, stdio: "ignore" }).status === 0;
  if (present()) return;
  const sha = ref.endsWith("^") ? ref.slice(0, -1) : ref;
  // GitHub upload-pack requires full object IDs. A parent expression also
  // needs the fetched commit's parent: depth one cannot satisfy it.
  const depth = ref.endsWith("^") ? 2 : 1;
  const fetched = spawnSync("git", ["fetch", `--depth=${depth}`, "origin", sha], { cwd: repo, stdio: "inherit" });
  if (fetched.status !== 0 || !present()) throw new Error(`cannot provide historical ref ${ref}; fetch --depth=${depth} origin ${sha} first`);
}
