import * as server from '../entries/pages/dossier/agent-memory/_page.server.ts.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dossier/agent-memory/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/dossier/agent-memory/+page.server.ts";
export const imports = ["_app/immutable/nodes/4.DfE6l8W6.js","_app/immutable/chunks/CWpFxOgR.js","_app/immutable/chunks/BK-JZH5j.js","_app/immutable/chunks/GVje3uAT.js","_app/immutable/chunks/DePdV_-7.js"];
export const stylesheets = ["_app/immutable/assets/Flex.v2Of_WAk.css","_app/immutable/assets/AppShell.8h_8Mcwh.css","_app/immutable/assets/4.C_jty5Ez.css"];
export const fonts = [];
