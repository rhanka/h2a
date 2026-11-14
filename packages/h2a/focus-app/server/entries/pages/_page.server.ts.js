import { i as kindFr, l as todoRowFr, n as decisionRowFr, o as precoRowFr, t as cleanText, u as loadReport } from "../../chunks/friendly.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
// src/lib/track-model.ts
/**
* ISO date → a short French relative-time string, at day/month/year granularity (never a raw timestamp).
* Cockpit-specific (the terminal FAIT is timeless): `now` stays a parameter, defaulted here at the edge.
*/
function frenchAgo(iso, now = Date.now()) {
	if (!iso) return void 0;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return void 0;
	const days = Math.floor((now - t) / 864e5);
	if (days <= 0) return "aujourd'hui";
	if (days === 1) return "hier";
	if (days < 7) return `il y a ${days} j`;
	if (days < 31) return `il y a ${Math.floor(days / 7)} sem.`;
	if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
	const years = Math.floor(days / 365);
	return `il y a ${years} an${years > 1 ? "s" : ""}`;
}
/**
* The FAIT list: delivered items, French-labelled, length-clamped, DATED, and ordered MOST-RECENT FIRST so
* the report reads as "what was done lately" (dated items float to the top; undated ones fall to the bottom).
* Capped to keep the fold light — the full history stays in track.
*/
function doneList(buckets, dates, limit = 30) {
	return buckets.DONE.map((d) => {
		const t = cleanText(d.title);
		const doneAt = dates[d.id];
		return {
			id: d.id,
			title: t.length > 100 ? t.slice(0, 98) + "…" : t,
			kind: kindFr(d.kind),
			...d.wpLabel ? { wp: d.wpLabel } : {},
			...d.detail?.acceptanceLabel ? { acceptance: d.detail.acceptanceLabel } : {},
			...d.detail?.summary && cleanText(d.detail.summary) !== cleanText(d.title) ? { summary: cleanText(d.detail.summary) } : {},
			...doneAt ? {
				doneAt,
				ago: frenchAgo(doneAt)
			} : {}
		};
	}).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, limit);
}
function buildFocusData(payload) {
	if (!payload.ok) return {
		ok: false,
		error: payload.error
	};
	const v = payload.view;
	const todo = payload.buckets["TO-DO"].length + payload.buckets.AWAITED.length;
	const humanDecisions = v.directives.filter((d) => d.mode === "human-decision");
	return {
		ok: true,
		repo: payload.repo,
		baselineCommit: payload.baselineCommit,
		generatedAt: payload.generatedAt,
		counts: {
			done: payload.buckets.DONE.length,
			todo,
			decisions: humanDecisions.length
		},
		todos: v.directives.map(todoRowFr),
		precos: v.directives.slice(0, 5).map(precoRowFr),
		decisions: humanDecisions.map((d) => decisionRowFr(d, payload.repo)),
		done: doneList(payload.buckets, payload.dates),
		...payload.lastReleaseAt ? { lastReleaseAt: payload.lastReleaseAt } : {},
		...v.keystone ? { keystone: {
			title: cleanText(v.keystone.title),
			blocks: v.keystone.blocks
		} } : {}
	};
}
// src/lib/server/harmonize.ts
var DEFAULT_MODEL = "gpt-4o-mini";
var DEFAULT_TIMEOUT_MS = 2e4;
var OPENAI_URL = "https://api.openai.com/v1/chat/completions";
function model() {
	return process.env.FOCUS_HARMONIZE_MODEL?.trim() || DEFAULT_MODEL;
}
/**
* Candidate .env files to scan for OPENAI_API_KEY, in order. Overridable via FOCUS_HARMONIZE_ENV_FILE
* (colon-separated list). Default: the sentropic checkout's `.env` then `.env.prod` under $HOME/src —
* `homedir()` keeps a username out of the committed source. The raw sk- key currently lives in `.env.prod`.
*/
function candidateEnvFiles() {
	const explicit = process.env.FOCUS_HARMONIZE_ENV_FILE?.trim();
	if (explicit) return explicit.split(":").filter(Boolean);
	const base = path.join(homedir(), "src", "sentropic");
	return [path.join(base, ".env"), path.join(base, ".env.prod")];
}
function readKeyFromEnvFile(file) {
	try {
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
			if (!m) continue;
			let v = m[1].trim();
			if (v.startsWith("\"") && v.endsWith("\"") || v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
			if (v) return v;
		}
	} catch {}
}
function apiKey() {
	const fromEnv = process.env.OPENAI_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	for (const f of candidateEnvFiles()) {
		const k = readKeyFromEnvFile(f);
		if (k) return k;
	}
}
function cacheFile(lang) {
	const dir = process.env.FOCUS_HARMONIZE_CACHE?.trim() || path.join(process.cwd(), ".cache", "harmonize");
	mkdirSync(dir, { recursive: true });
	return path.join(dir, `${model()}.${lang}.json`);
}
/** Cache key = sha256(model + lang + text). Same text under a different lang/model is a distinct entry. */
function keyOf(text, lang) {
	return createHash("sha256").update(`${model()}\u0000${lang}\u0000${text}`).digest("hex");
}
function loadCache(file) {
	try {
		if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
	} catch {}
	return {};
}
function langName(lang) {
	return {
		fr: "French",
		en: "English",
		es: "Spanish",
		de: "German",
		it: "Italian",
		pt: "Portuguese",
		nl: "Dutch"
	}[lang] ?? lang;
}
/** Translate `texts` into `lang` in ONE batched call. Returns an array aligned 1:1 with the input. */
async function callLlm(texts, lang, key) {
	const controller = new AbortController();
	const timeoutMs = Number(process.env.FOCUS_HARMONIZE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const target = langName(lang);
		const system = `You are a professional technical translator. Translate each input string into ${target}. PRESERVE verbatim, without translating: work/ticket codes (e.g. EVO-10, WP7, WP-MIG, DEC-011, BR-39l), version numbers, code names, product names, "h2a", "track", "remote", ULIDs, file paths, CLI commands, and any inline code. Translate ONLY the surrounding prose. Keep parentheses and punctuation. If a string is already in ${target}, return it unchanged. Do NOT add quotes, numbering, or commentary. Return STRICT JSON of the form {"translations": [...]} with exactly one translated string per input, in the SAME order and SAME count as the input.`;
		const user = JSON.stringify({
			count: texts.length,
			texts
		});
		const resp = await fetch(OPENAI_URL, {
			method: "POST",
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: model(),
				temperature: 0,
				response_format: { type: "json_object" },
				messages: [{
					role: "system",
					content: system
				}, {
					role: "user",
					content: user
				}]
			})
		});
		if (!resp.ok) throw new Error(`openai HTTP ${resp.status}`);
		const content = (await resp.json()).choices?.[0]?.message?.content;
		if (!content) throw new Error("empty completion");
		const arr = JSON.parse(content).translations;
		if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error("shape mismatch");
		return arr.map((x) => typeof x === "string" ? x : "");
	} finally {
		clearTimeout(timer);
	}
}
/**
* Translate `texts` into `lang`. Returns a map keyed by the ORIGINAL text → translated text. The map ALWAYS
* contains every non-empty input (identity when translation is unavailable) so callers can substitute
* unconditionally. Never throws.
*/
async function harmonize(texts, lang = "fr") {
	const out = {};
	const uniq = [...new Set(texts.map((t) => t ?? ""))].filter((t) => t.trim() !== "");
	for (const t of uniq) out[t] = t;
	if (uniq.length === 0) return out;
	const file = cacheFile(lang);
	const cache = loadCache(file);
	const miss = [];
	for (const t of uniq) {
		const cached = cache[keyOf(t, lang)];
		if (typeof cached === "string") out[t] = cached;
		else miss.push(t);
	}
	if (miss.length === 0) return out;
	const key = apiKey();
	if (!key) return out;
	try {
		const translated = await callLlm(miss, lang, key);
		let dirty = false;
		miss.forEach((t, i) => {
			const tr = translated[i];
			if (typeof tr === "string" && tr.trim() !== "") {
				out[t] = tr;
				cache[keyOf(t, lang)] = tr;
				dirty = true;
			}
		});
		if (dirty) try {
			writeFileSync(file, JSON.stringify(cache));
		} catch {}
	} catch {}
	return out;
}
/**
* Translate the FREE-TEXT title fields of a FocusData payload (item subjects across FAIT / À-FAIRE /
* DÉCISION / PRÉCO / keystone) into `lang`. Machine labels (badge, gate, actor, action, nature, why) are
* FRENCH already and are left untouched. One batched call for the whole page. Never throws.
*/
async function harmonizeFocus(data, lang = "fr") {
	const texts = [];
	const push = (s) => {
		if (s && s.trim() !== "") texts.push(s);
	};
	for (const t of data.todos) {
		push(t.subject);
		push(t.gate);
	}
	for (const p of data.precos) {
		push(p.title);
		push(p.why);
	}
	for (const d of data.decisions) {
		push(d.question);
		push(d.concerns);
		push(d.summary);
	}
	for (const d of data.done) {
		push(d.title);
		push(d.summary);
	}
	if (data.keystone) push(data.keystone.title);
	const map = await harmonize(texts, lang);
	const tr = (s) => map[s] ?? s;
	const trOpt = (s) => s ? map[s] ?? s : s;
	return {
		...data,
		todos: data.todos.map((t) => ({
			...t,
			subject: tr(t.subject),
			gate: trOpt(t.gate)
		})),
		precos: data.precos.map((p) => ({
			...p,
			title: tr(p.title),
			why: tr(p.why)
		})),
		decisions: data.decisions.map((d) => ({
			...d,
			question: tr(d.question),
			concerns: tr(d.concerns),
			summary: tr(d.summary)
		})),
		done: data.done.map((d) => ({
			...d,
			title: tr(d.title),
			summary: trOpt(d.summary)
		})),
		...data.keystone ? { keystone: {
			...data.keystone,
			title: tr(data.keystone.title)
		} } : {}
	};
}
// src/routes/+page.server.ts
var load = async () => {
	const focus = buildFocusData(await loadReport());
	const lang = process.env.FOCUS_LANG?.trim() || "fr";
	return { focus: focus.ok && lang !== "off" ? await harmonizeFocus(focus, lang) : focus };
};
export { load };

//# sourceMappingURL=_page.server.ts.js.map