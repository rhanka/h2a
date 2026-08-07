import { a2 as head, a3 as attr, Z as derived } from '../../chunks/index.js--xmWq8-W.js';
import '../../chunks/utils.js-h3jETFNR.js';
import '../../chunks/utils2.js-BQzn9ikS.js';

const foundation = {
    color: {
        blue: {
            10: "oklch(97% 0.02 242)",
            60: "oklch(50% 0.134 242.749)",
            80: "oklch(32% 0.11 242)"
        },
        cyan: {
            10: "oklch(96% 0.04 195)",
            50: "oklch(70.4% 0.14 182.503)",
            70: "oklch(48% 0.12 190)"
        },
        slate: {
            0: "#ffffff",
            10: "#f8fafc",
            20: "#e2e8f0",
            60: "#475569",
            80: "#1e293b",
            90: "#0f172a"
        },
        feedback: {
            success: "#16a34a",
            warning: "#d97706",
            error: "#dc2626",
            info: "#2563eb"
        }
    },
    font: {
        sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "Inter, system-ui, sans-serif",
        mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    },
    spacing: {
        0: "0",
        1: "0.25rem",
        2: "0.5rem",
        3: "0.75rem",
        4: "1rem",
        6: "1.5rem",
        8: "2rem",
        12: "3rem",
        16: "4rem"
    },
    radius: {
        none: "0",
        sm: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        pill: "999px"
    },
    shadow: {
        subtle: "0 1px 2px rgb(15 23 42 / 0.08)",
        medium: "0 8px 24px rgb(15 23 42 / 0.12)",
        floating: "0 18px 45px rgb(15 23 42 / 0.18)"
    },
    motion: {
        fast: "120ms",
        normal: "180ms",
        slow: "280ms",
        easing: "cubic-bezier(0.4, 0, 0.2, 1)"
    },
    z: {
        header: 50,
        toast: 60,
        overlay: 80,
        modal: 100,
        chat: 110
    },
    // --- Anatomy primitives (Phase 1) ----------------------------------------
    // Border weights — controls how heavy outlines/dividers read per theme.
    borderWidth: {
        none: "0",
        thin: "1px",
        thick: "2px"
    },
    // Default stroke style for control borders.
    borderStyle: {
        solid: "solid"
    },
    // Density grid: control geometry per size token. controlHeight is the target
    // box height; paddingBlock/Inline are intrinsic insets; gap is the inline
    // gap between icon + label; minWidth is the smallest allowed control width.
    density: {
        sm: {
            controlHeight: "2rem", // 32px
            paddingBlock: "0",
            paddingInline: "0.75rem",
            gap: "0.375rem",
            minWidth: "2rem"
        },
        md: {
            controlHeight: "2.5rem", // 40px
            paddingBlock: "0",
            paddingInline: "1rem",
            gap: "0.5rem",
            minWidth: "2.5rem"
        },
        lg: {
            controlHeight: "3rem", // 48px
            paddingBlock: "0",
            paddingInline: "1.25rem",
            gap: "0.5rem",
            minWidth: "3rem"
        }
    },
    // Typography by role. Each role is a self-contained set of text properties so
    // a theme can re-shape headings/labels/links without touching components.
    typography: {
        // Buttons / interactive control labels.
        control: {
            family: "var(--st-font-sans)",
            size: "0.9375rem", // 15px
            weight: "600",
            lineHeight: "1.2",
            letterSpacing: "0",
            textTransform: "none",
            textDecoration: "none",
            decorationThickness: "auto",
            decorationOffset: "auto"
        },
        // Form field input text.
        field: {
            family: "var(--st-font-sans)",
            size: "1rem", // 16px
            weight: "400",
            lineHeight: "1.5",
            letterSpacing: "0",
            textTransform: "none",
            textDecoration: "none",
            decorationThickness: "auto",
            decorationOffset: "auto"
        },
        // Field labels / form group legends.
        label: {
            family: "var(--st-font-sans)",
            size: "0.875rem", // 14px
            weight: "600",
            lineHeight: "1.4",
            letterSpacing: "0",
            textTransform: "none",
            textDecoration: "none",
            decorationThickness: "auto",
            decorationOffset: "auto"
        },
        // Hyperlinks.
        link: {
            family: "inherit",
            size: "inherit",
            weight: "inherit",
            lineHeight: "inherit",
            letterSpacing: "0",
            textTransform: "none",
            textDecoration: "underline",
            decorationThickness: "auto",
            decorationOffset: "0.18em"
        }
    },
    // Multiplier applied to disabled controls.
    disabledOpacity: "0.55",
    // Shared interaction transition tokens (consumed by anatomy `transition`).
    transition: {
        property: "background-color, border-color, color, box-shadow, outline-color",
        duration: "120ms",
        easing: "cubic-bezier(0.4, 0, 0.2, 1)"
    },
    // Pointer affordance roles.
    cursor: {
        interactive: "pointer",
        disabled: "not-allowed",
        text: "text"
    },
    // Inline icon sizing per control size token.
    iconSize: {
        sm: "1rem",
        md: "1.125rem",
        lg: "1.25rem"
    },
    // FOCUS STRATEGY = first-class primitive. The `strategy` selects WHICH CSS
    // technique a shared mixin uses (outline | ring | inset | double); the other
    // fields parametrise it. This is what lets DSFR (offset outline), Carbon
    // (inset box-shadow) and the base differ by *technique*, not just values.
    focus: {
        strategy: "outline", // outline | ring | inset | double
        width: "2px",
        offset: "2px",
        color: "var(--st-semantic-border-interactive)",
        inset: "0" // inset distance used by the `inset` strategy
    },
    // FIELD STYLE = first-class primitive (anatomy v1.2.0). Selects how form
    // fields are drawn: `outline` (boxed, 4 equal borders — the base Sent Tech
    // look) vs `filled-underline` (filled background + a single bottom rule —
    // the DSFR/Carbon signature). `fillBg`/`underlineColor`/`underlineWidth` are
    // only consumed when style = filled-underline; for `outline` the builder uses
    // surface.default + border.subtle. Themes override this block to switch style.
    field: {
        style: "outline", // outline | filled-underline
        fillBg: "var(--st-semantic-surface-default)",
        underlineColor: "var(--st-semantic-border-strong)",
        underlineWidth: "1px"
    }
};

const semantic = {
    surface: {
        default: foundation.color.slate[0],
        subtle: foundation.color.slate[10],
        raised: foundation.color.slate[0],
        inverse: foundation.color.slate[90],
        overlay: "rgb(15 23 42 / 0.48)"
    },
    text: {
        primary: foundation.color.slate[90],
        secondary: foundation.color.slate[60],
        muted: "#64748b",
        inverse: foundation.color.slate[0],
        link: foundation.color.blue[60]
    },
    border: {
        subtle: foundation.color.slate[20],
        strong: "#94a3b8",
        interactive: foundation.color.blue[60]
    },
    action: {
        primary: foundation.color.blue[60],
        // Darker primary used on :hover (anatomy v1.1.0 — states.hover.bg).
        primaryHover: foundation.color.blue[80],
        primaryText: foundation.color.slate[0],
        secondary: foundation.color.slate[10],
        // Slightly stronger neutral for the secondary :hover surface.
        secondaryHover: foundation.color.slate[20],
        secondaryText: foundation.color.slate[90],
        danger: foundation.color.feedback.error
    },
    feedback: {
        success: foundation.color.feedback.success,
        warning: foundation.color.feedback.warning,
        error: foundation.color.feedback.error,
        info: foundation.color.feedback.info
    },
    status: {
        pending: foundation.color.feedback.warning,
        processing: foundation.color.feedback.info,
        completed: foundation.color.feedback.success,
        failed: foundation.color.feedback.error
    },
    data: {
        category1: "#4E79A7",
        category2: "#F28E2B",
        category3: "#E15759",
        category4: "#76B7B2",
        category5: "#59A14F",
        category6: "#EDC948",
        category7: "#B07AA1",
        category8: "#FF9DA7"
    }
};

