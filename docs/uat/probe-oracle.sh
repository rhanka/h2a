#!/usr/bin/env bash
# UAT probe — ask the HOST, not the tool.
#
# Why this file exists. On 2026-07-30 `doctor --repair` had TWO independent GO verdicts while it
# still left codex serving the OLD MCP server. Nothing in the suite noticed, and neither did the
# other probe, because both read doctor's own report. A tool's self-report cannot be the oracle for
# whether the tool worked.
#
# So this probe builds the owner's real incident shape and then asks CODEX ITSELF two questions:
#   1. `codex mcp list`               -> which h2a MCP server do you actually serve?
#   2. `codex plugin marketplace list` -> is your marketplace subsystem alive at all?
#
# The second one matters on its own: incoherence #1 of this work was that a single dead marketplace
# root made `codex plugin marketplace list` fail ENTIRELY — no plugin listable, installable or
# upgradable, the openai-curated catalog mute too. A repair that fixes the endpoint and leaves that
# dead can look green and still leave plugin management broken.
#
# WHAT IT TOUCHES: a throwaway HOME and a throwaway CODEX_HOME, both under a temp tree. The REAL
# native `codex` binary IS executed against them, several times, and may use the network and your
# auth. It refuses to run if any host root points outside its own tree.
#
# Usage, from the repo root, after `npm ci && npm run build`:
#   bash docs/uat/probe-oracle.sh
set -uo pipefail

DOCTOR_BIN="${DOCTOR_BIN:-$PWD/packages/h2a/dist/bin.js}"
if [ ! -f "$DOCTOR_BIN" ]; then
  echo "ABANDON : $DOCTOR_BIN absent. Lance 'npm ci && npm run build' d'abord — sans le candidat" >&2
  echo "          construit, tu testerais le paquet installe globalement, pas cette PR." >&2
  exit 1
fi
command -v codex >/dev/null || {
  echo "ABANDON : 'codex' introuvable. Ce probe N'A AUCUNE VALEUR sans l'hote : c'est lui l'oracle." >&2
  exit 1; }

# Refuse inherited host roots BEFORE overwriting them — a guard that checks values it has itself
# just written cannot fire, and that defect was measured in an earlier version of the other probe.
INHERITED_CODEX_HOME="${CODEX_HOME-}"
INHERITED_CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}"

PROBE=$(mktemp -d "${TMPDIR:-/tmp}/uat-oracle-XXXXXX") || {
  echo "ABANDON : mktemp -d a echoue. Sans arbre jetable ce probe ecrirait ailleurs." >&2; exit 1; }
