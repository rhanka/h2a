#!/usr/bin/env bash
# UAT probe — an error is not an absence.
#
# Why this file exists. The rule "absence IS the evidence" is sound only for PROVEN absence. On this
# branch the confusion between *absent* and *unreadable* has been closed once and came back twice
# through different doors:
#
#   round 18 — any probe error on a marketplace source was read as absence, and doctor DELETED the
#              table and its custom fields on that false premise, then reported ok=true;
#   round 20 — the new artifact-based host-presence rule reintroduced it: a broken symlink or an
#              EACCES root became "no artifacts", hence host-not-installed, hence a false-clean;
#   and a TOML single-quote decoding miss produced the same destruction by a third route.
#
# Fixing it a third time guarantees nothing. This probe turns the two review legs' manual attacks
# into a permanent, adversarial matrix so the confusion cannot come back a fourth time unnoticed.
#
# It is the counter-mutant idea applied to the gate: ADD a dangerous case without touching the
# existing suite, and see whether the product notices. A guard built from the examples it was given
# only protects those examples.
#
# WHAT IT TOUCHES: a throwaway HOME and throwaway host roots under a temp tree. It runs the built
# candidate doctor in --repair --dry-run only, so it mutates nothing of yours. No native host CLI is
# invoked by this probe itself; the dry run does not spawn them.
#
# Usage, from the repo root, after `npm ci && npm run build`:
#   bash docs/uat/probe-presence.sh
set -uo pipefail

DOCTOR_BIN="${DOCTOR_BIN:-$PWD/packages/h2a/dist/bin.js}"
[ -f "$DOCTOR_BIN" ] || {
  echo "ABANDON : $DOCTOR_BIN absent. Lance 'npm ci && npm run build' d-abord." >&2; exit 1; }

for name in CODEX_HOME CLAUDE_CONFIG_DIR; do
  eval "value=\${$name-}"
  [ -z "$value" ] && continue
  echo "ABANDON : $name est defini a '$value'. Ce probe pose ses propres racines ; lance 'unset $name'." >&2
  exit 1
done

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/uat-presence-XXXXXX") || {
  echo "ABANDON : mktemp -d a echoue." >&2; exit 1; }