// Defaults used when a theme omits an anatomy primitive. These mirror the base
// foundation so the OUTPUT is always a complete, typed ComponentAnatomy.
const FALLBACK = {
    borderWidth: { none: "0", thin: "1px", thick: "2px" },
    borderStyle: "solid",
    density: {
        // fontSize per size (v1.1.0): md mirrors the control typography size; sm/lg
        // carry the label scale so the font rides with the control geometry.
        sm: { controlHeight: "2rem", paddingBlock: "0", paddingInline: "0.75rem", gap: "0.375rem", minWidth: "2rem", fontSize: "0.875rem" },
        md: { controlHeight: "2.5rem", paddingBlock: "0", paddingInline: "1rem", gap: "0.5rem", minWidth: "2.5rem", fontSize: "0.9375rem" },
        lg: { controlHeight: "3rem", paddingBlock: "0", paddingInline: "1.25rem", gap: "0.5rem", minWidth: "3rem", fontSize: "1rem" }
    },
    typography: {
        control: { family: "var(--st-font-sans)", size: "0.9375rem", weight: "600", lineHeight: "1.2", letterSpacing: "0", textTransform: "none", textDecoration: "none", decorationThickness: "auto", decorationOffset: "auto" },
        field: { family: "var(--st-font-sans)", size: "1rem", weight: "400", lineHeight: "1.5", letterSpacing: "0", textTransform: "none", textDecoration: "none", decorationThickness: "auto", decorationOffset: "auto" },
        label: { family: "var(--st-font-sans)", size: "0.875rem", weight: "600", lineHeight: "1.4", letterSpacing: "0", textTransform: "none", textDecoration: "none", decorationThickness: "auto", decorationOffset: "auto" },
        // Base/DSFR links are underlined at rest → underline on hover is a no-op.
        // decorationThicknessHover / decorationOffsetHover default to rest metrics so
        // themes that do not animate underline geometry (Sent Tech / Carbon) stay
        // stable without phantom var requirements.
        link: {
            family: "inherit", size: "inherit", weight: "inherit", lineHeight: "inherit", letterSpacing: "0", textTransform: "none",
            textDecoration: "underline", decorationThickness: "auto", decorationOffset: "0.18em",
            decorationThicknessHover: "auto", decorationOffsetHover: "0.18em", textDecorationHover: "underline"
        }
    },
    disabledOpacity: "0.55",
    iconSize: { sm: "1rem", md: "1.125rem", lg: "1.25rem" },
    focus: { strategy: "outline", width: "2px", offset: "2px", color: "var(--st-semantic-border-interactive)", inset: "0" },
    // Field style fallback = boxed outline (base Sent Tech). underlineColor /
    // underlineWidth are inert for outline; they only drive filled-underline.
    // v1.6.0: radiusTop/radiusBottom "" = inherit the theme's shape radius
    // (resolved in fieldOf).
    // v1.4.0: selectAppearance "auto" (native arrow, base unchanged), no chevron,
    // and the prior 2rem right arrow gap.
    field: { style: "outline", selectAppearance: "auto", selectChevron: "none", selectPaddingRight: "2rem" }
};
function densityOf(f, size) {
    const base = FALLBACK.density[size];
    const themed = f.density?.[size] ?? {};
    return {
        controlHeight: themed.controlHeight ?? base.controlHeight,
        paddingBlock: themed.paddingBlock ?? base.paddingBlock,
        paddingInline: themed.paddingInline ?? base.paddingInline,
        gap: themed.gap ?? base.gap,
        minWidth: themed.minWidth ?? base.minWidth,
        fontSize: themed.fontSize ?? base.fontSize
    };
}
/**
 * Button density (F9): the shared control density for `size`, overlaid with any
 * BUTTON-specific override (`buttonDensity`). Adds an optional `paddingInlineEnd`
 * leaf so a button can be asymmetric (Carbon's large trailing gutter) without
 * touching the shared density the 100%-fidelity fields read. When the theme omits
 * `buttonDensity` (base/DSFR), this is identical to `densityOf` → no change, and
 * `paddingInlineEnd` mirrors `paddingInline` (symmetric).
 */
function buttonDensityOf(f, size) {
    const base = densityOf(f, size);
    const override = f.buttonDensity?.[size] ?? {};
    const paddingInline = override.paddingInline ?? base.paddingInline;
    return {
        controlHeight: override.controlHeight ?? base.controlHeight,
        paddingBlock: override.paddingBlock ?? base.paddingBlock,
        paddingInline,
        gap: override.gap ?? base.gap,
        minWidth: override.minWidth ?? base.minWidth,
        fontSize: override.fontSize ?? base.fontSize,
        // Trailing inline padding: an explicit asymmetric value (Carbon) or = paddingInline.
        paddingInlineEnd: override.paddingInlineEnd ?? paddingInline
    };
}
/**
 * Tabs ACTIVE-tab resolution (F7/F8). Resolves the per-theme selected-tab
 * primitive into a flat, CSS-ready set the Tabs component consumes verbatim.
 * Every leaf DEFAULTS to the prior base render (12px/4px padding, inherited
 * font-size, control weight/line-height, transparent active bg, primary text,
 * BOTTOM indicator) so the base Sent Tech tab is byte-identical; DSFR / Carbon
 * override the real selected-tab metrics. `indicatorSide` resolves into two
 * border-width channels so a theme can put its accent on the top edge (DSFR,
 * which then has NO bottom border) or the bottom edge (base / Carbon).
 */
function tabsOf(f, controlTypography, indicatorWidth, indicatorColor, activeTextDefault) {
    const t = f.tabs ?? {};
    const indicatorSide = t.indicatorSide ?? "bottom";
    const indicatorMode = t.indicatorMode ?? "border";
    // The indicator lives on ONE edge; the opposite edge collapses to 0 so the
    // active tab matches the reference (DSFR active = border-bottom 0 / top accent).
    const onTop = indicatorSide === "top";
    // "shadow" mode draws the accent as an inset box-shadow so BOTH border sides
    // stay 0 (DSFR, whose real accent is a background-image filet, not a border).
    // "border" mode keeps the real per-side border (base / Carbon) and no shadow.
    const isShadow = indicatorMode === "shadow";
    const shadowOffset = onTop ? indicatorWidth : `-${indicatorWidth}`;
    return {
        activeText: t.activeText || activeTextDefault,
        activeBackground: t.activeBackground || "transparent",
        // G2: resting-tab fill. Default "transparent" (base/Carbon unchanged); DSFR
        // sets a light grey-blue fill so the white active tab reads as raised.
        inactiveBackground: t.inactiveBackground || "transparent",
        activeWeight: t.activeWeight ?? controlTypography.weight,
        paddingBlock: t.paddingBlock ?? "0.75rem",
        paddingInline: t.paddingInline ?? "0.25rem",
        fontSize: t.fontSize ?? "inherit",
        lineHeight: t.lineHeight ?? controlTypography.lineHeight,
        indicatorSide,
        activeBorderTopWidth: isShadow ? "0" : onTop ? indicatorWidth : "0",
        activeBorderBottomWidth: isShadow ? "0" : onTop ? "0" : indicatorWidth,
        activeShadow: isShadow ? `inset 0 ${shadowOffset} 0 0 ${indicatorColor}` : "none"
    };
}
/**
 * Button SECONDARY-variant resolution (G1). Resolves the per-theme secondary
 * button surface into a flat, CSS-ready set the Button component consumes
 * verbatim (background / border colour / hover background). Every leaf DEFAULTS
 * to the prior base render (filled `action.secondary`, `border.subtle` stroke,
 * `action.secondaryHover` hover) so the base Sent Tech secondary button is
 * byte-identical; DSFR overrides them to render its OUTLINED secondary button
 * (transparent fill + Bleu France border + light fill on hover).
 */
