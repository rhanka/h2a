<script setup vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button } from '@sentropic/design-system-vue/vapor';
import CommentPin from './CommentPin.vue';
import CommentComposer from './CommentComposer.vue';
import {
  createAnchorFromElement, createAnchorFromSelection, encodeAnchorCapped,
  layoutPins, resolveAnchor,
} from './review-core.js';

const props = defineProps({
  mode: { type: String, default: 'view' },
  threads: { type: Array, default: () => [] },
  currentUser: { type: Object, required: true },
  activeThreadId: { type: String, default: null },
  readState: { type: Object, default: () => ({}) },
  version: { type: String, default: '' },
});
const emit = defineEmits(['create', 'select', 'orphanChange']);

const layerEl = ref(null);
const pins = ref([]);
const orphanedIds = ref(new Set());
const pending = ref(null); // { anchor, sectionKey, x, y }
const addButton = ref(null); // { x, y }
let settleTimer = null;
let resizeObserver = null;
let raf = 0;
let lastInvoker = null;

const rootEl = computed(() => layerEl.value?.querySelector('[data-review-root]') ?? layerEl.value);

function isReview() { return props.mode === 'review'; }

function computePins() {
  if (!isReview() || !layerEl.value) { pins.value = []; return; }
  const root = rootEl.value;
  const layerRect = layerEl.value.getBoundingClientRect();
  const orphans = new Set();
  const placed = [];
  const ordered = [...props.threads];
  for (const [index, thread] of ordered.entries()) {
    const resolved = thread.anchor ? resolveAnchor(root, thread.anchor) : null;
    if (!resolved?.element) { orphans.add(thread.threadId); continue; }
    const rect = (resolved.range?.getBoundingClientRect?.() ?? resolved.element.getBoundingClientRect());
    placed.push({
      thread, index,
      x: Math.max(0, rect.left - layerRect.left),
      y: Math.max(0, rect.top - layerRect.top + layerEl.value.scrollTop),
      element: resolved.element,
      range: resolved.range,
    });
  }
  layoutPins(placed, layerEl.value.scrollHeight);
  pins.value = placed;
  orphanedIds.value = orphans;
  emit('orphanChange', [...orphans]);
  applyHighlights(placed);
}

function applyHighlights(placed) {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  try {
    const ranges = placed.map(pin => pin.range).filter(Boolean);
    CSS.highlights.set('st-review', new Highlight(...ranges));
  } catch { /* surlignage indisponible : les épingles suffisent */ }
}

function scheduleCompute() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(computePins);
}

function openComposer(anchor, invoker) {
  let sectionKey;
  try {
    sectionKey = encodeAnchorCapped(anchor);
  } catch (caught) {
    emit('create', { error: caught.message });
    return;
  }
  lastInvoker = invoker ?? document.activeElement;
  const layerRect = layerEl.value.getBoundingClientRect();
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  pending.value = {
    anchor, sectionKey,
    x: rect ? rect.left - layerRect.left : 24,
    y: rect ? rect.bottom - layerRect.top + 8 : 24,
  };
  addButton.value = null;
}

function onSelectionSettled() {
  if (!isReview()) return;
  const anchor = createAnchorFromSelection(rootEl.value, props.version);
  if (!anchor) { addButton.value = null; return; }
  const range = window.getSelection().getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const layerRect = layerEl.value.getBoundingClientRect();
  addButton.value = { x: rect.right - layerRect.left, y: rect.bottom - layerRect.top + 6, anchor };
}

function onSelectionChange() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(onSelectionSettled, 150);
}

const COMMENTABLE = 'p,h1,h2,h3,h4,h5,h6,li,figure,table,blockquote,pre,[data-anchor-id],[data-commentable]';
function onRootClick(event) {
  if (!isReview()) return;
  if (event.target.closest('a,button,input,textarea,select,[data-review-passthrough],.st-review-pin,.st-review-composer,.st-review-add')) return;
  const element = event.target.closest('[data-commentable]') ?? event.target.closest(COMMENTABLE);
  if (!element || !rootEl.value.contains(element)) return;
  const anchor = createAnchorFromElement(rootEl.value, element, props.version);
  openComposer(anchor, event.target);
}

function onKeydown(event) {
  if (!isReview()) return;
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'c') {
    const target = event.target;
    if (target?.closest('textarea,input')) return;
    event.preventDefault();
    const anchor = createAnchorFromSelection(rootEl.value, props.version);
    if (anchor) openComposer(anchor, target);
  }
  if (event.key === 'Escape' && pending.value) {
    pending.value = null;
    lastInvoker?.focus?.();
  }
}

function submitPending(payload) {
  emit('create', { sectionKey: pending.value.sectionKey, anchor: pending.value.anchor, ...payload });
  pending.value = null;
}

function activatePin(thread) {
  emit('select', thread.threadId);
  const pin = pins.value.find(item => item.thread.threadId === thread.threadId);
  pin?.element?.scrollIntoView({ block: 'nearest' });
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', scheduleCompute);
  window.addEventListener('scroll', scheduleCompute, true);
  if (typeof ResizeObserver !== 'undefined' && layerEl.value) {
    resizeObserver = new ResizeObserver(scheduleCompute);
    resizeObserver.observe(layerEl.value);
  }
  void nextTick(computePins);
});
onUnmounted(() => {
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', scheduleCompute);
  window.removeEventListener('scroll', scheduleCompute, true);
  resizeObserver?.disconnect();
  clearTimeout(settleTimer);
  cancelAnimationFrame(raf);
  try { CSS.highlights?.delete('st-review'); } catch { /* noop */ }
});
watch(() => [props.mode, props.threads, props.activeThreadId], () => void nextTick(computePins), { deep: true });
</script>
<template>
  <div ref="layerEl" class="st-review-layer" :data-mode="mode" @click="onRootClick">
    <slot />
    <template v-if="mode === 'review'">
      <CommentPin v-for="pin in pins" :key="pin.thread.threadId"
        :index="pin.index" :count="pin.thread.comments.length"
        :unread="pin.thread.comments.some(c => c.author?.id !== currentUser.actorId && (!readState[pin.thread.threadId] || c.createdAt > readState[pin.thread.threadId]))"
        :resolved="pin.thread.state === 'closed'" :active="pin.thread.threadId === activeThreadId"
        :label="pin.thread.anchor?.q?.exact ?? pin.thread.anchor?.sel ?? 'artifact'"
        :style="{ left: `${pin.x}px`, top: `${pin.y}px` }" @activate="activatePin(pin.thread)" />
      <div v-if="addButton" class="st-review-add" :style="{ left: `${addButton.x}px`, top: `${addButton.y}px` }">
        <Button variant="secondary" size="sm" @click="openComposer(addButton.anchor, $event.target)">Add comment</Button>
      </div>
      <div v-if="pending" class="st-review-composer-pop" :style="{ left: `${pending.x}px`, top: `${pending.y}px` }">
        <CommentComposer :author="currentUser" autofocus @submit="submitPending" @cancel="pending = null; lastInvoker?.focus?.()" />
      </div>
    </template>
  </div>
</template>
