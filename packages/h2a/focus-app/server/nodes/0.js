

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.DtNiyZ0k.js","_app/immutable/chunks/CWpFxOgR.js"];
export const stylesheets = ["_app/immutable/assets/0.C8BDh0IE.css"];
export const fonts = [];
