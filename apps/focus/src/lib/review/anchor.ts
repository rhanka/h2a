// Anchor encode/decode/resolve — DS SPEC-r3 §2. Pure + DOM helpers, zero deps.
// sectionKey = "a1:" + base64url(JSON payload), cap 2048 chars (owner D3).
import type { AnchorPayload, Comment, ReviewThread, ThreadFilter } from './types';
import { ANCHOR_CAP, SECTION_PREFIX } from './types';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode an anchor into a `sectionKey`. Throws `ANCHOR_TOO_LONG` over the cap. */
export function encodeAnchor(payload: AnchorPayload): string {
  let current: AnchorPayload = payload;
  let encoded = SECTION_PREFIX + toBase64Url(JSON.stringify(current));
  if (encoded.length <= ANCHOR_CAP) return encoded;
  // Shorten quote context first (SPEC-r3 §2), then drop offsets.
  if (current.t === 'text') {
    current = {
      ...current,
      q: { exact: current.q.exact, prefix: current.q.prefix.slice(0, 8), suffix: current.q.suffix.slice(0, 8) }
    };
    encoded = SECTION_PREFIX + toBase64Url(JSON.stringify(current));
    if (encoded.length <= ANCHOR_CAP) return encoded;
    const { pos: _pos, ...rest } = current;
    current = rest as AnchorPayload;
    encoded = SECTION_PREFIX + toBase64Url(JSON.stringify(current));
    if (encoded.length <= ANCHOR_CAP) return encoded;
  }
  throw new Error('ANCHOR_TOO_LONG');
}

export function decodeAnchor(sectionKey: string | undefined | null): AnchorPayload | null {
  if (!sectionKey || !sectionKey.startsWith(SECTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(sectionKey.slice(SECTION_PREFIX.length))) as AnchorPayload;
    if (!parsed || typeof parsed !== 'object' || !('t' in parsed) || !('v' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function anchorLabel(anchor: AnchorPayload | null): string {
  if (!anchor) return 'Sans ancre';
  if (anchor.t === 'text') {
    const exact = anchor.q.exact.trim();
    return exact.length > 140 ? `${exact.slice(0, 140)}…` : exact || 'Sélection';
  }
  if (anchor.t === 'element') return anchor.aid ? `Élément ${anchor.aid}` : `Élément ${anchor.sel.split('>').pop()?.trim() ?? ''}`.trim() || 'Élément';
  return 'Zone du document';
}

/** CSS `nth-of-type` path from `root` (exclusive) to `el` (inclusive). */
export function cssPath(el: Element, root: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = [...parent.children].filter((c) => c.tagName === node!.tagName);
    const idx = siblings.indexOf(node) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    node = parent;
  }
  return parts.join(' > ');
}

function offsetInRoot(root: Element, range: Range, atStart: boolean): number {
  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(atStart ? range.startContainer : range.endContainer, atStart ? range.startOffset : range.endOffset);
  return probe.toString().length;
}

/** Build a text anchor from the current selection inside `root`, or `null`. */
export function createAnchorFromSelection(root: HTMLElement, version: string): AnchorPayload | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const exact = range.toString();
  if (!exact.trim()) return null;
  const full = root.textContent ?? '';
  const start = offsetInRoot(root, range, true);
  const end = offsetInRoot(root, range, false);
  const prefix = full.slice(Math.max(0, start - 32), start);
  const suffix = full.slice(end, end + 32);
  const anchorNode =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const aidEl = anchorNode?.closest('[data-anchor-id]');
  const aid = aidEl instanceof HTMLElement ? aidEl.dataset.anchorId : undefined;
  const selPath = anchorNode ? cssPath(anchorNode, root) : undefined;
  const payload: AnchorPayload = {
    t: 'text',
    q: { exact, prefix, suffix },
    pos: { start, end },
    ...(selPath ? { sel: selPath } : {}),
    ...(aid ? { aid } : {}),
    v: version
  };
  // Fail at compose time when the anchor cannot fit (SPEC-r3 §2).
  encodeAnchor(payload);
  return payload;
}

export function createAnchorFromElement(el: Element, root: Element, version: string): AnchorPayload {
  const aid = el instanceof HTMLElement ? el.dataset.anchorId : undefined;
  const onSelf = el.closest('[data-anchor-id]');
  const payload: AnchorPayload = {
    t: 'element',
    sel: cssPath(el, root),
    ...(aid ?? (onSelf instanceof HTMLElement ? onSelf.dataset.anchorId : undefined)
      ? { aid: aid ?? (onSelf as HTMLElement).dataset.anchorId }
      : {}),
    v: version
  };
  encodeAnchor(payload);
  return payload;
}

function findTextRange(root: HTMLElement, anchor: Extract<AnchorPayload, { t: 'text' }>): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const haystack = root.textContent ?? '';
  const candidates: number[] = [];
  let idx = haystack.indexOf(anchor.q.exact);
  while (idx !== -1) {
    const before = haystack.slice(Math.max(0, idx - 32), idx);
    const after = haystack.slice(idx + anchor.q.exact.length, idx + anchor.q.exact.length + 32);
    const score =
      (anchor.q.prefix && before.endsWith(anchor.q.prefix.slice(-Math.min(8, anchor.q.prefix.length))) ? 2 : 0) +
      (anchor.q.suffix && after.startsWith(anchor.q.suffix.slice(0, Math.min(8, anchor.q.suffix.length))) ? 2 : 0) -
      (anchor.pos ? Math.abs(idx - anchor.pos.start) / 10000 : 0);
    candidates.push(idx + score * 100000);
    idx = haystack.indexOf(anchor.q.exact, idx + 1);
  }
  if (candidates.length === 0) {
    // Whitespace/case-folded fuzzy fallback (SPEC-r3 §2 step 4).
    const folded = haystack.toLowerCase().replace(/\s+/g, ' ');
    const needle = anchor.q.exact.toLowerCase().replace(/\s+/g, ' ');
    const at = folded.indexOf(needle);
    if (at === -1) return null;
    candidates.push(at);
  }
  const best = candidates.sort((a, b) => b - a)[0] % 100000;
  let remaining = best;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, Math.min(len, remaining + anchor.q.exact.length));
      return range;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  return null;
}

