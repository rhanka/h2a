export const AGENT_LAUNCH_PROFILES = ["claude", "codex", "agy"] as const;
export type AgentLaunchProfile = (typeof AGENT_LAUNCH_PROFILES)[number];

export const AGENT_LAUNCH_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type AgentLaunchEffort = (typeof AGENT_LAUNCH_EFFORTS)[number];

export function isAgentLaunchProfile(value: string): value is AgentLaunchProfile {
  return (AGENT_LAUNCH_PROFILES as readonly string[]).includes(value);
}

export function isAgentLaunchEffort(value: string): value is AgentLaunchEffort {
  return (AGENT_LAUNCH_EFFORTS as readonly string[]).includes(value);
}

export type AgentLaunchArgsOptions = {
  profile: AgentLaunchProfile;
  prompt?: string;
  agent?: string;
  model?: string;
  effort?: AgentLaunchEffort;
  resumeId?: string;
  headless?: boolean;
  bare?: boolean;
};

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const AGENT_LAUNCH_PROMPT_MAX_BYTES = 65_536;

export function assertAgentLaunchModel(model: string): void {
  if (!MODEL_RE.test(model)) {
    throw new Error(
      "invalid model (use 1-128 letters, digits, '.', '_', ':', '/', or '-', without a leading '-')",
    );
  }
}

function assertAgentLaunchAgent(agent: string): void {
  if (!MODEL_RE.test(agent)) {
    throw new Error(
      "invalid agent (use 1-128 letters, digits, '.', '_', ':', '/', or '-', without a leading '-')",
    );
  }
}

export function assertAgentLaunchPrompt(prompt: string): void {
  if (prompt.trim().length === 0) {
    throw new Error("agent launch prompt must not be empty");
  }
  if (prompt.includes("\0")) {
    throw new Error("agent launch prompt must not contain NUL");
  }
  if (Buffer.byteLength(prompt, "utf8") > AGENT_LAUNCH_PROMPT_MAX_BYTES) {
    throw new Error(
      `agent launch prompt exceeds ${AGENT_LAUNCH_PROMPT_MAX_BYTES} UTF-8 bytes`,
    );
  }
}

/**
 * Build argv for a managed Claude/Codex/AGY session. `prompt` is validated here but
 * is deliberately NEVER serialized into argv: interactive launches paste it
 * through tmux stdin, while headless launches feed it to the CLI's native
 * stdin contract.
 */
export function buildAgentLaunchArgs(options: AgentLaunchArgsOptions): string[] {
  if (options.prompt !== undefined) assertAgentLaunchPrompt(options.prompt);
  if (options.agent !== undefined) assertAgentLaunchAgent(options.agent);
  if (options.model !== undefined) assertAgentLaunchModel(options.model);
  if (options.agent !== undefined && options.profile !== "agy") {
    throw new Error("agent selection is supported only for the AGY profile");
  }
  if (options.headless && !options.prompt) {
    throw new Error("headless agent launch requires a prompt");
  }
  if (options.headless && options.resumeId) {
    throw new Error("headless agent launch cannot resume a conversation");
  }
  if (options.profile === "agy" && options.effort === "xhigh") {
    throw new Error("AGY effort must be low|medium|high");
  }

  if (options.profile === "claude") {
    return [
      ...(options.bare ? ["--bare"] : []),
      ...(options.model ? ["--model", options.model] : []),
      ...(options.effort ? ["--effort", options.effort] : []),
      ...(options.headless ? ["-p", "--input-format", "text"] : []),
      ...(options.resumeId ? ["--resume", options.resumeId] : []),
    ];
  }

  if (options.profile === "agy") {
    return [
      ...(options.agent ? ["--agent", options.agent] : []),
      ...(options.model ? ["--model", options.model] : []),
      ...(options.effort ? ["--effort", options.effort] : []),
      // AGY's --print accepts an optional inline prompt. Keep it last so the
      // parser cannot consume the following option as that prompt; stdin then
      // remains the sole prompt transport.
      ...(options.headless ? ["--output-format", "text", "--print"] : []),
      ...(options.resumeId ? ["--conversation", options.resumeId] : []),
    ];
  }

  return [
    ...(options.model ? ["-m", options.model] : []),
    ...(options.effort
      ? ["-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`]
      : []),
    ...(options.headless
      ? ["exec", "-"]
      : options.resumeId
        ? ["resume", options.resumeId]
        : []),
  ];
}
