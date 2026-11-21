# Cas 3 (design-system, revue Astra, pin 98060bd0a) — à ajouter à fix/focus-empty-paragraphs

- Départ : paragraphe text/plain "A\nB".
- Geste : Entrée juste après le retour à la ligne interne.
- Résultat : ["A\n", "B"] — aucun paragraphe vide.
- `applyParagraphChanges` appelle `assertParagraphText` (diff.ts:66) qui refuse "A\n" en `unsupported-paragraph-format` (codec.ts:58–66).
- Attendu : retours à la ligne en début ou fin de paragraphe text/plain représentables (ou règle explicite et stable), sans perte du brouillon ; préciser au DS si couvert, avec le SHA.
