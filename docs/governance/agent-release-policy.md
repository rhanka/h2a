# Policy agent — release

Décision owner durable, à respecter par toute session (h-cond et pairs). Ne pas re-demander.

## Release : bump DANS la PR feature quand la version est déjà décidée
Quand le numéro de version cible est déjà décidé, le bump de version (`release: vX.Y.Z`, lockstep via `scripts/release.mjs`) va **dans la PR de la feature elle-même** — **une seule PR**, pas une PR release séparée.

- Ne PAS scinder feature + release en deux PR quand la version est connue d'avance.
- La séparation en deux PR (feature mergée, puis PR release) n'est PAS la policy du repo ; elle n'est acceptable que si la feature a déjà été mergée avant que la version soit décidée (cas dégradé).
- Flux nominal : brancher la feature → à la fin, `node scripts/release.mjs --version X.Y.Z` sur la même branche (bump + commit `release: vX.Y.Z`) → une PR → merge → tag `vX.Y.Z` sur le sha mergé → publish.
