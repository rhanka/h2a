import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.Coe5OanZ.js","_app/immutable/chunks/CWpFxOgR.js","_app/immutable/chunks/BK-JZH5j.js","_app/immutable/chunks/GVje3uAT.js","_app/immutable/chunks/sekarY7R.js"];
export const stylesheets = ["_app/immutable/assets/Flex.v2Of_WAk.css","_app/immutable/assets/AppShell.8h_8Mcwh.css","_app/immutable/assets/EmptyState.DxOAC8BE.css","_app/immutable/assets/2.C_v5Fcun.css"];
export const fonts = [];
