#!/usr/bin/env bash
# UAT owner recipe for `h2a doctor --repair`.
#
# The script owns execution and safety assertions. docs/uat/doctor-repair.md owns the explanation.
# Run from any directory; the candidate is always built in a disposable archive, never in this checkout.
set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ABANDON : prerequis manquant : $1." >&2
    exit 1
  }
}

require_command node
if [ -z "${UAT_SOURCE_DIR-}" ] && [ -z "${UAT_DOCTOR_BIN-}" ]; then
  for required_command in gh git tar npm; do
    require_command "$required_command"
  done
fi

OWNER_HOME=${HOME:?HOME doit etre defini pour identifier les racines owner}
OWNER_CODEX_VALUE=${CODEX_HOME-}
OWNER_CLAUDE_VALUE=${CLAUDE_CONFIG_DIR-}
OWNER_CODEX_ROOT=${OWNER_CODEX_VALUE:-$OWNER_HOME/.codex}
OWNER_CLAUDE_ROOT=${OWNER_CLAUDE_VALUE:-$OWNER_HOME/.claude}
OWNER_CLAUDE_COMPANION_BASE=${OWNER_CLAUDE_VALUE:-$OWNER_HOME}
OWNER_CLAUDE_NATIVE=$OWNER_CLAUDE_COMPANION_BASE/.claude.json
OWNER_CLAUDE_MCP=$OWNER_CLAUDE_COMPANION_BASE/.config/claude/mcp.json

TMP_PARENT=${UAT_TMP_PARENT:-${TMPDIR:-/tmp}}
mkdir -p -- "$TMP_PARENT" || {
  echo "ABANDON : impossible de preparer le parent temporaire '$TMP_PARENT'." >&2
  exit 1
}

UAT=""
SRC=""
OWNS_SRC=0

