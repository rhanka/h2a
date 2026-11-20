import { createHash } from "node:crypto";
var SECTION_KEY_MAX = 2048;
var ANCHOR_TYPES = /* @__PURE__ */ new Set([
	"text",
	"element",
	"region"
]);
var BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
/**
* Validate and decode a `sectionKey` anchor. Returns a result object instead of throwing: callers decide
* whether a bad anchor is a 400 (a write) or a reason to send `anchor: null` (an already stored row).
* @param {unknown} sectionKey
* @returns {{ ok: true, anchor: Record<string, unknown> } | { ok: false, code: string, message: string, details?: Record<string, unknown> }}
*/
function decodeAnchor(sectionKey) {
	if (typeof sectionKey !== "string" || sectionKey.length === 0) return {
		ok: false,
		code: "invalid_anchor",
		message: "sectionKey must be a non-empty string."
	};
	if (sectionKey.length > 2048) return {
		ok: false,
		code: "section_key_too_long",
		message: `sectionKey is ${sectionKey.length} characters; the cap is ${SECTION_KEY_MAX} (decision D3). Shorten the quote context.`,
		details: { maxLength: SECTION_KEY_MAX }
	};
	if (!sectionKey.startsWith("a1:")) return {
		ok: false,
		code: "invalid_anchor",
		message: `sectionKey must use the review kit anchor format "a1:" + base64url(JSON).`
	};
	const encoded = sectionKey.slice(3);
	if (!BASE64URL.test(encoded)) return {
		ok: false,
		code: "invalid_anchor",
		message: "sectionKey anchor payload is not base64url."
	};
	/** @type {unknown} */
	let payload;
	try {
		payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		return {
			ok: false,
			code: "invalid_anchor",
			message: "sectionKey anchor payload is not JSON."
		};
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {
		ok: false,
		code: "invalid_anchor",
		message: "sectionKey anchor payload must be a JSON object."
	};
	const anchor = payload;
	if (typeof anchor.t !== "string" || !ANCHOR_TYPES.has(anchor.t)) return {
		ok: false,
		code: "invalid_anchor",
		message: `sectionKey anchor type must be one of ${[...ANCHOR_TYPES].join(", ")}.`
	};
	return {
		ok: true,
		anchor
	};
}
/**
* A bounded excerpt of a comment body for the h2a send payload: the envelope never carries more than this.
* @param {string} body
* @param {number} [max]
* @returns {string}
*/
function excerptOf(body, max = 500) {
	const text = String(body ?? "").replace(/\s+/g, " ").trim();
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
// src/lib/server/artifact-review/errors.js
var ReviewError = class extends Error {
	/**
	* @param {string} code      Stable machine code (snake_case).
	* @param {number} status    HTTP status to answer with.
	* @param {string} message   Human-readable explanation, safe to show in the UI.
	* @param {Record<string, unknown>} [details] Extra fields merged into the error object.
	*/
	constructor(code, status, message, details = {}) {
		super(message);
		this.name = "ReviewError";
		this.code = code;
		this.status = status;
		/** @type {Record<string, unknown>} */
		this.details = details;
	}
};
/**
* Coerce any thrown value into a ReviewError. Unknown errors become `internal_error` with their message:
* the message is kept because hiding it would leave the operator with nothing to act on.
* @param {unknown} error
* @returns {ReviewError}
*/
function asReviewError(error) {
	if (error instanceof ReviewError) return error;
	return new ReviewError("internal_error", 500, (error instanceof Error ? error.message : String(error)) || "Unexpected artifact review failure.");
}
/**
* The JSON body of an error response.
* @param {unknown} error
* @returns {{ error: { code: string, message: string } & Record<string, unknown> }}
*/
function errorBody(error) {
	const failure = asReviewError(error);
	return { error: {
		code: failure.code,
		message: failure.message,
		...failure.details
	} };
}
// src/lib/server/artifact-review/comments-adapter.js
/** @typedef {import('./types').ReviewComment} ReviewComment */
/** @typedef {import('./types').CommentsAdapter} CommentsAdapter */
/** @typedef {import('./types').CommentProvenance} CommentProvenance */
/** @typedef {import('./types').CommentAuthorship} CommentAuthorship */
/** @typedef {import('./types').CollaborationActor} CollaborationActor */
/** @typedef {import('./types').TenantContext} TenantContext */
/** @typedef {import('./types').ReviewOwner} ReviewOwner */
/** @typedef {import('./types').ResolveAgentFn} ResolveAgentFn */
/** @typedef {import('./types').ActorKind} ActorKind */
var AVATAR_COLORS = [
	"#2563eb",
	"#7c3aed",
	"#db2777",
	"#ea580c",
	"#16a34a",
	"#0891b2",
	"#ca8a04",
	"#4f46e5"
];
var PROVENANCE_FIELD_MAX = 256;
var GENERIC_AGENT_ID = "agent:generic";
/**
* @param {unknown} value
* @returns {value is Record<string, any>}
*/
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/**
* Deterministic display-only `CollaborationActor` (DS r6 §1.3). `color` is derived, never persisted.
* Actor `kind` is always explicit and never inferred from an id string.
* @param {{ actorId: string, kind: ActorKind, displayLabel?: string }} input
* @returns {CollaborationActor}
*/
function buildCollaborationActor({ actorId, kind, displayLabel }) {
	const digest = createHash("sha256").update(actorId).digest();
	return {
		actorId,
		kind,
		displayLabel: displayLabel && displayLabel.trim() ? displayLabel.trim() : actorId,
		color: AVATAR_COLORS[digest[0] % AVATAR_COLORS.length]
	};
}
/**
* DS r6 §1.3 / §4 predicate: a comment is human iff `provenance.toolCallId` is absent/empty.
* Used by both `authorship` enrichment and the `onCommentCreated` -> `h2a send` filter.
* @param {{ provenance?: CommentProvenance } | null | undefined} comment
* @returns {boolean}
*/
function isHumanComment(comment) {
	const toolCallId = comment?.provenance?.toolCallId;
	return !(typeof toolCallId === "string" && toolCallId.trim().length > 0);
}
/**
* Pre-send check for non-human writes (DS r6 §1.3, split MCP vs HTTP):
* whenever `provenance` is supplied OR the caller declares itself non-human (`actorKind: 'agent' | 'nhi'`),
* `provenance.toolCallId` MUST be a non-empty trimmed string (<= 256 chars).
* @param {CommentProvenance | undefined} provenance
* @param {ActorKind | undefined} [actorKind]
* @returns {CommentProvenance | undefined}
*/
function validateNonHumanProvenance(provenance, actorKind) {
	if (provenance === void 0 && !(actorKind === "agent" || actorKind === "nhi")) return void 0;
	if (!isRecord(provenance)) throw new ReviewError("invalid_provenance", 400, "Non-human comment writes require provenance.toolCallId (non-empty string, e.g. agent:<sessionId>:<seq> outside MCP).");
	if (typeof provenance.toolCallId !== "string" || provenance.toolCallId.trim().length === 0 || provenance.toolCallId.length > PROVENANCE_FIELD_MAX) throw new ReviewError("invalid_provenance", 400, `provenance.toolCallId must be a non-empty string of at most ${PROVENANCE_FIELD_MAX} characters on non-human writes.`);
	/** @type {CommentProvenance} */
	const out = { toolCallId: provenance.toolCallId.trim() };
	if (provenance.runId !== void 0 && provenance.runId !== null) {
		if (typeof provenance.runId !== "string" || provenance.runId.trim().length === 0 || provenance.runId.length > PROVENANCE_FIELD_MAX) throw new ReviewError("invalid_provenance", 400, `provenance.runId, when supplied, must be a non-empty string of at most ${PROVENANCE_FIELD_MAX} characters.`);
		out.runId = provenance.runId.trim();
	}
	return out;
}
/**
* Pre-send D3 cap check on `sectionKey` (2048 chars).
* @param {string | undefined} sectionKey
*/
function assertSectionKeyCap(sectionKey) {
	if (typeof sectionKey === "string" && sectionKey.length > 2048) throw new ReviewError("section_key_too_long", 400, `sectionKey is ${sectionKey.length} characters; the cap is ${SECTION_KEY_MAX} (decision D3).`, { maxLength: SECTION_KEY_MAX });
}
/**
* @param {unknown} target
* @returns {ReviewComment['target'] | null}
*/
function normalizeTarget(target) {
	if (!isRecord(target) || typeof target.id !== "string") return null;
	if (!(target.kind === "artifact" || target.kind === "record" && target.recordType === "artifact")) return null;
	return typeof target.sectionKey === "string" && target.sectionKey.length > 0 ? {
		kind: "artifact",
		id: target.id,
		sectionKey: target.sectionKey
	} : {
		kind: "artifact",
		id: target.id
	};
}
/**
* DS r6 §1.1: single truth `'open' | 'closed'`. No `'resolved'` literal is accepted or mapped.
* @param {unknown} state
* @returns {'open' | 'closed'}
*/
function normalizeState(state) {
	if (state === "open" || state === "closed") return state;
	throw new ReviewError("store_contract_violation", 502, `The comment store returned an unknown thread state (${JSON.stringify(state)}); expected open or closed.`);
}
/**
* @param {unknown} provenance
* @returns {CommentProvenance | undefined}
*/
function normalizeProvenance(provenance) {
	if (!isRecord(provenance)) return void 0;
	/** @type {CommentProvenance} */
	const out = {};
	if (typeof provenance.toolCallId === "string" && provenance.toolCallId.trim()) out.toolCallId = provenance.toolCallId.trim();
	if (typeof provenance.runId === "string" && provenance.runId.trim()) out.runId = provenance.runId.trim();
	return out.toolCallId || out.runId ? out : void 0;
}
/**
* Derive DS r6 §1.3 `authorship` view model from a normalized comment row.
* - Rows without non-empty `provenance.toolCallId` are human (`author` = human actor, no `sponsor`).
* - Rows with non-empty `provenance.toolCallId` are agent/NHI under the owner-id fallback (`sponsor` =
*   human owner of record, `author` = resolved live agent or generic « Agent », `runId` enriched host-side).
* `author.actorId` is always distinct from `sponsor.actorId` on agent rows so "Mine" and unread rules
* comparing `authorship.author.actorId` never classify an agent reply as the owner's own human comment.
*
* @param {Omit<ReviewComment, 'authorship'>} comment
* @param {{
*   owner?: ReviewOwner,
*   participants?: Record<string, { displayLabel: string }>,
*   resolveAgent?: ResolveAgentFn
* }} [options]
* @returns {CommentAuthorship}
*/
function enrichAuthorship(comment, options = {}) {
	const owner = options.owner;
	const humanLabel = (options.participants?.[comment.author.id])?.displayLabel ?? (owner && comment.author.id === owner.id ? owner.displayLabel : void 0) ?? comment.author.displayLabel ?? comment.author.id;
	const humanActor = buildCollaborationActor({
		actorId: comment.author.id,
		kind: "human",
		displayLabel: humanLabel
	});
	const toolCallId = comment.provenance?.toolCallId;
	if (typeof toolCallId === "string" && toolCallId.trim().length > 0) {
		const resolved = options.resolveAgent?.({
			comment,
			toolCallId: toolCallId.trim(),
			runId: comment.provenance?.runId
		});
		const fallbackRunId = comment.provenance?.runId;
		let agentActorId = resolved?.actorId?.trim() || fallbackRunId || GENERIC_AGENT_ID;
		if (agentActorId === humanActor.actorId) agentActorId = `agent:${agentActorId}`;
		const agentKind = resolved?.kind === "nhi" ? "nhi" : "agent";
		const agentLabel = resolved?.displayLabel?.trim() || "Agent";
		const liveRunId = resolved?.runId ?? fallbackRunId;
		return {
			author: buildCollaborationActor({
				actorId: agentActorId,
				kind: agentKind,
				displayLabel: agentLabel
			}),
			sponsor: humanActor,
			...liveRunId ? { runId: liveRunId } : {}
		};
	}
	return { author: humanActor };
}
/**
* Normalise one store row to the r6 `ReviewComment` shape, or `null` when the row is not an artifact comment.
* @param {unknown} raw
* @param {{
*   owner?: ReviewOwner,
*   participants?: Record<string, { displayLabel: string }>,
*   resolveAgent?: ResolveAgentFn
* }} [enrichment]
* @returns {ReviewComment | null}
*/
function normalizeComment(raw, enrichment) {
	if (!isRecord(raw)) return null;
	const target = normalizeTarget(raw.target);
	if (!target) return null;
	if (typeof raw.id !== "string" || typeof raw.threadId !== "string") throw new ReviewError("store_contract_violation", 502, "The comment store returned a row without id or threadId.");
	const author = isRecord(raw.author) && typeof raw.author.id === "string" ? raw.author : null;
	if (!author) throw new ReviewError("store_contract_violation", 502, `Comment ${raw.id} has no author id.`);
	const provenance = normalizeProvenance(raw.provenance);
	/** @type {Omit<ReviewComment, 'authorship'>} */
	const base = {
		id: raw.id,
		...isRecord(raw.tenant) ? { tenant: { ...raw.tenant } } : {},
		target,
		threadId: raw.threadId,
		author: {
			id: author.id,
			...author.kind === "human" || author.kind === "agent" || author.kind === "nhi" ? { kind: author.kind } : {},
			...typeof author.displayLabel === "string" && author.displayLabel ? { displayLabel: author.displayLabel } : {}
		},
		...typeof raw.assignedTo === "string" && raw.assignedTo ? { assignedTo: raw.assignedTo } : {},
		state: normalizeState(raw.state),
		body: typeof raw.body === "string" ? raw.body : String(raw.body ?? ""),
		...provenance ? { provenance } : {},
		createdAt: String(raw.createdAt),
		...raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}
	};
	const authorship = enrichAuthorship(base, enrichment);
	const { createdAt, updatedAt, ...head } = base;
	return {
		...head,
		authorship,
		createdAt,
		...updatedAt ? { updatedAt } : {}
	};
}
/**
* createdAt ASC, then id ASC — the port's documented order, re-applied so both bindings agree.
* @param {ReviewComment} a
* @param {ReviewComment} b
*/
function byCreatedThenId(a, b) {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	if (a.id !== b.id) return a.id < b.id ? -1 : 1;
	return 0;
}
/**
* @param {unknown[]} rows
* @param {string} artifactId
* @param {{ owner?: ReviewOwner, participants?: Record<string, { displayLabel: string }>, resolveAgent?: ResolveAgentFn }} [enrichment]
* @returns {ReviewComment[]}
*/
function artifactRows(rows, artifactId, enrichment) {
	if (!Array.isArray(rows)) throw new ReviewError("store_contract_violation", 502, "The comment store did not return a list.");
	return rows.map((row) => normalizeComment(row, enrichment)).filter(
		/** @returns {c is ReviewComment} */
		(c) => c !== null && c.target.id === artifactId
	).sort(byCreatedThenId);
}
/**
* Flat rows grouped by `threadId` (DS r6: flat threads), threads ordered by their first row.
* @param {ReviewComment[]} comments
* @returns {ReviewComment[][]}
*/
function groupThreads(comments) {
	/** @type {Map<string, ReviewComment[]>} */
	const threads = /* @__PURE__ */ new Map();
	for (const comment of [...comments].sort(byCreatedThenId)) {
		const rows = threads.get(comment.threadId);
		if (rows) rows.push(comment);
		else threads.set(comment.threadId, [comment]);
	}
	return [...threads.values()];
}
/**
* Thread state as the store and the kit read it: closed as soon as one row is closed (DS r6 §1),
* open otherwise.
* @param {ReviewComment[]} rows
* @returns {'open' | 'closed'}
*/
function threadState(rows) {
	return rows.some((row) => row.state === "closed") ? "closed" : "open";
}
/**
* Thread assignee as the store reads it: first defined assignee across surviving rows, or `null`.
* @param {ReviewComment[]} rows
* @returns {string | null}
*/
function threadAssignee(rows) {
	return rows.find((row) => typeof row.assignedTo === "string" && row.assignedTo.length > 0)?.assignedTo ?? null;
}
/**
* DS r6 §1/§2: derive the thread's anchor `sectionKey` from the FIRST chronological row carrying one,
* so deleting the root row keeps the anchor as long as a surviving reply carries it.
* @param {ReviewComment[]} rows
* @returns {string | undefined}
*/
function threadAnchorSectionKey(rows) {
	return [...rows].sort(byCreatedThenId).find((row) => typeof row.target.sectionKey === "string" && row.target.sectionKey.length > 0)?.target.sectionKey;
}
/**
* @param {unknown} error
* @param {string} id
* @param {'thread' | 'comment'} [kind]
*/
function storeFailure(error, id, kind = "thread") {
	const name = isRecord(error) ? error.name : void 0;
	if (name === "ThreadNotFoundError") return new ReviewError("thread_not_found", 404, `Thread ${id} does not exist on this artifact.`);
	if (name === "CommentNotFoundError") return new ReviewError(kind === "thread" ? "thread_not_found" : "comment_not_found", 404, `${kind === "thread" ? "Thread" : "Comment"} ${id} does not exist on this artifact.`);
	if (error instanceof ReviewError) return error;
	return new ReviewError("store_rejected", 502, `The comment store refused the write: ${error instanceof Error ? error.message : String(error)}`);
}
/**
* Create a lightweight `onCommentCreated` hook emitter shared by adapter bindings.
*/
function createCreatedBus() {
	/** @type {Set<(comment: ReviewComment) => void>} */
	const listeners = /* @__PURE__ */ new Set();
	return {
		/** @param {(comment: ReviewComment) => void} listener */
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** @param {ReviewComment} comment */
		emit(comment) {
			for (const listener of [...listeners]) try {
				listener(comment);
			} catch {}
		}
	};
}
/**
* Binding over a `CommentStore` port instance (`@sentropic/comments`, L0 interim stub outside H5).
* Speaks DS r6 directly: `open | closed` with no state translation, `tenant` per verb, typed `reply`,
* `edit`, `remove`, `assign(..., null)`, and host-enriched `authorship`.
*
* @param {{
*   store: import('./types').CommentStorePort,
*   tenant: TenantContext,
*   owner?: ReviewOwner,
*   participants?: Record<string, { displayLabel: string }>,
*   resolveAgent?: ResolveAgentFn,
*   info?: import('./types').StoreInfo
* }} options
* @returns {CommentsAdapter}
*/
function createStorePortAdapter({ store, tenant, owner, participants, resolveAgent, info }) {
	const baseTenant = { ...tenant };
	const enrichment = {
		owner,
		participants,
		resolveAgent
	};
	const createdBus = createCreatedBus();
	/** @param {string | undefined} workspaceId */
	const scopeFor = (workspaceId) => ({
		...baseTenant,
		workspaceId: typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : baseTenant.workspaceId
	});
	/**
	* @param {string} workspaceId
	* @param {{ kind: 'artifact', id: string }} target
	* @param {string} threadId
	*/
	async function listThread(workspaceId, target, threadId) {
		return artifactRows(await store.listThread(scopeFor(workspaceId), threadId), target.id, enrichment);
	}
	/**
	* @param {string} workspaceId
	* @param {{ kind: 'artifact', id: string }} target
	* @param {string} threadId
	* @param {string} id
	*/
	async function readBack(workspaceId, target, threadId, id) {
		const saved = (await listThread(workspaceId, target, threadId)).find((row) => row.id === id);
		if (!saved) throw new ReviewError("not_saved", 502, `The comment store accepted comment ${id} but does not return it on read-back; it is not shown as saved.`);
		return saved;
	}
	/**
	* @param {{
	*   tenant: string,
	*   target: { kind: 'artifact', id: string, sectionKey?: string },
	*   body: string,
	*   author?: import('./types').CommentAuthor,
	*   provenance?: CommentProvenance,
	*   actorKind?: ActorKind,
	*   threadId?: string
	* }} input
	*/
	async function add(input) {
		const provenance = validateNonHumanProvenance(input.provenance, input.actorKind);
		assertSectionKeyCap(input.target.sectionKey);
		const scope = scopeFor(input.tenant);
		const authorId = input.author?.id ?? owner?.id ?? baseTenant.userId;
		/** @type {unknown} */
		let created;
		try {
			created = await store.add(scope, {
				tenant: scope,
				target: {
					kind: "artifact",
					id: input.target.id,
					...input.target.sectionKey ? { sectionKey: input.target.sectionKey } : {}
				},
				author: { id: authorId },
				body: input.body,
				...input.threadId ? { threadId: input.threadId } : {},
				...provenance ? { provenance } : {}
			});
		} catch (error) {
			throw storeFailure(error, input.threadId ?? "(new)", "thread");
		}
		if (!isRecord(created) || typeof created.id !== "string" || typeof created.threadId !== "string") throw new ReviewError("not_saved", 502, "The comment store did not return the created comment.");
		const saved = await readBack(input.tenant, input.target, created.threadId, created.id);
		createdBus.emit(saved);
		return saved;
	}
	return {
		store: info ?? {
			kind: "store-port",
			durable: false,
			label: "CommentStore port"
		},
		polling: false,
		onCommentCreated: createdBus.subscribe,
		async list(workspaceId, target) {
			return artifactRows(await store.listByTarget(scopeFor(workspaceId), {
				kind: "artifact",
				id: target.id
			}), target.id, enrichment);
		},
		listThread,
		create(input) {
			return add(input);
		},
		async reply(input) {
			const provenance = validateNonHumanProvenance(input.provenance, input.actorKind);
			assertSectionKeyCap(input.target.sectionKey);
			const thread = await listThread(input.tenant, input.target, input.threadId);
			if (thread.length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${input.threadId} does not exist on this artifact.`);
			const sectionKey = input.target.sectionKey ?? threadAnchorSectionKey(thread);
			return add({
				...input,
				target: {
					kind: "artifact",
					id: input.target.id,
					...sectionKey ? { sectionKey } : {}
				},
				...provenance ? { provenance } : {}
			});
		},
		async edit({ tenant: workspaceId, target, commentId, body }) {
			if (typeof store.edit !== "function") throw new ReviewError("store_unsupported", 501, "The comment store port does not support edit.");
			const scope = scopeFor(workspaceId);
			const existing = (await this.list(workspaceId, target)).find((row) => row.id === commentId);
			if (!existing) throw new ReviewError("comment_not_found", 404, `Comment ${commentId} does not exist on this artifact.`);
			try {
				await store.edit(scope, commentId, { body });
			} catch (error) {
				throw storeFailure(error, commentId, "comment");
			}
			const updated = (await listThread(workspaceId, target, existing.threadId)).find((row) => row.id === commentId);
			if (!updated || updated.body !== body) throw new ReviewError("not_saved", 502, `The comment store did not apply the edit to comment ${commentId}.`);
			return updated;
		},
		async remove({ tenant: workspaceId, target, commentId }) {
			if (typeof store.delete !== "function") throw new ReviewError("store_unsupported", 501, "The comment store port does not support delete.");
			const scope = scopeFor(workspaceId);
			if (!(await this.list(workspaceId, target)).find((row) => row.id === commentId)) throw new ReviewError("comment_not_found", 404, `Comment ${commentId} does not exist on this artifact.`);
			try {
				await store.delete(scope, commentId);
			} catch (error) {
				throw storeFailure(error, commentId, "comment");
			}
			if ((await this.list(workspaceId, target)).some((row) => row.id === commentId)) throw new ReviewError("not_saved", 502, `The comment store accepted deletion of ${commentId} but still returns it on read-back.`);
		},
		async setState({ tenant: workspaceId, target, threadId, state }) {
			if ((await listThread(workspaceId, target, threadId)).length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${threadId} does not exist on this artifact.`);
			try {
				await store.setState(scopeFor(workspaceId), threadId, state);
			} catch (error) {
				throw storeFailure(error, threadId, "thread");
			}
			const rows = await listThread(workspaceId, target, threadId);
			if (threadState(rows) !== state) throw new ReviewError("not_saved", 502, `The comment store did not apply state ${state} to thread ${threadId} (read-back shows ${threadState(rows)}).`);
			return rows;
		},
		async assign({ tenant: workspaceId, target, threadId, assigneeId }) {
			if (typeof store.assign !== "function") throw new ReviewError("store_unsupported", 501, "The comment store port does not support assign.");
			if ((await listThread(workspaceId, target, threadId)).length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${threadId} does not exist on this artifact.`);
			try {
				await store.assign(scopeFor(workspaceId), threadId, assigneeId);
			} catch (error) {
				throw storeFailure(error, threadId, "thread");
			}
			const rows = await listThread(workspaceId, target, threadId);
			const actual = threadAssignee(rows);
			if (actual !== assigneeId) throw new ReviewError("not_saved", 502, `The comment store did not apply assignee ${JSON.stringify(assigneeId)} to thread ${threadId} (read-back shows ${JSON.stringify(actual)}).`);
			return rows;
		}
	};
}
/**
* Binding over the dedicated cluster-mesh artifact-comments HTTP router (sentropic lots C2b/C2c):
*   - GET    comments?workspace_id=<tenant>&context_type=artifact&context_id=<artifactId>
*   - GET    threads/:threadId?workspace_id=<tenant>&context_id=<artifactId>
*   - POST   comments                        (create / reply with provenance + HTTP non-human discriminant)
*   - PATCH  comments/:commentId             (edit body by comment id)
*   - DELETE comments/:commentId             (hard delete by comment id)
*   - POST   threads/:threadId/close|reopen  (setState by threadId, single truth open|closed)
*   - POST   threads/:threadId/assign        (assign by threadId, preserving assigned_to: null)
*
* @param {{
*   baseUrl: string,
*   token?: string,
*   tenant: TenantContext,
*   owner?: ReviewOwner,
*   participants?: Record<string, { displayLabel: string }>,
*   resolveAgent?: ResolveAgentFn,
*   fetchImpl?: typeof fetch
* }} options
* @returns {CommentsAdapter}
*/
function createClusterMeshHttpAdapter({ baseUrl, token, tenant, owner, participants, resolveAgent, fetchImpl = fetch }) {
	/** @type {URL} */
	let base;
	try {
		base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
	} catch {
		throw new ReviewError("comments_misconfigured", 500, "FOCUS_COMMENTS_URL is not a valid URL.");
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") throw new ReviewError("comments_misconfigured", 500, "FOCUS_COMMENTS_URL must be an http(s) URL.");
	const endpoint = base.origin + base.pathname.replace(/\/$/, "");
	const enrichment = {
		owner,
		participants,
		resolveAgent
	};
	const createdBus = createCreatedBus();
	/**
	* @param {string} path
	* @param {{ method?: string, body?: unknown, headers?: Record<string, string>, allowNotFound?: boolean }} [init]
	* @returns {Promise<any>}
	*/
	async function call(path, init = {}) {
		/** @type {Record<string, string>} */
		const headers = {
			accept: "application/json",
			...init.headers ?? {}
		};
		if (init.body !== void 0) headers["content-type"] = "application/json";
		if (token) headers.authorization = `Bearer ${token}`;
		/** @type {Response} */
		let response;
		try {
			response = await fetchImpl(new URL(path, base), {
				method: init.method ?? "GET",
				headers,
				...init.body !== void 0 ? { body: JSON.stringify(init.body) } : {}
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new ReviewError("comments_unavailable", 503, `The cluster-mesh comments endpoint ${endpoint} is unreachable (${reason}); nothing was written.`);
		}
		const raw = await response.text();
		/** @type {any} */
		let payload = null;
		try {
			payload = raw ? JSON.parse(raw) : null;
		} catch {
			payload = null;
		}
		if (!response.ok) {
			if (init.allowNotFound && response.status === 404) return null;
			const upstreamError = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
			const upstreamCode = isRecord(upstreamError) && typeof upstreamError.code === "string" ? upstreamError.code : void 0;
			const said = isRecord(upstreamError) && (upstreamError.message || upstreamError.error) || response.statusText || "no message";
			if (response.status === 400 && upstreamCode === "section_key_too_long") throw new ReviewError("section_key_too_long", 400, String(said), { maxLength: isRecord(upstreamError) && typeof upstreamError.maxLength === "number" ? upstreamError.maxLength : SECTION_KEY_MAX });
			if (response.status === 400 && upstreamCode === "invalid_provenance") throw new ReviewError("invalid_provenance", 400, String(said));
			if (response.status === 400 && upstreamCode === "invalid_assignee") throw new ReviewError("invalid_assignee", 400, String(said));
			if (response.status === 403) throw new ReviewError("forbidden", 403, String(said), { upstreamStatus: 403 });
			if (response.status === 404 && (upstreamCode === "thread_not_found" || upstreamCode === "comment_not_found")) throw new ReviewError(upstreamCode, 404, String(said), { upstreamStatus: 404 });
			throw new ReviewError("store_rejected", 502, `The cluster-mesh comments endpoint refused ${init.method ?? "GET"} ${path} (HTTP ${response.status}: ${String(said)}).`, {
				upstreamStatus: response.status,
				...upstreamCode ? { upstreamCode } : {}
			});
		}
		return payload;
	}
	/**
	* @param {any} item
	* @param {string} workspaceId
	* @returns {unknown}
	*/
	function fromWire(item, workspaceId) {
		if (!isRecord(item)) return null;
		const wireToolCallId = isRecord(item.provenance) && typeof item.provenance.toolCallId === "string" && item.provenance.toolCallId || isRecord(item.provenance) && typeof item.provenance.tool_call_id === "string" && item.provenance.tool_call_id || typeof item.tool_call_id === "string" && item.tool_call_id || void 0;
		const wireRunId = isRecord(item.provenance) && typeof item.provenance.runId === "string" && item.provenance.runId || isRecord(item.provenance) && typeof item.provenance.run_id === "string" && item.provenance.run_id || void 0;
		const provenance = wireToolCallId || wireRunId ? {
			...wireToolCallId ? { toolCallId: wireToolCallId } : {},
			...wireRunId ? { runId: wireRunId } : {}
		} : void 0;
		const contextType = item.context_type ?? item.target?.recordType ?? item.target?.kind;
		const contextId = item.context_id ?? item.target?.id;
		const sectionKey = item.section_key ?? item.target?.sectionKey;
		return {
			id: item.id,
			tenant: {
				...tenant,
				workspaceId: typeof item.workspace_id === "string" && item.workspace_id ? item.workspace_id : workspaceId,
				...typeof item.created_by === "string" ? { userId: item.created_by } : {}
			},
			target: {
				kind: contextType === "artifact" ? "artifact" : "record",
				id: contextId,
				...contextType !== "artifact" && typeof contextType === "string" ? { recordType: contextType } : {},
				...typeof sectionKey === "string" && sectionKey ? { sectionKey } : {}
			},
			threadId: item.thread_id ?? item.threadId,
			author: { id: item.created_by ?? item.author?.id },
			...typeof item.assigned_to === "string" && item.assigned_to ? { assignedTo: item.assigned_to } : typeof item.assignedTo === "string" && item.assignedTo ? { assignedTo: item.assignedTo } : {},
			state: item.status ?? item.state,
			body: item.content ?? item.body,
			...provenance ? { provenance } : {},
			createdAt: item.created_at ?? item.createdAt,
			...item.updated_at && item.updated_at !== item.created_at ? { updatedAt: item.updated_at } : item.updatedAt && item.updatedAt !== item.createdAt ? { updatedAt: item.updatedAt } : {}
		};
	}
	/**
	* @param {string} workspaceId
	* @param {{ kind: 'artifact', id: string }} target
	*/
	async function list(workspaceId, target) {
		const scopeWorkspace = workspaceId || tenant.workspaceId;
		const payload = await call(`comments?${new URLSearchParams({
			workspace_id: scopeWorkspace,
			context_type: "artifact",
			context_id: target.id
		})}`);
		if (!isRecord(payload) || !Array.isArray(payload.items)) throw new ReviewError("store_contract_violation", 502, "The cluster-mesh comments endpoint did not return { items }.");
		return artifactRows(payload.items.map((item) => fromWire(item, scopeWorkspace)), target.id, enrichment);
	}
	/**
	* @param {string} workspaceId
	* @param {{ kind: 'artifact', id: string }} target
	* @param {string} threadId
	*/
	async function listThread(workspaceId, target, threadId) {
		const scopeWorkspace = workspaceId || tenant.workspaceId;
		const query = new URLSearchParams({
			workspace_id: scopeWorkspace,
			context_id: target.id
		});
		const payload = await call(`threads/${encodeURIComponent(threadId)}?${query}`, { allowNotFound: true });
		if (payload === null) return [];
		const items = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.items) ? payload.items : null;
		if (!items) throw new ReviewError("store_contract_violation", 502, "The cluster-mesh comments endpoint did not return { items } for listThread.");
		return artifactRows(items.map((item) => fromWire(item, scopeWorkspace)), target.id, enrichment).filter((row) => row.threadId === threadId);
	}
	/**
	* @param {{
	*   tenant: string,
	*   target: { kind: 'artifact', id: string, sectionKey?: string },
	*   body: string,
	*   threadId?: string,
	*   provenance?: CommentProvenance,
	*   actorKind?: ActorKind
	* }} input
	*/
	async function post(input) {
		const provenance = validateNonHumanProvenance(input.provenance, input.actorKind);
		assertSectionKeyCap(input.target.sectionKey);
		const scopeWorkspace = input.tenant || tenant.workspaceId;
		const nonHumanKind = provenance ? input.actorKind === "nhi" ? "nhi" : "agent" : void 0;
		const created = await call("comments", {
			method: "POST",
			headers: nonHumanKind ? { "x-actor-kind": nonHumanKind } : {},
			body: {
				workspace_id: scopeWorkspace,
				context_type: "artifact",
				context_id: input.target.id,
				...input.target.sectionKey ? { section_key: input.target.sectionKey } : {},
				content: input.body,
				...input.threadId ? { thread_id: input.threadId } : {},
				...provenance ? {
					actor_kind: nonHumanKind,
					tool_call_id: provenance.toolCallId,
					provenance: {
						tool_call_id: provenance.toolCallId,
						...provenance.runId ? { run_id: provenance.runId } : {}
					}
				} : {}
			}
		});
		if (!isRecord(created) || typeof created.id !== "string") throw new ReviewError("not_saved", 502, "The cluster-mesh comments endpoint did not return the created comment id.");
		const threadId = typeof created.thread_id === "string" ? created.thread_id : typeof created.threadId === "string" ? created.threadId : input.threadId;
		const saved = (threadId ? await listThread(scopeWorkspace, input.target, threadId) : await list(scopeWorkspace, input.target)).find((row) => row.id === created.id);
		if (!saved) throw new ReviewError("not_saved", 502, `The cluster-mesh comments endpoint accepted comment ${created.id} but does not return it on read-back.`);
		createdBus.emit(saved);
		return saved;
	}
	return {
		store: {
			kind: "cluster-mesh-http",
			durable: true,
			label: `cluster-mesh comments endpoint ${endpoint}`
		},
		polling: true,
		onCommentCreated: createdBus.subscribe,
		list,
		listThread,
		async create(input) {
			return post(input);
		},
		async reply(input) {
			validateNonHumanProvenance(input.provenance, input.actorKind);
			assertSectionKeyCap(input.target.sectionKey);
			const thread = await listThread(input.tenant, input.target, input.threadId);
			if (thread.length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${input.threadId} does not exist on this artifact.`);
			const sectionKey = input.target.sectionKey ?? threadAnchorSectionKey(thread);
			return post({
				...input,
				target: {
					kind: "artifact",
					id: input.target.id,
					...sectionKey ? { sectionKey } : {}
				}
			});
		},
		async edit({ tenant: workspaceId, target, commentId, body }) {
			const scopeWorkspace = workspaceId || tenant.workspaceId;
			await call(`comments/${encodeURIComponent(commentId)}`, {
				method: "PATCH",
				body: {
					workspace_id: scopeWorkspace,
					content: body
				}
			});
			const updated = (await list(scopeWorkspace, target)).find((row) => row.id === commentId);
			if (!updated || updated.body !== body) throw new ReviewError("not_saved", 502, `The cluster-mesh comments endpoint did not apply the edit to comment ${commentId}.`);
			return updated;
		},
		async remove({ tenant: workspaceId, target, commentId }) {
			const scopeWorkspace = workspaceId || tenant.workspaceId;
			const query = new URLSearchParams({ workspace_id: scopeWorkspace });
			await call(`comments/${encodeURIComponent(commentId)}?${query}`, { method: "DELETE" });
			if ((await list(scopeWorkspace, target)).some((row) => row.id === commentId)) throw new ReviewError("not_saved", 502, `The cluster-mesh comments endpoint accepted deletion of ${commentId} but still returns it on read-back.`);
		},
		async setState({ tenant: workspaceId, target, threadId, state }) {
			const scopeWorkspace = workspaceId || tenant.workspaceId;
			if ((await listThread(scopeWorkspace, target, threadId)).length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${threadId} does not exist on this artifact.`);
			await call(`threads/${encodeURIComponent(threadId)}/${state === "closed" ? "close" : "reopen"}`, {
				method: "POST",
				body: {
					workspace_id: scopeWorkspace,
					state
				}
			});
			const rows = await listThread(scopeWorkspace, target, threadId);
			if (threadState(rows) !== state) throw new ReviewError("not_saved", 502, `The cluster-mesh comments endpoint did not apply state ${state} to thread ${threadId}.`);
			return rows;
		},
		async assign({ tenant: workspaceId, target, threadId, assigneeId }) {
			const scopeWorkspace = workspaceId || tenant.workspaceId;
			if ((await listThread(scopeWorkspace, target, threadId)).length === 0) throw new ReviewError("thread_not_found", 404, `Thread ${threadId} does not exist on this artifact.`);
			await call(`threads/${encodeURIComponent(threadId)}/assign`, {
				method: "POST",
				body: {
					workspace_id: scopeWorkspace,
					assigned_to: assigneeId
				}
			});
			const rows = await listThread(scopeWorkspace, target, threadId);
			if (threadAssignee(rows) !== assigneeId) throw new ReviewError("not_saved", 502, `The cluster-mesh comments endpoint did not apply assignee ${JSON.stringify(assigneeId)} to thread ${threadId}.`);
			return rows;
		}
	};
}
/**
* Fail-closed adapter for AR-3 (`comments unavailable (missing binding)`): refuses every read/write
* with 503 `comments_unavailable` and never persists anything anywhere.
* @param {string} [reason]
* @returns {CommentsAdapter}
*/
function createMissingBindingAdapter(reason = "comments unavailable (missing binding): configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.") {
	const refuse = async () => {
		throw new ReviewError("comments_unavailable", 503, reason);
	};
	return {
		store: {
			kind: "unconfigured",
			durable: false,
			label: "comments unavailable (missing binding)"
		},
		polling: false,
		list: refuse,
		listThread: refuse,
		create: refuse,
		reply: refuse,
		edit: refuse,
		remove: refuse,
		setState: refuse,
		assign: refuse
	};
}
// src/lib/server/artifact-review/config.js
var TRUE = /* @__PURE__ */ new Set([
	"1",
	"true",
	"yes",
	"on"
]);
/**
* @param {string | undefined} value
* @returns {string | undefined}
*/
function text(value) {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* @param {string | undefined} value
* @returns {string[] | undefined}
*/
function csvList(value) {
	const raw = text(value);
	if (!raw) return void 0;
	const items = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
	return items.length > 0 ? [...new Set(items)] : void 0;
}
/**
* @param {string | undefined} value
* @param {number} fallback
* @param {number} min
* @param {number} max
*/
function boundedInt(value, fallback, min, max) {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}
/**
* @param {string | undefined} value
* @returns {boolean}
*/
function isArtifactReviewEnabled(value) {
	return TRUE.has(String(value ?? "").trim().toLowerCase());
}
/**
* @param {Record<string, string | undefined>} env
* @returns {import('./types').ReviewConfig}
*/
function readReviewConfig(env) {
	const ownerId = text(env.FOCUS_REVIEW_OWNER_ID) ?? "local-owner";
	const configuredMembers = csvList(env.FOCUS_REVIEW_MEMBERS);
	const workspaceMembers = configuredMembers ? [.../* @__PURE__ */ new Set([ownerId, ...configuredMembers])] : void 0;
	return {
		enabled: isArtifactReviewEnabled(env.FOCUS_ARTIFACT_REVIEW),
		commentsUrl: text(env.FOCUS_COMMENTS_URL),
		commentsToken: text(env.FOCUS_COMMENTS_TOKEN),
		requireClusterMesh: isArtifactReviewEnabled(env.FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH),
		tenantId: text(env.FOCUS_COMMENTS_TENANT) ?? "local",
		workspaceId: text(env.FOCUS_COMMENTS_WORKSPACE) ?? "local",
		owner: {
			id: ownerId,
			displayLabel: text(env.FOCUS_REVIEW_OWNER_LABEL) ?? "Owner"
		},
		...workspaceMembers ? { workspaceMembers } : {},
		relayInstance: text(env.FOCUS_REVIEW_RELAY),
		pollMs: boundedInt(env.FOCUS_COMMENTS_POLL_MS, 2e3, 250, 6e4)
	};
}
export { excerptOf as _, createStorePortAdapter as a, threadAnchorSectionKey as c, validateNonHumanProvenance as d, ReviewError as f, decodeAnchor as g, SECTION_KEY_MAX as h, createMissingBindingAdapter as i, threadAssignee as l, errorBody as m, buildCollaborationActor as n, groupThreads as o, asReviewError as p, createClusterMeshHttpAdapter as r, isHumanComment as s, readReviewConfig as t, threadState as u };

//# sourceMappingURL=config2.js.map