import { a as derived, f as stringify, h as attr, n as attr_style, s as ensure_array_like, t as attr_class, y as escape_html } from "../../../../chunks/server2.js";
import { i as Badge, n as Container, r as Button } from "../../../../chunks/Flex.js";
import { t as Stack } from "../../../../chunks/Stack.js";
import { t as EmptyState } from "../../../../chunks/EmptyState.js";
// src/lib/review/anchor.ts
function fromBase64Url(value) {
	const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
	const bin = atob(padded);
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
function decodeAnchor(sectionKey) {
	if (!sectionKey || !sectionKey.startsWith("a1:")) return null;
	try {
		const parsed = JSON.parse(fromBase64Url(sectionKey.slice(3)));
		if (!parsed || typeof parsed !== "object" || !("t" in parsed) || !("v" in parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
function anchorLabel(anchor) {
	if (!anchor) return "Sans ancre";
	if (anchor.t === "text") {
		const exact = anchor.q.exact.trim();
		return exact.length > 140 ? `${exact.slice(0, 140)}…` : exact || "Sélection";
	}
	if (anchor.t === "element") return anchor.aid ? `Élément ${anchor.aid}` : `Élément ${anchor.sel.split(">").pop()?.trim() ?? ""}`.trim() || "Élément";
	return "Zone du document";
}
function groupThreads(comments) {
	const byThread = /* @__PURE__ */ new Map();
	for (const c of comments) {
		const list = byThread.get(c.threadId) ?? [];
		list.push(c);
		byThread.set(c.threadId, list);
	}
	const threads = [...byThread.entries()].map(([threadId, rows]) => {
		const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const rootRow = sorted[0];
		const anchor = decodeAnchor(rootRow?.target.sectionKey);
		return {
			threadId,
			target: rootRow.target,
			comments: sorted,
			state: sorted.some((r) => r.state === "open") || sorted.every((r) => r.state === "open") ? sorted[0].state ?? "open" : sorted[0].state,
			anchor,
			anchorLabel: anchorLabel(anchor)
		};
	});
	for (const t of threads) t.state = t.comments.every((c) => c.state === "closed") ? "closed" : "open";
	return threads.sort((a, b) => (a.comments[0]?.createdAt ?? "").localeCompare(b.comments[0]?.createdAt ?? ""));
}
function filterThreads(threads, filter, currentUserId) {
	if (filter === "all") return threads;
	if (filter === "open") return threads.filter((t) => t.state === "open");
	if (filter === "resolved") return threads.filter((t) => t.state === "closed");
	return threads.filter((t) => t.comments.some((c) => c.author.id === currentUserId));
}
function isUnread(thread, lastReadAt, currentUserId) {
	if (!lastReadAt) return thread.comments.some((c) => c.author.id !== currentUserId);
	return thread.comments.some((c) => c.author.id !== currentUserId && c.createdAt > lastReadAt);
}
// src/lib/review/fake.ts
var BUS_KEY = "focus-review:fake:bus";
var FAKE_STORAGE_PREFIX = "focus-review:fake:v1:";
function storageKey(artifactId) {
	return `${FAKE_STORAGE_PREFIX}${artifactId}`;
}
function load(artifactId) {
	try {
		const raw = localStorage.getItem(storageKey(artifactId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
function save(artifactId, rows) {
	try {
		localStorage.setItem(storageKey(artifactId), JSON.stringify(rows));
	} catch (err) {
		throw err instanceof Error ? err : /* @__PURE__ */ new Error("STORAGE_FAILED");
	}
}
function emit(artifactId, type, payload) {
	window.dispatchEvent(new CustomEvent(BUS_KEY, { detail: {
		artifactId,
		type,
		payload
	} }));
}
function createFakeClient(artifactId, opts) {
	const agentAuthorId = opts.authorId;
	const agentDelay = opts.agentDelayMs ?? 700;
	let agentTimer;
	function scheduleAgentReply(threadId, triggerBody) {
		if (agentTimer) clearTimeout(agentTimer);
		agentTimer = setTimeout(() => {
			const rows = load(artifactId);
			const reply = {
				id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				target: rows.find((r) => r.threadId === threadId)?.target ?? {
					kind: "artifact",
					id: artifactId
				},
				threadId,
				author: { id: agentAuthorId },
				state: "open",
				body: `Réponse de l'agent (fake) — bien reçu : « ${triggerBody.slice(0, 80)} ». Je traite ce point et je mets à jour l'artefact.`,
				provenance: { runId: "run-fake-1" },
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			rows.push(reply);
			try {
				save(artifactId, rows);
			} catch {
				return;
			}
			emit(artifactId, "comment.created", reply);
		}, agentDelay);
	}
	return {
		async listThreads() {
			const rows = load(artifactId);
			const byThread = /* @__PURE__ */ new Map();
			for (const r of rows) {
				const list = byThread.get(r.threadId) ?? [];
				list.push(r);
				byThread.set(r.threadId, list);
			}
			return [...byThread.values()].map((list) => [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
		},
		async create(input) {
			const rows = load(artifactId);
			const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			const comment = {
				id,
				target: {
					kind: "artifact",
					id: artifactId,
					sectionKey: input.sectionKey
				},
				threadId: input.threadId ?? id,
				author: { id: opts.authorId },
				state: "open",
				body: input.body,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			if (input.threadId) {
				const root = rows.find((r) => r.threadId === input.threadId);
				if (root) comment.target = { ...root.target };
			}
			rows.push(comment);
			save(artifactId, rows);
			emit(artifactId, "comment.created", comment);
			if (input.sendToAgent) scheduleAgentReply(comment.threadId, input.body);
			return comment;
		},
		async closeThread(threadId) {
			const rows = load(artifactId);
			for (const r of rows) if (r.threadId === threadId) r.state = "closed";
			save(artifactId, rows);
			emit(artifactId, "thread.closed", { threadId });
			return { ok: true };
		},
		async reopenThread(threadId) {
			const rows = load(artifactId);
			for (const r of rows) if (r.threadId === threadId) r.state = "open";
			save(artifactId, rows);
			emit(artifactId, "thread.reopened", { threadId });
			return { ok: true };
		},
		subscribe(onEvent) {
			const handler = (e) => {
				const detail = e.detail;
				if (detail?.artifactId !== artifactId) return;
				onEvent(detail.type, detail.payload);
			};
			window.addEventListener(BUS_KEY, handler);
			return () => window.removeEventListener(BUS_KEY, handler);
		}
	};
}
// src/lib/review/adapter.ts
/** Error raised from a JSON `{ error: { code, message } }` answer of the real backend. */
var ReviewApiError = class extends Error {
	code;
	status;
	/** The comment was stored although the request failed (e.g. agent delivery). Never retry. */
	saved;
	comment;
	constructor(status, body) {
		const code = body?.error?.code ?? `http_${status}`;
		super(body?.error?.message ?? `Request failed (${status}).`);
		this.name = "ReviewApiError";
		this.code = code;
		this.status = status;
		this.saved = body?.error?.saved === true;
		this.comment = body?.error?.comment;
	}
};
async function readJson(res) {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
async function expectOk(res) {
	const body = await readJson(res);
	if (!res.ok) throw new ReviewApiError(res.status, body);
	if (body === null) throw new ReviewApiError(res.status, { error: {
		code: "bad_json",
		message: "The review backend answered without JSON."
	} });
	return body;
}
var JSON_HEADERS = { "content-type": "application/json" };
function createCommentsClient(artifactId, opts) {
	const fake = createFakeClient(artifactId, { authorId: opts.authorId });
	const base = `/api/artifacts/${encodeURIComponent(artifactId)}`;
	let backend = opts.forceFake ? "fake" : "unknown";
	async function probe() {
		if (backend !== "unknown") return backend;
		let res;
		try {
			res = await fetch(`${base}/comments`);
		} catch {
			backend = "fake";
			return backend;
		}
		if (res.status === 404) {
			backend = "fake";
			return backend;
		}
		backend = "real";
		return backend;
	}
	return {
		backend: () => backend,
		async listThreads() {
			if (await probe() === "fake") return fake.listThreads();
			return (await expectOk(await fetch(`${base}/comments`))).threads ?? [];
		},
		async create(input) {
			if (await probe() === "fake") return fake.create(input);
			const payload = { body: input.body };
			if (input.sectionKey) payload.sectionKey = input.sectionKey;
			if (input.threadId) payload.threadId = input.threadId;
			if (input.sendToAgent) payload.sendToAgent = true;
			return expectOk(await fetch(`${base}/comments`, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify(payload)
			}));
		},
		async closeThread(threadId) {
			if (await probe() === "fake") return fake.closeThread(threadId);
			await expectOk(await fetch(`${base}/threads/${encodeURIComponent(threadId)}/close`, {
				method: "POST",
				headers: JSON_HEADERS,
				body: "{}"
			}));
			return { ok: true };
		},
		async reopenThread(threadId) {
			if (await probe() === "fake") return fake.reopenThread(threadId);
			await expectOk(await fetch(`${base}/threads/${encodeURIComponent(threadId)}/reopen`, {
				method: "POST",
				headers: JSON_HEADERS,
				body: "{}"
			}));
			return { ok: true };
		},
		subscribe(onEvent) {
			let closed = false;
			let source;
			let fakeOff;
			const openReal = () => {
				if (closed || source || typeof EventSource === "undefined") return;
				source = new EventSource(`${base}/stream`);
				const forward = (type) => (e) => {
					if (closed) return;
					try {
						onEvent(type, JSON.parse(e.data));
					} catch {
						onEvent(type, e.data);
					}
				};
				for (const type of [
					"comment.created",
					"thread.closed",
					"thread.reopened",
					"agent.delivery",
					"review.error"
				]) source.addEventListener(type, forward(type));
			};
			probe().then((mode) => {
				if (closed) return;
				if (mode === "fake") fakeOff = fake.subscribe(onEvent);
				else openReal();
			});
			return () => {
				closed = true;
				fakeOff?.();
				source?.close();
			};
		}
	};
}
// src/lib/review/ReviewModeToggle.svelte
function ReviewModeToggle($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { mode, openCount, unreadCount = 0, label = "Review", disabled = false, class: className = "", onModeChange } = $$props;
		const pressed = derived(() => mode === "review");
		Button($$renderer, {
			variant: pressed() ? "primary" : "secondary",
			size: "sm",
			disabled,
			"aria-pressed": pressed(),
			class: className,
			"data-testid": "review-toggle",
			onclick: () => onModeChange?.(pressed() ? "view" : "review"),
			children: ($$renderer) => {
				$$renderer.push(`<!---->${escape_html(label)} · ${escape_html(openCount)} `);
				if (unreadCount > 0) {
					$$renderer.push("<!--[0-->");
					Badge($$renderer, {
						tone: "info",
						size: "sm",
						"aria-label": `${unreadCount} non lu`,
						children: ($$renderer) => {
							$$renderer.push(`<!---->${escape_html(unreadCount)} non lu`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		});
	});
}
// src/lib/review/CommentPin.svelte
function CommentPin($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { index, count, unread = false, resolved = false, active = false, label, variant = "inline", onActivate } = $$props;
		const ariaLabel = derived(() => `Fil ${index + 1}, ${count} commentaire${count > 1 ? "s" : ""}${unread ? ", non lu" : ""}${resolved ? ", résolu" : ""}, sur « ${label.slice(0, 60)} »`);
		$$renderer.push(`<button type="button"${attr_class(`st-review-pin st-review-pin--${stringify(variant)}`, "svelte-k2pr84", {
			"is-active": active,
			"is-resolved": resolved
		})}${attr("aria-label", ariaLabel())}${attr("aria-current", active ? "true" : void 0)} data-testid="comment-pin"><span class="st-review-pin__num" aria-hidden="true">${escape_html(index + 1)}</span> `);
		if (resolved) $$renderer.push(`<!--[0--><span class="st-review-pin__check" aria-hidden="true">✓</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (unread) $$renderer.push(`<!--[0--><span class="st-review-pin__dot svelte-k2pr84" aria-hidden="true">●</span><span class="sr-only svelte-k2pr84">non lu</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <span class="sr-only svelte-k2pr84">${escape_html(count)} commentaire${escape_html(count > 1 ? "s" : "")}</span></button>`);
	});
}
// src/lib/review/CommentLayer.svelte
function CommentLayer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { mode, threads, orphanIds = [], activeThreadId = null, unreadByThread = {}, artifactVersion, onCreateRequest, onSelect, children } = $$props;
		let pins = [];
		derived(() => new Set(orphanIds));
		$$renderer.push(`<div class="st-review-layer svelte-om5f8i" data-testid="comment-layer" data-review-root="" role="document" aria-describedby="review-layer-status"><p id="review-layer-status" class="sr-only svelte-om5f8i">${escape_html(mode === "review" ? "Mode revue actif. Sélectionnez du texte ou cliquez un bloc pour commenter." : "Mode lecture.")}</p> `);
		children?.($$renderer);
		$$renderer.push(`<!----> `);
		if (mode === "review") {
			$$renderer.push(`<!--[0--><div class="st-review-layer__pins svelte-om5f8i" aria-label="Épingles de commentaires"><!--[-->`);
			const each_array = ensure_array_like(pins);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let pin = each_array[$$index];
				const thread = threads.find((t) => t.threadId === pin.threadId);
				if (thread) {
					$$renderer.push(`<!--[0--><span class="st-review-layer__pin svelte-om5f8i"${attr_style(`top: ${stringify(pin.top)}px; left: ${stringify(pin.left)}px;`)}>`);
					CommentPin($$renderer, {
						index: pin.index,
						count: thread.comments.length,
						unread: !!unreadByThread[thread.threadId],
						resolved: thread.state === "closed",
						active: activeThreadId === thread.threadId,
						label: thread.anchorLabel,
						onActivate: () => onSelect?.(thread.threadId)
					});
					$$renderer.push(`<!----></span>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></div> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
// src/lib/review/CommentComposer.svelte
function CommentComposer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { author, placeholder = "Écrire un commentaire…", submitLabel = "Commenter", initialBody = "", autofocus = true, showSendToAgent = true, onSubmit, onCancel } = $$props;
		let body = initialBody;
		let sendToAgent = false;
		let error = "";
		function submit() {
			const trimmed = body.trim();
			if (!trimmed) {
				error = "Le commentaire ne peut pas être vide.";
				return;
			}
			error = "";
			onSubmit?.(trimmed, sendToAgent);
			body = "";
			sendToAgent = false;
		}
		$$renderer.push(`<div class="st-review-composer svelte-1f0tgqf" data-testid="comment-composer"><label class="st-review-composer__label svelte-1f0tgqf" for="review-composer-body">Commentaire de ${escape_html(author.displayLabel)}</label> <textarea id="review-composer-body"${attr("placeholder", placeholder)} rows="3"${attr("aria-invalid", error ? "true" : void 0)}${attr("aria-describedby", error ? "review-composer-error" : void 0)} class="svelte-1f0tgqf">`);
		const $$body = escape_html(body);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea> `);
		if (error) $$renderer.push(`<!--[0--><p id="review-composer-error" role="alert" class="st-review-composer__error svelte-1f0tgqf">${escape_html(error)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="st-review-composer__row svelte-1f0tgqf">`);
		if (showSendToAgent) $$renderer.push(`<!--[0--><label class="st-review-composer__agent svelte-1f0tgqf"><input type="checkbox"${attr("checked", sendToAgent, true)} data-testid="send-to-agent" class="svelte-1f0tgqf"/> Envoyer à l'agent</label>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <span class="st-review-composer__spacer svelte-1f0tgqf"></span> `);
		Button($$renderer, {
			variant: "ghost",
			size: "sm",
			onclick: () => onCancel?.(),
			children: ($$renderer) => {
				$$renderer.push(`<!---->Annuler`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Button($$renderer, {
			variant: "primary",
			size: "sm",
			"data-testid": "composer-submit",
			onclick: submit,
			children: ($$renderer) => {
				$$renderer.push(`<!---->${escape_html(submitLabel)}`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div> <p class="st-review-composer__hint svelte-1f0tgqf">Ctrl+Entrée pour envoyer · Échap pour annuler</p></div>`);
	});
}
// src/lib/review/CommentThread.svelte
function CommentThread($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { thread, currentUser, actors = {}, active = false, onReply, onResolve, onReopen, onSelect } = $$props;
		let replying = false;
		const resolved = derived(() => thread.state === "closed");
		function actorFor(id) {
			return actors[id] ?? {
				actorId: id,
				kind: id === currentUser.actorId ? currentUser.kind : "human",
				displayLabel: id,
				color: "#5b6472"
			};
		}
		function initials(label) {
			return label.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
		}
		$$renderer.push(`<article${attr_class("st-review-thread svelte-jom6id", void 0, { "is-active": active })} data-testid="comment-thread"${attr("data-thread-id", thread.threadId)}${attr("aria-label", `Fil sur « ${thread.anchorLabel.slice(0, 60)} »`)}><button type="button" class="st-review-thread__head svelte-jom6id"><span class="st-review-thread__quote svelte-jom6id">« ${escape_html(thread.anchorLabel)} »</span> `);
		if (resolved()) {
			$$renderer.push("<!--[0-->");
			Badge($$renderer, {
				tone: "success",
				size: "sm",
				children: ($$renderer) => {
					$$renderer.push(`<!---->✓ Resolved`);
				},
				$$slots: { default: true }
			});
		} else {
			$$renderer.push("<!--[-1-->");
			Badge($$renderer, {
				tone: "info",
				size: "sm",
				children: ($$renderer) => {
					$$renderer.push(`<!---->● Open`);
				},
				$$slots: { default: true }
			});
		}
		$$renderer.push(`<!--]--></button> <ol class="st-review-thread__list svelte-jom6id"><!--[-->`);
		const each_array = ensure_array_like(thread.comments);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let comment = each_array[$$index];
			const actor = actorFor(comment.author.id);
			$$renderer.push(`<li class="st-review-thread__comment svelte-jom6id" data-testid="thread-comment"><span class="st-review-thread__avatar svelte-jom6id"${attr_style(`--avatar-bg: ${stringify(actor.color)}`)} aria-hidden="true">${escape_html(initials(actor.displayLabel))}</span> <div><p class="st-review-thread__meta svelte-jom6id"><strong>${escape_html(actor.displayLabel)}</strong> `);
			if (actor.kind !== "human") {
				$$renderer.push("<!--[0-->");
				Badge($$renderer, {
					tone: "neutral",
					size: "sm",
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(actor.kind)}`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <time${attr("datetime", comment.createdAt)}>${escape_html(new Date(comment.createdAt).toLocaleString())}</time> `);
			if (comment.updatedAt && comment.updatedAt !== comment.createdAt) $$renderer.push(`<!--[0--><span>(modifié)</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (comment.provenance?.runId) $$renderer.push(`<!--[0--><span>run ${escape_html(comment.provenance.runId)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></p> <p class="st-review-thread__body svelte-jom6id">${escape_html(comment.body)}</p></div></li>`);
		}
		$$renderer.push(`<!--]--></ol> `);
		if (resolved()) {
			$$renderer.push(`<!--[0--><p class="st-review-thread__resolved-note svelte-jom6id">Comment resolved. Reopen to reply.</p> <div class="st-review-thread__actions svelte-jom6id">`);
			Button($$renderer, {
				variant: "secondary",
				size: "sm",
				"data-testid": "thread-reopen",
				onclick: () => onReopen?.(thread.threadId),
				children: ($$renderer) => {
					$$renderer.push(`<!---->Rouvrir`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div>`);
		} else {
			$$renderer.push(`<!--[-1--><div class="st-review-thread__actions svelte-jom6id">`);
			if (!replying) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					variant: "secondary",
					size: "sm",
					"data-testid": "thread-reply-open",
					onclick: () => replying = true,
					children: ($$renderer) => {
						$$renderer.push(`<!---->Répondre`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			Button($$renderer, {
				variant: "ghost",
				size: "sm",
				"data-testid": "thread-resolve",
				onclick: () => onResolve?.(thread.threadId),
				children: ($$renderer) => {
					$$renderer.push(`<!---->✓ Résoudre`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div> `);
			if (replying) {
				$$renderer.push("<!--[0-->");
				CommentComposer($$renderer, {
					author: currentUser,
					submitLabel: "Répondre",
					onSubmit: (body, sendToAgent) => {
						onReply?.(thread.threadId, body, sendToAgent);
						replying = false;
					},
					onCancel: () => replying = false
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></article>`);
	});
}
// src/lib/review/ThreadPanel.svelte
function ThreadPanel($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { threads, orphaned, currentUser, actors = {}, activeThreadId = null, filter = "all", unreadByThread = {}, onSelect, onFilterChange, onReply, onResolve, onReopen } = $$props;
		const filters = [
			{
				value: "all",
				label: "Tous"
			},
			{
				value: "open",
				label: "Open"
			},
			{
				value: "resolved",
				label: "Resolved"
			},
			{
				value: "mine",
				label: "Mine"
			}
		];
		function countFor(f) {
			if (f === "all") return threads.length;
			if (f === "open") return threads.filter((t) => t.state === "open").length;
			if (f === "resolved") return threads.filter((t) => t.state === "closed").length;
			return threads.filter((t) => t.comments.some((c) => c.author.id === currentUser.actorId)).length;
		}
		$$renderer.push(`<section class="st-review-panel svelte-uqvtzq" aria-label="Fils de commentaires" data-testid="thread-panel"><h2 class="st-review-panel__title svelte-uqvtzq" tabindex="-1">Commentaires</h2> <div class="st-review-panel__filters svelte-uqvtzq" role="group" aria-label="Filtrer les fils"><!--[-->`);
		const each_array = ensure_array_like(filters);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let f = each_array[$$index];
			Button($$renderer, {
				variant: filter === f.value ? "primary" : "ghost",
				size: "sm",
				"aria-pressed": filter === f.value,
				"data-testid": `filter-${stringify(f.value)}`,
				onclick: () => onFilterChange?.(f.value),
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(f.label)} (${escape_html(countFor(f.value))})`);
				},
				$$slots: { default: true }
			});
		}
		$$renderer.push(`<!--]--></div> `);
		if (orphaned.length > 0) $$renderer.push(`<!--[0--><p class="st-review-panel__orphans svelte-uqvtzq" role="status">${escape_html(orphaned.length)} fil${escape_html(orphaned.length > 1 ? "s" : "")} sans attache (No longer attached) — toujours répondables et résolvables ci-dessous.</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (threads.length === 0 && orphaned.length === 0) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: "Aucun commentaire",
				message: "Sélectionnez du texte ou cliquez un bloc commentable pour créer le premier fil."
			});
		} else {
			$$renderer.push(`<!--[-1--><div class="st-review-panel__list svelte-uqvtzq"><!--[-->`);
			const each_array_1 = ensure_array_like(threads);
			for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
				let thread = each_array_1[$$index_1];
				$$renderer.push(`<div${attr_class("", void 0, { "st-review-panel__unread": unreadByThread[thread.threadId] })}>`);
				if (unreadByThread[thread.threadId]) $$renderer.push(`<!--[0--><p class="st-review-panel__unread-label svelte-uqvtzq">● Non lu</p>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				CommentThread($$renderer, {
					thread,
					currentUser,
					actors,
					active: activeThreadId === thread.threadId,
					onReply,
					onResolve,
					onReopen,
					onSelect
				});
				$$renderer.push(`<!----></div>`);
			}
			$$renderer.push(`<!--]--> <!--[-->`);
			const each_array_2 = ensure_array_like(orphaned);
			for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
				let thread = each_array_2[$$index_2];
				$$renderer.push(`<div data-testid="orphan-thread"><p class="st-review-panel__orphan-label svelte-uqvtzq">Sans attache — No longer attached</p> `);
				CommentThread($$renderer, {
					thread,
					currentUser,
					actors,
					active: activeThreadId === thread.threadId,
					onReply,
					onResolve,
					onReopen,
					onSelect
				});
				$$renderer.push(`<!----></div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
// src/lib/review/ReviewShell.svelte
function ReviewShell($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { artifactId, artifactVersion = "v1", currentUser, actors = {}, children } = $$props;
		const client = createCommentsClient(artifactId, { authorId: currentUser.actorId });
		let mode = "view";
		let allThreads = [];
		let filter = "all";
		let activeThreadId = null;
		let panelOpen = false;
		let pending = null;
		let pendingError = "";
		let loadError = "";
		let status = "";
		let readState = {};
		const readKey = `focus-review:read:${artifactId}`;
		derived(() => {
			return allThreads;
		});
		derived(() => {
			return [];
		});
		const shownOrphaned = derived(() => []);
		const shownAttached = derived(() => allThreads);
		const visible = derived(() => filterThreads(shownAttached(), filter, currentUser.actorId));
		const openCount = derived(() => shownAttached().filter((t) => t.state === "open").length + shownOrphaned().filter((t) => t.state === "open").length);
		const unreadByThread = derived(() => {
			const map = {};
			for (const t of [...shownAttached(), ...shownOrphaned()]) map[t.threadId] = isUnread(t, readState[t.threadId], currentUser.actorId);
			return map;
		});
		const unreadCount = derived(() => Object.values(unreadByThread()).filter(Boolean).length);
		async function refresh() {
			try {
				allThreads = groupThreads((await client.listThreads()).flat());
				loadError = "";
			} catch (e) {
				loadError = e instanceof Error ? e.message : "Chargement des commentaires impossible.";
			}
		}
		function markRead(threadId) {
			readState = {
				...readState,
				[threadId]: (/* @__PURE__ */ new Date()).toISOString()
			};
			try {
				localStorage.setItem(readKey, JSON.stringify(readState));
			} catch {}
		}
		function onModeChange(next) {
			if (mode === "review" && next === "view" && pending) {
				if (!window.confirm("Un brouillon de commentaire est en cours. Quitter le mode revue ?")) return;
				pending = null;
			}
			mode = next;
			if (next === "review") panelOpen = true;
		}
		function selectThread(threadId) {
			activeThreadId = threadId;
			panelOpen = true;
			if (mode !== "review") mode = "review";
			markRead(threadId);
			status = "Fil ouvert.";
		}
		async function submitCreate(body, sendToAgent) {
			if (!pending) return;
			if (pending.sectionKey.length > 2048) {
				pendingError = "L'ancre dépasse 2048 caractères. Réduisez la sélection.";
				return;
			}
			pendingError = "";
			const before = allThreads;
			try {
				const created = await client.create({
					sectionKey: pending.sectionKey,
					body,
					sendToAgent
				});
				pending = null;
				await refresh();
				selectThread(created.threadId);
				status = sendToAgent ? "Commentaire créé et envoyé à l'agent." : "Commentaire créé.";
			} catch (e) {
				if (e instanceof ReviewApiError && e.saved) {
					pending = null;
					await refresh();
					if (e.comment) selectThread(e.comment.threadId);
					loadError = e.message;
					return;
				}
				allThreads = before;
				pendingError = e instanceof Error ? e.message : "Création impossible.";
			}
		}
		async function reply(threadId, body, sendToAgent) {
			const before = allThreads;
			try {
				await client.create({
					sectionKey: "",
					body,
					threadId,
					sendToAgent
				});
				await refresh();
				markRead(threadId);
				status = sendToAgent ? "Réponse envoyée à l'agent." : "Réponse ajoutée.";
			} catch (e) {
				if (e instanceof ReviewApiError && e.saved) {
					await refresh();
					markRead(threadId);
					loadError = e.message;
					return;
				}
				allThreads = before;
				loadError = e instanceof Error ? e.message : "Réponse impossible.";
			}
		}
		async function resolve(threadId) {
			const before = allThreads;
			try {
				await client.closeThread(threadId);
				await refresh();
				status = "Fil résolu.";
			} catch (e) {
				allThreads = before;
				loadError = e instanceof Error ? e.message : "Résolution impossible.";
			}
		}
		async function reopen(threadId) {
			const before = allThreads;
			try {
				await client.reopenThread(threadId);
				await refresh();
				status = "Fil rouvert.";
			} catch (e) {
				allThreads = before;
				loadError = e instanceof Error ? e.message : "Réouverture impossible.";
			}
		}
		$$renderer.push(`<div class="st-review-shell svelte-1yvuq8e" data-testid="review-shell"><div class="st-review-shell__bar svelte-1yvuq8e">`);
		ReviewModeToggle($$renderer, {
			mode,
			openCount: openCount(),
			unreadCount: unreadCount(),
			onModeChange
		});
		$$renderer.push(`<!----> `);
		if (mode === "review") {
			$$renderer.push("<!--[0-->");
			Button($$renderer, {
				variant: "ghost",
				size: "sm",
				"aria-expanded": panelOpen,
				"data-testid": "panel-toggle",
				onclick: () => panelOpen = !panelOpen,
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(panelOpen ? "Masquer les commentaires" : "Afficher les commentaires")}`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <span aria-live="polite" class="st-review-shell__status svelte-1yvuq8e">${escape_html(status)}</span></div> `);
		if (loadError) $$renderer.push(`<!--[0--><p role="alert" class="st-review-shell__alert svelte-1yvuq8e">${escape_html(loadError)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (pending) {
			$$renderer.push(`<!--[0--><div class="st-review-shell__composer svelte-1yvuq8e" data-testid="create-composer"><p class="st-review-shell__anchor svelte-1yvuq8e">Ancre : « ${escape_html(pending.label)} »</p> `);
			if (pendingError) $$renderer.push(`<!--[0--><p role="alert" class="st-review-shell__alert svelte-1yvuq8e">${escape_html(pendingError)}</p>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			CommentComposer($$renderer, {
				author: currentUser,
				submitLabel: "Créer le fil",
				onSubmit: submitCreate,
				onCancel: () => {
					pending = null;
					pendingError = "";
				}
			});
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div${attr_class("st-review-shell__layout svelte-1yvuq8e", void 0, { "has-panel": panelOpen && mode === "review" })}><div class="st-review-shell__main">`);
		CommentLayer($$renderer, {
			mode,
			threads: shownAttached(),
			orphanIds: shownOrphaned().map((t) => t.threadId),
			activeThreadId,
			unreadByThread: unreadByThread(),
			artifactVersion,
			onCreateRequest: (req) => {
				pending = req;
				pendingError = req.sectionKey.length > 2048 ? "L'ancre dépasse 2048 caractères. Réduisez la sélection." : "";
			},
			onSelect: selectThread,
			children: ($$renderer) => {
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div> `);
		if (panelOpen && mode === "review") {
			$$renderer.push(`<!--[0--><aside class="st-review-shell__panel svelte-1yvuq8e" data-testid="review-panel-wrap">`);
			ThreadPanel($$renderer, {
				threads: visible(),
				orphaned: shownOrphaned(),
				currentUser,
				actors,
				activeThreadId,
				filter,
				unreadByThread: unreadByThread(),
				onSelect: selectThread,
				onFilterChange: (f) => filter = f,
				onReply: reply,
				onResolve: resolve,
				onReopen: reopen
			});
			$$renderer.push(`<!----></aside>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div>`);
	});
}
// src/routes/artifact/[id]/+page.svelte
function artifactBody($$renderer) {
	$$renderer.push(`<article data-testid="artifact-body" class="svelte-mz3l9z"><h2 data-anchor-id="a-title" class="svelte-mz3l9z">Décision — revue des artefacts locaux</h2> <p data-anchor-id="a-intro" data-commentable="" class="svelte-mz3l9z">Les artefacts locaux doivent offrir un mode commentaire aussi réactif que l'expérience de référence, mais entièrement en local. Chaque commentaire est ancré sur un passage précis ou sur un bloc stable du document, puis suivi comme un fil de discussion.</p> <p data-anchor-id="a-scope" data-commentable="" class="svelte-mz3l9z">Le périmètre L0 couvre la bascule revue, les épingles ancrées, le panneau de fils, la réponse de l'agent en direct et la résolution avec réouverture. Le stockage passe par l'API commentaires du contrat figé ; en attendant le backend, un double en page assure la même recette.</p> <blockquote data-anchor-id="a-quote" data-commentable="" class="svelte-mz3l9z">Un commentaire envoyé à l'agent réveille la session propriétaire de l'artefact, quelle que soit la CLI utilisée, et la réponse revient dans le fil.</blockquote> <h3 data-anchor-id="a-list-title" class="svelte-mz3l9z">Points à valider</h3> <ul class="svelte-mz3l9z"><li data-anchor-id="a-item-1" data-commentable="">Ancrage texte : sélection d'au moins un caractère, ancre W3C text-quote plafonnée à 2048 caractères.</li> <li data-anchor-id="a-item-2" data-commentable="">Ancrage élément : clic sur un bloc commentable, chemin d'élément et identifiant stable.</li> <li data-anchor-id="a-item-3" data-commentable="">Accessibilité : navigation clavier complète, jamais la couleur seule, cible tactile d'au moins 24 px.</li></ul> <p data-anchor-id="a-close" data-commentable="" class="svelte-mz3l9z">Après relecture, chaque fil peut être résolu puis rouvert si le sujet revient. L'état survit au rechargement de la page.</p></article>`);
}
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		const currentUser = {
			actorId: "owner",
			kind: "human",
			displayLabel: "Propriétaire",
			color: "#34558b"
		};
		const actors = {
			owner: currentUser,
			agent: {
				actorId: "agent",
				kind: "agent",
				displayLabel: "Agent (session propriétaire)",
				color: "#2e7d4f"
			}
		};
		Container($$renderer, {
			children: ($$renderer) => {
				Stack($$renderer, {
					gap: 4,
					children: ($$renderer) => {
						$$renderer.push(`<header><p><a href="/">← Retour au suivi</a></p> <h1>Artefact ${escape_html(data.artifactId)}</h1> <p>Version ${escape_html(data.artifactVersion)}. Page de démonstration du mode revue local (L0).</p></header> `);
						if (data.reviewEnabled) {
							$$renderer.push("<!--[0-->");
							ReviewShell($$renderer, {
								artifactId: data.artifactId,
								artifactVersion: data.artifactVersion,
								currentUser,
								actors,
								children: ($$renderer) => {
									artifactBody($$renderer);
								},
								$$slots: { default: true }
							});
						} else {
							$$renderer.push(`<!--[-1--><p data-testid="review-disabled" role="status">Mode revue désactivé. Activez <code>PUBLIC_FOCUS_ARTIFACT_REVIEW=1</code> pour afficher la bascule, les épingles et le panneau de fils.</p> `);
							artifactBody($$renderer);
							$$renderer.push(`<!---->`);
						}
						$$renderer.push(`<!--]-->`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
	});
}
export { _page as default };

//# sourceMappingURL=_page.svelte.js.map