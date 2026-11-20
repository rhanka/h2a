import * as server from '../entries/pages/artifact/_id_/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/artifact/_id_/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/artifact/[id]/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.D3W_0bng.js","_app/immutable/chunks/DN0tdVON.js","_app/immutable/chunks/B_3gwoZu.js","_app/immutable/chunks/RuFHV5dK.js","_app/immutable/chunks/DQ96dVsU.js"];
export const stylesheets = ["_app/immutable/assets/AppShell.C-yZ0QOU.css","_app/immutable/assets/AppHeader.C6Dqcp0i.css","_app/immutable/assets/ArtifactReviewHost.8F-MCY-i.css","_app/immutable/assets/3.BCCxUSH5.css"];
export const fonts = [];