case "$PROBE" in
  /*/*) [ -d "$PROBE" ] || { echo "ABANDON : '$PROBE' n'est pas un repertoire." >&2; exit 1; };;
  *) echo "ABANDON : mktemp a rendu un chemin inattendu ('$PROBE')." >&2; exit 1;;
esac
trap 'rm -rf "$PROBE"' EXIT

for pair in "CODEX_HOME=$INHERITED_CODEX_HOME" "CLAUDE_CONFIG_DIR=$INHERITED_CLAUDE_CONFIG_DIR"; do
  name="${pair%%=*}"; value="${pair#*=}"
  [ -z "$value" ] && continue
  echo "ABANDON : $name est defini a '$value'. Les CLIs natifs honorent cette racine : ce probe" >&2
  echo "          pourrait viser ta VRAIE installation. Lance 'unset $name' puis relance." >&2
  exit 1
done

# Codex emet un avertissement d'alias PATH a chaque appel quand son home est sous un repertoire
# temporaire. Il est benin (il PROCEDE), mais repete trois fois il enterre le signal. On le filtre
# et on le DIT, plutot que de masquer silencieusement une sortie d'hote dans un probe dont l'objet
# est justement de montrer la sortie de l'hote.
sans_bruit() { grep -v "could not create PATH aliases"; }

VERDICT=0   # 0 = concluant et valide ; 1 = invalide ou inconcluant

# Une revue independante a mesure que ce probe IGNORAIT le code de sortie de codex : un faux codex
# imprimant les bons textes puis sortant 42 faisait afficher OK aux deux oracles et sortir 0 au
# script. Un oracle qui croit le TEXTE et jamais le STATUT peut etre trompe par la sortie standard.
# Ce helper capture le statut, l-imprime, et rend le probe INCONCLUSIF s-il est non nul.
# Premier argument : `gate` ou `observe`. AVANT reparation un echec de codex est ATTENDU - c-est
# l-installation cassee - donc il ne doit pas condamner le probe. APRES reparation il condamne.
# Cette distinction doit etre EXPLICITE : ma premiere version s-en remettait au fait que les appels
# d-avant passaient par un tube, donc dans un sous-shell dont le VERDICT ne remontait pas. C-etait
# juste par accident de semantique shell, et une justesse accidentelle n-est pas une garantie.
oracle_codex() { # $1=gate|observe  $2..=arguments codex
  local mode="$1"; shift
  local out code
  out=$(HOME="$HOME_DIR" timeout 60 codex "$@" 2>&1); code=$?
  printf '%s\n' "$out" | sans_bruit
  if [ "$code" != "0" ]; then
    if [ "$mode" = "gate" ]; then
      # >&2 : en mode gate la sortie de cette fonction est REDIRIGEE vers le fichier d-oracle.
      # Ecrire le diagnostic sur stdout le melangeait au texte de l-hote, donc mes propres messages
      # se retrouvaient dans ce que je grep ensuite. Un observateur ne doit pas contaminer sa mesure.
      echo "  >>> INCONCLUSIF : 'codex $*' a sorti $code. Le TEXTE rendu ne prouve RIEN :" >&2
      echo "      une commande qui echoue peut avoir imprime une table d-apparence correcte." >&2
      echo "$code" > "$PROBE/echec-oracle"
    else
      echo "  (codex a sorti $code ici, et c-est ATTENDU : l-installation n-est pas encore reparee)"
    fi
  fi
  return 0
}

HOME_DIR="$PROBE/home"
BUS="$PROBE/bus"
export CODEX_HOME="$HOME_DIR/.codex"
mkdir -p "$CODEX_HOME"

# ---- l'incident owner, reconstitue -------------------------------------------------------------
# Un marketplace legacy dont la source est un repertoire de build SUPPRIME, son entree de plugin
# encore active, et son cache encore sur disque declarant un serveur MCP nomme `h2a`.
mkdir -p "$HOME_DIR"
LEGACY_CACHE="$CODEX_HOME/plugins/cache/sentropic-local-codex-99999/h2a-local-codex-99999/0.85.18"
mkdir -p "$LEGACY_CACHE/.codex-plugin"
printf '{"name":"h2a-local-codex-99999","version":"0.85.18"}\n' > "$LEGACY_CACHE/.codex-plugin/plugin.json"
printf '{"mcpServers":{"h2a":{"command":"node","args":["ANCIEN-mcp.js"]}}}\n' > "$LEGACY_CACHE/.mcp.json"
cat > "$CODEX_HOME/config.toml" <<EOF
[marketplaces.sentropic-local-codex-99999]
source_type = "local"
source = "$PROBE/deploy-SUPPRIME-VOLONTAIREMENT"

[plugins."h2a-local-codex-99999@sentropic-local-codex-99999"]
enabled = true
EOF

echo "=== l'etat de depart, et ce que l'hote en dit AVANT toute reparation ====="
echo "  marketplace legacy .. source pointant un repertoire supprime"
echo "  plugin legacy ....... enabled = true"
echo "  cache legacy ........ present, .mcp.json declarant le serveur 'h2a'"
echo
echo "  codex mcp list :"
oracle_codex observe mcp list | sed 's/^/    /' | head -8
echo "  codex plugin marketplace list :"
oracle_codex observe plugin marketplace list | sed 's/^/    /' | head -8

# ---- la reparation ------------------------------------------------------------------------------
echo
echo "=== la reparation ========================================================"
HOME="$HOME_DIR" node "$DOCTOR_BIN" init --root "$BUS" >/dev/null 2>&1
HOME="$HOME_DIR" node "$DOCTOR_BIN" doctor --root "$BUS" --repair --format json > "$PROBE/r.json" 2>"$PROBE/err.txt"
DOCTOR_CODE=$?
echo "  code de sortie de doctor ... $DOCTOR_CODE"
node -e '
  const fs = require("node:fs");
  let r; try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
  catch { console.log("  rapport JSON ............... ILLISIBLE (voir err.txt)"); process.exit(0); }
  // report.ok est GLOBAL : il couvre TOUS les hotes. Sur une machine sans `claude`, il est faux
  // a cause d-un hote absent, ce qui n-a rien a voir avec le sujet de ce probe (codex). Afficher
  // les deux, sinon un lecteur du log CI conclut que la porte est cassee alors qu-elle mesure juste.
  console.log("  report.ok (TOUS hotes) ..... " + r.ok);
  const hosts = (r.checks && r.checks.hostInstallations && r.checks.hostInstallations.hosts) || [];
  const codex = hosts.find((h) => h.host === "codex");
  if (codex) {
    const codes = (codex.findings || []).map((f) => f.code);
    console.log("  hote CODEX, sujet du probe . " + (codes.length ? codes.join(", ") : "aucun finding"));
  }
  const codes = (r.unrepaired || []).map((u) => u.code);
  console.log("  unrepaired ................. " + (codes.length ? codes.join(", ") : "(aucun)"));
  // Imprimer les MESSAGES, pas seulement les codes. Un `host-command-failed` sans sa commande
  // dit qu-une commande hote a echoue sans dire laquelle : le rapport le plus inutile possible.
  // DEFAUT CONNU, mesure le 2026-07-30 : un hote NON INSTALLE est rapporte comme casse.
  // Sur un PATH sans `claude`, doctor sort 2 avec version-skew et plugin-missing sur un hote
  // qui n-existe pas. Un utilisateur qui n-a que codex ne peut donc JAMAIS atteindre ok=true.
  // Si les lignes ci-dessous ne parlent que de Claude sur un runner sans Claude, c-est ce
  // defaut-la que tu lis, pas un echec de la reparation codex.
  for (const u of r.unrepaired || []) {
    console.log("    - " + u.code + " : " + String(u.message || "").replace(/\s+/g, " ").slice(0, 300));
  }
' "$PROBE/r.json"

# ---- l'oracle : on demande a l'hote, pas a l'outil ---------------------------------------------
echo
echo "=== ORACLE 1 — quel serveur MCP h2a codex sert-il VRAIMENT ? ============="
MCP_OUT="$PROBE/mcp.txt"
oracle_codex gate mcp list > "$MCP_OUT"
sed 's/^/  /' "$MCP_OUT" | head -8

echo
echo "=== ORACLE 2 — le sous-systeme marketplace de codex repond-il ? =========="
MKT_OUT="$PROBE/mkt.txt"
oracle_codex gate plugin marketplace list > "$MKT_OUT"
sed 's/^/  /' "$MKT_OUT" | head -8

# ---- lecture ------------------------------------------------------------------------------------
echo
echo "  (un avertissement codex d'alias PATH, benin, a ete filtre de ces sorties)"
echo
echo "=== comment conclure ====================================================="
# L'assertion doit porter sur LA LIGNE du serveur nomme exactement `h2a`, pas sur la sortie
# entiere : un grep global rendrait VALIDE si n'importe quelle autre ligne contenait mcp-serve.
LIGNE_H2A=$(awk '$1 == "h2a" { $1=""; print; exit }' "$MCP_OUT")
# Le CONTRAT PUBLIC de doctor fait partie de l-oracle. Une revue a mesure : doctor sorti a 2 avec
# report.ok=false, les deux oracles verts, et ce script rendait 0. Si l-hote va bien et que doctor
# dit le contraire, l-un des deux a tort et il faut le dire - un desaccord n-est pas un succes.
[ -f "$PROBE/echec-oracle" ] && VERDICT=1
DOCTOR_OK=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(r.ok===true?"true":"false")}catch{process.stdout.write("illisible")}' "$PROBE/r.json")
SERT_ANCIEN=0; SERT_CANONIQUE=0; MKT_MORT=0
case "$LIGNE_H2A" in
  *ANCIEN-mcp.js*) SERT_ANCIEN=1;;
esac
case "$LIGNE_H2A" in
  *mcp-serve*) SERT_CANONIQUE=1;;
esac
grep -qi "failed to load marketplace\|^Error" "$MKT_OUT" && MKT_MORT=1
# (declaration retiree : elle se trouvait APRES le relevement du drapeau d-echec natif de la ligne
#  precedente, donc elle REMETTAIT VERDICT a 0 et effacait le seul signal << codex a echoue >>.
#  Mesure par une jambe de revue independante. VERDICT est declare une seule fois, en tete.)

if [ "$SERT_ANCIEN" = "1" ]; then
  VERDICT=1
  echo "  INVALIDE : codex sert encore ANCIEN-mcp.js apres la reparation."
  echo "             C'est le symptome d'origine, reproduit par l'outil cense le fermer."
elif [ "$SERT_CANONIQUE" = "1" ]; then
  echo "  Oracle 1 OK : codex sert le canonique (h2a mcp-serve)."
else
  VERDICT=1
  echo "  INVALIDE : codex ne sert AUCUN serveur h2a reconnaissable — lis la sortie ci-dessus."
fi

if [ "$MKT_MORT" = "1" ]; then
  VERDICT=1
  echo "  INVALIDE : 'codex plugin marketplace list' ECHOUE encore. Aucun plugin n'est"
  echo "             listable, installable ni upgradable — l'incoherence n.1 de ce dossier."
elif ! grep -qi "MARKETPLACE\|sentropic" "$MKT_OUT"; then
  # Sans cette branche, une sortie VIDE (timeout, binaire tue) se lisait "OK" : un oracle
  # fail-open, c'est-a-dire exactement le defaut que cet oracle existe pour attraper.
  VERDICT=1
  echo "  INCONCLUSIF : 'codex plugin marketplace list' n'a rien rendu d'exploitable."
  echo "                Ne conclus PAS que le sous-systeme est sain — il n'a pas repondu."
else
  echo "  Oracle 2 OK : le sous-systeme marketplace repond et liste au moins une entree."
fi

echo
echo "  L'ORACLE PRIME SUR LE RAPPORT. Si doctor annonce ok=true et que l'un des deux oracles"
echo "  ci-dessus est INVALIDE, c'est le rapport qui a tort, pas l'hote. C'est exactement ce"
echo "  qui est arrive le 2026-07-30, sous deux verdicts GO independants."
echo
echo "  Ta vraie installation n'a pas ete touchee : HOME et CODEX_HOME sont jetables et ce probe"
echo "  refuse de tourner si une racine hote pointe hors de son arbre."

# ECHOUER FERME sur sa propre conclusion. Une revue independante a mesure que ce probe sortait 0
# apres avoir imprime INVALIDE : un oracle fail-open sur son propre verdict, c'est-a-dire le defaut
# meme qu'il existe pour attraper. Troisieme fois que je livre cette classe sur cette branche.
if [ "$DOCTOR_CODE" != "0" ] || [ "$DOCTOR_OK" != "true" ]; then
  echo
  echo "  CONTRAT DOCTOR NON TENU : sortie $DOCTOR_CODE, report.ok=$DOCTOR_OK, apres une reparation"
  echo "  de son propre fait. Confronte-le aux deux oracles ci-dessus : s-ils sont verts, le rapport"
  echo "  et l-hote se contredisent et l-un des deux a tort ; s-ils ne le sont pas, la reparation a"
  echo "  simplement echoue. Dans les deux cas ce n-est pas un succes, et ce script ne rendra pas 0."
  VERDICT=1
fi

if [ "$VERDICT" != "0" ]; then
  echo
  echo "  CODE DE SORTIE 1 : au moins une conclusion ci-dessus est INVALIDE ou INCONCLUSIVE."
  exit 1
fi
echo
echo "  CODE DE SORTIE 0 : les deux oracles concluent, et concluent valide."