function buttonSecondaryOf(semantic, f) {
    const b = f.buttonSecondary ?? {};
    return {
        background: b.background || semantic.action.secondary,
        border: b.border || semantic.border.subtle,
        hoverBackground: b.hoverBackground || semantic.action.secondaryHover || semantic.action.secondary
    };
}
/**
 * Pagination resolution (F10). Resolves the per-theme pagination primitive into
 * a flat, CSS-ready set the Pagination component consumes verbatim. Every leaf
 * DEFAULTS to the prior base render (1px subtle stroke, radius.md, 0 block /
 * 12px inline padding, 36px min size, filled action.primary active page,
 * inherited font metrics) so the base Sent Tech pagination is byte-identical.
 * DSFR / Carbon override the real active-page metrics.
 */
function paginationOf(semantic, f, thin, radiusMd) {
    const p = f.pagination ?? {};
    const border = p.border || semantic.border.subtle;
    const borderWidth = p.borderWidth ?? thin;
    return {
        background: p.background || semantic.surface.default,
        border,
        borderWidth,
        text: p.text || semantic.text.primary,
        radius: p.radius ?? radiusMd,
        activeBackground: p.activeBackground || semantic.action.primary,
        activeText: p.activeText || semantic.action.primaryText,
        // The active page can drop its border (DSFR/Carbon active page has none);
        // default = the resting page border so the base render is unchanged.
        activeBorder: p.activeBorder || border,
        activeBorderWidth: p.activeBorderWidth ?? borderWidth,
        activeWeight: p.activeWeight ?? "inherit",
        disabledText: p.disabledText || semantic.text.muted,
        paddingBlock: p.paddingBlock ?? "0",
        paddingInline: p.paddingInline ?? "0.75rem",
        minSize: p.minSize ?? "2.25rem",
        fontSize: p.fontSize ?? "inherit",
        lineHeight: p.lineHeight ?? "normal",
        letterSpacing: p.letterSpacing ?? "normal"
    };
}
/**
 * Breadcrumb resolution (F10). Resolves the per-theme breadcrumb primitive into
 * a flat set the Breadcrumb component consumes verbatim. Every leaf DEFAULTS to
 * the prior base render (link = text.link, no explicit font metrics → inherited
 * 16px / normal, current 600 weight on the current page). DSFR / Carbon pin the
 * real breadcrumb link colour + typography.
 */
function breadcrumbOf(semantic, f) {
    const b = f.breadcrumb ?? {};
    return {
        text: b.text || semantic.text.secondary,
        linkText: b.linkText || semantic.text.link,
        currentText: b.currentText || semantic.text.primary,
        separator: b.separator || semantic.text.muted,
        fontSize: b.fontSize ?? "inherit",
        lineHeight: b.lineHeight ?? "normal",
        letterSpacing: b.letterSpacing ?? "normal",
        currentWeight: b.currentWeight ?? "600"
    };
}
/**
 * Alert resolution (P-B). Resolves the per-theme alert primitive into a flat,
 * CSS-ready set the Alert component consumes verbatim. Every leaf DEFAULTS to the
 * prior base render (surface.raised fill, 1px subtle box on top/right/bottom, a
 * 4px left accent edge, 16px padding all sides, inherited font / `normal`
 * line-height) so the base Sent Tech alert is byte-identical. DSFR drops the box
 * + fill (accent becomes a `::before` filet → left border 0); Carbon paints a
 * dark banner with a 3px coloured left bar (a real border).
 */
function alertOf(semantic, f, thin, borderStyle) {
    const a = f.alert ?? {};
    // The base box border = 1px subtle on top/right/bottom (the left edge is the
    // accent, sized by accentWidth and coloured per severity by the component).
    const box = `${thin} ${borderStyle} ${semantic.border.subtle}`;
    return {
        background: a.background || semantic.surface.raised,
        text: a.text || semantic.text.primary,
        borderTop: a.borderTop || box,
        borderRight: a.borderRight || box,
        borderBottom: a.borderBottom || box,
        accentWidth: a.accentWidth ?? "0.25rem", // 4px (current)
        filetWidth: a.filetWidth ?? "0", // no filet (base/Carbon use a real left border)
        paddingTop: a.paddingTop ?? "1rem",
        paddingRight: a.paddingRight ?? "1rem",
        paddingBottom: a.paddingBottom ?? "1rem",
        paddingLeft: a.paddingLeft ?? "1rem",
        fontSize: a.fontSize ?? "inherit",
        lineHeight: a.lineHeight ?? "normal",
        letterSpacing: a.letterSpacing ?? "normal",
        accentInfo: a.accentInfo || semantic.feedback.info,
        accentSuccess: a.accentSuccess || semantic.feedback.success,
        accentWarning: a.accentWarning || semantic.feedback.warning,
        accentError: a.accentError || semantic.feedback.error
    };
}
/**
 * Accordion resolution (P-B). Resolves the per-theme accordion-trigger primitive
 * into a flat set the Accordion component consumes verbatim. Every leaf DEFAULTS
 * to the prior base render (14px block / 8px inline padding, inherited font-size,
 * weight 600, `normal` line-height, primary text) so the base Sent Tech accordion
 * is byte-identical. DSFR / Carbon pin the real header metrics.
 */
function accordionOf(semantic, f) {
    const a = f.accordion ?? {};
    return {
        text: a.text || semantic.text.primary,
        paddingBlock: a.paddingBlock ?? "0.875rem", // 14px (current)
        paddingInline: a.paddingInline ?? "0.5rem", // 8px (current)
        fontSize: a.fontSize ?? "inherit",
        fontWeight: a.fontWeight ?? "600",
        lineHeight: a.lineHeight ?? "normal"
    };
}
/**
 * Tag resolution (P-C). Resolves the per-theme tag primitive into a flat,
 * CSS-ready set the Tag component consumes verbatim. Every leaf DEFAULTS to the
 * prior base render (pill radius 999px, 4px/10px padding, 12px font, weight 600,
 * line-height 1, no transform, no min-height, NEUTRAL tone = surface.subtle fill
 * + text.secondary text) so the base Sent Tech tag is byte-identical. DSFR /
 * Carbon override the real `.fr-tag` / `.bx--tag` metrics + neutral colours.
 */
function tagOf(semantic, f) {
    const t = f.tag ?? {};
    return {
        radius: t.radius ?? "999px",
        paddingBlock: t.paddingBlock ?? "0.25rem", // 4px (current md)
        paddingInline: t.paddingInline ?? "0.625rem", // 10px (current md)
        fontSize: t.fontSize ?? "0.75rem", // 12px (current md)
        fontWeight: t.fontWeight ?? "600",
        lineHeight: t.lineHeight ?? "1",
        letterSpacing: t.letterSpacing ?? "normal",
        textTransform: t.textTransform ?? "none",
        minHeight: t.minHeight ?? "0",
        neutralBackground: t.neutralBackground || semantic.surface.subtle,
        neutralText: t.neutralText || semantic.text.secondary
    };
}
/**
 * Badge resolution (P-C). Resolves the per-theme badge primitive into a flat,
 * CSS-ready set the Badge component consumes verbatim. Every leaf DEFAULTS to
 * the prior base render (pill radius 999px, 4px/8px padding, 12px font, weight
 * 650, line-height 1, no transform, no min-height; tone colours stay the per-tone
 * feedback mix) so the base Sent Tech badge is byte-identical. DSFR overrides the
 * real `.fr-badge` metrics + recolours the INFO tone (the bench-rendered one) to
 * the measured grey badge.
 */
