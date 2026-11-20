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
	client: {start:"_app/immutable/entry/start.CK55YOuL.js",app:"_app/immutable/entry/app.PZPMYmVK.js",imports:["_app/immutable/entry/start.CK55YOuL.js","_app/immutable/entry/payload.DSmR2FwN.js","_app/immutable/chunks/DclECHGd.js","_app/immutable/chunks/B613_wA1.js","_app/immutable/chunks/CWpFxOgR.js","_app/immutable/chunks/DsuYjffR.js","_app/immutable/entry/app.PZPMYmVK.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
	
	nodes: [
		__memo(() => import('./nodes/0.js')),
		__memo(() => import('./nodes/1.js')),
		__memo(() => import('./nodes/2.js')),
		__memo(() => import('./nodes/3.js')),
		__memo(() => import('./nodes/4.js'))
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
			id: "/artifact/[id]",
			pattern: /^\/artifact\/([^/]+?)\/?$/,
			params: [{"name":"id","optional":false,"rest":false,"chained":false}],
			page: { layouts: [0,], errors: [1,], leaf: 3 },
			endpoint: null
		},
		{
			id: "/dossier/agent-memory",
			pattern: /^\/dossier\/agent-memory\/?$/,
			params: [],
			page: { layouts: [0,], errors: [1,], leaf: 4 },
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
