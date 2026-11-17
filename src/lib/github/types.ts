/**
 * Shared types for the GitHub integration. These are safe to import from
 * both server and client code (no runtime values that touch the network).
 */

export interface RepoRef {
  owner: string;
  name: string;
}

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  stars: number;
}

export type TreeEntryType = "file" | "dir" | "submodule";

/** One entry in a repository's file tree, as a flat path list. */
export interface TreeEntry {
  path: string;
  type: TreeEntryType;
  /** Size in bytes (files only). */
  size?: number;
}

export interface RepoTree {
  repo: RepoSummary;
  /** Ref the tree was read from (the default branch). */
  ref: string;
  /** Commit SHA the tree was read at (empty string for an empty repository). */
  commit: string;
  entries: TreeEntry[];
  /** GitHub caps recursive trees (~100k entries / 7 MB); true if this one was cut short. */
  truncated: boolean;
}

export type GitHubErrorCode =
  | "invalid_input"
  | "not_found"
  | "rate_limited"
  | "unauthorized"
  | "upstream_error"
  | "network_error";

/** JSON shape returned by /api/repo/tree. */
export type RepoTreeResponse =
  | { ok: true; data: RepoTree }
  | { ok: false; error: { code: GitHubErrorCode; message: string } };
