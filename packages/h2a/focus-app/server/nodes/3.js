import * as server from '../entries/pages/artifact/_id_/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/artifact/_id_/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/artifact/[id]/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.DttZqVcU.js","_app/immutable/chunks/CWpFxOgR.js","_app/immutable/chunks/GVje3uAT.js","_app/immutable/chunks/DePdV_-7.js","_app/immutable/chunks/sekarY7R.js"];
export const stylesheets = ["_app/immutable/assets/Flex.v2Of_WAk.css","_app/immutable/assets/EmptyState.DxOAC8BE.css","_app/immutable/assets/3.D7zqA8Sr.css"];
export const fonts = [];
