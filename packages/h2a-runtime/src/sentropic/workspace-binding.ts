/** RED stub — see workspace-binding.test.ts. */
export interface WorkspaceBinding {
  readonly localWorkspace: string;
  readonly server: string;
  readonly workspaceId: string;
  readonly tenantId?: string;
  readonly subject?: string;
  readonly boundAt: string;
}
export type GitRunner = (args: readonly string[], cwd: string) => { status: number | null; stdout: string };
const nope = (): never => {
  throw new Error("not implemented");
};
export const bindingFilePath = (_server: string, _localWorkspace: string, _dir: string): string => nope();
export const readBinding = (_server: string, _localWorkspace: string, _dir: string): WorkspaceBinding | undefined => nope();
export const writeBinding = (_binding: WorkspaceBinding, _dir: string): void => nope();
export const removeBinding = (_server: string, _localWorkspace: string, _dir: string): boolean => nope();
export const assertSentropicWorkspaceId = (_id: string): string => nope();
export const resolveLocalWorkspaceId = (_cwd: string, _git?: GitRunner): string | undefined => nope();