function badgeOf(semantic, f) {
    const b = f.badge ?? {};
    return {
        radius: b.radius ?? "999px",
        paddingBlock: b.paddingBlock ?? "0.25rem", // 4px (current)
        paddingInline: b.paddingInline ?? "0.5rem", // 8px (current)
        fontSize: b.fontSize ?? "0.75rem", // 12px (current)
        fontWeight: b.fontWeight ?? "650",
        lineHeight: b.lineHeight ?? "1",
        letterSpacing: b.letterSpacing ?? "normal",
        textTransform: b.textTransform ?? "none",
        minHeight: b.minHeight ?? "0",
        // Default INFO fill reproduces the current `color-mix(... feedback.info 14%,
        // white)`; a theme can replace it with a flat measured colour.
        infoBackground: b.infoBackground || `color-mix(in srgb, ${semantic.feedback.info} 14%, white)`,
        infoText: b.infoText || semantic.feedback.info
    };
}
/**
 * Choice (Checkbox/Radio) LABEL resolution (P-D). Resolves the per-theme label
 * typography into a flat, CSS-ready set the `.st-choice__label` consumes
 * verbatim. Every leaf DEFAULTS to the prior base render (15px font, `normal`
 * line-height + letter-spacing, primary text) so the base Sent Tech
 * checkbox/radio is byte-identical. `radioLineHeight` defaults to the checkbox
 * line-height (single value) so a theme that does not split them stays
 * consistent; Carbon splits 18px (checkbox) / 20px (radio).
 */
function choiceOf(semantic, f) {
    const c = f.choice ?? {};
    const labelLineHeight = c.labelLineHeight ?? "normal";
    return {
        labelFontSize: c.labelFontSize ?? "0.9375rem", // 15px (current)
        labelLineHeight,
        radioLineHeight: c.radioLineHeight ?? labelLineHeight,
        labelLetterSpacing: c.labelLetterSpacing ?? "normal",
        labelColor: c.labelColor || semantic.text.primary
    };
}
/**
 * Search FIELD resolution (P-D). Resolves the per-theme search-box padding +
 * input typography into a flat set the `.st-search` consumes verbatim. Every
 * leaf DEFAULTS to the prior base render (0 padding on the wrapper, inherited
 * 16px / `normal` typography) so the base Sent Tech search is byte-identical.
 * The field box (fill / borders / radius) is the shared field anatomy, unchanged.
 */
function searchOf(f) {
    const s = f.search ?? {};
    const paddingInline = s.paddingInline ?? "0";
    return {
        paddingBlock: s.paddingBlock ?? "0",
        paddingInline: paddingInline,
        // v1.6.0 (additive): left/right wrapper padding. Preserve backward
        // compatibility by defaulting each side to the single paddingInline value.
        paddingLeft: s.paddingLeft ?? paddingInline,
        paddingRight: s.paddingRight ?? paddingInline,
        fontSize: s.fontSize ?? "1rem", // 16px (current inherited)
        lineHeight: s.lineHeight ?? "normal",
        letterSpacing: s.letterSpacing ?? "normal"
    };
}
/**
 * Toggle / Switch resolution (P-D). Resolves the per-theme track geometry +
 * colours + label typography into a flat set the Toggle/Switch components
 * consume verbatim. Every leaf DEFAULTS to the prior base render (pill radius
 * 999px, 2px inner padding, 36×20 md track, 16px md thumb, border.strong resting
 * track, action.primary checked track, surface.default thumb, inherited `normal`
 * typography, primary text) so the base Sent Tech toggle is byte-identical.
 */
function toggleOf(semantic, f) {
    const t = f.toggle ?? {};
    return {
        trackRadius: t.trackRadius ?? "999px",
        trackPadding: t.trackPadding ?? "0.125rem", // 2px (current)
        trackWidth: t.trackWidth ?? "2.25rem", // 36px (current md)
        trackHeight: t.trackHeight ?? "1.25rem", // 20px (current md)
        thumbSize: t.thumbSize ?? "1rem", // 16px (current md)
        trackColor: t.trackColor || semantic.border.strong,
        trackCheckedColor: t.trackCheckedColor || semantic.action.primary,
        thumbColor: t.thumbColor || semantic.surface.default,
        fontSize: t.fontSize ?? "inherit",
        lineHeight: t.lineHeight ?? "normal",
        letterSpacing: t.letterSpacing ?? "normal",
        textColor: t.textColor || semantic.text.primary
    };
}
/**
 * SelectableRow / SelectableList SELECTED-item resolution (UAT8). Resolves the
 * per-theme selected-item colours into a flat, CSS-ready set both components
 * consume verbatim. Every leaf DEFAULTS to a value derived from this theme's own
 * `action.primary`:
 *   - selectedBackground: a calm 12% tint of the primary over the surface.
 *   - selectedAccent:     the primary itself (opt-in left accent bar).
 *   - selectedText:       a DARKER accent (`primary 78% + black`) that clears
 *     ≥ 7:1 on the tint for every light theme (the plain primary only reaches
 *     ~4.2–4.9:1, sub/at-AA). Verified via WCAG relative luminance.
 * The `*Dark` leaves carry dark-mode-safe variants (text LIGHTENED, tint over a
 * dark surface) so a future dark theme inherits accessible values automatically.
 * `color-mix(in oklch, …)` keeps the derivation perceptually-uniform; the
 * components ship a flat fallback + an `@supports` guard for engines without it.
 */
function selectableRowOf(semantic, f) {
    const s = f.selectableRow ?? {};
    const primary = semantic.action.primary;
    return {
        selectedBackground: s.selectedBackground || `color-mix(in oklch, ${primary} 12%, transparent)`,
        selectedAccent: s.selectedAccent || primary,
        // Darker accent for ≥ 7:1 on the tint (vs ~4.2–4.9:1 for the plain primary).
        selectedText: s.selectedText || `color-mix(in oklch, ${primary} 78%, black)`,
        // Dark-mode variants: a slightly stronger tint + a LIGHTENED text so the
        // accent stays legible on a dark tinted surface.
        selectedBackgroundDark: s.selectedBackgroundDark || `color-mix(in oklch, ${primary} 22%, transparent)`,
        selectedAccentDark: s.selectedAccentDark || primary,
        selectedTextDark: s.selectedTextDark || `color-mix(in oklch, ${primary} 70%, white)`
    };
}
function typographyOf(f, role) {
    // Widen to TypographyAnatomy so the optional textDecorationHover leaf is
    // readable across all roles (only `link` carries it in the FALLBACK literal).
    const base = FALLBACK.typography[role];
    const themed = f.typography?.[role] ?? {};
    return {
        family: themed.family ?? base.family,
        size: themed.size ?? base.size,
        weight: themed.weight ?? base.weight,
        lineHeight: themed.lineHeight ?? base.lineHeight,
        letterSpacing: themed.letterSpacing ?? base.letterSpacing,
        textTransform: themed.textTransform ?? base.textTransform,
        textDecoration: themed.textDecoration ?? base.textDecoration,
        decorationThickness: themed.decorationThickness ?? base.decorationThickness,
        decorationOffset: themed.decorationOffset ?? base.decorationOffset,
        decorationThicknessHover: themed.decorationThicknessHover ?? base.decorationThicknessHover,
        decorationOffsetHover: themed.decorationOffsetHover ?? base.decorationOffsetHover,
        textDecorationHover: themed.textDecorationHover ?? base.textDecorationHover
    };
}
function focusOf(f) {
    const base = FALLBACK.focus;
    const themed = f.focus ?? {};
    const strategy = (themed.strategy ?? base.strategy);
    const width = themed.width ?? base.width;
    const offset = themed.offset ?? base.offset;
    const color = themed.color ?? base.color;
    const inset = themed.inset ?? base.inset;
    // The focus STRATEGY is resolved here into the two CSS channels a shared
    // mixin needs: `outline` and `boxShadow`. A component applies BOTH on
    // :focus-visible; the strategy decides which is "live" (the other is a no-op).
    // This is what lets DSFR (offset outline) and Carbon (inset box-shadow) differ
    // by *technique*, not just values, while staying 100% token-driven.
    let outline = "none";
    let boxShadow = "none";
    switch (strategy) {
        case "outline":
            // DSFR-like: native outline, offset away from the box.
            outline = `${width} solid ${color}`;
            break;
        case "ring":
            // Base default: a soft ring drawn just outside the box.
            boxShadow = `0 0 0 ${width} ${color}`;
            break;
        case "inset":
            // Carbon: a ring drawn INSIDE the box via inset box-shadow.
            boxShadow = `inset 0 0 0 ${width} ${color}`;
            break;
        case "double":
            // Two-tone accessibility ring (outer color + inner light gap).
            outline = `${width} solid ${color}`;
            boxShadow = `0 0 0 ${inset} #ffffff`;
            break;
    }
    return { strategy, width, offset, color, inset, outline, boxShadow };
}
/**
 * Resolves the FIELD STYLE (v1.2.0) into a fully-typed FieldAnatomy: a fill
 * background + four per-side border shorthands a component applies verbatim.
 *
 * - `outline` (default, base Sent Tech): `fillBg = surface.default`, the four
 *   borders all = `<borderWidth.thin> solid <border.subtle>`. This reproduces
 *   the existing boxed input EXACTLY → no Sent Tech regression.
 * - `filled-underline` (DSFR / Carbon): `fillBg` = the theme's field fill tone,
 *   top/right/left = `none`, the bottom rule is the only stroke. HOW the bottom
 *   rule is drawn depends on the theme's real technique:
 *     · DSFR (`underlineAsShadow: true`) draws it as a `box-shadow inset` (its
 *       real CSS), so `borderBottom` is `none` and the rule adds no box height.
 *     · Carbon (default) genuinely uses a real `border-bottom: 1px solid` — so
 *       we keep the geometric `borderBottom` and leave `underline` = `none` to
 *       stay pixel-identical to the official `.bx--text-input`.
 *
 * v1.3.0 (additive): `radiusTop` rounds only the field's TOP corners (defaults
 * to the theme's `shapeRadius` so a boxed field stays uniform — no regression);
 * `underline` carries the filled-underline bottom rule as an inset box-shadow
 * when `underlineAsShadow` is set; `focusShadow` composes it with the focus ring.
 */
