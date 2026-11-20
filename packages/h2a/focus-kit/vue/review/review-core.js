/**
 * Cadre neutre du kit revue (SPEC DS r3 §1-§3), zéro dépendance.
 * Le kit DS `packages/review-core` n'est pas encore publié : cette copie
 * locale suit les mêmes noms et la même sémantique, derrière les mêmes props.
 */
export const ANCHOR_CAP = 2048;
const PREFIX = 'a1:';

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode un payload d'ancre en `sectionKey` (`a1:` + base64url JSON). */
export function encodeAnchor(payload) {
  return PREFIX + toBase64Url(JSON.stringify(payload));
}

/** Décode un `sectionKey` ; retourne `null` si ce n'est pas une ancre a1. */
export function decodeAnchor(sectionKey) {
  if (typeof sectionKey !== 'string' || !sectionKey.startsWith(PREFIX)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(sectionKey.slice(PREFIX.length)));
    if (!payload || typeof payload !== 'object' || typeof payload.t !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Vrai si le `sectionKey` encodé tient sous le plafond D3 (2048 caractères). */
export function fitsAnchorCap(sectionKey) {
  return typeof sectionKey === 'string' && sectionKey.length <= ANCHOR_CAP;
}

/**
 * Encode en raccourcissant d'abord le contexte de citation (préfixe/suffixe,
 * puis l'extrait) jusqu'à tenir sous le plafond. Lève si même le squelette
 * dépasse — l'appelant rejette alors la composition, jamais d'échec silencieux.
 */
export function encodeAnchorCapped(payload) {
  let candidate = { ...payload, q: payload.q ? { ...payload.q } : undefined };
  let encoded = encodeAnchor(candidate);
  // Chaque passe réduit strictement la taille encodée, ou lève.
  while (encoded.length > ANCHOR_CAP) {
    const quote = candidate.q;
    if (quote && ((quote.prefix?.length ?? 0) > 32 || (quote.suffix?.length ?? 0) > 32)) {
      candidate = { ...candidate, q: { ...quote, prefix: (quote.prefix ?? '').slice(-32), suffix: (quote.suffix ?? '').slice(0, 32) } };
    } else if (quote && quote.exact.length > 64) {
      candidate = { ...candidate, q: { ...quote, exact: quote.exact.slice(0, Math.max(64, Math.floor(quote.exact.length / 2))) } };
    } else if (candidate.sel && candidate.sel.length > 32 && candidate.sel.includes('>')) {
      candidate = { ...candidate, sel: candidate.sel.slice(candidate.sel.lastIndexOf('>') + 1) };
    } else {
      throw new Error(`Anchor exceeds the ${ANCHOR_CAP}-character cap`);
    }
    encoded = encodeAnchor(candidate);
  }
  return encoded;
}

/** Chemin CSS `nth-of-type` d'un élément sous la racine, ou `data-anchor-id`. */
export function elementPath(root, element) {
  const aid = element.closest?.('[data-anchor-id]')?.getAttribute('data-anchor-id');
  if (aid) return { sel: `[data-anchor-id="${aid}"]`, aid };
  const parts = [];
  let node = element;
  while (node && node !== root && node.nodeType === 1) {
    const parent = node.parentElement;
    if (!parent) break;
    const siblings = [...parent.children].filter(child => child.tagName === node.tagName);
    parts.unshift(siblings.length > 1 ? `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})` : node.tagName.toLowerCase());
    node = parent;
  }
  return { sel: parts.join('>') };
}

function textOffset(root, container, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === container) return total + offset;
    total += walker.currentNode.textContent.length;
  }
  return total + offset;
}

/** Ancre texte depuis la sélection courante sous `root` (W3C text-quote). */
export function createAnchorFromSelection(root, version) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const exact = selection.toString();
  if (!exact.trim()) return null;
  const full = root.textContent ?? '';
  const start = textOffset(root, range.startContainer, range.startOffset);
  const end = textOffset(root, range.endContainer, range.endOffset);
  const host = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const path = host ? elementPath(root, host) : {};
  return {
    t: 'text',
    q: { exact, prefix: full.slice(Math.max(0, start - 32), start), suffix: full.slice(end, end + 32) },
    pos: { start, end },
    ...path,
    v: String(version ?? ''),
  };
}

/** Ancre élément depuis un élément commentable sous `root`. */
export function createAnchorFromElement(root, element, version) {
  const path = elementPath(root, element);
  return { t: 'element', ...path, v: String(version ?? '') };
}

