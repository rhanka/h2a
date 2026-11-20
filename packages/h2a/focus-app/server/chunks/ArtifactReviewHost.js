import { _ as attr, a as derived, b as run, d as spread_props, f as stringify, i as bind_props, l as props_id, n as attr_style, r as attributes, s as ensure_array_like, t as attr_class, v as clsx, x as escape_html } from "./server2.js";
import { a as IconButton, c as Badge, d as X, f as Icon, l as deriveInitials, n as EmptyState, r as Flex, s as Button, u as Alert } from "./AppShell.js";
import { n as tick } from "./index-server.js";
// node_modules/@lucide/svelte/dist/icons/arrow-left.svelte
function Arrow_left($$renderer, $$props) {
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
			{ name: "arrow-left" },
			props,
			{
				iconNode: [["path", { "d": "m12 19-7-7 7-7" }], ["path", { "d": "M19 12H5" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/bot.svelte
function Bot($$renderer, $$props) {
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
			{ name: "bot" },
			props,
			{
				iconNode: [
					["path", { "d": "M12 8V4H8" }],
					["rect", {
						"width": "16",
						"height": "12",
						"x": "4",
						"y": "8",
						"rx": "2"
					}],
					["path", { "d": "M2 14h2" }],
					["path", { "d": "M20 14h2" }],
					["path", { "d": "M15 13v2" }],
					["path", { "d": "M9 13v2" }]
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
// node_modules/@lucide/svelte/dist/icons/check.svelte
function Check($$renderer, $$props) {
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
			{ name: "check" },
			props,
			{
				iconNode: [["path", { "d": "M20 6 9 17l-5-5" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/circle-check.svelte
function Circle_check($$renderer, $$props) {
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
			{ name: "circle-check" },
			props,
			{
				iconNode: [["circle", {
					"cx": "12",
					"cy": "12",
					"r": "10"
				}], ["path", { "d": "m9 12 2 2 4-4" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/cpu.svelte
function Cpu($$renderer, $$props) {
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
			{ name: "cpu" },
			props,
			{
				iconNode: [
					["path", { "d": "M12 20v2" }],
					["path", { "d": "M12 2v2" }],
					["path", { "d": "M17 20v2" }],
					["path", { "d": "M17 2v2" }],
					["path", { "d": "M2 12h2" }],
					["path", { "d": "M2 17h2" }],
					["path", { "d": "M2 7h2" }],
					["path", { "d": "M20 12h2" }],
					["path", { "d": "M20 17h2" }],
					["path", { "d": "M20 7h2" }],
					["path", { "d": "M7 20v2" }],
					["path", { "d": "M7 2v2" }],
					["rect", {
						"x": "4",
						"y": "4",
						"width": "16",
						"height": "16",
						"rx": "2"
					}],
					["rect", {
						"x": "8",
						"y": "8",
						"width": "8",
						"height": "8",
						"rx": "1"
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
// node_modules/@lucide/svelte/dist/icons/external-link.svelte
function External_link($$renderer, $$props) {
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
			{ name: "external-link" },
			props,
			{
				iconNode: [
					["path", { "d": "M15 3h6v6" }],
					["path", { "d": "M10 14 21 3" }],
					["path", { "d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }]
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
// node_modules/@lucide/svelte/dist/icons/link-2.svelte
function Link_2($$renderer, $$props) {
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
			{ name: "link-2" },
			props,
			{
				iconNode: [
					["path", { "d": "M9 17H7A5 5 0 0 1 7 7h2" }],
					["path", { "d": "M15 7h2a5 5 0 1 1 0 10h-2" }],
					["line", {
						"x1": "8",
						"x2": "16",
						"y1": "12",
						"y2": "12"
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
// node_modules/@lucide/svelte/dist/icons/message-square.svelte
function Message_square($$renderer, $$props) {
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
			{ name: "message-square" },
			props,
			{
				iconNode: [["path", { "d": "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/pencil.svelte
function Pencil($$renderer, $$props) {
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
			{ name: "pencil" },
			props,
			{
				iconNode: [["path", { "d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }], ["path", { "d": "m15 5 4 4" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/rotate-ccw.svelte
function Rotate_ccw($$renderer, $$props) {
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
			{ name: "rotate-ccw" },
			props,
			{
				iconNode: [["path", { "d": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { "d": "M3 3v5h5" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
// node_modules/@lucide/svelte/dist/icons/trash-2.svelte
function Trash_2($$renderer, $$props) {
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
			{ name: "trash-2" },
			props,
			{
				iconNode: [
					["path", { "d": "M10 11v6" }],
					["path", { "d": "M14 11v6" }],
					["path", { "d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
					["path", { "d": "M3 6h18" }],
					["path", { "d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]
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
// node_modules/@lucide/svelte/dist/icons/unlink.svelte
function Unlink($$renderer, $$props) {
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
			{ name: "unlink" },
			props,
			{
				iconNode: [
					["path", { "d": "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" }],
					["path", { "d": "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" }],
					["line", {
						"x1": "8",
						"x2": "8",
						"y1": "2",
						"y2": "5"
					}],
					["line", {
						"x1": "2",
						"x2": "5",
						"y1": "8",
						"y2": "8"
					}],
					["line", {
						"x1": "16",
						"x2": "16",
						"y1": "19",
						"y2": "22"
					}],
					["line", {
						"x1": "19",
						"x2": "22",
						"y1": "16",
						"y2": "16"
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
// node_modules/@sentropic/design-system-svelte/dist/AvatarGroup.svelte
function AvatarGroup($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** Nombre maximum d'avatars visibles. Au-delà, un jeton « +N » est affiché. */
		/** Taille appliquée au jeton de débordement (doit refléter les Avatar). */
		/** Nombre total réel d'éléments (sert à calculer le « +N » si > max). */
		let { max, size = "md", total, class: className, children, $$slots, $$events, ...rest } = $$props;
		const overflow = derived(() => max != null && total != null && total > max ? total - max : 0);
		const classes = derived(() => [
			"st-avatarGroup",
			`st-avatarGroup--${size}`,
			className
		].filter(Boolean).join(" "));
		$$renderer.push(`<div${attributes({
			...rest,
			class: clsx(classes())
		}, "svelte-1pyotkr", void 0, { "--st-avatar-group-max": max ?? "" })}>`);
		children?.($$renderer);
		$$renderer.push(`<!----> `);
		if (overflow() > 0) $$renderer.push(`<!--[0--><span class="st-avatarGroup__overflow svelte-1pyotkr"${attr("aria-label", `+${overflow()}`)}>+${escape_html(overflow())}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/Drawer.svelte
function Drawer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false, title, description, side = "right", closeLabel = "Close", class: className, children, footer, onclose, $$slots, $$events, ...rest } = $$props;
		[
			"a[href]",
			"button:not([disabled])",
			"input:not([disabled]):not([type='hidden'])",
			"select:not([disabled])",
			"textarea:not([disabled])",
			"[tabindex]:not([tabindex='-1'])"
		].join(",");
		const classes = () => [
			"st-drawer",
			`st-drawer--${side}`,
			className
		].filter(Boolean).join(" ");
		if (open) {
			$$renderer.push(`<!--[0--><div class="st-drawer__backdrop svelte-i68ybm" role="presentation"><aside${attributes({
				...rest,
				class: clsx(classes()),
				role: "dialog",
				"aria-modal": "true",
				"aria-label": title,
				tabindex: "-1"
			}, "svelte-i68ybm")}><header class="st-drawer__header svelte-i68ybm"><div><h2 class="st-drawer__title svelte-i68ybm" tabindex="-1">${escape_html(title)}</h2> `);
			if (description) $$renderer.push(`<!--[0--><p class="st-drawer__description svelte-i68ybm">${escape_html(description)}</p>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> <button class="st-drawer__close svelte-i68ybm" type="button"${attr("aria-label", closeLabel)}><span aria-hidden="true">x</span></button></header> <div class="st-drawer__body svelte-i68ybm">`);
			children?.($$renderer);
			$$renderer.push(`<!----></div> `);
			if (footer) {
				$$renderer.push(`<!--[0--><footer class="st-drawer__footer svelte-i68ybm">`);
				footer($$renderer);
				$$renderer.push(`<!----></footer>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></aside></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { open });
	});
}
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
// node_modules/@sentropic/design-system-svelte/dist/Tile.svelte
function Tile($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** `static` (présentation), `clickable` (lien/bouton), `selectable` (case unitaire). */
		/** Pour `clickable` : si fourni, rend un `<a>`, sinon un `<button>`. */
		/** Pour `selectable` : état coché (bindable). */
		/** Titre rapide (sinon utiliser le slot `children`). */
		/** Pour `selectable` : notifié au changement d'état. */
		let { variant = "static", href, selected = false, disabled = false, title, description, class: className, onclick, onselect, children, $$slots, $$events, ...rest } = $$props;
		const classes = () => [
			"st-tile",
			`st-tile--${variant}`,
			variant === "selectable" && selected ? "st-tile--selected" : null,
			disabled ? "st-tile--disabled" : null,
			className
		].filter(Boolean).join(" ");
		function body($$renderer) {
			if (children) {
				$$renderer.push("<!--[0-->");
				children($$renderer);
				$$renderer.push(`<!---->`);
			} else {
				$$renderer.push("<!--[-1-->");
				if (title) $$renderer.push(`<!--[0--><span class="st-tile__title svelte-1vcfi3">${escape_html(title)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (description) $$renderer.push(`<!--[0--><span class="st-tile__description svelte-1vcfi3">${escape_html(description)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]-->`);
		}
		if (variant === "clickable" && href) {
			$$renderer.push(`<!--[0--><a${attributes({
				...rest,
				class: clsx(classes()),
				href,
				"aria-disabled": disabled
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></a>`);
		} else if (variant === "clickable") {
			$$renderer.push(`<!--[1--><button${attributes({
				...rest,
				type: "button",
				class: clsx(classes()),
				disabled
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></button>`);
		} else if (variant === "selectable") {
			$$renderer.push(`<!--[2--><label${attr_class(clsx(classes()), "svelte-1vcfi3")}><input type="checkbox" class="st-tile__input svelte-1vcfi3"${attr("checked", selected, true)}${attr("disabled", disabled, true)}/> <span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></label>`);
		} else {
			$$renderer.push(`<!--[-1--><div${attributes({
				...rest,
				class: clsx(classes())
			}, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
			body($$renderer);
			$$renderer.push(`<!----></span></div>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { selected });
	});
}
// node_modules/@sentropic/design-system-review-core/dist/types.js
/** Maximum encoded length of `CommentTarget.sectionKey` (SPEC-r6 §2, D3). */
var MAX_SECTION_KEY_LENGTH$1 = 2048;
/** Display-only UI labels for `CommentState` (SPEC-r6 §1.1, §3). */
var COMMENT_STATE_UI_LABELS = Object.freeze({
	open: "Open",
	closed: "Resolved"
});
function getCommentStateLabel(state) {
	return COMMENT_STATE_UI_LABELS[state];
}
/** Normalise `record` + `recordType: 'artifact'` into `kind: 'artifact'` dropping `recordType` (§1.2). */
function normalizeCommentTarget(target) {
	if (target.kind === "record" && target.recordType === "artifact") {
		const normalized = {
			kind: "artifact",
			id: target.id
		};
		if (target.sectionKey !== void 0) normalized.sectionKey = target.sectionKey;
		return normalized;
	}
	const copy = {
		kind: target.kind,
		id: target.id
	};
	if (target.sectionKey !== void 0) copy.sectionKey = target.sectionKey;
	if (target.recordType !== void 0) copy.recordType = target.recordType;
	return copy;
}
// node_modules/@sentropic/design-system-review-core/dist/authorship.js
var FALLBACK_ACTOR_COLOR$1 = "#64748b";
/**
* UI eligibility for edit/delete actions (SPEC-r6 §1, §3):
* offered on human comments of the current user (or when `canModerate` is true).
* Agent comments written under the user's owner id are NOT offered as own human edits.
*/
function canEditOrDeleteComment(comment, currentUser, options) {
	if (options?.canModerate === true) return true;
	return comment.authorship.sponsor === void 0 && comment.authorship.author.kind === "human" && comment.authorship.author.actorId === currentUser.actorId && comment.author.id === currentUser.actorId;
}
// node_modules/@sentropic/design-system-review-core/dist/adapter.js
var ReviewAdapterError = class extends Error {
	code;
	status;
	constructor(code, status, message) {
		super(message);
		this.name = "ReviewAdapterError";
		this.code = code;
		this.status = status;
	}
};
var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var BASE64URL_LOOKUP = (() => {
	const table = (/* @__PURE__ */ new Int16Array(128)).fill(-1);
	for (let i = 0; i < 64; i++) table[BASE64URL_ALPHABET.charCodeAt(i)] = i;
	return table;
})();
var utf8Encoder = new TextEncoder();
var utf8Decoder = new TextDecoder("utf-8", { fatal: true });
/** Encodes raw UTF-8 bytes to unpadded RFC 4648 §5 base64url (never uses `btoa`). */
function bytesToBase64Url(bytes) {
	const len = bytes.length;
	if (len === 0) return "";
	const chunks = [];
	let i = 0;
	for (; i + 2 < len; i += 3) {
		const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
		chunks.push(BASE64URL_ALPHABET[n >>> 18 & 63], BASE64URL_ALPHABET[n >>> 12 & 63], BASE64URL_ALPHABET[n >>> 6 & 63], BASE64URL_ALPHABET[n & 63]);
	}
	const rem = len - i;
	if (rem === 1) {
		const n = bytes[i];
		chunks.push(BASE64URL_ALPHABET[n >>> 2 & 63], BASE64URL_ALPHABET[n << 4 & 63]);
	} else if (rem === 2) {
		const n = bytes[i] << 8 | bytes[i + 1];
		chunks.push(BASE64URL_ALPHABET[n >>> 10 & 63], BASE64URL_ALPHABET[n >>> 4 & 63], BASE64URL_ALPHABET[n << 2 & 63]);
	}
	return chunks.join("");
}
/** Decodes canonical unpadded RFC 4648 §5 base64url into bytes, or `null` if invalid. */
function base64UrlToBytes(encoded) {
	const len = encoded.length;
	if (len === 0) return /* @__PURE__ */ new Uint8Array(0);
	const rem = len % 4;
	if (rem === 1) return null;
	const fullGroups = (len - rem) / 4;
	const byteLen = fullGroups * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
	const out = new Uint8Array(byteLen);
	let outIdx = 0;
	let inIdx = 0;
	for (let g = 0; g < fullGroups; g++) {
		const c0 = encoded.charCodeAt(inIdx++);
		const c1 = encoded.charCodeAt(inIdx++);
		const c2 = encoded.charCodeAt(inIdx++);
		const c3 = encoded.charCodeAt(inIdx++);
		if (c0 >= 128 || c1 >= 128 || c2 >= 128 || c3 >= 128) return null;
		const v0 = BASE64URL_LOOKUP[c0];
		const v1 = BASE64URL_LOOKUP[c1];
		const v2 = BASE64URL_LOOKUP[c2];
		const v3 = BASE64URL_LOOKUP[c3];
		if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return null;
		const n = v0 << 18 | v1 << 12 | v2 << 6 | v3;
		out[outIdx++] = n >>> 16 & 255;
		out[outIdx++] = n >>> 8 & 255;
		out[outIdx++] = n & 255;
	}
	if (rem === 2) {
		const c0 = encoded.charCodeAt(inIdx++);
		const c1 = encoded.charCodeAt(inIdx++);
		if (c0 >= 128 || c1 >= 128) return null;
		const v0 = BASE64URL_LOOKUP[c0];
		const v1 = BASE64URL_LOOKUP[c1];
		if (v0 < 0 || v1 < 0 || (v1 & 15) !== 0) return null;
		out[outIdx++] = (v0 << 2 | v1 >>> 4) & 255;
	} else if (rem === 3) {
		const c0 = encoded.charCodeAt(inIdx++);
		const c1 = encoded.charCodeAt(inIdx++);
		const c2 = encoded.charCodeAt(inIdx++);
		if (c0 >= 128 || c1 >= 128 || c2 >= 128) return null;
		const v0 = BASE64URL_LOOKUP[c0];
		const v1 = BASE64URL_LOOKUP[c1];
		const v2 = BASE64URL_LOOKUP[c2];
		if (v0 < 0 || v1 < 0 || v2 < 0 || (v2 & 3) !== 0) return null;
		const n = v0 << 10 | v1 << 4 | v2 >>> 2;
		out[outIdx++] = n >>> 8 & 255;
		out[outIdx++] = n & 255;
	}
	return out;
}
function encodeRaw(payload) {
	return "a1:" + bytesToBase64Url(utf8Encoder.encode(JSON.stringify(payload)));
}
function isValidRect(rect) {
	if (!rect || typeof rect !== "object") return false;
	const { x, y, width, height } = rect;
	if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return false;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return false;
	return x >= 0 && y >= 0 && width > 0 && height > 0 && x <= 1 && y <= 1 && x + width <= 1.000000001 && y + height <= 1.000000001;
}
function isValidPos(pos) {
	if (!pos || typeof pos !== "object") return false;
	const p = pos;
	return typeof p["start"] === "number" && typeof p["end"] === "number" && Number.isInteger(p["start"]) && Number.isInteger(p["end"]) && p["start"] >= 0 && p["end"] >= p["start"];
}
function validateAndSanitize(raw) {
	if (!raw || typeof raw !== "object") return {
		ok: false,
		message: "Anchor payload must be an object."
	};
	const obj = raw;
	const v = obj["v"];
	if (typeof v !== "string" || v.length === 0) return {
		ok: false,
		message: "Anchor payload requires a non-empty string version `v`."
	};
	switch (obj["t"]) {
		case "text": {
			const qRaw = obj["q"];
			if (!qRaw || typeof qRaw !== "object") return {
				ok: false,
				message: "Text anchor requires quote object `q`."
			};
			const qObj = qRaw;
			if (typeof qObj["exact"] !== "string" || qObj["exact"].length === 0) return {
				ok: false,
				message: "Text anchor requires non-empty `q.exact`."
			};
			if (qObj["prefix"] !== void 0 && typeof qObj["prefix"] !== "string") return {
				ok: false,
				message: "Text anchor `q.prefix` must be a string."
			};
			if (qObj["suffix"] !== void 0 && typeof qObj["suffix"] !== "string") return {
				ok: false,
				message: "Text anchor `q.suffix` must be a string."
			};
			if (obj["pos"] !== void 0 && !isValidPos(obj["pos"])) return {
				ok: false,
				message: "Text anchor `pos` must be valid non-negative integer offsets."
			};
			if (obj["sel"] !== void 0 && (typeof obj["sel"] !== "string" || obj["sel"].length === 0)) return {
				ok: false,
				message: "Text anchor `sel` must be a non-empty string when present."
			};
			if (obj["aid"] !== void 0 && (typeof obj["aid"] !== "string" || obj["aid"].length === 0)) return {
				ok: false,
				message: "Text anchor `aid` must be a non-empty string when present."
			};
			const q = { exact: qObj["exact"] };
			if (typeof qObj["prefix"] === "string" && qObj["prefix"].length > 0) q.prefix = qObj["prefix"];
			if (typeof qObj["suffix"] === "string" && qObj["suffix"].length > 0) q.suffix = qObj["suffix"];
			const payload = {
				t: "text",
				q,
				v
			};
			if (obj["pos"] !== void 0) {
				const pos = obj["pos"];
				payload.pos = {
					start: pos.start,
					end: pos.end
				};
			}
			if (typeof obj["sel"] === "string") payload.sel = obj["sel"];
			if (typeof obj["aid"] === "string") payload.aid = obj["aid"];
			return {
				ok: true,
				payload
			};
		}
		case "element": {
			if (typeof obj["sel"] !== "string" || obj["sel"].length === 0) return {
				ok: false,
				message: "Element anchor requires non-empty `sel`."
			};
			if (obj["aid"] !== void 0 && (typeof obj["aid"] !== "string" || obj["aid"].length === 0)) return {
				ok: false,
				message: "Element anchor `aid` must be a non-empty string when present."
			};
			const payload = {
				t: "element",
				sel: obj["sel"],
				v
			};
			if (typeof obj["aid"] === "string") payload.aid = obj["aid"];
			return {
				ok: true,
				payload
			};
		}
		case "region": {
			if (!isValidRect(obj["rect"])) return {
				ok: false,
				message: "Region anchor `rect` must have finite coordinates inside [0, 1] with positive width and height."
			};
			const rect = obj["rect"];
			return {
				ok: true,
				payload: {
					t: "region",
					rect: {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height
					},
					v
				}
			};
		}
		default: return {
			ok: false,
			message: `Unsupported anchor type: ${String(obj["t"])}`
		};
	}
}
function buildTextPayload(base, exact, prefix, suffix) {
	const q = { exact };
	if (prefix.length > 0) q.prefix = prefix;
	if (suffix.length > 0) q.suffix = suffix;
	const out = {
		t: "text",
		q,
		v: base.v
	};
	if (base.pos !== void 0) out.pos = {
		start: base.pos.start,
		end: base.pos.end
	};
	if (base.sel !== void 0) out.sel = base.sel;
	if (base.aid !== void 0) out.aid = base.aid;
	return out;
}
/**
* Attempts to encode an `AnchorPayload` into `sectionKey` (`a1:<base64url(utf8(json))>`),
* applying SPEC-r6 §2 cap & shortening rules:
* 1. Clamp `prefix` (tail) and `suffix` (head) to <= 32 Unicode code points.
* 2. If final length > `maxLength` (2048): trim `prefix`/`suffix` first.
* 3. If still > `maxLength`: drop `prefix`/`suffix` and truncate `exact` by code points
*    while preserving `pos`, `sel`, `aid`, `v`.
* 4. If minimal encoding still exceeds `maxLength`, return `{ ok: false, code: "ANCHOR_TOO_LONG" }`.
*/
function tryEncodeAnchor(payload, options) {
	const maxLength = options?.maxLength ?? 2048;
	const validated = validateAndSanitize(payload);
	if (!validated.ok) return {
		ok: false,
		code: "INVALID_ANCHOR",
		message: validated.message,
		maxLength
	};
	const clean = validated.payload;
	if (clean.t !== "text") {
		const encoded = encodeRaw(clean);
		if (encoded.length > maxLength) return {
			ok: false,
			code: "ANCHOR_TOO_LONG",
			message: `Encoded anchor length (${encoded.length}) exceeds the ${maxLength}-character cap.`,
			actualLength: encoded.length,
			maxLength
		};
		return {
			ok: true,
			sectionKey: encoded,
			payload: clean,
			truncated: false
		};
	}
	const rawPrefixCPs = Array.from(clean.q.prefix ?? "");
	const rawSuffixCPs = Array.from(clean.q.suffix ?? "");
	let truncated = false;
	const clampedPrefixCPs = rawPrefixCPs.length > 32 ? (truncated = true, rawPrefixCPs.slice(-32)) : rawPrefixCPs;
	const clampedSuffixCPs = rawSuffixCPs.length > 32 ? (truncated = true, rawSuffixCPs.slice(0, 32)) : rawSuffixCPs;
	const initialPayload = buildTextPayload(clean, clean.q.exact, clampedPrefixCPs.join(""), clampedSuffixCPs.join(""));
	const initialEncoded = encodeRaw(initialPayload);
	if (initialEncoded.length <= maxLength) return {
		ok: true,
		sectionKey: initialEncoded,
		payload: initialPayload,
		truncated
	};
	const noContextPayload = buildTextPayload(clean, clean.q.exact, "", "");
	const noContextEncoded = encodeRaw(noContextPayload);
	if (noContextEncoded.length <= maxLength) {
		let low = 0;
		let high = Math.max(clampedPrefixCPs.length, clampedSuffixCPs.length);
		let bestPayload = noContextPayload;
		let bestEncoded = noContextEncoded;
		while (low <= high) {
			const mid = low + high >>> 1;
			const candidatePrefix = mid > 0 ? clampedPrefixCPs.slice(-Math.min(mid, clampedPrefixCPs.length)).join("") : "";
			const candidateSuffix = mid > 0 ? clampedSuffixCPs.slice(0, Math.min(mid, clampedSuffixCPs.length)).join("") : "";
			const candidatePayload = buildTextPayload(clean, clean.q.exact, candidatePrefix, candidateSuffix);
			const candidateEncoded = encodeRaw(candidatePayload);
			if (candidateEncoded.length <= maxLength) {
				bestPayload = candidatePayload;
				bestEncoded = candidateEncoded;
				low = mid + 1;
			} else high = mid - 1;
		}
		return {
			ok: true,
			sectionKey: bestEncoded,
			payload: bestPayload,
			truncated: true
		};
	}
	const exactCPs = Array.from(clean.q.exact);
	const minimalPayload = buildTextPayload(clean, exactCPs[0], "", "");
	const minimalEncoded = encodeRaw(minimalPayload);
	if (minimalEncoded.length > maxLength) return {
		ok: false,
		code: "ANCHOR_TOO_LONG",
		message: `Minimal encoded anchor length (${minimalEncoded.length}) exceeds the ${maxLength}-character cap.`,
		actualLength: minimalEncoded.length,
		maxLength
	};
	let low = 1;
	let high = exactCPs.length - 1;
	let bestPayload = minimalPayload;
	let bestEncoded = minimalEncoded;
	while (low <= high) {
		const mid = low + high >>> 1;
		const candidatePayload = buildTextPayload(clean, exactCPs.slice(0, mid).join(""), "", "");
		const candidateEncoded = encodeRaw(candidatePayload);
		if (candidateEncoded.length <= maxLength) {
			bestPayload = candidatePayload;
			bestEncoded = candidateEncoded;
			low = mid + 1;
		} else high = mid - 1;
	}
	return {
		ok: true,
		sectionKey: bestEncoded,
		payload: bestPayload,
		truncated: true
	};
}
/**
* Decodes an `"a1:" + base64url(utf8(JSON))` `sectionKey` into a validated
* `AnchorPayload`, returning `null` (never throwing) on malformed, over-cap,
* or unknown-version strings.
*/
function decodeAnchor(sectionKey, options) {
	const maxLength = options?.maxLength ?? 2048;
	if (typeof sectionKey !== "string" || sectionKey.length === 0 || sectionKey.length > maxLength || !sectionKey.startsWith("a1:")) return null;
	const bytes = base64UrlToBytes(sectionKey.slice(3));
	if (!bytes) return null;
	let jsonText;
	try {
		jsonText = utf8Decoder.decode(bytes);
	} catch {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return null;
	}
	const validated = validateAndSanitize(parsed);
	return validated.ok ? validated.payload : null;
}
// node_modules/@sentropic/design-system-review-core/dist/threads.js
function compareIsoTimestamps(a, b) {
	const parsedA = Date.parse(a);
	const parsedB = Date.parse(b);
	if (Number.isFinite(parsedA) && Number.isFinite(parsedB) && parsedA !== parsedB) return parsedA - parsedB;
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}
/**
* Groups flat `ReviewComment[]` rows by `threadId` into chronological `ReviewThread[]`
* view models (SPEC-r6 §1):
* - Comments within each thread are sorted chronologically by `createdAt`.
* - Thread `state` is `'closed'` if any row in the thread is `'closed'`, else `'open'`.
* - `anchor` is derived from the `target.sectionKey` of the FIRST row in chronological
*   order that carries one (not specifically the root row), so deleting the root row
*   retains the anchor as long as a reply carries it. No row carrying one -> `null` (orphan).
*/
function groupCommentsIntoThreads(comments, options) {
	if (comments.length === 0) return [];
	const byThread = /* @__PURE__ */ new Map();
	comments.forEach((comment, order) => {
		const bucket = byThread.get(comment.threadId);
		if (bucket) bucket.push({
			comment,
			order
		});
		else byThread.set(comment.threadId, [{
			comment,
			order
		}]);
	});
	const decoder = options?.decodeAnchor ?? decodeAnchor;
	const threads = [];
	for (const [threadId, entries] of byThread) {
		entries.sort((left, right) => {
			const timeCmp = compareIsoTimestamps(left.comment.createdAt, right.comment.createdAt);
			return timeCmp !== 0 ? timeCmp : left.order - right.order;
		});
		const sortedComments = entries.map((entry) => entry.comment);
		const firstComment = sortedComments[0];
		const state = sortedComments.some((c) => c.state === "closed") ? "closed" : "open";
		let rawSectionKey;
		for (const row of sortedComments) {
			const candidate = row.target.sectionKey;
			if (typeof candidate === "string" && candidate.length > 0) {
				rawSectionKey = candidate;
				break;
			}
		}
		const baseTarget = normalizeCommentTarget(firstComment.target);
		const target = {
			kind: baseTarget.kind,
			id: baseTarget.id
		};
		if (baseTarget.recordType !== void 0) target.recordType = baseTarget.recordType;
		if (rawSectionKey !== void 0) target.sectionKey = rawSectionKey;
		let assignedTo;
		for (let i = sortedComments.length - 1; i >= 0; i--) {
			const candidate = sortedComments[i].assignedTo;
			if (typeof candidate === "string" && candidate.length > 0) {
				assignedTo = candidate;
				break;
			}
		}
		const thread = {
			threadId,
			target,
			comments: sortedComments,
			state,
			anchor: rawSectionKey !== void 0 && decoder ? decoder(rawSectionKey) : null
		};
		if (rawSectionKey !== void 0) thread.sectionKey = rawSectionKey;
		if (assignedTo !== void 0) thread.assignedTo = assignedTo;
		threads.push({
			thread,
			earliestAt: firstComment.createdAt
		});
	}
	threads.sort((left, right) => {
		const timeCmp = compareIsoTimestamps(left.earliestAt, right.earliestAt);
		if (timeCmp !== 0) return timeCmp;
		return left.thread.threadId < right.thread.threadId ? -1 : left.thread.threadId > right.thread.threadId ? 1 : 0;
	});
	return threads.map((entry) => entry.thread);
}
// node_modules/@sentropic/design-system-review-core/dist/filters.js
function isThreadMine(thread, currentUser) {
	if (!currentUser) return false;
	return thread.comments.some((c) => c.authorship.author.actorId === currentUser.actorId);
}
/**
* Filters threads for All / Open / Resolved (`state === 'closed'`) / Mine.
* Critically, "mine" evaluates `comment.authorship.author.actorId` (§3), so an
* agent comment sponsored by the current user is NOT classified as "mine".
*/
function filterThreads(threads, filter, currentUser) {
	switch (filter) {
		case "all": return [...threads];
		case "open": return threads.filter((thread) => thread.state === "open");
		case "resolved": return threads.filter((thread) => thread.state === "closed");
		case "mine": return threads.filter((thread) => isThreadMine(thread, currentUser));
	}
}
function countThreadsByFilter(threads, currentUser) {
	let open = 0;
	let resolved = 0;
	let mine = 0;
	for (const thread of threads) {
		if (thread.state === "open") open += 1;
		else resolved += 1;
		if (isThreadMine(thread, currentUser)) mine += 1;
	}
	return {
		all: threads.length,
		open,
		resolved,
		mine
	};
}
// node_modules/@sentropic/design-system-review-core/dist/unread.js
function resolveLastReadAt(threadId, readState) {
	if (readState === void 0 || readState === null) return;
	if (typeof readState === "string") return readState.length > 0 ? readState : void 0;
	if (readState instanceof Map) {
		const value = readState.get(threadId);
		return typeof value === "string" && value.length > 0 ? value : void 0;
	}
	const value = readState[threadId];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/**
* Unread rule (SPEC-r6 §3):
* `createdAt > lastReadAt && authorship.author.actorId !== currentUser.actorId`.
* Self-authored comments are never unread; sponsored agent comments have a distinct
* `authorship.author.actorId` and therefore DO appear unread to the owner.
*/
function isCommentUnread(comment, currentUser, lastReadAt) {
	if (comment.authorship.author.actorId === currentUser.actorId) return false;
	if (lastReadAt === void 0 || lastReadAt === null || lastReadAt.length === 0) return true;
	return compareIsoTimestamps(comment.createdAt, lastReadAt) > 0;
}
/** True iff the thread contains at least one unread comment for `currentUser`. */
function isUnread(thread, currentUser, readState) {
	const lastReadAt = resolveLastReadAt(thread.threadId, readState);
	return thread.comments.some((comment) => isCommentUnread(comment, currentUser, lastReadAt));
}
function countUnreadComments(thread, currentUser, readState) {
	const lastReadAt = resolveLastReadAt(thread.threadId, readState);
	let count = 0;
	for (const comment of thread.comments) if (isCommentUnread(comment, currentUser, lastReadAt)) count += 1;
	return count;
}
function countUnreadThreads(threads, currentUser, readState) {
	let count = 0;
	for (const thread of threads) if (isUnread(thread, currentUser, readState)) count += 1;
	return count;
}
/**
* Computes non-overlapping, clamped margin-gutter positions for comment pins:
* 1. Stable-sort by `targetY` ascending (assigning 1-based `index`).
* 2. Forward pass: start at `max(minY, targetY)` and enforce at least `gap` (28px)
*    separation from the previous pin.
* 3. Bottom clamping (when `maxY` is provided): push upward from `maxY` while
*    preserving separation; if the available span `maxY - minY` is shorter than
*    the total required spacing, distribute monotonically inside `[minY, maxY]`.
*/
function layoutPins(pins, options) {
	if (pins.length === 0) return [];
	const gap = Math.max(0, options?.gap ?? 28);
	const minY = options?.minY ?? 0;
	const maxY = options?.maxY !== void 0 && Number.isFinite(options.maxY) ? Math.max(minY, options.maxY) : void 0;
	const sorted = pins.map((pin, order) => ({
		pin,
		order
	})).sort((left, right) => {
		if (left.pin.targetY !== right.pin.targetY) return left.pin.targetY - right.pin.targetY;
		return left.order - right.order;
	});
	const n = sorted.length;
	const steps = sorted.map((entry) => Math.max(gap, entry.pin.height ?? gap));
	const ys = new Array(n);
	ys[0] = Math.max(minY, sorted[0].pin.targetY);
	for (let i = 1; i < n; i++) ys[i] = Math.max(sorted[i].pin.targetY, ys[i - 1] + steps[i - 1]);
	if (maxY !== void 0 && ys[n - 1] > maxY) {
		ys[n - 1] = maxY;
		for (let i = n - 2; i >= 0; i--) {
			const ceiling = ys[i + 1] - steps[i];
			if (ys[i] > ceiling) ys[i] = ceiling;
		}
		if (ys[0] < minY) {
			if (n === 1 || maxY === minY) for (let i = 0; i < n; i++) ys[i] = minY;
			else {
				const span = maxY - minY;
				for (let i = 0; i < n; i++) ys[i] = minY + i / (n - 1) * span;
			}
		}
	}
	return sorted.map((entry, idx) => ({
		id: entry.pin.id,
		targetY: entry.pin.targetY,
		y: ys[idx],
		index: idx + 1
	}));
}
// node_modules/@sentropic/design-system-review-core/dist/anchor-dom.js
var DATA_ANCHOR_ID_ATTR = "data-anchor-id";
var ELEMENT_NODE = 1;
var TEXT_NODE = 3;
var SHOW_TEXT_FILTER = 4;
function collectTextIndex(container) {
	const walker = container.ownerDocument.createTreeWalker(container, SHOW_TEXT_FILTER);
	const segments = [];
	const parts = [];
	let offset = 0;
	let current = walker.nextNode();
	while (current !== null) {
		if (current.nodeType === TEXT_NODE) {
			const textNode = current;
			const text = textNode.data;
			if (text.length > 0) {
				segments.push({
					node: textNode,
					start: offset,
					end: offset + text.length
				});
				parts.push(text);
				offset += text.length;
			}
		}
		current = walker.nextNode();
	}
	return {
		fullText: parts.join(""),
		segments
	};
}
function offsetsToRange(doc, segments, startOffset, endOffset) {
	if (segments.length === 0 || endOffset <= startOffset) return null;
	let startNode = null;
	let startLocal = 0;
	let endNode = null;
	let endLocal = 0;
	for (const seg of segments) {
		if (startNode === null && startOffset >= seg.start && startOffset < seg.end) {
			startNode = seg.node;
			startLocal = startOffset - seg.start;
		}
		if (endOffset > seg.start && endOffset <= seg.end) {
			endNode = seg.node;
			endLocal = endOffset - seg.start;
			break;
		}
	}
	if (startNode === null || endNode === null) return null;
	const range = doc.createRange();
	range.setStart(startNode, startLocal);
	range.setEnd(endNode, endLocal);
	return range;
}
function closestElementInRoot(node, root) {
	let cur = node;
	while (cur !== null) {
		if (cur.nodeType === ELEMENT_NODE && root.contains(cur)) return cur;
		cur = cur.parentNode;
	}
	return root;
}
function findByAnchorId(root, aid) {
	if (root.getAttribute(DATA_ANCHOR_ID_ATTR) === aid) return root;
	const candidates = root.querySelectorAll(`[${DATA_ANCHOR_ID_ATTR}]`);
	for (let i = 0; i < candidates.length; i++) {
		const el = candidates[i];
		if (el.getAttribute(DATA_ANCHOR_ID_ATTR) === aid) return el;
	}
	return null;
}
function queryRelativeSelector(root, selector) {
	if (selector === ":scope") return root;
	try {
		const scoped = root.querySelector(`:scope > ${selector}`);
		if (scoped !== null) return scoped;
	} catch {}
	try {
		return root.querySelector(selector);
	} catch {
		return null;
	}
}
function matchingSuffixChars(haystackBefore, prefix) {
	const max = Math.min(haystackBefore.length, prefix.length);
	let matched = 0;
	for (let i = 1; i <= max; i++) {
		if (haystackBefore.charCodeAt(haystackBefore.length - i) !== prefix.charCodeAt(prefix.length - i)) break;
		matched += 1;
	}
	return matched;
}
function matchingPrefixChars(haystackAfter, suffix) {
	const max = Math.min(haystackAfter.length, suffix.length);
	let matched = 0;
	for (let i = 0; i < max; i++) {
		if (haystackAfter.charCodeAt(i) !== suffix.charCodeAt(i)) break;
		matched += 1;
	}
	return matched;
}
function computeContainerOffsetInRoot(root, container) {
	if (container === root) return 0;
	const pre = root.ownerDocument.createRange();
	pre.selectNodeContents(root);
	pre.setEndBefore(container);
	return pre.toString().length;
}
function findExactQuoteIn(root, container, anchor) {
	const { fullText, segments } = collectTextIndex(container);
	const needle = anchor.q.exact;
	if (needle.length === 0 || fullText.length === 0) return null;
	const occurrences = [];
	let cursor = 0;
	while (cursor <= fullText.length - needle.length) {
		const idx = fullText.indexOf(needle, cursor);
		if (idx === -1) break;
		occurrences.push(idx);
		cursor = idx + 1;
	}
	if (occurrences.length === 0) return null;
	const prefix = anchor.q.prefix ?? "";
	const suffix = anchor.q.suffix ?? "";
	const containerOffset = computeContainerOffsetInRoot(root, container);
	const targetPos = anchor.pos?.start;
	let bestIdx = occurrences[0];
	let bestScore = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const idx of occurrences) {
		let score = 0;
		if (prefix.length > 0) score += matchingSuffixChars(fullText.slice(0, idx), prefix);
		if (suffix.length > 0) score += matchingPrefixChars(fullText.slice(idx + needle.length), suffix);
		const distance = targetPos !== void 0 ? Math.abs(containerOffset + idx - targetPos) : idx;
		if (score > bestScore || score === bestScore && distance < bestDistance) {
			bestScore = score;
			bestDistance = distance;
			bestIdx = idx;
		}
	}
	const range = offsetsToRange(container.ownerDocument, segments, bestIdx, bestIdx + needle.length);
	if (range === null) return null;
	return {
		range,
		element: closestElementInRoot(range.commonAncestorContainer, root)
	};
}
function normalizeFuzzyWithMap(raw) {
	const chars = [];
	const rawStarts = [];
	const rawEnds = [];
	let i = 0;
	let pendingSpaceStart = -1;
	let pendingSpaceEnd = -1;
	while (i < raw.length) {
		const ch = raw[i];
		if (/\s/.test(ch)) {
			if (chars.length > 0) {
				if (pendingSpaceStart === -1) pendingSpaceStart = i;
				pendingSpaceEnd = i + 1;
			}
			i += 1;
			continue;
		}
		if (pendingSpaceStart !== -1) {
			chars.push(" ");
			rawStarts.push(pendingSpaceStart);
			rawEnds.push(pendingSpaceEnd);
			pendingSpaceStart = -1;
			pendingSpaceEnd = -1;
		}
		const lowered = ch.toLowerCase();
		for (let k = 0; k < lowered.length; k++) {
			chars.push(lowered[k]);
			rawStarts.push(i);
			rawEnds.push(i + 1);
		}
		i += 1;
	}
	return {
		normalized: chars.join(""),
		rawStarts,
		rawEnds
	};
}
function normalizeFuzzySimple(text) {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}
function findFuzzyQuoteIn(root, container, anchor) {
	const normNeedle = normalizeFuzzySimple(anchor.q.exact);
	if (normNeedle.length === 0) return null;
	const { fullText, segments } = collectTextIndex(container);
	if (fullText.length === 0) return null;
	const mapped = normalizeFuzzyWithMap(fullText);
	if (mapped.normalized.length < normNeedle.length) return null;
	const occurrences = [];
	let cursor = 0;
	while (cursor <= mapped.normalized.length - normNeedle.length) {
		const idx = mapped.normalized.indexOf(normNeedle, cursor);
		if (idx === -1) break;
		occurrences.push(idx);
		cursor = idx + 1;
	}
	if (occurrences.length === 0) return null;
	const normPrefix = anchor.q.prefix ? normalizeFuzzySimple(anchor.q.prefix) : "";
	const normSuffix = anchor.q.suffix ? normalizeFuzzySimple(anchor.q.suffix) : "";
	const containerOffset = computeContainerOffsetInRoot(root, container);
	const targetPos = anchor.pos?.start;
	let bestNormIdx = occurrences[0];
	let bestScore = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const normIdx of occurrences) {
		let score = 0;
		if (normPrefix.length > 0) score += matchingSuffixChars(mapped.normalized.slice(0, normIdx).trimEnd(), normPrefix);
		if (normSuffix.length > 0) score += matchingPrefixChars(mapped.normalized.slice(normIdx + normNeedle.length).trimStart(), normSuffix);
		const rawStart = mapped.rawStarts[normIdx];
		const distance = targetPos !== void 0 ? Math.abs(containerOffset + rawStart - targetPos) : rawStart;
		if (score > bestScore || score === bestScore && distance < bestDistance) {
			bestScore = score;
			bestDistance = distance;
			bestNormIdx = normIdx;
		}
	}
	const rawStart = mapped.rawStarts[bestNormIdx];
	const rawEnd = mapped.rawEnds[bestNormIdx + normNeedle.length - 1];
	const range = offsetsToRange(container.ownerDocument, segments, rawStart, rawEnd);
	if (range === null) return null;
	return {
		range,
		element: closestElementInRoot(range.commonAncestorContainer, root)
	};
}
/**
* Re-attaches an `AnchorPayload` to the rendered artifact DOM under `root`
* (SPEC-r6 §2):
* 1. `aid` (`data-anchor-id`)
* 2. `exact` + `prefix`/`suffix`, tie-broken by nearest `pos.start`
* 3. `sel` (CSS `nth-of-type` path)
* 4. whitespace/case-folded fuzzy `exact`
* No match -> `{ status: "orphan" }`.
* A version change alone never orphans, and the DOM is never mutated.
*/
function resolveAnchor(root, anchor, options) {
	const versionChanged = options?.artifactVersion !== void 0 && options.artifactVersion !== anchor.v;
	if (anchor.t === "region") return {
		status: "resolved",
		kind: "region",
		strategy: "region",
		element: root,
		rect: { ...anchor.rect },
		range: null,
		versionChanged
	};
	if (anchor.t === "element") {
		if (anchor.aid !== void 0) {
			const aidEl = findByAnchorId(root, anchor.aid);
			if (aidEl !== null) return {
				status: "resolved",
				kind: "element",
				strategy: "aid",
				element: aidEl,
				range: null,
				versionChanged
			};
		}
		const selEl = queryRelativeSelector(root, anchor.sel);
		if (selEl !== null) return {
			status: "resolved",
			kind: "element",
			strategy: "selector",
			element: selEl,
			range: null,
			versionChanged
		};
		return {
			status: "orphan",
			kind: "element",
			reason: "not-found",
			element: null,
			range: null
		};
	}
	let aidElement = null;
	if (anchor.aid !== void 0) {
		aidElement = findByAnchorId(root, anchor.aid);
		if (aidElement !== null) {
			const exactInAid = findExactQuoteIn(root, aidElement, anchor);
			if (exactInAid !== null) return {
				status: "resolved",
				kind: "text",
				strategy: "aid",
				element: exactInAid.element,
				range: exactInAid.range,
				versionChanged
			};
			const fuzzyInAid = findFuzzyQuoteIn(root, aidElement, anchor);
			if (fuzzyInAid !== null) return {
				status: "resolved",
				kind: "text",
				strategy: "aid",
				element: fuzzyInAid.element,
				range: fuzzyInAid.range,
				versionChanged
			};
		}
	}
	const exactGlobal = findExactQuoteIn(root, root, anchor);
	if (exactGlobal !== null) return {
		status: "resolved",
		kind: "text",
		strategy: "text-quote",
		element: exactGlobal.element,
		range: exactGlobal.range,
		versionChanged
	};
	if (anchor.sel !== void 0) {
		const selEl = queryRelativeSelector(root, anchor.sel);
		if (selEl !== null) {
			const fuzzyInSel = findFuzzyQuoteIn(root, selEl, anchor);
			if (fuzzyInSel !== null) return {
				status: "resolved",
				kind: "text",
				strategy: "selector",
				element: fuzzyInSel.element,
				range: fuzzyInSel.range,
				versionChanged
			};
		}
	}
	const fuzzyGlobal = findFuzzyQuoteIn(root, root, anchor);
	if (fuzzyGlobal !== null) return {
		status: "resolved",
		kind: "text",
		strategy: "fuzzy-quote",
		element: fuzzyGlobal.element,
		range: fuzzyGlobal.range,
		versionChanged
	};
	if (aidElement !== null && aidElement !== root) return {
		status: "resolved",
		kind: "text",
		strategy: "aid",
		element: aidElement,
		range: null,
		versionChanged
	};
	return {
		status: "orphan",
		kind: "text",
		reason: "not-found",
		element: null,
		range: null
	};
}
// node_modules/@sentropic/design-system-svelte/dist/review-markdown.js
var REF_LINE_RE = /^Ref:\s*(decision|track):([^\s]+)\s*$/i;
var RESOLUTION_LINE_RE = /^Resolved\s+in\s+([^\r\n]+?)\s*$/i;
var SAFE_HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
var SAFE_FUNC_COLOR_RE = /^(?:rgba?|hsla?|oklch|oklab)\([0-9.,%\s/+deg-]+\)$/i;
var SAFE_VAR_COLOR_RE = /^var\(--st-[a-zA-Z0-9-]+\)$/;
/** Sanitize an untrusted `CollaborationActor.color` value before CSS binding. */
function sanitizeActorColor(color) {
	if (typeof color !== "string") return FALLBACK_ACTOR_COLOR$1;
	const trimmed = color.trim();
	if (SAFE_HEX_COLOR_RE.test(trimmed) || SAFE_FUNC_COLOR_RE.test(trimmed) || SAFE_VAR_COLOR_RE.test(trimmed)) return trimmed;
	return FALLBACK_ACTOR_COLOR$1;
}
/** Check whether a URL is safe to expose as an anchor href (never javascript:/data:/vbscript:). */
function isSafeMarkdownHref(rawHref) {
	const trimmed = rawHref.trim();
	if (trimmed.length === 0) return {
		safe: false,
		external: false,
		href: ""
	};
	if (trimmed.startsWith("/") || trimmed.startsWith("#")) return {
		safe: true,
		external: false,
		href: trimmed
	};
	try {
		const parsed = new URL(trimmed);
		const protocol = parsed.protocol.toLowerCase();
		if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") return {
			safe: true,
			external: protocol !== "mailto:",
			href: parsed.href
		};
	} catch {
		return {
			safe: false,
			external: false,
			href: ""
		};
	}
	return {
		safe: false,
		external: false,
		href: ""
	};
}
/** Detect the `Resolved in <version|commit>` resolution reply convention (SPEC-r6 §2). */
function isResolutionReply(body) {
	const firstNonEmpty = body.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).find((line) => line.length > 0);
	if (!firstNonEmpty) return null;
	const match = RESOLUTION_LINE_RE.exec(firstNonEmpty);
	if (!match) return null;
	const version = match[1].trim();
	return version.length > 0 ? { version } : null;
}
function parseInlineSegment(text) {
	const tokens = [];
	let cursor = 0;
	const pushText = (chunk) => {
		if (chunk.length === 0) return;
		const prev = tokens[tokens.length - 1];
		if (prev && prev.type === "text") prev.text += chunk;
		else tokens.push({
			type: "text",
			text: chunk
		});
	};
	while (cursor < text.length) {
		const ch = text[cursor];
		if (ch === "`") {
			const end = text.indexOf("`", cursor + 1);
			if (end > cursor + 1) {
				tokens.push({
					type: "code",
					text: text.slice(cursor + 1, end)
				});
				cursor = end + 1;
				continue;
			}
		}
		if (ch === "[") {
			const closeBracket = text.indexOf("]", cursor + 1);
			if (closeBracket > cursor + 1 && text[closeBracket + 1] === "(") {
				const closeParen = text.indexOf(")", closeBracket + 2);
				if (closeParen > closeBracket + 2) {
					const label = text.slice(cursor + 1, closeBracket);
					const checked = isSafeMarkdownHref(text.slice(closeBracket + 2, closeParen));
					if (checked.safe) tokens.push({
						type: "link",
						label,
						href: checked.href,
						external: checked.external
					});
					else pushText(label);
					cursor = closeParen + 1;
					continue;
				}
			}
		}
		if (ch === "*" && text[cursor + 1] === "*") {
			const end = text.indexOf("**", cursor + 2);
			if (end > cursor + 2) {
				tokens.push({
					type: "bold",
					children: parseInlineSegment(text.slice(cursor + 2, end))
				});
				cursor = end + 2;
				continue;
			}
		}
		if (ch === "~" && text[cursor + 1] === "~") {
			const end = text.indexOf("~~", cursor + 2);
			if (end > cursor + 2) {
				tokens.push({
					type: "strike",
					children: parseInlineSegment(text.slice(cursor + 2, end))
				});
				cursor = end + 2;
				continue;
			}
		}
		if (ch === "*" || ch === "_") {
			const prevChar = cursor > 0 ? text[cursor - 1] : "";
			if ((ch === "*" || prevChar === "" || /\s|[([{]/.test(prevChar)) && text[cursor + 1] !== ch && text[cursor + 1] !== " ") {
				const end = text.indexOf(ch, cursor + 1);
				const afterEnd = end >= 0 && end + 1 < text.length ? text[end + 1] : "";
				const allowClose = ch === "*" || afterEnd === "" || /\s|[)\]}.,!?;:]/.test(afterEnd);
				if (end > cursor + 1 && text[end - 1] !== " " && allowClose) {
					tokens.push({
						type: "italic",
						children: parseInlineSegment(text.slice(cursor + 1, end))
					});
					cursor = end + 1;
					continue;
				}
			}
		}
		pushText(ch);
		cursor += 1;
	}
	return tokens;
}
function parseLinesWithBreaks(lines) {
	const out = [];
	lines.forEach((line, index) => {
		if (index > 0) out.push({ type: "break" });
		out.push(...parseInlineSegment(line));
	});
	return out;
}
/**
* Parses comment markdown-lite into a safe AST (rendered purely via Svelte text nodes,
* never `{@html}`), extracting `Ref: decision:<id>` / `Ref: track:<id>` chips and
* detecting `Resolved in <version|commit>` records.
*/
function parseCommentBody(body) {
	const normalized = body.replace(/\r\n?/g, "\n");
	const rawLines = normalized.split("\n");
	const refs = [];
	const contentLines = [];
	for (const line of rawLines) {
		const refMatch = REF_LINE_RE.exec(line.trim());
		if (refMatch) refs.push({
			kind: refMatch[1].toLowerCase(),
			id: refMatch[2],
			raw: line.trim()
		});
		else contentLines.push(line);
	}
	const resolution = isResolutionReply(normalized);
	const blocks = [];
	let i = 0;
	while (i < contentLines.length) {
		const trimmed = contentLines[i].trim();
		if (trimmed.length === 0) {
			i += 1;
			continue;
		}
		if (trimmed.startsWith("```")) {
			const lang = trimmed.slice(3).trim();
			const codeLines = [];
			i += 1;
			while (i < contentLines.length && !contentLines[i].trim().startsWith("```")) {
				codeLines.push(contentLines[i]);
				i += 1;
			}
			if (i < contentLines.length) i += 1;
			blocks.push({
				type: "codeblock",
				...lang.length > 0 ? { lang } : {},
				code: codeLines.join("\n")
			});
			continue;
		}
		if (trimmed.startsWith(">")) {
			const quoteLines = [];
			while (i < contentLines.length && contentLines[i].trim().startsWith(">")) {
				quoteLines.push(contentLines[i].trim().replace(/^>\s?/, ""));
				i += 1;
			}
			blocks.push({
				type: "blockquote",
				inlines: parseLinesWithBreaks(quoteLines)
			});
			continue;
		}
		if (/^[-*]\s+/.test(trimmed)) {
			const items = [];
			while (i < contentLines.length && /^[-*]\s+/.test(contentLines[i].trim())) {
				items.push(parseInlineSegment(contentLines[i].trim().replace(/^[-*]\s+/, "")));
				i += 1;
			}
			blocks.push({
				type: "list",
				ordered: false,
				items
			});
			continue;
		}
		if (/^\d+\.\s+/.test(trimmed)) {
			const items = [];
			while (i < contentLines.length && /^\d+\.\s+/.test(contentLines[i].trim())) {
				items.push(parseInlineSegment(contentLines[i].trim().replace(/^\d+\.\s+/, "")));
				i += 1;
			}
			blocks.push({
				type: "list",
				ordered: true,
				items
			});
			continue;
		}
		const paraLines = [];
		while (i < contentLines.length) {
			const candidate = contentLines[i];
			const cTrim = candidate.trim();
			if (cTrim.length === 0 || cTrim.startsWith("```") || cTrim.startsWith(">") || /^[-*]\s+/.test(cTrim) || /^\d+\.\s+/.test(cTrim)) break;
			paraLines.push(candidate);
			i += 1;
		}
		blocks.push({
			type: "paragraph",
			inlines: parseLinesWithBreaks(paraLines)
		});
	}
	return {
		blocks,
		refs,
		resolution
	};
}
function clampString(value, maxLength) {
	const collapsed = value.replace(/\s+/g, " ").trim();
	const cps = Array.from(collapsed);
	if (cps.length <= maxLength) return collapsed;
	if (maxLength <= 1) return "…";
	return `${cps.slice(0, maxLength - 1).join("")}…`;
}
/** Derives a <= 140-char quote or element label from a decoded `AnchorPayload` (SPEC-r6 §3). */
function formatAnchorLabel(anchor, maxLength = 140) {
	if (anchor === null) return "Unattached";
	if (anchor.t === "text") return clampString(anchor.q.exact, maxLength);
	if (anchor.t === "element") return clampString(anchor.aid ? `#${anchor.aid}` : anchor.sel, maxLength);
	return clampString(`Region (${Math.round(anchor.rect.x * 100)}%, ${Math.round(anchor.rect.y * 100)}%)`, maxLength);
}
/**
* Formats a pin's accessible name per SPEC-r6 §3:
* `Thread 2, 3 comments, 1 unread, on '…'`
*/
function formatPinAriaLabel(options) {
	const { index, count, unreadCount = 0, resolved = false, excerpt } = options;
	const parts = [`Thread ${index}`, `${count} ${count === 1 ? "comment" : "comments"}`];
	if (unreadCount > 0) parts.push(`${unreadCount} unread`);
	if (resolved) parts.push("resolved");
	if (excerpt && excerpt.trim().length > 0) parts.push(`on '${clampString(excerpt, 60)}'`);
	return parts.join(", ");
}
/** Normalize adapter/composer errors, mapping server 400 cap errors to a consistent message. */
function formatReviewError(error) {
	if (error instanceof ReviewAdapterError) {
		if (error.code === "SECTION_KEY_TOO_LONG") return `Selection anchor exceeds the ${MAX_SECTION_KEY_LENGTH$1}-character limit.`;
		return error.message;
	}
	if (error instanceof Error) {
		if (/section_key_too_long|SECTION_KEY_TOO_LONG|ANCHOR_TOO_LONG/i.test(error.message) || error.code === "section_key_too_long") return `Selection anchor exceeds the ${MAX_SECTION_KEY_LENGTH$1}-character limit.`;
		return error.message;
	}
	return "Action failed. Please try again.";
}
[
	"a[href]",
	"button:not([disabled])",
	"textarea:not([disabled])",
	"input:not([disabled]):not([type='hidden'])",
	"select:not([disabled])",
	"[tabindex]:not([tabindex='-1'])"
].join(", ");
// node_modules/@sentropic/design-system-svelte/dist/CommentAuthorship.svelte
function CommentAuthorship($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { author, sponsor, size = "sm", showLabel = true, class: className, $$slots, $$events, ...rest } = $$props;
		const isNonHuman = derived(() => author.kind !== "human");
		const authorColor = derived(() => sanitizeActorColor(author.color));
		const sponsorColor = derived(() => sponsor ? sanitizeActorColor(sponsor.color) : void 0);
		const authorInitials = derived(() => deriveInitials(author.displayLabel));
		const sponsorInitials = derived(() => sponsor ? deriveInitials(sponsor.displayLabel) : "");
		const iconSize = derived(() => size === "sm" ? 13 : size === "md" ? 16 : size === "lg" ? 18 : 22);
		const kindBadgeLabel = derived(() => author.kind === "nhi" ? "NHI" : "Agent");
		const accessibleName = derived(() => {
			if (sponsor) return `Comment by ${author.displayLabel}, ${author.kind}, on behalf of ${sponsor.displayLabel}`;
			if (isNonHuman()) return `Comment by ${author.displayLabel}, ${author.kind}`;
			return `Comment by ${author.displayLabel}`;
		});
		const classes = derived(() => [
			"st-review-authorship",
			`st-review-authorship--${size}`,
			className
		].filter(Boolean).join(" "));
		$$renderer.push(`<div${attributes({
			...rest,
			class: clsx(classes()),
			"data-author-kind": author.kind
		}, "svelte-ct96qr")}>`);
		AvatarGroup($$renderer, {
			size,
			class: "st-review-authorship__stack",
			role: "img",
			"aria-label": accessibleName(),
			children: ($$renderer) => {
				$$renderer.push(`<span${attr_class(`st-review-authorship__vignette st-review-authorship__vignette--${stringify(size)}`, "svelte-ct96qr", { "st-review-authorship__vignette--agent": isNonHuman() })}${attr("data-actor-kind", author.kind)} aria-hidden="true"${attr_style("", { "--st-review-actor-color": authorColor() })}>`);
				if (author.kind === "agent") {
					$$renderer.push("<!--[0-->");
					Bot($$renderer, {
						size: iconSize(),
						strokeWidth: 2,
						"aria-hidden": "true"
					});
				} else if (author.kind === "nhi") {
					$$renderer.push("<!--[1-->");
					Cpu($$renderer, {
						size: iconSize(),
						strokeWidth: 2,
						"aria-hidden": "true"
					});
				} else $$renderer.push(`<!--[-1--><span class="st-review-authorship__initials svelte-ct96qr">${escape_html(authorInitials())}</span>`);
				$$renderer.push(`<!--]--></span> `);
				if (sponsor) $$renderer.push(`<!--[0--><span${attr_class(`st-review-authorship__vignette st-review-authorship__vignette--${stringify(size)} st-review-authorship__vignette--sponsor`, "svelte-ct96qr")} data-actor-kind="sponsor" aria-hidden="true"${attr_style("", { "--st-review-actor-color": sponsorColor() })}><span class="st-review-authorship__initials svelte-ct96qr">${escape_html(sponsorInitials())}</span></span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		if (showLabel) {
			$$renderer.push(`<!--[0--><span class="st-review-authorship__label svelte-ct96qr"><span class="st-review-authorship__name svelte-ct96qr">${escape_html(author.displayLabel)}</span> `);
			if (isNonHuman()) {
				$$renderer.push("<!--[0-->");
				Badge($$renderer, {
					size: "sm",
					tone: "info",
					class: "st-review-authorship__kind",
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(kindBadgeLabel())}`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (sponsor) $$renderer.push(`<!--[0--><span class="st-review-authorship__sponsor svelte-ct96qr">· on behalf of ${escape_html(sponsor.displayLabel)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/CommentPin.svelte
function CommentPin($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { index, count = 1, unread = false, resolved = false, active = false, label, variant = "inline", tabindex, class: className, onActivate, onclick, $$slots, $$events, ...rest } = $$props;
		const effectiveTabIndex = derived(() => tabindex ?? (variant === "margin" ? -1 : 0));
		const classes = derived(() => [
			"st-review-pin",
			`st-review-pin--${variant}`,
			resolved ? "st-review-pin--resolved" : void 0,
			active ? "st-review-pin--active" : void 0,
			unread ? "st-review-pin--unread" : void 0,
			className
		].filter(Boolean).join(" "));
		$$renderer.push(`<button${attributes({
			...rest,
			type: "button",
			class: clsx(classes()),
			tabindex: effectiveTabIndex(),
			"aria-label": label,
			"aria-pressed": active ? "true" : "false",
			"data-pin-index": index,
			"data-pin-variant": variant,
			"data-resolved": resolved ? "true" : "false",
			"data-unread": unread ? "true" : "false",
			"data-active": active ? "true" : "false"
		}, "svelte-8s53ub")}><span class="st-review-pin__glyph svelte-8s53ub" aria-hidden="true">`);
		if (resolved) {
			$$renderer.push("<!--[0-->");
			Check($$renderer, {
				size: 13,
				strokeWidth: 2.5,
				"aria-hidden": "true"
			});
		} else $$renderer.push(`<!--[-1-->${escape_html(index)}`);
		$$renderer.push(`<!--]--></span> `);
		if (count > 1) $$renderer.push(`<!--[0--><span class="st-review-pin__count svelte-8s53ub" aria-hidden="true">${escape_html(count)}</span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (unread) $$renderer.push(`<!--[0--><span class="st-review-pin__unread-dot svelte-8s53ub" aria-hidden="true"></span>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></button>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/CommentComposer.svelte
function CommentComposer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { author, sponsor, placeholder = "Add a comment…", submitLabel = "Comment", cancelLabel = "Cancel", initialBody = "", autofocus = true, trapFocus = true, disabled = false, submitting = false, anchorError = null, error = null, quotePreview, label = "Comment body", clearOnSubmit, class: className, onSubmit, onCancel, onDraftChange, $$slots, $$events, ...rest } = $$props;
		let body = run(() => initialBody);
		let localError = null;
		let internalSubmitting = false;
		const errorId = `st-review-composer-err-${uid}`;
		const isBusy = derived(() => submitting || internalSubmitting);
		const displayedError = derived(() => anchorError ?? localError ?? error);
		derived(() => clearOnSubmit ?? initialBody.length === 0);
		const classes = derived(() => ["st-review-composer", className].filter(Boolean).join(" "));
		function handleCancel() {
			if (isBusy()) return;
			onCancel?.();
		}
		$$renderer.push(`<form${attributes({
			...rest,
			class: clsx(classes()),
			novalidate: true
		}, "svelte-12chpsi")}><div class="st-review-composer__header svelte-12chpsi">`);
		CommentAuthorship($$renderer, {
			author,
			sponsor,
			size: "sm"
		});
		$$renderer.push(`<!----></div> `);
		if (quotePreview) $$renderer.push(`<!--[0--><p class="st-review-composer__quote svelte-12chpsi">${escape_html(quotePreview)}</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="st-review-composer__field svelte-12chpsi"><textarea class="st-review-composer__textarea svelte-12chpsi"${attr("placeholder", placeholder)} rows="3"${attr("disabled", disabled || isBusy(), true)}${attr("aria-label", label)}${attr("aria-invalid", displayedError() ? "true" : void 0)}${attr("aria-describedby", displayedError() ? errorId : void 0)}>`);
		const $$body = escape_html(body);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea></div> `);
		if (displayedError()) $$renderer.push(`<!--[0--><div${attr("id", errorId)} class="st-review-composer__error svelte-12chpsi" role="alert">${escape_html(displayedError())}</div>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="st-review-composer__footer svelte-12chpsi"><span class="st-review-composer__hint svelte-12chpsi">${escape_html(onCancel ? "Cmd/Ctrl+Enter to submit · Esc to cancel" : "Cmd/Ctrl+Enter to submit")}</span> <div class="st-review-composer__actions svelte-12chpsi">`);
		if (onCancel) {
			$$renderer.push("<!--[0-->");
			Button($$renderer, {
				type: "button",
				variant: "ghost",
				size: "sm",
				disabled: isBusy(),
				onclick: handleCancel,
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(cancelLabel)}`);
				},
				$$slots: { default: true }
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		Button($$renderer, {
			type: "submit",
			variant: "primary",
			size: "sm",
			disabled: disabled || isBusy(),
			children: ($$renderer) => {
				$$renderer.push(`<!---->${escape_html(submitLabel)}`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div></div></form>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/CommentThread.svelte
function renderInlines($$renderer, nodes) {
	$$renderer.push(`<!--[-->`);
	const each_array = ensure_array_like(nodes);
	for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
		let node = each_array[$$index];
		if (node.type === "text") $$renderer.push(`<!--[0-->${escape_html(node.text)}`);
		else if (node.type === "break") $$renderer.push(`<!--[1--><br/>`);
		else if (node.type === "code") $$renderer.push(`<!--[2--><code class="st-review-md__code svelte-144zrs4">${escape_html(node.text)}</code>`);
		else if (node.type === "bold") {
			$$renderer.push(`<!--[3--><strong>`);
			renderInlines($$renderer, node.children);
			$$renderer.push(`<!----></strong>`);
		} else if (node.type === "italic") {
			$$renderer.push(`<!--[4--><em>`);
			renderInlines($$renderer, node.children);
			$$renderer.push(`<!----></em>`);
		} else if (node.type === "strike") {
			$$renderer.push(`<!--[5--><del>`);
			renderInlines($$renderer, node.children);
			$$renderer.push(`<!----></del>`);
		} else if (node.type === "link") $$renderer.push(`<!--[6--><a class="st-review-md__link svelte-144zrs4"${attr("href", node.href)}${attr("target", node.external ? "_blank" : void 0)}${attr("rel", node.external ? "noopener noreferrer" : void 0)}>${escape_html(node.label)}</a>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	}
	$$renderer.push(`<!--]-->`);
}
function CommentThread($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { thread, currentUser, canModerate = false, canReply = true, readState = null, assigneeLabel, runHrefBuilder, refHrefBuilder, class: className, onReply, onResolve, onReopen, onEditComment, onDeleteComment, onReanchor, onRunClick, onRefClick, header, commentBody, $$slots, $$events, ...rest } = $$props;
		let editingCommentId = null;
		let editInvokerEl = null;
		let mutationError = null;
		let optimisticState = null;
		let optimisticDeletedIds = [];
		let optimisticEdits = {};
		let pendingAction = false;
		const effectiveState = derived(() => optimisticState ?? thread.state);
		const stateLabel = derived(() => getCommentStateLabel(effectiveState()));
		const anchorExcerpt = derived(() => formatAnchorLabel(thread.anchor, 140));
		const isOrphan = derived(() => thread.anchor === null);
		const visibleComments = derived(() => thread.comments.filter((c) => !optimisticDeletedIds.includes(c.id)).map((c) => {
			const editedBody = optimisticEdits[c.id];
			return editedBody !== void 0 ? {
				...c,
				body: editedBody
			} : c;
		}));
		const resolvedLastReadAt = derived(() => {
			if (readState === null || readState === void 0) return void 0;
			if (typeof readState === "string") return readState;
			if (readState instanceof Map) return readState.get(thread.threadId);
			return readState[thread.threadId];
		});
		const classes = derived(() => [
			"st-review-thread",
			effectiveState() === "closed" ? "st-review-thread--resolved" : void 0,
			className
		].filter(Boolean).join(" "));
		function formatTimestamp(iso) {
			const parsed = Date.parse(iso);
			if (!Number.isFinite(parsed)) return iso;
			return new Date(parsed).toLocaleString(void 0, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			});
		}
		function runHref(runId, comment) {
			return runHrefBuilder ? runHrefBuilder(runId, comment) : `#run-${encodeURIComponent(runId)}`;
		}
		function refHref(ref) {
			return refHrefBuilder ? refHrefBuilder(ref) : `#${encodeURIComponent(ref.kind)}-${encodeURIComponent(ref.id)}`;
		}
		async function handleResolve() {
			if (!onResolve || pendingAction) return;
			mutationError = null;
			optimisticState = "closed";
			pendingAction = true;
			try {
				await onResolve(thread.threadId);
			} catch (err) {
				mutationError = formatReviewError(err);
			} finally {
				optimisticState = null;
				pendingAction = false;
			}
		}
		async function handleReopen() {
			if (!onReopen || pendingAction) return;
			mutationError = null;
			optimisticState = "open";
			pendingAction = true;
			try {
				await onReopen(thread.threadId);
			} catch (err) {
				mutationError = formatReviewError(err);
			} finally {
				optimisticState = null;
				pendingAction = false;
			}
		}
		async function handleReanchor() {
			if (!onReanchor || pendingAction) return;
			mutationError = null;
			pendingAction = true;
			try {
				await onReanchor(thread.threadId);
			} catch (err) {
				mutationError = formatReviewError(err);
			} finally {
				pendingAction = false;
			}
		}
		function focusEditButtonFor(commentId, fallbackInvoker) {
			(/* @__PURE__ */ tick()).then(() => {
				if (fallbackInvoker?.isConnected) fallbackInvoker.focus();
			});
		}
		function startEdit(commentId, event) {
			mutationError = null;
			editInvokerEl = event.currentTarget;
			editingCommentId = commentId;
		}
		function cancelEdit() {
			const id = editingCommentId;
			const invoker = editInvokerEl;
			editingCommentId = null;
			editInvokerEl = null;
			focusEditButtonFor(id, invoker);
		}
		async function submitEdit(commentId, nextBody) {
			if (!onEditComment) return;
			mutationError = null;
			const prev = { ...optimisticEdits };
			optimisticEdits = {
				...optimisticEdits,
				[commentId]: nextBody
			};
			try {
				await onEditComment(commentId, nextBody);
				const invoker = editInvokerEl;
				editingCommentId = null;
				editInvokerEl = null;
				const next = { ...optimisticEdits };
				delete next[commentId];
				optimisticEdits = next;
				focusEditButtonFor(commentId, invoker);
			} catch (err) {
				optimisticEdits = prev;
				mutationError = formatReviewError(err);
				throw err;
			}
		}
		async function handleDelete(commentId) {
			if (!onDeleteComment || pendingAction) return;
			mutationError = null;
			optimisticDeletedIds = [...optimisticDeletedIds, commentId];
			pendingAction = true;
			try {
				await onDeleteComment(commentId);
			} catch (err) {
				optimisticDeletedIds = optimisticDeletedIds.filter((id) => id !== commentId);
				mutationError = formatReviewError(err);
			} finally {
				pendingAction = false;
			}
		}
		async function handleReplySubmit(body) {
			if (!onReply) return;
			mutationError = null;
			await onReply(thread.threadId, body);
		}
		$$renderer.push(`<section${attributes({
			...rest,
			class: clsx(classes()),
			"aria-label": `Comment thread ${thread.threadId}`,
			"data-thread-id": thread.threadId,
			"data-thread-state": effectiveState()
		}, "svelte-144zrs4")}>`);
		if (header) {
			$$renderer.push(`<!--[0--><header class="st-review-thread__header svelte-144zrs4">`);
			header($$renderer, { thread });
			$$renderer.push(`<!----></header>`);
		} else {
			$$renderer.push(`<!--[-1--><header class="st-review-thread__header svelte-144zrs4"><div class="st-review-thread__meta svelte-144zrs4"><p class="st-review-thread__anchor svelte-144zrs4"${attr("title", anchorExcerpt())}>${escape_html(anchorExcerpt())}</p> <div class="st-review-thread__badges svelte-144zrs4">`);
			Badge($$renderer, {
				size: "sm",
				tone: effectiveState() === "closed" ? "success" : "info",
				class: "st-review-thread__state",
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(stateLabel())}`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			if (thread.assignedTo) $$renderer.push(`<!--[0--><span class="st-review-thread__assignee svelte-144zrs4">Assigned to ${escape_html(assigneeLabel ?? thread.assignedTo)}</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div> <div class="st-review-thread__header-actions svelte-144zrs4">`);
			if (isOrphan() && onReanchor) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					type: "button",
					variant: "ghost",
					size: "sm",
					disabled: pendingAction,
					onclick: handleReanchor,
					children: ($$renderer) => {
						$$renderer.push(`<!---->Re-anchor`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (effectiveState() === "open" && onResolve) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					type: "button",
					variant: "secondary",
					size: "sm",
					disabled: pendingAction,
					onclick: handleResolve,
					children: ($$renderer) => {
						$$renderer.push(`<!---->Resolve`);
					},
					$$slots: { default: true }
				});
			} else if (effectiveState() === "closed" && onReopen) {
				$$renderer.push("<!--[1-->");
				Button($$renderer, {
					type: "button",
					variant: "secondary",
					size: "sm",
					disabled: pendingAction,
					onclick: handleReopen,
					children: ($$renderer) => {
						$$renderer.push(`<!---->Reopen`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></header>`);
		}
		$$renderer.push(`<!--]--> `);
		if (mutationError) $$renderer.push(`<!--[0--><div class="st-review-thread__error svelte-144zrs4" role="alert">${escape_html(mutationError)}</div>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <ol class="st-review-thread__list svelte-144zrs4"><!--[-->`);
		const each_array_1 = ensure_array_like(visibleComments());
		for (let $$index_5 = 0, $$length = each_array_1.length; $$index_5 < $$length; $$index_5++) {
			let comment = each_array_1[$$index_5];
			const parsed = parseCommentBody(comment.body);
			const canEditDelete = canEditOrDeleteComment(comment, currentUser, { canModerate });
			const unread = isCommentUnread(comment, currentUser, resolvedLastReadAt());
			const isEdited = comment.updatedAt !== void 0 && comment.updatedAt !== comment.createdAt;
			const isEditing = editingCommentId === comment.id;
			$$renderer.push(`<li${attr_class("st-review-thread__item svelte-144zrs4", void 0, {
				"st-review-thread__item--unread": unread,
				"st-review-thread__item--resolution": parsed.resolution !== null
			})}${attr("data-comment-id", comment.id)}${attr("data-unread", unread ? "true" : "false")}${attr("data-resolution-record", parsed.resolution !== null ? "true" : void 0)}><div class="st-review-thread__item-header svelte-144zrs4">`);
			CommentAuthorship($$renderer, {
				author: comment.authorship.author,
				sponsor: comment.authorship.sponsor,
				size: "sm"
			});
			$$renderer.push(`<!----> <div class="st-review-thread__item-meta svelte-144zrs4"><time class="st-review-thread__time svelte-144zrs4"${attr("datetime", comment.createdAt)}>${escape_html(formatTimestamp(comment.createdAt))}</time> `);
			if (isEdited) $$renderer.push(`<!--[0--><span class="st-review-thread__edited svelte-144zrs4"${attr("title", `Edited ${comment.updatedAt}`)}>edited</span>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (comment.authorship.runId) {
				$$renderer.push(`<!--[0--><a class="st-review-thread__run-link svelte-144zrs4"${attr("href", runHref(comment.authorship.runId, comment))}>`);
				External_link($$renderer, {
					size: 12,
					strokeWidth: 2,
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> <span>Run ${escape_html(comment.authorship.runId)}</span></a>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (canEditDelete && !isEditing) {
				$$renderer.push(`<!--[0--><div class="st-review-thread__item-actions svelte-144zrs4">`);
				if (onEditComment) {
					$$renderer.push("<!--[0-->");
					IconButton($$renderer, {
						size: "sm",
						variant: "ghost",
						"aria-label": "Edit comment",
						disabled: pendingAction,
						onclick: (event) => startEdit(comment.id, event),
						children: ($$renderer) => {
							Pencil($$renderer, {
								size: 14,
								strokeWidth: 2,
								"aria-hidden": "true"
							});
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (onDeleteComment) {
					$$renderer.push("<!--[0-->");
					IconButton($$renderer, {
						size: "sm",
						variant: "danger",
						"aria-label": "Delete comment",
						disabled: pendingAction,
						onclick: () => handleDelete(comment.id),
						children: ($$renderer) => {
							Trash_2($$renderer, {
								size: 14,
								strokeWidth: 2,
								"aria-hidden": "true"
							});
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div> `);
			if (parsed.resolution !== null) {
				$$renderer.push(`<!--[0--><div class="st-review-thread__resolution-banner svelte-144zrs4">`);
				Circle_check($$renderer, {
					size: 14,
					strokeWidth: 2,
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> <span>Resolved in ${escape_html(parsed.resolution.version)}</span></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (isEditing) {
				$$renderer.push(`<!--[0--><div class="st-review-thread__edit-form">`);
				CommentComposer($$renderer, {
					author: comment.authorship.author,
					sponsor: comment.authorship.sponsor,
					initialBody: comment.body,
					submitLabel: "Save",
					cancelLabel: "Cancel",
					label: "Edit comment",
					autofocus: true,
					trapFocus: true,
					clearOnSubmit: false,
					onSubmit: (nextBody) => submitEdit(comment.id, nextBody),
					onCancel: cancelEdit
				});
				$$renderer.push(`<!----></div>`);
			} else {
				$$renderer.push(`<!--[-1--><div class="st-review-thread__body svelte-144zrs4">`);
				if (commentBody) {
					$$renderer.push("<!--[0-->");
					commentBody($$renderer, { comment });
					$$renderer.push(`<!---->`);
				} else {
					$$renderer.push(`<!--[-1--><!--[-->`);
					const each_array_2 = ensure_array_like(parsed.blocks);
					for (let $$index_3 = 0, $$length = each_array_2.length; $$index_3 < $$length; $$index_3++) {
						let block = each_array_2[$$index_3];
						if (block.type === "paragraph") {
							$$renderer.push(`<!--[0--><p class="st-review-md__p svelte-144zrs4">`);
							renderInlines($$renderer, block.inlines);
							$$renderer.push(`<!----></p>`);
						} else if (block.type === "codeblock") $$renderer.push(`<!--[1--><pre class="st-review-md__pre svelte-144zrs4"><code>${escape_html(block.code)}</code></pre>`);
						else if (block.type === "blockquote") {
							$$renderer.push(`<!--[2--><blockquote class="st-review-md__quote svelte-144zrs4">`);
							renderInlines($$renderer, block.inlines);
							$$renderer.push(`<!----></blockquote>`);
						} else if (block.type === "list") {
							$$renderer.push("<!--[3-->");
							if (block.ordered) {
								$$renderer.push(`<!--[0--><ol class="st-review-md__list svelte-144zrs4"><!--[-->`);
								const each_array_3 = ensure_array_like(block.items);
								for (let $$index_1 = 0, $$length = each_array_3.length; $$index_1 < $$length; $$index_1++) {
									let item = each_array_3[$$index_1];
									$$renderer.push(`<li>`);
									renderInlines($$renderer, item);
									$$renderer.push(`<!----></li>`);
								}
								$$renderer.push(`<!--]--></ol>`);
							} else {
								$$renderer.push(`<!--[-1--><ul class="st-review-md__list svelte-144zrs4"><!--[-->`);
								const each_array_4 = ensure_array_like(block.items);
								for (let $$index_2 = 0, $$length = each_array_4.length; $$index_2 < $$length; $$index_2++) {
									let item = each_array_4[$$index_2];
									$$renderer.push(`<li>`);
									renderInlines($$renderer, item);
									$$renderer.push(`<!----></li>`);
								}
								$$renderer.push(`<!--]--></ul>`);
							}
							$$renderer.push(`<!--]-->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					}
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]--></div> `);
				if (parsed.refs.length > 0) {
					$$renderer.push(`<!--[0--><div class="st-review-thread__refs svelte-144zrs4"><!--[-->`);
					const each_array_5 = ensure_array_like(parsed.refs);
					for (let $$index_4 = 0, $$length = each_array_5.length; $$index_4 < $$length; $$index_4++) {
						let ref = each_array_5[$$index_4];
						$$renderer.push(`<a class="st-review-ref-chip svelte-144zrs4"${attr("href", refHref(ref))}${attr("data-ref-kind", ref.kind)}${attr("data-ref-id", ref.id)}>`);
						Link_2($$renderer, {
							size: 12,
							strokeWidth: 2,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----> <span>${escape_html(ref.kind)}:${escape_html(ref.id)}</span></a>`);
					}
					$$renderer.push(`<!--]--></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></li>`);
		}
		$$renderer.push(`<!--]--></ol> `);
		if (effectiveState() === "closed") {
			$$renderer.push(`<!--[0--><div class="st-review-thread__resolved-notice svelte-144zrs4"><span>Comment resolved. Reopen to reply.</span> `);
			if (onReopen) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					type: "button",
					variant: "ghost",
					size: "sm",
					disabled: pendingAction,
					onclick: handleReopen,
					children: ($$renderer) => {
						Rotate_ccw($$renderer, {
							size: 14,
							strokeWidth: 2,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----> <span>Reopen</span>`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		} else if (canReply && onReply) {
			$$renderer.push(`<!--[1--><div class="st-review-thread__reply">`);
			CommentComposer($$renderer, {
				author: currentUser,
				placeholder: "Reply…",
				submitLabel: "Reply",
				label: "Reply to thread",
				autofocus: false,
				trapFocus: false,
				onSubmit: handleReplySubmit
			});
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></section>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/OrphanList.svelte
function OrphanList($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { threads, currentUser, readState = null, heading = "No longer attached", class: className, onSelect, onReanchor, onResolve, onReopen, $$slots, $$events, ...rest } = $$props;
		let actionError = null;
		let pendingId = null;
		const headingId = `st-review-orphans-heading-${uid}`;
		const classes = derived(() => ["st-review-orphans", className].filter(Boolean).join(" "));
		async function runThreadAction(threadId, fn) {
			if (!fn || pendingId !== null) return;
			actionError = null;
			pendingId = threadId;
			try {
				await fn(threadId);
			} catch (err) {
				actionError = formatReviewError(err);
			} finally {
				pendingId = null;
			}
		}
		$$renderer.push(`<section${attributes({
			...rest,
			class: clsx(classes()),
			"aria-labelledby": headingId
		}, "svelte-4qipl")}><header class="st-review-orphans__header svelte-4qipl"><h3${attr("id", headingId)} class="st-review-orphans__heading svelte-4qipl">`);
		Unlink($$renderer, {
			size: 14,
			strokeWidth: 2,
			"aria-hidden": "true"
		});
		$$renderer.push(`<!----> <span>${escape_html(heading)}</span></h3> `);
		Badge($$renderer, {
			size: "sm",
			tone: "warning",
			class: "st-review-orphans__count",
			children: ($$renderer) => {
				$$renderer.push(`<!---->${escape_html(threads.length)}`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></header> `);
		if (actionError) $$renderer.push(`<!--[0--><div class="st-review-orphans__error svelte-4qipl" role="alert">${escape_html(actionError)}</div>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (threads.length === 0) {
			$$renderer.push("<!--[0-->");
			EmptyState($$renderer, {
				title: "No unattached threads",
				message: "All comment threads are currently anchored to the document."
			});
		} else {
			$$renderer.push(`<!--[-1--><ul class="st-review-orphans__list svelte-4qipl"><!--[-->`);
			const each_array = ensure_array_like(threads);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let thread = each_array[$$index];
				const rootComment = thread.comments[0];
				const unread = isUnread(thread, currentUser, readState);
				const stateLabel = getCommentStateLabel(thread.state);
				const excerpt = thread.anchor !== null ? formatAnchorLabel(thread.anchor, 100) : "Original location removed";
				$$renderer.push(`<li${attr_class("st-review-orphans__item svelte-4qipl", void 0, { "st-review-orphans__item--unread": unread })}${attr("data-thread-id", thread.threadId)}${attr("data-thread-state", thread.state)}${attr("data-unread", unread ? "true" : "false")}><div class="st-review-orphans__item-top svelte-4qipl">`);
				if (rootComment) {
					$$renderer.push("<!--[0-->");
					CommentAuthorship($$renderer, {
						author: rootComment.authorship.author,
						sponsor: rootComment.authorship.sponsor,
						size: "sm"
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				Badge($$renderer, {
					size: "sm",
					tone: thread.state === "closed" ? "success" : "info",
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(stateLabel)}`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></div> <p class="st-review-orphans__excerpt svelte-4qipl">${escape_html(excerpt)}</p> `);
				if (rootComment) $$renderer.push(`<!--[0--><p class="st-review-orphans__preview svelte-4qipl">${escape_html(rootComment.body)}</p>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="st-review-orphans__actions svelte-4qipl">`);
				if (onSelect) {
					$$renderer.push("<!--[0-->");
					Button($$renderer, {
						type: "button",
						variant: "secondary",
						size: "sm",
						"aria-label": `Open thread ${thread.threadId}`,
						onclick: () => onSelect(thread.threadId),
						children: ($$renderer) => {
							$$renderer.push(`<!---->Open (${escape_html(thread.comments.length)})`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (onReanchor) {
					$$renderer.push("<!--[0-->");
					Button($$renderer, {
						type: "button",
						variant: "ghost",
						size: "sm",
						disabled: pendingId === thread.threadId,
						onclick: () => runThreadAction(thread.threadId, onReanchor),
						children: ($$renderer) => {
							$$renderer.push(`<!---->Re-anchor`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (thread.state === "open" && onResolve) {
					$$renderer.push("<!--[0-->");
					Button($$renderer, {
						type: "button",
						variant: "ghost",
						size: "sm",
						disabled: pendingId === thread.threadId,
						onclick: () => runThreadAction(thread.threadId, onResolve),
						children: ($$renderer) => {
							$$renderer.push(`<!---->Resolve`);
						},
						$$slots: { default: true }
					});
				} else if (thread.state === "closed" && onReopen) {
					$$renderer.push("<!--[1-->");
					Button($$renderer, {
						type: "button",
						variant: "ghost",
						size: "sm",
						disabled: pendingId === thread.threadId,
						onclick: () => runThreadAction(thread.threadId, onReopen),
						children: ($$renderer) => {
							$$renderer.push(`<!---->Reopen`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div></li>`);
			}
			$$renderer.push(`<!--]--></ul>`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/ThreadPanel.svelte
function ThreadPanel($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const FILTER_OPTIONS = [
			{
				id: "all",
				label: "All"
			},
			{
				id: "open",
				label: "Open"
			},
			{
				id: "resolved",
				label: "Resolved"
			},
			{
				id: "mine",
				label: "Mine"
			}
		];
		let { threads, orphaned = [], currentUser, activeThreadId = null, filter, open = true, readState = null, canModerate = false, title = "Comments", compact, class: className, onSelect, onFilterChange, onClose, onReply, onResolve, onReopen, onEditComment, onDeleteComment, onReanchor, onMarkRead, headerActions, commentBody, $$slots, $$events, ...rest } = $$props;
		let mediaCompact = false;
		let localFilter = run(() => filter ?? "all");
		let liveAnnouncement = "";
		run(() => activeThreadId);
		const isCompact = derived(() => compact ?? mediaCompact);
		const effectiveFilter = derived(() => filter ?? localFilter);
		const orphanIds = derived(() => new Set(orphaned.map((t) => t.threadId)));
		const attachedOnly = derived(() => threads.filter((t) => !orphanIds().has(t.threadId)));
		const allThreads = derived(() => {
			const seen = /* @__PURE__ */ new Set();
			const combined = [];
			for (const t of threads) if (!seen.has(t.threadId)) {
				seen.add(t.threadId);
				combined.push(t);
			}
			for (const o of orphaned) if (!seen.has(o.threadId)) {
				seen.add(o.threadId);
				combined.push(o);
			}
			return combined;
		});
		const filterCounts = derived(() => countThreadsByFilter(allThreads(), currentUser));
		const unreadTotal = derived(() => countUnreadThreads(allThreads(), currentUser, readState));
		const filteredAttached = derived(() => filterThreads(attachedOnly(), effectiveFilter(), currentUser));
		const filteredOrphaned = derived(() => filterThreads(orphaned, effectiveFilter(), currentUser));
		const activeThread = derived(() => activeThreadId !== null && activeThreadId !== void 0 ? allThreads().find((t) => t.threadId === activeThreadId) ?? null : null);
		function handleSelectThread(threadId) {
			onSelect?.(threadId);
			onMarkRead?.(threadId);
		}
		async function handleResolveWithLive(threadId) {
			if (!onResolve) return;
			await onResolve(threadId);
			liveAnnouncement = "Thread resolved.";
		}
		async function handleReopenWithLive(threadId) {
			if (!onReopen) return;
			await onReopen(threadId);
			liveAnnouncement = "Thread reopened.";
		}
		async function handleReplyWithLive(threadId, body) {
			if (!onReply) return;
			await onReply(threadId, body);
			liveAnnouncement = "Reply posted.";
		}
		const classes = derived(() => ["st-review-panel", className].filter(Boolean).join(" "));
		function panelBody($$renderer) {
			$$renderer.push(`<div class="st-review-panel__filters svelte-w8zayx" role="group" aria-label="Filter comment threads"><!--[-->`);
			const each_array = ensure_array_like(FILTER_OPTIONS);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let option = each_array[$$index];
				const count = filterCounts()[option.id];
				const selected = effectiveFilter() === option.id;
				$$renderer.push(`<button type="button"${attr_class("st-review-panel__filter-tab svelte-w8zayx", void 0, { "st-review-panel__filter-tab--active": selected })}${attr("aria-pressed", selected ? "true" : "false")}><span>${escape_html(option.label)}</span> <span class="st-review-panel__filter-count svelte-w8zayx">${escape_html(count)}</span></button>`);
			}
			$$renderer.push(`<!--]--></div> <div class="st-review-panel__content svelte-w8zayx">`);
			if (activeThread()) {
				$$renderer.push(`<!--[0--><div class="st-review-panel__detail svelte-w8zayx"><div class="st-review-panel__back-row svelte-w8zayx">`);
				Button($$renderer, {
					type: "button",
					variant: "ghost",
					size: "sm",
					onclick: () => onSelect?.(null),
					children: ($$renderer) => {
						Arrow_left($$renderer, {
							size: 14,
							strokeWidth: 2,
							"aria-hidden": "true"
						});
						$$renderer.push(`<!----> <span>All threads</span>`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></div> `);
				CommentThread($$renderer, {
					thread: activeThread(),
					currentUser,
					canModerate,
					readState,
					onReply: onReply ? handleReplyWithLive : void 0,
					onResolve: onResolve ? handleResolveWithLive : void 0,
					onReopen: onReopen ? handleReopenWithLive : void 0,
					onEditComment,
					onDeleteComment,
					onReanchor,
					commentBody
				});
				$$renderer.push(`<!----></div>`);
			} else if (filteredAttached().length === 0 && filteredOrphaned().length === 0) {
				$$renderer.push("<!--[1-->");
				EmptyState($$renderer, {
					title: "No matching threads",
					message: effectiveFilter() === "all" ? "Select text or click an element in Review mode to start a thread." : `No threads match the "${effectiveFilter()}" filter.`
				});
			} else {
				$$renderer.push("<!--[-1-->");
				if (filteredAttached().length > 0) {
					$$renderer.push(`<!--[0--><ul class="st-review-panel__list svelte-w8zayx"><!--[-->`);
					const each_array_1 = ensure_array_like(filteredAttached());
					for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
						let thread = each_array_1[$$index_1];
						const rootComment = thread.comments[0];
						const unread = isUnread(thread, currentUser, readState);
						const stateLabel = getCommentStateLabel(thread.state);
						const excerpt = formatAnchorLabel(thread.anchor, 100);
						$$renderer.push(`<li><button type="button"${attr_class("st-review-panel__thread-card svelte-w8zayx", void 0, {
							"st-review-panel__thread-card--unread": unread,
							"st-review-panel__thread-card--resolved": thread.state === "closed"
						})}${attr("data-thread-id", thread.threadId)}${attr("data-thread-state", thread.state)}${attr("data-unread", unread ? "true" : "false")}><div class="st-review-panel__card-top svelte-w8zayx">`);
						if (rootComment) {
							$$renderer.push("<!--[0-->");
							CommentAuthorship($$renderer, {
								author: rootComment.authorship.author,
								sponsor: rootComment.authorship.sponsor,
								size: "sm"
							});
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="st-review-panel__card-badges svelte-w8zayx">`);
						if (unread) $$renderer.push(`<!--[0--><span class="st-review-panel__unread-dot svelte-w8zayx" aria-label="Unread"></span>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> `);
						Badge($$renderer, {
							size: "sm",
							tone: thread.state === "closed" ? "success" : "info",
							children: ($$renderer) => {
								$$renderer.push(`<!---->${escape_html(stateLabel)}`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----></div></div> <span class="st-review-panel__card-anchor svelte-w8zayx">${escape_html(excerpt)}</span> `);
						if (rootComment) $$renderer.push(`<!--[0--><span class="st-review-panel__card-preview svelte-w8zayx">${escape_html(rootComment.body)}</span>`);
						else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <span class="st-review-panel__card-count svelte-w8zayx">${escape_html(thread.comments.length)} ${escape_html(thread.comments.length === 1 ? "comment" : "comments")}</span></button></li>`);
					}
					$$renderer.push(`<!--]--></ul>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (filteredOrphaned().length > 0) {
					$$renderer.push("<!--[0-->");
					OrphanList($$renderer, {
						threads: filteredOrphaned(),
						currentUser,
						readState,
						onSelect: handleSelectThread,
						onResolve: onResolve ? handleResolveWithLive : void 0,
						onReopen: onReopen ? handleReopenWithLive : void 0,
						onReanchor
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></div> <div class="st-review-panel__sr-live svelte-w8zayx" aria-live="polite" aria-atomic="true">${escape_html(liveAnnouncement)}</div>`);
		}
		if (isCompact()) {
			$$renderer.push("<!--[0-->");
			Drawer($$renderer, {
				open,
				side: "bottom",
				title,
				class: className,
				onclose: () => onClose?.(),
				children: ($$renderer) => {
					$$renderer.push(`<div class="st-review-panel__compact-meta svelte-w8zayx">`);
					if (unreadTotal() > 0) {
						$$renderer.push("<!--[0-->");
						Badge($$renderer, {
							size: "sm",
							tone: "info",
							class: "st-review-panel__unread-count",
							children: ($$renderer) => {
								$$renderer.push(`<!---->${escape_html(unreadTotal())} unread`);
							},
							$$slots: { default: true }
						});
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (orphaned.length > 0) {
						$$renderer.push("<!--[0-->");
						Badge($$renderer, {
							size: "sm",
							tone: "warning",
							class: "st-review-panel__orphan-count",
							children: ($$renderer) => {
								$$renderer.push(`<!---->${escape_html(orphaned.length)} unattached`);
							},
							$$slots: { default: true }
						});
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (headerActions) {
						$$renderer.push(`<!--[0--><div class="st-review-panel__header-actions svelte-w8zayx">`);
						headerActions($$renderer);
						$$renderer.push(`<!----></div>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div> `);
					panelBody($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
		} else if (open) {
			$$renderer.push(`<!--[1--><aside${attributes({
				...rest,
				class: clsx(classes()),
				"aria-label": title
			}, "svelte-w8zayx")}><header class="st-review-panel__header svelte-w8zayx"><div class="st-review-panel__title-group svelte-w8zayx"><h2 tabindex="-1" class="st-review-panel__heading svelte-w8zayx">${escape_html(title)}</h2> `);
			if (unreadTotal() > 0) {
				$$renderer.push("<!--[0-->");
				Badge($$renderer, {
					size: "sm",
					tone: "info",
					class: "st-review-panel__unread-count",
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(unreadTotal())} unread`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (orphaned.length > 0) {
				$$renderer.push("<!--[0-->");
				Badge($$renderer, {
					size: "sm",
					tone: "warning",
					class: "st-review-panel__orphan-count",
					children: ($$renderer) => {
						$$renderer.push(`<!---->${escape_html(orphaned.length)} unattached`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> <div class="st-review-panel__header-actions svelte-w8zayx">`);
			if (headerActions) {
				$$renderer.push("<!--[0-->");
				headerActions($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (onClose) {
				$$renderer.push("<!--[0-->");
				IconButton($$renderer, {
					size: "sm",
					variant: "ghost",
					"aria-label": "Close comments panel",
					onclick: () => onClose(),
					children: ($$renderer) => {
						X($$renderer, {
							size: 16,
							strokeWidth: 2,
							"aria-hidden": "true"
						});
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></header> `);
			panelBody($$renderer);
			$$renderer.push(`<!----></aside>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/CommentLayer.svelte
function CommentLayer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { rootEl = null, mode = "view", target, artifactVersion, comments, currentUser, activeThreadId, readState = null, canModerate = false, panelOpen, panelFilter, panelCompact, selectionSettleMs = 150, class: className, onCreate, onSelect, onMarkRead, onModeChange, onOrphansChange, onPanelFilterChange, onPanelClose, onReply, onResolve, onReopen, onEditComment, onDeleteComment, onReanchor, children, composer, $$slots, $$events, ...rest } = $$props;
		let hoverBox = null;
		let flashBox = null;
		let pendingSelection = null;
		let composerSession = null;
		let draftBody = "";
		let confirmDiscardOpen = false;
		let openClusterId = null;
		let liveAnnouncement = "";
		let internalActiveThreadId = null;
		let panelDismissed = false;
		const effectiveActiveThreadId = derived(() => activeThreadId !== void 0 ? activeThreadId : internalActiveThreadId);
		const hasPanelCallbacks = derived(() => onReply !== void 0 || onResolve !== void 0 || onReopen !== void 0 || onEditComment !== void 0 || onDeleteComment !== void 0 || onReanchor !== void 0);
		const panelMounted = derived(() => panelOpen !== void 0 || hasPanelCallbacks());
		const effectivePanelOpen = derived(() => panelOpen !== void 0 ? panelOpen : mode === "review" && hasPanelCallbacks() && !panelDismissed);
		run(() => mode);
		let flashTimer;
		let selectionTriggerReleaseTimer;
		let selectionTriggerPressed = false;
		let confirmReturnFocus = null;
		const effectiveRoot = derived(() => {
			if (rootEl) return rootEl;
			return null;
		});
		const threads = derived(() => groupCommentsIntoThreads(comments));
		function relativeBox(rootRect, rect) {
			return {
				top: rect.top - rootRect.top,
				left: rect.left - rootRect.left,
				width: rect.width,
				height: rect.height
			};
		}
		function safeRangeRect(range, fallbackEl) {
			if (typeof range.getBoundingClientRect === "function") {
				const rect = range.getBoundingClientRect();
				if (rect.width > 0 || rect.height > 0) return rect;
			}
			return fallbackEl.getBoundingClientRect();
		}
		function compareDomOrder(a, b) {
			if (a.element !== b.element) {
				const pos = a.element.compareDocumentPosition(b.element);
				if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			}
			if (a.range && b.range) try {
				const cmp = a.range.compareBoundaryPoints(Range.START_TO_START, b.range);
				if (cmp !== 0) return cmp;
			} catch {}
			if (a.box.top !== b.box.top) return a.box.top - b.box.top;
			const aTime = a.thread.comments[0]?.createdAt ?? "";
			const bTime = b.thread.comments[0]?.createdAt ?? "";
			return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
		}
		const resolution = derived(() => {
			const root = effectiveRoot();
			const resolved = [];
			const orphaned = [];
			if (!root) return {
				resolved,
				orphaned,
				rootHeight: 0,
				overlayBox: null
			};
			const rootRect = root.getBoundingClientRect();
			const overlayBox = null;
			for (const thread of threads()) {
				if (thread.anchor === null) {
					orphaned.push(thread);
					continue;
				}
				const match = resolveAnchor(root, thread.anchor, { artifactVersion });
				if (match.status === "orphan") {
					orphaned.push(thread);
					continue;
				}
				let targetRect;
				if (match.kind === "region") targetRect = {
					top: rootRect.top + match.rect.y * rootRect.height,
					left: rootRect.left + match.rect.x * rootRect.width,
					width: match.rect.width * rootRect.width,
					height: match.rect.height * rootRect.height
				};
				else if (match.kind === "text" && match.range) targetRect = safeRangeRect(match.range, match.element);
				else targetRect = match.element.getBoundingClientRect();
				resolved.push({
					thread,
					anchorKind: match.kind,
					element: match.element,
					range: match.range,
					box: relativeBox(rootRect, targetRect),
					index: 0
				});
			}
			resolved.sort(compareDomOrder);
			resolved.forEach((entry, idx) => {
				entry.index = idx + 1;
			});
			return {
				resolved,
				orphaned,
				rootHeight: rootRect.height,
				overlayBox
			};
		});
		const clusters = derived(() => {
			const groups = [];
			const elementGroups = /* @__PURE__ */ new Map();
			const sectionGroups = /* @__PURE__ */ new Map();
			for (const entry of resolution().resolved) if (entry.anchorKind === "element" || entry.anchorKind === "text" && entry.range === null) {
				const existing = elementGroups.get(entry.element);
				if (existing) existing.push(entry);
				else {
					const bucket = [entry];
					elementGroups.set(entry.element, bucket);
					groups.push(bucket);
				}
			} else if (entry.thread.sectionKey) {
				const existing = sectionGroups.get(entry.thread.sectionKey);
				if (existing) existing.push(entry);
				else {
					const bucket = [entry];
					sectionGroups.set(entry.thread.sectionKey, bucket);
					groups.push(bucket);
				}
			} else groups.push([entry]);
			return groups.map((entries) => {
				const first = entries[0];
				const totalComments = entries.reduce((sum, e) => sum + e.thread.comments.length, 0);
				const unreadCount = entries.reduce((sum, e) => sum + countUnreadComments(e.thread, currentUser, readState), 0);
				const allResolved = entries.every((e) => e.thread.state === "closed");
				const anyActive = entries.some((e) => e.thread.threadId === effectiveActiveThreadId());
				const isCluster = entries.length > 1;
				const excerpt = formatAnchorLabel(first.thread.anchor, 60);
				const ariaLabel = isCluster ? `${entries.length} threads clustered, ${totalComments} comments${unreadCount > 0 ? `, ${unreadCount} unread` : ""}, on '${excerpt}'` : formatPinAriaLabel({
					index: first.index,
					count: totalComments,
					unreadCount,
					resolved: allResolved,
					excerpt
				});
				return {
					id: entries.map((e) => e.thread.threadId).join("+"),
					entries,
					box: first.box,
					primaryIndex: first.index,
					totalComments,
					unreadCount,
					allResolved,
					anyActive,
					variant: isCluster ? "cluster" : first.anchorKind === "element" ? "element" : "inline",
					ariaLabel
				};
			});
		});
		const gutterPins = derived(() => {
			if (clusters().length === 0) return [];
			const byId = new Map(clusters().map((cluster) => [cluster.id, cluster]));
			return layoutPins(clusters().map((cluster) => ({
				id: cluster.id,
				targetY: cluster.box.top
			})), {
				gap: 28,
				minY: 0,
				maxY: resolution().rootHeight > 0 ? Math.max(0, resolution().rootHeight - 24) : void 0
			}).map((item) => {
				const cluster = byId.get(item.id);
				return cluster ? {
					cluster,
					positioned: item
				} : null;
			}).filter((entry) => entry !== null);
		});
		const openCluster = derived(() => openClusterId ? clusters().find((cluster) => cluster.id === openClusterId) ?? null : null);
		function clearTransientState() {
			hoverBox = null;
			flashBox = null;
			pendingSelection = null;
			selectionTriggerPressed = false;
			if (selectionTriggerReleaseTimer !== void 0) {
				clearTimeout(selectionTriggerReleaseTimer);
				selectionTriggerReleaseTimer = void 0;
			}
			composerSession = null;
			draftBody = "";
			openClusterId = null;
			confirmDiscardOpen = false;
		}
		function openComposerForAnchor(anchor, invoker, top, left) {
			const encoded = tryEncodeAnchor(anchor);
			draftBody = "";
			composerSession = encoded.ok ? {
				anchor: encoded.payload,
				sectionKey: encoded.sectionKey,
				error: null,
				top,
				left,
				invoker
			} : {
				anchor,
				sectionKey: null,
				error: encoded.message,
				top,
				left,
				invoker
			};
		}
		function handleSelectionTriggerPointerDown(event) {
			event.preventDefault();
			selectionTriggerPressed = true;
			if (selectionTriggerReleaseTimer !== void 0) {
				clearTimeout(selectionTriggerReleaseTimer);
				selectionTriggerReleaseTimer = void 0;
			}
		}
		function handleSelectionTriggerFocusOut(event) {
			if (selectionTriggerPressed) return;
			event.relatedTarget;
			const root = effectiveRoot();
			if (!root) {
				pendingSelection = null;
				return;
			}
			const selection = root.ownerDocument.defaultView?.getSelection();
			if (!selection || selection.rangeCount === 0 || selection.getRangeAt(0).collapsed || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) pendingSelection = null;
		}
		function handleSelectionTriggerClick(event) {
			selectionTriggerPressed = false;
			if (selectionTriggerReleaseTimer !== void 0) {
				clearTimeout(selectionTriggerReleaseTimer);
				selectionTriggerReleaseTimer = void 0;
			}
			if (!pendingSelection) return;
			const { anchor, top, left } = pendingSelection;
			pendingSelection = null;
			openComposerForAnchor(anchor, event.currentTarget, top, left);
		}
		function restoreFocusFallback(preferred) {
			if (preferred?.isConnected && preferred.tabIndex >= 0) {
				preferred.focus();
				return;
			}
		}
		async function handleComposerSubmit(body) {
			const session = composerSession;
			if (!session || session.sectionKey === null) throw new Error(session?.error ?? "Unable to encode anchor for this selection.");
			const createdSectionKey = session.sectionKey;
			const invoker = session.invoker;
			const fullTarget = {
				kind: target.kind,
				id: target.id,
				sectionKey: createdSectionKey
			};
			await onCreate?.({
				target: fullTarget,
				sectionKey: createdSectionKey,
				body
			});
			composerSession = null;
			draftBody = "";
			liveAnnouncement = "Comment thread created.";
			await /* @__PURE__ */ tick();
			const doc = typeof document !== "undefined" ? document : null;
			const active = doc?.activeElement ?? null;
			if (active === null || active === doc?.body) {
				const panelHeading = effectivePanelOpen() ? null : null;
				if (panelHeading) panelHeading.focus();
				else restoreFocusFallback(invoker);
			}
		}
		function handleComposerCancel() {
			const invoker = composerSession?.invoker ?? null;
			composerSession = null;
			draftBody = "";
			(/* @__PURE__ */ tick()).then(() => {
				restoreFocusFallback(invoker);
			});
		}
		function handleSelectThread(threadId) {
			if (activeThreadId === void 0) internalActiveThreadId = threadId;
			if (threadId !== null) panelDismissed = false;
			onSelect?.(threadId);
		}
		function handlePanelClose() {
			if (panelOpen === void 0) panelDismissed = true;
			onPanelClose?.();
		}
		function activateEntry(entry) {
			openClusterId = null;
			handleSelectThread(entry.thread.threadId);
			onMarkRead?.(entry.thread.threadId);
			if (typeof entry.element.scrollIntoView === "function") entry.element.scrollIntoView({
				behavior: "smooth",
				block: "center"
			});
			flashBox = entry.box;
			if (flashTimer !== void 0) clearTimeout(flashTimer);
			flashTimer = setTimeout(() => {
				flashBox = null;
				flashTimer = void 0;
			}, 900);
		}
		function handleClusterPinActivate(cluster, event) {
			if (cluster.entries.length === 1) {
				activateEntry(cluster.entries[0]);
				return;
			}
			if (openClusterId === cluster.id) openClusterId = null;
			else {
				event?.currentTarget;
				openClusterId = cluster.id;
			}
		}
		function handleKeepEditing() {
			const returnTarget = confirmReturnFocus;
			confirmDiscardOpen = false;
			onModeChange?.("review");
			(/* @__PURE__ */ tick()).then(() => {
				if (mode !== "review") {
					confirmReturnFocus = null;
					restoreFocusFallback(returnTarget);
				}
			});
		}
		function handleDiscardDraft() {
			const returnTarget = confirmReturnFocus ?? composerSession?.invoker ?? null;
			confirmReturnFocus = null;
			clearTransientState();
			(/* @__PURE__ */ tick()).then(() => {
				restoreFocusFallback(returnTarget);
			});
		}
		const classes = derived(() => [
			"st-review-layer",
			`st-review-layer--${mode}`,
			className
		].filter(Boolean).join(" "));
		$$renderer.push(`<div${attributes({
			...rest,
			class: clsx(classes()),
			"data-review-mode": mode,
			tabindex: "-1"
		}, "svelte-18v5olh")}>`);
		if (children) {
			$$renderer.push(`<!--[0--><div class="st-review-layer__content svelte-18v5olh">`);
			children($$renderer);
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="st-review-layer__overlay svelte-18v5olh" data-review-overlay="true"${attr_style("", {
			top: resolution().overlayBox ? `${resolution().overlayBox.top}px` : void 0,
			left: resolution().overlayBox ? `${resolution().overlayBox.left}px` : void 0,
			width: resolution().overlayBox ? `${resolution().overlayBox.width}px` : void 0,
			height: resolution().overlayBox ? `${resolution().overlayBox.height}px` : void 0
		})}>`);
		if (mode === "review") {
			$$renderer.push("<!--[0-->");
			if (hoverBox) $$renderer.push(`<!--[0--><div class="st-review-layer__hover-outline svelte-18v5olh" aria-hidden="true"${attr_style("", {
				top: `${hoverBox.top}px`,
				left: `${hoverBox.left}px`,
				width: `${hoverBox.width}px`,
				height: `${hoverBox.height}px`
			})}></div>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (flashBox) $$renderer.push(`<!--[0--><div class="st-review-layer__flash svelte-18v5olh" aria-hidden="true"${attr_style("", {
				top: `${flashBox.top}px`,
				left: `${flashBox.left}px`,
				width: `${flashBox.width}px`,
				height: `${flashBox.height}px`
			})}></div>`);
			else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="st-review-layer__pins svelte-18v5olh" role="group" aria-label="Comment pins"><!--[-->`);
			const each_array = ensure_array_like(clusters());
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let cluster = each_array[$$index];
				$$renderer.push(`<div class="st-review-layer__pin-anchor svelte-18v5olh"${attr("data-pin-section-key", cluster.entries[0]?.thread.sectionKey ?? void 0)}${attr_style("", {
					top: `${cluster.box.top}px`,
					left: `${cluster.box.left + cluster.box.width}px`
				})}>`);
				CommentPin($$renderer, {
					index: cluster.primaryIndex,
					count: cluster.totalComments,
					unread: cluster.unreadCount > 0,
					resolved: cluster.allResolved,
					active: cluster.anyActive,
					label: cluster.ariaLabel,
					variant: cluster.variant,
					onclick: (event) => handleClusterPinActivate(cluster, event)
				});
				$$renderer.push(`<!----></div>`);
			}
			$$renderer.push(`<!--]--></div> `);
			if (gutterPins().length > 0) {
				$$renderer.push(`<!--[0--><div class="st-review-layer__gutter svelte-18v5olh" aria-hidden="false"><!--[-->`);
				const each_array_1 = ensure_array_like(gutterPins());
				for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
					let item = each_array_1[$$index_1];
					$$renderer.push(`<div class="st-review-layer__gutter-pin svelte-18v5olh"${attr_style("", { top: `${item.positioned.y}px` })}>`);
					CommentPin($$renderer, {
						index: item.cluster.primaryIndex,
						count: item.cluster.totalComments,
						unread: item.cluster.unreadCount > 0,
						resolved: item.cluster.allResolved,
						active: item.cluster.anyActive,
						label: item.cluster.ariaLabel,
						variant: "margin",
						tabindex: -1,
						onclick: (event) => handleClusterPinActivate(item.cluster, event)
					});
					$$renderer.push(`<!----></div>`);
				}
				$$renderer.push(`<!--]--></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (openCluster()) {
				$$renderer.push(`<!--[0--><div class="st-review-layer__cluster-popover svelte-18v5olh" role="dialog" aria-label="Clustered comment threads" tabindex="-1"${attr_style("", {
					top: `${openCluster().box.top + 28}px`,
					left: `${Math.max(0, openCluster().box.left)}px`
				})}><ul class="st-review-layer__cluster-list svelte-18v5olh"><!--[-->`);
				const each_array_2 = ensure_array_like(openCluster().entries);
				for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
					let entry = each_array_2[$$index_2];
					const preview = entry.thread.comments[0]?.body ?? "";
					const threadUnread = isUnread(entry.thread, currentUser, readState);
					$$renderer.push(`<li><button type="button" class="st-review-layer__cluster-item svelte-18v5olh"${attr("data-unread", threadUnread ? "true" : "false")}><span class="st-review-layer__cluster-index svelte-18v5olh">#${escape_html(entry.index)}</span> <span class="st-review-layer__cluster-preview svelte-18v5olh">${escape_html(preview)}</span></button></li>`);
				}
				$$renderer.push(`<!--]--></ul></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (pendingSelection && !composerSession) {
				$$renderer.push(`<!--[0--><div class="st-review-layer__selection-trigger svelte-18v5olh"${attr_style("", {
					top: `${pendingSelection.top}px`,
					left: `${pendingSelection.left}px`
				})}>`);
				Button($$renderer, {
					type: "button",
					variant: "primary",
					size: "sm",
					onpointerdown: handleSelectionTriggerPointerDown,
					onmousedown: handleSelectionTriggerPointerDown,
					onfocusout: handleSelectionTriggerFocusOut,
					onclick: handleSelectionTriggerClick,
					children: ($$renderer) => {
						$$renderer.push(`<!---->Add comment`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (composerSession) {
				$$renderer.push(`<!--[0--><div class="st-review-layer__composer svelte-18v5olh" role="dialog" aria-label="Add comment"${attr_style("", {
					top: `${composerSession.top}px`,
					left: `${composerSession.left}px`
				})}>`);
				if (composer) {
					$$renderer.push("<!--[0-->");
					composer($$renderer, {
						anchor: composerSession.anchor,
						sectionKey: composerSession.sectionKey,
						error: composerSession.error,
						submit: handleComposerSubmit,
						cancel: handleComposerCancel
					});
					$$renderer.push(`<!---->`);
				} else {
					$$renderer.push("<!--[-1-->");
					CommentComposer($$renderer, {
						author: currentUser,
						initialBody: draftBody,
						quotePreview: formatAnchorLabel(composerSession.anchor, 140),
						anchorError: composerSession.error,
						autofocus: true,
						trapFocus: true,
						onSubmit: handleComposerSubmit,
						onCancel: handleComposerCancel,
						onDraftChange: (next) => {
							draftBody = next;
						}
					});
				}
				$$renderer.push(`<!--]--></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (confirmDiscardOpen) {
			$$renderer.push(`<!--[0--><div class="st-review-layer__confirm svelte-18v5olh" role="alertdialog" aria-modal="true" aria-label="Discard unsaved comment draft" tabindex="-1"><p class="st-review-layer__confirm-text svelte-18v5olh">You have an unsaved comment draft. Discard it and exit review mode?</p> <div class="st-review-layer__confirm-actions svelte-18v5olh">`);
			Button($$renderer, {
				type: "button",
				variant: "secondary",
				size: "sm",
				onclick: handleKeepEditing,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Keep editing`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			Button($$renderer, {
				type: "button",
				variant: "danger",
				size: "sm",
				onclick: handleDiscardDraft,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Discard draft`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="st-review-layer__sr-live svelte-18v5olh" aria-live="polite" aria-atomic="true">${escape_html(liveAnnouncement)}</div></div> `);
		if (panelMounted()) {
			$$renderer.push(`<!--[0--><div class="st-review-layer__panel">`);
			ThreadPanel($$renderer, {
				threads: resolution().resolved.map((entry) => entry.thread),
				orphaned: resolution().orphaned,
				currentUser,
				activeThreadId: effectiveActiveThreadId(),
				filter: panelFilter,
				open: effectivePanelOpen(),
				readState,
				canModerate,
				compact: panelCompact,
				onSelect: handleSelectThread,
				onFilterChange: onPanelFilterChange,
				onClose: handlePanelClose,
				onReply,
				onResolve,
				onReopen,
				onEditComment,
				onDeleteComment,
				onReanchor,
				onMarkRead
			});
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
// node_modules/@sentropic/design-system-svelte/dist/ReviewModeToggle.svelte
function ReviewModeToggle($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { mode = "view", openCount = 0, unreadCount = 0, label = "Review", disabled = false, class: className, onModeChange, onclick, $$slots, $$events, ...rest } = $$props;
		const isReview = derived(() => mode === "review");
		const ariaLabel = derived(() => {
			const parts = [label];
			if (openCount > 0) parts.push(`${openCount} open`);
			if (unreadCount > 0) parts.push(`${unreadCount} unread`);
			return parts.join(", ");
		});
		const classes = derived(() => [
			"st-review-toggle",
			isReview() ? "st-review-toggle--active" : void 0,
			className
		].filter(Boolean).join(" "));
		function handleClick(event) {
			onclick?.(event);
			if (disabled) return;
			onModeChange?.(isReview() ? "view" : "review");
		}
		Button($$renderer, spread_props([rest, {
			type: "button",
			variant: isReview() ? "primary" : "secondary",
			size: "sm",
			class: classes(),
			disabled,
			"aria-pressed": isReview() ? "true" : "false",
			"aria-label": ariaLabel(),
			"data-review-mode": mode,
			onclick: handleClick,
			children: ($$renderer) => {
				Message_square($$renderer, {
					size: 15,
					strokeWidth: 2,
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> <span class="st-review-toggle__label svelte-anlgqk">${escape_html(label)}`);
				if (openCount > 0) $$renderer.push(`<!--[0--><span class="st-review-toggle__count svelte-anlgqk">· ${escape_html(openCount)}</span>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></span> `);
				if (unreadCount > 0) {
					$$renderer.push("<!--[0-->");
					Badge($$renderer, {
						size: "sm",
						shape: "circle",
						tone: "info",
						class: "st-review-toggle__unread",
						"aria-hidden": "true",
						children: ($$renderer) => {
							$$renderer.push(`<!---->${escape_html(unreadCount)}`);
						},
						$$slots: { default: true }
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}]));
	});
}
// src/lib/review/http-comments-adapter.js
/** @typedef {import('@sentropic/design-system-review-core').CollaborationActor} CollaborationActor */
/** @typedef {import('@sentropic/design-system-review-core').Comment} Comment */
/** @typedef {import('@sentropic/design-system-review-core').CommentAuthorship} CommentAuthorship */
/** @typedef {import('@sentropic/design-system-review-core').CommentProvenance} CommentProvenance */
/** @typedef {import('@sentropic/design-system-review-core').CommentState} CommentState */
/** @typedef {import('@sentropic/design-system-review-core').CommentTarget} CommentTarget */
/** @typedef {import('@sentropic/design-system-review-core').CommentsAdapter} CommentsAdapter */
/** @typedef {import('@sentropic/design-system-review-core').CreateCommentInput} CreateCommentInput */
/** @typedef {import('@sentropic/design-system-review-core').ReplyCommentInput} ReplyCommentInput */
/** @typedef {import('@sentropic/design-system-review-core').ReviewAdapterErrorCode} ReviewAdapterErrorCode */
/** @typedef {import('@sentropic/design-system-review-core').ReviewComment} ReviewComment */
var MAX_SECTION_KEY_LENGTH = 2048;
var MISSING_BINDING_LABEL = "comments unavailable (missing binding)";
var GENERIC_AGENT_ID = "agent:generic";
var GENERIC_AGENT_LABEL = "Agent";
var FALLBACK_ACTOR_COLOR = "#64748b";
/**
* Adapter error aligned on `@sentropic/design-system-review-core` `ReviewAdapterError` plus
* Focus Web transport states (`COMMENTS_UNAVAILABLE`, `SAVED_NOT_DELIVERED`).
*/
var FocusCommentsAdapterError = class extends Error {
	/**
	* @param {ReviewAdapterErrorCode | 'COMMENTS_UNAVAILABLE' | 'SAVED_NOT_DELIVERED' | 'TRANSPORT_ERROR'} code
	* @param {number} status
	* @param {string} message
	* @param {{ saved?: boolean, comment?: ReviewComment, missingBinding?: boolean, upstreamCode?: string }} [details]
	*/
	constructor(code, status, message, details = {}) {
		super(message);
		this.name = "FocusCommentsAdapterError";
		this.code = code;
		this.status = status;
		this.saved = details.saved === true;
		this.comment = details.comment;
		this.missingBinding = details.missingBinding === true;
		this.upstreamCode = details.upstreamCode;
	}
};
/**
* @param {unknown} value
* @returns {value is Record<string, any>}
*/
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/**
* DS r6 §1.2 target normalisation: `kind:'record' + recordType:'artifact'` -> `kind:'artifact'`,
* dropping `recordType` so the kit only ever sees `kind:'artifact'`.
*
* @param {CommentTarget} target
* @returns {CommentTarget}
*/
function normalizeArtifactTarget(target) {
	if (target.kind === "record" && target.recordType === "artifact") return {
		kind: "artifact",
		id: target.id,
		...target.sectionKey ? { sectionKey: target.sectionKey } : {}
	};
	return {
		kind: target.kind,
		id: target.id,
		...target.sectionKey ? { sectionKey: target.sectionKey } : {},
		...target.recordType ? { recordType: target.recordType } : {}
	};
}
/**
* DS r6 §1.1 single state vocabulary: `'open' | 'closed'` only. Never translates `'resolved'`.
*
* @param {unknown} state
* @returns {CommentState}
*/
function assertValidCommentState(state) {
	if (state === "open" || state === "closed") return state;
	throw new FocusCommentsAdapterError("INVALID_STATE", 502, `Invalid comment state ${JSON.stringify(state)}; contract requires "open" or "closed" only.`);
}
/**
* DS r6 §1.3 pre-send validation: whenever `provenance` is supplied (or caller declares non-human
* write), `provenance.toolCallId` MUST be a non-empty string (`trim().min(1)`).
*
* @param {CommentProvenance | undefined} provenance
* @param {'human' | 'agent' | 'nhi'} [actorKind]
* @returns {CommentProvenance | undefined}
*/
function assertPreSendProvenance(provenance, actorKind) {
	if (provenance === void 0 && !(actorKind === "agent" || actorKind === "nhi")) return void 0;
	if (!isRecord(provenance)) throw new FocusCommentsAdapterError("PROVENANCE_TOOL_CALL_ID_REQUIRED", 400, "Non-human comment writes require a non-empty provenance.toolCallId (e.g. agent:<sessionId>:<seq>).");
	const toolCallId = typeof provenance.toolCallId === "string" ? provenance.toolCallId.trim() : "";
	if (!toolCallId) throw new FocusCommentsAdapterError("PROVENANCE_TOOL_CALL_ID_REQUIRED", 400, "Non-human comment writes require a non-empty provenance.toolCallId (runId alone is dropped at write).");
	const runId = typeof provenance.runId === "string" && provenance.runId.trim() ? provenance.runId.trim() : void 0;
	return runId ? {
		toolCallId,
		runId
	} : { toolCallId };
}
/**
* Pre-send D3 cap check on `sectionKey` (2048 chars).
*
* @param {string | undefined} sectionKey
*/
function assertSectionKeyWithinCap(sectionKey) {
	if (typeof sectionKey === "string" && sectionKey.length > 2048) throw new FocusCommentsAdapterError("SECTION_KEY_TOO_LONG", 400, `Anchor sectionKey exceeds the ${MAX_SECTION_KEY_LENGTH}-character cap (got ${sectionKey.length}).`);
}
/**
* @param {unknown} raw
* @param {string} fallbackId
* @param {'human' | 'agent' | 'nhi'} fallbackKind
* @returns {CollaborationActor}
*/
function normalizeActor(raw, fallbackId, fallbackKind) {
	if (isRecord(raw) && typeof raw.actorId === "string" && raw.actorId.trim()) {
		const kind = raw.kind === "human" || raw.kind === "agent" || raw.kind === "nhi" ? raw.kind : fallbackKind;
		return {
			actorId: raw.actorId.trim(),
			kind,
			displayLabel: typeof raw.displayLabel === "string" && raw.displayLabel.trim() ? raw.displayLabel.trim() : raw.actorId.trim(),
			color: typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : FALLBACK_ACTOR_COLOR
		};
	}
	return {
		actorId: fallbackId,
		kind: fallbackKind,
		displayLabel: fallbackKind === "human" ? fallbackId : GENERIC_AGENT_LABEL,
		color: FALLBACK_ACTOR_COLOR
	};
}
/**
* Ensure a comment carries valid r6 `ReviewComment` shape (`target.kind === 'artifact'`,
* `state: 'open' | 'closed'`, two-icon `authorship` when `provenance.toolCallId` is present).
*
* @param {unknown} raw
* @param {string} fallbackWorkspaceId
* @returns {ReviewComment}
*/
function normalizeReviewComment(raw, fallbackWorkspaceId) {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.threadId !== "string") throw new FocusCommentsAdapterError("TRANSPORT_ERROR", 502, "Backend returned a malformed comment row.");
	if (!isRecord(raw.target) || typeof raw.target.id !== "string") throw new FocusCommentsAdapterError("INVALID_TARGET", 502, `Comment ${raw.id} is missing target.`);
	const target = normalizeArtifactTarget(raw.target);
	const state = assertValidCommentState(raw.state);
	const authorId = isRecord(raw.author) && typeof raw.author.id === "string" ? raw.author.id : "unknown";
	const provenance = isRecord(raw.provenance) && (typeof raw.provenance.toolCallId === "string" && raw.provenance.toolCallId.trim() || typeof raw.provenance.runId === "string" && raw.provenance.runId.trim()) ? {
		...typeof raw.provenance.toolCallId === "string" && raw.provenance.toolCallId.trim() ? { toolCallId: raw.provenance.toolCallId.trim() } : {},
		...typeof raw.provenance.runId === "string" && raw.provenance.runId.trim() ? { runId: raw.provenance.runId.trim() } : {}
	} : void 0;
	const isAgent = Boolean(provenance?.toolCallId);
	/** @type {CommentAuthorship} */
	let authorship;
	if (isRecord(raw.authorship) && isRecord(raw.authorship.author)) {
		const author = normalizeActor(raw.authorship.author, isAgent ? GENERIC_AGENT_ID : authorId, isAgent ? "agent" : "human");
		const sponsor = isRecord(raw.authorship.sponsor) ? normalizeActor(raw.authorship.sponsor, authorId, "human") : isAgent ? normalizeActor(null, authorId, "human") : void 0;
		const runId = typeof raw.authorship.runId === "string" && raw.authorship.runId.trim() ? raw.authorship.runId.trim() : void 0;
		authorship = {
			author,
			...sponsor ? { sponsor } : {},
			...runId ? { runId } : {}
		};
	} else if (isAgent) {
		const sponsor = {
			actorId: authorId,
			kind: "human",
			displayLabel: isRecord(raw.author) && typeof raw.author.displayLabel === "string" && raw.author.displayLabel.trim() ? raw.author.displayLabel.trim() : authorId,
			color: FALLBACK_ACTOR_COLOR
		};
		authorship = {
			author: {
				actorId: provenance?.runId && provenance.runId !== authorId ? provenance.runId : GENERIC_AGENT_ID,
				kind: "agent",
				displayLabel: GENERIC_AGENT_LABEL,
				color: FALLBACK_ACTOR_COLOR
			},
			sponsor,
			...provenance?.runId ? { runId: provenance.runId } : {}
		};
	} else authorship = { author: {
		actorId: authorId,
		kind: "human",
		displayLabel: isRecord(raw.author) && typeof raw.author.displayLabel === "string" && raw.author.displayLabel.trim() ? raw.author.displayLabel.trim() : authorId,
		color: FALLBACK_ACTOR_COLOR
	} };
	const tenant = isRecord(raw.tenant) && typeof raw.tenant.workspaceId === "string" ? {
		workspaceId: raw.tenant.workspaceId,
		...typeof raw.tenant.tenantId === "string" ? { tenantId: raw.tenant.tenantId } : {},
		...typeof raw.tenant.userId === "string" ? { userId: raw.tenant.userId } : {}
	} : { workspaceId: fallbackWorkspaceId };
	return {
		id: raw.id,
		tenant,
		target,
		threadId: raw.threadId,
		author: {
			id: authorId,
			...isRecord(raw.author) && (raw.author.kind === "human" || raw.author.kind === "agent" || raw.author.kind === "nhi") ? { kind: raw.author.kind } : {},
			...isRecord(raw.author) && typeof raw.author.displayLabel === "string" && raw.author.displayLabel ? { displayLabel: raw.author.displayLabel } : {}
		},
		authorship,
		...typeof raw.assignedTo === "string" && raw.assignedTo ? { assignedTo: raw.assignedTo } : {},
		state,
		body: typeof raw.body === "string" ? raw.body : String(raw.body ?? ""),
		...provenance ? { provenance } : {},
		createdAt: String(raw.createdAt),
		...typeof raw.updatedAt === "string" && raw.updatedAt ? { updatedAt: raw.updatedAt } : {}
	};
}
/**
* @typedef {{
*   kind: string,
*   durable: boolean,
*   label?: string
* }} AdapterStoreStatus
*/
/**
* @typedef {{
*   artifactId: string,
*   baseUrl?: string,
*   fetchImpl?: typeof fetch,
*   EventSourceImpl?: typeof EventSource,
*   pollMs?: number,
*   sendToAgent?: () => boolean,
*   agentTarget?: () => string | null | undefined,
*   onStoreStatus?: (status: AdapterStoreStatus) => void
* }} FocusHttpCommentsAdapterOptions
*/
/**
* Create a browser-side `CommentsAdapter` (DS r6 §1.4) bound to Focus Web's `/api/artifacts/:id/...`
* routes (PR #469).
*
* @param {FocusHttpCommentsAdapterOptions} options
* @returns {CommentsAdapter & {
*   createAsAgent(input: CreateCommentInput & { actorKind?: 'agent' | 'nhi' }): Promise<ReviewComment>,
*   replyAsAgent(input: ReplyCommentInput & { actorKind?: 'agent' | 'nhi' }): Promise<ReviewComment>
* }}
*/
function createFocusHttpCommentsAdapter(options) {
	const { artifactId, baseUrl = "", fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource, pollMs = 2e3, sendToAgent, agentTarget, onStoreStatus } = options;
	/** @type {Set<(comment: ReviewComment) => void>} */
	const createdListeners = /* @__PURE__ */ new Set();
	/** @param {string} id */
	const artifactBase = (id) => `${baseUrl.replace(/\/$/, "")}/api/artifacts/${encodeURIComponent(id)}`;
	/**
	* @param {Response} response
	*/
	function captureStoreHeaders(response) {
		const kind = response.headers.get("x-comments-store");
		if (kind && onStoreStatus) onStoreStatus({
			kind,
			durable: response.headers.get("x-comments-durable") === "true"
		});
	}
	/**
	* @param {string} url
	* @param {RequestInit} init
	* @param {string} workspaceId
	*/
	async function requestJson(url, init, workspaceId) {
		/** @type {Response} */
		let response;
		try {
			response = await fetchImpl(url, init);
		} catch (error) {
			throw new FocusCommentsAdapterError("COMMENTS_UNAVAILABLE", 503, `${MISSING_BINDING_LABEL}: unable to reach Focus Web comments API (${error instanceof Error ? error.message : String(error)}).`, { missingBinding: true });
		}
		captureStoreHeaders(response);
		const text = await response.text();
		/** @type {any} */
		let payload = null;
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = null;
		}
		if (!response.ok) {
			const errObj = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
			const upstreamCode = isRecord(errObj) && typeof errObj.code === "string" ? errObj.code : void 0;
			const message = isRecord(errObj) && typeof errObj.message === "string" && errObj.message.trim() ? errObj.message.trim() : `Comments request failed (HTTP ${response.status}).`;
			if (isRecord(errObj) && errObj.saved === true && isRecord(errObj.comment)) {
				const savedComment = normalizeReviewComment(errObj.comment, workspaceId);
				emitCreated(savedComment);
				throw new FocusCommentsAdapterError("SAVED_NOT_DELIVERED", response.status, message, {
					saved: true,
					comment: savedComment,
					upstreamCode
				});
			}
			if (response.status === 503 || upstreamCode === "comments_unavailable") {
				onStoreStatus?.({
					kind: "unconfigured",
					durable: false,
					label: MISSING_BINDING_LABEL
				});
				throw new FocusCommentsAdapterError("COMMENTS_UNAVAILABLE", 503, message.toLowerCase().includes("comments unavailable (missing binding)") ? message : `${MISSING_BINDING_LABEL}: ${message}`, {
					missingBinding: true,
					upstreamCode
				});
			}
			if (upstreamCode === "section_key_too_long") throw new FocusCommentsAdapterError("SECTION_KEY_TOO_LONG", 400, message, { upstreamCode });
			if (upstreamCode === "invalid_provenance") throw new FocusCommentsAdapterError("PROVENANCE_TOOL_CALL_ID_REQUIRED", 400, message, { upstreamCode });
			if (upstreamCode === "invalid_assignee") throw new FocusCommentsAdapterError("INVALID_ASSIGNEE", 400, message, { upstreamCode });
			if (upstreamCode === "body_required" || upstreamCode === "body_too_long") throw new FocusCommentsAdapterError("INVALID_BODY", 400, message, { upstreamCode });
			if (response.status === 403 || upstreamCode === "forbidden") throw new FocusCommentsAdapterError("FORBIDDEN", 403, message, { upstreamCode });
			if (response.status === 404 || upstreamCode === "thread_not_found" || upstreamCode === "comment_not_found") throw new FocusCommentsAdapterError("NOT_FOUND", 404, message, { upstreamCode });
			throw new FocusCommentsAdapterError("TRANSPORT_ERROR", response.status, message, { upstreamCode });
		}
		return payload;
	}
	/** @param {ReviewComment} comment */
	function emitCreated(comment) {
		for (const listener of [...createdListeners]) try {
			listener(comment);
		} catch {}
	}
	/**
	* @param {string} tenant
	* @param {CommentTarget} target
	* @returns {Promise<ReviewComment[]>}
	*/
	async function list(tenant, target) {
		const normalized = normalizeArtifactTarget(target);
		if (normalized.kind !== "artifact") throw new FocusCommentsAdapterError("INVALID_TARGET", 400, `Artifact comments adapter only accepts target.kind "artifact" (got ${JSON.stringify(target.kind)}).`);
		const query = new URLSearchParams({ tenant });
		const payload = await requestJson(`${artifactBase(normalized.id)}/comments?${query}`, { method: "GET" }, tenant);
		if (!isRecord(payload) || !Array.isArray(payload.threads)) throw new FocusCommentsAdapterError("TRANSPORT_ERROR", 502, "Backend did not return { threads }.");
		/** @type {ReviewComment[]} */
		const flat = [];
		for (const group of payload.threads) {
			if (!Array.isArray(group)) continue;
			for (const row of group) flat.push(normalizeReviewComment(row, tenant));
		}
		return flat;
	}
	/**
	* @param {{
	*   tenant: string,
	*   target: CommentTarget,
	*   body: string,
	*   threadId?: string,
	*   provenance?: CommentProvenance,
	*   actorKind?: 'human' | 'agent' | 'nhi'
	* }} input
	* @returns {Promise<ReviewComment>}
	*/
	async function postComment(input) {
		const normalized = normalizeArtifactTarget(input.target);
		if (normalized.kind !== "artifact") throw new FocusCommentsAdapterError("INVALID_TARGET", 400, "target.kind must be \"artifact\".");
		const trimmedBody = typeof input.body === "string" ? input.body.trim() : "";
		if (!trimmedBody) throw new FocusCommentsAdapterError("INVALID_BODY", 400, "Comment body must be non-empty.");
		assertSectionKeyWithinCap(normalized.sectionKey);
		const provenance = assertPreSendProvenance(input.provenance, input.actorKind);
		const shouldNotify = !Boolean(provenance?.toolCallId) && Boolean(sendToAgent?.());
		const requestedTarget = shouldNotify ? agentTarget?.() : void 0;
		/** @type {Record<string, unknown>} */
		const body = {
			tenant: input.tenant,
			target: normalized,
			...normalized.sectionKey ? { sectionKey: normalized.sectionKey } : {},
			...input.threadId ? { threadId: input.threadId } : {},
			body: trimmedBody,
			...provenance ? { provenance } : {},
			...input.actorKind ? { actorKind: input.actorKind } : {},
			...shouldNotify ? { sendToAgent: true } : {},
			...requestedTarget ? { agentTarget: requestedTarget } : {}
		};
		const saved = normalizeReviewComment(await requestJson(`${artifactBase(normalized.id)}/comments`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...input.actorKind && input.actorKind !== "human" ? { "x-actor-kind": input.actorKind } : {}
			},
			body: JSON.stringify(body)
		}, input.tenant), input.tenant);
		emitCreated(saved);
		return saved;
	}
	/**
	* @param {string} tenant
	* @param {string} commentId
	* @param {string} body
	* @returns {Promise<ReviewComment>}
	*/
	async function edit(tenant, commentId, body) {
		const trimmed = typeof body === "string" ? body.trim() : "";
		if (!trimmed) throw new FocusCommentsAdapterError("INVALID_BODY", 400, "Comment body must be non-empty.");
		return normalizeReviewComment(await requestJson(`${artifactBase(artifactId)}/comments/${encodeURIComponent(commentId)}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tenant,
				body: trimmed
			})
		}, tenant), tenant);
	}
	/**
	* @param {string} tenant
	* @param {string} threadId
	* @param {CommentState} state
	* @returns {Promise<void>}
	*/
	async function setState(tenant, threadId, state) {
		const action = assertValidCommentState(state) === "closed" ? "close" : "reopen";
		const query = new URLSearchParams({ tenant });
		await requestJson(`${artifactBase(artifactId)}/threads/${encodeURIComponent(threadId)}/${action}?${query}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({})
		}, tenant);
	}
	/**
	* @param {string} tenant
	* @param {string} commentId
	* @returns {Promise<void>}
	*/
	async function remove(tenant, commentId) {
		const query = new URLSearchParams({ tenant });
		await requestJson(`${artifactBase(artifactId)}/comments/${encodeURIComponent(commentId)}?${query}`, {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({})
		}, tenant);
	}
	/**
	* @param {string} tenant
	* @param {string} threadId
	* @param {string | null} assigneeId
	* @returns {Promise<void>}
	*/
	async function assign(tenant, threadId, assigneeId) {
		await requestJson(`${artifactBase(artifactId)}/threads/${encodeURIComponent(threadId)}/assign`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tenant,
				assignedTo: assigneeId
			})
		}, tenant);
	}
	/**
	* Subscribe to live updates via Focus Web's SSE `/stream` route with polling fallback.
	*
	* @param {string} tenant
	* @param {CommentTarget} target
	* @param {(comments: ReviewComment[]) => void} cb
	* @returns {() => void}
	*/
	function subscribe(tenant, target, cb) {
		const normalized = normalizeArtifactTarget(target);
		let stopped = false;
		/** @type {EventSource | null} */
		let source = null;
		/** @type {ReturnType<typeof setInterval> | null} */
		let timer = null;
		let refreshing = false;
		const refresh = async () => {
			if (stopped || refreshing) return;
			refreshing = true;
			try {
				const next = await list(tenant, normalized);
				if (!stopped) cb(next);
			} catch {} finally {
				refreshing = false;
			}
		};
		const startPolling = () => {
			if (stopped || timer !== null) return;
			timer = setInterval(() => {
				refresh();
			}, Math.max(250, pollMs));
		};
		if (typeof EventSourceImpl === "function") try {
			source = new EventSourceImpl(`${artifactBase(normalized.id)}/stream`);
			const onMutation = () => {
				refresh();
			};
			for (const eventName of [
				"comment.created",
				"comment.updated",
				"comment.deleted",
				"thread.closed",
				"thread.reopened",
				"thread.assigned"
			]) source.addEventListener(eventName, onMutation);
			source.addEventListener("ready", (event) => {
				try {
					const parsed = JSON.parse(
						/** @type {MessageEvent} */
						event.data
					);
					if (isRecord(parsed?.store) && typeof parsed.store.kind === "string") onStoreStatus?.({
						kind: parsed.store.kind,
						durable: parsed.store.durable === true,
						...typeof parsed.store.label === "string" ? { label: parsed.store.label } : {}
					});
				} catch {}
			});
			source.addEventListener("review.error", (event) => {
				try {
					const parsed = JSON.parse(
						/** @type {MessageEvent} */
						event.data
					);
					if (parsed?.error?.code === "comments_unavailable") onStoreStatus?.({
						kind: "unconfigured",
						durable: false,
						label: parsed.error.message || "comments unavailable (missing binding)"
					});
				} catch {}
			});
			source.onerror = () => {
				startPolling();
			};
		} catch {
			startPolling();
		}
		else startPolling();
		return () => {
			stopped = true;
			if (source) {
				source.close();
				source = null;
			}
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		};
	}
	return {
		list,
		create(input) {
			return postComment(input);
		},
		reply(input) {
			return postComment(input);
		},
		createAsAgent(input) {
			return postComment({
				...input,
				actorKind: input.actorKind ?? "agent"
			});
		},
		replyAsAgent(input) {
			return postComment({
				...input,
				actorKind: input.actorKind ?? "agent"
			});
		},
		edit,
		setState,
		remove,
		assign,
		subscribe,
		onCommentCreated(cb) {
			createdListeners.add(cb);
			return () => {
				createdListeners.delete(cb);
			};
		}
	};
}
// src/lib/review/ArtifactReviewHost.svelte
function ArtifactReviewHost($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** Optional explicit agent target (e.g. from dossier h2a target selector). */
		/** Optional custom CommentsAdapter for tests/storybook; defaults to the Focus Web HTTP adapter. */
		/** Optional callback notified whenever host-controlled review mode changes. */
		let { artifactId, artifactVersion, reviewConfig, agentTarget = null, adapter: providedAdapter, onModeChange, children } = $$props;
		let mode = run(() => reviewConfig.initialMode);
		let comments = [];
		let activeThreadId = null;
		let panelOpen = true;
		let panelFilter = "all";
		let readState = {};
		let sendToAgent = false;
		let storeStatus = run(() => reviewConfig.missingBinding ? {
			kind: "unconfigured",
			durable: false,
			label: MISSING_BINDING_LABEL
		} : null);
		let unavailableMessage = run(() => reviewConfig.missingBinding ? `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.` : null);
		let actionError = null;
		let deliveryNotice = null;
		const target = derived(() => ({
			kind: "artifact",
			id: artifactId
		}));
		const commentsUnavailable = derived(() => unavailableMessage !== null);
		const threads = derived(() => groupCommentsIntoThreads(comments));
		const openCount = derived(() => countThreadsByFilter(threads(), reviewConfig.currentUser).open);
		const unreadCount = derived(() => countUnreadThreads(threads(), reviewConfig.currentUser, readState));
		function getAdapter() {
			if (providedAdapter) return providedAdapter;
			return createFocusHttpCommentsAdapter({
				artifactId,
				pollMs: reviewConfig.pollMs,
				sendToAgent: () => sendToAgent,
				agentTarget: () => agentTarget,
				onStoreStatus: (status) => {
					storeStatus = status;
					if (status.kind === "unconfigured") unavailableMessage = status.label && status.label.toLowerCase().includes("comments unavailable (missing binding)") ? status.label : `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.`;
				}
			});
		}
		async function refreshComments(activeAdapter) {
			if (!reviewConfig.enabled) return;
			if (reviewConfig.missingBinding) {
				unavailableMessage = `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.`;
				comments = [];
				return;
			}
			try {
				comments = await activeAdapter.list(reviewConfig.tenant, target());
				unavailableMessage = null;
			} catch (error) {
				if (error instanceof FocusCommentsAdapterError && error.missingBinding) {
					unavailableMessage = error.message;
					comments = [];
					return;
				}
				actionError = error instanceof Error ? error.message : String(error);
			}
		}
		function syncUrlReviewParam(next) {
			if (typeof window === "undefined") return;
			try {
				const url = new URL(window.location.href);
				if (next === "review") url.searchParams.set("review", "1");
				else url.searchParams.delete("review");
				window.history.replaceState(window.history.state, "", url.toString());
			} catch {}
		}
		function handleModeChange(next) {
			mode = next;
			if (next === "review") panelOpen = true;
			syncUrlReviewParam(next);
			onModeChange?.(next);
		}
		function upsertComment(saved) {
			if (comments.findIndex((row) => row.id === saved.id) >= 0) comments = comments.map((row) => row.id === saved.id ? saved : row);
			else comments = [...comments, saved];
		}
		function markThreadRead(threadId) {
			readState = {
				...readState,
				[threadId]: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		async function handleCreate(payload) {
			actionError = null;
			deliveryNotice = null;
			if (commentsUnavailable()) {
				const msg = unavailableMessage ?? "comments unavailable (missing binding)";
				actionError = msg;
				throw new Error(msg);
			}
			const activeAdapter = getAdapter();
			try {
				const created = await activeAdapter.create({
					tenant: reviewConfig.tenant,
					target: {
						kind: "artifact",
						id: artifactId,
						sectionKey: payload.sectionKey
					},
					body: payload.body
				});
				upsertComment(created);
				activeThreadId = created.threadId;
				panelOpen = true;
				markThreadRead(created.threadId);
			} catch (error) {
				if (error instanceof FocusCommentsAdapterError && error.saved && error.comment) {
					upsertComment(error.comment);
					activeThreadId = error.comment.threadId;
					panelOpen = true;
					markThreadRead(error.comment.threadId);
					deliveryNotice = `Saved, not sent: ${error.message}`;
					return;
				}
				if (error instanceof FocusCommentsAdapterError && error.missingBinding) unavailableMessage = error.message;
				actionError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
		async function handleReply(threadId, body) {
			actionError = null;
			deliveryNotice = null;
			if (commentsUnavailable()) {
				const msg = unavailableMessage ?? "comments unavailable (missing binding)";
				actionError = msg;
				throw new Error(msg);
			}
			const activeAdapter = getAdapter();
			const sectionKey = threads().find((t) => t.threadId === threadId)?.sectionKey;
			try {
				upsertComment(await activeAdapter.reply({
					tenant: reviewConfig.tenant,
					target: {
						kind: "artifact",
						id: artifactId,
						...sectionKey ? { sectionKey } : {}
					},
					threadId,
					body
				}));
				markThreadRead(threadId);
			} catch (error) {
				if (error instanceof FocusCommentsAdapterError && error.saved && error.comment) {
					upsertComment(error.comment);
					markThreadRead(threadId);
					deliveryNotice = `Saved, not sent: ${error.message}`;
					return;
				}
				if (error instanceof FocusCommentsAdapterError && error.missingBinding) unavailableMessage = error.message;
				actionError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
		async function handleSetState(threadId, state) {
			actionError = null;
			if (commentsUnavailable()) {
				actionError = unavailableMessage ?? "comments unavailable (missing binding)";
				return;
			}
			const previous = comments;
			comments = comments.map((row) => row.threadId === threadId ? {
				...row,
				state
			} : row);
			const activeAdapter = getAdapter();
			try {
				await activeAdapter.setState(reviewConfig.tenant, threadId, state);
				await refreshComments(activeAdapter);
			} catch (error) {
				comments = previous;
				if (error instanceof FocusCommentsAdapterError && error.missingBinding) unavailableMessage = error.message;
				actionError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
		async function handleEditComment(commentId, body) {
			actionError = null;
			if (commentsUnavailable()) {
				actionError = unavailableMessage ?? "comments unavailable (missing binding)";
				return;
			}
			const previous = comments;
			comments = comments.map((row) => row.id === commentId ? {
				...row,
				body
			} : row);
			const activeAdapter = getAdapter();
			try {
				upsertComment(await activeAdapter.edit(reviewConfig.tenant, commentId, body));
			} catch (error) {
				comments = previous;
				actionError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
		async function handleDeleteComment(commentId) {
			actionError = null;
			if (commentsUnavailable()) {
				actionError = unavailableMessage ?? "comments unavailable (missing binding)";
				return;
			}
			const previous = comments;
			comments = comments.filter((row) => row.id !== commentId);
			const activeAdapter = getAdapter();
			try {
				await activeAdapter.remove(reviewConfig.tenant, commentId);
				await refreshComments(activeAdapter);
			} catch (error) {
				comments = previous;
				actionError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
		const isC2bStub = derived(() => !commentsUnavailable() && (storeStatus?.kind === "memory" || !storeStatus && reviewConfig.storeMode === "c2b-stub"));
		if (!reviewConfig.enabled) {
			$$renderer.push("<!--[0-->");
			children($$renderer);
			$$renderer.push(`<!---->`);
		} else {
			$$renderer.push(`<!--[-1--><div${attr_class("review-host svelte-1iiik6s", void 0, { "review-host--review": mode === "review" })} data-artifact-review-enabled="true"${attr("data-artifact-id", artifactId)}${attr("data-artifact-version", artifactVersion)}><div class="review-bar svelte-1iiik6s" role="region" aria-label="Artifact review controls"><div class="review-bar__left svelte-1iiik6s">`);
			ReviewModeToggle($$renderer, {
				mode,
				openCount: openCount(),
				unreadCount: unreadCount(),
				label: "Review",
				onModeChange: handleModeChange
			});
			$$renderer.push(`<!----> `);
			if (mode === "review") {
				$$renderer.push("<!--[0-->");
				if (commentsUnavailable()) {
					$$renderer.push("<!--[0-->");
					Badge($$renderer, {
						tone: "warning",
						size: "sm",
						children: ($$renderer) => {
							$$renderer.push(`<!---->${escape_html(MISSING_BINDING_LABEL)}`);
						},
						$$slots: { default: true }
					});
				} else if (isC2bStub()) {
					$$renderer.push("<!--[1-->");
					Badge($$renderer, {
						tone: "neutral",
						size: "sm",
						children: ($$renderer) => {
							$$renderer.push(`<!---->C2b stub · in-memory only`);
						},
						$$slots: { default: true }
					});
				} else {
					$$renderer.push("<!--[-1-->");
					Badge($$renderer, {
						tone: "success",
						size: "sm",
						children: ($$renderer) => {
							$$renderer.push(`<!---->cluster-mesh`);
						},
						$$slots: { default: true }
					});
				}
				$$renderer.push(`<!--]-->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> `);
			if (mode === "review" && !commentsUnavailable()) {
				$$renderer.push(`<!--[0--><div class="review-bar__right svelte-1iiik6s"><label class="review-bar__notify svelte-1iiik6s"><input type="checkbox"${attr("checked", sendToAgent, true)}/> <span>Notify agent on human comments</span></label> `);
				if (!panelOpen) $$renderer.push(`<!--[0--><button type="button" class="review-bar__reopen-panel svelte-1iiik6s">Show comments</button>`);
				else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> `);
			if (mode === "review" && actionError) {
				$$renderer.push(`<!--[0--><div class="review-alert svelte-1iiik6s" role="alert">`);
				Alert($$renderer, {
					tone: "error",
					title: "Comment action failed",
					message: actionError
				});
				$$renderer.push(`<!----></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (mode === "review" && deliveryNotice) {
				$$renderer.push(`<!--[0--><div class="review-alert svelte-1iiik6s" role="status">`);
				Alert($$renderer, {
					tone: "warning",
					title: "Comment saved, agent not notified",
					message: deliveryNotice
				});
				$$renderer.push(`<!----></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div${attr_class("review-stage svelte-1iiik6s", void 0, { "review-stage--unavailable": mode === "review" && commentsUnavailable() && panelOpen })}>`);
			CommentLayer($$renderer, {
				mode,
				target: target(),
				artifactVersion,
				comments,
				currentUser: reviewConfig.currentUser,
				activeThreadId,
				readState,
				panelOpen: mode === "review" && panelOpen && !commentsUnavailable(),
				panelFilter,
				onCreate: handleCreate,
				onSelect: (threadId) => {
					activeThreadId = threadId;
					if (threadId !== null) panelOpen = true;
				},
				onMarkRead: markThreadRead,
				onModeChange: handleModeChange,
				onPanelFilterChange: (next) => panelFilter = next,
				onPanelClose: () => panelOpen = false,
				onReply: handleReply,
				onResolve: (threadId) => handleSetState(threadId, "closed"),
				onReopen: (threadId) => handleSetState(threadId, "open"),
				onEditComment: handleEditComment,
				onDeleteComment: handleDeleteComment,
				children: ($$renderer) => {
					$$renderer.push(`<div${attr("data-review-root", artifactId)}${attr("data-artifact-version", artifactVersion)}>`);
					children($$renderer);
					$$renderer.push(`<!----></div>`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			if (mode === "review" && commentsUnavailable() && panelOpen) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<!--[-1--><aside class="review-unavailable-panel svelte-1iiik6s" aria-label="Comments" tabindex="-1"><header class="review-unavailable-panel__header svelte-1iiik6s"><h2 class="svelte-1iiik6s">Comments</h2></header> <div class="review-unavailable__body svelte-1iiik6s" role="alert">`);
				Alert($$renderer, {
					tone: "warning",
					title: MISSING_BINDING_LABEL,
					message: unavailableMessage ?? `comments unavailable (missing binding): configure FOCUS_COMMENTS_URL.`
				});
				$$renderer.push(`<!----></div></aside>`);
				$$renderer.push(`<!--]-->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div>`);
		}
		$$renderer.push(`<!--]-->`);
	});
}
export { Tile as n, Stack as r, ArtifactReviewHost as t };

//# sourceMappingURL=ArtifactReviewHost.js.map