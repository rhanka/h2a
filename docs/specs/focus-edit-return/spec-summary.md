Résumé — édition Focus sur place (Tiptap) + retour IA en diff par paragraphe (item 01M58NV0RBPTDA5R87BH5PAJRV, WP20). Statut : proposition, non ratifiée.
But livré en premier : `focus build` étendu → édition sur place hors ligne → un seul retour structuré (réponses + notes + diff) → agent producteur → reçu.
Portage : h2a/Focus = contrat, identités de paragraphes, manifeste, réconciliation pure ; design system = composant Tiptap réutilisable (proposition D10, à ratifier).
Le kit `focus build` est le premier hôte hors connexion ; sentropic apporte le capital Tiptap et reste consommateur ; Track ne journalise que les amendements instruits.
Identités : `paragraphId` opaques persistants dans un manifeste versionné porté avec la source ; jamais un index, un libellé traduit ou une position DOM.
Diff : `before`/`after` exacts par paragraphe (`null` = absent), split/merge/move explicites, lot atomique, JSON de référence et YAML équivalent, copie sans perte.
Concurrence : `doc.hash` actuel insuffisant ; nouveau `baseHash` canonique + hash du manifeste ; relecture et contrôle des préconditions, conflit = zéro application.
États distincts : exporté / livré / traité / appliqué / enregistré Track ; reçu par transaction ; aucun événement Track automatique depuis le fichier portable.
Langue : catalogues fournis par l'hôte, embarqués, langue de chaque utilisateur, rien en dur ; le texte source garde sa langue, les IDs ne changent pas.
Lots FE-0 à FE-9 (tests RED écrits et observés en échec d'abord, fichiers exacts par dépôt) ; premier incrément = FE-3+FE-4+FE-5, gardé par FE-8, recette FE-9.
Cas Influnified : fixture synthétique conforme d'abord, copie qualifiée ensuite (pas de `readability`, métadonnées manquantes) ; aucun contournement de gate.
Non couvert : édition tableaux/diagrammes, collaboratif/CRDT, seuils de performance chiffrés ratifiés, nouveau kind Track, hôte MCP `ui://`, sync multi-machine.
Questions ouvertes Q1–Q4 laissées ouvertes : force d'une correction, périmètre éditable vs preuves, arbitrage des divergences, reprise sans le producteur initial.
