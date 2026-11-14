import { a as derived, c as head, d as spread_props, f as stringify, g as clsx, h as attr, i as bind_props, n as attr_style, r as attributes, s as ensure_array_like, t as attr_class, y as escape_html } from "../../../../chunks/server2.js";
import "../../../../chunks/index-server.js";
import { a as Button, i as Card, n as Flex, o as Badge, r as Container, s as Alert, t as AppShell } from "../../../../chunks/AppShell.js";
// node_modules/@sentropic/design-system-svelte/dist/ProgressBar.svelte
function ProgressBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { label, helperText, value = 0, max = 100, indeterminate = false, tone = "neutral", size = "md", showValue = false, valueText, class: className, $$slots, $$events, ...rest } = $$props;
		const wrapperClasses = () => ["st-progressBar", className].filter(Boolean).join(" ");
		const trackClasses = () => [
			"st-progressBar__track",
			`st-progressBar__track--${size}`,
			`st-progressBar__track--${tone}`,
			indeterminate ? "st-progressBar__track--indeterminate" : null
		].filter(Boolean).join(" ");
		const clampedValue = () => {
			if (max <= 0) return 0;
			if (value < 0) return 0;
			if (value > max) return max;
			return value;
		};
		const percent = () => indeterminate ? 0 : clampedValue() / max * 100;
		const displayValue = () => {
			if (valueText) return valueText;
			if (indeterminate) return "";
			return `${Math.round(percent())}%`;
		};
		$$renderer.push(`<div${attributes({
			...rest,
			class: clsx(wrapperClasses())
		}, "svelte-1d165yb")}>`);
		if (label || showValue && !indeterminate) {
			$$renderer.push(`<!--[0--><div class="st-progressBar__header svelte-1d165yb">`);
			if (label) $$renderer.push(`<!--[0--><span class="st-progressBar__label svelte-1d165yb">${escape_html(label)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (showValue && !indeterminate) $$renderer.push(`<!--[0--><span class="st-progressBar__value svelte-1d165yb" aria-hidden="true">${escape_html(displayValue())}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div${attr_class(clsx(trackClasses()), "svelte-1d165yb")} role="progressbar"${attr("aria-valuemin", indeterminate ? void 0 : 0)}${attr("aria-valuemax", indeterminate ? void 0 : max)}${attr("aria-valuenow", indeterminate ? void 0 : clampedValue())}${attr("aria-valuetext", indeterminate ? void 0 : displayValue())}${attr("aria-label", label)}><div class="st-progressBar__fill svelte-1d165yb"${attr_style(`--st-progressBar-pct: ${stringify(percent())}%`)}></div></div> `);
		if (helperText) $$renderer.push(`<!--[0--><span class="st-progressBar__help svelte-1d165yb">${escape_html(helperText)}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/SlideIndicator.svelte
function SlideIndicator($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** Nombre total de diapositives. */
		/** Index de la diapositive courante (0-based). */
		/** Appelé avec l'index ciblé au clic ou au clavier. */
		/** Préfixe d'étiquette accessible de chaque point ("Diapositive 1"...). */
		let { count, current = 0, onChange, size = "md", variant = "dots", label = "Diapositive", class: className, $$slots, $$events, ...rest } = $$props;
		const classes = derived(() => [
			"st-slideIndicator",
			`st-slideIndicator--${size}`,
			`st-slideIndicator--${variant}`,
			className
		].filter(Boolean).join(" "));
		const items = derived(() => Array.from({ length: Math.max(0, count) }, (_, i) => i));
		$$renderer.push(`<div${attributes({
			...rest,
			class: clsx(classes()),
			role: "group",
			"aria-label": label
		}, "svelte-60hp0l")}><!--[-->`);
		const each_array = ensure_array_like(items());
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let index = each_array[$$index];
			$$renderer.push(`<button type="button"${attr_class("st-slideIndicator__dot svelte-60hp0l", void 0, { "st-slideIndicator__dot--current": index === current })}${attr("aria-current", index === current ? "true" : void 0)}${attr("aria-label", `${label} ${index + 1}`)}${attr("tabindex", index === current ? 0 : -1)}></button>`);
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Stack.svelte
function Stack($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { gap, align, justify, as = "div", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = derived(() => ["st-stack", className].filter(Boolean).join(" "));
		Flex($$renderer, spread_props([rest, {
			as,
			gap,
			align,
			justify,
			direction: "column",
			class: classes(),
			children: ($$renderer) => {
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		}]));
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Table.svelte
function Table($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { columns, rows, caption, class: className, $$slots, $$events, ...rest } = $$props;
		const classes = () => ["st-table", className].filter(Boolean).join(" ");
		const cellValue = (row, key) => String(row[key] ?? "");
		$$renderer.push(`<div class="st-table-wrap svelte-310erb"><table${attributes({
			...rest,
			class: clsx(classes())
		}, "svelte-310erb")}>`);
		if (caption) $$renderer.push(`<!--[0--><caption class="svelte-310erb">${escape_html(caption)}</caption>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--><thead><tr><!--[-->`);
		const each_array = ensure_array_like(columns);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let column = each_array[$$index];
			$$renderer.push(`<th scope="col"${attr_class("svelte-310erb", void 0, {
				"st-table__cell--right": column.align === "right",
				"st-table__cell--center": column.align === "center"
			})}>${escape_html(column.label)}</th>`);
		}
		$$renderer.push(`<!--]--></tr></thead><tbody class="svelte-310erb"><!--[-->`);
		const each_array_1 = ensure_array_like(rows);
		for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
			let row = each_array_1[$$index_2];
			$$renderer.push(`<tr class="svelte-310erb"><!--[-->`);
			const each_array_2 = ensure_array_like(columns);
			for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
				let column = each_array_2[$$index_1];
				$$renderer.push(`<td${attr_class("svelte-310erb", void 0, {
					"st-table__cell--right": column.align === "right",
					"st-table__cell--center": column.align === "center"
				})}>${escape_html(cellValue(row, column.key))}</td>`);
			}
			$$renderer.push(`<!--]--></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Textarea.svelte
function Textarea($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { label, helperText, errorText, invalid = false, value = "", class: className, $$slots, $$events, ...rest } = $$props;
		const fieldClasses = () => ["st-field", className].filter(Boolean).join(" ");
		const isInvalid = () => invalid || Boolean(errorText);
		$$renderer.push(`<div${attr_class(clsx(fieldClasses()), "svelte-zb6qyp")}><label class="st-field__control svelte-zb6qyp">`);
		if (label) $$renderer.push(`<!--[0--><span class="st-field__label svelte-zb6qyp">${escape_html(label)}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <textarea${attributes({
			...rest,
			class: "st-textarea",
			"aria-invalid": isInvalid() ? "true" : void 0
		}, "svelte-zb6qyp")}>`);
		const $$body = escape_html(value);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea></label> `);
		if (errorText) $$renderer.push(`<!--[0--><span class="st-field__error svelte-zb6qyp">${escape_html(errorText)}</span>`);
		else if (helperText) $$renderer.push(`<!--[1--><span class="st-field__help svelte-zb6qyp">${escape_html(helperText)}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
		bind_props($$props, { value });
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Tile.svelte
function Tile($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** `static` (présentation), `clickable` (lien/bouton), `selectable` (case unitaire). */
		/** Pour `clickable` : si fourni, rend un `<a>`, sinon un `<button>`. */
		/** Pour `selectable` : état coché (bindable). */
		/** Titre rapide (sinon utiliser le slot `children`). */
		/** Pour `selectable` : notifié au changement d'état. */
		let { variant = "static", href, selected = false, disabled = false, title, description, class: className, onclick, onselect, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-tile",
			`st-tile--${variant}`,
			variant === "selectable" && selected ? "st-tile--selected" : null,
			disabled ? "st-tile--disabled" : null,
			className
		].filter(Boolean).join(" ");
		function body($$renderer) {
			if (children) {
				$$renderer.push("<!--[0-->");
				children($$renderer);
				$$renderer.push(`<!---->`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (title) $$renderer.push(`<!--[0--><span class="st-tile__title svelte-1vcfi3">${escape_html(title)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (description) $$renderer.push(`<!--[0--><span class="st-tile__description svelte-1vcfi3">${escape_html(description)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]-->`);
		}
		if (variant === "clickable" && href) {
			$$renderer.push(`<!--[0--><a${attributes({
				...rest,
				class: clsx(classes()),
				href,
				"aria-disabled": disabled
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></a>`);
		} else if (variant === "clickable") {
			$$renderer.push(`<!--[1--><button${attributes({
				...rest,
				type: "button",
				class: clsx(classes()),
				disabled
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></button>`);
		} else if (variant === "selectable") {
			$$renderer.push(`<!--[2--><label${attr_class(clsx(classes()), "svelte-1vcfi3")}><input type="checkbox" class="st-tile__input svelte-1vcfi3"${attr("checked", selected, true)}${attr("disabled", disabled, true)}/> <span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></label>`);
		} else {
			$$renderer.push(`<!--[-1--><div${attributes({
				...rest,
				class: clsx(classes())
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></div>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { selected });
	});
}
/**
* Project a committed answer set onto the decisions of the CURRENT revision.
*
* Answers are revision-scoped: the committed set was captured against `agent-memory-2026-07-24`, the
* dossier is at `-25`. What carries over carries over; what does not is REPORTED by key, never dropped in
* silence. Both halves matter — answers that no longer land, and cards this set never covered.
*
* @param {{ revision: string, answers: Record<string, AnswerEntry> } | null | undefined} answerSet
* @param {DecisionShape[]} decisions
* @param {string} dossierRevision
* @returns {{ state: AnswerState, report: ReplayReport } | null} `null` when there is no set to project.
*/
function projectAnswerSet(answerSet, decisions, dossierRevision) {
	if (!answerSet || !answerSet.answers) return null;
	/** @type {Record<string, string>} */
	const selections = {};
	/** @type {Record<string, string>} */
	const notes = {};
	/** @type {string[]} */
	const applied = [];
	/** @type {string[]} */
	const missingDecisions = [];
	/** @type {string[]} */
	const staleOptions = [];
	for (const [key, entry] of Object.entries(answerSet.answers)) {
		const decision = decisions.find((candidate) => candidate.key === key);
		if (!decision) {
			missingDecisions.push(key);
			continue;
		}
		if (entry.option) {
			if (decision.options.some((option) => option.key === entry.option)) selections[key] = entry.option;
			else staleOptions.push(`${key} → ${entry.option}`);
		}
		if (typeof entry.note === "string" && entry.note.length > 0) notes[key] = entry.note;
		applied.push(key);
	}
	const unanswered = decisions.filter((decision) => {
		const entry = answerSet.answers[decision.key];
		return !entry || !entry.option && (entry.note ?? "").length === 0;
	}).map((decision) => decision.key);
	return {
		state: {
			selections,
			notes
		},
		report: {
			applied,
			missingDecisions,
			staleOptions,
			unanswered,
			revisionMismatch: answerSet.revision !== dossierRevision
		}
	};
}
/**
* The answers the reader currently holds, in the shape the h2a envelope and the JSON export both use.
* One builder, so what the CLI receives and what the clipboard yields can never drift apart.
*
* @param {AnswerState} state
* @param {DecisionShape[]} decisions
* @returns {{ decisionKey: string, optionKey: string | null, note: string }[]}
*/
function collectAnswers(state, decisions) {
	return decisions.map((decision) => ({
		decisionKey: decision.key,
		optionKey: state.selections[decision.key] ?? null,
		note: (state.notes[decision.key] ?? "").trim()
	}));
}
/**
* The subset worth transmitting: a decision with neither option nor note carries no information.
* @param {AnswerState} state
* @param {DecisionShape[]} decisions
*/
function collectAnsweredOnly(state, decisions) {
	return collectAnswers(state, decisions).filter((a) => a.optionKey || a.note.length > 0);
}
// src/routes/dossier/agent-memory/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		const dossier = derived(() => data.dossier);
		const matrix = derived(() => data.matrix);
		/** Jeu de réponses commité, chargé côté serveur. `null` si le fichier n'est pas atteignable. */
		const answerSet = derived(() => data.answerSet);
		/**
		* Le jeu commité projeté sur CETTE révision, calculé à l'initialisation — donc présent dès le rendu
		* serveur. C'est le correctif de fond : les réponses du propriétaire sont dans git, elles doivent
		* s'afficher à l'ouverture de l'URL, sur un navigateur neuf, sans aucun état local. Le localStorage
		* n'est plus qu'une couche de BROUILLON pour des modifications non commitées.
		*/
		const committed = projectAnswerSet(data.answerSet, data.dossier.decisions, data.dossier.revision);
		const decisionsTotal = derived(() => dossier().decisions.length);
		/**
		* L'état de l'art est la PREMIÈRE carte et ne porte aucune décision : on lit le paysage avant de
		* trancher quoi que ce soit. Le compteur ne doit donc jamais l'appeler « Décision 1 » — il y a
		* `decisionsTotal` décisions et `slidesTotal` cartes, et ce sont deux nombres différents.
		*/
		const slidesTotal = derived(() => decisionsTotal() + 1);
		const storageKey = derived(() => `focus:dossier-agent-memory:${dossier().revision}:choix`);
		const notesKey = derived(() => `focus:dossier-agent-memory:${dossier().revision}:notes`);
		let current = 0;
		let selections = { ...committed?.state.selections ?? {} };
		let notes = { ...committed?.state.notes ?? {} };
		let exportState = "idle";
		/**
		* Les décisions où le brouillon local CONTREDIT le jeu commité. Dérivé, donc toujours exact, y compris
		* après une modification. Tant que cette liste n'est pas vide, la page doit le dire : un brouillon
		* périmé qui masque silencieusement les réponses commitées, c'est la même perte qu'au départ.
		*/
		const divergences = derived(() => []);
		const divergentKeys = derived(() => new Set(divergences().map((d) => d.key)));
		const answerOrigin = derived(() => !committed ? "empty" : divergences().length > 0 ? "draft" : "committed");
		function previous() {
			current = Math.max(0, current - 1);
		}
		function next() {
			current = Math.min(slidesTotal() - 1, current + 1);
		}
		function selectOption(decisionKey, optionKey) {
			selections = {
				...selections,
				[decisionKey]: optionKey
			};
		}
		function setNote(decisionKey, value) {
			notes = {
				...notes,
				[decisionKey]: value
			};
			exportState = "idle";
		}
		/**
		* Le brouillon n'est écrit QUE si l'humain a modifié quelque chose (`dirty`). Sans cette garde, le simple
		* fait d'ouvrir la page recopiait le jeu commité dans le navigateur et faisait du localStorage une
		* seconde source de vérité — celle qui, en divergeant, finit par gagner en silence.
		*/
		/**
		* Trancher un écart en faveur du dépôt : on SUPPRIME le brouillon au lieu de le réécrire, pour que la
		* page retrouve exactement l'état d'un navigateur neuf. N'est proposé QUE lorsqu'un écart réel existe —
		* sans écart il n'y a pas de choix à faire, donc pas de bouton.
		*/
		function useCommitted() {
			if (!committed) return;
			selections = { ...committed.state.selections };
			notes = { ...committed.state.notes };
			exportState = "idle";
			try {
				window.localStorage.removeItem(storageKey());
				window.localStorage.removeItem(notesKey());
			} catch {}
		}
		/**
		* Mesure principale, pilotée par la réactivité Svelte. Elle couvre tout ce qui fait grandir la carte
		* active par changement d'état : alerte de transmission, rapport de rejeu, note qui s'allonge,
		* sélection d'une option. Vérifié en navigateur : sans ce chemin, l'alerte de transmission dépassait
		* la hauteur mesurée et se faisait rogner, car un ResizeObserver seul dépend d'une frame d'animation
		* (et n'en reçoit aucune dans un onglet en arrière-plan).
		*/
		/** Filet pour ce qui ne passe pas par l'état : redimensionnement de fenêtre, polices, poignée de resize. */
		/**
		* Les notes ne servent à rien si elles restent prisonnières du navigateur : cette
		* synthèse markdown les rend transmissibles (à une CLI, à Track, à un tiers). Elle
		* n'enregistre aucune décision — elle recopie ce que le lecteur a écrit.
		*/
		function buildSummary() {
			const lines = [
				`# ${dossier().title}`,
				"",
				`Révision : ${dossier().revision}`,
				""
			];
			for (const decision of dossier().decisions) {
				const selected = decision.options.find((option) => option.key === selections[decision.key]);
				const note = notes[decision.key]?.trim();
				lines.push(`## ${decision.key} — ${decision.question}`);
				lines.push(`- Option retenue : ${selected ? selected.title : "(aucune)"}`);
				lines.push(`- Note : ${note ? note : "(aucune)"}`);
				lines.push("");
			}
			return lines.join("\n");
		}
		async function copySummary() {
			try {
				await navigator.clipboard.writeText(buildSummary());
				exportState = "copied";
			} catch {
				exportState = "failed";
			}
		}
		/**
		* Même forme que le jeu de réponses commité : ce qui sort peut donc être rejoué tel quel, sans
		* édition à la main. C'est ce qui fait du dossier un scénario de recette et pas une capture d'écran.
		*/
		function buildAnswerSetJson() {
			const answers = {};
			for (const decision of dossier().decisions) answers[decision.key] = {
				option: selections[decision.key] ?? null,
				note: notes[decision.key]?.trim() ?? ""
			};
			return `${JSON.stringify({
				dossier: "agent-memory",
				revision: dossier().revision,
				capturedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
				capturedFrom: "focus, dossier /dossier/agent-memory",
				answers
			}, null, 2)}\n`;
		}
		async function copyAnswerSetJson() {
			try {
				await navigator.clipboard.writeText(buildAnswerSetJson());
				exportState = "copied-json";
			} catch {
				exportState = "failed";
			}
		}
		/**
		* Ce que le jeu commité donne sur CETTE révision : ce qui a été chargé, ce qui n'a pas pu l'être, et
		* les cartes AJOUTÉES depuis (D8–D13) qui attendent une réponse. C'est de l'information sur un état
		* déjà atteint, pas le compte rendu d'une action — il n'y a jamais eu de clic à faire pour l'obtenir.
		*/
		const committedReport = derived(() => committed ? committed.report : null);
		const revisionMismatch = derived(() => Boolean(answerSet()) && answerSet().revision !== dossier().revision);
		let including = null;
		let includeResult = {};
		let h2aTarget = data.h2a.target;
		let h2aLive = data.h2a.live;
		let h2aReason = data.h2a.reason;
		let h2aRemedy = data.h2a.remedy;
		let h2aAmbiguous = data.h2a.ambiguous;
		let showTargets = false;
		let refreshingTargets = false;
		async function refreshTargets() {
			refreshingTargets = true;
			try {
				const body = await (await fetch("/api/h2a/targets")).json();
				if (body?.ok) {
					h2aLive = body.live ?? [];
					h2aReason = body.reason;
					h2aRemedy = body.remedy ?? null;
					h2aAmbiguous = Boolean(body.ambiguous);
					if (!h2aTarget || !h2aLive.some((s) => s.instance === h2aTarget)) h2aTarget = body.target ?? null;
				}
			} catch {} finally {
				refreshingTargets = false;
			}
		}
		function chooseTarget(instance) {
			h2aTarget = instance;
			showTargets = false;
		}
		/** Il n'y a quelque chose à transmettre que si le lecteur a choisi une option OU écrit une note. */
		function hasSomethingToInclude(decisionKey) {
			return Boolean(selections[decisionKey] || notes[decisionKey]?.trim());
		}
		/**
		* Le presse-papier rend le choix transportable ; ceci le fait ARRIVER, et c'est le chemin par DÉFAUT.
		* La note part avec le choix : c'est elle qui porte le raisonnement, l'option n'en est que l'étiquette —
		* une transmission qui perd les notes a échoué même si toutes les options sont justes.
		*/
		async function includeChoice(decisionKey) {
			including = decisionKey;
			try {
				const res = await fetch("/api/dossiers/agent-memory/include", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						decisionKey,
						optionKey: selections[decisionKey] ?? null,
						note: notes[decisionKey] ?? "",
						target: h2aTarget
					})
				});
				includeResult = {
					...includeResult,
					[decisionKey]: await res.json()
				};
			} catch (e) {
				includeResult = {
					...includeResult,
					[decisionKey]: {
						ok: false,
						error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}`
					}
				};
			} finally {
				including = null;
			}
		}
		let sendingAll = false;
		let sendAllResult = null;
		/**
		* Tout le dossier en une fois, en UN envelope. Treize clics pour sortir un dossier, c'est exactement la
		* raison pour laquelle on finit par tout recopier à la main dans le presse-papier.
		*/
		async function sendAll() {
			sendingAll = true;
			sendAllResult = null;
			try {
				const answers = collectAnsweredOnly({
					selections,
					notes
				}, dossier().decisions);
				sendAllResult = await (await fetch("/api/dossiers/agent-memory/include", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						answers,
						target: h2aTarget
					})
				})).json();
			} catch (e) {
				sendAllResult = {
					ok: false,
					error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}`
				};
			} finally {
				sendingAll = false;
			}
		}
		const answeredCount = derived(() => dossier().decisions.filter((decision) => selections[decision.key] || notes[decision.key]?.trim()).length);
		head("e74176", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>${escape_html(dossier().title)}</title>`);
			});
		});
		{
			function main($$renderer) {
				Container($$renderer, {
					size: "md",
					padding: true,
					children: ($$renderer) => {
						$$renderer.push(`<main class="dossier svelte-e74176" aria-labelledby="dossier-title">`);
						Stack($$renderer, {
							gap: 4,
							children: ($$renderer) => {
								$$renderer.push(`<header>`);
								Stack($$renderer, {
									gap: 2,
									children: ($$renderer) => {
										Flex($$renderer, {
											align: "center",
											justify: "between",
											wrap: true,
											gap: 2,
											children: ($$renderer) => {
												Badge($$renderer, {
													tone: "info",
													children: ($$renderer) => {
														$$renderer.push(`<!---->Dossier décisionnel`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----> `);
												if (current === 0) {
													$$renderer.push("<!--[0-->");
													Badge($$renderer, {
														tone: "neutral",
														children: ($$renderer) => {
															$$renderer.push(`<!---->État de l’art — aucune décision`);
														},
														$$slots: { default: true }
													});
												} else {
													$$renderer.push("<!--[-1-->");
													Badge($$renderer, {
														tone: "neutral",
														children: ($$renderer) => {
															$$renderer.push(`<!---->Décision ${escape_html(current)} / ${escape_html(decisionsTotal())}`);
														},
														$$slots: { default: true }
													});
												}
												$$renderer.push(`<!--]-->`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----> <h1 id="dossier-title">${escape_html(dossier().title)}</h1> <p>${escape_html(dossier().context)}</p> `);
										ProgressBar($$renderer, {
											label: "Progression du dossier",
											value: current + 1,
											max: slidesTotal(),
											valueText: current === 0 ? "État de l’art" : `Décision ${current} / ${decisionsTotal()}`,
											showValue: true
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></header> `);
								Alert($$renderer, {
									tone: "info",
									title: "Support de décision neutre",
									message: "Ce dossier ne préconise aucune option. La première carte présente l'état de l'art, ne demande rien, et liste les corrections apportées à la révision précédente ; viennent ensuite les décisions, chacune avec ses alternatives, leur comportement, leur conséquence, les faits de mécanisme qui les éclairent avec leur source, et ce que la recherche n'a PAS pu établir. Le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Les cartes marquées « nouvelle carte » découlent de vos propres réponses du premier passage, citées verbatim. Vos réponses commitées sont chargées depuis le dépôt : « Transmettre à la CLI » les remet à une session h2a live du projet, le presse-papier reste disponible en repli."
								});
								$$renderer.push(`<!----> `);
								if (!answerSet()) {
									$$renderer.push("<!--[0-->");
									Alert($$renderer, {
										tone: "warning",
										title: "Jeu de réponses commité introuvable",
										message: "Le fichier docs/decisions/2026-07-25-agent-memory-owner-answers.json n'est pas atteignable depuis ce service. Rien n'a été inventé : le dossier s'ouvre vide, et vos réponses commitées ne sont pas perdues pour autant — elles sont dans le dépôt."
									});
								} else if (answerOrigin() === "committed") {
									$$renderer.push("<!--[1-->");
									Alert($$renderer, {
										tone: "info",
										title: `Réponses commitées chargées (${Object.keys(committed?.state.notes ?? {}).length} note(s), ${Object.keys(committed?.state.selections ?? {}).length} sélection(s))`,
										message: `Chargées côté serveur depuis ${answerSet().source} — aucun état de navigateur n'est nécessaire pour les voir. Vos modifications restent locales tant qu'elles ne sont pas commitées, et cette bannière vous dira si elles s'écartent du jeu commité.`
									});
								} else {
									$$renderer.push("<!--[-1-->");
									Alert($$renderer, {
										tone: "warning",
										title: `Brouillon local différent du jeu commité sur ${divergences().length} décision(s) : ${divergences().map((d) => d.key).join(", ")}`,
										message: "Ce qui est affiché ci-dessous est votre brouillon local (non commité). Le jeu commité dans le dépôt, lui, est intact. Le détail des écarts est plus bas, avec le retour au jeu commité en un clic."
									});
								}
								$$renderer.push(`<!--]--> <div class="swipe-viewport svelte-e74176" role="group" aria-label="Cartes du dossier : l’état de l’art puis les décisions. Faites glisser horizontalement ou utilisez les boutons."${attr_style(void 0)}><div class="swipe-track svelte-e74176"${attr_style(`transform: translateX(-${current * 100}%);`)}><section class="swipe-slide svelte-e74176"${attr("aria-hidden", current !== 0)}${attr("inert", current !== 0, true)}>`);
								Card($$renderer, {
									children: ($$renderer) => {
										Stack($$renderer, {
											gap: 4,
											children: ($$renderer) => {
												Flex($$renderer, {
													align: "center",
													justify: "between",
													wrap: true,
													gap: 2,
													children: ($$renderer) => {
														Badge($$renderer, {
															tone: "info",
															children: ($$renderer) => {
																$$renderer.push(`<!---->État de l’art`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!----> <span>Carte 1 sur ${escape_html(slidesTotal())} — aucune décision ici</span>`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----> `);
												Stack($$renderer, {
													gap: 2,
													children: ($$renderer) => {
														$$renderer.push(`<h2 id="matrix-title">Matrice de comparaison</h2> <p>Dix-neuf approches du benchmark, comparées sur le stockage, la récupération, la
                        réconciliation, le mode d’écriture, le partage multi-CLI, l’auto-hébergement/RAM, la
                        licence et l’adéquation à la cible (agent persistant, multi-CLI, local-first). Faites
                        défiler horizontalement pour voir toutes les colonnes.</p>`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----> <div class="matrix-scroll svelte-e74176" role="presentation">`);
												Table($$renderer, {
													caption: matrix().caption,
													columns: matrix().columns,
													rows: matrix().rows
												});
												$$renderer.push(`<!----></div> <p class="matrix-legend svelte-e74176">${escape_html(matrix().legend)}</p> `);
												if (dossier().corrections?.length) {
													$$renderer.push(`<!--[0--><section aria-labelledby="corrections-title">`);
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															$$renderer.push(`<h2 id="corrections-title">Corrections à la révision précédente (${escape_html(dossier().corrections.length)})</h2> <p>La recherche de mécanismes a démenti des affirmations que la révision <strong>${escape_html(dossier().previousRevision)}</strong> présentait comme des faits. Elles sont
                            listées ici, et les cellules concernées de la matrice ci-dessus ont été réécrites.</p> <ul class="corrections svelte-e74176"><!--[-->`);
															const each_array = ensure_array_like(dossier().corrections);
															for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
																let correction = each_array[$$index];
																$$renderer.push(`<li class="svelte-e74176">`);
																Stack($$renderer, {
																	gap: 1,
																	children: ($$renderer) => {
																		$$renderer.push(`<strong>${escape_html(correction.subject)}</strong> <p class="was-stated svelte-e74176"><em>Était affirmé :</em> ${escape_html(correction.wasStated)}</p> <p><strong>En réalité :</strong> ${escape_html(correction.actually)}</p> <p class="fact-source svelte-e74176">${escape_html(correction.source)}</p>`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!----></li>`);
															}
															$$renderer.push(`<!--]--></ul>`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!----></section>`);
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												Alert($$renderer, {
													tone: "info",
													title: "Rien à trancher sur cette carte",
													message: "Passez à la carte suivante pour entrer dans les décisions."
												});
												$$renderer.push(`<!---->`);
											},
											$$slots: { default: true }
										});
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></section> <!--[-->`);
								const each_array_1 = ensure_array_like(dossier().decisions);
								for (let index = 0, $$length = each_array_1.length; index < $$length; index++) {
									let decision = each_array_1[index];
									const slide = index + 1;
									$$renderer.push(`<section class="swipe-slide svelte-e74176"${attr("aria-hidden", current !== slide)}${attr("inert", current !== slide, true)}>`);
									Card($$renderer, {
										children: ($$renderer) => {
											Stack($$renderer, {
												gap: 4,
												children: ($$renderer) => {
													Flex($$renderer, {
														align: "center",
														justify: "between",
														wrap: true,
														gap: 2,
														children: ($$renderer) => {
															Flex($$renderer, {
																align: "center",
																wrap: true,
																gap: 2,
																children: ($$renderer) => {
																	Badge($$renderer, {
																		tone: "info",
																		children: ($$renderer) => {
																			$$renderer.push(`<!---->${escape_html(decision.key)}`);
																		},
																		$$slots: { default: true }
																	});
																	$$renderer.push(`<!----> `);
																	if (decision.addedInRevision) {
																		$$renderer.push("<!--[0-->");
																		Badge($$renderer, {
																			tone: "neutral",
																			size: "sm",
																			children: ($$renderer) => {
																				$$renderer.push(`<!---->Nouvelle carte (révision 2)`);
																			},
																			$$slots: { default: true }
																		});
																	} else $$renderer.push("<!--[-1-->");
																	$$renderer.push(`<!--]--> `);
																	if (divergentKeys().has(decision.key)) {
																		$$renderer.push("<!--[0-->");
																		Badge($$renderer, {
																			tone: "warning",
																			size: "sm",
																			children: ($$renderer) => {
																				$$renderer.push(`<!---->Brouillon ≠ jeu commité`);
																			},
																			$$slots: { default: true }
																		});
																	} else $$renderer.push("<!--[-1-->");
																	$$renderer.push(`<!--]-->`);
																},
																$$slots: { default: true }
															});
															$$renderer.push(`<!----> <span>Décision ${escape_html(slide)} sur ${escape_html(decisionsTotal())}</span>`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!----> `);
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															$$renderer.push(`<h2>${escape_html(decision.question)}</h2> <p>${escape_html(decision.whyNow)}</p>`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!----> `);
													if (decision.fromAnswer) {
														$$renderer.push(`<!--[0--><section class="from-answer svelte-e74176"${attr("aria-labelledby", `from-answer-${decision.key}`)}>`);
														Stack($$renderer, {
															gap: 1,
															children: ($$renderer) => {
																$$renderer.push(`<h3${attr("id", `from-answer-${decision.key}`)}>Découle de votre réponse${escape_html(decision.parent?.length ? ` à ${decision.parent.join(" et ")}` : "")}</h3> <blockquote class="svelte-e74176">${escape_html(decision.fromAnswer)}</blockquote>`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!----></section>`);
													} else $$renderer.push("<!--[-1-->");
													$$renderer.push(`<!--]--> <section${attr("aria-labelledby", `options-${decision.key}`)}>`);
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															$$renderer.push(`<h3${attr("id", `options-${decision.key}`)}>Alternatives</h3> <p>Aucune option n’est recommandée par défaut. La sélection est facultative.</p> `);
															Stack($$renderer, {
																gap: 2,
																children: ($$renderer) => {
																	$$renderer.push(`<!--[-->`);
																	const each_array_2 = ensure_array_like(decision.options);
																	for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
																		let option = each_array_2[$$index_1];
																		$$renderer.push(`<div role="presentation">`);
																		Tile($$renderer, {
																			variant: "selectable",
																			selected: selections[decision.key] === option.key,
																			onselect: () => selectOption(decision.key, option.key),
																			children: ($$renderer) => {
																				Stack($$renderer, {
																					gap: 2,
																					children: ($$renderer) => {
																						Flex($$renderer, {
																							align: "center",
																							justify: "between",
																							wrap: true,
																							gap: 2,
																							children: ($$renderer) => {
																								$$renderer.push(`<strong>${escape_html(option.title)}</strong> `);
																								if (option.recommended) {
																									$$renderer.push("<!--[0-->");
																									Badge($$renderer, {
																										tone: "success",
																										size: "sm",
																										children: ($$renderer) => {
																											$$renderer.push(`<!---->Recommandée`);
																										},
																										$$slots: { default: true }
																									});
																								} else $$renderer.push("<!--[-1-->");
																								$$renderer.push(`<!--]--> `);
																								if (selections[decision.key] === option.key) {
																									$$renderer.push("<!--[0-->");
																									Badge($$renderer, {
																										tone: "info",
																										size: "sm",
																										children: ($$renderer) => {
																											$$renderer.push(`<!---->Sélectionnée`);
																										},
																										$$slots: { default: true }
																									});
																								} else $$renderer.push("<!--[-1-->");
																								$$renderer.push(`<!--]-->`);
																							},
																							$$slots: { default: true }
																						});
																						$$renderer.push(`<!----> <p>${escape_html(option.behavior)}</p> <p><strong>Conséquence :</strong> ${escape_html(option.consequence)}</p>`);
																					},
																					$$slots: { default: true }
																				});
																			},
																			$$slots: { default: true }
																		});
																		$$renderer.push(`<!----></div>`);
																	}
																	$$renderer.push(`<!--]-->`);
																},
																$$slots: { default: true }
															});
															$$renderer.push(`<!---->`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!----></section> `);
													if (decision.mechanisms?.length) {
														$$renderer.push(`<!--[0--><section${attr("aria-labelledby", `mechanisms-${decision.key}`)}>`);
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																$$renderer.push(`<h3${attr("id", `mechanisms-${decision.key}`)}>Comment ça marche réellement (${escape_html(decision.mechanisms.length)})</h3> <ul class="mechanisms svelte-e74176"><!--[-->`);
																const each_array_3 = ensure_array_like(decision.mechanisms);
																for (let $$index_2 = 0, $$length = each_array_3.length; $$index_2 < $$length; $$index_2++) {
																	let mechanism = each_array_3[$$index_2];
																	$$renderer.push(`<li class="svelte-e74176">`);
																	Stack($$renderer, {
																		gap: 1,
																		children: ($$renderer) => {
																			Flex($$renderer, {
																				align: "center",
																				wrap: true,
																				gap: 2,
																				children: ($$renderer) => {
																					$$renderer.push(`<strong>${escape_html(mechanism.system)}</strong> `);
																					if (mechanism.status === "unverified") {
																						$$renderer.push("<!--[0-->");
																						Badge($$renderer, {
																							tone: "warning",
																							size: "sm",
																							children: ($$renderer) => {
																								$$renderer.push(`<!---->Non vérifié`);
																							},
																							$$slots: { default: true }
																						});
																					} else $$renderer.push("<!--[-1-->");
																					$$renderer.push(`<!--]-->`);
																				},
																				$$slots: { default: true }
																			});
																			$$renderer.push(`<!----> <p>${escape_html(mechanism.fact)}</p> <p class="fact-source svelte-e74176">${escape_html(mechanism.source)}</p>`);
																		},
																		$$slots: { default: true }
																	});
																	$$renderer.push(`<!----></li>`);
																}
																$$renderer.push(`<!--]--></ul>`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!----></section>`);
													} else $$renderer.push("<!--[-1-->");
													$$renderer.push(`<!--]--> `);
													if (decision.unknowns?.length) {
														$$renderer.push(`<!--[0--><section class="unknowns svelte-e74176"${attr("aria-labelledby", `unknowns-${decision.key}`)}>`);
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																Flex($$renderer, {
																	align: "center",
																	wrap: true,
																	gap: 2,
																	children: ($$renderer) => {
																		$$renderer.push(`<h3${attr("id", `unknowns-${decision.key}`)}>Ce que nous n’avons pas pu établir</h3> `);
																		Badge($$renderer, {
																			tone: "warning",
																			size: "sm",
																			children: ($$renderer) => {
																				$$renderer.push(`<!---->${escape_html(decision.unknowns.length)}`);
																			},
																			$$slots: { default: true }
																		});
																		$$renderer.push(`<!---->`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!----> <ul class="svelte-e74176"><!--[-->`);
																const each_array_4 = ensure_array_like(decision.unknowns);
																for (let unknownIndex = 0, $$length = each_array_4.length; unknownIndex < $$length; unknownIndex++) {
																	let unknown = each_array_4[unknownIndex];
																	$$renderer.push(`<li class="svelte-e74176">${escape_html(unknown)}</li>`);
																}
																$$renderer.push(`<!--]--></ul>`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!----></section>`);
													} else $$renderer.push("<!--[-1-->");
													$$renderer.push(`<!--]--> `);
													Alert($$renderer, {
														tone: "info",
														title: "Critère à trancher (neutre)",
														message: decision.recommendation
													});
													$$renderer.push(`<!----> <div class="note-field svelte-e74176" role="presentation">`);
													Textarea($$renderer, {
														label: "Votre note",
														helperText: "Pourquoi ce choix, ce qui manque, ce qu'il faut vérifier. Enregistrée dans votre navigateur au fil de la frappe.",
														rows: 4,
														value: notes[decision.key] ?? "",
														oninput: (event) => setNote(decision.key, event.currentTarget.value)
													});
													$$renderer.push(`<!----></div> `);
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															Flex($$renderer, {
																align: "center",
																justify: "between",
																wrap: true,
																gap: 2,
																children: ($$renderer) => {
																	$$renderer.push(`<span class="include-hint svelte-e74176">${escape_html(hasSomethingToInclude(decision.key) ? `Votre option et votre note partent ensemble${h2aTarget ? ` vers ${h2aTarget}` : ""}.` : "Sélectionnez une option ou écrivez une note pour pouvoir la transmettre.")}</span> `);
																	Button($$renderer, {
																		variant: "primary",
																		onclick: () => includeChoice(decision.key),
																		disabled: including === decision.key || !hasSomethingToInclude(decision.key),
																		children: ($$renderer) => {
																			$$renderer.push(`<!---->${escape_html(including === decision.key ? "Transmission…" : "Transmettre à la CLI (h2a)")}`);
																		},
																		$$slots: { default: true }
																	});
																	$$renderer.push(`<!---->`);
																},
																$$slots: { default: true }
															});
															$$renderer.push(`<!----> `);
															if (includeResult[decision.key]) {
																$$renderer.push("<!--[0-->");
																const result = includeResult[decision.key];
																if (result.ok && result.delivered) {
																	$$renderer.push("<!--[0-->");
																	Alert($$renderer, {
																		tone: "success",
																		title: `Transmis à ${result.target}`,
																		message: result.note ?? ""
																	});
																} else if (result.ok) {
																	$$renderer.push("<!--[1-->");
																	Alert($$renderer, {
																		tone: "warning",
																		title: "Non remis — et voici ce qui le permettrait",
																		message: result.note ?? ""
																	});
																} else {
																	$$renderer.push("<!--[-1-->");
																	Alert($$renderer, {
																		tone: "error",
																		title: "Échec de la transmission",
																		message: result.error ?? "Erreur inconnue."
																	});
																}
																$$renderer.push(`<!--]-->`);
															} else $$renderer.push("<!--[-1-->");
															$$renderer.push(`<!--]-->`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!----> `);
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															$$renderer.push(`<h3>Prochain travail</h3> <p>${escape_html(decision.nextWork)}</p>`);
														},
														$$slots: { default: true }
													});
													$$renderer.push(`<!---->`);
												},
												$$slots: { default: true }
											});
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----></section>`);
								}
								$$renderer.push(`<!--]--></div></div> `);
								Flex($$renderer, {
									align: "center",
									justify: "between",
									wrap: true,
									gap: 3,
									children: ($$renderer) => {
										Button($$renderer, {
											variant: "secondary",
											onclick: previous,
											disabled: current === 0,
											"aria-label": "Carte précédente",
											children: ($$renderer) => {
												$$renderer.push(`<!---->Précédente`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----> `);
										SlideIndicator($$renderer, {
											count: slidesTotal(),
											current,
											onChange: (index) => current = index,
											label: "Accéder à une carte",
											variant: "bars"
										});
										$$renderer.push(`<!----> `);
										Button($$renderer, {
											variant: "primary",
											onclick: next,
											disabled: current === slidesTotal() - 1,
											"aria-label": "Carte suivante",
											children: ($$renderer) => {
												$$renderer.push(`<!---->Suivante`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <section aria-labelledby="handoff-title">`);
								Stack($$renderer, {
									gap: 3,
									children: ($$renderer) => {
										$$renderer.push(`<h2 id="handoff-title">Transmettre vos réponses</h2> `);
										Stack($$renderer, {
											gap: 2,
											children: ($$renderer) => {
												Flex($$renderer, {
													align: "center",
													justify: "between",
													wrap: true,
													gap: 2,
													children: ($$renderer) => {
														$$renderer.push(`<span class="include-hint svelte-e74176">`);
														if (h2aTarget) {
															$$renderer.push(`<!--[0-->Destinataire : <strong>${escape_html(h2aTarget)}</strong> `);
															if (h2aReason === "workspace") $$renderer.push(`<!--[0-->(résolu sur le chemin du checkout)`);
															else if (h2aReason === "emitter") $$renderer.push(`<!--[1-->(la session qui sert ce focus)`);
															else if (h2aReason === "requested") $$renderer.push(`<!--[2-->(choisi par vous)`);
															else if (h2aReason === "configured") $$renderer.push(`<!--[3-->(épinglé par FOCUS_H2A_TARGET)`);
															else if (h2aReason === "sole") $$renderer.push(`<!--[4-->(seule session live)`);
															else if (h2aReason === "name") $$renderer.push(`<!--[5-->(résolu sur le nom de session)`);
															else $$renderer.push("<!--[-1-->");
															$$renderer.push(`<!--]-->`);
														} else $$renderer.push(`<!--[-1-->Aucun destinataire résolu pour l'instant.`);
														$$renderer.push(`<!--]--></span> `);
														Flex($$renderer, {
															align: "center",
															wrap: true,
															gap: 2,
															children: ($$renderer) => {
																Button($$renderer, {
																	variant: "secondary",
																	onclick: () => showTargets = !showTargets,
																	children: ($$renderer) => {
																		$$renderer.push(`<!---->${escape_html(showTargets ? "Masquer les sessions" : "Changer de destinataire")}`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!----> `);
																Button($$renderer, {
																	variant: "secondary",
																	onclick: refreshTargets,
																	disabled: refreshingTargets,
																	children: ($$renderer) => {
																		$$renderer.push(`<!---->${escape_html(refreshingTargets ? "Actualisation…" : "Actualiser")}`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!---->`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!---->`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----> `);
												if (!h2aTarget && h2aRemedy) {
													$$renderer.push("<!--[0-->");
													Alert($$renderer, {
														tone: "warning",
														title: "Rien à qui remettre — pour l'instant",
														message: h2aRemedy
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												if (h2aAmbiguous) {
													$$renderer.push("<!--[0-->");
													Alert($$renderer, {
														tone: "warning",
														title: "Plusieurs sessions live répondent pour ce dépôt",
														message: `Le destinataire retenu est ${h2aTarget}. Les autres sessions live de ce dépôt ne le recevront pas — si ce n'est pas la bonne, choisissez-la ci-dessus avant de transmettre. Les sessions peuvent vivre sur des racines h2a différentes, qui ne se voient pas entre elles.`
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												if (showTargets) {
													$$renderer.push("<!--[0-->");
													Stack($$renderer, {
														gap: 2,
														children: ($$renderer) => {
															if (h2aLive.length === 0) {
																$$renderer.push("<!--[0-->");
																Alert($$renderer, {
																	tone: "warning",
																	title: "Aucune session h2a live",
																	message: h2aRemedy ?? "Le registre ne contient aucune session live, pour aucun projet. Ouvrez une CLI h2a, puis « Actualiser »."
																});
															} else {
																$$renderer.push(`<!--[-1--><!--[-->`);
																const each_array_5 = ensure_array_like(h2aLive);
																for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
																	let session = each_array_5[$$index_5];
																	$$renderer.push(`<div role="presentation">`);
																	Tile($$renderer, {
																		variant: "selectable",
																		selected: h2aTarget === session.instance,
																		onselect: () => chooseTarget(session.instance),
																		children: ($$renderer) => {
																			Stack($$renderer, {
																				gap: 1,
																				children: ($$renderer) => {
																					Flex($$renderer, {
																						align: "center",
																						justify: "between",
																						wrap: true,
																						gap: 2,
																						children: ($$renderer) => {
																							$$renderer.push(`<strong>${escape_html(session.name ?? session.instance)}</strong> `);
																							if (session.matchesRepo) {
																								$$renderer.push("<!--[0-->");
																								Badge($$renderer, {
																									tone: "success",
																									size: "sm",
																									children: ($$renderer) => {
																										$$renderer.push(`<!---->Ce dépôt`);
																									},
																									$$slots: { default: true }
																								});
																							} else $$renderer.push("<!--[-1-->");
																							$$renderer.push(`<!--]-->`);
																						},
																						$$slots: { default: true }
																					});
																					$$renderer.push(`<!----> <p class="fact-source svelte-e74176">${escape_html(session.instance)}</p> `);
																					if (session.workspace) $$renderer.push(`<!--[0--><p class="fact-source svelte-e74176">${escape_html(session.workspace)}</p>`);
																					else $$renderer.push("<!--[-1-->");
																					$$renderer.push(`<!--]--> `);
																					if (session.root) $$renderer.push(`<!--[0--><p class="fact-source svelte-e74176">racine h2a : ${escape_html(session.root)}</p>`);
																					else $$renderer.push("<!--[-1-->");
																					$$renderer.push(`<!--]-->`);
																				},
																				$$slots: { default: true }
																			});
																		},
																		$$slots: { default: true }
																	});
																	$$renderer.push(`<!----></div>`);
																}
																$$renderer.push(`<!--]-->`);
															}
															$$renderer.push(`<!--]-->`);
														},
														$$slots: { default: true }
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												Flex($$renderer, {
													align: "center",
													justify: "between",
													wrap: true,
													gap: 2,
													children: ($$renderer) => {
														$$renderer.push(`<span class="include-hint svelte-e74176">${escape_html(answeredCount() > 0 ? `${answeredCount()} réponse(s) partiraient en un seul envoi, options ET notes.` : "Aucune réponse à transmettre pour le moment.")}</span> `);
														Button($$renderer, {
															variant: "primary",
															onclick: sendAll,
															disabled: sendingAll || answeredCount() === 0,
															children: ($$renderer) => {
																$$renderer.push(`<!---->${escape_html(sendingAll ? "Transmission…" : "Transmettre toutes mes réponses à la CLI")}`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!---->`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----> `);
												if (sendAllResult) {
													$$renderer.push("<!--[0-->");
													if (sendAllResult.ok && sendAllResult.delivered) {
														$$renderer.push("<!--[0-->");
														Alert($$renderer, {
															tone: "success",
															title: `Transmis à ${sendAllResult.target}`,
															message: sendAllResult.note ?? ""
														});
													} else if (sendAllResult.ok) {
														$$renderer.push("<!--[1-->");
														Alert($$renderer, {
															tone: "warning",
															title: "Non remis — et voici ce qui le permettrait",
															message: sendAllResult.note ?? ""
														});
													} else {
														$$renderer.push("<!--[-1-->");
														Alert($$renderer, {
															tone: "error",
															title: "Échec de la transmission",
															message: sendAllResult.error ?? "Erreur inconnue."
														});
													}
													$$renderer.push(`<!--]-->`);
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]-->`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></section> <section aria-labelledby="summary-title">`);
								Stack($$renderer, {
									gap: 2,
									children: ($$renderer) => {
										$$renderer.push(`<h2 id="summary-title">Vos notes (repli presse-papier)</h2> `);
										Flex($$renderer, {
											align: "center",
											justify: "between",
											wrap: true,
											gap: 2,
											children: ($$renderer) => {
												$$renderer.push(`<span>${escape_html(answeredCount())} décision(s) sur ${escape_html(decisionsTotal())} annotée(s) ou sélectionnée(s).</span> `);
												Flex($$renderer, {
													align: "center",
													wrap: true,
													gap: 2,
													children: ($$renderer) => {
														Button($$renderer, {
															variant: "secondary",
															onclick: copySummary,
															children: ($$renderer) => {
																$$renderer.push(`<!---->Copier ma synthèse`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!----> `);
														Button($$renderer, {
															variant: "secondary",
															onclick: copyAnswerSetJson,
															children: ($$renderer) => {
																$$renderer.push(`<!---->Copier le jeu de réponses (JSON)`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!---->`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!---->`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----> `);
										if (exportState === "copied") {
											$$renderer.push("<!--[0-->");
											Alert($$renderer, {
												tone: "success",
												title: "Synthèse copiée",
												message: "Vos sélections et vos notes sont dans le presse-papier, en markdown. Collez-les où vous voulez : une CLI, un ticket, un message."
											});
										} else if (exportState === "copied-json") {
											$$renderer.push("<!--[1-->");
											Alert($$renderer, {
												tone: "success",
												title: "Jeu de réponses copié (JSON)",
												message: "Même forme que le jeu enregistré : il peut être commité puis rejoué tel quel dans ce dossier, sans retouche à la main."
											});
										} else if (exportState === "failed") {
											$$renderer.push("<!--[2-->");
											Alert($$renderer, {
												tone: "error",
												title: "Copie refusée par le navigateur",
												message: "Le presse-papier n'est pas accessible ici. Vos notes restent enregistrées dans ce navigateur ; sélectionnez-les à la main dans les cartes."
											});
										} else $$renderer.push("<!--[-1-->");
										$$renderer.push(`<!--]-->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></section> <section aria-labelledby="replay-title">`);
								Stack($$renderer, {
									gap: 2,
									children: ($$renderer) => {
										$$renderer.push(`<h2 id="replay-title">Jeu de réponses commité</h2> `);
										if (!answerSet()) {
											$$renderer.push("<!--[0-->");
											Alert($$renderer, {
												tone: "warning",
												title: "Jeu commité indisponible",
												message: "Le jeu de réponses commité n'est pas atteignable depuis ce service (docs/decisions/2026-07-25-agent-memory-owner-answers.json). Rien n'a été inventé : vos réponses locales sont intactes."
											});
										} else {
											$$renderer.push(`<!--[-1--><p>Jeu commité : <code>${escape_html(answerSet().source)}</code> — révision <strong>${escape_html(answerSet().revision)}</strong>${escape_html(answerSet().capturedAt ? `, capturé le ${answerSet().capturedAt}` : "")}${escape_html(answerSet().status ? ` (${answerSet().status})` : "")}. Il est chargé <strong>par défaut</strong>, côté serveur, sélections <strong>et</strong> notes, telles
                  qu'elles ont été écrites — aucun état de navigateur n'est requis pour le voir.</p> `);
											if (dossier().carryOver) {
												$$renderer.push("<!--[0-->");
												Alert($$renderer, {
													tone: "info",
													title: `Report depuis « ${dossier().carryOver.from} » : ${dossier().carryOver.carried.length} décisions conservées, ${dossier().carryOver.added.length} ajoutées`,
													message: dossier().carryOver.statement
												});
											} else $$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]--> `);
											if (revisionMismatch()) {
												$$renderer.push("<!--[0-->");
												Alert($$renderer, {
													tone: "warning",
													title: "Révision différente",
													message: `Ces réponses ont été capturées sur « ${answerSet().revision} », or ce dossier est en « ${dossier().revision} ». Ce qui retombe sur cette révision est chargé ; ce qui n'y retombe plus et ce que ce jeu ne couvre pas sont nommés ci-dessous.`
												});
											} else $$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]--> `);
											if (committedReport()) {
												$$renderer.push("<!--[0-->");
												if (committedReport().missingDecisions.length) {
													$$renderer.push("<!--[0-->");
													Alert($$renderer, {
														tone: "error",
														title: "Réponses non chargeables : décision disparue",
														message: `Ces clés n'existent plus dans la révision « ${dossier().revision} » et n'ont donc pas pu être chargées : ${committedReport().missingDecisions.join(", ")}. Leurs notes sont toujours dans le jeu commité, pas dans cette page.`
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												if (committedReport().staleOptions.length) {
													$$renderer.push("<!--[0-->");
													Alert($$renderer, {
														tone: "warning",
														title: "Options disparues : note chargée, sélection non",
														message: `Ces options n'existent plus pour leur décision : ${committedReport().staleOptions.join(", ")}. La note a été chargée, la sélection est restée vide — à vous de la reprendre.`
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]--> `);
												if (committedReport().unanswered.length) {
													$$renderer.push("<!--[0-->");
													Alert($$renderer, {
														tone: "info",
														title: `${committedReport().unanswered.length} décision(s) sans réponse dans ce jeu`,
														message: `Ce jeu commité ne couvre pas : ${committedReport().unanswered.join(", ")}. Ce ne sont pas des réponses perdues — ce sont les cartes ajoutées depuis, qui attendent la vôtre.`
													});
												} else $$renderer.push("<!--[-1-->");
												$$renderer.push(`<!--]-->`);
											} else $$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]--> `);
											if (divergences().length > 0) {
												$$renderer.push(`<!--[0--><section aria-labelledby="divergence-title">`);
												Stack($$renderer, {
													gap: 2,
													children: ($$renderer) => {
														$$renderer.push(`<h3 id="divergence-title">Deux versions de vos réponses (${escape_html(divergences().length)} écart(s))</h3> <p>La page affiche votre <strong>brouillon local</strong>. Le jeu commité du dépôt dit
                        autre chose sur ces décisions. Choisissez laquelle garder — rien n'est remplacé
                        tant que vous n'avez pas choisi.</p> <ul class="divergences svelte-e74176"><!--[-->`);
														const each_array_6 = ensure_array_like(divergences());
														for (let $$index_6 = 0, $$length = each_array_6.length; $$index_6 < $$length; $$index_6++) {
															let divergence = each_array_6[$$index_6];
															$$renderer.push(`<li class="svelte-e74176">`);
															Stack($$renderer, {
																gap: 1,
																children: ($$renderer) => {
																	$$renderer.push(`<strong>${escape_html(divergence.key)}</strong> <p><em>Jeu commité :</em> ${escape_html(divergence.committedOption ?? "(aucune option)")} —
                                ${escape_html(divergence.committedNote ? divergence.committedNote : "(aucune note)")}</p> <p><em>Votre brouillon (affiché) :</em> ${escape_html(divergence.draftOption ?? "(aucune option)")} —
                                ${escape_html(divergence.draftNote ? divergence.draftNote : "(aucune note)")}</p>`);
																},
																$$slots: { default: true }
															});
															$$renderer.push(`<!----></li>`);
														}
														$$renderer.push(`<!--]--></ul> `);
														Flex($$renderer, {
															align: "center",
															justify: "between",
															wrap: true,
															gap: 2,
															children: ($$renderer) => {
																$$renderer.push(`<span class="include-hint svelte-e74176">Garder votre brouillon ne demande aucune action : il est déjà à l'écran.</span> `);
																Button($$renderer, {
																	variant: "secondary",
																	onclick: useCommitted,
																	children: ($$renderer) => {
																		$$renderer.push(`<!---->Utiliser le jeu commité du dépôt`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!---->`);
															},
															$$slots: { default: true }
														});
														$$renderer.push(`<!---->`);
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else $$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]-->`);
										}
										$$renderer.push(`<!--]-->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></section>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----></main>`);
					},
					$$slots: { default: true }
				});
			}
			AppShell($$renderer, {
				variant: "workspace",
				main,
				$$slots: { main: true }
			});
		}
	});
}
export { _page as default };

//# sourceMappingURL=_page.svelte.js.map