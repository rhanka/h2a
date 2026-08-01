#!/usr/bin/env bash
# UAT probe — observe, do not assert.
#
# Builds the exact case that failed three independent reviews: a live Codex session that started
# BEFORE a repair, with a plugin cache still declaring an older version. Then it runs the candidate
# doctor and PRINTS the three values you must read yourself: the exit code, the report's `ok`, and
# the restart reasons.
#
# It deliberately asserts nothing. A test absorbs the behaviour into its assertion and exits 0 when
# it passes; a UAT has to let you SEE the behaviour.
#
# WHAT IT TOUCHES, corrected after an independent review measured my earlier claim as FALSE:
#   - HOME and the bus are throwaway; your real installation is never read or written.
#   - BUT --repair goes through the PRODUCTION runner, so the real `codex` and `claude` native CLIs
#     ARE executed, twice, against that throwaway HOME. They may hit the network and your auth.
#     My earlier header said "no native CLI is ever executed". That was wrong, and it mattered:
#     you would have run something whose blast radius I had understated.
#
# Usage, from the repo root, after `npm run build`:
#   bash docs/uat/probe-live-session.sh
set -uo pipefail

DOCTOR_BIN="${DOCTOR_BIN:-$PWD/packages/h2a/dist/bin.js}"
if [ ! -f "$DOCTOR_BIN" ]; then
  echo "ABANDON : $DOCTOR_BIN absent. Lance 'npm run build' d'abord — sans le candidat construit," >&2
  echo "          tu testerais le paquet installe globalement, pas cette PR." >&2
  exit 1
fi

# The native CLIs honour CODEX_HOME and CLAUDE_CONFIG_DIR, and the production runner uses spawnSync,
# which INHERITS the whole environment. A throwaway HOME alone therefore does NOT keep them away from
# your real installation — my earlier claim that it did was false, and an independent review measured it.
# Pin both roots inside the throwaway tree, and refuse to run if anything still points outside it.
PROBE=$(mktemp -d "${TMPDIR:-/tmp}/uat-probe-XXXXXX") || {
  echo "ABANDON : mktemp -d a echoue. Sans arbre jetable ce probe ecrirait ailleurs." >&2; exit 1; }
