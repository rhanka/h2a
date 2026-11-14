// node_modules/@sveltejs/kit/src/exports/internal/shared.js
/** @import { StandardSchemaV1 } from '@standard-schema/spec' */
var HttpError = class {
	/**
	* @param {App.Error} error
	*/
	constructor(error) {
		this.status = error.status;
		this.body = error;
	}
	toString() {
		return JSON.stringify(this.body);
	}
};
/**
* An `HttpError` whose body is already in its final, user-facing form — either produced by the
* `handleError` hook on the server and reconstructed here from the response, or authored directly
* by the client runtime. Unlike a plain `HttpError` (which represents a fresh `error(...)` call
* that the hook has yet to see), `handleError` must not run on it.
* @extends HttpError
*/
var HandledHttpError = class extends HttpError {};
var Redirect = class {
	/**
	* @param {300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308} status
	* @param {string} location
	*/
	constructor(status, location) {
		try {
			new Headers({ location });
		} catch {
			throw new Error(`Invalid redirect location ${JSON.stringify(location)}: this string contains characters that cannot be used in HTTP headers`);
		}
		this.status = status;
		this.location = location;
	}
};
/**
* An error that was thrown from within the SvelteKit runtime that is not fatal and doesn't result in a 500, such as a 404.
* `SvelteKitError` goes through `handleError`.
* @extends Error
*/
var SvelteKitError = class extends Error {
	/**
	* @param {number} status
	* @param {string} text
	* @param {string} message
	*/
	constructor(status, text, message) {
		super(message);
		this.status = status;
		this.text = text;
	}
};
/**
* @template [T=undefined]
*/
var ActionFailure = class {
	/**
	* @param {number} status
	* @param {T} data
	*/
	constructor(status, data) {
		this.status = status;
		this.data = data;
	}
};
/**
* Error thrown when form validation fails imperatively
*/
var ValidationError = class extends Error {
	/**
	* @param {StandardSchemaV1.Issue[]} issues
	*/
	constructor(issues) {
		super("Validation failed");
		this.name = "ValidationError";
		this.issues = issues;
	}
};
export { SvelteKitError as a, Redirect as i, HandledHttpError as n, ValidationError as o, HttpError as r, ActionFailure as t };

//# sourceMappingURL=shared.js.map