cleanup() {
  local path
  for path in "$UAT" "$SRC"; do
    [ -n "$path" ] || continue
    if [ "$path" = "$SRC" ] && [ "$OWNS_SRC" != "1" ]; then
      continue
    fi
    case "$path" in
      "$TMP_PARENT"/*) [ -d "$path" ] && rm -rf -- "$path" ;;
      *) echo "NETTOYAGE REFUSE : chemin temporaire inattendu '$path'." >&2 ;;
    esac
  done
}
trap cleanup EXIT

on_signal() {
  trap - INT TERM
  exit 130
}
trap on_signal INT TERM

UAT=$(mktemp -d "$TMP_PARENT/uat-doctor-XXXXXX") || {
  echo "ABANDON : mktemp a echoue pour la racine UAT." >&2
  exit 1
}
case "$UAT" in
  "$TMP_PARENT"/*) [ -d "$UAT" ] || exit 1 ;;
  *) echo "ABANDON : mktemp a rendu un chemin inattendu '$UAT'." >&2; exit 1 ;;
esac

owner_snapshot() {
  node - "$OWNER_CODEX_ROOT" "$OWNER_CLAUDE_ROOT" "$OWNER_CLAUDE_NATIVE" "$OWNER_CLAUDE_MCP" <<'NODE'
const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync, readlinkSync } = require("node:fs");
const { basename, join } = require("node:path");
const MAX_INLINE_FILE_BYTES = 8 * 1024 * 1024;
const [codexRoot, claudeRoot, claudeNative, claudeMcp] = process.argv.slice(2);

// These are configuration-bearing artifacts. Everything else under the host
// roots is outside this guard unless it is a plugin manifest matched below.
const CORE_CONFIGURATION_PATHS = [
  join(codexRoot, "config.toml"),
  join(claudeRoot, "settings.json"),
  join(claudeRoot, "plugins", "known_marketplaces.json"),
  join(claudeRoot, "plugins", "installed_plugins.json"),
  claudeNative,
  claudeMcp
];
const PLUGIN_CONFIGURATION_BASENAMES = new Set([
  ".mcp.json",
  "hooks.json"
]);

// Explicitly volatile host state: journals, SQLite runtime databases and
// sidecars, session caches, temporary trees and locks are never configuration.
const VOLATILE_FILE_PATTERNS = [
  "*.log",
  "*.jsonl",
  "*.sqlite",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "*.lock",
  "*.pid"
];
const VOLATILE_DIRECTORY_NAMES = new Set([
  ".tmp",
  "debug",
  "file-history",
  "history",
  "journal",
  "journals",
  "lock",
  "locks",
  "logs",
  "session-cache",
  "session-env",
  "session_cache",
  "session_env",
  "sessions",
  "shell-snapshots",
  "shell_snapshots",
  "telemetry",
  "tmp"
]);

function isVolatileConfigurationPath(relative) {
  const normalized = relative.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => VOLATILE_DIRECTORY_NAMES.has(part))) return true;
  const name = parts.at(-1) ?? "";
  return VOLATILE_FILE_PATTERNS.some((pattern) => name.endsWith(pattern.slice(1)));
}

function isConfiguration(relative) {
  if (isVolatileConfigurationPath(relative)) return false;
  const normalized = `/${relative.replaceAll("\\", "/")}`;
  return (
    normalized.endsWith("/.codex-plugin/plugin.json") ||
    normalized.endsWith("/.claude-plugin/plugin.json") ||
    normalized.endsWith("/.agents/plugins/marketplace.json") ||
    normalized.endsWith("/hooks/hooks.json") ||
    PLUGIN_CONFIGURATION_BASENAMES.has(basename(normalized))
  );
}

function fingerprint(path, stat) {
  const hash = createHash("sha256");
  const type = stat.isDirectory() ? "d" : stat.isFile() ? "f" : stat.isSymbolicLink() ? "l" : "o";
  hash.update([
    type,
    String(stat.mode),
    String(stat.size),
    String(stat.mtimeNs)
  ].join("\0") + "\0");

  if (stat.isSymbolicLink()) {
    hash.update(readlinkSync(path) + "\0");
  } else if (stat.isFile()) {
    if (stat.size <= BigInt(MAX_INLINE_FILE_BYTES)) {
      hash.update(readFileSync(path));
    } else {
      hash.update("content-bounded-to-metadata\0");
    }
  }
  return hash.digest("hex");
}

const snapshot = new Map();

function record(path, absentIsState = false) {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT" && absentIsState) {
      snapshot.set(path, "ABSENT");
      return;
    }
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  snapshot.set(path, fingerprint(path, stat));
}

function visitRoot(root) {
  function visit(absolute, relative) {
    let stat;
    try {
      stat = lstatSync(absolute, { bigint: true });
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }

    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) {
        const childRelative = relative ? `${relative}/${entry}` : entry;
        if (isVolatileConfigurationPath(childRelative)) continue;
        visit(join(absolute, entry), childRelative);
      }
    } else if (isConfiguration(relative)) {
      snapshot.set(absolute, fingerprint(absolute, stat));
    }
  }

  visit(root, "");
}

for (const path of CORE_CONFIGURATION_PATHS) record(path, true);
visitRoot(codexRoot);
visitRoot(claudeRoot);

const ordered = Object.fromEntries([...snapshot.entries()].sort(([left], [right]) => left.localeCompare(right)));
process.stdout.write(JSON.stringify(ordered) + "\n");
NODE
}

configuration_changes() {
  node - "$1" "$2" <<'NODE'
const { readFileSync } = require("node:fs");
const [beforePath, afterPath] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

for (const path of paths) {
  if (before[path] === after[path]) continue;
  const status = before[path] === "ABSENT" || !(path in before)
    ? "AJOUTE"
    : after[path] === "ABSENT" || !(path in after)
      ? "SUPPRIME"
      : "MODIFIE";
  process.stdout.write(`  ${status} : ${path}\n`);
}
NODE
}

guard_owner_roots() {
  local label=$1
  shift
  local snapshot_label=${label// /-}
  local before=$UAT/.owner-config-before-$snapshot_label.json
  local after=$UAT/.owner-config-after-$snapshot_label.json
  local changes code
  owner_snapshot > "$before" || {
    echo "ABANDON : empreinte owner impossible avant $label." >&2
    return 1
  }

  "$@"
  code=$?

  owner_snapshot > "$after" || {
    echo "ABANDON : empreinte owner impossible apres $label." >&2
    return 1
  }
  changes=$(configuration_changes "$before" "$after") || {
    echo "ABANDON : comparaison owner impossible apres $label." >&2
    return 1
  }
  if [ -n "$changes" ]; then
    echo "INVALIDE : la configuration owner a change pendant $label." >&2
    printf '%s\n' "$changes" >&2
    return 1
  fi
  echo "  configuration owner . IDENTIQUE avant/apres $label"
  return "$code"
}

expect_code() {
  local actual=$1 expected=$2 label=$3
  if [ "$actual" != "$expected" ]; then
    echo "INVALIDE : $label a sorti $actual, attendu $expected." >&2
    return 1
  fi
  return 0
}

expect_code_0_or_2() {
  local actual=$1 label=$2
  case "$actual" in
    0|2) return 0 ;;
    *) echo "INVALIDE : $label a sorti $actual, attendu 0 ou 2." >&2; return 1 ;;
  esac
}

prepare_candidate() {
  if [ -n "${UAT_SOURCE_DIR-}" ] || [ -n "${UAT_DOCTOR_BIN-}" ]; then
    if [ -z "${UAT_SOURCE_DIR-}" ] || [ -z "${UAT_DOCTOR_BIN-}" ]; then
      echo "ABANDON : UAT_SOURCE_DIR et UAT_DOCTOR_BIN doivent etre poses ensemble." >&2
      return 1
    fi
    SRC=$(cd -- "$UAT_SOURCE_DIR" && pwd) || return 1
    DOCTOR_BIN=$UAT_DOCTOR_BIN
    CANDIDATE="injection de test"
    OWNS_SRC=0
  else
    command -v gh >/dev/null || {
      echo "ABANDON : gh est requis pour resoudre le HEAD reel de la PR 94." >&2
      return 1
    }
    CANDIDATE=${UAT_CANDIDATE_SHA:-$(gh pr view 94 --json headRefOid --jq .headRefOid)}
    [ -n "$CANDIDATE" ] || {
      echo "ABANDON : SHA candidat vide." >&2
      return 1
    }
    SRC=$(mktemp -d "$TMP_PARENT/uat-src-XXXXXX") || return 1
    OWNS_SRC=1
    git -C "$REPO_ROOT" archive --format=tar "$CANDIDATE" | tar -xf - -C "$SRC" || {
      echo "ABANDON : extraction du candidat $CANDIDATE echouee." >&2
      return 1
    }
    (
      cd -- "$SRC" || exit 1
      npm ci && npm run build
    ) || {
      echo "ABANDON : npm ci/build a echoue dans l'extrait jetable." >&2
      return 1
    }
    DOCTOR_BIN=$SRC/packages/h2a/dist/bin.js
  fi

  [ -f "$DOCTOR_BIN" ] || {
    echo "ABANDON : candidat construit absent a '$DOCTOR_BIN'." >&2
    return 1
  }
  [ -f "$SRC/docs/uat/probe-oracle.sh" ] || {
    echo "ABANDON : probe-oracle.sh absent de la source candidate." >&2
    return 1
  }
  [ -f "$SRC/docs/uat/probe-live-session.sh" ] || {
    echo "ABANDON : probe-live-session.sh absent de la source candidate." >&2
    return 1
  }
  NODE_TEST_FILE=${UAT_NODE_TEST_FILE:-$SRC/packages/h2a/test/host-installation-doctor.test.js}
  [ -f "$NODE_TEST_FILE" ] || {
    echo "ABANDON : test automatise absent a '$NODE_TEST_FILE'." >&2
    return 1
  }
}

run_scenario_3() {
  local bus=$UAT/h3/bus
  local code
  local -a owner_env=(-u CODEX_HOME -u CLAUDE_CONFIG_DIR "HOME=$OWNER_HOME")
  [ -n "$OWNER_CODEX_VALUE" ] && owner_env+=("CODEX_HOME=$OWNER_CODEX_VALUE")
  [ -n "$OWNER_CLAUDE_VALUE" ] && owner_env+=("CLAUDE_CONFIG_DIR=$OWNER_CLAUDE_VALUE")

  echo
  echo "=== scenario 3 — installation owner, dry-run seulement =================="
  mkdir -p -- "$UAT/h3"
  env "${owner_env[@]}" node "$DOCTOR_BIN" init --root "$bus" >/dev/null 2>&1
  code=$?
  expect_code "$code" 0 "scenario 3 / init" || return 1

  env "${owner_env[@]}" node "$DOCTOR_BIN" doctor --root "$bus" --repair --dry-run
  code=$?
  expect_code_0_or_2 "$code" "scenario 3 / dry-run" || return 1
  echo "  aucune reparation owner n'est lancee automatiquement"
}

run_scenario_0() {
  local code
  echo
  echo "=== scenario 0 — oracle Codex sur racines jetables ======================="
  (
    cd -- "$SRC" || exit 1
    env -u CODEX_HOME -u CLAUDE_CONFIG_DIR "DOCTOR_BIN=$DOCTOR_BIN" \
      bash docs/uat/probe-oracle.sh
  )
  code=$?
  expect_code "$code" 0 "scenario 0 / probe-oracle" || return 1
}

run_scenario_1() {
  local home=$UAT/h1
  local bus=$home/bus
  local code
  echo
  echo "=== scenario 1 — marketplace disparue, racines jetables ================="
  mkdir -p -- "$home/.codex"
  printf '[marketplaces.sentropic]\nsource_type = "local"\nsource = "%s/disparu"\n' "$UAT" \
    > "$home/.codex/config.toml"

  env -u CLAUDE_CONFIG_DIR "HOME=$home" "CODEX_HOME=$home/.codex" \
    node "$DOCTOR_BIN" init --root "$bus"
  code=$?
  expect_code "$code" 0 "scenario 1 / init" || return 1

  env -u CLAUDE_CONFIG_DIR "HOME=$home" "CODEX_HOME=$home/.codex" \
    node "$DOCTOR_BIN" doctor --root "$bus" --repair --dry-run
  code=$?
  expect_code "$code" 2 "scenario 1 / dry-run" || return 1

  env -u CLAUDE_CONFIG_DIR "HOME=$home" "CODEX_HOME=$home/.codex" \
    node "$DOCTOR_BIN" doctor --root "$bus" --repair
  code=$?
  expect_code "$code" 0 "scenario 1 / repair" || return 1
}

run_scenario_2() {
  local home=$UAT/h2/test-home
  local code
  echo
  echo "=== scenario 2 — session vivante, test puis observation =================="
  mkdir -p -- "$home"

  env -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
    "HOME=$home" node --test "$NODE_TEST_FILE"
  code=$?
  expect_code "$code" 0 "scenario 2 / node --test" || return 1

  (
    cd -- "$SRC" || exit 1
    env -u CODEX_HOME -u CLAUDE_CONFIG_DIR "DOCTOR_BIN=$DOCTOR_BIN" \
      bash docs/uat/probe-live-session.sh
  )
  code=$?
  expect_code "$code" 0 "scenario 2 / probe-live-session" || return 1
}

echo "=== UAT doctor --repair ==================================================="
echo "  candidat ............ preparation en cours"
echo "  owner HOME .......... $OWNER_HOME"
echo "  owner CODEX ......... $OWNER_CODEX_ROOT"
echo "  owner CLAUDE ........ $OWNER_CLAUDE_ROOT"
echo "  config Claude native  $OWNER_CLAUDE_NATIVE"
echo "  config Claude MCP .... $OWNER_CLAUDE_MCP"
echo "  racine UAT jetable .. $UAT"

prepare_candidate || exit 1
echo "  candidat ............ $CANDIDATE"
echo "  source candidate .... $SRC"
echo "  doctor .............. $DOCTOR_BIN"

guard_owner_roots "scenario 3" run_scenario_3 || exit 1
guard_owner_roots "scenario 0" run_scenario_0 || exit 1
guard_owner_roots "scenario 1" run_scenario_1 || exit 1
guard_owner_roots "scenario 2" run_scenario_2 || exit 1

echo
echo "=== decision owner ========================================================"
echo "  La recette a execute 3, 0, 1, 2 et la configuration owner est restee identique."
echo "  Les sessions Codex et Claude peuvent rester ouvertes : journaux, bases SQLite, caches de session et verrous sont hors empreinte."
echo "  Aucun done n'est deduit de ce vert : l'owner doit encore lire le scenario 2 et trancher."
echo "  Le nettoyage de l'UAT et de l'extrait candidat va maintenant etre effectue."
