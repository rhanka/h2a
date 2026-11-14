import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.DqjG2jsx.js","_app/immutable/chunks/Z9SFb1nh.js","_app/immutable/chunks/DEyhT6L7.js"];
export const stylesheets = ["_app/immutable/assets/AppShell.0roNuOL1.css","_app/immutable/assets/2.BgWxD2Cm.css"];
export const fonts = [];
