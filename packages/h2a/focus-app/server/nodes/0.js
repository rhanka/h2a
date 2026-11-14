

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.Cv6i07gH.js","_app/immutable/chunks/Z9SFb1nh.js"];
export const stylesheets = ["_app/immutable/assets/0.C8BDh0IE.css"];
export const fonts = [];
