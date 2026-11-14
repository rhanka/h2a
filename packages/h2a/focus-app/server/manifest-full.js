export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	app_dir: "_app",
	app_path: "_app",
	assets: new Set([]),
	mime_types: {},
	client: {start:"_app/immutable/entry/start.D2j_5jlV.js",app:"_app/immutable/entry/app.DM4MWHVC.js",imports:["_app/immutable/entry/start.D2j_5jlV.js","_app/immutable/entry/payload.DSmR2FwN.js","_app/immutable/chunks/DclECHGd.js","_app/immutable/chunks/CBgSTK-n.js","_app/immutable/chunks/Z9SFb1nh.js","_app/immutable/chunks/BpezdEDY.js","_app/immutable/entry/app.DM4MWHVC.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
	
	nodes: [
		__memo(() => import('./nodes/0.js')),
		__memo(() => import('./nodes/1.js')),
		__memo(() => import('./nodes/2.js')),
		__memo(() => import('./nodes/3.js'))
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
			endpoint: __memo(() => import('./entries/endpoints/api/actions/launch/_server.ts.js'))
		},
		{
			id: "/api/decisions/inject",
			pattern: /^\/api\/decisions\/inject\/?$/,
			params: [],
			page: null,
			endpoint: __memo(() => import('./entries/endpoints/api/decisions/inject/_server.ts.js'))
		},
		{
			id: "/api/dossiers/agent-memory/include",
			pattern: /^\/api\/dossiers\/agent-memory\/include\/?$/,
			params: [],
			page: null,
			endpoint: __memo(() => import('./entries/endpoints/api/dossiers/agent-memory/include/_server.ts.js'))
		},
		{
			id: "/api/h2a/targets",
			pattern: /^\/api\/h2a\/targets\/?$/,
			params: [],
			page: null,
			endpoint: __memo(() => import('./entries/endpoints/api/h2a/targets/_server.ts.js'))
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
		return {};
	},
	server_assets: {}
}
})();