function fieldOf(semantic, f, bw, borderStyle, shapeRadius, focusBoxShadow) {
    const themed = f.field ?? {};
    const style = (themed.style ?? FALLBACK.field.style);
    const thin = bw.thin ?? "1px";
    // v1.4.0 (F5/F9) — native <select> rendering. These are independent of the
    // outline/filled-underline branch, so resolve them once and spread into each
    // returned FieldAnatomy. selectAppearance "auto" keeps the base native arrow
    // (and its UA-forced `line-height: normal`); "none" lets the anatomy
    // line-height take effect, the chevron then drawn by selectChevron.
    const selectAppearance = themed.selectAppearance ?? FALLBACK.field.selectAppearance;
    const selectChevron = themed.selectChevron ?? FALLBACK.field.selectChevron;
    const selectPaddingRight = themed.selectPaddingRight ?? FALLBACK.field.selectPaddingRight;
    const selectLeaves = { selectAppearance, selectChevron, selectPaddingRight };
    // Top corners inherit the theme's shape radius unless the theme rounds them
    // explicitly (DSFR field = 4px top). Bottom corners default to shapeRadius.
    const radiusTop = themed.radiusTop || shapeRadius;
    const radiusBottom = themed.radiusBottom || shapeRadius;
    // Compose the field focus box-shadow so the resting underline is never lost
    // incoherently: an outline-strategy theme (focusBoxShadow === "none") keeps
    // the underline; an inset/ring theme stacks its ring + the underline.
    const composeFocus = (underline) => {
        const ring = focusBoxShadow && focusBoxShadow !== "none" ? focusBoxShadow : "";
        if (underline === "none")
            return ring || "none";
        if (!ring)
            return underline; // outline theme: keep the underline at focus
        return `${ring}, ${underline}`; // inset/ring theme: ring + underline
    };
    if (style === "filled-underline") {
        const fillBg = themed.fillBg || semantic.surface.subtle;
        const underlineColor = themed.underlineColor || semantic.border.strong;
        const underlineWidth = themed.underlineWidth || thin;
        // DSFR draws the rule as an inset box-shadow (its real technique, cf. rule
        // `underline-hardcoded-border`); Carbon keeps a real geometric border-bottom
        // (its real technique) so it stays pixel-identical to `.bx--text-input`.
        if (themed.underlineMode === "shadow") {
            const underline = `inset 0 -${underlineWidth} 0 0 ${underlineColor}`;
            return {
                style,
                fillBg,
                borderTop: "none",
                borderRight: "none",
                borderBottom: "none",
                borderLeft: "none",
                radiusTop,
                radiusBottom,
                underline,
                focusShadow: composeFocus(underline),
                ...selectLeaves
            };
        }
        return {
            style,
            fillBg,
            borderTop: "none",
            borderRight: "none",
            borderBottom: `${underlineWidth} ${borderStyle} ${underlineColor}`,
            borderLeft: "none",
            radiusTop,
            radiusBottom,
            underline: "none",
            focusShadow: composeFocus("none"),
            ...selectLeaves
        };
    }
    // outline (default): boxed, 4 equal borders — identical to the prior look.
    const fillBg = themed.fillBg || semantic.surface.default;
    const border = `${thin} ${borderStyle} ${semantic.border.subtle}`;
    return {
        style: "outline",
        fillBg,
        borderTop: border,
        borderRight: border,
        borderBottom: border,
        borderLeft: border,
        radiusTop,
        radiusBottom,
        underline: "none",
        focusShadow: composeFocus("none"),
        ...selectLeaves
    };
}
/**
 * Construit la couche `component` à partir d'un `semantic` et d'un `foundation`
 * donnés. Les rôles composant sont CÂBLÉS sur les rôles semantic/foundation du
 * thème appelant — c'est ce qui permet à un thème (DSFR, Carbon, forge…) de
 * propager sa marque jusqu'aux composants. Réutiliser un `component` figé sur
 * une autre base rendrait les composants inertes au changement de thème.
 */
