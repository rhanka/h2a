# Runbook de récupération — parc h2a 0.98.2 → 0.98.4 (host natif refusé après reboot)

- **Date** : 2026-10-11
- **Référence** : SPEC 0.98.5, R9 (et R3.6 pour le refus codé machine-id illisible).
- **Périmètre** : postes où le host natif d'une version 0.98.2 à 0.98.4 refuse de démarrer après un hard reboot, ou reste bloqué sur un refus codé. Ce runbook est le filet des cas que la migration automatique (R3) ne couvre PAS en routine : machine-id durablement illisible, rows sans ancre machine (pré-0.98.2), rows d'une autre machine.

## Règles du runbook

1. **Aucune commande ci-dessous n'exige de host fonctionnel.** Toutes les commandes agissent sur des fichiers uniquement ; elles sont exécutables sur un poste où le host refuse de démarrer.
2. **On archive par renommage horodaté SUR LE SYSTÈME DE FICHIERS de chaque ressource, on ne supprime jamais.** Un `mv` inter-systèmes de fichiers (p. ex. de `$XDG_RUNTIME_DIR` — tmpfs — vers `$HOME`) n'est PAS un renommage : il copie puis efface la source, les `dev`/`ino` changent et le fichier archivé n'est plus le fichier d'origine. Chaque ressource est donc renommée DANS son propre répertoire, sous un nom horodaté ; l'archive est restaurable par le renommage inverse.
3. **Phase 0 avant tout.** Si le machine-id est durablement illisible, l'archivage ne rétablit PAS sa lisibilité : tant que l'identité machine n'est pas rétablie, le refus codé (R3.6) demeure et la récupération reste BLOQUÉE (voir Phase 0).
4. **La reprise automatique n'est promise que sur preuve, jamais sur absence de preuve.** Machine-id rétabli ET rows du registre attribuables à cette même machine (qualification PAR ROW, Commande 2.2) ; toute row non attribuable reste `foreign-frame` BLOQUANTE (R1) et sort par l'exception de la Phase 3.

## Fichiers exacts (chemins complets)

| Rôle | Chemin |
|---|---|
| Socket du host natif | `$XDG_RUNTIME_DIR/h2a-nt/native-terminal.sock` (ex. `/run/user/1000/h2a-nt/native-terminal.sock`) |
| Sidecar propriétaire `.owner` | `$XDG_RUNTIME_DIR/h2a-nt/native-terminal.sock.owner` (JSON `{ dev, ino, pid, startTime, bootId, pidNamespace }`) |
| Lock-id de publication | `$XDG_RUNTIME_DIR/h2a-nt/.h2a-native-terminal.lock-id` |
| Registre durable des sessions | `~/.config/sentropic/h2a/registry.json` (rows `native-terminal-pty:<session>` portant `pgidBootId`, `pgidPidNamespace`, `pgidMachineId`) |

## Phase 0 — Prérequis : identité machine valide ET lisible (machine-id durablement illisible)

Le refus codé observé au démarrage (startupError, sortie non-zéro, message pointant vers ce runbook) demeure tant que le machine-id n'est pas rétabli. L'archivage des fichiers de runtime ne change RIEN à la lisibilité du machine-id.

**Commande 0.1** — lecture du machine-id :

```bash
cat /etc/machine-id
```

Effet attendu : 32 hexadécimales minuscules non nuls, conformes à `/^[0-9a-f]{32}$/` (jamais `000…0`, jamais vide). Aucune écriture, aucun host requis.

**Commande 0.2** — validation du format :

```bash
[[ "$(cat /etc/machine-id)" =~ ^[0-9a-f]{32}$ ]] && [[ "$(cat /etc/machine-id)" != "00000000000000000000000000000000" ]] && echo machine-id-conforme || echo machine-id-NON-conforme
```

Effet attendu : `machine-id-conforme` → continuer en Phase 1. `machine-id-NON-conforme` → la récupération reste BLOQUÉE tant que l'identité n'est pas rétablie ; ne PAS archiver avant d'avoir lu la suite.

**Commande 0.3** — rétablissement (uniquement si NON conforme ; nécessite root) :

```bash
sudo systemd-machine-id-setup && sudo reboot
```

Effet attendu : `/etc/machine-id` est réécrit avec un identifiant conforme `/^[0-9a-f]{32}$/` non nul, puis la machine redémarre. Après redémarrage, relire la Commande 0.2 : `machine-id-conforme`.

