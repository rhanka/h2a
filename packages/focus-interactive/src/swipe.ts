export interface SwipeState {
  readonly index: number;
  readonly length: number;
}

export type SwipeDirection = "next" | "prev";

export function createSwipeState(length: number, index = 0): SwipeState {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`createSwipeState: length must be a non-negative integer (got ${length})`);
  }
  if (!Number.isInteger(index)) {
    throw new Error(`createSwipeState: index must be an integer (got ${index})`);
  }
  return { length, index: clampIndex(index, length) };
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function canMove(state: SwipeState, direction: SwipeDirection): boolean {
  if (state.length <= 0) return false;
  return direction === "next" ? state.index < state.length - 1 : state.index > 0;
}

export function move(state: SwipeState, direction: SwipeDirection): SwipeState {
  const delta = direction === "next" ? 1 : -1;
  return { ...state, index: clampIndex(state.index + delta, state.length) };
}

export function selectIndex(state: SwipeState, index: number): SwipeState {
  return { ...state, index: clampIndex(index, state.length) };
}

export function resizeSwipeState(state: SwipeState, length: number): SwipeState {
  return createSwipeState(length, state.index);
}