export interface ResolvedAnchor {
  orphan: boolean;
  el?: Element;
  range?: Range;
  rect?: DOMRect;
}

/** Re-resolve an anchor against the live DOM (never writes back). Version change alone never orphans. */
export function resolveAnchor(root: HTMLElement, anchor: AnchorPayload | null): ResolvedAnchor {
  if (!anchor) return { orphan: true };
  if (anchor.t === 'region') return { orphan: false };
  if (anchor.aid) {
    const byAid = root.querySelector(`[data-anchor-id="${CSS.escape(anchor.aid)}"]`);
    if (byAid) {
      if (anchor.t === 'text') {
        const range = findTextRange(root, anchor);
        return { orphan: false, el: byAid, ...(range ? { range } : {}) };
      }
      return { orphan: false, el: byAid };
    }
  }
  if (anchor.t === 'text') {
    const range = findTextRange(root, anchor);
    if (range) {
      const el =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : (range.startContainer.parentElement ?? undefined);
      return { orphan: false, ...(el ? { el } : {}), range };
    }
    if (anchor.sel) {
      try {
        const el = root.querySelector(anchor.sel);
        if (el) return { orphan: false, el };
      } catch {
        /* invalid selector → orphan */
      }
    }
    return { orphan: true };
  }
  try {
    const el = root.querySelector(anchor.sel);
    return el ? { orphan: false, el } : { orphan: true };
  } catch {
    return { orphan: true };
  }
}

/** Sort pins by Y and enforce a minimum gap (SPEC-r3 `layoutPins`, gap 28px). */
export function layoutPins<T extends { top: number }>(items: T[], gap = 28): (T & { top: number })[] {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  let prev = -Infinity;
  return sorted.map((item) => {
    const top = Math.max(item.top, prev + gap);
    prev = top;
    return { ...item, top };
  });
}

export function groupThreads(comments: Comment[]): ReviewThread[] {
  const byThread = new Map<string, Comment[]>();
  for (const c of comments) {
    const list = byThread.get(c.threadId) ?? [];
    list.push(c);
    byThread.set(c.threadId, list);
  }
  const threads: ReviewThread[] = [...byThread.entries()].map(([threadId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const rootRow = sorted[0];
    const anchor = decodeAnchor(rootRow?.target.sectionKey);
    return {
      threadId,
      target: rootRow.target,
      comments: sorted,
      state: sorted.some((r) => r.state === 'open') || sorted.every((r) => r.state === 'open') ? (sorted[0].state ?? 'open') : sorted[0].state,
      anchor,
      anchorLabel: anchorLabel(anchor)
    };
  });
  // Thread state: closed only when every row is closed (close fans out to the thread).
  for (const t of threads) t.state = t.comments.every((c) => c.state === 'closed') ? 'closed' : 'open';
  return threads.sort((a, b) => (a.comments[0]?.createdAt ?? '').localeCompare(b.comments[0]?.createdAt ?? ''));
}

export function filterThreads(threads: ReviewThread[], filter: ThreadFilter, currentUserId: string): ReviewThread[] {
  if (filter === 'all') return threads;
  if (filter === 'open') return threads.filter((t) => t.state === 'open');
  if (filter === 'resolved') return threads.filter((t) => t.state === 'closed');
  return threads.filter((t) => t.comments.some((c) => c.author.id === currentUserId));
}

export function isUnread(thread: ReviewThread, lastReadAt: string | undefined, currentUserId: string): boolean {
  if (!lastReadAt) return thread.comments.some((c) => c.author.id !== currentUserId);
  return thread.comments.some((c) => c.author.id !== currentUserId && c.createdAt > lastReadAt);
}
