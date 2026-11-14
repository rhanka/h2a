import * as server from '../entries/pages/dossier/agent-memory/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dossier/agent-memory/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/dossier/agent-memory/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.C1OKX3mR.js","_app/immutable/chunks/Z9SFb1nh.js","_app/immutable/chunks/DEyhT6L7.js"];
export const stylesheets = ["_app/immutable/assets/AppShell.0roNuOL1.css","_app/immutable/assets/3.C_jty5Ez.css"];
export const fonts = [];
