# SPEC EVOL — administration des comptes llm-mesh depuis H2A

Date : 2026-08-20

Base : `origin/main@04537de10ce9e0a3de6a39abcc3cc453ebcbbca4`

## Problème

La migration `0.94.0` a correctement supprimé le registre de comptes H2A,
mais elle n'a exposé que `h2a llm-mesh account enroll`. L'utilisateur ne peut
donc ni voir les comptes réellement possédés par llm-mesh, ni en retirer un.
La spec précédente et son test d'acceptation ont même verrouillé cette omission
en déclarant `enroll` comme unique surface.

## Contrat CLI

```text
h2a llm-mesh account enroll <cloud-code|codex>
h2a llm-mesh account list [--json]
h2a llm-mesh account ls [--json]
h2a llm-mesh account remove <account-id>
h2a llm-mesh account rm <account-id>
h2a llm-mesh account unenroll <account-id>
```

`list` et `remove` sont les noms canoniques ; `ls`, `rm` et `unenroll` sont des
alias stricts. L'ancien namespace `h2a account` reste inexistant.

## Frontière de responsabilité

H2A délègue exclusivement à la façade publique `@sentropic/llm-mesh` :

- l'inventaire est filtré par le `ownerScope` local déjà utilisé à
  l'enrollment et à l'acquisition ;
- seules les métadonnées publiques sont retournées : identifiant, transport,
  libellé, statut et dates ;
- la suppression vérifie le même `ownerScope`, retire l'entrée et ses secrets
  de manière cohérente, puis rend le compte immédiatement inacquérable ;
- un compte absent ou appartenant à un autre owner échoue sans divulguer
  l'existence d'un compte tiers.

H2A ne lit jamais l'index, les fichiers chiffrés, les credential envelopes ou
les tokens. Il ne recrée aucun registre, quota, binding ou fallback legacy.

## Sorties

- `list --json` émet un tableau JSON de métadonnées publiques.
- `list` émet les colonnes `ID`, `PROVIDER`, `LABEL`, `STATUS`, `ENROLLED`.
- une liste vide réussit et indique qu'aucun compte n'est enrôlé.
- `remove` confirme uniquement l'identifiant supprimé ; toute erreur sort en
  code non nul et ne contient aucun secret.

## Acceptance test-driven

1. Avant le code, les tests CLI échouent parce que `list/remove` sont inconnus.
2. Les tests unitaires avec façade injectée prouvent les appels owner-scoped et
   l'absence de données secrètes dans la projection.
3. Un test d'intégration avec keyring temporaire enrôle des fixtures, vérifie
   `list`, supprime un compte, vérifie sa disparition et son inéligibilité.
4. Les tests historiques prouvent que `h2a account` reste supprimé.
5. Build, typecheck, tests package et CI passent avant merge.

## Publication

La PR ne publie rien. Après merge, le tag de patch est créé sur le commit de
`main`; GitHub Actions reste l'unique publisher npm.
