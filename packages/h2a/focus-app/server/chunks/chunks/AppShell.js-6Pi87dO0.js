import { a6 as attr_class, a7 as clsx, a3 as attr, Z as derived, a8 as attributes, a4 as escape_html, a9 as ensure_array_like, aa as bind_props, ab as spread_props, ac as element } from './index.js-laGHLarB.js';

const defaultAttributes = {
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
function Icon($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const {
      name,
      color = "currentColor",
      size = 24,
      strokeWidth = 2,
      absoluteStrokeWidth = false,
      iconNode = [],
      children,
      $$slots,
      $$events,
      ...props
    } = $$props;
    $$renderer2.push(`<svg${attributes(
      {
        ...defaultAttributes,
        ...props,
        width: size,
        height: size,
        stroke: color,
        "stroke-width": absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        class: clsx(["lucide-icon lucide", name && `lucide-${name}`, props.class])
      },
      void 0,
      void 0,
      void 0,
      3
    )}><!--[-->`);
    const each_array = ensure_array_like(iconNode);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let [tag, attrs] = each_array[$$index];
      element($$renderer2, tag, () => {
        $$renderer2.push(`${attributes({ ...attrs }, void 0, void 0, void 0, 3)}`);
      });
    }
    $$renderer2.push(`<!--]-->`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></svg>`);
  });
}
function Boxes($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      [
        "path",
        {
          "d": "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"
        }
      ],
      ["path", { "d": "m7 16.5-4.74-2.85" }],
      ["path", { "d": "m7 16.5 5-3" }],
      ["path", { "d": "M7 16.5v5.17" }],
      [
        "path",
        {
          "d": "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"
        }
      ],
      ["path", { "d": "m17 16.5-5-3" }],
      ["path", { "d": "m17 16.5 4.74-2.85" }],
      ["path", { "d": "M17 16.5v5.17" }],
      [
        "path",
        {
          "d": "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"
        }
      ],
      ["path", { "d": "M12 8 7.26 5.15" }],
      ["path", { "d": "m12 8 4.74-2.85" }],
      ["path", { "d": "M12 13.5V8" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "boxes" },
      /**
       * @component @name Boxes
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNMi45NyAxMi45MkEyIDIgMCAwIDAgMiAxNC42M3YzLjI0YTIgMiAwIDAgMCAuOTcgMS43MWwzIDEuOGEyIDIgMCAwIDAgMi4wNiAwTDEyIDE5di01LjVsLTUtMy00LjAzIDIuNDJaIiAvPgogIDxwYXRoIGQ9Im03IDE2LjUtNC43NC0yLjg1IiAvPgogIDxwYXRoIGQ9Im03IDE2LjUgNS0zIiAvPgogIDxwYXRoIGQ9Ik03IDE2LjV2NS4xNyIgLz4KICA8cGF0aCBkPSJNMTIgMTMuNVYxOWwzLjk3IDIuMzhhMiAyIDAgMCAwIDIuMDYgMGwzLTEuOGEyIDIgMCAwIDAgLjk3LTEuNzF2LTMuMjRhMiAyIDAgMCAwLS45Ny0xLjcxTDE3IDEwLjVsLTUgM1oiIC8+CiAgPHBhdGggZD0ibTE3IDE2LjUtNS0zIiAvPgogIDxwYXRoIGQ9Im0xNyAxNi41IDQuNzQtMi44NSIgLz4KICA8cGF0aCBkPSJNMTcgMTYuNXY1LjE3IiAvPgogIDxwYXRoIGQ9Ik03Ljk3IDQuNDJBMiAyIDAgMCAwIDcgNi4xM3Y0LjM3bDUgMyA1LTNWNi4xM2EyIDIgMCAwIDAtLjk3LTEuNzFsLTMtMS44YTIgMiAwIDAgMC0yLjA2IDBsLTMgMS44WiIgLz4KICA8cGF0aCBkPSJNMTIgOCA3LjI2IDUuMTUiIC8+CiAgPHBhdGggZD0ibTEyIDggNC43NC0yLjg1IiAvPgogIDxwYXRoIGQ9Ik0xMiAxMy41VjgiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/boxes
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Chevron_down($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [["path", { "d": "m6 9 6 6 6-6" }]];
    Icon($$renderer2, spread_props([
      { name: "chevron-down" },
      /**
       * @component @name ChevronDown
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJtNiA5IDYgNiA2LTYiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/chevron-down
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Globe($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["circle", { "cx": "12", "cy": "12", "r": "10" }],
      [
        "path",
        { "d": "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }
      ],
      ["path", { "d": "M2 12h20" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "globe" },
      /**
       * @component @name Globe
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgLz4KICA8cGF0aCBkPSJNMTIgMmExNC41IDE0LjUgMCAwIDAgMCAyMCAxNC41IDE0LjUgMCAwIDAgMC0yMCIgLz4KICA8cGF0aCBkPSJNMiAxMmgyMCIgLz4KPC9zdmc+Cg==) - https://lucide.dev/icons/globe
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Moon($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      [
        "path",
        {
          "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
        }
      ]
    ];
    Icon($$renderer2, spread_props([
      { name: "moon" },
      /**
       * @component @name Moon
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNMjAuOTg1IDEyLjQ4NmE5IDkgMCAxIDEtOS40NzMtOS40NzJjLjQwNS0uMDIyLjYxNy40Ni40MDIuODAzYTYgNiAwIDAgMCA4LjI2OCA4LjI2OGMuMzQ0LS4yMTUuODI1LS4wMDQuODAzLjQwMSIgLz4KPC9zdmc+Cg==) - https://lucide.dev/icons/moon
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Palette($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      [
        "path",
        {
          "d": "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
        }
      ],
      [
        "circle",
        { "cx": "13.5", "cy": "6.5", "r": ".5", "fill": "currentColor" }
      ],
      [
        "circle",
        {
          "cx": "17.5",
          "cy": "10.5",
          "r": ".5",
          "fill": "currentColor"
        }
      ],
      [
        "circle",
        { "cx": "6.5", "cy": "12.5", "r": ".5", "fill": "currentColor" }
      ],
      [
        "circle",
        { "cx": "8.5", "cy": "7.5", "r": ".5", "fill": "currentColor" }
      ]
    ];
    Icon($$renderer2, spread_props([
      { name: "palette" },
      /**
       * @component @name Palette
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNMTIgMjJhMSAxIDAgMCAxIDAtMjAgMTAgOSAwIDAgMSAxMCA5IDUgNSAwIDAgMS01IDVoLTIuMjVhMS43NSAxLjc1IDAgMCAwLTEuNCAyLjhsLjMuNGExLjc1IDEuNzUgMCAwIDEtMS40IDIuOHoiIC8+CiAgPGNpcmNsZSBjeD0iMTMuNSIgY3k9IjYuNSIgcj0iLjUiIGZpbGw9ImN1cnJlbnRDb2xvciIgLz4KICA8Y2lyY2xlIGN4PSIxNy41IiBjeT0iMTAuNSIgcj0iLjUiIGZpbGw9ImN1cnJlbnRDb2xvciIgLz4KICA8Y2lyY2xlIGN4PSI2LjUiIGN5PSIxMi41IiByPSIuNSIgZmlsbD0iY3VycmVudENvbG9yIiAvPgogIDxjaXJjbGUgY3g9IjguNSIgY3k9IjcuNSIgcj0iLjUiIGZpbGw9ImN1cnJlbnRDb2xvciIgLz4KPC9zdmc+Cg==) - https://lucide.dev/icons/palette
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Search($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["path", { "d": "m21 21-4.34-4.34" }],
      ["circle", { "cx": "11", "cy": "11", "r": "8" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "search" },
      /**
       * @component @name Search
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJtMjEgMjEtNC4zNC00LjM0IiAvPgogIDxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/search
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Sun($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["circle", { "cx": "12", "cy": "12", "r": "4" }],
      ["path", { "d": "M12 2v2" }],
      ["path", { "d": "M12 20v2" }],
      ["path", { "d": "m4.93 4.93 1.41 1.41" }],
      ["path", { "d": "m17.66 17.66 1.41 1.41" }],
      ["path", { "d": "M2 12h2" }],
      ["path", { "d": "M20 12h2" }],
      ["path", { "d": "m6.34 17.66-1.41 1.41" }],
      ["path", { "d": "m19.07 4.93-1.41 1.41" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "sun" },
      /**
       * @component @name Sun
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI0IiAvPgogIDxwYXRoIGQ9Ik0xMiAydjIiIC8+CiAgPHBhdGggZD0iTTEyIDIwdjIiIC8+CiAgPHBhdGggZD0ibTQuOTMgNC45MyAxLjQxIDEuNDEiIC8+CiAgPHBhdGggZD0ibTE3LjY2IDE3LjY2IDEuNDEgMS40MSIgLz4KICA8cGF0aCBkPSJNMiAxMmgyIiAvPgogIDxwYXRoIGQ9Ik0yMCAxMmgyIiAvPgogIDxwYXRoIGQ9Im02LjM0IDE3LjY2LTEuNDEgMS40MSIgLz4KICA8cGF0aCBkPSJtMTkuMDcgNC45My0xLjQxIDEuNDEiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/sun
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function User($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["path", { "d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { "cx": "12", "cy": "7", "r": "4" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "user" },
      /**
       * @component @name User
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNMTkgMjF2LTJhNCA0IDAgMCAwLTQtNEg5YTQgNCAwIDAgMC00IDR2MiIgLz4KICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/user
       * @see https://lucide.dev/guide/packages/lucide-svelte - Documentation
       *
       * @param {Object} props - Lucide icons props and any valid SVG attribute
       * @returns {FunctionalComponent} Svelte component
       *
       */
      props,
      {
        iconNode,
        children: ($$renderer3) => {
          props.children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Alert($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      tone = "info",
      title,
      message,
      class: className,
      actions,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-alert", `st-alert--${tone}`, className].filter(Boolean).join(" ");
    const role = () => tone === "error" || tone === "warning" ? "alert" : "status";
    $$renderer2.push(`<section${attributes({ ...rest, class: clsx(classes()), role: role() }, "svelte-1vb1ni1")}><div class="st-alert__content svelte-1vb1ni1"><h2 class="st-alert__title svelte-1vb1ni1">${escape_html(title)}</h2> `);
    if (message) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="st-alert__message svelte-1vb1ni1">${escape_html(message)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    children?.($$renderer2);
    $$renderer2.push(`<!----></div> `);
    if (actions) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-alert__actions svelte-1vb1ni1">`);
      actions($$renderer2);
      $$renderer2.push(`<!----></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
function deriveInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function Header($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      title,
      label = "Application header",
      sticky = true,
      class: className,
      logo,
      navigation,
      actions,
      children,
      account,
      signInLabel = "Se connecter",
      accountMenu,
      accountMenuOpen = false,
      onAccountTriggerClick,
      onSignIn,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-header", sticky ? "st-header--sticky" : null, className].filter(Boolean).join(" ");
    const resolvedInitials = derived(() => account ? account.initials?.trim() || deriveInitials(account.name) : "");
    const hasPhoto = derived(() => Boolean(account?.avatarUrl));
    $$renderer2.push(`<header${attributes({ ...rest, class: clsx(classes()), "aria-label": label }, "svelte-1d3rqe2")}><div class="st-header__leading svelte-1d3rqe2">`);
    if (logo) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-header__logo svelte-1d3rqe2">`);
      logo($$renderer2);
      $$renderer2.push(`<!----></span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (title) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-header__title svelte-1d3rqe2">${escape_html(title)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> `);
    if (navigation) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<nav class="st-header__navigation svelte-1d3rqe2" aria-label="Primary">`);
      navigation($$renderer2);
      $$renderer2.push(`<!----></nav>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (actions || account || onSignIn) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-header__actions svelte-1d3rqe2">`);
      if (actions) {
        $$renderer2.push("<!--[0-->");
        actions($$renderer2);
        $$renderer2.push(`<!---->`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (account) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="st-header__account svelte-1d3rqe2"><button type="button" class="st-header__account-trigger svelte-1d3rqe2" aria-haspopup="menu"${attr("aria-expanded", accountMenuOpen)}${attr("aria-label", `Compte de ${account.name}`)}>`);
        if (hasPhoto()) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="st-header__avatar st-header__avatar--photo svelte-1d3rqe2" aria-hidden="true"><img class="st-header__avatar-image svelte-1d3rqe2"${attr("src", account.avatarUrl)} alt=""/></span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`<span class="st-header__avatar st-header__avatar--initials svelte-1d3rqe2" aria-hidden="true">${escape_html(resolvedInitials())}</span>`);
        }
        $$renderer2.push(`<!--]--> <span class="st-header__account-meta svelte-1d3rqe2"><span class="st-header__account-name svelte-1d3rqe2">${escape_html(account.name)}</span> `);
        if (account.email) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="st-header__account-email svelte-1d3rqe2">${escape_html(account.email)}</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></span> <svg class="st-header__account-caret svelte-1d3rqe2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg></button> `);
        if (accountMenu && accountMenuOpen) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="st-header__account-menu svelte-1d3rqe2" role="menu"${attr("aria-label", `Menu de ${account.name}`)}>`);
          accountMenu($$renderer2);
          $$renderer2.push(`<!----></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div>`);
      } else if (onSignIn) {
        $$renderer2.push("<!--[1-->");
        $$renderer2.push(`<button type="button" class="st-header__signin svelte-1d3rqe2">${escape_html(signInLabel)}</button>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (children) {
      $$renderer2.push("<!--[0-->");
      children($$renderer2);
      $$renderer2.push(`<!---->`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></header>`);
  });
}
function Badge($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      tone = "neutral",
      shape = "pill",
      size = "md",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => [
      "st-badge",
      `st-badge--${tone}`,
      `st-badge--${shape}`,
      `st-badge--${size}`,
      className
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<span${attributes({ ...rest, class: clsx(classes()) }, "svelte-pdgh8u")}>`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></span>`);
  });
}
function Button($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      variant = "primary",
      size = "md",
      disabled = false,
      type = "button",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => [
      "st-button",
      `st-button--${variant}`,
      `st-button--${size}`,
      className
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<button${attributes({ ...rest, class: clsx(classes()), type, disabled }, "svelte-121ausn")}>`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></button>`);
  });
}
function Card($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      interactive = false,
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-card", interactive && "st-card--interactive", className].filter(Boolean).join(" ");
    $$renderer2.push(`<section${attributes({ ...rest, class: clsx(classes()) }, "svelte-mt7xh")}>`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></section>`);
  });
}
function IconButton($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      "aria-label": ariaLabel,
      size = "md",
      variant = "ghost",
      type = "button",
      disabled = false,
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => [
      "st-iconButton",
      `st-iconButton--${size}`,
      `st-iconButton--${variant}`,
      className
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<button${attributes(
      {
        ...rest,
        class: clsx(classes()),
        type,
        disabled,
        "aria-label": ariaLabel
      },
      "svelte-iw4na2"
    )}>`);
    children($$renderer2);
    $$renderer2.push(`<!----></button>`);
  });
}
function Container($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      size = "lg",
      padding = true,
      as = "div",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => [
      "st-container",
      `st-container--${size}`,
      padding && "st-container--padded",
      className
    ].filter(Boolean).join(" "));
    element(
      $$renderer2,
      as,
      () => {
        $$renderer2.push(`${attributes({ ...rest, class: clsx(classes()) }, "svelte-lol6l6")}`);
      },
      () => {
        children?.($$renderer2);
        $$renderer2.push(`<!---->`);
      }
    );
  });
}
const SPACING_FALLBACK = {
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
const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline"
};
const JUSTIFY = {
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
  $$renderer.component(($$renderer2) => {
    let {
      direction = "row",
      gap,
      align,
      justify,
      wrap = false,
      inline = false,
      as = "div",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => ["st-flex", className].filter(Boolean).join(" "));
    element(
      $$renderer2,
      as,
      () => {
        $$renderer2.push(`${attributes({ ...rest, class: clsx(classes()) }, "svelte-94sbko", void 0, {
          display: inline ? "inline-flex" : "flex",
          "flex-direction": direction,
          "flex-wrap": wrap ? "wrap" : "nowrap",
          "align-items": alignValue(align),
          "justify-content": justifyValue(justify),
          gap: spacingToken(gap)
        })}`);
      },
      () => {
        children?.($$renderer2);
        $$renderer2.push(`<!---->`);
      }
    );
  });
}
let groupIdCounter = 0;
function nextGroupId() {
  groupIdCounter += 1;
  return `st-menu-group-${groupIdCounter}`;
}
function Menu($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      label,
      items,
      open = true,
      dismissOnSelect = false,
      class: className,
      dense = false,
      onselect,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-menu", dense ? "st-menu--dense" : null, className].filter(Boolean).join(" ");
    function isAction(item) {
      return item.kind === void 0 || item.kind === "item";
    }
    if (open) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div${attributes(
        {
          ...rest,
          class: clsx(classes()),
          role: "menu",
          "aria-label": label
        },
        "svelte-n7le8g"
      )}><!--[-->`);
      const each_array = ensure_array_like(items);
      for (let index = 0, $$length = each_array.length; index < $$length; index++) {
        let item = each_array[index];
        if (isAction(item)) {
          $$renderer2.push("<!--[0-->");
          const Icon2 = item.icon;
          $$renderer2.push(`<button${attr_class("st-menu__item svelte-n7le8g", void 0, { "st-menu__item--danger": item.danger })} type="button" role="menuitem"${attr("aria-disabled", item.disabled ? "true" : void 0)}${attr("disabled", item.disabled, true)}>`);
          if (Icon2) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="st-menu__itemIcon svelte-n7le8g" aria-hidden="true">`);
            if (typeof Icon2 === "string") {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`${escape_html(Icon2)}`);
            } else {
              $$renderer2.push("<!--[-1-->");
              if (Icon2) {
                $$renderer2.push("<!--[-->");
                Icon2($$renderer2, { size: 16, strokeWidth: 2 });
                $$renderer2.push("<!--]-->");
              } else {
                $$renderer2.push("<!--[!-->");
                $$renderer2.push("<!--]-->");
              }
            }
            $$renderer2.push(`<!--]--></span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> <span class="st-menu__itemLabel svelte-n7le8g">${escape_html(item.label)}</span></button>`);
        } else if (item.kind === "divider") {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`<div class="st-menu__divider svelte-n7le8g" role="separator" aria-hidden="true"></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          const groupId = nextGroupId();
          $$renderer2.push(`<div class="st-menu__group svelte-n7le8g"${attr("id", groupId)} role="presentation">${escape_html(item.label)}</div>`);
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
    bind_props($$props, { open });
  });
}
function MenuPopover($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      open = false,
      trigger,
      placement = "bottom-start",
      align,
      label,
      class: className,
      closeOnOutside = true,
      closeOnEscape = true,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    let top = 0;
    let left = 0;
    const classes = () => [
      "st-menuPopover",
      `st-menuPopover--${placement}`,
      null,
      null,
      className
    ].filter(Boolean).join(" ");
    if (open) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div${attributes(
        {
          ...rest,
          class: clsx(classes()),
          role: "dialog",
          "aria-label": label,
          style: `top: ${top}px; left: ${left}px;${""}`
        },
        "svelte-tp772b"
      )}>`);
      children?.($$renderer2);
      $$renderer2.push(`<!----></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
    bind_props($$props, { open });
  });
}
function IdentityButton($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      authState = "anonymous",
      user = null,
      mode = "icon",
      tone = "default",
      signInLabel = "Se connecter",
      accountLabel = "Compte",
      onSignIn,
      onSignOut,
      menu = []
    } = $$props;
    let triggerEl = null;
    let open = false;
    const initials = derived(() => user?.name ? user.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "");
    const authed = derived(() => authState === "authenticated");
    const menuItems = derived(() => [
      ...menu.map((e) => ({ label: e.label, value: e.href ?? e.label })),
      ...onSignOut ? [{ label: "Se déconnecter", value: "__signout" }] : []
    ]);
    function onMenuSelect(value) {
      open = false;
      if (value === "__signout") return onSignOut?.();
      const entry = menu.find((e) => (e.href ?? e.label) === value);
      if (entry?.onClick) entry.onClick();
      else if (entry?.href) location.href = entry.href;
    }
    function face($$renderer3) {
      if (authed() && user?.avatarSrc) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<img class="st-identityBtn__avatar svelte-tcpfp5"${attr("src", user.avatarSrc)} alt="" aria-hidden="true"/>`);
      } else if (authed() && initials()) {
        $$renderer3.push("<!--[1-->");
        $$renderer3.push(`<span class="st-identityBtn__initials svelte-tcpfp5" aria-hidden="true">${escape_html(initials())}</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        User($$renderer3, { size: 16, strokeWidth: 2.1, "aria-hidden": "true" });
      }
      $$renderer3.push(`<!--]-->`);
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<span${attr_class("st-identityBtn svelte-tcpfp5", void 0, { "st-identityBtn--onColor": tone === "onColor" })}>`);
      if (mode === "button") {
        $$renderer3.push("<!--[0-->");
        Button($$renderer3, {
          variant: authed() ? "ghost" : "secondary",
          size: "sm",
          onclick: () => authed() ? open = !open : onSignIn?.(),
          children: ($$renderer4) => {
            face($$renderer4);
            $$renderer4.push(`<!----> <span>${escape_html(authed() ? user?.name ?? accountLabel : signInLabel)}</span>`);
          },
          $$slots: { default: true }
        });
      } else if (mode === "menu") {
        $$renderer3.push("<!--[1-->");
        $$renderer3.push(`<span class="st-identityBtn__wrap svelte-tcpfp5">`);
        IconButton($$renderer3, {
          size: "sm",
          variant: "ghost",
          "aria-label": authed() ? accountLabel : signInLabel,
          onclick: () => open = !open,
          children: ($$renderer4) => {
            face($$renderer4);
          },
          $$slots: { default: true }
        });
        $$renderer3.push(`<!----></span> `);
        if (menuItems().length) {
          $$renderer3.push("<!--[0-->");
          MenuPopover($$renderer3, {
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
            children: ($$renderer4) => {
              Menu($$renderer4, {
                label: accountLabel,
                items: menuItems(),
                onselect: onMenuSelect
              });
            },
            $$slots: { default: true }
          });
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]-->`);
      } else {
        $$renderer3.push("<!--[-1-->");
        IconButton($$renderer3, {
          size: "sm",
          variant: "ghost",
          "aria-label": authed() ? accountLabel : signInLabel,
          onclick: () => authed() ? menuItems().length ? open = !open : void 0 : onSignIn?.(),
          children: ($$renderer4) => {
            face($$renderer4);
          },
          $$slots: { default: true }
        });
      }
      $$renderer3.push(`<!--]--></span>`);
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}
function AppShell($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      variant,
      config,
      topChrome,
      primaryRail,
      navigationPanel,
      main,
      contextPanel,
      utilityPanel,
      bottomPanel,
      children,
      mainId = "main",
      navigationLabel = "Workspace navigation",
      contextLabel = "Context panel",
      utilityLabel = "Utility panel",
      utilityMode = "reserve",
      utilitySide = "right",
      class: className
    } = $$props;
    const mode = derived(() => variant ?? (config ? "site" : "workspace"));
    const siteConfig = derived(() => config ?? {
      brand: { name: "Sentropic" },
      nav: [],
      theming: { themes: [], theme: "" }
    });
    const brand = derived(() => siteConfig().brand ?? { name: "Sentropic" });
    const nav = derived(() => Array.isArray(siteConfig().nav) ? siteConfig().nav : []);
    const t = derived(() => siteConfig().theming ?? { themes: [], theme: "" });
    const siteClasses = derived(() => ["st-shell", className].filter(Boolean).join(" "));
    const workspaceClasses = derived(() => ["st-appShell", "st-appShell--workspace", className].filter(Boolean).join(" "));
    const isActive = (item) => item.active != null ? item.active : siteConfig().activePath != null && (item.href === siteConfig().activePath || item.href !== "/" && (siteConfig().activePath ?? "").startsWith(item.href));
    const themeItems = derived(() => (t().themes ?? []).map((o) => ({ label: o.label, value: o.id })));
    const fwItems = derived(() => (siteConfig().frameworkSwitcher?.available ?? []).map((o) => ({ label: o.label, value: o.id })));
    const localeItems = derived(() => (siteConfig().locale?.available ?? []).map((o) => ({ label: o.label, value: o.code })));
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
    function logo($$renderer3) {
      $$renderer3.push(`<a class="st-shell__brand svelte-do0njo"${attr("href", brand().href ?? "/")}${attr("aria-label", brand().label ?? [brand().name, brand().productName].filter(Boolean).join(" "))}>`);
      if (brand().logoSrc) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<img class="st-shell__brandMark svelte-do0njo"${attr("src", brand().logoSrc)} alt="" aria-hidden="true"/>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> <span class="st-shell__brandCopy svelte-do0njo">`);
      if (brand().name) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="st-shell__brandName svelte-do0njo">${escape_html(brand().name)}</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (brand().productName) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="st-shell__brandProduct svelte-do0njo">${escape_html(brand().productName)}</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></span></a>`);
    }
    function navigation($$renderer3) {
      $$renderer3.push(`<nav class="st-shell__nav svelte-do0njo"${attr("aria-label", siteConfig().navLabel ?? "Navigation")}><!--[-->`);
      const each_array = ensure_array_like(nav());
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let item = each_array[$$index];
        $$renderer3.push(`<a class="st-shell__navLink svelte-do0njo"${attr("href", item.href)}${attr("aria-current", isActive(item) ? "page" : void 0)}>${escape_html(item.label)}</a>`);
      }
      $$renderer3.push(`<!--]--></nav>`);
    }
    function actions($$renderer3) {
      $$renderer3.push(`<div class="st-shell__actions svelte-do0njo">`);
      if (siteConfig().search?.enabled) {
        $$renderer3.push("<!--[0-->");
        Button($$renderer3, {
          variant: "secondary",
          size: "sm",
          class: "st-shell__search",
          onclick: () => siteConfig().search?.onSearch?.(""),
          children: ($$renderer4) => {
            Search($$renderer4, { size: 16, strokeWidth: 2.1, "aria-hidden": "true" });
            $$renderer4.push(`<!----> <span>${escape_html(siteConfig().search.placeholder ?? "Rechercher…")}</span> <kbd class="st-shell__kbd svelte-do0njo">/</kbd>`);
          },
          $$slots: { default: true }
        });
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (siteConfig().frameworkSwitcher?.enabled) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="st-shell__menuWrap svelte-do0njo">`);
        Button($$renderer3, {
          variant: "secondary",
          size: "sm",
          class: "st-shell__switch",
          onclick: () => fwOpen = !fwOpen,
          "aria-haspopup": "menu",
          "aria-expanded": fwOpen,
          children: ($$renderer4) => {
            Boxes($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!----><span>${escape_html(fwLabel())}</span>`);
            Chevron_down($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!---->`);
          },
          $$slots: { default: true }
        });
        $$renderer3.push(`<!----></span> `);
        MenuPopover($$renderer3, {
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
          children: ($$renderer4) => {
            Menu($$renderer4, {
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
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if ((t().themes ?? []).length) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="st-shell__menuWrap svelte-do0njo">`);
        Button($$renderer3, {
          variant: "secondary",
          size: "sm",
          class: "st-shell__switch",
          onclick: () => themeOpen = !themeOpen,
          "aria-haspopup": "menu",
          "aria-expanded": themeOpen,
          children: ($$renderer4) => {
            Palette($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!----><span>${escape_html(themeLabel())}</span>`);
            Chevron_down($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!---->`);
          },
          $$slots: { default: true }
        });
        $$renderer3.push(`<!----></span> `);
        MenuPopover($$renderer3, {
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
          children: ($$renderer4) => {
            Menu($$renderer4, {
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
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (t().colorMode) {
        $$renderer3.push("<!--[0-->");
        IconButton($$renderer3, {
          size: "sm",
          variant: "ghost",
          "aria-label": "Mode couleur",
          onclick: cycleColorMode,
          children: ($$renderer4) => {
            if (t().colorMode === "dark") {
              $$renderer4.push("<!--[0-->");
              Moon($$renderer4, { size: 16, "aria-hidden": "true" });
            } else {
              $$renderer4.push("<!--[-1-->");
              Sun($$renderer4, { size: 16, "aria-hidden": "true" });
            }
            $$renderer4.push(`<!--]-->`);
          },
          $$slots: { default: true }
        });
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (siteConfig().locale) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="st-shell__menuWrap svelte-do0njo">`);
        Button($$renderer3, {
          variant: "secondary",
          size: "sm",
          class: "st-shell__switch",
          onclick: () => localeOpen = !localeOpen,
          "aria-haspopup": "menu",
          "aria-expanded": localeOpen,
          children: ($$renderer4) => {
            Globe($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!----><span>${escape_html((siteConfig().locale.current ?? "").toUpperCase())}</span>`);
            Chevron_down($$renderer4, { size: 14, "aria-hidden": "true" });
            $$renderer4.push(`<!---->`);
          },
          $$slots: { default: true }
        });
        $$renderer3.push(`<!----></span> `);
        MenuPopover($$renderer3, {
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
          children: ($$renderer4) => {
            Menu($$renderer4, {
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
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (siteConfig().identity) {
        $$renderer3.push("<!--[0-->");
        IdentityButton($$renderer3, {
          mode: "icon",
          authState: siteConfig().identity.state,
          user: siteConfig().identity.user ?? null,
          signInLabel: siteConfig().identity.label ?? "Se connecter",
          onSignIn: () => siteConfig().identity?.onSignIn?.(),
          onSignOut: () => siteConfig().identity?.onSignOut?.(),
          menu: siteConfig().identity.menu ?? []
        });
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></div>`);
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      if (mode() === "workspace") {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<div${attr_class(clsx(workspaceClasses()), "svelte-do0njo")} data-st-app-shell-variant="workspace"${attr("data-utility-mode", utilityMode)}${attr("data-utility-side", utilitySide)}>`);
        if (topChrome) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div class="st-appShell__topChrome svelte-do0njo">`);
          topChrome($$renderer3);
          $$renderer3.push(`<!----></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div class="st-appShell__body svelte-do0njo">`);
        if (primaryRail) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<aside class="st-appShell__primaryRail svelte-do0njo" aria-label="Primary rail">`);
          primaryRail($$renderer3);
          $$renderer3.push(`<!----></aside>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (navigationPanel) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<aside class="st-appShell__navigationPanel svelte-do0njo"${attr("aria-label", navigationLabel)}>`);
          navigationPanel($$renderer3);
          $$renderer3.push(`<!----></aside>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <main class="st-appShell__main svelte-do0njo"${attr("id", mainId)}>`);
        if (main) {
          $$renderer3.push("<!--[0-->");
          main($$renderer3);
          $$renderer3.push(`<!---->`);
        } else if (children) {
          $$renderer3.push("<!--[1-->");
          children($$renderer3);
          $$renderer3.push(`<!---->`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></main> `);
        if (contextPanel) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<aside class="st-appShell__contextPanel svelte-do0njo"${attr("aria-label", contextLabel)}>`);
          contextPanel($$renderer3);
          $$renderer3.push(`<!----></aside>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (utilityPanel) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<aside class="st-appShell__utilityPanel svelte-do0njo"${attr("aria-label", utilityLabel)}>`);
          utilityPanel($$renderer3);
          $$renderer3.push(`<!----></aside>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></div> `);
        if (bottomPanel) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<section class="st-appShell__bottomPanel svelte-do0njo" aria-label="Workspace tools">`);
          bottomPanel($$renderer3);
          $$renderer3.push(`<!----></section>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        Header($$renderer3, {
          class: siteClasses(),
          label: siteConfig().brand?.label ?? "Navigation",
          logo,
          navigation,
          actions
        });
      }
      $$renderer3.push(`<!--]-->`);
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}

export { AppShell as A, Button as B, Container as C, Flex as F, Icon as I, Alert as a, Card as b, Badge as c };
//# sourceMappingURL=AppShell.js-6Pi87dO0.js.map
