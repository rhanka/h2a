import { _ as attr, a as derived, b as run, d as spread_props, h as setContext, i as bind_props, m as getContext, n as attr_style, o as element, r as attributes, s as ensure_array_like, t as attr_class, v as clsx, x as escape_html } from "./server2.js";
import { t as onDestroy } from "./index-server.js";
// node_modules/@lucide/svelte/dist/defaultAttributes.js
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
var defaultAttributes = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round"
};
// node_modules/@lucide/svelte/dist/Icon.svelte
function Icon($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const { name, color = "currentColor", size = 24, strokeWidth = 2, absoluteStrokeWidth = false, iconNode = [], children, $$slots, $$events, ...props } = $$props;
		$$renderer.push(`<svg${attributes({
			...defaultAttributes,
			...props,
			width: size,
			height: size,
			stroke: color,
			"stroke-width": absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
			class: clsx([
				"lucide-icon lucide",
				name && `lucide-${name}`,
				props.class
			])
		}, void 0, void 0, void 0, 3)}><!--[-->`);
		const each_array = ensure_array_like(iconNode);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let [tag, attrs] = each_array[$$index];
			element($$renderer, tag, () => {
				$$renderer.push(`${attributes({ ...attrs }, void 0, void 0, void 0, 3)}`);
			});
		}
		$$renderer.push(`<!--]-->`);
		children?.($$renderer);
		$$renderer.push(`<!----></svg>`);
	});
}
// node_modules/@lucide/svelte/dist/icons/boxes.svelte
function Boxes($$renderer, $$props) {
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
			{ name: "boxes" },
			props,
			{
				iconNode: [
					["path", { "d": "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" }],
					["path", { "d": "m7 16.5-4.74-2.85" }],
					["path", { "d": "m7 16.5 5-3" }],
					["path", { "d": "M7 16.5v5.17" }],
					["path", { "d": "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" }],
					["path", { "d": "m17 16.5-5-3" }],
					["path", { "d": "m17 16.5 4.74-2.85" }],
					["path", { "d": "M17 16.5v5.17" }],
					["path", { "d": "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" }],
					["path", { "d": "M12 8 7.26 5.15" }],
					["path", { "d": "m12 8 4.74-2.85" }],
					["path", { "d": "M12 13.5V8" }]
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
// node_modules/@lucide/svelte/dist/icons/chevron-down.svelte
function Chevron_down($$renderer, $$props) {
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
			{ name: "chevron-down" },
			props,
			{
				iconNode: [["path", { "d": "m6 9 6 6 6-6" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/chevron-left.svelte
function Chevron_left($$renderer, $$props) {
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
			{ name: "chevron-left" },
			props,
			{
				iconNode: [["path", { "d": "m15 18-6-6 6-6" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/chevron-right.svelte
function Chevron_right($$renderer, $$props) {
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
			{ name: "chevron-right" },
			props,
			{
				iconNode: [["path", { "d": "m9 18 6-6-6-6" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/globe.svelte
function Globe($$renderer, $$props) {
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
			{ name: "globe" },
			props,
			{
				iconNode: [
					["circle", {
						"cx": "12",
						"cy": "12",
						"r": "10"
					}],
					["path", { "d": "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
					["path", { "d": "M2 12h20" }]
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
// node_modules/@lucide/svelte/dist/icons/moon.svelte
function Moon($$renderer, $$props) {
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
			{ name: "moon" },
			props,
			{
				iconNode: [["path", { "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/palette.svelte
function Palette($$renderer, $$props) {
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
			{ name: "palette" },
			props,
			{
				iconNode: [
					["path", { "d": "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
					["circle", {
						"cx": "13.5",
						"cy": "6.5",
						"r": ".5",
						"fill": "currentColor"
					}],
					["circle", {
						"cx": "17.5",
						"cy": "10.5",
						"r": ".5",
						"fill": "currentColor"
					}],
					["circle", {
						"cx": "6.5",
						"cy": "12.5",
						"r": ".5",
						"fill": "currentColor"
					}],
					["circle", {
						"cx": "8.5",
						"cy": "7.5",
						"r": ".5",
						"fill": "currentColor"
					}]
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
// node_modules/@lucide/svelte/dist/icons/search.svelte
function Search($$renderer, $$props) {
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
			{ name: "search" },
			props,
			{
				iconNode: [["path", { "d": "m21 21-4.34-4.34" }], ["circle", {
					"cx": "11",
					"cy": "11",
					"r": "8"
				}]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/sun.svelte
function Sun($$renderer, $$props) {
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
			{ name: "sun" },
			props,
			{
				iconNode: [
					["circle", {
						"cx": "12",
						"cy": "12",
						"r": "4"
					}],
					["path", { "d": "M12 2v2" }],
					["path", { "d": "M12 20v2" }],
					["path", { "d": "m4.93 4.93 1.41 1.41" }],
					["path", { "d": "m17.66 17.66 1.41 1.41" }],
					["path", { "d": "M2 12h2" }],
					["path", { "d": "M20 12h2" }],
					["path", { "d": "m6.34 17.66-1.41 1.41" }],
					["path", { "d": "m19.07 4.93-1.41 1.41" }]
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
// node_modules/@lucide/svelte/dist/icons/user.svelte
function User($$renderer, $$props) {
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
			{ name: "user" },
			props,
			{
				iconNode: [["path", { "d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }], ["circle", {
					"cx": "12",
					"cy": "7",
					"r": "4"
				}]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/x.svelte
function X($$renderer, $$props) {
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
			{ name: "x" },
			props,
			{
				iconNode: [["path", { "d": "M18 6 6 18" }], ["path", { "d": "m6 6 12 12" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Alert.svelte
function Alert($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { tone = "info", title, message, class: className, actions, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-alert",
			`st-alert--${tone}`,
			className
		].filter(Boolean).join(" ");
		const role = () => tone === "error" || tone === "warning" ? "alert" : "status";
		$$renderer.push(`<section${attributes({
			...rest,
			class: clsx(classes()),
			role: role()
		}, "svelte-1vb1ni1")}><div class="st-alert__content svelte-1vb1ni1"><h2 class="st-alert__title svelte-1vb1ni1">${escape_html(title)}</h2> `);
		if (message) $$renderer.push(`<!--[0--><p class="st-alert__message svelte-1vb1ni1">${escape_html(message)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children?.($$renderer);
		$$renderer.push(`<!----></div> `);
		if (actions) {
			$$renderer.push(`<!--[0--><div class="st-alert__actions svelte-1vb1ni1">`);
			actions($$renderer);
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></section>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Header.svelte
function deriveInitials(name) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function Header($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Identité connectée (additif). Quand fourni, le Header rend une zone compte
		* complète (avatar OU initiales + nom + email + déclencheur de menu). Sans
		* cet objet, l'état « anonyme » s'affiche via le snippet `actions` du parent
		* (typiquement un CTA « Se connecter »).
		*/
		/** Texte du déclencheur de connexion rendu quand `account` est absent. */
		/** Snippet du menu compte (contenu du panneau ouvert sous l'avatar). */
		/** Indique si le menu compte est ouvert (état contrôlé par le parent). */
		/** Callback déclenché au clic sur le bouton compte. */
		/** Callback déclenché au clic sur le CTA de connexion (état anonyme). */
		let { title, label = "Application header", sticky = true, class: className, logo, navigation, actions, children, account, signInLabel = "Se connecter", accountMenu, accountMenuOpen = false, onAccountTriggerClick, onSignIn, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-header",
			sticky ? "st-header--sticky" : null,
			className
		].filter(Boolean).join(" ");
		const resolvedInitials = derived(() => account ? account.initials?.trim() || deriveInitials(account.name) : "");
		const hasPhoto = derived(() => Boolean(account?.avatarUrl));
		$$renderer.push(`<header${attributes({
			...rest,
			class: clsx(classes()),
			"aria-label": label
		}, "svelte-1d3rqe2")}><div class="st-header__leading svelte-1d3rqe2">`);
		if (logo) {
			$$renderer.push(`<!--[0--><span class="st-header__logo svelte-1d3rqe2">`);
			logo($$renderer);
			$$renderer.push(`<!----></span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (title) $$renderer.push(`<!--[0--><span class="st-header__title svelte-1d3rqe2">${escape_html(title)}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> `);
		if (navigation) {
			$$renderer.push(`<!--[0--><nav class="st-header__navigation svelte-1d3rqe2" aria-label="Primary">`);
			navigation($$renderer);
			$$renderer.push(`<!----></nav>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (actions || account || onSignIn) {
			$$renderer.push(`<!--[0--><div class="st-header__actions svelte-1d3rqe2">`);
			if (actions) {
				$$renderer.push("<!--[0-->");
				actions($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (account) {
				$$renderer.push(`<!--[0--><div class="st-header__account svelte-1d3rqe2"><button type="button" class="st-header__account-trigger svelte-1d3rqe2" aria-haspopup="menu"${attr("aria-expanded", accountMenuOpen)}${attr("aria-label", `Compte de ${account.name}`)}>`);
				if (hasPhoto()) $$renderer.push(`<!--[0--><span class="st-header__avatar st-header__avatar--photo svelte-1d3rqe2" aria-hidden="true"><img class="st-header__avatar-image svelte-1d3rqe2"${attr("src", account.avatarUrl)} alt=""/></span>`);
				else $$renderer.push(`<!--[-1--><span class="st-header__avatar st-header__avatar--initials svelte-1d3rqe2" aria-hidden="true">${escape_html(resolvedInitials())}</span>`);
				$$renderer.push(`<!--]--> <span class="st-header__account-meta svelte-1d3rqe2"><span class="st-header__account-name svelte-1d3rqe2">${escape_html(account.name)}</span> `);
				if (account.email) $$renderer.push(`<!--[0--><span class="st-header__account-email svelte-1d3rqe2">${escape_html(account.email)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></span> <svg class="st-header__account-caret svelte-1d3rqe2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg></button> `);
				if (accountMenu && accountMenuOpen) {
					$$renderer.push(`<!--[0--><div class="st-header__account-menu svelte-1d3rqe2" role="menu"${attr("aria-label", `Menu de ${account.name}`)}>`);
					accountMenu($$renderer);
					$$renderer.push(`<!----></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			} else if (onSignIn) $$renderer.push(`<!--[1--><button type="button" class="st-header__signin svelte-1d3rqe2">${escape_html(signInLabel)}</button>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (children) {
			$$renderer.push("<!--[0-->");
			children($$renderer);
			$$renderer.push(`<!---->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></header>`);
	});
}
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
// node_modules/@sentropic/design-system-svelte/dist/Card.svelte
function Card($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { interactive = false, class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-card",
			interactive && "st-card--interactive",
			className
		].filter(Boolean).join(" ");
		$$renderer.push(`<section${attributes({
			...rest,
			class: clsx(classes())
		}, "svelte-mt7xh")}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></section>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/IconButton.svelte
function IconButton($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { "aria-label": ariaLabel, size = "md", variant = "ghost", type = "button", disabled = false, class: className, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-iconButton",
			`st-iconButton--${size}`,
			`st-iconButton--${variant}`,
			className
		].filter(Boolean).join(" ");
		$$renderer.push(`<button${attributes({
			...rest,
			class: clsx(classes()),
			type,
			disabled,
			"aria-label": ariaLabel
		}, "svelte-iw4na2")}>`);
		children($$renderer);
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
// node_modules/@sentropic/design-system-svelte/dist/menu-cascade.js
function resolvePreferredSide(preferred) {
	if (preferred === "left") return "left";
	return "right";
}
/** Context key through which a host (`MenuPopover`, `OverflowMenu`) shares its
* root menu id and close entrypoint with an inner `Menu`. Internal only: no
* public prop carries it (§2.2, D5). */
var MENU_HOST_CONTEXT = "st-menu-host";
// node_modules/@sentropic/design-system-svelte/dist/MenuPopover.svelte
var menuPopoverInstanceCounter = 0;
function MenuPopover($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false, trigger, placement = "bottom-start", align, label, class: className, closeOnOutside = true, closeOnEscape = true, children, $$slots, $$events, ...rest } = $$props;
		const rootMenuId = `st-menupopover-${++menuPopoverInstanceCounter}`;
		function requestClose(options) {
			open = false;
			if (options.focusTrigger) trigger?.focus();
		}
		setContext(MENU_HOST_CONTEXT, {
			rootMenuId,
			requestClose,
			setHasCascade: (value) => {}
		});
		let top = 0;
		let left = 0;
		function effectivePlacement() {
			return placement;
		}
		const classes = () => [
			"st-menuPopover",
			`st-menuPopover--${effectivePlacement()}`,
			null,
			null,
			className
		].filter(Boolean).join(" ");
		if (open) {
			$$renderer.push(`<!--[0--><div${attributes({
				...rest,
				class: clsx(classes()),
				role: "dialog",
				"aria-label": label,
				style: `top: ${top}px; left: ${left}px;`
			}, "svelte-tp772b")}>`);
			children?.($$renderer);
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { open });
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Menu.svelte
var menuInstanceCounter = 0;
function Menu($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { label, items, open = true, dismissOnSelect = false, class: className, dense = false, submenuSide = "auto", onselect, $$slots, $$events, ...rest } = $$props;
		const fallbackRootId = `st-menu-${++menuInstanceCounter}`;
		const hostContext = getContext(MENU_HOST_CONTEXT);
		const useOverflowClasses = hostContext?.overflowClasses === true;
		const rootId = derived(() => rest.id ?? hostContext?.rootMenuId ?? fallbackRootId);
		let openPath = [];
		let roving = [];
		let levelSides = [];
		let levelPositions = [];
		let openTimer = void 0;
		let closeTimer = void 0;
		function isAction(item) {
			return item.kind === void 0 || item.kind === "item";
		}
		function hasSubMenu(item) {
			return isAction(item) && Array.isArray(item.children) && item.children.length > 0;
		}
		function treeHasCascade(list) {
			for (const item of list) {
				if (hasSubMenu(item)) return true;
				if (isAction(item) && Array.isArray(item.children)) {
					if (treeHasCascade(item.children)) return true;
				}
			}
			return false;
		}
		const hasCascade = derived(() => treeHasCascade(items));
		function levelItems(depth) {
			let list = items;
			for (let d = 0; d < depth; d += 1) {
				const parent = list[openPath[d]];
				if (!parent || !isAction(parent) || !Array.isArray(parent.children)) return [];
				list = parent.children;
			}
			return list;
		}
		function subId(depth, index) {
			return `${rootId()}--sub-${depth}-${index}`;
		}
		function parentButtonId(depth, index) {
			return `${rootId()}--parent-${depth}-${index}`;
		}
		function cancelOpenTimer() {
			if (openTimer !== void 0) {
				clearTimeout(openTimer);
				openTimer = void 0;
			}
		}
		function cancelCloseTimer() {
			if (closeTimer !== void 0) {
				clearTimeout(closeTimer);
				closeTimer = void 0;
			}
		}
		function cancelAllTimers() {
			cancelOpenTimer();
			cancelCloseTimer();
		}
		let rafId = void 0;
		function cancelDeferredPositions() {
			if (rafId !== void 0 && typeof cancelAnimationFrame === "function") {
				cancelAnimationFrame(rafId);
				rafId = void 0;
			}
		}
		onDestroy(() => {
			cancelAllTimers();
			cancelDeferredPositions();
		});
		function firstEnabledIndex(list) {
			for (let i = 0; i < list.length; i += 1) {
				const item = list[i];
				if (isAction(item) && !item.disabled) return i;
			}
			return -1;
		}
		function rovingTarget(depth, list) {
			const stored = roving[depth];
			if (stored !== void 0 && list[stored] !== void 0 && isAction(list[stored]) && !list[stored].disabled) return stored;
			return firstEnabledIndex(list);
		}
		function resolvedSideFor(depth, index) {
			if (openPath[depth] === index && openPath.length > depth && levelSides[depth] !== void 0) return levelSides[depth];
			return resolvePreferredSide(submenuSide);
		}
		const classes = () => [
			"st-menu",
			dense ? "st-menu--dense" : null,
			hasCascade() ? "st-menu--hasCascade" : null,
			className
		].filter(Boolean).join(" ");
		const overflowClasses = () => ["st-overflowMenu__list", className].filter(Boolean).join(" ");
		function overflowPanelStyle() {
			const raw = rest.style;
			const cap = "max-height: var(--st-menu-maxHeight, calc(100vh - 2rem));";
			return typeof raw === "string" && raw.length > 0 ? `${raw} ${cap}` : cap;
		}
		function panelStyle(depth) {
			const position = levelPositions[depth];
			if (!position) return void 0;
			let style = `top: ${position.top}px; left: ${position.left}px;`;
			if (position.maxHeight !== void 0) style += ` max-height: ${position.maxHeight}px;`;
			if (position.capped) style += " min-width: 0; max-width: calc(100vw - 16px);";
			return style;
		}
		function chevronSide(depth, index) {
			return resolvedSideFor(depth, index);
		}
		function menurows($$renderer, list, depth) {
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(list);
			for (let index = 0, $$length = each_array.length; index < $$length; index++) {
				let item = each_array[index];
				if (isAction(item)) {
					$$renderer.push("<!--[0-->");
					const Icon = item.icon;
					const isParent = hasSubMenu(item) && depth < 2;
					const isOpen = openPath[depth] === index && openPath.length > depth;
					const selected = Boolean(item.selected) || isOpen;
					const tabIndex = rovingTarget(depth, list) === index ? 0 : -1;
					if (isParent) {
						$$renderer.push(`<!--[0--><div class="st-menu__itemWrap svelte-n7le8g" role="presentation"><button${attr_class("st-menu__item st-menu__item--hasSubmenu svelte-n7le8g", void 0, {
							"st-menu__item--danger": item.danger,
							"st-menu__item--selected": selected
						})} type="button" role="menuitem"${attr("id", parentButtonId(depth, index))}${attr("data-item-index", index)} aria-haspopup="menu"${attr("aria-expanded", item.disabled ? "false" : isOpen ? "true" : "false")}${attr("aria-controls", subId(depth, index))}${attr("aria-disabled", item.disabled ? "true" : void 0)}${attr("disabled", item.disabled, true)}${attr("tabindex", item.disabled ? void 0 : tabIndex)}>`);
						if (chevronSide(depth, index) === "left") {
							$$renderer.push(`<!--[0--><span class="st-menu__itemChevron st-menu__itemChevron--start svelte-n7le8g" aria-hidden="true">`);
							Chevron_left($$renderer, {
								size: 16,
								strokeWidth: 2,
								"aria-hidden": "true"
							});
							$$renderer.push(`<!----></span>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						if (Icon) {
							$$renderer.push(`<!--[0--><span class="st-menu__itemIcon svelte-n7le8g" aria-hidden="true">`);
							if (typeof Icon === "string") $$renderer.push(`<!--[0-->${escape_html(Icon)}`);
							else {
								$$renderer.push("<!--[-1-->");
								if (Icon) {
									$$renderer.push("<!--[-->");
									Icon($$renderer, {
										size: 16,
										strokeWidth: 2
									});
									$$renderer.push("<!--]-->");
								} else {
									$$renderer.push("<!--[!-->");
									$$renderer.push("<!--]-->");
								}
							}
							$$renderer.push(`<!--]--></span>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <span class="st-menu__itemLabel svelte-n7le8g">${escape_html(item.label)}</span> `);
						if (chevronSide(depth, index) === "right") {
							$$renderer.push(`<!--[0--><span class="st-menu__itemChevron st-menu__itemChevron--end svelte-n7le8g" aria-hidden="true">`);
							Chevron_right($$renderer, {
								size: 16,
								strokeWidth: 2,
								"aria-hidden": "true"
							});
							$$renderer.push(`<!----></span>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></button></div>`);
					} else {
						$$renderer.push(`<!--[-1--><button${attr_class("st-menu__item svelte-n7le8g", void 0, {
							"st-menu__item--danger": item.danger,
							"st-menu__item--selected": selected
						})} type="button" role="menuitem"${attr("data-item-index", index)}${attr("aria-disabled", item.disabled ? "true" : void 0)}${attr("disabled", item.disabled, true)}${attr("tabindex", item.disabled ? void 0 : tabIndex)}>`);
						if (Icon) {
							$$renderer.push(`<!--[0--><span class="st-menu__itemIcon svelte-n7le8g" aria-hidden="true">`);
							if (typeof Icon === "string") $$renderer.push(`<!--[0-->${escape_html(Icon)}`);
							else {
								$$renderer.push("<!--[-1-->");
								if (Icon) {
									$$renderer.push("<!--[-->");
									Icon($$renderer, {
										size: 16,
										strokeWidth: 2
									});
									$$renderer.push("<!--]-->");
								} else {
									$$renderer.push("<!--[!-->");
									$$renderer.push("<!--]-->");
								}
							}
							$$renderer.push(`<!--]--></span>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <span class="st-menu__itemLabel svelte-n7le8g">${escape_html(item.label)}</span></button>`);
					}
					$$renderer.push(`<!--]-->`);
				} else if (item.kind === "divider") $$renderer.push(`<!--[1--><div class="st-menu__divider svelte-n7le8g" role="separator" aria-hidden="true"></div>`);
				else $$renderer.push(`<!--[-1--><div class="st-menu__group svelte-n7le8g"${attr("id", `${rootId()}--group-${depth}-${index}`)} role="presentation">${escape_html(item.label)}</div>`);
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]-->`);
		}
		function overflowrows($$renderer, list, depth) {
			$$renderer.push(`<!--[-->`);
			const each_array_1 = ensure_array_like(list);
			for (let index = 0, $$length = each_array_1.length; index < $$length; index++) {
				let item = each_array_1[index];
				if (isAction(item)) {
					$$renderer.push("<!--[0-->");
					const Icon = item.icon;
					const tabIndex = rovingTarget(depth, list) === index ? 0 : -1;
					$$renderer.push(`<li role="none" class="st-overflowMenu__listItem"><button${attr_class("st-overflowMenu__item", void 0, {
						"st-overflowMenu__item--danger": item.danger,
						"st-overflowMenu__item--selected": item.selected
					})} type="button" role="menuitem"${attr("data-item-index", index)}${attr("aria-disabled", item.disabled ? "true" : void 0)}${attr("disabled", item.disabled, true)}${attr("tabindex", item.disabled ? void 0 : tabIndex)}>`);
					if (Icon) {
						$$renderer.push(`<!--[0--><span class="st-overflowMenu__itemIcon" aria-hidden="true">`);
						if (typeof Icon === "string") $$renderer.push(`<!--[0-->${escape_html(Icon)}`);
						else {
							$$renderer.push("<!--[-1-->");
							if (Icon) {
								$$renderer.push("<!--[-->");
								Icon($$renderer, {
									size: 16,
									strokeWidth: 2
								});
								$$renderer.push("<!--]-->");
							} else {
								$$renderer.push("<!--[!-->");
								$$renderer.push("<!--]-->");
							}
						}
						$$renderer.push(`<!--]--></span>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> <span class="st-overflowMenu__itemLabel">${escape_html(item.label)}</span></button></li>`);
				} else if (item.kind === "divider") $$renderer.push(`<!--[1--><li role="separator" aria-hidden="true" class="st-overflowMenu__divider"></li>`);
				else $$renderer.push(`<!--[-1--><li role="presentation" class="st-overflowMenu__group">${escape_html(item.label)}</li>`);
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]-->`);
		}
		if (open) {
			$$renderer.push("<!--[0-->");
			if (hasCascade()) {
				$$renderer.push(`<!--[0--><div${attributes({
					...rest,
					id: void 0,
					class: clsx(classes())
				}, "svelte-n7le8g")}><div class="st-menu__scroll svelte-n7le8g" role="menu"${attr("id", rootId())}${attr("aria-label", label)} tabindex="-1" data-menu-level="0">`);
				menurows($$renderer, items, 0);
				$$renderer.push(`<!----></div> `);
				if (openPath.length >= 1 && isAction(items[openPath[0]]) && Array.isArray(items[openPath[0]].children)) {
					$$renderer.push("<!--[0-->");
					const level1 = items[openPath[0]].children;
					$$renderer.push(`<div${attr_class(clsx([
						"st-menu",
						"st-menu--submenu",
						dense ? "st-menu--dense" : null
					].filter(Boolean).join(" ")), "svelte-n7le8g")} role="menu"${attr("id", subId(0, openPath[0]))}${attr("aria-labelledby", parentButtonId(0, openPath[0]))} tabindex="-1" data-menu-level="1"${attr_style(panelStyle(0))}>`);
					menurows($$renderer, level1, 1);
					$$renderer.push(`<!----></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (openPath.length >= 2) {
					$$renderer.push("<!--[0-->");
					const mid = levelItems(1)[openPath[1]]?.children;
					if (mid) {
						$$renderer.push(`<!--[0--><div${attr_class(clsx([
							"st-menu",
							"st-menu--submenu",
							dense ? "st-menu--dense" : null
						].filter(Boolean).join(" ")), "svelte-n7le8g")} role="menu"${attr("id", subId(1, openPath[1]))}${attr("aria-labelledby", parentButtonId(1, openPath[1]))} tabindex="-1" data-menu-level="2"${attr_style(panelStyle(1))}>`);
						menurows($$renderer, mid, 2);
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			} else if (useOverflowClasses) {
				$$renderer.push(`<!--[1--><ul${attributes({
					...rest,
					id: rootId(),
					class: clsx(overflowClasses()),
					role: "menu",
					"aria-label": label,
					"data-menu-level": "0",
					style: overflowPanelStyle()
				}, "svelte-n7le8g")}>`);
				overflowrows($$renderer, items, 0);
				$$renderer.push(`<!----></ul>`);
			} else {
				$$renderer.push(`<!--[-1--><div${attributes({
					...rest,
					id: rootId(),
					class: clsx(classes()),
					role: "menu",
					"aria-label": label,
					"data-menu-level": "0"
				}, "svelte-n7le8g")}>`);
				menurows($$renderer, items, 0);
				$$renderer.push(`<!----></div>`);
			}
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { open });
	});
}
// node_modules/@sentropic/design-system-svelte/dist/IdentityButton.svelte
function IdentityButton($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { authState = "anonymous", user = null, mode = "icon", tone = "default", signInLabel = "Se connecter", accountLabel = "Compte", onSignIn, onSignOut, menu = [] } = $$props;
		let triggerEl = null;
		let open = false;
		const initials = derived(() => user?.name ? user.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "");
		const authed = derived(() => authState === "authenticated");
		const menuItems = derived(() => [...menu.map((e) => ({
			label: e.label,
			value: e.href ?? e.label
		})), ...onSignOut ? [{
			label: "Se déconnecter",
			value: "__signout"
		}] : []]);
		function onMenuSelect(value) {
			open = false;
			if (value === "__signout") return onSignOut?.();
			const entry = menu.find((e) => (e.href ?? e.label) === value);
			if (entry?.onClick) entry.onClick();
			else if (entry?.href) location.href = entry.href;
		}
		function face($$renderer) {
			if (authed() && user?.avatarSrc) $$renderer.push(`<!--[0--><img class="st-identityBtn__avatar svelte-tcpfp5"${attr("src", user.avatarSrc)} alt="" aria-hidden="true"/>`);
			else if (authed() && initials()) $$renderer.push(`<!--[1--><span class="st-identityBtn__initials svelte-tcpfp5" aria-hidden="true">${escape_html(initials())}</span>`);
			else {
				$$renderer.push("<!--[-1-->");
				User($$renderer, {
					size: 16,
					strokeWidth: 2.1,
					"aria-hidden": "true"
				});
			}
			$$renderer.push(`<!--]-->`);
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<span${attr_class("st-identityBtn svelte-tcpfp5", void 0, { "st-identityBtn--onColor": tone === "onColor" })}>`);
			if (mode === "button") {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					variant: authed() ? "ghost" : "secondary",
					size: "sm",
					onclick: () => authed() ? open = !open : onSignIn?.(),
					children: ($$renderer) => {
						face($$renderer);
						$$renderer.push(`<!----> <span>${escape_html(authed() ? user?.name ?? accountLabel : signInLabel)}</span>`);
					},
					$$slots: { default: true }
				});
			} else if (mode === "menu") {
				$$renderer.push(`<!--[1--><span class="st-identityBtn__wrap svelte-tcpfp5">`);
				IconButton($$renderer, {
					size: "sm",
					variant: "ghost",
					"aria-label": authed() ? accountLabel : signInLabel,
					onclick: () => open = !open,
					children: ($$renderer) => {
						face($$renderer);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></span> `);
				if (menuItems().length) {
					$$renderer.push("<!--[0-->");
					MenuPopover($$renderer, {
						trigger: triggerEl,
						placement: "bottom-end",
						label: accountLabel,
						get open() {
							return open;
						},
						set open($$value) {
							open = $$value;
							$$settled = false;
						},
						children: ($$renderer) => {
							Menu($$renderer, {
								label: accountLabel,
								items: menuItems(),
								onselect: onMenuSelect
							});
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			} else {
				$$renderer.push("<!--[-1-->");
				IconButton($$renderer, {
					size: "sm",
					variant: "ghost",
					"aria-label": authed() ? accountLabel : signInLabel,
					onclick: () => authed() ? menuItems().length ? open = !open : void 0 : onSignIn?.(),
					children: ($$renderer) => {
						face($$renderer);
					},
					$$slots: { default: true }
				});
			}
			$$renderer.push(`<!--]--></span>`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/AppShell.svelte
function AppShell($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const PANEL_VAR = {
			navigationPanel: "--st-appShell-navigation-width",
			contextPanel: "--st-appShell-context-width",
			utilityPanel: "--st-appShell-utility-width"
		};
		const PANEL_NOMINAL_PX = {
			navigationPanel: 320,
			contextPanel: 352,
			utilityPanel: 384
		};
		let { variant, config, topChrome, primaryRail, navigationPanel, main, contextPanel, utilityPanel, bottomPanel, children, mainId = "main", navigationLabel = "Workspace navigation", contextLabel = "Context panel", utilityLabel = "Utility panel", utilityMode = "reserve", utilitySide = "right", panelCollapse = "stack", primaryRailLabel = "Primary rail", navigationPanelLabel, contextPanelLabel, utilityPanelLabel, panelResize = false, panelWidths, defaultPanelWidths, onPanelResize, panelMinWidth = 180, panelMaxWidth = 640, class: className } = $$props;
		const navigationPanelLabelResolved = derived(() => navigationPanelLabel ?? navigationLabel);
		const contextPanelLabelResolved = derived(() => contextPanelLabel ?? contextLabel);
		const utilityPanelLabelResolved = derived(() => utilityPanelLabel ?? utilityLabel);
		let primaryRailPanelOpen = false;
		let navigationPanelOpen = false;
		let contextPanelOpen = false;
		let utilityPanelOpen = false;
		let internalWidths = run(() => ({ ...defaultPanelWidths }));
		const isWidthControlled = derived(() => panelWidths !== void 0);
		derived(() => utilitySide !== "right");
		function widthFor(key) {
			return (isWidthControlled() ? panelWidths : internalWidths)?.[key];
		}
		function clampWidth(n) {
			return Math.min(Math.max(n, panelMinWidth), panelMaxWidth);
		}
		function displayWidth(key) {
			return clampWidth(widthFor(key) ?? PANEL_NOMINAL_PX[key]);
		}
		const panelStyle = derived(() => {
			if (!panelResize) return void 0;
			const parts = [];
			for (const key of Object.keys(PANEL_VAR)) {
				const width = widthFor(key);
				if (width !== void 0) parts.push(`${PANEL_VAR[key]}: ${clampWidth(width)}px`);
			}
			return parts.length ? parts.join("; ") : void 0;
		});
		const mode = derived(() => variant ?? (config ? "site" : "workspace"));
		const siteConfig = derived(() => config ?? {
			brand: { name: "Sentropic" },
			nav: [],
			theming: {
				themes: [],
				theme: ""
			}
		});
		const brand = derived(() => siteConfig().brand ?? { name: "Sentropic" });
		const nav = derived(() => Array.isArray(siteConfig().nav) ? siteConfig().nav : []);
		const t = derived(() => siteConfig().theming ?? {
			themes: [],
			theme: ""
		});
		const siteClasses = derived(() => ["st-shell", className].filter(Boolean).join(" "));
		const workspaceClasses = derived(() => [
			"st-appShell",
			"st-appShell--workspace",
			className
		].filter(Boolean).join(" "));
		const isActive = (item) => item.active != null ? item.active : siteConfig().activePath != null && (item.href === siteConfig().activePath || item.href !== "/" && (siteConfig().activePath ?? "").startsWith(item.href));
		const themeItems = derived(() => (t().themes ?? []).map((o) => ({
			label: o.label,
			value: o.id
		})));
		const fwItems = derived(() => (siteConfig().frameworkSwitcher?.available ?? []).map((o) => ({
			label: o.label,
			value: o.id
		})));
		const localeItems = derived(() => (siteConfig().locale?.available ?? []).map((o) => ({
			label: o.label,
			value: o.code
		})));
		const fwLabel = derived(() => (siteConfig().frameworkSwitcher?.available ?? []).find((o) => o.id === siteConfig().frameworkSwitcher?.current)?.label ?? "");
		const themeLabel = derived(() => (t().themes ?? []).find((o) => o.id === t().theme)?.label ?? "");
		let themeEl = null;
		let fwEl = null;
		let localeEl = null;
		let themeOpen = false;
		let fwOpen = false;
		let localeOpen = false;
		function cycleColorMode() {
			const cur = t().colorMode;
			t().onColorModeChange?.(cur === "light" ? "dark" : cur === "dark" ? "auto" : "light");
		}
		function logo($$renderer) {
			$$renderer.push(`<a class="st-shell__brand svelte-do0njo"${attr("href", brand().href ?? "/")}${attr("aria-label", brand().label ?? [brand().name, brand().productName].filter(Boolean).join(" "))}>`);
			if (brand().logoSrc) $$renderer.push(`<!--[0--><img class="st-shell__brandMark svelte-do0njo"${attr("src", brand().logoSrc)} alt="" aria-hidden="true"/>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <span class="st-shell__brandCopy svelte-do0njo">`);
			if (brand().name) $$renderer.push(`<!--[0--><span class="st-shell__brandName svelte-do0njo">${escape_html(brand().name)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (brand().productName) $$renderer.push(`<!--[0--><span class="st-shell__brandProduct svelte-do0njo">${escape_html(brand().productName)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></span></a>`);
		}
		function navigation($$renderer) {
			$$renderer.push(`<nav class="st-shell__nav svelte-do0njo"${attr("aria-label", siteConfig().navLabel ?? "Navigation")}><!--[-->`);
			const each_array = ensure_array_like(nav());
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let item = each_array[$$index];
				$$renderer.push(`<a class="st-shell__navLink svelte-do0njo"${attr("href", item.href)}${attr("aria-current", isActive(item) ? "page" : void 0)}>${escape_html(item.label)}</a>`);
			}
			$$renderer.push(`<!--]--></nav>`);
		}
		function actions($$renderer) {
			$$renderer.push(`<div class="st-shell__actions svelte-do0njo">`);
			if (siteConfig().search?.enabled) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					variant: "secondary",
					size: "sm",
					class: "st-shell__search",
					onclick: () => siteConfig().search?.onSearch?.(""),
					children: ($$renderer) => {
						Search($$renderer, {
							size: 16,
							strokeWidth: 2.1,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----> <span>${escape_html(siteConfig().search.placeholder ?? "Rechercher…")}</span> <kbd class="st-shell__kbd svelte-do0njo">/</kbd>`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (siteConfig().frameworkSwitcher?.enabled) {
				$$renderer.push(`<!--[0--><span class="st-shell__menuWrap svelte-do0njo">`);
				Button($$renderer, {
					variant: "secondary",
					size: "sm",
					class: "st-shell__switch",
					onclick: () => fwOpen = !fwOpen,
					"aria-haspopup": "menu",
					"aria-expanded": fwOpen,
					children: ($$renderer) => {
						Boxes($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----><span>${escape_html(fwLabel())}</span>`);
						Chevron_down($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></span> `);
				MenuPopover($$renderer, {
					trigger: fwEl,
					placement: "bottom-end",
					label: "Framework",
					get open() {
						return fwOpen;
					},
					set open($$value) {
						fwOpen = $$value;
						$$settled = false;
					},
					children: ($$renderer) => {
						Menu($$renderer, {
							label: "Framework",
							items: fwItems(),
							onselect: (v) => {
								siteConfig().frameworkSwitcher?.onChange?.(v);
								fwOpen = false;
							}
						});
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if ((t().themes ?? []).length) {
				$$renderer.push(`<!--[0--><span class="st-shell__menuWrap svelte-do0njo">`);
				Button($$renderer, {
					variant: "secondary",
					size: "sm",
					class: "st-shell__switch",
					onclick: () => themeOpen = !themeOpen,
					"aria-haspopup": "menu",
					"aria-expanded": themeOpen,
					children: ($$renderer) => {
						Palette($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----><span>${escape_html(themeLabel())}</span>`);
						Chevron_down($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></span> `);
				MenuPopover($$renderer, {
					trigger: themeEl,
					placement: "bottom-end",
					label: t().themeLabel ?? "Thème",
					get open() {
						return themeOpen;
					},
					set open($$value) {
						themeOpen = $$value;
						$$settled = false;
					},
					children: ($$renderer) => {
						Menu($$renderer, {
							label: t().themeLabel ?? "Thème",
							items: themeItems(),
							onselect: (v) => {
								t().onThemeChange?.(v);
								themeOpen = false;
							}
						});
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (t().colorMode) {
				$$renderer.push("<!--[0-->");
				IconButton($$renderer, {
					size: "sm",
					variant: "ghost",
					"aria-label": "Mode couleur",
					onclick: cycleColorMode,
					children: ($$renderer) => {
						if (t().colorMode === "dark") {
							$$renderer.push("<!--[0-->");
							Moon($$renderer, {
								size: 16,
								"aria-hidden": "true"
							});
						} else {
							$$renderer.push("<!--[-1-->");
							Sun($$renderer, {
								size: 16,
								"aria-hidden": "true"
							});
						}
						$$renderer.push(`<!--]-->`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (siteConfig().locale) {
				$$renderer.push(`<!--[0--><span class="st-shell__menuWrap svelte-do0njo">`);
				Button($$renderer, {
					variant: "secondary",
					size: "sm",
					class: "st-shell__switch",
					onclick: () => localeOpen = !localeOpen,
					"aria-haspopup": "menu",
					"aria-expanded": localeOpen,
					children: ($$renderer) => {
						Globe($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----><span>${escape_html((siteConfig().locale.current ?? "").toUpperCase())}</span>`);
						Chevron_down($$renderer, {
							size: 14,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></span> `);
				MenuPopover($$renderer, {
					trigger: localeEl,
					placement: "bottom-end",
					label: siteConfig().locale.label ?? "Langue",
					get open() {
						return localeOpen;
					},
					set open($$value) {
						localeOpen = $$value;
						$$settled = false;
					},
					children: ($$renderer) => {
						Menu($$renderer, {
							label: siteConfig().locale.label ?? "Langue",
							items: localeItems(),
							onselect: (v) => {
								siteConfig().locale?.onChange?.(v);
								localeOpen = false;
							}
						});
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (siteConfig().identity) {
				$$renderer.push("<!--[0-->");
				IdentityButton($$renderer, {
					mode: "icon",
					authState: siteConfig().identity.state,
					user: siteConfig().identity.user ?? null,
					signInLabel: siteConfig().identity.label ?? "Se connecter",
					onSignIn: () => siteConfig().identity?.onSignIn?.(),
					onSignOut: () => siteConfig().identity?.onSignOut?.(),
					menu: siteConfig().identity.menu ?? []
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (mode() === "workspace") {
				$$renderer.push(`<!--[0--><div${attr_class(clsx(workspaceClasses()), "svelte-do0njo")} data-st-app-shell-variant="workspace"${attr("data-utility-mode", utilityMode)}${attr("data-utility-side", utilitySide)}${attr("data-panel-collapse", panelCollapse)}${attr_style(panelStyle())}>`);
				if (topChrome) {
					$$renderer.push(`<!--[0--><div class="st-appShell__topChrome svelte-do0njo">`);
					topChrome($$renderer);
					$$renderer.push(`<!----></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="st-appShell__body svelte-do0njo">`);
				if (primaryRail) {
					$$renderer.push(`<!--[0--><aside class="st-appShell__primaryRail svelte-do0njo" aria-label="Primary rail">`);
					if (panelCollapse === "accordion") {
						$$renderer.push(`<!--[0--><button type="button" class="st-appShell__panelDisclosure svelte-do0njo"${attr("aria-expanded", primaryRailPanelOpen)} aria-controls="st-appShell-primaryRail-region" id="st-appShell-primaryRail-trigger"><span class="st-appShell__panelDisclosureLabel">${escape_html(primaryRailLabel)}</span> <span${attr_class("st-appShell__panelDisclosureIcon svelte-do0njo", void 0, { "st-appShell__panelDisclosureIcon--expanded": primaryRailPanelOpen })}>`);
						Chevron_down($$renderer, {
							size: 16,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----></span></button> <div${attr_class("st-appShell__panelRegion svelte-do0njo", void 0, { "st-appShell__panelRegion--collapsed": true })} id="st-appShell-primaryRail-region" role="region" aria-labelledby="st-appShell-primaryRail-trigger">`);
						primaryRail($$renderer);
						$$renderer.push(`<!----></div>`);
					} else {
						$$renderer.push("<!--[-1-->");
						primaryRail($$renderer);
						$$renderer.push(`<!---->`);
					}
					$$renderer.push(`<!--]--></aside>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (navigationPanel) {
					$$renderer.push(`<!--[0--><aside class="st-appShell__navigationPanel svelte-do0njo"${attr("aria-label", navigationLabel)}>`);
					if (panelCollapse === "accordion") {
						$$renderer.push(`<!--[0--><button type="button" class="st-appShell__panelDisclosure svelte-do0njo"${attr("aria-expanded", navigationPanelOpen)} aria-controls="st-appShell-navigationPanel-region" id="st-appShell-navigationPanel-trigger"><span class="st-appShell__panelDisclosureLabel">${escape_html(navigationPanelLabelResolved())}</span> <span${attr_class("st-appShell__panelDisclosureIcon svelte-do0njo", void 0, { "st-appShell__panelDisclosureIcon--expanded": navigationPanelOpen })}>`);
						Chevron_down($$renderer, {
							size: 16,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----></span></button> <div${attr_class("st-appShell__panelRegion svelte-do0njo", void 0, { "st-appShell__panelRegion--collapsed": true })} id="st-appShell-navigationPanel-region" role="region" aria-labelledby="st-appShell-navigationPanel-trigger">`);
						navigationPanel($$renderer);
						$$renderer.push(`<!----></div>`);
					} else {
						$$renderer.push("<!--[-1-->");
						navigationPanel($$renderer);
						$$renderer.push(`<!---->`);
					}
					$$renderer.push(`<!--]--> `);
					if (panelResize) $$renderer.push(`<!--[0--><div class="st-appShell__resizeHandle svelte-do0njo" role="separator" aria-orientation="vertical" tabindex="0"${attr("aria-valuenow", displayWidth("navigationPanel"))}${attr("aria-valuemin", panelMinWidth)}${attr("aria-valuemax", panelMaxWidth)}${attr("aria-label", `Resize ${navigationLabel}`)}></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></aside>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <main class="st-appShell__main svelte-do0njo"${attr("id", mainId)}>`);
				if (main) {
					$$renderer.push("<!--[0-->");
					main($$renderer);
					$$renderer.push(`<!---->`);
				} else if (children) {
					$$renderer.push("<!--[1-->");
					children($$renderer);
					$$renderer.push(`<!---->`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></main> `);
				if (contextPanel) {
					$$renderer.push(`<!--[0--><aside class="st-appShell__contextPanel svelte-do0njo"${attr("aria-label", contextLabel)}>`);
					if (panelCollapse === "accordion") {
						$$renderer.push(`<!--[0--><button type="button" class="st-appShell__panelDisclosure svelte-do0njo"${attr("aria-expanded", contextPanelOpen)} aria-controls="st-appShell-contextPanel-region" id="st-appShell-contextPanel-trigger"><span class="st-appShell__panelDisclosureLabel">${escape_html(contextPanelLabelResolved())}</span> <span${attr_class("st-appShell__panelDisclosureIcon svelte-do0njo", void 0, { "st-appShell__panelDisclosureIcon--expanded": contextPanelOpen })}>`);
						Chevron_down($$renderer, {
							size: 16,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----></span></button> <div${attr_class("st-appShell__panelRegion svelte-do0njo", void 0, { "st-appShell__panelRegion--collapsed": true })} id="st-appShell-contextPanel-region" role="region" aria-labelledby="st-appShell-contextPanel-trigger">`);
						contextPanel($$renderer);
						$$renderer.push(`<!----></div>`);
					} else {
						$$renderer.push("<!--[-1-->");
						contextPanel($$renderer);
						$$renderer.push(`<!---->`);
					}
					$$renderer.push(`<!--]--> `);
					if (panelResize) $$renderer.push(`<!--[0--><div class="st-appShell__resizeHandle svelte-do0njo" role="separator" aria-orientation="vertical" tabindex="0"${attr("aria-valuenow", displayWidth("contextPanel"))}${attr("aria-valuemin", panelMinWidth)}${attr("aria-valuemax", panelMaxWidth)}${attr("aria-label", `Resize ${contextLabel}`)}></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></aside>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (utilityPanel) {
					$$renderer.push(`<!--[0--><aside class="st-appShell__utilityPanel svelte-do0njo"${attr("aria-label", utilityLabel)}>`);
					if (panelCollapse === "accordion") {
						$$renderer.push(`<!--[0--><button type="button" class="st-appShell__panelDisclosure svelte-do0njo"${attr("aria-expanded", utilityPanelOpen)} aria-controls="st-appShell-utilityPanel-region" id="st-appShell-utilityPanel-trigger"><span class="st-appShell__panelDisclosureLabel">${escape_html(utilityPanelLabelResolved())}</span> <span${attr_class("st-appShell__panelDisclosureIcon svelte-do0njo", void 0, { "st-appShell__panelDisclosureIcon--expanded": utilityPanelOpen })}>`);
						Chevron_down($$renderer, {
							size: 16,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----></span></button> <div${attr_class("st-appShell__panelRegion svelte-do0njo", void 0, { "st-appShell__panelRegion--collapsed": true })} id="st-appShell-utilityPanel-region" role="region" aria-labelledby="st-appShell-utilityPanel-trigger">`);
						utilityPanel($$renderer);
						$$renderer.push(`<!----></div>`);
					} else {
						$$renderer.push("<!--[-1-->");
						utilityPanel($$renderer);
						$$renderer.push(`<!---->`);
					}
					$$renderer.push(`<!--]--> `);
					if (panelResize && utilitySide !== "bottom") $$renderer.push(`<!--[0--><div class="st-appShell__resizeHandle svelte-do0njo" role="separator" aria-orientation="vertical" tabindex="0"${attr("aria-valuenow", displayWidth("utilityPanel"))}${attr("aria-valuemin", panelMinWidth)}${attr("aria-valuemax", panelMaxWidth)}${attr("aria-label", `Resize ${utilityLabel}`)}></div>`);
					else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></aside>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div> `);
				if (bottomPanel) {
					$$renderer.push(`<!--[0--><section class="st-appShell__bottomPanel svelte-do0njo" aria-label="Workspace tools">`);
					bottomPanel($$renderer);
					$$renderer.push(`<!----></section>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			} else {
				$$renderer.push("<!--[-1-->");
				Header($$renderer, {
					class: siteClasses(),
					label: siteConfig().brand?.label ?? "Navigation",
					logo,
					navigation,
					actions
				});
			}
			$$renderer.push(`<!--]-->`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
	});
}
export { IconButton as a, Badge as c, X as d, Icon as f, Container as i, deriveInitials as l, EmptyState as n, Card as o, Flex as r, Button as s, AppShell as t, Alert as u };

//# sourceMappingURL=AppShell.js.map