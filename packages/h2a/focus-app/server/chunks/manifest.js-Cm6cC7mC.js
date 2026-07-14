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
		client: {start:"_app/immutable/entry/start.DlLmkUb7.js",app:"_app/immutable/entry/app.6DKouWRt.js",imports:["_app/immutable/entry/start.DlLmkUb7.js","_app/immutable/chunks/CVq_IFFr.js","_app/immutable/chunks/Bv8OL8ib.js","_app/immutable/chunks/Cj6wo28J.js","_app/immutable/entry/app.6DKouWRt.js","_app/immutable/chunks/Bv8OL8ib.js","_app/immutable/chunks/Bs3f1UbD.js","_app/immutable/chunks/ZxFklh9T.js","_app/immutable/chunks/Cj6wo28J.js","_app/immutable/chunks/_wRuVGPs.js","_app/immutable/chunks/DEmooz0s.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-4wlmdsk8.js')),
			__memo(() => import('./nodes/1.js-B-LpY-lC.js')),
			__memo(() => import('./nodes/2.js-F6jp5eD9.js'))
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
				endpoint: __memo(() => import('./entries/endpoints/api/decisions/inject/_server.ts.js-j0NNcOSZ.js'))
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
//# sourceMappingURL=manifest.js-Cm6cC7mC.js.map
