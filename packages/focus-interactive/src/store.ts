import { aggregatePendingDecisions, type PendingDecision } from "./contract.js";
import { decisionKeyProjectHash } from "./decision-key.js";
import type { FeedbackIntent } from "./feedback.js";
import { createSwipeState, move, resizeSwipeState, selectIndex, type SwipeDirection, type SwipeState } from "./swipe.js";
import type { FocusSyncSnapshot } from "./sync.js";

export interface FocusProjectDeck {
  readonly projectHash: string;
  readonly projectRoot: string | undefined;
  readonly decisions: readonly PendingDecision[];
  readonly swipe: SwipeState;
  readonly selected: PendingDecision | undefined;
  readonly readAt: string | undefined;
}

export interface FocusStoreSnapshot {
  readonly projects: readonly FocusProjectDeck[];
  readonly allDecisions: readonly PendingDecision[];
  readonly activeProjectHash: string | undefined;
  readonly active: FocusProjectDeck | undefined;
  readonly intents: readonly FeedbackIntent[];
}

export type FocusStoreListener = (snapshot: FocusStoreSnapshot) => void;

export interface FocusStore {
  readonly getSnapshot: () => FocusStoreSnapshot;
  readonly subscribe: (listener: FocusStoreListener) => () => void;
  readonly replaceProjects: (snapshots: readonly FocusSyncSnapshot[]) => void;
  readonly setActiveProject: (projectHash: string) => void;
  readonly move: (direction: SwipeDirection) => void;
  readonly select: (index: number) => void;
  readonly captureIntent: (intent: FeedbackIntent) => void;
  readonly clearIntents: () => void;
}

interface MutableProject {
  projectHash: string;
  projectRoot: string | undefined;
  decisions: PendingDecision[];
  swipe: SwipeState;
  readAt: string | undefined;
}

export function createFocusStore(initial: readonly FocusSyncSnapshot[] = []): FocusStore {
  let projects = new Map<string, MutableProject>();
  let activeProjectHash: string | undefined;
  let intents: FeedbackIntent[] = [];
  const listeners = new Set<FocusStoreListener>();

  const toSnapshot = (): FocusStoreSnapshot => {
    const decks = [...projects.values()].map(freezeProject);
    const active = activeProjectHash === undefined ? undefined : decks.find((p) => p.projectHash === activeProjectHash);
    return {
      projects: decks,
      allDecisions: aggregatePendingDecisions(decks.flatMap((p) => p.decisions)),
      activeProjectHash,
      active,
      intents: [...intents]
    };
  };

  const emit = () => {
    const snapshot = toSnapshot();
    for (const listener of listeners) listener(snapshot);
  };

  const replaceProjects = (snapshots: readonly FocusSyncSnapshot[]) => {
    const next = new Map<string, MutableProject>();
    for (const snapshot of snapshots) {
      const decisions = aggregatePendingDecisions(snapshot.decisions);
      const previous = projects.get(snapshot.projectHash);
      next.set(snapshot.projectHash, {
        projectHash: snapshot.projectHash,
        projectRoot: snapshot.projectRoot,
        decisions,
        swipe: resizeSwipeState(previous?.swipe ?? createSwipeState(decisions.length), decisions.length),
        readAt: snapshot.readAt
      });
    }
    projects = next;
    if (activeProjectHash === undefined || !projects.has(activeProjectHash)) {
      activeProjectHash = projects.keys().next().value;
    }
    emit();
  };

  const store: FocusStore = {
    getSnapshot: toSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(toSnapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    replaceProjects,
    setActiveProject(projectHash) {
      if (!projects.has(projectHash)) {
        throw new Error(`setActiveProject: unknown projectHash "${projectHash}"`);
      }
      activeProjectHash = projectHash;
      emit();
    },
    move(direction) {
      const active = activeProjectHash === undefined ? undefined : projects.get(activeProjectHash);
      if (!active) return;
      active.swipe = move(active.swipe, direction);
      emit();
    },
    select(index) {
      const active = activeProjectHash === undefined ? undefined : projects.get(activeProjectHash);
      if (!active) return;
      active.swipe = selectIndex(active.swipe, index);
      emit();
    },
    captureIntent(intent) {
      const lane = decisionKeyProjectHash(intent.decisionKey);
      if (!projects.has(lane)) {
        throw new Error(`captureIntent: no project lane for decisionKey "${intent.decisionKey}"`);
      }
      intents = [...intents, intent];
      emit();
    },
    clearIntents() {
      intents = [];
      emit();
    }
  };

  replaceProjects(initial);
  return store;
}

function freezeProject(project: MutableProject): FocusProjectDeck {
  const selected = project.decisions[project.swipe.index];
  return {
    projectHash: project.projectHash,
    projectRoot: project.projectRoot,
    decisions: [...project.decisions],
    swipe: project.swipe,
    selected,
    readAt: project.readAt
  };
}