### Les issues de la Phase 0 (distinctes, sans ambiguïté)

La reprise automatique n'est PAS la conséquence du seul rétablissement du machine-id : elle exige AUSSI que les rows du registre soient attribuables à cette même machine (qualification PAR ROW, Commande 2.2 — un comptage global ne qualifie rien : une seule row ancrée masquerait N rows sans ancre).

- **Issue 1 — machine-id rétabli (conforme ET lisible) et rows attribuables à cette même machine (Commande 2.2 : `rows-attribuables:N`)** → **reprise automatique par R3** au prochain démarrage du host : la migration automatique re-estampille le sidecar et reprend sur les rows du boot précédent de la même machine ; AUCUNE intervention manuelle sur les fichiers n'est requise ; l'archivage des Phases 1-3 devient inutile.
- **Issue 2 — machine-id rétabli mais rows non attribuables (Commande 2.2 : `rows-non-attribuables:K/N`, ou `registre-illisible`)** → ces K rows (sans ancre machine — pré-0.98.2, ou écrites sous machine-id illisible — ou d'une AUTRE machine, registre `$HOME` partagé, ou anchor malformé : R1 ordre 0) restent `foreign-frame` BLOQUANTES (R1, asymétrie sidecar/row) : la reprise automatique est REFUSÉE. Un registre illisible (`registre-illisible`) ne peut qualifier aucune row : la reprise automatique y est refusée de la même façon (l'illisibilité n'est pas une preuve d'absence). Exception : archivage du registre (Phase 3, Commande 3.3), puis démarrage à froid.
- **Issue 3 — machine-id NON rétabli (illisible durablement)** → **la récupération reste BLOQUÉE**, même après archivage : le refus codé (R3.6) s'applique à chaque décision de publication, et le message de refus le dit explicitement. Il n'existe AUCUNE commande de contournement dans ce runbook ; la seule issue est le rétablissement de l'identité machine (Commande 0.3), le cas échéant avec l'aide de l'owner.

## Phase 1 — Préconditions de sûreté

**Commande 1.1** — aucun host ne tourne :

```bash
ps -eo pid,args | grep -F 'native-terminal/process.js' | grep -Fv grep || echo aucun-host
```

Effet attendu : `aucun-host`. Si un host vivant apparaît, NE PAS archiver : un host vivant doit être arrêté normalement (via son client/CLI), jamais par une manipulation de fichiers sous ses pieds.

**Commande 1.2** — sidecar/rows attribuables (constat, pas de décision) :

```bash
cat "$XDG_RUNTIME_DIR/h2a-nt/native-terminal.sock.owner" 2>/dev/null || echo sidecar-absent
```

Effet attendu : le JSON du sidecar s'affiche (champs `bootId`, `pidNamespace`, et `machineId` depuis 0.98.5), ou `sidecar-absent` (cold path : la reprise se fait par les rows du registre, cf. R3.2).

## Phase 2 — Constat des fichiers exacts

**Commande 2.1** — inventaire du répertoire de runtime :

```bash
ls -la "$XDG_RUNTIME_DIR/h2a-nt/" 2>/dev/null || echo runtime-dir-absent
```

Effet attendu : l'inventaire liste, selon le cas : `native-terminal.sock`, `native-terminal.sock.owner`, `.h2a-native-terminal.lock-id` ; ou `runtime-dir-absent` (répertoire déjà vide après reboot — tmpfs).

**Commande 2.2** — qualification PAR ROW des rows du registre contre le machine-id local :

```bash
node -e 'const fs=require("node:fs");let m="";try{m=fs.readFileSync("/etc/machine-id","utf8").trim()}catch{};let out="machine-id-non-conforme";if(/^[0-9a-f]{32}$/.test(m)&&!/^0+$/.test(m)){let raw=null;try{raw=fs.readFileSync(process.env.HOME+"/.config/sentropic/h2a/registry.json","utf8")}catch(e){out=(e&&e.code==="ENOENT")?"registre-absent":"registre-illisible"}if(raw!==null){let rows=null;try{const r=JSON.parse(raw);if(Array.isArray(r.entries))rows=r.entries}catch{};if(rows===null){out="registre-illisible"}else{const B=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;const ok=rows.filter((e)=>e&&typeof e.pgidMachineId==="string"&&e.pgidMachineId===m&&B.test(String(e.pgidBootId))&&/^\d+$/.test(String(e.pgidPidNamespace)));out=ok.length===rows.length?"rows-attribuables:"+rows.length:"rows-non-attribuables:"+(rows.length-ok.length)+"/"+rows.length}}}console.log(out)'
```