case "$ROOT" in
  /*/*) [ -d "$ROOT" ] || { echo "ABANDON : '$ROOT' n-est pas un repertoire." >&2; exit 1; };;
  *) echo "ABANDON : mktemp a rendu un chemin inattendu ('$ROOT')." >&2; exit 1;;
esac
# Le chmod 000 doit etre defait AVANT le rm, sinon le nettoyage echoue en silence.
trap 'chmod -R u+rwX "$ROOT" 2>/dev/null; rm -rf "$ROOT"' EXIT

VERDICT=0

# La presence de la CLI hote est la variable qui DECIDE de la conclusion. Ce probe doit donc la POSER
# explicitement, pas l-heriter de la machine : ma premiere version laissait `codex` sur le PATH pour les
# cas d-absence d-artefacts, donc l-hote etait << installe mais non configure >> et `host-not-installed`
# n-avait aucune raison de sortir. J-ai attribue au produit une erreur qui etait la mienne - exactement
# le defaut qui a fait rapporter une porte verte alors que la CI etait rouge.
PATH_NU="$ROOT/bin-nu"
mkdir -p "$PATH_NU"
for outil in node; do
  chemin=$(command -v "$outil") && ln -s "$chemin" "$PATH_NU/$outil"
done
PATH_SANS_CLI="$PATH_NU:/usr/bin:/bin"

# Rend les codes de finding de l-hote demande, ou la chaine "ILLISIBLE".
findings_de() { # $1=rapport json  $2=hote
  node -e '
    const fs = require("node:fs");
    try {
      const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const hosts = (r.checks && r.checks.hostInstallations && r.checks.hostInstallations.hosts) || [];
      const h = hosts.find((x) => x.host === process.argv[2]);
      process.stdout.write(h ? (h.findings || []).map((f) => f.code).join(",") : "HOTE-ABSENT");
    } catch { process.stdout.write("ILLISIBLE"); }
  ' "$1" "$2"
}
ok_de() { node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(r.ok))}catch{process.stdout.write("ILLISIBLE")}' "$1"; }

# $1=libelle  $2=HOME  $3=attendu-contient|attendu-ne-contient-pas  $4=code  $5=justification
cas() {
  local libelle="$2" home="$3" sens="$4" code="$5" pourquoi="$6" num="$1" chemin="${7:-$PATH}"
  local bus="$home/bus" out="$home/rapport.json"
  HOME="$home" PATH="$chemin" node "$DOCTOR_BIN" init --root "$bus" >/dev/null 2>&1
  HOME="$home" PATH="$chemin" node "$DOCTOR_BIN" doctor --root "$bus" --repair --dry-run --format json > "$out" 2>/dev/null
  local f ok
  f=$(findings_de "$out" codex); ok=$(ok_de "$out")
  printf '  %s. %-46s ok=%-9s findings=%s\n' "$num" "$libelle" "$ok" "${f:-aucun}"
  case "$sens" in
    contient)
      case ",$f," in *",$code,"*) ;; *) echo "     ECHEC : '$code' attendu et absent. $pourquoi"; VERDICT=1;; esac;;
    absent)
      case ",$f," in *",$code,"*) echo "     ECHEC : '$code' present alors qu-il est INTERDIT ici. $pourquoi"; VERDICT=1;; *) ;; esac;;
  esac
}

echo "=== une erreur n-est pas une absence : matrice adverse ===================="
echo "  Sujet : doctor a-t-il le droit de conclure 'hote non installe' quand il n-a"
echo "  pas PU regarder ? Seuls ENOENT et ENOTDIR explicites l-autorisent."
echo

# --- 1. ENOENT franc : la racine n-existe pas. host-not-installed est LEGITIME.
H1="$ROOT/h1"; mkdir -p "$H1"
cas 1 "ENOENT franc, ET aucune CLI hote joignable" "$H1" contient "host-not-installed" \
  "Absence prouvee sur les DEUX signaux : c-est le seul cas qui autorise host-not-installed, et le correctif de la manche 19 en depend." \
  "$PATH_SANS_CLI"

# --- 2. symlink casse : la racine EXISTE en tant qu-entree, sa cible non.
H2="$ROOT/h2"; mkdir -p "$H2"; ln -s "$ROOT/cible-inexistante" "$H2/.codex"
cas 2 "symlink casse, sans CLI joignable" "$H2" absent "host-not-installed" \
  "Un lien casse n-est pas une absence : c-est une installation cassee. Mesure par deux relectures independantes." \
  "$PATH_SANS_CLI"

# --- 3. parent illisible : la racine existe mais ne peut pas etre lue (EACCES).
H3="$ROOT/h3"; mkdir -p "$H3/verrou/.codex"
printf '[plugins."h2a-local-codex-99999@sentropic-local-codex-99999"]\nenabled = true\n' > "$H3/verrou/.codex/config.toml"
chmod 000 "$H3/verrou"
CODEX_HOME_CAS3="$H3/verrou/.codex"
H3BUS="$H3/bus"
HOME="$H3" node "$DOCTOR_BIN" init --root "$H3BUS" >/dev/null 2>&1
HOME="$H3" CODEX_HOME="$CODEX_HOME_CAS3" PATH="$PATH_SANS_CLI" node "$DOCTOR_BIN" doctor --root "$H3BUS" --repair --dry-run --format json > "$H3/rapport.json" 2>/dev/null
F3=$(findings_de "$H3/rapport.json" codex); OK3=$(ok_de "$H3/rapport.json")
printf '  3. %-46s ok=%-9s findings=%s\n' "CODEX_HOME declare, parent chmod 000 (EACCES)" "$OK3" "${F3:-aucun}"
case ",$F3," in
  *",host-not-installed,"*)
    echo "     ECHEC : 'host-not-installed' sur une racine EXPLICITEMENT declaree que doctor n-a"
    echo "             pas pu lire. Declarer propre ce qu-on n-a pas regarde est un faux-propre."
    VERDICT=1;;
esac
if [ "$OK3" = "true" ]; then
  echo "     ECHEC : ok=true alors que la racine declaree est illisible. Indisponible doit etre bloquant."
  VERDICT=1
fi
chmod 755 "$H3/verrou" 2>/dev/null

# --- 4. controle positif : racine vide mais LISIBLE. Doit diagnostiquer, pas se taire.
H4="$ROOT/h4"; mkdir -p "$H4/.codex"
cas 4 "racine vide mais LISIBLE, sans CLI (controle positif)" "$H4" absent "host-not-installed" \
  "Une racine visible et vide est un artefact PRESENT : une installation a diagnostiquer, pas un hote absent." \
  "$PATH_SANS_CLI"

echo
echo "=== comment conclure ====================================================="
if [ "$VERDICT" != "0" ]; then
  echo "  INVALIDE. Au moins un cas ci-dessus confond 'je n-ai pas pu regarder' avec"
  echo "  'il n-y a rien a regarder'. Une sûrete fondee sur une absence non prouvee est"
  echo "  un calendrier : elle tient jusqu-au premier lien casse ou au premier chmod."
  echo "  CODE DE SORTIE 1"
  exit 1
fi
echo "  VALIDE : seuls les cas d-absence PROUVEE concluent a un hote non installe,"
echo "  et les cas illisibles sont bloquants plutot que silencieux."
echo "  CODE DE SORTIE 0"
