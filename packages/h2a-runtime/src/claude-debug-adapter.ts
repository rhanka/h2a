export type ClaudeDebugAnalysis = {
  connectedMcps: Set<string>;
  promptSubmitSettled: boolean;
  turnStartObserved: boolean;
  mainThreadDispatched: boolean;
  titleDispatched: boolean;
  hookVeto: boolean;
  error?: string;
};

export function parseClaudeDebugEvents(_content: string): ClaudeDebugAnalysis {
  return {
    connectedMcps: new Set(),
    promptSubmitSettled: false,
    turnStartObserved: false,
    mainThreadDispatched: false,
    titleDispatched: false,
    hookVeto: false,
  };
}

export function readClaudeDebugBounded(content: string, _maxBytes = 16 * 1024 * 1024): string {
  return content;
}
