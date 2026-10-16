// Only native structured effects count. An assistant's prose is never evidence.
export function inspectSkillEntries(entries, requiredResources) {
  return requiredResources.length > 0 && requiredResources.every(resource => entries.some(e => e.type === 'effect' && e.state?.status === 'completed' &&
    (e.detail?.input?.path === resource.path || e.detail?.input?.filePath === resource.path) &&
    (e.state?.output?.content === resource.bytes || e.state?.outputText === resource.bytes)));
}
export function inspectGuardEntries(entries, sessionId) {
  const notices = entries.filter(e => e.sessionId === sessionId && e.type === 'notice').map(e => e.detail);
  const refused = notices.find(n => n.kind === 'hook_completed' && n.scope === 'pre_tool' && n.hookName === 'sentropic-h2a-deny-manual-cli' && n.status === 'error' && n.toolCallId);
  const targets = entries.filter(e => e.sessionId === sessionId && e.type === 'effect' && e.detail?.input?.command === 'h2a --version');
  if (targets.some(e => e.state?.status === 'completed') || !targets.some(e => e.id === refused?.toolCallId && ['failed', 'skipped', 'cancelled'].includes(e.state?.status))) return false;
  const benign = entries.find(e => e.sessionId === sessionId && e.type === 'effect' && e.detail?.input?.command === 'printf vibe-guard-ok' && e.state?.status === 'completed');
  const id = benign?.id;
  const started = notices.some(n => n.kind === 'hook_run_started' && n.scope === 'pre_tool' && n.toolCallId === id);
  const completed = notices.some(n => n.kind === 'hook_run_completed' && n.scope === 'pre_tool' && n.toolCallId === id);
  const degraded = notices.some(n => n.scope === 'pre_tool' && n.toolCallId === id && n.status === 'warning');
  return !!refused && !!benign && started && completed && !degraded;
}
export function inspectLifecycleEntries(entries, origin, copy, recordEvidence) {
  const post = entries.filter(e => e.type === 'notice' && e.detail?.scope === 'post_agent');
  const nativeParentRun = post.some(e => e.sessionId === origin && e.detail.kind === 'hook_run_started') && post.some(e => e.sessionId === origin && e.detail.kind === 'hook_run_completed');
  const delegated = entries.some(e => e.sessionId === origin && e.type === 'effect' && e.detail?.kind === 'subagent' && e.state?.status === 'completed');
  return nativeParentRun && delegated && !!copy && recordEvidence.parentRecordPresent && recordEvidence.lifecycleRecordUnchangedInFork && recordEvidence.recordedAfterParent &&
    recordEvidence.childRecordUntouched === true && recordEvidence.parentRecordTransitions === 1 && recordEvidence.otherInstancesUntouched === true;
}
export function inspectMcpEntries(entries, sessionId, { busRoot, workspace }) {
  const effects = entries.filter(e => e.sessionId === sessionId && e.type === 'effect' && e.state?.status === 'completed');
  const decode = e => {
    let output = e.state.output;
    if (output?.isError) return undefined;
    if (output?.content) output = output.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { return typeof output === 'string' ? JSON.parse(output) : output; } catch { return undefined; }
  };
  const identity = effects.filter(e => /h2a_identity_status$/.test(e.detail?.toolName ?? '')).map(decode).find(Boolean);
  const opened = effects.filter(e => /h2a_session_open$/.test(e.detail?.toolName ?? '')).map(decode).find(o => o?.session?.sessionId);
  const track = effects.filter(e => /track_/.test(e.detail?.toolName ?? '')).map(decode);
  const identityContext = identity?.identity ?? identity;
  const correctBus = ['identity_ready', 'identity_disabled'].includes(identityContext?.state) && identityContext?.root === busRoot;
  // Track's real status payload is {level, groups}, without a root field.
  // Bind it to the workspace reported by the same native MCP server. A serve-empty
  // hint or tool error cannot decode as a successful Track status observation.
  const correctWorkspace = identityContext?.workspaceRoot === workspace && track.some(result => result?.level && Array.isArray(result.groups));
  return { MCP: correctBus && !!opened, context: correctBus && correctWorkspace && !!opened, h2aSessionId: opened?.session.sessionId, instance: opened?.session.instance };
}
