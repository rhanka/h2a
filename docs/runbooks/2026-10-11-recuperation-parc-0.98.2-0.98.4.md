# Runbook de récupération — parc h2a 0.98.2 → 0.98.4 (host natif refusé après reboot)

- **Date** : 2026-10-11
- **Référence** : SPEC 0.98.5, R9 (et R3.6 pour le refus codé machine-id illisible).
- **Périmètre** : postes où le host natif d'une version 0.98.2 à 0.98.4 refuse de démarrer après un hard reboot, ou reste bloqué sur un refus codé. Ce runbook est le filet des cas que la migration automatique (R3) ne couvre PAS en routine : machine-id durablement illisible, rows sans ancre machine (pré-0.98.2).

## Règles du runbook

1. **Aucune commande ci-dessous n'exige de host fonctionnel.** Toutes les commandes agissent sur des fichiers uniquement ; elles sont exécutables sur un poste où le host refuse de démarrer.
2. **On archive par renommage horodaté, on ne supprime jamais.** Aucune commande de ce runbook ne détruit un fichier : chaque fichier écarté est déplacé vers une archive horodatée, vérifiable et restaurable.
3. **Phase 0 avant tout.** Si le machine-id est durablement illisible, l'archivage ne rétablit PAS sa lisibilité : tant que l'identité machine n'est pas rétablie, le refus codé (R3.6) demeure et la récupération reste BLOQUÉE (voir Phase 0).

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

### Les deux issues de la Phase 0 (distinctes, sans ambiguïté)

- **Machine-id rétabli (conforme ET lisible)** → **reprise automatique par R3** au prochain démarrage du host : la migration automatique re-estampille le sidecar et reprend sur les rows du boot précédent de la même machine ; AUCUNE intervention manuelle sur les fichiers n'est requise ; l'archivage des Phases 1-3 devient inutile.
- **Machine-id NON rétabli (illisible durablement)** → **la récupération reste BLOQUÉE**, même après archivage : le refus codé (R3.6) s'applique à chaque décision de publication, et le message de refus le dit explicitement. Il n'existe AUCUNE commande de contournement dans ce runbook ; la seule issue est le rétablissement de l'identité machine (Commande 0.3), le cas échéant avec l'aide de l'owner.

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

**Commande 2.2** — rows d'ancre du registre :

```bash
grep -c 'pgidMachineId' "$HOME/.config/sentropic/h2a/registry.json" 2>/dev/null || echo registre-sans-ancre-machine
```

Effet attendu : un compte > 0 (rows attribuables, écrites depuis 0.98.2 avec machine-id lisible) ; `registre-sans-ancre-machine` signale le parc minoritaire pré-0.98.2 : ces rows sont `foreign-frame` bloquantes (R1), elles sortent par la Phase 3 ci-dessous, jamais par un affaiblissement de la preuve.

## Phase 3 — Archivage horodaté (renommage, jamais suppression)

**Commande 3.1** — répertoire d'archive horodaté :

```bash
stamp="$(date +%Y%m%dT%H%M%S)" && mkdir -p "$HOME/h2a-recovery-$stamp" && echo "archive: $HOME/h2a-recovery-$stamp"
```

Effet attendu : un répertoire d'archive vide, horodaté, sous `$HOME`. Aucun fichier n'y est détruit ni écrasé ; l'archive est restaurable par un simple renommage inverse.

**Commande 3.2** — archivage du répertoire de runtime (socket + sidecar + lock-id) :

```bash
mv "$XDG_RUNTIME_DIR/h2a-nt" "$HOME/h2a-recovery-$stamp/h2a-nt" && echo "archivé: socket + .owner + lock-id"
```

Effet attendu : le répertoire `h2a-nt` (socket `native-terminal.sock`, sidecar `native-terminal.sock.owner`, lock-id `.h2a-native-terminal.lock-id`) est déplacé INTÉGRALEMENT vers l'archive ; plus aucun fichier de runtime n'existe sous `$XDG_RUNTIME_DIR`. Renommage uniquement : rien n'est supprimé.

**Commande 3.3** — archivage du registre (uniquement si Commande 2.2 a répondu `registre-sans-ancre-machine`) :

```bash
mv "$HOME/.config/sentropic/h2a/registry.json" "$HOME/h2a-recovery-$stamp/registry.json" && echo "archivé: registre sans ancre machine"
```

Effet attendu : le registre est déplacé vers l'archive (renommage, pas de suppression). Le prochain démarrage recrée un registre vide. Ne PAS archiver un registre dont les rows portent `pgidMachineId` : la migration automatique (R3) en fait la preuve alternative de reprise, l'archiver détruirait des sessions réactivables.

## Phase 4 — Vérification post-récupération des versions chargées

**Commande 4.1** — chemin du runtime chargé (exemple pour l'installation globale npm) :

```bash
node -p "require.resolve('@sentropic/h2a-runtime/package.json')"
```

Effet attendu : un chemin dans le préfixe d'installation effectivement utilisé (ex. `/home/<user>/.npm-global/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/h2a-runtime/package.json`). Sans host : simple résolution de module.

**Commande 4.2** — version chargée :

```bash
node -p "require(require.resolve('@sentropic/h2a-runtime/package.json')).version"
```

Effet attendu : `0.98.5` (toute version 0.98.1 à 0.98.4 est une version briquée ou bannie : NE PAS relancer le host avec, voir la spec R9 — deprecation en cours).

**Commande 4.3** — répertoire de runtime propre :

```bash
ls "$XDG_RUNTIME_DIR/h2a-nt" 2>/dev/null || echo "runtime-dir-absent: prêt pour un démarrage propre"
```

Effet attendu : `runtime-dir-absent: prêt pour un démarrage propre` après la Phase 3 ; au démarrage suivant, le host 0.98.5 recrée le répertoire et publie son socket. Si la Phase 0 a conclu « machine-id rétabli », la reprise est automatique (R3) et aucune de ces commandes n'était nécessaire.
