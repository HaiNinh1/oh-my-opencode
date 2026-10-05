export { GitUnavailableError, createWorktree, isGitAvailable, normalizeWorktreeSpec, validateWorktreeSpec } from "./manager"
export { findOrphanWorktrees, removeWorktree } from "./cleanup"
export {
  ISOLATED_WORKTREES_DIR,
  createIsolatedWorktree,
  defaultIsolatedWorktreePath,
  isWorkingTreeDirty,
  mergeBackWorktree,
  readIsolationMetadata,
  removeIsolatedWorktree,
  resolveGitRoot,
  snapshotWorkingTree,
  toForwardSlashes,
} from "./isolated-worktree"
export type { IsolationMetadata, WorktreeMergeResult, WorktreeMergeStatus } from "./isolated-worktree"
