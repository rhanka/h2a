import { _ as attr, a as derived, b as run, d as spread_props, t as attr_class, v as clsx, x as escape_html } from "./server2.js";
import "./index-server.js";
import { d as X, f as Icon } from "./AppShell.js";
// node_modules/@lucide/svelte/dist/icons/menu.svelte
function Menu($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v0.562.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The MIT License (MIT) (for portions derived from Feather)
		*
		* Copyright (c) 2013-2023 Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "menu" },
			props,
			{
				iconNode: [
					["path", { "d": "M4 5h16" }],
					["path", { "d": "M4 12h16" }],
					["path", { "d": "M4 19h16" }]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@sentropic/design-system-svelte/dist/AppHeader.svelte
var appHeaderIdCounter = 0;
function nextAppHeaderId() {
	return ++appHeaderIdCounter;
}
function AppHeader($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { compact = false, menuOpen = false, onMenuToggle, menuLabel = "Menu", drawerId, brandName, productName, logoSrc, logoAlt = "", brandHref = "/", brandLabel, logo, nav, actions, drawer, navAlign = "start", brandMode = "icon", class: className } = $$props;
		const brandBigramme = derived(() => {
			const src = (brandName || "").trim();
			const words = src.split(/\s+/).filter(Boolean);
			if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
			if (words.length === 1) return src.slice(0, 2).toUpperCase();
			return "";
		});
		const hasDefaultBrand = derived(() => !logo && Boolean(brandName || productName || logoSrc));
		const resolvedBrandLabel = derived(() => brandLabel ?? [brandName, productName].filter(Boolean).join(" "));
		const resolvedDrawerId = run(() => drawerId ?? `st-appHeader-drawer-${nextAppHeaderId()}`);
		const classes = () => ["st-appHeader", className].filter(Boolean).join(" ");
		const barClasses = () => ["st-appHeader__bar", navAlign === "center" ? "st-appHeader__bar--navCenter" : null].filter(Boolean).join(" ");
		const navClasses = () => ["st-appHeader__nav", navAlign === "center" ? "st-appHeader__nav--center" : null].filter(Boolean).join(" ");
		$$renderer.push(`<header${attr_class(clsx(classes()), "svelte-w3i4hh")}><div${attr_class(clsx(barClasses()), "svelte-w3i4hh")}>`);
		if (logo) {
			$$renderer.push(`<!--[0--><div class="st-appHeader__logo svelte-w3i4hh">`);
			logo($$renderer);
			$$renderer.push(`<!----></div>`);
		} else if (hasDefaultBrand()) {
			$$renderer.push(`<!--[1--><a class="st-appHeader__brand svelte-w3i4hh"${attr("href", brandHref)}${attr("aria-label", resolvedBrandLabel() || void 0)}>`);
			if (brandMode === "full") {
				$$renderer.push("<!--[0-->");
				if (logoSrc) $$renderer.push(`<!--[0--><img class="st-appHeader__brandMark svelte-w3i4hh"${attr("src", logoSrc)}${attr("alt", logoAlt)}${attr("aria-hidden", logoAlt ? void 0 : "true")}/>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (brandName || productName) {
					$$renderer.push(`<!--[0--><span class="st-appHeader__brandCopy svelte-w3i4hh">`);
					if (brandName) $$renderer.push(`<!--[0--><span class="st-appHeader__brandName svelte-w3i4hh">${escape_html(brandName)}</span>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (productName) $$renderer.push(`<!--[0--><span class="st-appHeader__brandProduct svelte-w3i4hh">${escape_html(productName)}</span>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></span>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (logoSrc) $$renderer.push(`<!--[0--><img class="st-appHeader__brandMark svelte-w3i4hh"${attr("src", logoSrc)}${attr("alt", logoAlt)}${attr("aria-hidden", logoAlt ? void 0 : "true")}/>`);
				else if (brandBigramme()) $$renderer.push(`<!--[1--><span class="st-appHeader__brandIconWrap svelte-w3i4hh"><span class="st-appHeader__brandIcon svelte-w3i4hh" aria-hidden="true">${escape_html(brandBigramme())}</span></span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></a>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (!compact) {
			$$renderer.push(`<!--[0--><nav${attr_class(clsx(navClasses()), "svelte-w3i4hh")} aria-label="Primary">`);
			if (nav) {
				$$renderer.push("<!--[0-->");
				nav($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></nav> <div class="st-appHeader__actions svelte-w3i4hh">`);
			if (actions) {
				$$renderer.push("<!--[0-->");
				actions($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		} else {
			$$renderer.push(`<!--[-1--><div class="st-appHeader__burger svelte-w3i4hh"><button type="button" class="st-appHeader__burgerButton svelte-w3i4hh"${attr("aria-label", menuLabel)}${attr("aria-expanded", menuOpen)}${attr("aria-controls", resolvedDrawerId)} aria-haspopup="menu">`);
			if (menuOpen) {
				$$renderer.push("<!--[0-->");
				X($$renderer, {
					class: "st-appHeader__burgerIcon",
					size: 20,
					"aria-hidden": "true"
				});
			} else {
				$$renderer.push("<!--[-1-->");
				Menu($$renderer, {
					class: "st-appHeader__burgerIcon",
					size: 20,
					"aria-hidden": "true"
				});
			}
			$$renderer.push(`<!--]--></button></div>`);
		}
		$$renderer.push(`<!--]--></div></header> `);
		if (compact && menuOpen && drawer) {
			$$renderer.push(`<!--[0--><button type="button" class="st-appHeader__scrim svelte-w3i4hh"${attr("aria-label", menuLabel)}></button> <aside${attr("id", resolvedDrawerId)} class="st-appHeader__drawer svelte-w3i4hh">`);
			drawer($$renderer);
			$$renderer.push(`<!----></aside>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
export { AppHeader as t };

//# sourceMappingURL=AppHeader.js.map