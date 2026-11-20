import * as server from '../entries/pages/dossier/agent-memory/_page.server.ts.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dossier/agent-memory/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/dossier/agent-memory/+page.server.ts";
export const imports = ["_app/immutable/nodes/4.DSE7Coj5.js","_app/immutable/chunks/DN0tdVON.js","_app/immutable/chunks/RuFHV5dK.js","_app/immutable/chunks/DQ96dVsU.js"];
export const stylesheets = ["_app/immutable/assets/AppShell.C-yZ0QOU.css","_app/immutable/assets/ArtifactReviewHost.8F-MCY-i.css","_app/immutable/assets/4.DUs4vx4j.css"];
export const fonts = [];