function createComponent(semantic, foundation) {
    const bw = { ...FALLBACK.borderWidth, ...(foundation.borderWidth ?? {}) };
    const borderStyle = foundation.borderStyle?.solid ?? FALLBACK.borderStyle;
    const disabledOpacity = foundation.disabledOpacity ?? FALLBACK.disabledOpacity;
    ({ ...(foundation.cursor ?? {}) });
    const icon = { ...FALLBACK.iconSize, ...(foundation.iconSize ?? {}) };
    const focus = focusOf(foundation);
    // Anatomy block for the 5 pilot components. Typed against ComponentAnatomy so
    // a theme cannot drift the *shape*; values resolve from this theme's own
    // foundation (radius/density/typography/focus) → the brand reaches anatomy.
    const buttonAnatomy = {
        shape: { radius: foundation.radius.md, borderWidth: bw.thin, borderStyle },
        // F9: button-specific density (shared control density + optional button-only
        // override) so Carbon's tall, asymmetric primary button doesn't regress the
        // fields that share the control density. Base/DSFR get the shared density.
        density: { sm: buttonDensityOf(foundation, "sm"), md: buttonDensityOf(foundation, "md"), lg: buttonDensityOf(foundation, "lg") },
        typography: typographyOf(foundation, "control"),
        focus,
        icon: { size: icon.md, gap: densityOf(foundation, "md").gap },
        states: {
            // v1.1.0: hover bg sourced from the semantic layer (primaryHover, with a
            // fallback to primary so a theme that omits it stays inert, not blank).
            hover: { bg: semantic.action.primaryHover ?? semantic.action.primary, transform: "none" },
            active: { transform: "none" },
            disabled: { opacity: disabledOpacity }
        }
    };
    const inputAnatomy = {
        shape: { radius: foundation.radius.md, borderWidth: bw.thin, borderStyle },
        density: { sm: densityOf(foundation, "sm"), md: densityOf(foundation, "md"), lg: densityOf(foundation, "lg") },
        typography: typographyOf(foundation, "field"),
        focus,
        // Field style (v1.2.0): outline (boxed, base) vs filled-underline (DSFR/Carbon).
        // v1.3.0: radiusTop defaults to the field's own shape radius (radius.md);
        // the underline is an inset box-shadow, composed with the focus ring.
        field: fieldOf(semantic, foundation, bw, borderStyle, foundation.radius.md, focus.boxShadow),
        states: {
            hover: { border: semantic.border.strong },
            focus: { border: semantic.border.interactive },
            // Inputs convey disabled via bg + text, not via global dimming.
            disabled: { bg: semantic.surface.subtle, text: semantic.text.muted }
        }
    };
    const linkTypography = typographyOf(foundation, "link");
    const linkAnatomy = {
        shape: { radius: foundation.radius.sm ?? foundation.radius.md, borderWidth: bw.none, borderStyle },
        typography: linkTypography,
        focus,
        states: {
            // v1.1.0: hover decoration sourced from the link role typography
            // (textDecorationHover). DSFR/base = underline (no-op vs rest); Carbon
            // goes none → underline on hover. Fallback to underline if a theme omits.
            hover: { text: semantic.action.primary, decoration: linkTypography.textDecorationHover ?? "underline" },
            disabled: { text: semantic.text.muted, decoration: "none", opacity: disabledOpacity }
        }
    };
    // Card surface (additive): borderWidth defaults to the base `thin` stroke so
    // Sent Tech is unchanged; DSFR/Carbon set it to 0 (their cards/tiles have no
    // border). The fill defaults to surface.raised (base), Carbon overrides it to
    // its $layer-01 tone via `card.background`.
    const cardBorderWidth = foundation.card?.borderWidth ?? bw.thin;
    const cardBackground = foundation.card?.background || semantic.surface.raised;
    const cardHoverBackground = foundation.card?.hoverBackground || cardBackground;
    // F5 (additive): the card body typography. The base `.st-card` carries NO
    // explicit font-size / line-height / letter-spacing, so the defaults here
    // REPRODUCE that exact render (inherit / normal / normal). DSFR/Carbon pin
    // their real tile body metrics so the card text matches the measured
    // reference instead of `normal`. Family/weight stay on the field role (no
    // visible change — the card already inherits the brand sans + 400).
    const cardTypographyBase = typographyOf(foundation, "field");
    const cardTypography = {
        ...cardTypographyBase,
        size: foundation.card?.fontSize ?? "inherit",
        lineHeight: foundation.card?.lineHeight ?? "normal",
        letterSpacing: foundation.card?.letterSpacing ?? "normal"
    };
    const cardAnatomy = {
        shape: { radius: foundation.radius.lg, borderWidth: cardBorderWidth, borderStyle },
        typography: cardTypography,
        focus,
        states: {
            hover: {
                bg: cardHoverBackground,
                transform: "translateY(-1px)"
            }
        }
    };
    const tabsControlTypography = typographyOf(foundation, "control");
    const tabsAnatomy = {
        shape: { radius: foundation.radius.none ?? "0", borderWidth: bw.thin, borderStyle },
        density: { md: densityOf(foundation, "md") },
        typography: tabsControlTypography,
        focus,
        states: {
            hover: { text: semantic.text.primary },
            disabled: { opacity: disabledOpacity }
        }
    };
    // F7/F8 — active-tab metrics (additive, per-theme; base render unchanged).
    // The indicator width is the tab's stroke width (thin); `tabsOf` resolves it
    // onto the top edge (DSFR) or the bottom edge (base/Carbon), as a real border
    // (base/Carbon) or an inset box-shadow accent (DSFR).
    const tabsResolved = tabsOf(foundation, tabsControlTypography, bw.thin, semantic.action.primary, semantic.text.primary);
    // G1 — secondary button surface (per theme; base render unchanged). DSFR
    // overrides it to a transparent fill + Bleu France border + text; base/Carbon
    // keep the filled neutral default.
    const buttonSecondary = buttonSecondaryOf(semantic, foundation);
    // F10 — Pagination / Breadcrumb anatomy (per theme; base render unchanged).
    const paginationResolved = paginationOf(semantic, foundation, bw.thin, foundation.radius.md);
    const breadcrumbResolved = breadcrumbOf(semantic, foundation);
    // P-B — Alert / Accordion anatomy (per theme; base render unchanged).
    const alertResolved = alertOf(semantic, foundation, bw.thin, borderStyle);
    const accordionResolved = accordionOf(semantic, foundation);
    // P-C — Tag / Badge anatomy (per theme; base render unchanged).
    const tagResolved = tagOf(semantic, foundation);
    const badgeResolved = badgeOf(semantic, foundation);
    // P-D — Choice (Checkbox/Radio) / Search / Toggle anatomy (per theme; base
    // render unchanged via the resolver defaults).
    const choiceResolved = choiceOf(semantic, foundation);
    const searchResolved = searchOf(foundation);
    const toggleResolved = toggleOf(semantic, foundation);
    // UAT8 — SelectableRow / SelectableList selected-item colours (per theme;
    // derived from action.primary via the resolver defaults).
    const selectableRowResolved = selectableRowOf(semantic, foundation);
    return {
        button: {
            radius: foundation.radius.md,
            primaryBackground: semantic.action.primary,
            primaryText: semantic.action.primaryText,
            // G1: the secondary surface is resolved per theme (transparent + bordered
            // for DSFR's outlined secondary; filled neutral for base/Carbon).
            secondaryBackground: buttonSecondary.background,
            secondaryBorder: buttonSecondary.border,
            secondaryHoverBackground: buttonSecondary.hoverBackground,
            secondaryText: semantic.action.secondaryText,
            anatomy: buttonAnatomy
        },
        link: {
            text: semantic.text.link,
            hoverText: semantic.action.primary,
            disabledText: semantic.text.muted,
            focusRing: semantic.border.interactive,
            anatomy: linkAnatomy
        },
        alert: {
            // Existing leaves keep their names (consumers/docs unchanged); background
            // and text now resolve through `alertOf` (identical defaults = unchanged base).
            background: alertResolved.background,
            text: alertResolved.text,
            border: semantic.border.subtle,
            // Per-severity accent colours now resolve through `alertOf` (default = the
            // matching feedback role → base unchanged; Carbon overrides accentInfo).
            infoBorder: alertResolved.accentInfo,
            successBorder: alertResolved.accentSuccess,
            warningBorder: alertResolved.accentWarning,
            errorBorder: alertResolved.accentError,
            radius: foundation.radius.lg,
            // P-B additive leaves — per-theme alert anatomy (base = unchanged).
            borderTop: alertResolved.borderTop,
            borderRight: alertResolved.borderRight,
            borderBottom: alertResolved.borderBottom,
            // Left accent: a real left border of `accentWidth` (base/Carbon) OR a
            // `::before` filet of `filetWidth` drawn inside the box (DSFR) so the
            // measured left border stays 0. Both coloured per severity by the component.
            accentWidth: alertResolved.accentWidth,
            filetWidth: alertResolved.filetWidth,
            paddingTop: alertResolved.paddingTop,
            paddingRight: alertResolved.paddingRight,
            paddingBottom: alertResolved.paddingBottom,
            paddingLeft: alertResolved.paddingLeft,
            fontSize: alertResolved.fontSize,
            lineHeight: alertResolved.lineHeight,
            letterSpacing: alertResolved.letterSpacing
        },
        accordion: {
            // P-B — per-theme accordion-trigger anatomy (base = unchanged).
            text: accordionResolved.text,
            paddingBlock: accordionResolved.paddingBlock,
            paddingInline: accordionResolved.paddingInline,
            fontSize: accordionResolved.fontSize,
            fontWeight: accordionResolved.fontWeight,
            lineHeight: accordionResolved.lineHeight
        },
        tag: {
            // P-C — per-theme tag anatomy (base = unchanged via resolver defaults).
            radius: tagResolved.radius,
            paddingBlock: tagResolved.paddingBlock,
            paddingInline: tagResolved.paddingInline,
            fontSize: tagResolved.fontSize,
            fontWeight: tagResolved.fontWeight,
            lineHeight: tagResolved.lineHeight,
            letterSpacing: tagResolved.letterSpacing,
            textTransform: tagResolved.textTransform,
            minHeight: tagResolved.minHeight,
            neutralBackground: tagResolved.neutralBackground,
            neutralText: tagResolved.neutralText
        },
        badge: {
            // P-C — per-theme badge anatomy (base = unchanged via resolver defaults).
            radius: badgeResolved.radius,
            paddingBlock: badgeResolved.paddingBlock,
            paddingInline: badgeResolved.paddingInline,
            fontSize: badgeResolved.fontSize,
            fontWeight: badgeResolved.fontWeight,
            lineHeight: badgeResolved.lineHeight,
            letterSpacing: badgeResolved.letterSpacing,
            textTransform: badgeResolved.textTransform,
            minHeight: badgeResolved.minHeight,
            infoBackground: badgeResolved.infoBackground,
            infoText: badgeResolved.infoText
        },
        card: {
            background: cardBackground,
            border: semantic.border.subtle,
            radius: foundation.radius.lg,
            shadow: foundation.shadow.subtle,
            anatomy: cardAnatomy
        },
        menu: {
            background: semantic.surface.raised,
            border: semantic.border.subtle,
            text: semantic.text.primary,
            itemHoverBackground: semantic.surface.subtle,
            dangerText: semantic.feedback.error,
            dangerHoverBackground: "rgba(185, 28, 28, 0.08)",
            disabledText: semantic.text.muted,
            radius: foundation.radius.md,
            shadow: foundation.shadow.medium
        },
        popover: {
            background: semantic.surface.raised,
            border: semantic.border.subtle,
            text: semantic.text.primary,
            shadow: foundation.shadow.floating,
            radius: foundation.radius.lg,
            zIndex: foundation.z.overlay
        },
        dropdown: {
            background: semantic.surface.default,
            border: semantic.border.subtle,
            text: semantic.text.primary,
            optionHoverBackground: semantic.surface.subtle,
            selectedBackground: semantic.action.primary,
            selectedText: semantic.action.primaryText,
            radius: foundation.radius.md,
            shadow: foundation.shadow.medium
        },
        input: {
            background: semantic.surface.default,
            border: semantic.border.subtle,
            focusRing: semantic.border.interactive,
            radius: foundation.radius.md
        },
        field: {
            labelText: semantic.text.primary,
            helpText: semantic.text.secondary,
            errorText: semantic.feedback.error,
            gap: foundation.spacing[2],
            maxWidth: "28rem",
            labelTypography: typographyOf(foundation, "label")
        },
        control: {
            background: semantic.surface.default,
            text: semantic.text.primary,
            placeholderText: semantic.text.muted,
            border: semantic.border.subtle,
            hoverBorder: semantic.border.strong,
            hoverBackground: semantic.surface.subtle,
            focusRing: semantic.border.interactive,
            invalidBorder: semantic.feedback.error,
            disabledBackground: semantic.surface.subtle,
            disabledText: semantic.text.muted,
            radius: foundation.radius.md,
            smHeight: "2rem",
            mdHeight: "2.5rem",
            lgHeight: "3rem",
            anatomy: inputAnatomy
        },
        selection: {
            checkedBackground: semantic.action.primary,
            checkedText: semantic.action.primaryText,
            border: semantic.border.subtle,
            // Existing switch colour leaves now resolve through `toggleOf` (identical
            // defaults = unchanged base; DSFR/Carbon set their measured track colours).
            switchTrack: toggleResolved.trackColor,
            switchTrackChecked: toggleResolved.trackCheckedColor,
            switchThumb: toggleResolved.thumbColor,
            // P-D additive — Choice (Checkbox/Radio) label typography (base = unchanged).
            choiceLabelFontSize: choiceResolved.labelFontSize,
            choiceLabelLineHeight: choiceResolved.labelLineHeight,
            choiceRadioLineHeight: choiceResolved.radioLineHeight,
            choiceLabelLetterSpacing: choiceResolved.labelLetterSpacing,
            choiceLabelColor: choiceResolved.labelColor,
            // P-D additive — Toggle/Switch track geometry + label typography (base =
            // unchanged via the resolver defaults).
            toggleTrackRadius: toggleResolved.trackRadius,
            toggleTrackPadding: toggleResolved.trackPadding,
            toggleTrackWidth: toggleResolved.trackWidth,
            toggleTrackHeight: toggleResolved.trackHeight,
            toggleThumbSize: toggleResolved.thumbSize,
            toggleFontSize: toggleResolved.fontSize,
            toggleLineHeight: toggleResolved.lineHeight,
            toggleLetterSpacing: toggleResolved.letterSpacing,
            toggleTextColor: toggleResolved.textColor
        },
        search: {
            // P-D additive — Search field box padding + input typography (base =
            // unchanged via the resolver defaults). The field box (fill/border/radius)
            // stays the shared `control.anatomy.field` already mapped like Input.
            paddingBlock: searchResolved.paddingBlock,
            paddingInline: searchResolved.paddingInline,
            paddingLeft: searchResolved.paddingLeft,
            paddingRight: searchResolved.paddingRight,
            fontSize: searchResolved.fontSize,
            lineHeight: searchResolved.lineHeight,
            letterSpacing: searchResolved.letterSpacing
        },
        overlay: {
            backdrop: semantic.surface.overlay,
            surface: semantic.surface.raised,
            border: semantic.border.subtle,
            shadow: foundation.shadow.floating,
            radius: foundation.radius.lg,
            zIndex: foundation.z.modal
        },
        drawer: {
            backdrop: semantic.surface.overlay,
            surface: semantic.surface.raised,
            border: semantic.border.subtle,
            shadow: foundation.shadow.floating,
            width: "24rem",
            zIndex: foundation.z.modal
        },
        emptyState: {
            background: semantic.surface.subtle,
            border: semantic.border.subtle,
            titleText: semantic.text.primary,
            messageText: semantic.text.secondary,
            radius: foundation.radius.lg
        },
        loadingState: {
            indicator: semantic.action.primary,
            track: semantic.surface.subtle,
            text: semantic.text.secondary,
            radius: foundation.radius.pill
        },
        tooltip: {
            background: semantic.surface.inverse,
            text: semantic.text.inverse,
            radius: foundation.radius.md,
            shadow: foundation.shadow.medium,
            zIndex: foundation.z.overlay
        },
        toast: {
            background: semantic.surface.raised,
            text: semantic.text.primary,
            border: semantic.border.subtle,
            shadow: foundation.shadow.floating,
            radius: foundation.radius.lg,
            infoBorder: semantic.feedback.info,
            successBorder: semantic.feedback.success,
            warningBorder: semantic.feedback.warning,
            errorBorder: semantic.feedback.error,
            zIndex: foundation.z.toast
        },
        dataTable: {
            headerBackground: semantic.surface.subtle,
            rowBackground: semantic.surface.default,
            rowHoverBackground: semantic.surface.subtle,
            border: semantic.border.subtle,
            text: semantic.text.primary,
            captionText: semantic.text.secondary,
            radius: foundation.radius.lg
        },
        tabs: {
            // F7/F8: active-tab roles/metrics resolved per theme (base render = current).
            activeText: tabsResolved.activeText,
            activeBackground: tabsResolved.activeBackground,
            // G2: resting-tab fill (default transparent; DSFR = light grey-blue).
            inactiveBackground: tabsResolved.inactiveBackground,
            activeWeight: tabsResolved.activeWeight,
            inactiveText: semantic.text.secondary,
            border: semantic.border.subtle,
            indicator: semantic.action.primary,
            panelBackground: semantic.surface.default,
            tabPaddingBlock: tabsResolved.paddingBlock,
            tabPaddingInline: tabsResolved.paddingInline,
            tabFontSize: tabsResolved.fontSize,
            tabLineHeight: tabsResolved.lineHeight,
            activeBorderTopWidth: tabsResolved.activeBorderTopWidth,
            activeBorderBottomWidth: tabsResolved.activeBorderBottomWidth,
            activeShadow: tabsResolved.activeShadow,
            anatomy: tabsAnatomy
        },
        pagination: {
            // Existing leaves keep their names (consumers/docs unchanged); they now
            // resolve through `paginationOf` (identical defaults = unchanged base).
            background: paginationResolved.background,
            border: paginationResolved.border,
            text: paginationResolved.text,
            activeBackground: paginationResolved.activeBackground,
            activeText: paginationResolved.activeText,
            disabledText: paginationResolved.disabledText,
            radius: paginationResolved.radius,
            // F10 additive leaves — per-theme active-page metrics (base = unchanged).
            borderWidth: paginationResolved.borderWidth,
            activeBorder: paginationResolved.activeBorder,
            activeBorderWidth: paginationResolved.activeBorderWidth,
            activeWeight: paginationResolved.activeWeight,
            paddingBlock: paginationResolved.paddingBlock,
            paddingInline: paginationResolved.paddingInline,
            minSize: paginationResolved.minSize,
            fontSize: paginationResolved.fontSize,
            lineHeight: paginationResolved.lineHeight,
            letterSpacing: paginationResolved.letterSpacing
        },
        paginationNav: {
            // Phase 2 aliases for the ellipsis/previous/next pagination control. These
            // mirror `pagination` where the visual role is identical and use the shared
            // control hover colour for the interactive page/nav buttons.
            background: paginationResolved.background,
            border: paginationResolved.border,
            radius: paginationResolved.radius,
            text: paginationResolved.text,
            hoverBackground: semantic.surface.subtle,
            activeBackground: paginationResolved.activeBackground,
            activeText: paginationResolved.activeText,
            disabledText: paginationResolved.disabledText,
            ellipsisText: semantic.text.muted
        },
        breadcrumb: {
            text: breadcrumbResolved.text,
            currentText: breadcrumbResolved.currentText,
            separator: breadcrumbResolved.separator,
            linkText: breadcrumbResolved.linkText,
            // F10 additive leaves — per-theme breadcrumb typography (base = unchanged).
            fontSize: breadcrumbResolved.fontSize,
            lineHeight: breadcrumbResolved.lineHeight,
            letterSpacing: breadcrumbResolved.letterSpacing,
            currentWeight: breadcrumbResolved.currentWeight
        },
        sideNav: {
            background: semantic.surface.default,
            border: semantic.border.subtle,
            itemText: semantic.text.secondary,
            activeBackground: semantic.surface.subtle,
            activeText: semantic.text.primary,
            width: "16rem"
        },
        selectableRow: {
            // UAT8 — selected list-item colours (tinted surface + accent bar + a
            // contrast-safe darker text), derived from action.primary per theme.
            selectedBackground: selectableRowResolved.selectedBackground,
            selectedAccent: selectableRowResolved.selectedAccent,
            selectedText: selectableRowResolved.selectedText,
            // Dark-mode-safe variants (emitted now so a future dark theme inherits them).
            selectedBackgroundDark: selectableRowResolved.selectedBackgroundDark,
            selectedAccentDark: selectableRowResolved.selectedAccentDark,
            selectedTextDark: selectableRowResolved.selectedTextDark
        },
        chat: {
            userBubbleBackground: semantic.action.primary,
            userBubbleText: semantic.action.primaryText,
            assistantBubbleBackground: semantic.surface.subtle,
            assistantBubbleText: semantic.text.primary,
            composerSurface: semantic.surface.raised,
            toolCallSurface: semantic.surface.subtle
        },
        graph: {
            panelBackground: semantic.surface.inverse,
            panelText: semantic.text.inverse,
            edgeDefault: "rgb(226 232 240 / 0.56)",
            community1: semantic.data.category1,
            community2: semantic.data.category2,
            community3: semantic.data.category3,
            community4: semantic.data.category4
        }
    };
}
const component = createComponent(semantic, foundation);

