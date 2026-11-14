import { a as derived, c as head, h as attr, p as html } from "../../chunks/server2.js";
// node_modules/@sentropic/design-system-tokens/dist/foundation.js
var foundation = {
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
	borderWidth: {
		none: "0",
		thin: "1px",
		thick: "2px"
	},
	borderStyle: { solid: "solid" },
	density: {
		sm: {
			controlHeight: "2rem",
			paddingBlock: "0",
			paddingInline: "0.75rem",
			gap: "0.375rem",
			minWidth: "2rem"
		},
		md: {
			controlHeight: "2.5rem",
			paddingBlock: "0",
			paddingInline: "1rem",
			gap: "0.5rem",
			minWidth: "2.5rem"
		},
		lg: {
			controlHeight: "3rem",
			paddingBlock: "0",
			paddingInline: "1.25rem",
			gap: "0.5rem",
			minWidth: "3rem"
		}
	},
	typography: {
		control: {
			family: "var(--st-font-sans)",
			size: "0.9375rem",
			weight: "600",
			lineHeight: "1.2",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
		field: {
			family: "var(--st-font-sans)",
			size: "1rem",
			weight: "400",
			lineHeight: "1.5",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
		label: {
			family: "var(--st-font-sans)",
			size: "0.875rem",
			weight: "600",
			lineHeight: "1.4",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
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
	disabledOpacity: "0.55",
	transition: {
		property: "background-color, border-color, color, box-shadow, outline-color",
		duration: "120ms",
		easing: "cubic-bezier(0.4, 0, 0.2, 1)"
	},
	cursor: {
		interactive: "pointer",
		disabled: "not-allowed",
		text: "text"
	},
	iconSize: {
		sm: "1rem",
		md: "1.125rem",
		lg: "1.25rem"
	},
	focus: {
		strategy: "outline",
		width: "2px",
		offset: "2px",
		color: "var(--st-semantic-border-interactive)",
		inset: "0"
	},
	field: {
		style: "outline",
		fillBg: "var(--st-semantic-surface-default)",
		underlineColor: "var(--st-semantic-border-strong)",
		underlineWidth: "1px"
	}
};
// node_modules/@sentropic/design-system-tokens/dist/semantic.js
var semantic = {
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
		primaryHover: foundation.color.blue[80],
		primaryText: foundation.color.slate[0],
		secondary: foundation.color.slate[10],
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
// node_modules/@sentropic/design-system-tokens/dist/component.js
var FALLBACK = {
	borderWidth: {
		none: "0",
		thin: "1px",
		thick: "2px"
	},
	borderStyle: "solid",
	density: {
		sm: {
			controlHeight: "2rem",
			paddingBlock: "0",
			paddingInline: "0.75rem",
			gap: "0.375rem",
			minWidth: "2rem",
			fontSize: "0.875rem"
		},
		md: {
			controlHeight: "2.5rem",
			paddingBlock: "0",
			paddingInline: "1rem",
			gap: "0.5rem",
			minWidth: "2.5rem",
			fontSize: "0.9375rem"
		},
		lg: {
			controlHeight: "3rem",
			paddingBlock: "0",
			paddingInline: "1.25rem",
			gap: "0.5rem",
			minWidth: "3rem",
			fontSize: "1rem"
		}
	},
	typography: {
		control: {
			family: "var(--st-font-sans)",
			size: "0.9375rem",
			weight: "600",
			lineHeight: "1.2",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
		field: {
			family: "var(--st-font-sans)",
			size: "1rem",
			weight: "400",
			lineHeight: "1.5",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
		label: {
			family: "var(--st-font-sans)",
			size: "0.875rem",
			weight: "600",
			lineHeight: "1.4",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "none",
			decorationThickness: "auto",
			decorationOffset: "auto"
		},
		link: {
			family: "inherit",
			size: "inherit",
			weight: "inherit",
			lineHeight: "inherit",
			letterSpacing: "0",
			textTransform: "none",
			textDecoration: "underline",
			decorationThickness: "auto",
			decorationOffset: "0.18em",
			decorationThicknessHover: "auto",
			decorationOffsetHover: "0.18em",
			textDecorationHover: "underline"
		}
	},
	disabledOpacity: "0.55",
	transition: {
		property: "background-color, border-color, color, box-shadow, outline-color",
		duration: "120ms",
		easing: "cubic-bezier(0.4, 0, 0.2, 1)"
	},
	cursor: {
		interactive: "pointer",
		disabled: "not-allowed",
		text: "text"
	},
	iconSize: {
		sm: "1rem",
		md: "1.125rem",
		lg: "1.25rem"
	},
	focus: {
		strategy: "outline",
		width: "2px",
		offset: "2px",
		color: "var(--st-semantic-border-interactive)",
		inset: "0"
	},
	field: {
		style: "outline",
		fillBg: "",
		underlineColor: "",
		underlineWidth: "1px",
		radiusTop: "",
		radiusBottom: "",
		selectAppearance: "auto",
		selectChevron: "none",
		selectPaddingRight: "2rem"
	}
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
	const onTop = indicatorSide === "top";
	const isShadow = indicatorMode === "shadow";
	const shadowOffset = onTop ? indicatorWidth : `-${indicatorWidth}`;
	return {
		activeText: t.activeText || activeTextDefault,
		activeBackground: t.activeBackground || "transparent",
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
	const box = `${thin} ${borderStyle} ${semantic.border.subtle}`;
	return {
		background: a.background || semantic.surface.raised,
		text: a.text || semantic.text.primary,
		borderTop: a.borderTop || box,
		borderRight: a.borderRight || box,
		borderBottom: a.borderBottom || box,
		accentWidth: a.accentWidth ?? "0.25rem",
		filetWidth: a.filetWidth ?? "0",
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
		paddingBlock: a.paddingBlock ?? "0.875rem",
		paddingInline: a.paddingInline ?? "0.5rem",
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
		paddingBlock: t.paddingBlock ?? "0.25rem",
		paddingInline: t.paddingInline ?? "0.625rem",
		fontSize: t.fontSize ?? "0.75rem",
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
		paddingBlock: b.paddingBlock ?? "0.25rem",
		paddingInline: b.paddingInline ?? "0.5rem",
		fontSize: b.fontSize ?? "0.75rem",
		fontWeight: b.fontWeight ?? "650",
		lineHeight: b.lineHeight ?? "1",
		letterSpacing: b.letterSpacing ?? "normal",
		textTransform: b.textTransform ?? "none",
		minHeight: b.minHeight ?? "0",
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
		labelFontSize: c.labelFontSize ?? "0.9375rem",
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
		paddingInline,
		paddingLeft: s.paddingLeft ?? paddingInline,
		paddingRight: s.paddingRight ?? paddingInline,
		fontSize: s.fontSize ?? "1rem",
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
		trackPadding: t.trackPadding ?? "0.125rem",
		trackWidth: t.trackWidth ?? "2.25rem",
		trackHeight: t.trackHeight ?? "1.25rem",
		thumbSize: t.thumbSize ?? "1rem",
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
		selectedText: s.selectedText || `color-mix(in oklch, ${primary} 78%, black)`,
		selectedBackgroundDark: s.selectedBackgroundDark || `color-mix(in oklch, ${primary} 22%, transparent)`,
		selectedAccentDark: s.selectedAccentDark || primary,
		selectedTextDark: s.selectedTextDark || `color-mix(in oklch, ${primary} 70%, white)`
	};
}
function typographyOf(f, role) {
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
	const strategy = themed.strategy ?? base.strategy;
	const width = themed.width ?? base.width;
	const offset = themed.offset ?? base.offset;
	const color = themed.color ?? base.color;
	const inset = themed.inset ?? base.inset;
	let outline = "none";
	let boxShadow = "none";
	switch (strategy) {
		case "outline":
			outline = `${width} solid ${color}`;
			break;
		case "ring":
			boxShadow = `0 0 0 ${width} ${color}`;
			break;
		case "inset":
			boxShadow = `inset 0 0 0 ${width} ${color}`;
			break;
		case "double":
			outline = `${width} solid ${color}`;
			boxShadow = `0 0 0 ${inset} #ffffff`;
	}
	return {
		strategy,
		width,
		offset,
		color,
		inset,
		outline,
		boxShadow
	};
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
	const style = themed.style ?? FALLBACK.field.style;
	const thin = bw.thin ?? "1px";
	const selectLeaves = {
		selectAppearance: themed.selectAppearance ?? FALLBACK.field.selectAppearance,
		selectChevron: themed.selectChevron ?? FALLBACK.field.selectChevron,
		selectPaddingRight: themed.selectPaddingRight ?? FALLBACK.field.selectPaddingRight
	};
	const radiusTop = themed.radiusTop || shapeRadius;
	const radiusBottom = themed.radiusBottom || shapeRadius;
	const composeFocus = (underline) => {
		const ring = focusBoxShadow && focusBoxShadow !== "none" ? focusBoxShadow : "";
		if (underline === "none") return ring || "none";
		if (!ring) return underline;
		return `${ring}, ${underline}`;
	};
	if (style === "filled-underline") {
		const fillBg = themed.fillBg || semantic.surface.subtle;
		const underlineColor = themed.underlineColor || semantic.border.strong;
		const underlineWidth = themed.underlineWidth || thin;
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
	const bw = {
		...FALLBACK.borderWidth,
		...foundation.borderWidth ?? {}
	};
	const borderStyle = foundation.borderStyle?.solid ?? FALLBACK.borderStyle;
	const disabledOpacity = foundation.disabledOpacity ?? FALLBACK.disabledOpacity;
	({
		...FALLBACK.cursor,
		...foundation.cursor ?? {}
	});
	const icon = {
		...FALLBACK.iconSize,
		...foundation.iconSize ?? {}
	};
	const focus = focusOf(foundation);
	const buttonAnatomy = {
		shape: {
			radius: foundation.radius.md,
			borderWidth: bw.thin,
			borderStyle
		},
		density: {
			sm: buttonDensityOf(foundation, "sm"),
			md: buttonDensityOf(foundation, "md"),
			lg: buttonDensityOf(foundation, "lg")
		},
		typography: typographyOf(foundation, "control"),
		focus,
		icon: {
			size: icon.md,
			gap: densityOf(foundation, "md").gap
		},
		states: {
			hover: {
				bg: semantic.action.primaryHover ?? semantic.action.primary,
				transform: "none"
			},
			active: { transform: "none" },
			disabled: { opacity: disabledOpacity }
		}
	};
	const inputAnatomy = {
		shape: {
			radius: foundation.radius.md,
			borderWidth: bw.thin,
			borderStyle
		},
		density: {
			sm: densityOf(foundation, "sm"),
			md: densityOf(foundation, "md"),
			lg: densityOf(foundation, "lg")
		},
		typography: typographyOf(foundation, "field"),
		focus,
		field: fieldOf(semantic, foundation, bw, borderStyle, foundation.radius.md, focus.boxShadow),
		states: {
			hover: { border: semantic.border.strong },
			focus: { border: semantic.border.interactive },
			disabled: {
				bg: semantic.surface.subtle,
				text: semantic.text.muted
			}
		}
	};
	const linkTypography = typographyOf(foundation, "link");
	const linkAnatomy = {
		shape: {
			radius: foundation.radius.sm ?? foundation.radius.md,
			borderWidth: bw.none,
			borderStyle
		},
		typography: linkTypography,
		focus,
		states: {
			hover: {
				text: semantic.action.primary,
				decoration: linkTypography.textDecorationHover ?? "underline"
			},
			disabled: {
				text: semantic.text.muted,
				decoration: "none",
				opacity: disabledOpacity
			}
		}
	};
	const cardBorderWidth = foundation.card?.borderWidth ?? bw.thin;
	const cardBackground = foundation.card?.background || semantic.surface.raised;
	const cardHoverBackground = foundation.card?.hoverBackground || cardBackground;
	const cardTypography = {
		...typographyOf(foundation, "field"),
		size: foundation.card?.fontSize ?? "inherit",
		lineHeight: foundation.card?.lineHeight ?? "normal",
		letterSpacing: foundation.card?.letterSpacing ?? "normal"
	};
	const cardAnatomy = {
		shape: {
			radius: foundation.radius.lg,
			borderWidth: cardBorderWidth,
			borderStyle
		},
		typography: cardTypography,
		focus,
		states: { hover: {
			bg: cardHoverBackground,
			transform: "translateY(-1px)"
		} }
	};
	const tabsControlTypography = typographyOf(foundation, "control");
	const tabsAnatomy = {
		shape: {
			radius: foundation.radius.none ?? "0",
			borderWidth: bw.thin,
			borderStyle
		},
		density: { md: densityOf(foundation, "md") },
		typography: tabsControlTypography,
		focus,
		states: {
			hover: { text: semantic.text.primary },
			disabled: { opacity: disabledOpacity }
		}
	};
	const tabsResolved = tabsOf(foundation, tabsControlTypography, bw.thin, semantic.action.primary, semantic.text.primary);
	const buttonSecondary = buttonSecondaryOf(semantic, foundation);
	const paginationResolved = paginationOf(semantic, foundation, bw.thin, foundation.radius.md);
	const breadcrumbResolved = breadcrumbOf(semantic, foundation);
	const alertResolved = alertOf(semantic, foundation, bw.thin, borderStyle);
	const accordionResolved = accordionOf(semantic, foundation);
	const tagResolved = tagOf(semantic, foundation);
	const badgeResolved = badgeOf(semantic, foundation);
	const choiceResolved = choiceOf(semantic, foundation);
	const searchResolved = searchOf(foundation);
	const toggleResolved = toggleOf(semantic, foundation);
	const selectableRowResolved = selectableRowOf(semantic, foundation);
	return {
		button: {
			radius: foundation.radius.md,
			primaryBackground: semantic.action.primary,
			primaryText: semantic.action.primaryText,
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
			background: alertResolved.background,
			text: alertResolved.text,
			border: semantic.border.subtle,
			infoBorder: alertResolved.accentInfo,
			successBorder: alertResolved.accentSuccess,
			warningBorder: alertResolved.accentWarning,
			errorBorder: alertResolved.accentError,
			radius: foundation.radius.lg,
			borderTop: alertResolved.borderTop,
			borderRight: alertResolved.borderRight,
			borderBottom: alertResolved.borderBottom,
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
			text: accordionResolved.text,
			paddingBlock: accordionResolved.paddingBlock,
			paddingInline: accordionResolved.paddingInline,
			fontSize: accordionResolved.fontSize,
			fontWeight: accordionResolved.fontWeight,
			lineHeight: accordionResolved.lineHeight
		},
		tag: {
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
			switchTrack: toggleResolved.trackColor,
			switchTrackChecked: toggleResolved.trackCheckedColor,
			switchThumb: toggleResolved.thumbColor,
			choiceLabelFontSize: choiceResolved.labelFontSize,
			choiceLabelLineHeight: choiceResolved.labelLineHeight,
			choiceRadioLineHeight: choiceResolved.radioLineHeight,
			choiceLabelLetterSpacing: choiceResolved.labelLetterSpacing,
			choiceLabelColor: choiceResolved.labelColor,
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
			activeText: tabsResolved.activeText,
			activeBackground: tabsResolved.activeBackground,
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
			background: paginationResolved.background,
			border: paginationResolved.border,
			text: paginationResolved.text,
			activeBackground: paginationResolved.activeBackground,
			activeText: paginationResolved.activeText,
			disabledText: paginationResolved.disabledText,
			radius: paginationResolved.radius,
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
			selectedBackground: selectableRowResolved.selectedBackground,
			selectedAccent: selectableRowResolved.selectedAccent,
			selectedText: selectableRowResolved.selectedText,
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
var component = createComponent(semantic, foundation);
// node_modules/@sentropic/design-system-tokens/dist/css.js
function flattenTokens(tree, prefix = []) {
	const output = {};
	for (const [key, value] of Object.entries(tree)) {
		if (value === void 0) continue;
		const path = [...prefix, key];
		if (typeof value === "object" && value !== null) Object.assign(output, flattenTokens(value, path));
		else output[path.join("-")] = value;
	}
	return output;
}
function toCssVariables(tree, selector = ":root", namespace = "st") {
	const entries = Object.entries(flattenTokens(tree));
	const lines = [];
	for (const [name, value] of entries) {
		lines.push(`  --${namespace}-${name}: ${String(value)};`);
		if (name.startsWith("foundation-")) {
			const short = name.slice(11);
			lines.push(`  --${namespace}-${short}: ${String(value)};`);
			if (short.startsWith("z-")) lines.push(`  --${namespace}-zindex-${short.slice(2)}: ${String(value)};`);
		}
	}
	return `${selector} {\n${lines.join("\n")}\n}\n`;
}
// node_modules/@sentropic/design-system-themes/dist/schema.js
function assertTenantTheme(input) {
	if (!input || typeof input !== "object") throw new Error("Theme must be an object");
	const theme = input;
	if (typeof theme.id !== "string" || theme.id.trim().length === 0) throw new Error("Theme id is required");
	if (typeof theme.label !== "string" || theme.label.trim().length === 0) throw new Error("Theme label is required");
	if (theme.mode !== "light" && theme.mode !== "dark") throw new Error("Theme mode must be light or dark");
	if (!theme.tokens || typeof theme.tokens !== "object") throw new Error("Theme tokens are required");
}
// node_modules/@sentropic/design-system-themes/dist/compile.js
function compileTheme(input, options = {}) {
	assertTenantTheme(input);
	const theme = input;
	const selector = options.selector ?? `[data-st-theme="${theme.id}"]`;
	const namespace = options.namespace ?? "st";
	return toCssVariables(theme.tokens, selector, namespace);
}
// node_modules/@sentropic/design-system-themes/dist/themes/sent-tech.js
var sentTechTheme = {
	id: "sent-tech",
	label: "Sent Tech",
	mode: "light",
	tokens: {
		foundation,
		semantic,
		component
	}
};
// node_modules/@sentropic/design-system-themes/dist/themes/entropic.js
var entropicSemantic = {
	...semantic,
	action: {
		...semantic.action,
		primary: "oklch(50% 0.134 242.749)",
		primaryText: semantic.action.primaryText
	}
};
var entropicComponent = createComponent(entropicSemantic, foundation);
var entropicTheme = {
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
// node_modules/@sentropic/design-system-svelte/dist/ThemeProvider.svelte
function ThemeProvider($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { theme = sentTechTheme, namespace = "st", children } = $$props;
		let css = derived(() => compileTheme(theme, {
			selector: `[data-st-theme="${theme.id}"]`,
			namespace
		}));
		head("1lrpa8r", $$renderer, ($$renderer) => {
			$$renderer.push(`${html(`<style data-st-theme-provider="${theme.id}">${css()}</style>`)}`);
		});
		$$renderer.push(`<div${attr("data-st-theme", theme.id)}>`);
		children?.($$renderer);
		$$renderer.push(`<!----></div>`);
	});
}
// src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	let { children } = $$props;
	ThemeProvider($$renderer, {
		theme: entropicTheme,
		children: ($$renderer) => {
			children($$renderer);
			$$renderer.push(`<!---->`);
		},
		$$slots: { default: true }
	});
}
export { _layout as default };

//# sourceMappingURL=_layout.svelte.js.map