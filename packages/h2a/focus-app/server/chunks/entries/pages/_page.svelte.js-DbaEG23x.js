import { a2 as head, a6 as attr_class, a7 as clsx, a3 as attr, a4 as escape_html, Z as derived, ad as run, ab as spread_props, a9 as ensure_array_like, aa as bind_props, a8 as attributes, ae as attr_style, af as props_id } from '../../chunks/index.js-laGHLarB.js';
import { A as AppShell, C as Container, I as Icon, a as Alert, F as Flex, b as Card, B as Button, c as Badge } from '../../chunks/AppShell.js-6Pi87dO0.js';
import '../../chunks/utils.js-C_3_iViC.js';
import '../../chunks/utils2.js-BQzn9ikS.js';

function Menu($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["path", { "d": "M4 5h16" }],
      ["path", { "d": "M4 12h16" }],
      ["path", { "d": "M4 19h16" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "menu" },
      /**
       * @component @name Menu
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNNCA1aDE2IiAvPgogIDxwYXRoIGQ9Ik00IDEyaDE2IiAvPgogIDxwYXRoIGQ9Ik00IDE5aDE2IiAvPgo8L3N2Zz4K) - https://lucide.dev/icons/menu
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
function X($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { $$slots, $$events, ...props } = $$props;
    const iconNode = [
      ["path", { "d": "M18 6 6 18" }],
      ["path", { "d": "m6 6 12 12" }]
    ];
    Icon($$renderer2, spread_props([
      { name: "x" },
      /**
       * @component @name X
       * @description Lucide SVG icon component, renders SVG Element with children.
       *
       * @preview ![img](data:image/svg+xml;base64,PHN2ZyAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogIHdpZHRoPSIyNCIKICBoZWlnaHQ9IjI0IgogIHZpZXdCb3g9IjAgMCAyNCAyNCIKICBmaWxsPSJub25lIgogIHN0cm9rZT0iIzAwMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDJweCIKICBzdHJva2Utd2lkdGg9IjIiCiAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogIHN0cm9rZS1saW5lam9pbj0icm91bmQiCj4KICA8cGF0aCBkPSJNMTggNiA2IDE4IiAvPgogIDxwYXRoIGQ9Im02IDYgMTIgMTIiIC8+Cjwvc3ZnPgo=) - https://lucide.dev/icons/x
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
let appHeaderIdCounter = 0;
function nextAppHeaderId() {
  return ++appHeaderIdCounter;
}
function AppHeader($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      compact = false,
      menuOpen = false,
      onMenuToggle,
      menuLabel = "Menu",
      drawerId,
      brandName,
      productName,
      logoSrc,
      logoAlt = "",
      brandHref = "/",
      brandLabel,
      logo,
      nav,
      actions,
      drawer,
      navAlign = "start",
      brandMode = "icon",
      class: className
    } = $$props;
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
    const barClasses = () => [
      "st-appHeader__bar",
      navAlign === "center" ? "st-appHeader__bar--navCenter" : null
    ].filter(Boolean).join(" ");
    const navClasses = () => [
      "st-appHeader__nav",
      navAlign === "center" ? "st-appHeader__nav--center" : null
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<header${attr_class(clsx(classes()), "svelte-w3i4hh")}><div${attr_class(clsx(barClasses()), "svelte-w3i4hh")}>`);
    if (logo) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-appHeader__logo svelte-w3i4hh">`);
      logo($$renderer2);
      $$renderer2.push(`<!----></div>`);
    } else if (hasDefaultBrand()) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<a class="st-appHeader__brand svelte-w3i4hh"${attr("href", brandHref)}${attr("aria-label", resolvedBrandLabel() || void 0)}>`);
      if (brandMode === "full") {
        $$renderer2.push("<!--[0-->");
        if (logoSrc) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<img class="st-appHeader__brandMark svelte-w3i4hh"${attr("src", logoSrc)}${attr("alt", logoAlt)}${attr("aria-hidden", logoAlt ? void 0 : "true")}/>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (brandName || productName) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="st-appHeader__brandCopy svelte-w3i4hh">`);
          if (brandName) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="st-appHeader__brandName svelte-w3i4hh">${escape_html(brandName)}</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (productName) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="st-appHeader__brandProduct svelte-w3i4hh">${escape_html(productName)}</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      } else {
        $$renderer2.push("<!--[-1-->");
        if (logoSrc) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<img class="st-appHeader__brandMark svelte-w3i4hh"${attr("src", logoSrc)}${attr("alt", logoAlt)}${attr("aria-hidden", logoAlt ? void 0 : "true")}/>`);
        } else if (brandBigramme()) {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`<span class="st-appHeader__brandIconWrap svelte-w3i4hh"><span class="st-appHeader__brandIcon svelte-w3i4hh" aria-hidden="true">${escape_html(brandBigramme())}</span></span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></a>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (!compact) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<nav${attr_class(clsx(navClasses()), "svelte-w3i4hh")} aria-label="Primary">`);
      if (nav) {
        $$renderer2.push("<!--[0-->");
        nav($$renderer2);
        $$renderer2.push(`<!---->`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></nav> <div class="st-appHeader__actions svelte-w3i4hh">`);
      if (actions) {
        $$renderer2.push("<!--[0-->");
        actions($$renderer2);
        $$renderer2.push(`<!---->`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="st-appHeader__burger svelte-w3i4hh"><button type="button" class="st-appHeader__burgerButton svelte-w3i4hh"${attr("aria-label", menuLabel)}${attr("aria-expanded", menuOpen)}${attr("aria-controls", resolvedDrawerId)} aria-haspopup="menu">`);
      if (menuOpen) {
        $$renderer2.push("<!--[0-->");
        X($$renderer2, {
          class: "st-appHeader__burgerIcon",
          size: 20,
          "aria-hidden": "true"
        });
      } else {
        $$renderer2.push("<!--[-1-->");
        Menu($$renderer2, {
          class: "st-appHeader__burgerIcon",
          size: 20,
          "aria-hidden": "true"
        });
      }
      $$renderer2.push(`<!--]--></button></div>`);
    }
    $$renderer2.push(`<!--]--></div></header> `);
    if (compact && menuOpen && drawer) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button type="button" class="st-appHeader__scrim svelte-w3i4hh"${attr("aria-label", menuLabel)}></button> <aside${attr("id", resolvedDrawerId)} class="st-appHeader__drawer svelte-w3i4hh">`);
      drawer($$renderer2);
      $$renderer2.push(`<!----></aside>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function ButtonGroup($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      orientation = "horizontal",
      attached = false,
      gap,
      size = "md",
      label,
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => [
      "st-buttonGroup",
      `st-buttonGroup--${orientation}`,
      attached ? "st-buttonGroup--attached" : null,
      className
    ].filter(Boolean).join(" "));
    const gapValue = derived(() => attached || gap == null ? null : `var(--st-spacing-${gap}, ${gap * 0.25}rem)`);
    $$renderer2.push(`<div${attributes(
      {
        ...rest,
        class: clsx(classes()),
        role: "group",
        "aria-label": label,
        "data-size": size
      },
      "svelte-1q19k9q",
      void 0,
      { gap: gapValue() }
    )}>`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></div>`);
  });
}
function Checkbox($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const uid = props_id($$renderer2);
    let {
      label,
      helperText,
      description,
      trailing,
      invalid = false,
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const descriptionId = `${uid}-description`;
    const describedBy = () => {
      if (!description) return rest["aria-describedby"];
      return [rest["aria-describedby"], descriptionId].filter(Boolean).join(" ");
    };
    const classes = () => [
      "st-choice",
      "st-choice--checkbox",
      description ? "st-choice--described" : null,
      className
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<label${attr_class(clsx(classes()), "svelte-1fxiqve")}><input${attributes(
      {
        ...rest,
        class: "st-choice__input",
        type: "checkbox",
        "aria-invalid": invalid ? "true" : void 0,
        "aria-describedby": describedBy()
      },
      "svelte-1fxiqve",
      void 0,
      void 0,
      4
    )}/> <span class="st-choice__content svelte-1fxiqve"><span class="st-choice__label svelte-1fxiqve">${escape_html(label)}</span> `);
    if (description) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-choice__description svelte-1fxiqve"${attr("id", descriptionId)}>${escape_html(description)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (helperText) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-choice__help svelte-1fxiqve">${escape_html(helperText)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></span> `);
    if (trailing) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-choice__trailing svelte-1fxiqve">`);
      trailing($$renderer2);
      $$renderer2.push(`<!----></span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></label>`);
  });
}
function ContentSwitcher($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      items,
      value = "",
      label,
      size = "md",
      onchange,
      class: className
    } = $$props;
    const groupClasses = () => [
      "st-contentSwitcher",
      `st-contentSwitcher--${size}`,
      className
    ].filter(Boolean).join(" ");
    $$renderer2.push(`<div${attr_class(clsx(groupClasses()), "svelte-a920rh")} role="tablist"${attr("aria-label", label)}><!--[-->`);
    const each_array = ensure_array_like(items);
    for (let i = 0, $$length = each_array.length; i < $$length; i++) {
      let item = each_array[i];
      const selected = value === item.value;
      $$renderer2.push(`<button type="button"${attr_class("st-contentSwitcher__option svelte-a920rh", void 0, { "st-contentSwitcher__option--selected": selected })} role="tab"${attr("aria-selected", selected ? "true" : "false")}${attr("aria-disabled", item.disabled ? "true" : void 0)}${attr("tabindex", selected ? 0 : -1)}${attr("disabled", item.disabled, true)}>${escape_html(item.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { value });
  });
}
const cellDecorationLabel = {
  positive: "tendance positive",
  negative: "tendance négative",
  warning: "avertissement",
  info: "information",
  neutral: "neutre"
};
function cellDecorationClass(intent) {
  return `st-cell--intent-${intent}`;
}
const cellDecorationIconNodes = {
  "trending-up": [
    ["path", { d: "M16 7h6v6" }],
    ["path", { d: "m22 7-8.5 8.5-5-5L2 17" }]
  ],
  "trending-down": [
    ["path", { d: "M16 17h6v-6" }],
    ["path", { d: "m22 17-8.5-8.5-5 5L2 7" }]
  ],
  "arrow-up": [
    ["path", { d: "m5 12 7-7 7 7" }],
    ["path", { d: "M12 19V5" }]
  ],
  "arrow-down": [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "m19 12-7 7-7-7" }]
  ],
  "triangle-alert": [
    ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M12 17h.01" }]
  ],
  info: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M12 16v-4" }],
    ["path", { d: "M12 8h.01" }]
  ],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  x: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }]
  ],
  minus: [["path", { d: "M5 12h14" }]],
  "circle-check": [
    ["path", { d: "M21.801 10A10 10 0 1 1 17 3.335" }],
    ["path", { d: "m9 11 3 3L22 4" }]
  ],
  "circle-alert": [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["line", { x1: 12, x2: 12, y1: 8, y2: 12 }],
    ["line", { x1: 12, x2: 12.01, y1: 16, y2: 16 }]
  ],
  "circle-x": [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }]
  ],
  flame: [["path", { d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" }]]
};
function cellDecorationIcon(icon) {
  if (icon != null && Object.prototype.hasOwnProperty.call(cellDecorationIconNodes, icon)) {
    return cellDecorationIconNodes[icon];
  }
  return null;
}
function CellDecorationIcon($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { icon } = $$props;
    const nodes = derived(() => cellDecorationIcon(icon));
    if (nodes()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<svg class="st-cell__icon svelte-rs3fow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><!--[-->`);
      const each_array = ensure_array_like(nodes());
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let [tag, attrs] = each_array[$$index];
        if (tag === "path") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<path${attributes({ ...attrs }, "svelte-rs3fow", void 0, void 0, 3)}></path>`);
        } else if (tag === "circle") {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`<circle${attributes({ ...attrs }, "svelte-rs3fow", void 0, void 0, 3)}></circle>`);
        } else if (tag === "line") {
          $$renderer2.push("<!--[2-->");
          $$renderer2.push(`<line${attributes({ ...attrs }, "svelte-rs3fow", void 0, void 0, 3)}></line>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></svg>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function DataTable($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      columns,
      rows,
      decorations,
      caption,
      size = "md",
      selectable = "none",
      selectedIds = [],
      sortable = true,
      sortBy = null,
      pageSize,
      page = 1,
      locale = "fr-FR",
      selectAllLabel = "Select all rows",
      selectRowLabel = "Select row",
      sortAscendingLabel = "Sorted ascending",
      sortDescendingLabel = "Sorted descending",
      sortNoneLabel = "Not sorted",
      previousLabel,
      nextLabel,
      paginationLabel = "Pagination",
      rangeLabel = ({ start, end, total }) => `${start}–${end} of ${total}`,
      emptyLabel = "No data",
      onRowClick,
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const isFr = derived(() => locale.toLowerCase().startsWith("fr"));
    const resolvedPreviousLabel = derived(() => previousLabel ?? (isFr() ? "Précédent" : "Previous"));
    const resolvedNextLabel = derived(() => nextLabel ?? (isFr() ? "Suivant" : "Next"));
    const classes = () => ["st-dataTable", `st-dataTable--${size}`, className].filter(Boolean).join(" ");
    const isColumnSortable = (column) => sortable && column.sortable !== false;
    const sortedRows = derived(() => {
      if (!sortBy) return rows;
      const { key, direction } = sortBy;
      const factor = direction === "asc" ? 1 : -1;
      const copy = [...rows];
      copy.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") {
          return (av - bv) * factor;
        }
        const as = String(av);
        const bs = String(bv);
        return as.localeCompare(bs, void 0, { numeric: true, sensitivity: "base" }) * factor;
      });
      return copy;
    });
    const pageCount = derived(() => pageSize && pageSize > 0 ? Math.max(1, Math.ceil(sortedRows().length / pageSize)) : 1);
    const safePage = derived(() => Math.min(Math.max(1, page), pageCount()));
    const visibleRows = derived(() => {
      if (!pageSize || pageSize <= 0) return sortedRows();
      const start = (safePage() - 1) * pageSize;
      return sortedRows().slice(start, start + pageSize);
    });
    const range = derived(() => {
      if (!pageSize || pageSize <= 0) {
        return {
          start: sortedRows().length === 0 ? 0 : 1,
          end: sortedRows().length,
          total: sortedRows().length
        };
      }
      if (sortedRows().length === 0) return { start: 0, end: 0, total: 0 };
      const start = (safePage() - 1) * pageSize + 1;
      const end = Math.min(safePage() * pageSize, sortedRows().length);
      return { start, end, total: sortedRows().length };
    });
    const allVisibleSelected = derived(() => selectable === "multiple" && visibleRows().length > 0 && visibleRows().every((row) => selectedIds.includes(row.id)));
    const someVisibleSelected = derived(() => selectable === "multiple" && visibleRows().some((row) => selectedIds.includes(row.id)) && !allVisibleSelected());
    function ariaSortFor(column) {
      if (!isColumnSortable(column)) return void 0;
      if (sortBy?.key !== column.key) return "none";
      return sortBy.direction === "asc" ? "ascending" : "descending";
    }
    function alignClass(align) {
      if (align === "center") return "st-dataTable__cell--center";
      if (align === "end") return "st-dataTable__cell--end";
      return null;
    }
    function cellValue(row, key) {
      return String(row[key] ?? "");
    }
    function resolveDecoration(row, column) {
      const fromMap = decorations?.[row.id]?.[column.key];
      if (fromMap) return fromMap;
      if (column.cellDecoration) {
        return column.cellDecoration(row, row[column.key], column.key) ?? null;
      }
      return null;
    }
    function cellClass(column, decoration) {
      return [
        alignClass(column.align),
        decoration && "st-cell",
        decoration && cellDecorationClass(decoration.intent)
      ].filter(Boolean).join(" ") || void 0;
    }
    $$renderer2.push(`<div class="st-dataTable-wrap svelte-13369qn"><table${attributes({ ...rest, class: clsx(classes()) }, "svelte-13369qn")}>`);
    if (caption) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<caption class="svelte-13369qn">${escape_html(caption)}</caption>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--><thead><tr>`);
    if (selectable === "multiple") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<th scope="col" class="st-dataTable__select svelte-13369qn"><label class="st-dataTable__selectLabel svelte-13369qn"><input type="checkbox"${attr("checked", allVisibleSelected(), true)}${attr("indeterminate", someVisibleSelected(), true)}${attr("aria-label", selectAllLabel)} class="svelte-13369qn"/> <span class="st-visually-hidden svelte-13369qn">${escape_html(selectAllLabel)}</span></label></th>`);
    } else if (selectable === "single") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<th scope="col" class="st-dataTable__select svelte-13369qn"${attr("aria-label", selectRowLabel)}></th>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--><!--[-->`);
    const each_array = ensure_array_like(columns);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let column = each_array[$$index];
      const sortState = ariaSortFor(column);
      const sortableCol = isColumnSortable(column);
      $$renderer2.push(`<th scope="col"${attr_class(clsx([alignClass(column.align)].filter(Boolean).join(" ") || void 0), "svelte-13369qn")}${attr("aria-sort", sortState)}${attr_style(column.width ? `width: ${column.width}` : void 0)}>`);
      if (sortableCol) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<button type="button" class="st-dataTable__sortBtn svelte-13369qn"><span>${escape_html(column.label)}</span> <span class="st-dataTable__sortIcon svelte-13369qn" aria-hidden="true">`);
        if (sortState === "ascending") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`↑`);
        } else if (sortState === "descending") {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`↓`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`↕`);
        }
        $$renderer2.push(`<!--]--></span> <span class="st-visually-hidden svelte-13369qn">`);
        if (sortState === "ascending") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`${escape_html(sortAscendingLabel)}`);
        } else if (sortState === "descending") {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`${escape_html(sortDescendingLabel)}`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`${escape_html(sortNoneLabel)}`);
        }
        $$renderer2.push(`<!--]--></span></button>`);
      } else {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`${escape_html(column.label)}`);
      }
      $$renderer2.push(`<!--]--></th>`);
    }
    $$renderer2.push(`<!--]--></tr></thead><tbody class="svelte-13369qn">`);
    if (visibleRows().length === 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<tr class="svelte-13369qn"><td class="st-dataTable__empty svelte-13369qn"${attr("colspan", columns.length + (selectable !== "none" ? 1 : 0))}>${escape_html(emptyLabel)}</td></tr>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<!--[-->`);
      const each_array_1 = ensure_array_like(visibleRows());
      for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
        let row = each_array_1[$$index_2];
        const isSelected = selectedIds.includes(row.id);
        $$renderer2.push(`<tr${attr_class("svelte-13369qn", void 0, {
          "st-dataTable__row--selected": isSelected,
          "st-dataTable__row--clickable": Boolean(onRowClick)
        })}>`);
        if (selectable === "multiple") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<td class="st-dataTable__select svelte-13369qn"><label class="st-dataTable__selectLabel svelte-13369qn"><input type="checkbox"${attr("checked", isSelected, true)}${attr("aria-label", `${selectRowLabel} ${row.id}`)} class="svelte-13369qn"/> <span class="st-visually-hidden svelte-13369qn">${escape_html(selectRowLabel)}</span></label></td>`);
        } else if (selectable === "single") {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`<td class="st-dataTable__select svelte-13369qn"><label class="st-dataTable__selectLabel svelte-13369qn"><input type="radio" name="st-dataTable-select"${attr("checked", isSelected, true)}${attr("aria-label", `${selectRowLabel} ${row.id}`)} class="svelte-13369qn"/> <span class="st-visually-hidden svelte-13369qn">${escape_html(selectRowLabel)}</span></label></td>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--><!--[-->`);
        const each_array_2 = ensure_array_like(columns);
        for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
          let column = each_array_2[$$index_1];
          const decoration = resolveDecoration(row, column);
          $$renderer2.push(`<td${attr_class(clsx(cellClass(column, decoration)), "svelte-13369qn")}${attr("title", decoration ? cellDecorationLabel[decoration.intent] : void 0)}>`);
          if (decoration) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="st-cell__content svelte-13369qn">`);
            CellDecorationIcon($$renderer2, { icon: decoration.icon });
            $$renderer2.push(`<!----> <span>`);
            if (column.cell) {
              $$renderer2.push("<!--[0-->");
              column.cell($$renderer2, row, column);
              $$renderer2.push(`<!---->`);
            } else {
              $$renderer2.push("<!--[-1-->");
              $$renderer2.push(`${escape_html(cellValue(row, column.key))}`);
            }
            $$renderer2.push(`<!--]--></span> <span class="st-visually-hidden svelte-13369qn">${escape_html(cellDecorationLabel[decoration.intent])}</span></span>`);
          } else if (column.cell) {
            $$renderer2.push("<!--[1-->");
            column.cell($$renderer2, row, column);
            $$renderer2.push(`<!---->`);
          } else {
            $$renderer2.push("<!--[-1-->");
            $$renderer2.push(`${escape_html(cellValue(row, column.key))}`);
          }
          $$renderer2.push(`<!--]--></td>`);
        }
        $$renderer2.push(`<!--]--></tr>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></tbody></table> `);
    if (pageSize && pageSize > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-dataTable__footer svelte-13369qn"><span class="st-dataTable__range svelte-13369qn" aria-live="polite">${escape_html(rangeLabel(range()))}</span> <nav class="st-dataTable__pager svelte-13369qn"${attr("aria-label", paginationLabel)}><button type="button" class="st-dataTable__pagerBtn svelte-13369qn"${attr("disabled", safePage() <= 1, true)}>${escape_html(resolvedPreviousLabel())}</button> <span class="st-dataTable__pagerStatus svelte-13369qn" aria-live="polite">${escape_html(safePage())} / ${escape_html(pageCount())}</span> <button type="button" class="st-dataTable__pagerBtn svelte-13369qn"${attr("disabled", safePage() >= pageCount(), true)}>${escape_html(resolvedNextLabel())}</button></nav></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { selectedIds, sortBy, page });
  });
}
function EmptyState($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      title,
      message,
      class: className,
      action,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-empty-state", className].filter(Boolean).join(" ");
    $$renderer2.push(`<section${attributes({ ...rest, class: clsx(classes()) }, "svelte-1irw8xl")}><div class="st-empty-state__content svelte-1irw8xl"><h2 class="st-empty-state__title svelte-1irw8xl">${escape_html(title)}</h2> `);
    if (message) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="st-empty-state__message svelte-1irw8xl">${escape_html(message)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    children?.($$renderer2);
    $$renderer2.push(`<!----></div> `);
    if (action) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-empty-state__action svelte-1irw8xl">`);
      action($$renderer2);
      $$renderer2.push(`<!----></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
function subjectCell($$renderer, row) {
  $$renderer.push(`<div><div style="font-weight:600; line-height:1.35">${escape_html(row.subject)}</div> `);
  if (row.gate) {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<div style="font-size:.82em; opacity:.72; margin-top:3px">${escape_html(row.gate)}</div>`);
  } else {
    $$renderer.push("<!--[-1-->");
  }
  $$renderer.push(`<!--]--> `);
  if (row.wp) {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<div style="font-size:.75em; opacity:.5; margin-top:3px">${escape_html(row.wp)}</div>`);
  } else {
    $$renderer.push("<!--[-1-->");
  }
  $$renderer.push(`<!--]--></div>`);
}
function actionCell($$renderer, row) {
  $$renderer.push(`<div><div>${escape_html(row.action)}</div> `);
  if (row.fanIn) {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<div style="font-size:.78em; opacity:.7; margin-top:3px">Débloque ${escape_html(row.fanIn)} autre(s)</div>`);
  } else {
    $$renderer.push("<!--[-1-->");
  }
  $$renderer.push(`<!--]--></div>`);
}
function actorCell($$renderer, row) {
  Flex($$renderer, {
    direction: "column",
    gap: 1,
    align: "start",
    children: ($$renderer2) => {
      $$renderer2.push(`<span>${escape_html(row.actor)}</span> `);
      Badge($$renderer2, {
        tone: row.nature === "Décision" ? "info" : "neutral",
        size: "sm",
        children: ($$renderer3) => {
          $$renderer3.push(`<!---->${escape_html(row.nature)}`);
        },
        $$slots: { default: true }
      });
      $$renderer2.push(`<!---->`);
    },
    $$slots: { default: true }
  });
}
function doneTitleCell($$renderer, row) {
  $$renderer.push(`<div><div style="line-height:1.35">${escape_html(row.title)}</div> `);
  if (row.summary) {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<div style="font-size:.8em; opacity:.72; margin-top:3px; line-height:1.35">${escape_html(row.summary)}</div>`);
  } else {
    $$renderer.push("<!--[-1-->");
  }
  $$renderer.push(`<!--]--> `);
  if (row.acceptance) {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<div${attr_style(`font-size:.76em; margin-top:3px; opacity:.7; color:${row.acceptance.includes("échec") ? "var(--st-color-danger-fg, #c0392b)" : "inherit"}`)}>${escape_html(row.acceptance)}</div>`);
  } else {
    $$renderer.push("<!--[-1-->");
  }
  $$renderer.push(`<!--]--></div>`);
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const focus = data.focus;
    function badgeTone(t) {
      return {
        critical: "error",
        warning: "warning",
        info: "info",
        neutral: "neutral",
        positive: "success"
      }[t];
    }
    const todos = focus.ok ? focus.todos : [];
    const precos = focus.ok ? focus.precos : [];
    const decisions = focus.ok ? focus.decisions : [];
    const done = focus.ok ? focus.done : [];
    const counts = focus.ok ? focus.counts : { done: 0, todo: 0, decisions: 0 };
    const keystone = focus.ok ? focus.keystone : void 0;
    const repo = focus.ok ? focus.repo : "";
    const lastReleaseAt = focus.ok ? focus.lastReleaseAt : void 0;
    const allWps = [
      ...new Set([...todos, ...done].map((r) => r.wp).filter((w) => !!w))
    ].sort((a, b) => a.localeCompare(b, void 0, { numeric: true }));
    let wpFilter = "tous";
    const matchWp = (w) => wpFilter === "tous" || w === wpFilter;
    const todosShown = derived(() => todos.filter((t) => matchWp(t.wp)));
    const launchableIds = derived(() => todosShown().filter((t) => t.launchable).map((t) => t.id));
    let period = "mois";
    function withinPeriod(iso) {
      if (period === "tout") return true;
      if (!iso) return false;
      if (period === "dev") return lastReleaseAt ? Date.parse(iso) >= Date.parse(lastReleaseAt) : false;
      const days = (Date.now() - Date.parse(iso)) / 864e5;
      return period === "jour" ? days < 1 : period === "semaine" ? days < 7 : days < 31;
    }
    const periodItems = [
      { value: "jour", label: "Jour" },
      { value: "semaine", label: "Semaine" },
      { value: "mois", label: "Mois" },
      ...lastReleaseAt ? [{ value: "dev", label: "Depuis dev" }] : [],
      { value: "tout", label: "Tout" }
    ];
    const doneShown = derived(() => done.filter((d) => withinPeriod(d.doneAt) && matchWp(d.wp)));
    let selected = [];
    let launching = false;
    let launchResult = null;
    function toggle(id, on) {
      if (on) selected = selected.includes(id) ? selected : [...selected, id];
      else selected = selected.filter((x) => x !== id);
    }
    const selectAll = () => selected = [...launchableIds()];
    const clearSel = () => selected = [];
    async function launch() {
      if (selected.length === 0) return;
      launching = true;
      launchResult = null;
      try {
        const res = await fetch("/api/actions/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: selected })
        });
        launchResult = await res.json();
      } catch (e) {
        launchResult = { ok: false, error: String(e) };
      } finally {
        launching = false;
      }
    }
    const todoColumns = derived(() => [
      {
        key: "sel",
        label: "",
        width: "3.25rem",
        sortable: false,
        cell: selCell
      },
      { key: "subject", label: "Sujet", cell: subjectCell },
      { key: "action", label: "Action concrète", cell: actionCell },
      {
        key: "actor",
        label: "Acteur",
        width: "11rem",
        cell: actorCell
      },
      {
        key: "badge",
        label: "Priorité",
        width: "8.5rem",
        sortable: false,
        cell: prioCell
      }
    ]);
    const doneColumns = [
      { key: "title", label: "Sujet", cell: doneTitleCell },
      { key: "wp", label: "WP", width: "6rem", sortable: true },
      { key: "kind", label: "Type", width: "7.5rem", sortable: true },
      { key: "ago", label: "Réalisé", width: "8rem" }
    ];
    let injecting = null;
    let injectResult = {};
    async function injectDecision(id) {
      injecting = id;
      try {
        const res = await fetch("/api/decisions/inject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id })
        });
        injectResult = { ...injectResult, [id]: await res.json() };
      } catch (e) {
        injectResult = { ...injectResult, [id]: { ok: false, error: String(e) } };
      } finally {
        injecting = null;
      }
    }
    function selCell($$renderer3, row) {
      if (row.launchable) {
        $$renderer3.push("<!--[0-->");
        Checkbox($$renderer3, {
          label: `Sélectionner : ${row.subject}`,
          checked: selected.includes(row.id),
          onchange: (e) => toggle(row.id, e.currentTarget.checked)
        });
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`<span title="Non lançable par un sous-agent (requiert un humain ou un partenaire)" style="opacity:.4">—</span>`);
      }
      $$renderer3.push(`<!--]-->`);
    }
    function prioCell($$renderer3, row) {
      Badge($$renderer3, {
        tone: badgeTone(row.badge.tone),
        children: ($$renderer4) => {
          $$renderer4.push(`<!---->${escape_html(row.badge.label)}`);
        },
        $$slots: { default: true }
      });
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      head("1uha8ag", $$renderer3, ($$renderer4) => {
        $$renderer4.title(($$renderer5) => {
          $$renderer5.push(`<title>Focus · Suivi</title>`);
        });
      });
      {
        let topChrome = function($$renderer4) {
          {
            let actions = function($$renderer5) {
              if (focus.ok) {
                $$renderer5.push("<!--[0-->");
                Flex($$renderer5, {
                  gap: 2,
                  align: "center",
                  wrap: true,
                  children: ($$renderer6) => {
                    Badge($$renderer6, {
                      tone: "neutral",
                      size: "sm",
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!---->Projet : ${escape_html(repo)}`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> <span style="font-size:.78em; opacity:.6">commit ${escape_html(focus.baselineCommit.slice(0, 7))}</span>`);
                  },
                  $$slots: { default: true }
                });
              } else {
                $$renderer5.push("<!--[-1-->");
              }
              $$renderer5.push(`<!--]-->`);
            };
            AppHeader($$renderer4, {
              brandName: "Focus",
              productName: "Suivi & décision",
              brandMode: "full",
              actions
            });
          }
        }, main = function($$renderer4) {
          Container($$renderer4, {
            size: "xl",
            padding: true,
            children: ($$renderer5) => {
              $$renderer5.push(`<div class="page svelte-1uha8ag">`);
              if (!focus.ok) {
                $$renderer5.push("<!--[0-->");
                Alert($$renderer5, {
                  tone: "error",
                  title: "Impossible de charger le suivi",
                  message: focus.error
                });
              } else {
                $$renderer5.push("<!--[-1-->");
                Flex($$renderer5, {
                  gap: 3,
                  wrap: true,
                  children: ($$renderer6) => {
                    Card($$renderer6, {
                      children: ($$renderer7) => {
                        $$renderer7.push(`<div class="stat svelte-1uha8ag"><div class="stat-n svelte-1uha8ag">${escape_html(counts.done)}</div><div class="stat-l svelte-1uha8ag">Faits</div></div>`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> `);
                    Card($$renderer6, {
                      children: ($$renderer7) => {
                        $$renderer7.push(`<div class="stat svelte-1uha8ag"><div class="stat-n svelte-1uha8ag">${escape_html(counts.todo)}</div><div class="stat-l svelte-1uha8ag">À faire</div></div>`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> `);
                    Card($$renderer6, {
                      children: ($$renderer7) => {
                        $$renderer7.push(`<div class="stat svelte-1uha8ag"><div class="stat-n svelte-1uha8ag">${escape_html(counts.decisions)}</div><div class="stat-l svelte-1uha8ag">Décisions</div></div>`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> `);
                if (allWps.length) {
                  $$renderer5.push("<!--[0-->");
                  $$renderer5.push(`<div class="wpbar svelte-1uha8ag"><span class="wplbl svelte-1uha8ag">Workpackage :</span> `);
                  Button($$renderer5, {
                    size: "sm",
                    variant: wpFilter === "tous" ? "primary" : "ghost",
                    onclick: () => wpFilter = "tous",
                    children: ($$renderer6) => {
                      $$renderer6.push(`<!---->Tous`);
                    },
                    $$slots: { default: true }
                  });
                  $$renderer5.push(`<!----> <!--[-->`);
                  const each_array = ensure_array_like(allWps);
                  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
                    let wp = each_array[$$index];
                    Button($$renderer5, {
                      size: "sm",
                      variant: wpFilter === wp ? "primary" : "ghost",
                      onclick: () => wpFilter = wp,
                      children: ($$renderer6) => {
                        $$renderer6.push(`<!---->${escape_html(wp)}`);
                      },
                      $$slots: { default: true }
                    });
                  }
                  $$renderer5.push(`<!--]--></div>`);
                } else {
                  $$renderer5.push("<!--[-1-->");
                }
                $$renderer5.push(`<!--]--> <section class="svelte-1uha8ag">`);
                Flex($$renderer5, {
                  align: "center",
                  justify: "between",
                  wrap: true,
                  gap: 3,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<h2 class="sec svelte-1uha8ag" style="margin:0">Fait <span class="sec-n svelte-1uha8ag">(${escape_html(doneShown().length)})</span></h2> `);
                    ContentSwitcher($$renderer6, {
                      items: periodItems,
                      label: "Période des faits",
                      get value() {
                        return period;
                      },
                      set value($$value) {
                        period = $$value;
                        $$settled = false;
                      }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> <div class="sp svelte-1uha8ag"></div> `);
                if (doneShown().length) {
                  $$renderer5.push("<!--[0-->");
                  $$renderer5.push(`<div class="tscroll svelte-1uha8ag">`);
                  DataTable($$renderer5, {
                    columns: doneColumns,
                    rows: doneShown(),
                    pageSize: 8,
                    emptyLabel: "Rien sur cette période"
                  });
                  $$renderer5.push(`<!----></div>`);
                } else {
                  $$renderer5.push("<!--[-1-->");
                  EmptyState($$renderer5, {
                    title: "Rien de terminé sur cette période",
                    message: "Élargis la période (Semaine / Mois / Tout)."
                  });
                }
                $$renderer5.push(`<!--]--></section> <section class="svelte-1uha8ag"><h2 class="sec svelte-1uha8ag">À faire <span class="sec-n svelte-1uha8ag">(${escape_html(wpFilter === "tous" ? counts.todo : todosShown().length)})</span> `);
                if (wpFilter !== "tous") {
                  $$renderer5.push("<!--[0-->");
                  $$renderer5.push(`<span class="sec-n svelte-1uha8ag">· ${escape_html(wpFilter)}</span>`);
                } else {
                  $$renderer5.push("<!--[-1-->");
                }
                $$renderer5.push(`<!--]--></h2> `);
                if (launchResult) {
                  $$renderer5.push("<!--[0-->");
                  if (launchResult.ok) {
                    $$renderer5.push("<!--[0-->");
                    {
                      let actions = function($$renderer6) {
                        Button($$renderer6, {
                          size: "sm",
                          variant: "ghost",
                          onclick: () => launchResult = null,
                          children: ($$renderer7) => {
                            $$renderer7.push(`<!---->Fermer`);
                          },
                          $$slots: { default: true }
                        });
                      };
                      Alert($$renderer5, {
                        tone: launchResult.rejected?.length ? "warning" : "success",
                        title: `${launchResult.accepted.length} action(s) acceptée(s)${launchResult.rejected?.length ? `, ${launchResult.rejected.length} refusée(s)` : ""}`,
                        message: launchResult.note,
                        actions,
                        $$slots: { actions: true }
                      });
                    }
                    $$renderer5.push(`<!----> <div class="sp svelte-1uha8ag"></div>`);
                  } else {
                    $$renderer5.push("<!--[-1-->");
                    Alert($$renderer5, {
                      tone: "error",
                      title: "Échec du lancement",
                      message: launchResult.error
                    });
                    $$renderer5.push(`<!----> <div class="sp svelte-1uha8ag"></div>`);
                  }
                  $$renderer5.push(`<!--]-->`);
                } else {
                  $$renderer5.push("<!--[-1-->");
                }
                $$renderer5.push(`<!--]--> `);
                Flex($$renderer5, {
                  align: "center",
                  justify: "between",
                  wrap: true,
                  gap: 3,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<div style="opacity:.8; font-size:.9em">${escape_html(selected.length)} sélectionnée(s) sur ${escape_html(launchableIds().length)} lançable(s)</div> `);
                    ButtonGroup($$renderer6, {
                      label: "Actions groupées",
                      children: ($$renderer7) => {
                        Button($$renderer7, {
                          variant: "secondary",
                          onclick: selectAll,
                          disabled: launchableIds().length === 0,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<!---->Tout sélectionner`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        Button($$renderer7, {
                          variant: "ghost",
                          onclick: clearSel,
                          disabled: selected.length === 0,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<!---->Vider`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        Button($$renderer7, {
                          variant: "primary",
                          onclick: launch,
                          disabled: selected.length === 0 || launching,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<!---->${escape_html(launching ? "Lancement…" : `Lancer la sélection (${selected.length})`)}`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!---->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> <div class="sp svelte-1uha8ag"></div> <div class="tscroll svelte-1uha8ag">`);
                DataTable($$renderer5, {
                  columns: todoColumns(),
                  rows: todosShown(),
                  caption: "Actions à faire",
                  emptyLabel: "Aucune action ouverte"
                });
                $$renderer5.push(`<!----></div></section> <section class="svelte-1uha8ag"><h2 class="sec svelte-1uha8ag">Leviers — les coups à plus fort effet</h2> `);
                if (keystone) {
                  $$renderer5.push("<!--[0-->");
                  Alert($$renderer5, {
                    tone: "warning",
                    title: `Point de passage : ${keystone.title}`,
                    message: `Bloque ${keystone.blocks} autre(s) tâche(s) — le traiter débloque le plus de travail.`
                  });
                  $$renderer5.push(`<!----> <div class="sp svelte-1uha8ag"></div>`);
                } else {
                  $$renderer5.push("<!--[-1-->");
                }
                $$renderer5.push(`<!--]--> `);
                Card($$renderer5, {
                  children: ($$renderer6) => {
                    $$renderer6.push(`<div style="padding:1rem 1.25rem">`);
                    Flex($$renderer6, {
                      direction: "column",
                      gap: 3,
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!--[-->`);
                        const each_array_1 = ensure_array_like(precos);
                        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
                          let p = each_array_1[$$index_1];
                          $$renderer7.push(`<div>`);
                          Flex($$renderer7, {
                            gap: 2,
                            align: "center",
                            wrap: true,
                            children: ($$renderer8) => {
                              Badge($$renderer8, {
                                tone: badgeTone(p.badge.tone),
                                children: ($$renderer9) => {
                                  $$renderer9.push(`<!---->${escape_html(p.badge.label)}`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!----> <strong>${escape_html(p.title)}</strong>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> <div style="opacity:.75; font-size:.9em; margin-top:3px">${escape_html(p.why)} · ${escape_html(p.action)} · ${escape_html(p.actor)}</div></div>`);
                        }
                        $$renderer7.push(`<!--]-->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----></div>`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></section> <section class="svelte-1uha8ag"><h2 class="sec svelte-1uha8ag">Décisions <span class="sec-n svelte-1uha8ag">(${escape_html(counts.decisions)})</span></h2> `);
                if (decisions.length === 0) {
                  $$renderer5.push("<!--[0-->");
                  EmptyState($$renderer5, {
                    title: "Aucune décision en attente",
                    message: "Rien à trancher pour le moment."
                  });
                } else {
                  $$renderer5.push("<!--[-1-->");
                  Flex($$renderer5, {
                    direction: "column",
                    gap: 3,
                    children: ($$renderer6) => {
                      $$renderer6.push(`<!--[-->`);
                      const each_array_2 = ensure_array_like(decisions);
                      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
                        let d = each_array_2[$$index_2];
                        Card($$renderer6, {
                          children: ($$renderer7) => {
                            $$renderer7.push(`<div style="padding:1.1rem 1.35rem">`);
                            Flex($$renderer7, {
                              gap: 2,
                              align: "center",
                              wrap: true,
                              children: ($$renderer8) => {
                                Badge($$renderer8, {
                                  tone: "info",
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<!---->Décision`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!----> `);
                                Badge($$renderer8, {
                                  tone: "neutral",
                                  size: "sm",
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<!---->${escape_html(d.project)}`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!----> `);
                                if (d.workspace) {
                                  $$renderer8.push("<!--[0-->");
                                  Badge($$renderer8, {
                                    tone: "neutral",
                                    size: "sm",
                                    children: ($$renderer9) => {
                                      $$renderer9.push(`<!---->${escape_html(d.workspace)}`);
                                    },
                                    $$slots: { default: true }
                                  });
                                } else {
                                  $$renderer8.push("<!--[-1-->");
                                }
                                $$renderer8.push(`<!--]--> `);
                                if (d.wp) {
                                  $$renderer8.push("<!--[0-->");
                                  Badge($$renderer8, {
                                    tone: "neutral",
                                    size: "sm",
                                    children: ($$renderer9) => {
                                      $$renderer9.push(`<!---->${escape_html(d.wp)}`);
                                    },
                                    $$slots: { default: true }
                                  });
                                } else {
                                  $$renderer8.push("<!--[-1-->");
                                }
                                $$renderer8.push(`<!--]-->`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----> <h3 style="margin:.55rem 0 .3rem; font-size:1.05rem; line-height:1.3">${escape_html(d.question)}</h3> <p style="margin:0 0 .5rem; opacity:.72; font-size:.92em">${escape_html(d.summary)}</p> `);
                            Flex($$renderer7, {
                              align: "center",
                              justify: "between",
                              wrap: true,
                              gap: 2,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<div style="opacity:.85; font-size:.92em">${escape_html(d.action)} — ${escape_html(d.actor)}</div> `);
                                Button($$renderer8, {
                                  size: "sm",
                                  variant: "primary",
                                  onclick: () => injectDecision(d.id),
                                  disabled: injecting === d.id,
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<!---->${escape_html(injecting === d.id ? "Injection…" : "Injecter dans la CLI")}`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!---->`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----> `);
                            if (injectResult[d.id]) {
                              $$renderer7.push("<!--[0-->");
                              $$renderer7.push(`<div style="margin-top:.6rem">`);
                              if (injectResult[d.id].ok && injectResult[d.id].delivered) {
                                $$renderer7.push("<!--[0-->");
                                Alert($$renderer7, {
                                  tone: "success",
                                  title: `Injectée à ${injectResult[d.id].target}`,
                                  message: injectResult[d.id].note
                                });
                              } else if (injectResult[d.id].ok) {
                                $$renderer7.push("<!--[1-->");
                                Alert($$renderer7, {
                                  tone: "warning",
                                  title: "Aucune CLI live sur ce projet",
                                  message: injectResult[d.id].note
                                });
                              } else {
                                $$renderer7.push("<!--[-1-->");
                                Alert($$renderer7, {
                                  tone: "error",
                                  title: "Échec de l'injection",
                                  message: injectResult[d.id].error
                                });
                              }
                              $$renderer7.push(`<!--]--></div>`);
                            } else {
                              $$renderer7.push("<!--[-1-->");
                            }
                            $$renderer7.push(`<!--]--></div>`);
                          },
                          $$slots: { default: true }
                        });
                      }
                      $$renderer6.push(`<!--]-->`);
                    },
                    $$slots: { default: true }
                  });
                }
                $$renderer5.push(`<!--]--></section> <div class="foot svelte-1uha8ag">Généré le ${escape_html(focus.ok ? focus.generatedAt : "")} · source : track (système de référence, lecture seule)</div>`);
              }
              $$renderer5.push(`<!--]--></div>`);
            },
            $$slots: { default: true }
          });
        };
        AppShell($$renderer3, {
          variant: "workspace",
          topChrome,
          main
        });
      }
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-DbaEG23x.js.map
