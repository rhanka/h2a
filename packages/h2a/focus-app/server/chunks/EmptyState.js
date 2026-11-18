import { g as clsx, r as attributes, y as escape_html } from "./server2.js";
// node_modules/@sentropic/design-system-svelte/dist/EmptyState.svelte
function EmptyState($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { title, message, class: className, action, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => ["st-empty-state", className].filter(Boolean).join(" ");
		$$renderer.push(`<section${attributes({
			...rest,
			class: clsx(classes())
		}, "svelte-1irw8xl")}><div class="st-empty-state__content svelte-1irw8xl"><h2 class="st-empty-state__title svelte-1irw8xl">${escape_html(title)}</h2> `);
		if (message) $$renderer.push(`<!--[0--><p class="st-empty-state__message svelte-1irw8xl">${escape_html(message)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div> `);
		if (action) {
			$$renderer.push(`<!--[0--><div class="st-empty-state__action svelte-1irw8xl">`);
			action($$renderer);
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></section>`);
	});
}
export { EmptyState as t };

//# sourceMappingURL=EmptyState.js.map