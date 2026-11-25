/**
 * Theme CSS validation and root custom-property discovery for portable Focus HTML surfaces.
 *
 * Security & portability contract:
 * - Bounded size (256 KiB max) to keep offline portable dossiers self-contained and fast.
 * - Rejects `@import`, external/non-`data:` `url(...)` references, `</style` breakouts, and NUL bytes.
 * - Does not relax the host CSP (`style-src 'unsafe-inline'` already permits inline `<style>`).
 */
/** Maximum allowed size (256 KiB) for an inlined theme CSS file. */
export const FOCUS_THEME_MAX_CSS_BYTES = 256 * 1024;
const THEME_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const CONDITIONAL_AT_RULES = new Set([
    "media",
    "supports",
    "layer",
    "container",
    "scope",
    "document",
]);
const isWhitespace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
const isIdentStart = (ch) => (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "-" ||
    ch.charCodeAt(0) >= 0x80;
const isHexDigit = (ch) => (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
const decodeCssEscape = (src, backslashIndex) => {
    const next = backslashIndex + 1;
    if (next >= src.length)
        return { char: "\uFFFD", next };
    const first = src[next];
    if (first === "\n" || first === "\r" || first === "\f") {
        return { char: "", next: first === "\r" && src[next + 1] === "\n" ? next + 2 : next + 1 };
    }
    if (isHexDigit(first)) {
        let end = next;
        while (end < src.length && end - next < 6 && isHexDigit(src[end]))
            end += 1;
        const codePoint = Number.parseInt(src.slice(next, end), 16);
        if (end < src.length && isWhitespace(src[end])) {
            end += src[end] === "\r" && src[end + 1] === "\n" ? 2 : 1;
        }
        const safe = codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? "\uFFFD"
            : String.fromCodePoint(codePoint);
        return { char: safe, next: end };
    }
    return { char: first, next: next + 1 };
};
const readCssIdent = (src, start) => {
    let i = start;
    let value = "";
    while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
            const decoded = decodeCssEscape(src, i);
            value += decoded.char;
            i = decoded.next;
        }
        else if (isIdentStart(ch)) {
            value += ch;
            i += 1;
        }
        else {
            break;
        }
    }
    return { value, end: i };
};
const readCssStringEnd = (src, openIndex) => {
    const quote = src[openIndex];
    let i = openIndex + 1;
    let value = "";
    while (i < src.length) {
        const ch = src[i];
        if (ch === quote)
            return { value, end: i + 1 };
        if (ch === "\\") {
            const decoded = decodeCssEscape(src, i);
            value += decoded.char;
            i = decoded.next;
        }
        else if (ch === "\n" || ch === "\r" || ch === "\f") {
            return null;
        }
        else {
            value += ch;
            i += 1;
        }
    }
    return null;
};
const readUrlTarget = (src, openParenIndex) => {
    let i = openParenIndex + 1;
    while (i < src.length && isWhitespace(src[i]))
        i += 1;
    if (i >= src.length)
        return null;
    const first = src[i];
    if (first === '"' || first === "'") {
        const str = readCssStringEnd(src, i);
        if (!str)
            return null;
        let j = str.end;
        while (j < src.length && isWhitespace(src[j]))
            j += 1;
        if (src[j] !== ")")
            return null;
        return { target: str.value.trim(), end: j + 1 };
    }
    let value = "";
    while (i < src.length) {
        const ch = src[i];
        if (ch === ")")
            return { target: value.trim(), end: i + 1 };
        if (ch === "\\") {
            const decoded = decodeCssEscape(src, i);
            value += decoded.char;
            i = decoded.next;
        }
        else if (ch === '"' || ch === "'" || ch === "(") {
            return null;
        }
        else {
            value += ch;
            i += 1;
        }
    }
    return null;
};
/** Validate a theme identifier placed in `data-theme="<id>"`. */
export const validateThemeId = (themeId) => {
    if (typeof themeId !== "string" || !THEME_ID_RE.test(themeId)) {
        throw new Error(`Invalid theme id "${String(themeId)}": expected 1–64 chars matching ${THEME_ID_RE.source}`);
    }
    return themeId;
};
const matchUrlCall = (src, index) => {
    const ch = src[index];
    if (ch !== "\\" && !isIdentStart(ch))
        return null;
    const prev = index > 0 ? src[index - 1] : "";
    if (isIdentStart(prev))
        return null;
    const ident = readCssIdent(src, index);
    if (ident.value.toLowerCase() !== "url")
        return null;
    let parenIndex = ident.end;
    while (parenIndex < src.length && isWhitespace(src[parenIndex]))
        parenIndex += 1;
    if (src[parenIndex] !== "(")
        return null;
    const parsed = readUrlTarget(src, parenIndex);
    if (!parsed)
        return { target: "", end: -1 };
    return parsed;
};
/**
 * Validate theme CSS for strict offline CSP portability.
 * Returns the CSS string unchanged if valid; throws a descriptive `Error` otherwise.
 */