function findTextRange(root, payload) {
  const full = root.textContent ?? '';
  const { exact, prefix = '', suffix = '' } = payload.q ?? {};
  if (!exact) return null;
  const candidates = [];
  for (let at = full.indexOf(exact); at !== -1; at = full.indexOf(exact, at + 1)) {
    const score = (full.slice(Math.max(0, at - 32), at).endsWith(prefix.slice(-16)) ? 0 : 1)
      + (full.slice(at + exact.length, at + exact.length + 32).startsWith(suffix.slice(0, 16)) ? 0 : 1)
      + Math.abs(at - (payload.pos?.start ?? at)) / 10000;
    candidates.push({ at, score });
  }
  if (!candidates.length) {
    const folded = full.toLowerCase().replace(/\s+/g, ' ');
    const needle = exact.toLowerCase().replace(/\s+/g, ' ');
    const at = folded.indexOf(needle);
    if (at === -1) return null;
    candidates.push({ at, score: 2 });
  }
  candidates.sort((a, b) => a.score - b.score);
  const start = candidates[0].at;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const next = total + node.textContent.length;
    if (start >= total && start + exact.length <= next) {
      const range = document.createRange();
      range.setStart(node, start - total);
      range.setEnd(node, start - total + exact.length);
      return range;
    }
    total = next;
  }
  return null;
}

/**
 * Résout une ancre contre le DOM courant : `aid`, puis citation+position,
 * puis chemin d'élément, puis recherche floue. Retourne `{ element, range }`
 * ou `null` (orphelin). Ne réécrit jamais l'ancre stockée.
 */
export function resolveAnchor(root, payload) {
  if (!root || !payload) return null;
  if (payload.aid) {
    const byId = root.querySelector(`[data-anchor-id="${CSS.escape(payload.aid)}"]`);
    if (byId) return payload.t === 'text' && payload.q ? { element: byId, range: findTextRange(root, payload) } : { element: byId, range: null };
  }
  if (payload.t === 'text' && payload.q) {
    const range = findTextRange(root, payload);
    if (range) {
      const node = range.commonAncestorContainer;
      return { element: node.nodeType === 1 ? node : node.parentElement, range };
    }
  }
  if (payload.sel) {
    try {
      const element = root.querySelector(payload.sel);
      if (element) return { element, range: null };
    } catch { /* sélecteur devenu invalide : orphelin */ }
  }
  return null;
}

/** Groupe les commentaires plats en fils chronologiques (SPEC §1). */
export function groupThreads(comments) {
  const byThread = new Map();
  for (const comment of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!byThread.has(comment.threadId)) byThread.set(comment.threadId, []);
    byThread.get(comment.threadId).push(comment);
  }
  return [...byThread.entries()].map(([threadId, rows]) => {
    const root = rows[0];
    return {
      threadId,
      target: root.target,
      comments: rows,
      state: root.state ?? 'open',
      anchor: decodeAnchor(root.target?.sectionKey),
      sectionKey: root.target?.sectionKey ?? '',
    };
  }).sort((a, b) => a.comments[0].createdAt.localeCompare(b.comments[0].createdAt));
}

/** Filtres du panneau : All / Open / Resolved (= closed) / Mine, avec comptes. */
export function filterThreads(threads, filter, currentUserId) {
  const counts = {
    all: threads.length,
    open: threads.filter(thread => thread.state === 'open').length,
    closed: threads.filter(thread => thread.state === 'closed').length,
    mine: threads.filter(thread => thread.comments.some(comment => comment.author?.id === currentUserId)).length,
  };
  const visible = filter === 'open' ? threads.filter(thread => thread.state === 'open')
    : filter === 'closed' ? threads.filter(thread => thread.state === 'closed')
    : filter === 'mine' ? threads.filter(thread => thread.comments.some(comment => comment.author?.id === currentUserId))
    : threads;
  return { visible, counts };
}

/** Non lu : commentaire plus récent que la lecture, d'un autre auteur. */
export function isUnread(thread, lastReadAt, currentUserId) {
  if (!lastReadAt) return thread.comments.some(comment => comment.author?.id !== currentUserId);
  return thread.comments.some(comment => comment.createdAt > lastReadAt && comment.author?.id !== currentUserId);
}

/** Étiquette courte d'une ancre : citation ≤140 caractères ou nom d'élément. */
export function anchorLabel(anchor) {
  if (!anchor) return 'Sans ancre';
  if (anchor.t === 'text' && anchor.q?.exact) {
    const exact = anchor.q.exact.replace(/\s+/g, ' ').trim();
    return exact.length > 140 ? `${exact.slice(0, 139)}…` : exact;
  }
  if (anchor.sel) return anchor.sel.replace(/\[data-anchor-id="([^"]+)"\]/, '$1');
  return 'Zone de l’artefact';
}

/** Trie les épingles par Y, écart minimal 28px, borné au conteneur. */
export function layoutPins(pins, containerHeight) {
  const sorted = [...pins].sort((a, b) => a.y - b.y);
  let previous = -Infinity;
  for (const pin of sorted) {
    pin.y = Math.max(pin.y, previous + 28);
    previous = pin.y;
  }
  if (sorted.length && containerHeight) {
    const overflow = sorted[sorted.length - 1].y - containerHeight;
    if (overflow > 0) for (const pin of sorted) pin.y -= overflow;
  }
  return sorted;
}

/** Échappe le HTML puis applique un markdown léger (gras, code, liens sûrs). */
export function renderMarkdownLite(body) {
  const escaped = String(body ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
}
