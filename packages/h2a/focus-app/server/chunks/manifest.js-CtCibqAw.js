const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.NwIwoYWb.js",app:"_app/immutable/entry/app.co1VH7Ep.js",imports:["_app/immutable/entry/start.NwIwoYWb.js","_app/immutable/chunks/Cj23wELW.js","_app/immutable/chunks/x-hq5fDG.js","_app/immutable/chunks/1NK_OeRJ.js","_app/immutable/entry/app.co1VH7Ep.js","_app/immutable/chunks/x-hq5fDG.js","_app/immutable/chunks/B1veta3r.js","_app/immutable/chunks/kCE9wz0g.js","_app/immutable/chunks/1NK_OeRJ.js","_app/immutable/chunks/C6KhNEX3.js","_app/immutable/chunks/BZ4lcC0v.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-leU6sfRR.js')),
			__memo(() => import('./nodes/1.js-DfNPlLOg.js')),
			__memo(() => import('./nodes/2.js-DAaLjh93.js')),
			__memo(() => import('./nodes/3.js-j6L4aZww.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/actions/launch",
				pattern: /^\/api\/actions\/launch\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/actions/launch/_server.ts.js-DUQcf9xd.js'))
			},
			{
				id: "/api/decisions/inject",
				pattern: /^\/api\/decisions\/inject\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/decisions/inject/_server.ts.js-C4LB3H-C.js'))
			},
			{
				id: "/api/dossiers/agent-memory/include",
				pattern: /^\/api\/dossiers\/agent-memory\/include\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/dossiers/agent-memory/include/_server.ts.js-BdRYDxBV.js'))
			},
			{
				id: "/dossier/agent-memory",
				pattern: /^\/dossier\/agent-memory\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export { manifest as m };
//# sourceMappingURL=manifest.js-CtCibqAw.js.map
