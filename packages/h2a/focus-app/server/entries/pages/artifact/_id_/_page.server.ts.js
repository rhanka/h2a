import { t as error } from "../../../../chunks/exports.js";
import { t as readArtifactReviewPageConfig } from "../../../../chunks/page-config.js";
// src/lib/review/focus-fixture.js
/**
* @typedef {{
*   id: string,
*   targetRef: string,
*   label: string,
*   body: string,
*   consequence: string
* }} FocusFixtureOption
*/
/**
* @typedef {(
*   | { kind: 'prose', id: string, targetRef: string, heading: string, body: string }
*   | { kind: 'question', id: string, targetRef: string, code: string, question: string, context: string, recommendedAnswer?: string }
*   | { kind: 'optionSet', id: string, targetRef: string, questionId: string, title: string, options: FocusFixtureOption[] }
*   | { kind: 'decision', id: string, targetRef: string, modality: string, statement: string }
*   | { kind: 'trace', id: string, targetRef: string, title: string, steps: { label: string, detail: string }[] }
* )} FocusFixtureSection
*/
/**
* @typedef {{
*   ref: string,
*   hash: string,
*   title: string,
*   subtitle: string,
*   sections: FocusFixtureSection[]
* }} FocusArtifactFixture
*/
/**
* Build a deterministic Focus artifact fixture for the requested artifact id.
*
* @param {string} artifactId
* @param {string} [revision]
* @returns {FocusArtifactFixture}
*/
function loadFocusArtifactFixture(artifactId, revision = "v1") {
	const safeId = artifactId.trim() || "focus:local-review-fixture";
	const isV2 = revision === "v2";
	/** @type {FocusFixtureSection[]} */
	const sections = [
		{
			kind: "prose",
			id: "sec-summary",
			targetRef: "section:summary",
			heading: "Contexte de revue locale",
			body: "Les commentaires passent uniquement par cluster-mesh via CommentsAdapter. Un résumé non-ASCII — recall budget — peut être sélectionné au caractère près et ancré en UTF-8."
		},
		{
			kind: "question",
			id: "q-storage",
			targetRef: "question:q-storage",
			code: "D1",
			question: "Quel chemin de stockage utiliser pour les fils de revue locale ?",
			context: "h2a et Focus Web restent de simples clients sans magasin parallèle.",
			recommendedAnswer: "Utiliser exclusivement l’API commentaires cluster-mesh (C2a–C2d)."
		},
		{
			kind: "optionSet",
			id: "opts-storage",
			targetRef: "option-set:q-storage",
			questionId: "q-storage",
			title: "Options pour D1",
			options: [{
				id: "opt-cluster-mesh",
				targetRef: "option:q-storage:cluster-mesh",
				label: "A — API cluster-mesh dédiée (C2b/C2c + MCP C2d)",
				body: "Pointe CommentsAdapter vers le routeur dédié cluster-mesh, état unique open|closed.",
				consequence: "Zéro magasin parallèle ; même contrat en local et en central."
			}, {
				id: "opt-strict-fail-closed",
				targetRef: "option:q-storage:fail-closed",
				label: "B — Échec fermé si liaison absente",
				body: "En l’absence de FOCUS_COMMENTS_URL, Focus Web affiche comments unavailable (missing binding).",
				consequence: "Aucune écriture silencieuse sur disque."
			}]
		},
		...isV2 ? [] : [{
			kind: "decision",
			id: "dec-anchor",
			targetRef: "decision:d-anchor",
			modality: "decision",
			statement: "Chaque bloc Focus porte un data-anchor-id unique égal à son targetRef."
		}],
		{
			kind: "trace",
			id: "trace-proof",
			targetRef: "trace:h1-wiring",
			title: "Chaîne de preuve H1",
			steps: [
				{
					label: "Mode lecture",
					detail: "Sélection, clics sur options et ordre Tab inchangés."
				},
				{
					label: "Mode revue",
					detail: "CommentLayer + ThreadPanel non-modal >=48rem, Drawer bottom <48rem."
				},
				{
					label: "Écriture agent",
					detail: "provenance.toolCallId obligatoire et affichage deux icônes agent/owner."
				}
			]
		}
	];
	return {
		ref: safeId,
		hash: isV2 ? "sha256:focus-fixture-v2" : "sha256:focus-fixture-v1",
		title: "Dossier Focus — Mode revue locale (H1)",
		subtitle: "Fixture Focus Web câblée sur @sentropic/design-system-review-core 0.1.0 et @sentropic/design-system-svelte 0.43.0.",
		sections
	};
}
// src/routes/artifact/[id]/+page.server.ts
var load = ({ params, url }) => {
	const artifactReview = readArtifactReviewPageConfig(process.env, url);
	if (!artifactReview.enabled) throw error(404, "Artifact review is disabled; start Focus Web with FOCUS_ARTIFACT_REVIEW=1.");
	const revision = url.searchParams.get("revision") ?? "v1";
	return {
		artifact: loadFocusArtifactFixture(params.id, revision),
		artifactReview
	};
};
export { load };

//# sourceMappingURL=_page.server.ts.js.map