export const validateThemeCss = (css) => {
    if (typeof css !== "string") {
        throw new Error("Theme CSS must be a string.");
    }
    if (css.includes("\0")) {
        throw new Error("Theme CSS must not contain NUL bytes.");
    }
    const byteLength = new TextEncoder().encode(css).length;
    if (byteLength > FOCUS_THEME_MAX_CSS_BYTES) {
        throw new Error(`Theme CSS exceeds maximum size of ${FOCUS_THEME_MAX_CSS_BYTES} bytes (256 KiB): got ${byteLength} bytes.`);
    }
    // Check raw CSS before stripping comments: HTML closes `<style>` even inside `/* ... */`.
    if (/<\/style/i.test(css)) {
        throw new Error('Theme CSS must not contain the "</style" sequence.');
    }
    let i = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(css, i);
            i = str ? str.end : i + 1;
            continue;
        }
        if (ch === "/" && css[i + 1] === "*") {
            const close = css.indexOf("*/", i + 2);
            i = close === -1 ? css.length : close + 2;
            continue;
        }
        if (ch === "@") {
            const ident = readCssIdent(css, i + 1);
            if (ident.value.toLowerCase() === "import") {
                throw new Error('Theme CSS must not contain "@import" rules.');
            }
            i = Math.max(ident.end, i + 1);
            continue;
        }
        const urlMatch = matchUrlCall(css, i);
        if (urlMatch !== null) {
            if (urlMatch.end === -1) {
                throw new Error("Theme CSS contains a malformed or unclosed url(...) reference.");
            }
            if (!/^data:/i.test(urlMatch.target)) {
                throw new Error(`Theme CSS url(...) must only reference inline data: URLs (rejected: "${urlMatch.target.slice(0, 80)}").`);
            }
            i = urlMatch.end;
            continue;
        }
        if (ch === "\\" || isIdentStart(ch)) {
            i = Math.max(readCssIdent(css, i).end, i + 1);
            continue;
        }
        i += 1;
    }
    return css;
};
/** Strip CSS comments outside strings and `url(...)` tokens. */
const stripCssComments = (css) => {
    let out = "";
    let i = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(css, i);
            const end = str ? str.end : css.length;
            out += css.slice(i, end);
            i = end;
            continue;
        }
        if (ch === "/" && css[i + 1] === "*") {
            const close = css.indexOf("*/", i + 2);
            out += " ";
            i = close === -1 ? css.length : close + 2;
            continue;
        }
        const urlMatch = matchUrlCall(css, i);
        if (urlMatch !== null && urlMatch.end !== -1) {
            out += css.slice(i, urlMatch.end);
            i = urlMatch.end;
            continue;
        }
        if (ch === "\\" || isIdentStart(ch)) {
            const end = Math.max(readCssIdent(css, i).end, i + 1);
            out += css.slice(i, end);
            i = end;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
};
const splitTopLevel = (text, sep) => {
    const parts = [];
    let start = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(text, i);
            i = str ? str.end : text.length;
            continue;
        }
        if (ch === "(")
            parenDepth += 1;
        else if (ch === ")" && parenDepth > 0)
            parenDepth -= 1;
        else if (ch === "[")
            bracketDepth += 1;
        else if (ch === "]" && bracketDepth > 0)
            bracketDepth -= 1;
        else if (ch === sep && parenDepth === 0 && bracketDepth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
        i += 1;
    }
    parts.push(text.slice(start));
    return parts;
};
const extractSubjectSelector = (selector) => {
    let lastBoundary = -1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let i = 0;
    while (i < selector.length) {
        const ch = selector[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(selector, i);
            i = str ? str.end : selector.length;
            continue;
        }
        if (ch === "(")
            parenDepth += 1;
        else if (ch === ")" && parenDepth > 0)
            parenDepth -= 1;
        else if (ch === "[")
            bracketDepth += 1;
        else if (ch === "]" && bracketDepth > 0)
            bracketDepth -= 1;
        else if (parenDepth === 0 &&
            bracketDepth === 0 &&
            (isWhitespace(ch) || ch === ">" || ch === "+" || ch === "~")) {
            lastBoundary = i;
        }
        i += 1;
    }
    return selector.slice(lastBoundary + 1).trim();
};
const subjectTargetsRoot = (subject, themeId) => {
    if (subject === "")
        return false;
    const wrapped = /^:(?:is|where)\(([\s\S]+)\)$/i.exec(subject);
    if (wrapped) {
        return splitTopLevel(wrapped[1], ",").some((inner) => subjectTargetsRoot(extractSubjectSelector(inner.trim()), themeId));
    }
    const dataThemeMatches = [
        ...subject.matchAll(/\[\s*data-theme(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*\]/gi),
    ];
    for (const match of dataThemeMatches) {
        const attrVal = match[1] ?? match[2] ?? match[3];
        if (themeId === undefined)
            return false;
        if (attrVal !== undefined && attrVal !== themeId)
            return false;
    }
    if (themeId !== undefined && dataThemeMatches.length > 0) {
        return true;
    }
    const stripped = subject.replace(/\[[^\]]*\]/g, "");
    return /(?:^|(?<![a-zA-Z0-9_-]))(?::root|html)(?![a-zA-Z0-9_-])/i.test(stripped);
};
const selectorListTargetsRoot = (prelude, themeId) => splitTopLevel(prelude, ",").some((raw) => {
    const trimmed = raw.trim();
    if (trimmed === "")
        return false;
    return subjectTargetsRoot(extractSubjectSelector(trimmed), themeId);
});
const collectStDeclarations = (blockBody, out) => {
    let depth = 0;
    let i = 0;
    let topLevel = "";
    while (i < blockBody.length) {
        const ch = blockBody[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(blockBody, i);
            const end = str ? str.end : blockBody.length;
            if (depth === 0)
                topLevel += blockBody.slice(i, end);
            i = end;
            continue;
        }
        if (ch === "{")
            depth += 1;
        else if (ch === "}" && depth > 0)
            depth -= 1;
        else if (depth === 0)
            topLevel += ch;
        i += 1;
    }
    for (const match of topLevel.matchAll(/(?:^|[;\s])(--st-[a-zA-Z0-9_-]+)\s*:/g)) {
        out.add(match[1]);
    }
};
const walkCssBlocks = (src, themeId, out) => {
    let i = 0;
    let preludeStart = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '"' || ch === "'") {
            const str = readCssStringEnd(src, i);
            i = str ? str.end : src.length;
            continue;
        }
        if (ch === ";") {
            preludeStart = i + 1;
            i += 1;
            continue;
        }
        if (ch === "{") {
            const prelude = src.slice(preludeStart, i).trim();
            let depth = 1;
            let j = i + 1;
            while (j < src.length && depth > 0) {
                const inner = src[j];
                if (inner === '"' || inner === "'") {
                    const str = readCssStringEnd(src, j);
                    j = str ? str.end : src.length;
                    continue;
                }
                if (inner === "{")
                    depth += 1;
                else if (inner === "}")
                    depth -= 1;
                j += 1;
            }
            const body = src.slice(i + 1, depth === 0 ? j - 1 : j);
            if (prelude.startsWith("@")) {
                const atName = /^@([a-zA-Z-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
                if (CONDITIONAL_AT_RULES.has(atName)) {
                    walkCssBlocks(body, themeId, out);
                }
            }
            else if (selectorListTargetsRoot(prelude, themeId)) {
                collectStDeclarations(body, out);
            }
            preludeStart = j;
            i = j;
            continue;
        }
        i += 1;
    }
};
/**
 * Extract `--st-*` custom properties declared for the page root (`:root`, `html`, or
 * `[data-theme="<themeId>"]` when `themeId` is provided). Used by portable DS hosts so
 * root theme tokens inherit cleanly through `[data-st-theme]` wrappers.
 */
export const extractRootThemeCustomProperties = (css, themeId) => {
    const out = new Set();
    walkCssBlocks(stripCssComments(css), themeId, out);
    return [...out];
};
