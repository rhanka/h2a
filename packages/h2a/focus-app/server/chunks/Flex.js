import { a as derived, g as clsx, o as element, r as attributes } from "./server2.js";
// node_modules/@sentropic/design-system-svelte/dist/Badge.svelte
function Badge($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Badge shape — `"pill"` (default) is the current render (radius 999px, width
		* grows with content). `"circle"` renders an equal-sided round bubble
		* (`min-width === min-height`, equal inline/block padding, tabular-nums) — best
		* for ≤2-digit counts. 3+ digit content degrades GRACEFULLY to a rounded-rect
		* (never clipped), so consumer counts reaching the 1000s stay legible.
		* Mirrors `Avatar`'s `shape`. Additive: with `shape` unset the badge renders
		* byte-identically to before.
		*/
		/**
		* Density — `"md"` (default) is the current render. `"sm"` shrinks the
		* font-size (the rail-bubble scale). Additive: with `size` unset the badge
		* renders byte-identically to before.
		*/
		/**
		* The number / text. Stays content-driven (no `value` prop). For SR users a
		* bare count is ambiguous — pass an `aria-label` via `...rest` describing what
		* is counted (e.g. `aria-label="128 entities"`).
		*/
		let { tone = "neutral", shape = "pill", size = "md", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-badge",
			`st-badge--${tone}`,
			`st-badge--${shape}`,
			`st-badge--${size}`,
			className
		].filter(Boolean).join(" ");
		$$renderer.push(`<span${attributes({
			...rest,
			class: clsx(classes())
		}, "svelte-pdgh8u")}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></span>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Button.svelte
function Button($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { variant = "primary", size = "md", disabled = false, type = "button", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-button",
			`st-button--${variant}`,
			`st-button--${size}`,
			className
		].filter(Boolean).join(" ");
		$$renderer.push(`<button${attributes({
			...rest,
			class: clsx(classes()),
			type,
			disabled
		}, "svelte-121ausn")}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></button>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Container.svelte
function Container($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { size = "lg", padding = true, as = "div", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = derived(() => [
			"st-container",
			`st-container--${size}`,
			padding && "st-container--padded",
			className
		].filter(Boolean).join(" "));
		element($$renderer, as, () => {
			$$renderer.push(`${attributes({
				...rest,
				class: clsx(classes())
			}, "svelte-lol6l6")}`);
		}, () => {
			children?.($$renderer);
			$$renderer.push(`<!---->`);
		});
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Flex.svelte
var SPACING_FALLBACK = {
	0: "0",
	1: "0.25rem",
	2: "0.5rem",
	3: "0.75rem",
	4: "1rem",
	5: "1.25rem",
	6: "1.5rem",
	7: "1.75rem",
	8: "2rem",
	9: "2.25rem",
	10: "2.5rem",
	11: "2.75rem",
	12: "3rem"
};
function spacingToken(step) {
	if (step == null) return void 0;
	const clamped = Math.max(0, Math.min(12, Math.round(step)));
	if (clamped === 0) return "0";
	return `var(--st-spacing-${clamped}, ${SPACING_FALLBACK[clamped]})`;
}
var ALIGN = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
	baseline: "baseline"
};
var JUSTIFY = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
	around: "space-around",
	evenly: "space-evenly"
};
function alignValue(align) {
	return align ? ALIGN[align] : void 0;
}
function justifyValue(justify) {
	return justify ? JUSTIFY[justify] : void 0;
}
function Flex($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { direction = "row", gap, align, justify, wrap = false, inline = false, as = "div", class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = derived(() => ["st-flex", className].filter(Boolean).join(" "));
		element($$renderer, as, () => {
			$$renderer.push(`${attributes({
				...rest,
				class: clsx(classes())
			}, "svelte-94sbko", void 0, {
				display: inline ? "inline-flex" : "flex",
				"flex-direction": direction,
				"flex-wrap": wrap ? "wrap" : "nowrap",
				"align-items": alignValue(align),
				"justify-content": justifyValue(justify),
				gap: spacingToken(gap)
			})}`);
		}, () => {
			children?.($$renderer);
			$$renderer.push(`<!---->`);
		});
	});
}
export { Badge as i, Container as n, Button as r, Flex as t };

//# sourceMappingURL=Flex.js.map