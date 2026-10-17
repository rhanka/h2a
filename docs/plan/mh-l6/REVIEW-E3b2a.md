---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: feat/0.98.7-mh-l6 E3b2a on 64cb946d0badc66de661c0010a04be13b7534651
target-diff-sha256: 3772d7c6674ce6b7d1034a2c229edae0d0f5b6aa6077af4800ad508641eb467b
observed-failure: Exact author model/effort unavailable; installed h2a dispatch and owner live mesh forbidden by confinement. No eligible peer dispatched.
---

Digest du diff binaire stagé avant ce dossier. Le [skill de revue](/home/antoinefa/.codex/plugins/cache/sentropic/h2a/0.98.6/skills/harness/review/SKILL.md) impose « Unknown author means no acceptable review ». L’acte de revue s’arrête à la sélection ; aucun consensus ni verdict fusionnable n’est revendiqué. L’implémentation autorisée continue.

Auto-inspection : suppression des restrictions npm os/cpu du paquet racine, sans retrait des refus H4 ; glibc <2.31 refusée avant préparation ; manifestes des deux plugins accordés à la version du vrai paquet, y compris avec une version de qualification distincte de la source. Le seam est rejeté dans le vrai tarball et un inventaire Git vide échoue. Les contrôles lexicaux, imports, exports et dist historiques restent présents.

Node 22.22.1 et 24.21.0 : 142 tests ciblés, 44 paires rouge assertion/vert restauré par profil, zéro skip ni enfant restant. Audit exit 0 : 22 sources de référence, inventaire complet de 1 339 fichiers de code identiques et deux dist liés par SHA. Les probes SDK/PTY utilisent les helpers réellement installés puis copiés, sous le budget de démarrage du manifeste de 10 s après la préparation durable. L’essai d’optimisation asynchrone est retiré, ses mesures n’ayant pas démontré de gain.

Limites : la fixture npm de profil requis ne constitue pas une exécution macOS/Windows ; CLI hors profil, smoke/backfills, bump final, B2/C2b/D/E2b3/E3c/F/M18 restent ouverts. Aucun test distant/OIDC, publication npm, gel natif .6 ou verdict release. Revue indépendante confiée au conducteur.
