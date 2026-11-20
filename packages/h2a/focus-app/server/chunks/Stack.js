import { a as derived, d as spread_props } from "./server2.js";
import { t as Flex } from "./Flex.js";
// node_modules/@sentropic/design-system-svelte/dist/Stack.svelte
function Stack($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { gap, align, justify, as = "div", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = derived(() => ["st-stack", className].filter(Boolean).join(" "));
		Flex($$renderer, spread_props([rest, {
			as,
			gap,
			align,
			justify,
			direction: "column",
			class: classes(),
			children: ($$renderer) => {
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		}]));
	});
}
export { Stack as t };

//# sourceMappingURL=Stack.js.map