Effet attendu : `machine-id-non-conforme` → identité machine non rétablie : la récupération reste BLOQUÉE (Issue 3, Phase 0) ; cette commande ne qualifie rien tant que le machine-id n'est pas conforme ET lisible. `registre-absent` → le fichier de registre n'existe pas (ENOENT) : c'est le SEUL cas « pas de rows » (cold path, R3.2) ; un registre absent ne bloque pas. `registre-illisible` → le registre EXISTE mais ne peut pas être lu (JSON corrompu, forme invalide, erreur de lecture hors ENOENT) : ce n'est PAS le cold path — l'illisibilité n'est pas une preuve d'absence, aucune row ne peut être qualifiée, aucune reprise automatique ne peut être promise sur ce constat ; exception Phase 3 (Commande 3.3 : archivage du registre), puis démarrage à froid. `rows-attribuables:N` → CHAQUE row porte les TROIS anchors R1 valides : `pgidMachineId` ÉGAL au machine-id local, `pgidBootId` conforme à l'UUID du store (`^[0-9a-f]{8}-…-[0-9a-f]{12}$`), `pgidPidNamespace` numérique (`^\d+$`) — qualification row par row, jamais un comptage global ; si le machine-id est rétabli, la reprise automatique (Issue 1) est possible. `rows-non-attribuables:K/N` → K rows échouent à AU MOINS un anchor (sans ancre machine — pré-0.98.2 ou machine-id illisible à l'écriture, machine différente, bootId malformé, pidNamespace malformé) : ces rows sont `foreign-frame` BLOQUANTES (R1, ordre 0 pour tout anchor malformé) — Issue 2, exception Phase 3. Un bootId malformé ne compte JAMAIS comme attribuable : R1 ordre 0 le classe `foreign-frame` avant toute comparaison.

## Phase 3 — Archivage horodaté (renommage même système de fichiers, jamais suppression)

**Commande 3.1** — suffixe d'archive horodaté :

```bash
stamp="$(date +%Y%m%dT%H%M%S)" && echo "suffixe d'archive: .h2a-recovery-$stamp"
```

Effet attendu : un suffixe horodaté imprimé, réutilisé par les commandes suivantes ; deux exécutions ne s'écrasent jamais. Aucun fichier n'est détruit ni écrasé ; chaque archive est restaurable par renommage inverse.

**Commande 3.2** — archivage du répertoire de runtime (socket + sidecar + lock-id), par renommage DANS son propre système de fichiers :

```bash
mv "$XDG_RUNTIME_DIR/h2a-nt" "$XDG_RUNTIME_DIR/h2a-nt.h2a-recovery-$stamp" && echo "archivé (renommage même système de fichiers): socket + .owner + lock-id"
```

Effet attendu : le répertoire `h2a-nt` (socket `native-terminal.sock`, sidecar `native-terminal.sock.owner`, lock-id `.h2a-native-terminal.lock-id`) est renommé EN PLACE sous `$XDG_RUNTIME_DIR` — même système de fichiers, `dev`/`ino` préservés ; plus aucun fichier de runtime n'existe sous le nom d'origine. Ne JAMAIS viser `$HOME` ici : le `mv` inter-systèmes copie puis efface la source.

**Commande 3.3** — archivage du registre (uniquement si la Commande 2.2 a répondu `rows-non-attribuables:K/N` ou `registre-illisible`), par renommage dans son propre répertoire :

```bash
mv "$HOME/.config/sentropic/h2a/registry.json" "$HOME/.config/sentropic/h2a/registry.json.h2a-recovery-$stamp" && echo "archivé: registre non attribuable"
```

Effet attendu : le registre est renommé dans son propre répertoire (même système de fichiers, `dev`/`ino` préservés) ; le prochain démarrage recrée un registre vide. Ne PAS archiver un registre dont TOUTES les rows sont attribuables (`rows-attribuables:N`) : la migration automatique (R3) en fait la preuve alternative de reprise, l'archiver détruirait des sessions réactivables.

## Phase 4 — Vérification post-récupération des versions chargées

**Commande 4.1** — chemin du runtime chargé, ancré au préfixe d'installation EFFECTIVEMENT utilisé (celui du binaire `h2a` résolu par le PATH) :

```bash
cd "$(dirname "$(command -v h2a)")/../lib/node_modules/@sentropic/h2a" && node -p "require.resolve('@sentropic/h2a-runtime/package.json')"
```

Effet attendu : un chemin SOUS le préfixe du `h2a` réellement installé (ex. `…/.npm-global/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/h2a-runtime/package.json`) — le préfixe effectivement utilisé, pas un chemin d'exemple. `command -v h2a` localise le binaire sans l'exécuter ; aucun host requis.

**Commande 4.2** — version chargée (même préfixe effectif) :

```bash
cd "$(dirname "$(command -v h2a)")/../lib/node_modules/@sentropic/h2a" && node -p "require(require.resolve('@sentropic/h2a-runtime/package.json')).version"
```

Effet attendu : `0.98.5` (toute version 0.98.1 à 0.98.4 est une version briquée ou bannie : NE PAS relancer le host avec, voir la section Déprecation ci-dessous).

**Commande 4.3** — répertoire de runtime propre :

```bash
ls "$XDG_RUNTIME_DIR/h2a-nt" 2>/dev/null || echo "runtime-dir-absent: prêt pour un démarrage propre"
```

Effet attendu : `runtime-dir-absent: prêt pour un démarrage propre` après la Phase 3 ; au démarrage suivant, le host 0.98.5 recrée le répertoire et publie son socket. Si la Phase 0 a conclu « Issue 1 » (machine-id rétabli ET rows attribuables), la reprise est automatique (R3) et aucune de ces commandes n'était nécessaire.

## Déprecation des versions publiées (R9) — commandes PRÉPARÉES, exécution APRÈS validation de 0.98.5

Ces trois commandes sont préparées ici et ne sont exécutées qu'APRÈS la validation complète de 0.98.5 (jamais avant : déprécier sans remplaçant validé laisserait le parc sans issue). Plage pinnée par la spec : `>=0.98.1 <=0.98.4` sur les TROIS paquets lockstep. `@sentropic/track` n'est PAS déprécié.

**Commande D.1** — déprecation de `@sentropic/h2a` :

```bash
npm deprecate '@sentropic/h2a@>=0.98.1 <=0.98.4' 'native host refuses to start after a reboot (0.98.2-0.98.4); 0.98.1 is banned for a separate defect; upgrade to 0.98.5 — see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md'
```

Effet attendu : toute installation/résolution dans la plage `>=0.98.1 <=0.98.4` affiche l'avertissement de déprecation sur le registre npm. À exécuter uniquement après validation de 0.98.5 ; réversible par `npm deprecate` avec un message vide.

**Commande D.2** — déprecation de `@sentropic/h2a-runtime` :

```bash
npm deprecate '@sentropic/h2a-runtime@>=0.98.1 <=0.98.4' 'native host refuses to start after a reboot (0.98.2-0.98.4); 0.98.1 is banned for a separate defect; upgrade to 0.98.5 — see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md'
```

Effet attendu : idem pour le paquet runtime ; aucune écriture locale, aucun host requis.

**Commande D.3** — déprecation de `@sentropic/h2a-cli` :

```bash
npm deprecate '@sentropic/h2a-cli@>=0.98.1 <=0.98.4' 'native host refuses to start after a reboot (0.98.2-0.98.4); 0.98.1 is banned for a separate defect; upgrade to 0.98.5 — see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md'
```

Effet attendu : idem pour le paquet CLI ; aucune écriture locale, aucun host requis.

### Le défaut distinct de la version 0.98.1

0.98.1 figure dans la même plage de déprecation, mais PAS pour la brique post-reboot : celle-ci couvre 0.98.2 → 0.98.4 (inversion `proveEndpointAbsentUnderLock`, SPEC 0.98.5 §1.1). 0.98.1 est bannie pour un défaut DISTINCT : la fuite du journal-writer IPC du host natif — quand la déconnexion IPC précède l'initialisation du module du writer, celui-ci installe son écoute pour une déconnexion déjà consommée et son thread d'E/S retient le processus indéfiniment (constat sur pièces : `docs/reviews/native-journal-shutdown-ci.md`, corrigé en 0.98.2 par la PR #317 — qui n'adressait NI l'inversion post-reboot NI le crash-loop, SPEC 0.98.5 §1.3). Aucune version 0.98.1 à 0.98.4 ne doit resservir ; `@sentropic/track` reste hors de cause et non déprécié.
