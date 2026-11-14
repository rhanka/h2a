import { i as Redirect, r as HttpError } from "./shared.js";
import { W as request_store_after_await, X as url_search_unavailable_prerender } from "./server-errors.js";
// node_modules/@sveltejs/kit/src/messages/internal/shared.js
/**
* Whether shared errors include their full text on the server even though `DEV` is false. This is
* enabled while the app is being built (analysed or prerendered)
*/
var verbose = false;
function enable_verbose_errors() {
	verbose = true;
}
/**
* @typedef {{ element?: Element }} ClientWarningOptions
* - `element`: logged after the warning, so that it can be inspected in the browser's devtools
*/
/** `console.warn` styles for the code and text of shared runtime warnings, as in Svelte */
var bold = "font-weight: bold";
var normal = "font-weight: normal";
/**
* Throws the full diagnostic. Generated helpers throw their URL-only production error inline, so
* bundlers can remove both this call and the message text from production browser builds
* @param {string} code
* @param {string} message
* @param {Function} caller The generated helper, which is omitted from the stack along with this function
* @returns {never}
*/
function throw_error(code, message, caller) {
	const error = /* @__PURE__ */ new Error(`${code}\n${message}\nhttps://svelte.dev/e/kit/${code}`);
	error.name = "SvelteKit error";
	Error.captureStackTrace?.(error, caller);
	throw error;
}
// node_modules/@sveltejs/kit/src/constants.js
/**
* A fake asset path used in `vite dev` and `vite preview`, so that we can
* serve local assets while verifying that requests are correctly prefixed
*/
var SVELTE_KIT_ASSETS = "/_svelte_kit_assets";
var ENDPOINT_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"HEAD",
	"QUERY"
];
var MUTATIVE_METHODS = [
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
];
/** methods whose responses depend on the request body, so they can never be prerendered */
var BODY_DEPENDENT_METHODS = [...MUTATIVE_METHODS, "QUERY"];
var PAGE_METHODS = [
	"GET",
	"POST",
	"HEAD"
];
import.meta.dirname;
var IN_WEBCONTAINER = !!globalThis.process?.versions?.webcontainer;
/**
* If an an adapter deploys a catch-all serverless function, the rerouted URL
* is stored in this header.
*/
var REROUTED_URL_HEADER = "x-sveltekit-rerouted-url";
// node_modules/@sveltejs/kit/src/exports/internal/server/event.js
/** @import { RequestEvent } from '@sveltejs/kit' */
/** @import { RequestStore } from 'types' */
/** @import { AsyncLocalStorage } from 'node:async_hooks' */
/** @type {RequestStore | null} */
var sync_store = null;
/** @type {AsyncLocalStorage<RequestStore | null> | null} */
var als;
import("node:async_hooks").then((hooks) => als = new hooks.AsyncLocalStorage()).catch(() => {});
function get_request_store() {
	const result = try_get_request_store();
	if (!result) {
		if (als) throw new Error("Could not get the request store. This is an internal error.");
		request_store_after_await();
	}
	return result;
}
function try_get_request_store() {
	return sync_store ?? als?.getStore() ?? null;
}
/**
* @template T
* @param {RequestStore | null} store
* @param {() => T} fn
*/
function with_request_store(store, fn) {
	try {
		sync_store = store;
		return als ? als.run(store, fn) : fn();
	} finally {
		if (!IN_WEBCONTAINER) sync_store = null;
	}
}
// node_modules/@sveltejs/kit/src/exports/internal/server/index.js
/**
* @template {{ tracing: { enabled: boolean, root: Span, current: Span } }} T
* @param {T} event_like
* @param {Span} current
* @returns {T}
*/
function merge_tracing(event_like, current) {
	return {
		...event_like,
		tracing: {
			...event_like.tracing,
			current
		}
	};
}
// node_modules/@sveltejs/kit/src/messages/shared-errors.js
/**
* Invalid array key `%key%`
* @param {{ "key": string }} _values
* @returns {never}
*/
function form_field_array_conflict(_values) {
	if (verbose) throw_error("form_field_array_conflict", `Invalid array key \`${_values.key}\``, form_field_array_conflict);
	throw new Error("https://svelte.dev/e/kit/form_field_array_conflict");
}
/**
* Form cannot contain duplicated keys — `%name%` has %count% values
* @param {{ "name": string; "count": string }} _values
* @returns {never}
*/
function form_field_duplicate(_values) {
	if (verbose) throw_error("form_field_duplicate", `Form cannot contain duplicated keys — \`${_values.name}\` has ${_values.count} values`, form_field_duplicate);
	throw new Error("https://svelte.dev/e/kit/form_field_duplicate");
}
/**
* Invalid key `%key%`: This key is not allowed to prevent prototype pollution.
* @param {{ "key": string }} _values
* @returns {never}
*/
function form_field_forbidden_key(_values) {
	if (verbose) throw_error("form_field_forbidden_key", `Invalid key \`${_values.key}\`: This key is not allowed to prevent prototype pollution.`, form_field_forbidden_key);
	throw new Error("https://svelte.dev/e/kit/form_field_forbidden_key");
}
/**
* Invalid field name `%name%`: field names are written in JS object notation, so keys that would need quoting are not supported. See https://svelte.dev/docs/kit/remote-functions#form-Fields
* @param {{ "name": string }} _values
* @returns {never}
*/
function form_field_invalid_name(_values) {
	if (verbose) throw_error("form_field_invalid_name", `Invalid field name \`${_values.name}\`: field names are written in JS object notation, so keys that would need quoting are not supported. See https://svelte.dev/docs/kit/remote-functions#form-Fields`, form_field_invalid_name);
	throw new Error("https://svelte.dev/e/kit/form_field_invalid_name");
}
/**
* Form contained a field that wasn't created with `form.fields.as(...)`: `%name%`
* @param {{ "name": string }} _values
* @returns {never}
*/
function form_field_unbound(_values) {
	if (verbose) throw_error("form_field_unbound", `Form contained a field that wasn't created with \`form.fields.as(...)\`: \`${_values.name}\``, form_field_unbound);
	throw new Error("https://svelte.dev/e/kit/form_field_unbound");
}
/**
* %type% inputs must have a value
* @param {{ "type": string }} _values
* @returns {never}
*/
function form_input_missing_value(_values) {
	if (verbose) throw_error("form_input_missing_value", `${_values.type} inputs must have a value`, form_input_missing_value);
	throw new Error("https://svelte.dev/e/kit/form_input_missing_value");
}
/**
* HTTP error status codes must be between 400 and 599 — %status% is invalid
* @param {{ "status": string }} _values
* @returns {never}
*/
function invalid_error_status(_values) {
	if (verbose) throw_error("invalid_error_status", `HTTP error status codes must be between 400 and 599 — ${_values.status} is invalid`, invalid_error_status);
	throw new Error("https://svelte.dev/e/kit/invalid_error_status");
}
/**
* Invalid export `%key%` (valid exports are %exports%, or anything with a `'_'` prefix)
* @param {{ "key": string; "exports": string; "file"?: string }} _values
* @returns {never}
*/
function invalid_export(_values) {
	if (verbose) throw_error("invalid_export", _values?.file !== void 0 ? `Invalid export \`${_values.key}\` in \`${_values.file}\` (valid exports are ${_values.exports}, or anything with a \`'_'\` prefix)` : `Invalid export \`${_values.key}\` (valid exports are ${_values.exports}, or anything with a \`'_'\` prefix)`, invalid_export);
	throw new Error("https://svelte.dev/e/kit/invalid_export");
}
/**
* Invalid export `%key%` (`%key%` is a valid export in %locations%)
* @param {{ "key": string; "locations": string; "file"?: string }} _values
* @returns {never}
*/
function invalid_export_location(_values) {
	if (verbose) throw_error("invalid_export_location", _values?.file !== void 0 ? `Invalid export \`${_values.key}\` in \`${_values.file}\` (\`${_values.key}\` is a valid export in ${_values.locations})` : `Invalid export \`${_values.key}\` (\`${_values.key}\` is a valid export in ${_values.locations})`, invalid_export_location);
	throw new Error("https://svelte.dev/e/kit/invalid_export_location");
}
/**
* a `load` function %location% returned %type%, but must return a plain object at the top level (i.e. `return {...}`)
* @param {{ "location": string; "type": string }} _values
* @returns {never}
*/
function load_invalid_response(_values) {
	if (verbose) throw_error("load_invalid_response", `a \`load\` function ${_values.location} returned ${_values.type}, but must return a plain object at the top level (i.e. \`return {...}\`)`, load_invalid_response);
	throw new Error("https://svelte.dev/e/kit/load_invalid_response");
}
/**
* Async param matchers are not supported
* @param {void} _values
* @returns {never}
*/
function param_matcher_async(_values) {
	if (verbose) throw_error("param_matcher_async", `Async param matchers are not supported`, param_matcher_async);
	throw new Error("https://svelte.dev/e/kit/param_matcher_async");
}
/**
* Param matcher must return a string, number, boolean, or bigint
* @param {void} _values
* @returns {never}
*/
function param_matcher_result_invalid(_values) {
	if (verbose) throw_error("param_matcher_result_invalid", `Param matcher must return a string, number, boolean, or bigint`, param_matcher_result_invalid);
	throw new Error("https://svelte.dev/e/kit/param_matcher_result_invalid");
}
/**
* %type% are not valid remote function arguments
* @param {{ "type": string }} _values
* @returns {never}
*/
function remote_argument_unsupported(_values) {
	if (verbose) throw_error("remote_argument_unsupported", `${_values.type} are not valid remote function arguments`, remote_argument_unsupported);
	throw new Error("https://svelte.dev/e/kit/remote_argument_unsupported");
}
/**
* Cannot access `event.url.hash`. Consider using `page.url.hash` inside a component instead
* @param {void} _values
* @returns {never}
*/
function url_hash_unavailable(_values) {
	if (verbose) throw_error("url_hash_unavailable", `Cannot access \`event.url.hash\`. Consider using \`page.url.hash\` inside a component instead`, url_hash_unavailable);
	throw new Error("https://svelte.dev/e/kit/url_hash_unavailable");
}
// node_modules/@sveltejs/kit/src/utils/url.js
/**
* Matches a URI scheme. See https://www.rfc-editor.org/rfc/rfc3986#section-3.1
* @type {RegExp}
*/
var SCHEME = /^[a-z][a-z\d+\-.]*:/i;
var internal = new URL("a://");
/**
* @param {string} base
* @param {string} path
*/
function resolve(base, path) {
	if (path[0] === "/" && path[1] === "/") return path;
	let url = new URL(base, internal);
	url = new URL(path, url);
	return url.protocol === internal.protocol ? url.pathname + url.search + url.hash : url.href;
}
/**
* Relative reference from `from` to `to`, which must differ only by a trailing slash
* @param {string} from
* @param {string} to
* @returns {string}
*/
function relative_pathname(from, to) {
	const segment = to.replace(/\/$/, "").split("/").at(-1);
	return from.endsWith("/") ? `../${segment}` : `./${segment}/`;
}
/**
* @param {string} path
* @param {import('types').TrailingSlash} trailing_slash
*/
function normalize_path(path, trailing_slash) {
	if (path === "/" || trailing_slash === "ignore") return path;
	if (trailing_slash === "never") return path.endsWith("/") ? path.slice(0, -1) : path;
	else if (trailing_slash === "always" && !path.endsWith("/")) return path + "/";
	return path;
}
/**
* Decode pathname excluding %25 to prevent further double decoding of params
* @param {string} pathname
*/
function decode_pathname(pathname) {
	return pathname.split("%25").map(decodeURI).join("%25");
}
/**
* @param {URL} url
* @param {() => void} callback
* @param {(search_param: string) => void} search_params_callback
* @param {boolean} [allow_hash]
*/
function make_trackable(url, callback, search_params_callback, allow_hash = false) {
	const tracked = new URL(url);
	Object.defineProperty(tracked, "searchParams", {
		value: new Proxy(tracked.searchParams, { get(obj, key) {
			if (key === "get" || key === "getAll" || key === "has") return (param, ...rest) => {
				search_params_callback(param);
				return obj[key](param, ...rest);
			};
			callback();
			const value = Reflect.get(obj, key);
			return typeof value === "function" ? value.bind(obj) : value;
		} }),
		enumerable: true,
		configurable: true
	});
	/**
	* URL properties that could change during the lifetime of the page,
	* which excludes things like `origin`
	* @type {(keyof URL)[]}
	*/
	const tracked_url_properties = [
		"href",
		"pathname",
		"search",
		"toString",
		"toJSON"
	];
	if (allow_hash) tracked_url_properties.push("hash");
	for (const property of tracked_url_properties) Object.defineProperty(tracked, property, {
		get() {
			callback();
			return url[property];
		},
		enumerable: true,
		configurable: true
	});
	tracked[Symbol.for("nodejs.util.inspect.custom")] = (_depth, opts, inspect) => {
		return inspect(url, opts);
	};
	tracked.searchParams[Symbol.for("nodejs.util.inspect.custom")] = (_depth, opts, inspect) => {
		return inspect(url.searchParams, opts);
	};
	if (!allow_hash) disable_hash(tracked);
	return tracked;
}
/**
* Disallow access to `url.hash` on the server and in `load`
* @param {URL} url
*/
function disable_hash(url) {
	allow_nodejs_console_log(url);
	Object.defineProperty(url, "hash", { get() {
		return url_hash_unavailable();
	} });
}
/**
* Disallow access to `url.search` and `url.searchParams` during prerendering
* @param {URL} url
*/
function disable_search(url) {
	allow_nodejs_console_log(url);
	for (const property of ["search", "searchParams"]) Object.defineProperty(url, property, { get() {
		return url_search_unavailable_prerender({ property });
	} });
}
/**
* Allow URL to be console logged, bypassing disabled properties.
* @param {URL} url
*/
function allow_nodejs_console_log(url) {
	url[Symbol.for("nodejs.util.inspect.custom")] = (_depth, opts, inspect) => {
		return inspect(new URL(url), opts);
	};
}
// node_modules/@sveltejs/kit/src/messages/shared-warnings.js
/**
* `%route%`: Calling `depends('%dependency%')` will throw an error in Firefox because `%scheme%` is a special URI scheme
* @param {{ "route": string; "dependency": string; "scheme": string }} _values
*/
function depends_special_scheme(_values) {
	console.warn("https://svelte.dev/e/kit/depends_special_scheme");
}
/**
* The properties of `form.fields` are virtual, so operators like `in` and `Object.keys` are meaningless. If you need the current value of a form field, use `form.fields.x.value()`
* @param {void} _values
*/
function form_fields_enumerated(_values) {
	console.warn("https://svelte.dev/e/kit/form_fields_enumerated");
}
// node_modules/@sveltejs/kit/src/exports/index.js
/** @import { StandardSchemaV1 } from '@standard-schema/spec' */
var text_encoder = new TextEncoder();
/**
* Throws an error with a HTTP status code and an optional message.
* When called during request handling, this will cause SvelteKit to
* return an error response; the error will be passed to `handleError` as an _expected_ error.
* Make sure you're not catching the thrown error, which would prevent SvelteKit from handling it.
* @param {number} status The [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses). Must be in the range 400-599.
* @param {string} [message] The error message.
* @overload
* @param {{ status: number; message: string } extends App.Error ? number : never} status
* @param {{ status: number; message: string } extends App.Error ? string : never} [message]
* @return {never}
* @throws {import('./public.js').HttpError} This error instructs SvelteKit to initiate HTTP error handling.
* @throws {Error} If the provided status is invalid (not between 400 and 599).
*/
/**
* Throws an error with a HTTP status code and an optional message.
* When called during request handling, this will cause SvelteKit to
* return an error response; the error will be passed to `handleError` as an _expected_ error.
* Make sure you're not catching the thrown error, which would prevent SvelteKit from handling it.
* @param {number} status The [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses). Must be in the range 400-599.
* @param {string} message The error message.
* @param {keyof Omit<App.Error, 'status' | 'message'> extends never ? never : Omit<App.Error, 'status' | 'message'>} properties Additional properties of the App.Error type.
* @overload
* @param {number} status
* @param {string} message
* @param {keyof Omit<App.Error, 'status' | 'message'> extends never ? never : Omit<App.Error, 'status' | 'message'>} properties
* @return {never}
* @throws {import('./public.js').HttpError} This error instructs SvelteKit to initiate HTTP error handling.
* @throws {Error} If the provided status is invalid (not between 400 and 599).
*/
/**
* Throws an error with a HTTP status code and an optional message.
* When called during request handling, this will cause SvelteKit to
* return an error response; the error will be passed to `handleError` as an _expected_ error.
* Make sure you're not catching the thrown error, which would prevent SvelteKit from handling it.
* @deprecated Passing an `App.Error` body as the second argument is deprecated — pass the `message` as the second argument, and any additional properties as the third
* @param {number} status The [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses). Must be in the range 400-599.
* @param {Omit<App.Error, 'status'> & { status?: App.Error['status'] }} body An object that conforms to the App.Error type. If a string is passed, it will be used as the message property.
* @overload
* @param {number} status
* @param {Omit<App.Error, 'status'> & { status?: App.Error['status'] }} properties
* @return {never}
* @throws {import('./public.js').HttpError} This error instructs SvelteKit to initiate HTTP error handling.
* @throws {Error} If the provided status is invalid (not between 400 and 599).
*/
/**
* Throws an error with a HTTP status code and an optional message.
* When called during request handling, this will cause SvelteKit to
* return an error response; the error will be passed to `handleError` as an _expected_ error.
* Make sure you're not catching the thrown error, which would prevent SvelteKit from handling it.
* @param {any} status The [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses). Must be in the range 400-599.
* @param {any} [message] A string, or (deprecated) a partial App.Error object
* @param {any} [properties] Additional properties of the App.Error type when passing a string message.
* @return {never}
* @throws {import('./public.js').HttpError} This error instructs SvelteKit to initiate HTTP error handling.
* @throws {Error} If the provided status is invalid (not between 400 and 599).
*/
function error(status, message, properties) {
	if (isNaN(status) || status < 400 || status > 599) invalid_error_status({ status: String(status) });
	if (message !== void 0 && typeof message !== "string") ({message, ...properties} = message);
	throw new HttpError({
		...properties,
		status,
		message: message ?? `Error: ${status}`
	});
}
/**
* Checks whether this is a redirect thrown by {@link redirect}.
* @param {unknown} e The object to check.
* @return {e is import('./public.js').Redirect}
*/
function isRedirect(e) {
	return e instanceof Redirect;
}
/**
* Create a JSON `Response` object from the supplied data.
* @param {any} data The value that will be serialized as JSON.
* @param {ResponseInit} [init] Options such as `status` and `headers` that will be added to the response. `Content-Type: application/json` and `Content-Length` headers will be added automatically.
* @deprecated use `Response.json`
*/
function json(data, init) {
	const body = JSON.stringify(data);
	const headers = new Headers(init?.headers);
	if (!headers.has("content-length")) headers.set("content-length", text_encoder.encode(body).byteLength.toString());
	if (!headers.has("content-type")) headers.set("content-type", "application/json");
	return new Response(body, {
		...init,
		headers
	});
}
/**
* Create a `Response` object from the supplied body.
* @param {string} body The value that will be used as-is.
* @param {ResponseInit} [init] Options such as `status` and `headers` that will be added to the response. A `Content-Length` header will be added automatically.
* @deprecated use `new Response`
*/
function text(body, init) {
	const headers = new Headers(init?.headers);
	if (!headers.has("content-length")) {
		const encoded = text_encoder.encode(body);
		headers.set("content-length", encoded.byteLength.toString());
		return new Response(encoded, {
			...init,
			headers
		});
	}
	return new Response(body, {
		...init,
		headers
	});
}
export { BODY_DEPENDENT_METHODS as A, param_matcher_async as C, get_request_store as D, merge_tracing as E, REROUTED_URL_HEADER as F, SVELTE_KIT_ASSETS as I, bold as L, IN_WEBCONTAINER as M, MUTATIVE_METHODS as N, try_get_request_store as O, PAGE_METHODS as P, enable_verbose_errors as R, load_invalid_response as S, remote_argument_unsupported as T, form_field_invalid_name as _, depends_special_scheme as a, invalid_export as b, decode_pathname as c, normalize_path as d, relative_pathname as f, form_field_forbidden_key as g, form_field_duplicate as h, text as i, ENDPOINT_METHODS as j, with_request_store as k, disable_search as l, form_field_array_conflict as m, isRedirect as n, form_fields_enumerated as o, resolve as p, json as r, SCHEME as s, error as t, make_trackable as u, form_field_unbound as v, param_matcher_result_invalid as w, invalid_export_location as x, form_input_missing_value as y, normal as z };

//# sourceMappingURL=exports.js.map