import "server-only";

import { HOUR, MINUTE, PromiseCache } from "../cache";
import type { GitHubErrorCode, RepoRef, RepoSummary, RepoTree, TreeEntry } from "./types";

const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";
const REQUEST_TIMEOUT_MS = 15_000;

export class GitHubError extends Error {
  constructor(
    public readonly code: GitHubErrorCode,
    message: string,
    /** HTTP status to return to our own client. */
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

// Repository metadata and branch heads can change, so they're cached briefly.
// Trees are addressed by commit SHA and never change, so they're kept longer.
const summaryCache = new PromiseCache<RepoSummary>(200);
const headCache = new PromiseCache<string | null>(200);
const treeCache = new PromiseCache<Omit<RepoTree, "repo" | "ref">>(30);

function headers(accept = "application/vnd.github+json"): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-compass",
  };
  // Optional: raises the rate limit from 60/hour (per IP) to 5,000/hour.
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new GitHubError(
      "network_error",
      timedOut ? "GitHub took too long to respond. Please try again." : "Could not reach GitHub. Check your connection and try again.",
      502,
    );
  }
}

/**
 * Low-level GET against the GitHub REST API with error mapping.
 * Returns `null` for HTTP 409, which GitHub uses for "Git Repository is empty".
 */
async function githubGet(path: string, repo: RepoRef, accept?: string): Promise<Response | null> {
  const res = await send(`${API_BASE}${path}`, { headers: headers(accept) });
  if (res.ok) return res;
  if (res.status === 409) return null;

  const fullName = `${repo.owner}/${repo.name}`;
  const remaining = res.headers.get("x-ratelimit-remaining");

  if (res.status === 404) {
    throw new GitHubError(
      "not_found",
      `Repository "${fullName}" was not found. Check the spelling — private repositories aren't supported yet.`,
      404,
    );
  }
  if (res.status === 429 || (res.status === 403 && remaining === "0")) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) && reset > 0
      ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`
      : " Try again later.";
    throw new GitHubError("rate_limited", `GitHub API rate limit reached.${when}`, 429);
  }
  if (res.status === 401) {
    throw new GitHubError("unauthorized", "The server's GitHub token was rejected. Check GITHUB_TOKEN.", 502);
  }
  throw new GitHubError("upstream_error", `GitHub returned an unexpected error (HTTP ${res.status}).`, 502);
}

const repoPath = (r: RepoRef) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
const cacheKey = (r: RepoRef) => `${r.owner}/${r.name}`.toLowerCase();

interface GitHubRepoResponse {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
}

interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: Array<{ path: string; type: "blob" | "tree" | "commit"; size?: number }>;
}

export function getRepoSummary(repo: RepoRef): Promise<RepoSummary> {
  return summaryCache.getOrCreate(cacheKey(repo), 5 * MINUTE, async () => {
    const res = await githubGet(repoPath(repo), repo);
    if (!res) throw new GitHubError("upstream_error", "GitHub returned an unexpected response.", 502);
    const body = (await res.json()) as GitHubRepoResponse;
    return {
      owner: body.owner.login,
      name: body.name,
      fullName: body.full_name,
      description: body.description,
      htmlUrl: body.html_url,
      defaultBranch: body.default_branch,
      stars: body.stargazers_count,
    };
  });
}

/** Resolve a branch to its current commit SHA, or null if the repository is empty. */
function getHeadCommit(repo: RepoRef, branch: string): Promise<string | null> {
  return headCache.getOrCreate(`${cacheKey(repo)}#${branch}`, MINUTE, async () => {
    const ref = branch.split("/").map(encodeURIComponent).join("/");
    const res = await githubGet(`${repoPath(repo)}/commits/${ref}`, repo, "application/vnd.github.sha");
    return res ? (await res.text()).trim() : null;
  });
}

const TYPE_MAP = { blob: "file", tree: "dir", commit: "submodule" } as const;

/** Fetch the recursive file tree at a specific commit. Cached by commit SHA. */
export function getTreeAtCommit(repo: RepoRef, commit: string): Promise<Omit<RepoTree, "repo" | "ref">> {
  return treeCache.getOrCreate(`${cacheKey(repo)}@${commit}`, 6 * HOUR, async () => {
    const res = await githubGet(`${repoPath(repo)}/git/trees/${commit}?recursive=1`, repo);
    if (!res) return { commit, entries: [], truncated: false };
    const body = (await res.json()) as GitHubTreeResponse;
    const entries: TreeEntry[] = body.tree.map((item) => ({
      path: item.path,
      type: TYPE_MAP[item.type],
      ...(item.type === "blob" && item.size !== undefined ? { size: item.size } : {}),
    }));
    return { commit, entries, truncated: body.truncated };
  });
}

/**
 * Fetch the full recursive file tree of a public repository's default branch.
 * Cold cost: 3 GitHub API calls (metadata, branch head, tree).
 */
export async function getRepoTree(repo: RepoRef): Promise<RepoTree> {
  const summary = await getRepoSummary(repo);
  const ref = summary.defaultBranch;
  const commit = await getHeadCommit(summary, ref);
  if (!commit) return { repo: summary, ref, commit: "", entries: [], truncated: false };
  const tree = await getTreeAtCommit(summary, commit);
  return { repo: summary, ref, ...tree };
}

/**
 * Fetch a file's text at a commit from raw.githubusercontent.com. This does
 * not count against the REST API rate limit. Returns null on any failure so
 * callers can skip the file.
 */
export async function getFileText(repo: RepoRef, commit: string, path: string): Promise<string | null> {
  const url = `${RAW_BASE}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${commit}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "repo-compass" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
