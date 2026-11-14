import { n as format_listening_address, t as handler } from "./adapter-node-handler.js";
import { n as timeout_env, t as env } from "./adapter-node-env.js";
import fs from "node:fs";
import http from "node:http";
import process from "node:process";
import { rm } from "node:fs/promises";
// node_modules/@sveltejs/adapter-node/src/index.js
var path = env("SOCKET_PATH", false);
var host = env("HOST", "0.0.0.0");
var port = env("PORT", !path && "3000");
var shutdown_timeout = parseInt(env("SHUTDOWN_TIMEOUT", "30"));
var idle_timeout = parseInt(env("IDLE_TIMEOUT", "0"));
var listen_pid = parseInt(env("LISTEN_PID", "0"));
var listen_fds = parseInt(env("LISTEN_FDS", "0"));
var SD_LISTEN_FDS_START = 3;
if (listen_pid !== 0 && listen_pid !== process.pid) throw new Error(`received LISTEN_PID ${listen_pid} but current process id is ${process.pid}`);
if (listen_fds > 1) throw new Error(`only one socket is allowed for socket activation, but LISTEN_FDS was set to ${listen_fds}`);
var socket_activation = listen_pid === process.pid && listen_fds === 1;
var requests = 0;
/** @type {NodeJS.Timeout | void} */
var shutdown_timeout_id;
/** @type {NodeJS.Timeout | void} */
var idle_timeout_id;
var httpServer = http.createServer();
var keep_alive_timeout = timeout_env("KEEP_ALIVE_TIMEOUT");
if (keep_alive_timeout !== void 0) httpServer.keepAliveTimeout = keep_alive_timeout * 1e3;
var headers_timeout = timeout_env("HEADERS_TIMEOUT");
if (headers_timeout !== void 0) httpServer.headersTimeout = headers_timeout * 1e3;
httpServer.on("request", (req, res) => {
	requests++;
	if (socket_activation && idle_timeout_id) idle_timeout_id = clearTimeout(idle_timeout_id);
	req.on("close", () => {
		requests--;
		if (shutdown_timeout_id) httpServer.closeIdleConnections();
		if (requests === 0 && socket_activation && idle_timeout) idle_timeout_id = setTimeout(() => graceful_shutdown("IDLE"), idle_timeout * 1e3);
	});
	return handler(req, res, () => {
		res.statusCode = 404;
		res.end();
	});
});
if (socket_activation) httpServer.listen({ fd: SD_LISTEN_FDS_START }, () => {
	console.log(`Listening on file descriptor ${SD_LISTEN_FDS_START}`);
});
else {
	if (path) try {
		if (fs.statSync(path).size === 0) await rm(path);
	} catch {}
	httpServer.listen({
		path,
		host,
		port
	}, () => {
		console.log(`Listening on ${format_listening_address(path, host, port, httpServer.address())}`);
	});
}
/** @param {'SIGINT' | 'SIGTERM' | 'IDLE'} reason */
function graceful_shutdown(reason) {
	if (shutdown_timeout_id) return;
	httpServer.closeIdleConnections();
	httpServer.close((error) => {
		if (error) return;
		if (shutdown_timeout_id) clearTimeout(shutdown_timeout_id);
		if (idle_timeout_id) clearTimeout(idle_timeout_id);
		process.emit("sveltekit:shutdown", reason);
	});
	shutdown_timeout_id = setTimeout(() => httpServer.closeAllConnections(), shutdown_timeout * 1e3);
}
process.on("SIGTERM", graceful_shutdown);
process.on("SIGINT", graceful_shutdown);
export { host, path, port, httpServer as server };

//# sourceMappingURL=adapter-index.js.map