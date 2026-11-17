import "server-only";

import type { GitHubErrorCode, RepoRef, RepoSummary, RepoTree, TreeEntry } from "./types";

const API_BASE = "https://api.github.com";
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

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-compass",
  };
  // Optional: raises the rate limit from 60/hour (per IP) to 5,000/hour.
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Low-level GET against the GitHub REST API with error mapping. */
async function githubGet<T>(path: string, repo: RepoRef): Promise<{ status: number; body: T }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new GitHubError(
      "network_error",
      timedOut ? "GitHub took too long to respond. Please try again." : "Could not reach GitHub. Check your connection and try again.",
      502,
    );
  }

  if (res.ok) return { status: res.status, body: (await res.json()) as T };

  // 409 on the trees endpoint means "Git Repository is empty" — callers handle it.
  if (res.status === 409) return { status: 409, body: undefined as T };

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

export async function getRepoSummary(repo: RepoRef): Promise<RepoSummary> {
  const { body } = await githubGet<GitHubRepoResponse>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
    repo,
  );
  return {
    owner: body.owner.login,
    name: body.name,
    fullName: body.full_name,
    description: body.description,
    htmlUrl: body.html_url,
    defaultBranch: body.default_branch,
    stars: body.stargazers_count,
  };
}

const TYPE_MAP = { blob: "file", tree: "dir", commit: "submodule" } as const;

/**
 * Fetch the full recursive file tree of a public repository's default branch.
 * Uses two API calls: repository metadata (for the default branch) and the
 * recursive git tree.
 */
export async function getRepoTree(repo: RepoRef): Promise<RepoTree> {
  const summary = await getRepoSummary(repo);
  const ref = summary.defaultBranch;
  // Branch names may contain '/', which the trees endpoint accepts unencoded.
  const refPath = ref.split("/").map(encodeURIComponent).join("/");

  const { status, body } = await githubGet<GitHubTreeResponse>(
    `/repos/${encodeURIComponent(summary.owner)}/${encodeURIComponent(summary.name)}/git/trees/${refPath}?recursive=1`,
    repo,
  );

  if (status === 409) {
    // Empty repository: no commits, so no tree.
    return { repo: summary, ref, sha: "", entries: [], truncated: false };
  }

  const entries: TreeEntry[] = body.tree.map((item) => ({
    path: item.path,
    type: TYPE_MAP[item.type],
    ...(item.type === "blob" && item.size !== undefined ? { size: item.size } : {}),
  }));

  return { repo: summary, ref, sha: body.sha, entries, truncated: body.truncated };
}