function flattenTokens(tree, prefix = []) {
    const output = {};
    for (const [key, value] of Object.entries(tree)) {
        if (value === undefined)
            continue;
        const path = [...prefix, key];
        if (typeof value === "object" && value !== null) {
            Object.assign(output, flattenTokens(value, path));
        }
        else {
            output[path.join("-")] = value;
        }
    }
    return output;
}
function toCssVariables(tree, selector = ":root", namespace = "st") {
    const entries = Object.entries(flattenTokens(tree));
    const lines = [];
    for (const [name, value] of entries) {
        lines.push(`  --${namespace}-${name}: ${String(value)};`);
        // Les composants consomment la couche foundation sous des noms COURTS
        // (--st-font-sans, --st-radius-md, --st-spacing-2, --st-shadow-medium,
        // --st-motion-fast, --st-z-*…) tandis que l'arbre l'expose sous
        // --st-foundation-*. On émet donc aussi l'alias court pour que la
        // typographie / le radius / l'espacement / le motion suivent le thème.
        // Additif : les noms pleinement qualifiés --st-foundation-* restent émis.
        if (name.startsWith("foundation-")) {
            const short = name.slice("foundation-".length);
            lines.push(`  --${namespace}-${short}: ${String(value)};`);
            // Alias z-index : la couche `z` est consommée comme --st-zindex-*.
            if (short.startsWith("z-")) {
                lines.push(`  --${namespace}-zindex-${short.slice(2)}: ${String(value)};`);
            }
        }
    }
    return `${selector} {\n${lines.join("\n")}\n}\n`;
}

