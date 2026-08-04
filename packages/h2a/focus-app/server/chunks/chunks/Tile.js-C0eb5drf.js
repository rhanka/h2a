import { ab as spread_props, Z as derived, a8 as attributes, a7 as clsx, a4 as escape_html, a6 as attr_class, a3 as attr, ae as attr_style, a9 as ensure_array_like, ag as stringify, aa as bind_props } from './index.js-laGHLarB.js';
import { F as Flex } from './AppShell.js-6Pi87dO0.js';

function ProgressBar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      label,
      helperText,
      value = 0,
      max = 100,
      indeterminate = false,
      tone = "neutral",
      size = "md",
      showValue = false,
      valueText,
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const wrapperClasses = () => ["st-progressBar", className].filter(Boolean).join(" ");
    const trackClasses = () => [
      "st-progressBar__track",
      `st-progressBar__track--${size}`,
      `st-progressBar__track--${tone}`,
      indeterminate ? "st-progressBar__track--indeterminate" : null
    ].filter(Boolean).join(" ");
    const clampedValue = () => {
      if (max <= 0) return 0;
      if (value < 0) return 0;
      if (value > max) return max;
      return value;
    };
    const percent = () => indeterminate ? 0 : clampedValue() / max * 100;
    const displayValue = () => {
      if (valueText) return valueText;
      if (indeterminate) return "";
      return `${Math.round(percent())}%`;
    };
    $$renderer2.push(`<div${attributes({ ...rest, class: clsx(wrapperClasses()) }, "svelte-1d165yb")}>`);
    if (label || showValue && !indeterminate) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-progressBar__header svelte-1d165yb">`);
      if (label) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="st-progressBar__label svelte-1d165yb">${escape_html(label)}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (showValue && !indeterminate) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="st-progressBar__value svelte-1d165yb" aria-hidden="true">${escape_html(displayValue())}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div${attr_class(clsx(trackClasses()), "svelte-1d165yb")} role="progressbar"${attr("aria-valuemin", indeterminate ? void 0 : 0)}${attr("aria-valuemax", indeterminate ? void 0 : max)}${attr("aria-valuenow", indeterminate ? void 0 : clampedValue())}${attr("aria-valuetext", indeterminate ? void 0 : displayValue())}${attr("aria-label", label)}><div class="st-progressBar__fill svelte-1d165yb"${attr_style(`--st-progressBar-pct: ${stringify(percent())}%`)}></div></div> `);
    if (helperText) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-progressBar__help svelte-1d165yb">${escape_html(helperText)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function SlideIndicator($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      count,
      current = 0,
      onChange,
      size = "md",
      variant = "dots",
      label = "Diapositive",
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => [
      "st-slideIndicator",
      `st-slideIndicator--${size}`,
      `st-slideIndicator--${variant}`,
      className
    ].filter(Boolean).join(" "));
    const items = derived(() => Array.from({ length: Math.max(0, count) }, (_, i) => i));
    $$renderer2.push(`<div${attributes(
      {
        ...rest,
        class: clsx(classes()),
        role: "group",
        "aria-label": label
      },
      "svelte-60hp0l"
    )}><!--[-->`);
    const each_array = ensure_array_like(items());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let index = each_array[$$index];
      $$renderer2.push(`<button type="button"${attr_class("st-slideIndicator__dot svelte-60hp0l", void 0, { "st-slideIndicator__dot--current": index === current })}${attr("aria-current", index === current ? "true" : void 0)}${attr("aria-label", `${label} ${index + 1}`)}${attr("tabindex", index === current ? 0 : -1)}></button>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function Stack($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      gap,
      align,
      justify,
      as = "div",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => ["st-stack", className].filter(Boolean).join(" "));
    Flex($$renderer2, spread_props([
      rest,
      {
        as,
        gap,
        align,
        justify,
        direction: "column",
        class: classes(),
        children: ($$renderer3) => {
          children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Tile($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      variant = "static",
      href,
      selected = false,
      disabled = false,
      title,
      description,
      class: className,
      onclick,
      onselect,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => [
      "st-tile",
      `st-tile--${variant}`,
      variant === "selectable" && selected ? "st-tile--selected" : null,
      disabled ? "st-tile--disabled" : null,
      className
    ].filter(Boolean).join(" ");
    function body($$renderer3) {
      if (children) {
        $$renderer3.push("<!--[0-->");
        children($$renderer3);
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[-1-->");
        if (title) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="st-tile__title svelte-1vcfi3">${escape_html(title)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (description) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="st-tile__description svelte-1vcfi3">${escape_html(description)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]-->`);
      }
      $$renderer3.push(`<!--]-->`);
    }
    if (variant === "clickable" && href) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<a${attributes(
        {
          ...rest,
          class: clsx(classes()),
          href,
          "aria-disabled": disabled
        },
        "svelte-1vcfi3"
      )}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></a>`);
    } else if (variant === "clickable") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<button${attributes({ ...rest, type: "button", class: clsx(classes()), disabled }, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></button>`);
    } else if (variant === "selectable") {
      $$renderer2.push("<!--[2-->");
      $$renderer2.push(`<label${attr_class(clsx(classes()), "svelte-1vcfi3")}><input type="checkbox" class="st-tile__input svelte-1vcfi3"${attr("checked", selected, true)}${attr("disabled", disabled, true)}/> <span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></label>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div${attributes({ ...rest, class: clsx(classes()) }, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></div>`);
    }
    $$renderer2.push(`<!--]-->`);
    bind_props($$props, { selected });
  });
}

export { ProgressBar as P, Stack as S, Tile as T, SlideIndicator as a };
//# sourceMappingURL=Tile.js-C0eb5drf.js.map
