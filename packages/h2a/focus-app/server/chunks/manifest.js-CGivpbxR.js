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
		client: {start:"_app/immutable/entry/start.DZV8LVpE.js",app:"_app/immutable/entry/app.CCJGFWT8.js",imports:["_app/immutable/entry/start.DZV8LVpE.js","_app/immutable/chunks/YuasXHqn.js","_app/immutable/chunks/BN5Ncssb.js","_app/immutable/chunks/DglcL_bg.js","_app/immutable/entry/app.CCJGFWT8.js","_app/immutable/chunks/BN5Ncssb.js","_app/immutable/chunks/B1ZXKDf6.js","_app/immutable/chunks/D3uRC7b4.js","_app/immutable/chunks/DglcL_bg.js","_app/immutable/chunks/DyEaRn2v.js","_app/immutable/chunks/B4Yn1C9x.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-C1il-hlS.js')),
			__memo(() => import('./nodes/1.js-DBYtV1-A.js')),
			__memo(() => import('./nodes/2.js-CM-qPkz9.js')),
			__memo(() => import('./nodes/3.js-Cb0A37n-.js')),
			__memo(() => import('./nodes/4.js-B_uvKPtF.js'))
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
				endpoint: __memo(() => import('./entries/endpoints/api/decisions/inject/_server.ts.js-rFgBcP9E.js'))
			},
			{
				id: "/api/dossiers/agent-memory/include",
				pattern: /^\/api\/dossiers\/agent-memory\/include\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/dossiers/agent-memory/include/_server.ts.js-C8qC0NE1.js'))
			},
			{
				id: "/api/dossiers/session-safety/include",
				pattern: /^\/api\/dossiers\/session-safety\/include\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/dossiers/session-safety/include/_server.ts.js-DuHriVvA.js'))
			},
			{
				id: "/api/h2a/targets",
				pattern: /^\/api\/h2a\/targets\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/h2a/targets/_server.ts.js-okO2RefJ.js'))
			},
			{
				id: "/dossier/agent-memory",
				pattern: /^\/dossier\/agent-memory\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/dossier/session-safety",
				pattern: /^\/dossier\/session-safety\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
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
//# sourceMappingURL=manifest.js-CGivpbxR.js.map