# Sans cette verification, un PROBE vide donnerait HOME_DIR=/home, BUS=/bus et un `rm -rf ""` au
# piege de sortie. Une revue independante a mesure exactement ce fail-open.
case "$PROBE" in
  /*/*) [ -d "$PROBE" ] || { echo "ABANDON : '$PROBE' n'est pas un repertoire." >&2; exit 1; };;
  *) echo "ABANDON : mktemp a rendu un chemin inattendu ('$PROBE')." >&2; exit 1;;
esac
trap 'rm -rf "$PROBE"' EXIT
HOME_DIR="$PROBE/home"
BUS="$PROBE/bus"
# Read the INHERITED values FIRST and refuse on them. My previous version exported before checking,
# so the check compared the values it had just written: a guard that could not fire. An independent
# review measured that, and it is the same defect this whole PR exists to hunt.
INHERITED_CODEX_HOME="${CODEX_HOME-}"
INHERITED_CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}"
for pair in "CODEX_HOME=$INHERITED_CODEX_HOME" "CLAUDE_CONFIG_DIR=$INHERITED_CLAUDE_CONFIG_DIR"; do
  name="${pair%%=*}"; value="${pair#*=}"
  [ -z "$value" ] && continue
  case "$value" in
    "$PROBE"/*) ;;
    *) echo "ABANDON : $name est defini a '$value', hors du HOME jetable de ce probe." >&2
       echo "          Les CLIs natifs honorent cette racine : le probe pourrait viser ta VRAIE" >&2
       echo "          installation. Lance 'unset $name' puis relance." >&2
       exit 1;;
  esac
done
export CODEX_HOME="$HOME_DIR/.codex"
export CLAUDE_CONFIG_DIR="$HOME_DIR/.claude"
CACHE="$HOME_DIR/.codex/plugins/cache/sentropic/h2a"

mkdir -p "$CACHE/0.87.0/.codex-plugin" "$HOME_DIR/.codex"
printf '{"name":"h2a","version":"0.87.0"}\n' > "$CACHE/0.87.0/.codex-plugin/plugin.json"
printf '[plugins."h2a@sentropic"]\nenabled = true\n'                > "$HOME_DIR/.codex/config.toml"
# A repair recorded LONG before the session started: the session cannot have loaded the repaired code.
printf '{"repairedAt":"2010-01-01T00:00:00.000Z","repairedPaths":["%s"]}\n' "$CACHE" \
  > "$HOME_DIR/.codex/h2a-repair.json"

HOME="$HOME_DIR" node "$DOCTOR_BIN" init --root "$BUS" >/dev/null 2>&1

# A LIVE Codex session, started in 2020, i.e. after the recorded repair of 2010 — same shape the
# regression suite uses, written straight onto this throwaway bus so the doctor really sees it.
node -e '
  const { mkdirSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  const dir = join(process.argv[1], "presence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "uat-probe.json"), JSON.stringify({
    sessionId: "uat-probe",
    instance: "codex:uat:probe0000000",
    host: "codex",
    startedAt: "2020-01-01T00:00:00.000Z",
    heartbeatAt: new Date().toISOString(),
    state: "live",
    pid: process.pid,
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: []
  }, null, 2) + "\n");
' "$BUS"

echo "=== ce que le probe a fabrique ==========================================="
echo "  HOME jetable ........ $HOME_DIR"
echo "  cache plugin ........ 0.87.0 (manifeste declarant 0.87.0)"
echo "  marqueur ANCIEN ..... 2010-01-01  (une reparation avait EU LIEU autrefois)"
echo "  session vivante ..... demarree 2020-01-01, donc APRES cet ancien marqueur"
echo
echo "  ATTENTION A LA CHRONOLOGIE, elle a trois temps et pas deux :"
echo "    1. 2010 : une vieille reparation, dont le marqueur est deja sur disque"
echo "    2. 2020 : la session vivante demarre — elle est POSTERIEURE au vieux marqueur"
echo "    3. MAINTENANT : --repair va ecrire un marqueur NEUF, donc POSTERIEUR a la session"
echo "  C'est le temps 3 qui compte : une session demarree AVANT la reparation qu'on vient de"
echo "  faire ne peut pas avoir charge le code repare. Le marqueur de 2010 n'est la que pour"
echo "  prouver qu'un marqueur PREEXISTANT ne suffit pas a excuser la session."
echo "  => une session qui n'a pas pu charger le code repare"
echo
echo "=== ce que le candidat repond ============================================"
OUT="$PROBE/report.json"
HOME="$HOME_DIR" node "$DOCTOR_BIN" doctor --root "$BUS" --repair --format json > "$OUT" 2>"$PROBE/err.txt"
CODE=$?

echo "  code de sortie ...... $CODE      <-- tu dois lire 2"
NEUF=$(node -e 'try{const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(m.repairedAt||"absent"))}catch{process.stdout.write("absent")}' "$HOME_DIR/.codex/h2a-repair.json")
echo "  marqueur APRES repair $NEUF"
echo "                        <-- il doit etre de MAINTENANT, donc posterieur a la session de 2020."
echo "                            C'est CE marqueur-la qui rend la session perimee. Une revue a"
echo "                            mesure que ne pas l'afficher forcait le lecteur a reconstruire"
echo "                            la chronologie de tete."
node -e '
  const fs = require("node:fs");
  let r; try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
  catch { console.log("  rapport JSON ........ ILLISIBLE (voir err.txt)"); process.exit(0); }
  console.log("  report.ok ........... " + r.ok + "      <-- tu dois lire false");
  const live = r.checks && r.checks.liveHostSessions;
  const restart = (live && live.restartRequired) || [];
  console.log("  motifs de redemarrage " + (restart.length ? "" : "(AUCUN)"));
  for (const entry of restart) {
    console.log("    - session " + (entry.sessionId ?? "?") + " / " + (entry.host ?? "?") +
                " : " + (entry.message ?? entry.reason ?? entry.code ?? JSON.stringify(entry)));
  }
  const unrepaired = (r.unrepaired || []).map((u) => u.code);
  if (unrepaired.length) console.log("  unrepaired .......... " + unrepaired.join(", "));
  if (unrepaired.includes("host-command-failed")) {
    console.log("");
    console.log("  >>> INCONCLUSIF : une commande hote NATIVE a ECHOUE pendant ce probe.");
    console.log("      Le code 2 et le motif de redemarrage ne valident alors RIEN : la reparation");
    console.log("      peut etre partielle, et doctor ne defait pas ce que la CLI a deja change.");
    console.log("      Verifie ton installation avant de conclure, puis relance le probe.");
  }
' "$OUT"

echo
echo "=== inertie du dry-run, prouvee par empreinte ============================"
# L'empreinte doit ECHOUER FERME : si find -printf ou sha256sum manquent, les deux cotes valent
# la meme chaine vide et la comparaison rend IDENTIQUE sans avoir rien observe. Mesure par une revue.
for tool in find sha256sum sort; do
  command -v "$tool" >/dev/null || { echo "ABANDON : $tool absent, l'empreinte serait vide des deux cotes." >&2; exit 1; }
done
if ! find . -maxdepth 0 -printf '' 2>/dev/null; then
  echo "ABANDON : ce find ne supporte pas -printf ; l'empreinte serait vide des deux cotes." >&2; exit 1
fi
empreinte() { (cd "$1" && find . -type f -printf '%p %s %T@\n' | sort | sha256sum | cut -d' ' -f1); }
BEFORE=$(empreinte "$HOME_DIR")
[ -n "$BEFORE" ] || { echo "ABANDON : empreinte initiale vide, rien a comparer." >&2; exit 1; }
HOME="$HOME_DIR" node "$DOCTOR_BIN" doctor --root "$BUS" --repair --dry-run --format json > "$PROBE/dry.json" 2>/dev/null
DRYCODE=$?
AFTER=$(empreinte "$HOME_DIR")
echo "  code de sortie ...... $DRYCODE      <-- doit rester 2 : l'installation est toujours cassee"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  empreinte HOME ...... IDENTIQUE avant/apres  <-- le dry-run n'a RIEN modifie"
else
  echo "  empreinte HOME ...... DIFFERENTE  <-- INVALIDE : un dry-run a modifie ton HOME"
fi

echo
echo "=== idempotence : un second repair ne doit rien reparer de plus =========="
HOME="$HOME_DIR" node "$DOCTOR_BIN" doctor --root "$BUS" --repair --format json > "$PROBE/second.json" 2>/dev/null
echo "  code de sortie ...... $?      <-- 2 attendu : la session vivante doit TOUJOURS redemarrer"
node -e '
  const fs = require("node:fs");
  try {
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const hosts = (r.checks && r.checks.hostInstallations && r.checks.hostInstallations.hosts) || [];
    const changed = hosts.flatMap((h) => h.changed || []);
    console.log("  changed au 2e passage " + (changed.length === 0 ? "AUCUN  <-- idempotent" : changed.join(", ") + "  <-- INVALIDE"));
  } catch { console.log("  changed au 2e passage ILLISIBLE"); }
' "$PROBE/second.json"

echo
echo "=== comment conclure ====================================================="
if grep -q '"host-command-failed"' "$OUT" 2>/dev/null; then
  echo "  INCONCLUSIF : une commande hote native a ECHOUE. Ne conclus PAS."
  echo "  La regle VALIDE ci-dessous ne s'applique pas : la reparation peut etre partielle,"
  echo "  et doctor ne defait pas ce que la CLI a deja change. Verifie ton installation."
else
echo "  VALIDE    si : code 2, report.ok false, ET au moins un motif de redemarrage nomme."
echo "  INVALIDE  si : code 0 ou report.ok true — une session vivante serait declaree propre"
echo "                 alors qu'elle fait tourner l'ancien code. C'est le defaut exact que"
echo "                 trois revues independantes ont trouve, chacune par un chemin different."
echo
fi
echo "  Rapport complet : $OUT (efface a la sortie ; copie-le si tu veux le garder)."
echo "  Ta vraie installation n'a pas ete touchee : HOME et bus sont jetables."
echo "  MAIS les vrais CLIs natifs codex/claude ONT ete executes deux fois contre ce HOME jetable,"
echo "  avec acces reseau et a ton auth. C'est le runner de production, pas un simulateur."
