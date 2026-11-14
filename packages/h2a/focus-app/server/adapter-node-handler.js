import { a as SvelteKitError } from "./chunks/shared.js";
import { n as noop } from "./chunks/functions.js";
import { t as env } from "./adapter-node-env.js";
import fs, { createReadStream } from "node:fs";
import path from "node:path";
import { format } from "node:url";
import process from "node:process";
import { Readable, pipeline } from "node:stream";
import { app_path, assets, base, dir, env_prefix, mime_types, origin, prerendered_assets, server } from "../adapter-node.js";
// node_modules/@sveltejs/kit/src/exports/node/index.js
/** @type {WeakMap<import('http').IncomingMessage, (chunk: Buffer) => void>} */
var body_data_listeners = /* @__PURE__ */ new WeakMap();
/**
* @param {import('http').IncomingMessage} req
* @param {number} [body_size_limit]
*/
function get_raw_body(req, body_size_limit) {
	const h = req.headers;
	const content_length = Number(h["content-length"]);
	const has_content_length = Number.isFinite(content_length);
	if (req.httpVersionMajor === 1 && !has_content_length && h["transfer-encoding"] == null || content_length === 0) return null;
	if (req.destroyed) {
		const readable = new ReadableStream();
		readable.cancel();
		return readable;
	}
	let size = 0;
	let cancelled = false;
	return new ReadableStream({
		start(controller) {
			if (body_size_limit !== void 0 && has_content_length && content_length > body_size_limit) {
				const error = new SvelteKitError(413, "Payload Too Large", `Content-length of ${content_length} exceeds limit of ${body_size_limit} bytes.`);
				controller.error(error);
				return;
			}
			/** @param {Error} error */
			const on_error = (error) => {
				cancelled = true;
				controller.error(error);
			};
			const on_end = () => {
				if (cancelled) return;
				controller.close();
			};
			/** @param {Buffer} chunk */
			const on_data = (chunk) => {
				if (cancelled) return;
				size += chunk.length;
				if (body_size_limit !== void 0 && size > body_size_limit) {
					cancelled = true;
					const message = `request body size exceeded BODY_SIZE_LIMIT of ${body_size_limit}`;
					const error = new SvelteKitError(413, "Payload Too Large", message);
					controller.error(error);
					return;
				}
				if (has_content_length && size > content_length) {
					cancelled = true;
					const message = `request body size exceeded content-length of ${content_length}`;
					const error = new SvelteKitError(413, "Payload Too Large", message);
					controller.error(error);
					return;
				}
				controller.enqueue(chunk);
				if (controller.desiredSize === null || controller.desiredSize <= 0) req.pause();
			};
			req.on("error", on_error);
			req.on("end", on_end);
			req.on("data", on_data);
			body_data_listeners.set(req, on_data);
		},
		pull() {
			req.resume();
		},
		cancel(reason) {
			cancelled = true;
			req.destroy(reason);
		}
	});
}
/**
* @param {{
*   request: import('http').IncomingMessage;
*   response?: import('http').ServerResponse;
*   base: string;
*   bodySizeLimit?: number;
* }} options
* @returns {Request}
*/
function getRequest({ request, response, base, bodySizeLimit }) {
	let headers = request.headers;
	if (request.httpVersionMajor >= 2) {
		headers = Object.assign({}, headers);
		if (headers[":authority"]) headers.host = headers[":authority"];
		delete headers[":authority"];
		delete headers[":method"];
		delete headers[":path"];
		delete headers[":scheme"];
	}
	const controller = new AbortController();
	request.once("close", () => {
		if (request.readableAborted) controller.abort();
	});
	response?.once("close", () => {
		if (!response.writableEnded) controller.abort();
	});
	return new Request(base + request.url, {
		duplex: "half",
		method: request.method,
		headers: Object.entries(headers),
		signal: controller.signal,
		body: request.method === "GET" || request.method === "HEAD" ? void 0 : get_raw_body(request, bodySizeLimit)
	});
}
/**
* Drains any unconsumed request body once the response has been sent. When a
* route doesn't read the request body (for example a page route receiving a
* POST), the unread bytes remain buffered in the socket. On keep-alive
* connections Node's HTTP parser then reads those leftover bytes as the next
* request, fails to parse them, and resets the connection — losing any
* pipelined request. Resuming the request discards the bytes so the connection
* stays usable.
*
* Because `get_raw_body` attaches a `data` listener, Node marks the request as
* being consumed (`req._consuming`) and skips its own automatic drain, so we
* have to do it ourselves. The whole remaining body is read and discarded; this
* is the intended trade-off (keeping the connection reusable) over destroying it.
* @see https://github.com/sveltejs/kit/issues/14916
* @see https://github.com/sveltejs/kit/issues/15526
* @param {import('http').ServerResponse} res
*/
function drain_request(res) {
	const req = res.req;
	if (!req || req.readableEnded || req.destroyed) return;
	const on_data = body_data_listeners.get(req);
	if (on_data) {
		req.removeListener("data", on_data);
		body_data_listeners.delete(req);
	}
	req.resume();
}
/**
* @param {import('http').ServerResponse} res
* @param {Response} response
* @returns {void}
*/
function setResponse(res, response) {
	res.once("finish", () => drain_request(res));
	res.once("close", () => drain_request(res));
	for (const [key, value] of response.headers) try {
		res.setHeader(key, key === "set-cookie" ? response.headers.getSetCookie() : value);
	} catch (error) {
		res.getHeaderNames().forEach((name) => res.removeHeader(name));
		res.writeHead(500).end(String(error));
		return;
	}
	if (!response.body) {
		res.writeHead(response.status);
		res.end();
		return;
	}
	if (response.body.locked) {
		res.writeHead(response.status);
		res.end("Fatal error: Response body is locked. This can happen when the response was already read (for example through 'response.json()' or 'response.text()').");
		return;
	}
	const reader = response.body.getReader();
	if (res.destroyed) {
		reader.cancel();
		return;
	}
	const cancel = (error) => {
		res.off("close", cancel);
		res.off("error", cancel);
		reader.cancel(error).catch(noop);
		if (error) res.destroy(error);
	};
	res.on("close", cancel);
	res.on("error", cancel);
	/** @type {Uint8Array<ArrayBuffer>[]} */
	const buffered = [];
	/** @type {ReturnType<typeof reader.read> | null} */
	let pending = null;
	probe();
	async function probe() {
		try {
			/** @type {Promise<undefined>} */
			const deadline = new Promise((fulfil) => setImmediate(() => fulfil(void 0)));
			while (buffered.length < 2) {
				pending = reader.read();
				const result = await Promise.race([pending, deadline]);
				if (!result) break;
				pending = null;
				if (result.done) {
					if (!res.hasHeader("content-length") && !res.hasHeader("transfer-encoding")) res.setHeader("content-length", buffered.reduce((total, chunk) => total + chunk.byteLength, 0));
					break;
				}
				buffered.push(result.value);
			}
			if (res.destroyed) return;
			res.writeHead(response.status);
			await next();
		} catch (error) {
			if (!res.headersSent) res.writeHead(response.status);
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
	async function next() {
		try {
			for (;;) {
				/** @type {Awaited<ReturnType<typeof reader.read>>} */
				let result;
				if (buffered.length > 0) result = {
					done: false,
					value: buffered.shift()
				};
				else if (pending) {
					result = await pending;
					pending = null;
				} else result = await reader.read();
				const { done, value } = result;
				if (done) break;
				if (!res.write(value)) {
					res.once("drain", next);
					return;
				}
			}
			res.end();
		} catch (error) {
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
}
/**
* Converts a file on disk to a readable stream
* @param {string} file
* @returns {ReadableStream}
* @since 2.4.0
*/
function createReadableStream(file) {
	return Readable.toWeb(createReadStream(file));
}
// node_modules/@sveltejs/adapter-node/src/utils.js
/**
* Parses the given value into number of bytes.
*
* @param {string} value - Size in bytes. Can also be specified with a unit suffix kilobytes (K), megabytes (M), or gigabytes (G).
* @returns {number}
*/
function parse_as_bytes(value) {
	const multiplier = {
		K: 1024,
		M: 1048576,
		G: 1073741824
	}[value[value.length - 1]?.toUpperCase()] ?? 1;
	return Number(multiplier != 1 ? value.substring(0, value.length - 1) : value) * multiplier;
}
/**
* Formats the address the server is listening on.
*
* @param {string | false} path
* @param {string} host
* @param {string | false} port
* @param {import('node:net').AddressInfo | string | null} address
* @returns {string}
*/
function format_listening_address(path, host, port, address) {
	if (path) return path;
	if (address && typeof address === "object") return format({
		protocol: "http:",
		hostname: address.address,
		port: address.port
	});
	return format({
		protocol: "http:",
		hostname: host,
		port: String(port)
	});
}
// node_modules/@sveltejs/adapter-node/src/static.js
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/**
* @typedef {(req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => void | Promise<void>} Middleware
* @typedef {AssetEntry & { type?: string, cache_control?: string }} Asset
* @typedef {Asset | { location: string }} Entry
*/
/**
* Splits `req.url` into a decoded pathname and the search string.
* Decoding follows kit's router: reserved characters such as `%2F` stay
* encoded. An undecodable pathname is returned as-is, so it misses the
* asset table and falls through to SvelteKit's 400
* @param {import('node:http').IncomingMessage} req
*/
function split_url(req) {
	let pathname = req.url;
	let search = "";
	const query_index = pathname.indexOf("?");
	if (query_index !== -1) {
		search = pathname.slice(query_index);
		pathname = pathname.slice(0, query_index);
	}
	if (pathname.includes("%")) try {
		pathname = pathname.split("%25").map(decodeURI).join("%25");
	} catch {}
	return {
		pathname,
		search
	};
}
/**
* Relative reference from `from` to `to`, which must differ only by a trailing slash.
* Keep in sync with the copy in `packages/kit/src/utils/url.js`
* @param {string} from
* @param {string} to
* @returns {string}
*/
function relative_pathname(from, to) {
	const segment = to.replace(/\/$/, "").split("/").at(-1);
	return from.endsWith("/") ? `../${segment}` : `./${segment}/`;
}
/**
* Parses `Accept-Encoding` and picks the preferred variant that exists
* @param {string | undefined} header
* @param {Asset} asset
* @returns {'br' | 'gz' | undefined}
*/
function negotiate(header, asset) {
	if (!header || !(asset.br || asset.gz)) return;
	/** @type {Map<string, number>} */
	const weights = /* @__PURE__ */ new Map();
	for (const part of header.toLowerCase().split(",")) {
		const [coding, ...params] = part.split(";");
		let weight = 1;
		for (const param of params) {
			const [name, value] = param.split("=");
			if (name.trim() === "q") weight = parseFloat(value) || 0;
		}
		weights.set(coding.trim(), weight);
	}
	/** @param {string} coding */
	const weight = (coding) => weights.get(coding) ?? weights.get("*") ?? 0;
	const br = asset.br ? weight("br") : 0;
	if ((asset.gz ? weight("gzip") : 0) > br) return "gz";
	if (br > 0) return "br";
}
/**
* Whether an `If-None-Match` value matches `etag`, using weak comparison
* @param {string | undefined} header
* @param {string} etag
*/
function etag_matches(header, etag) {
	if (!header) return false;
	if (header.trim() === "*") return true;
	return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}
/**
* Absolute file paths and content types for one table
* @param {string} dir
* @param {AssetTable} table
* @param {Record<string, string>} mime_types
* @returns {Map<string, Asset>}
*/
function resolve(dir, table, mime_types) {
	/** @type {Map<string, Asset>} */
	const files = /* @__PURE__ */ new Map();
	for (const [key, entry] of table.entries) {
		let type = mime_types[entry.file.slice(entry.file.lastIndexOf("."))];
		if (type === "text/html") type += ";charset=utf-8";
		files.set(key, {
			...entry,
			file: path.join(dir, entry.file),
			type
		});
	}
	for (const [alias, key] of table.aliases) files.set(alias, files.get(key));
	return files;
}
/**
* One lookup for every request, decided at boot: client assets (immutable below
* `app_path`), prerendered pages, and a 308 from the non-canonical trailing-slash
* form of a prerendered path to the canonical one. Client assets win a collision
* @param {{
*   dir: string,
*   base: string,
*   app_path: string,
*   mime_types: Record<string, string>,
*   assets: AssetTable,
*   prerendered_assets: AssetTable
* }} opts
* @returns {Map<string, Entry>}
*/
function create_file_map({ dir, base, app_path, mime_types, assets, prerendered_assets }) {
	/** @type {Map<string, Entry>} */
	const files = resolve(`${dir}/client${base}`, assets, mime_types);
	const immutable = `/${app_path}/immutable/`;
	for (const [key, asset] of files) if (key.startsWith(immutable))
 /** @type {Asset} */ asset.cache_control = "public,max-age=31536000,immutable";
	const prerendered = resolve(`${dir}/prerendered${base}`, prerendered_assets, mime_types);
	for (const [key, asset] of prerendered) if (!files.has(key)) files.set(key, asset);
	for (const key of prerendered.keys()) {
		const inverted = key.at(-1) === "/" ? key.slice(0, -1) : key + "/";
		if (inverted && !files.has(inverted)) files.set(inverted, { location: relative_pathname(inverted, key) });
	}
	return files;
}
/**
* Serves the closed set of files recorded at adapt time. Everything about a
* response is decided before the first request, so a request is one map
* lookup, header negotiation and a stream
* @param {Map<string, Entry>} files
* @returns {Middleware}
*/
function serve_static(files) {
	return (req, res, next) => {
		const { pathname, search } = split_url(req);
		const asset = files.get(pathname);
		if (!asset) return next();
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET, HEAD" }).end();
			return;
		}
		if ("location" in asset) {
			res.writeHead(308, { location: asset.location + search }).end();
			return;
		}
		let file = asset.file;
		let size = asset.size;
		let etag = `"${asset.etag}"`;
		const variant = negotiate(req.headers["accept-encoding"], asset);
		if (variant) {
			size = asset[variant];
			file += `.${variant}`;
			etag = `"${asset.etag}.${variant}"`;
		}
		/** @type {Record<string, string | number>} */
		const headers = { etag };
		if (asset.br || asset.gz) headers.vary = "Accept-Encoding";
		if (asset.cache_control) headers["cache-control"] = asset.cache_control;
		if (etag_matches(req.headers["if-none-match"], etag)) {
			res.writeHead(304, headers).end();
			return;
		}
		headers["content-length"] = size;
		headers["accept-ranges"] = "bytes";
		if (asset.type) headers["content-type"] = asset.type;
		if (variant) headers["content-encoding"] = variant === "gz" ? "gzip" : "br";
		/** @type {{ start?: number, end?: number }} */
		const range = {};
		let status = 200;
		const if_range = req.headers["if-range"];
		if (req.headers.range && (!if_range || if_range === etag)) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
			if (match && (match[1] || match[2])) {
				let start = match[1] ? parseInt(match[1], 10) : NaN;
				let end = match[2] ? parseInt(match[2], 10) : size - 1;
				if (isNaN(start)) {
					start = Math.max(size - end, 0);
					end = size - 1;
				} else end = Math.min(end, size - 1);
				if (start >= size || start > end) {
					res.writeHead(416, { "content-range": `bytes */${size}` }).end();
					return;
				}
				status = 206;
				headers["content-range"] = `bytes ${start}-${end}/${size}`;
				headers["content-length"] = end - start + 1;
				range.start = start;
				range.end = end;
			}
		}
		res.writeHead(status, headers);
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		pipeline(fs.createReadStream(file, range), res, () => {});
	};
}
// node_modules/@sveltejs/adapter-node/src/handler.js
/** @import { IncomingHttpHeaders } from 'node:http' */
/** @import { Middleware } from './static.js' */
var xff_depth = parseInt(env("XFF_DEPTH", "1"));
var address_header = env("ADDRESS_HEADER", "").toLowerCase();
var protocol_header = env("PROTOCOL_HEADER", "").toLowerCase();
var host_header = env("HOST_HEADER", "").toLowerCase();
var port_header = env("PORT_HEADER", "").toLowerCase();
var body_size_limit = parse_as_bytes(env("BODY_SIZE_LIMIT", "512K"));
if (isNaN(body_size_limit)) throw new Error(`Invalid BODY_SIZE_LIMIT: '${env("BODY_SIZE_LIMIT")}'. Please provide a numeric value.`);
var asset_dir = `${dir}/client${base}`;
await server.init({
	env: process.env,
	read: (file) => createReadableStream(`${asset_dir}/${file}`)
});
/** @type {Middleware} */
var ssr = async (req, res) => {
	/** @type {Request} */
	let request;
	let request_origin = origin;
	if (!request_origin) try {
		request_origin = get_origin(req.headers);
	} catch (error) {
		console.error(`Could not determine request origin: ${error instanceof Error ? error.message : String(error)}`);
		res.statusCode = 400;
		res.end("Bad Request");
		return;
	}
	try {
		request = getRequest({
			base: request_origin,
			request: req,
			response: res,
			bodySizeLimit: body_size_limit
		});
	} catch {
		res.statusCode = 400;
		res.end("Bad Request");
		return;
	}
	const response = await server.respond(request, {
		platform: { req },
		getClientAddress: () => {
			if (address_header) {
				if (!(address_header in req.headers)) throw new Error(`Address header was specified with ${env_prefix + "ADDRESS_HEADER"}=${address_header} but is absent from request`);
				const value = req.headers[address_header] || "";
				if (address_header === "x-forwarded-for") {
					const addresses = value.split(",");
					if (xff_depth < 1) throw new Error(`${env_prefix + "XFF_DEPTH"} must be a positive integer`);
					if (xff_depth > addresses.length) throw new Error(`${env_prefix + "XFF_DEPTH"} is ${xff_depth}, but only found ${addresses.length} addresses`);
					return addresses[addresses.length - xff_depth].trim();
				}
				return value;
			}
			return req.connection?.remoteAddress || req.connection?.socket?.remoteAddress || req.socket?.remoteAddress || req.info?.remoteAddress;
		}
	});
	if (response.headers.get("content-type") === "text/event-stream") res.setHeader("x-accel-buffering", "no");
	setResponse(res, response);
};
/**
* @param {string} name
* @param {string | string[] | undefined} value
* @returns {string | undefined}
*/
function normalise_header(name, value) {
	if (!name) return void 0;
	if (Array.isArray(value)) {
		if (value.length === 0) return void 0;
		if (value.length === 1) return value[0];
		throw new Error(`Multiple values provided for ${name} header where only one expected: ${value}`);
	}
	return value;
}
/**
* @param {IncomingHttpHeaders} headers
* @returns {string}
*/
function get_origin(headers) {
	const protocol = decodeURIComponent(normalise_header(protocol_header, headers[protocol_header]) || "https");
	if (protocol.includes(":")) throw new Error(`The ${protocol_header} header specified ${protocol} which is an invalid because it includes \`:\`. It should only contain the protocol scheme (e.g. \`https\`)`);
	const host = normalise_header(host_header, headers[host_header]) || normalise_header("host", headers["host"]);
	if (!host) {
		const header_names = host_header ? `${host_header} or host headers` : "host header";
		throw new Error(`Could not determine host. The request must have a value provided by the ${header_names}`);
	}
	const port = normalise_header(port_header, headers[port_header]);
	if (port && isNaN(+port)) throw new Error(`The ${port_header} header specified ${port} which is an invalid port because it is not a number. The value should only contain the port number (e.g. 443)`);
	return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}
var serve = serve_static(create_file_map({
	dir,
	base,
	app_path,
	mime_types,
	assets,
	prerendered_assets
}));
/** @type {Middleware} */
var handler = (req, res, next) => serve(req, res, () => ssr(req, res, next));
export { format_listening_address as n, handler as t };

//# sourceMappingURL=adapter-node-handler.js.map