function html(value) {
  var html2 = String(value ?? "");
  var open = "<!---->";
  return open + html2 + "<!---->";
}
function assertTenantTheme(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Theme must be an object");
  }
  const theme = input;
  if (typeof theme.id !== "string" || theme.id.trim().length === 0) {
    throw new Error("Theme id is required");
  }
  if (typeof theme.label !== "string" || theme.label.trim().length === 0) {
    throw new Error("Theme label is required");
  }
  if (theme.mode !== "light" && theme.mode !== "dark") {
    throw new Error("Theme mode must be light or dark");
  }
  if (!theme.tokens || typeof theme.tokens !== "object") {
    throw new Error("Theme tokens are required");
  }
}
function compileTheme(input, options = {}) {
  assertTenantTheme(input);
  const theme = input;
  const selector = options.selector ?? `[data-st-theme="${theme.id}"]`;
  const namespace = options.namespace ?? "st";
  return toCssVariables(theme.tokens, selector, namespace);
}
const sentTechTheme = {
  id: "sent-tech",
  label: "Sent Tech",
  mode: "light",
  tokens: {
    foundation,
    semantic,
    component
  }
};
const entropicSemantic = {
  ...semantic,
  action: {
    ...semantic.action,
    primary: "oklch(50% 0.134 242.749)",
    primaryText: semantic.action.primaryText
  }
};
const entropicComponent = createComponent(entropicSemantic, foundation);
const entropicTheme = {
  id: "entropic",
  label: "Entropic",
  mode: "light",
  tokens: {
    foundation,
    semantic: entropicSemantic,
    component: {
      ...entropicComponent,
      chat: {
        ...entropicComponent.chat,
        composerSurface: entropicSemantic.surface.raised,
        toolCallSurface: entropicSemantic.surface.subtle
      }
    }
  }
};
function ThemeProvider($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { theme = sentTechTheme, namespace = "st", children } = $$props;
    let css = derived(() => compileTheme(theme, { selector: `[data-st-theme="${theme.id}"]`, namespace }));
    head("1lrpa8r", $$renderer2, ($$renderer3) => {
      $$renderer3.push(`${html(`<style data-st-theme-provider="${theme.id}">${css()}</style>`)}`);
    });
    $$renderer2.push(`<div${attr("data-st-theme", theme.id)}>`);
    children?.($$renderer2);
    $$renderer2.push(`<!----></div>`);
  });
}
function _layout($$renderer, $$props) {
  let { children } = $$props;
  ThemeProvider($$renderer, {
    theme: entropicTheme,
    children: ($$renderer2) => {
      children($$renderer2);
      $$renderer2.push(`<!---->`);
    }
  });
}

export { _layout as default };
//# sourceMappingURL=_layout.svelte.js-D_Rgb6oH.js.map
