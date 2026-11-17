import type { RepoRef } from "./types";

// GitHub username rules: alphanumerics and single hyphens, max 39 chars.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repository names: alphanumerics, '.', '_', '-', max 100 chars.
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parse user input into an owner/name pair. Accepts:
 *   - https://github.com/owner/repo (optionally with .git, trailing slash,
 *     or extra path such as /tree/main/src — the extra path is ignored)
 *   - github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *   - owner/repo
 *
 * Returns null if the input is not a recognisable GitHub repository.
 */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;

  const ssh = s.match(/^git@github\.com:(.+)$/i);
  if (ssh) {
    s = ssh[1];
  } else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(s)) {
    try {
      const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      s = url.pathname;
    } catch {
      return null;
    }
  } else if (s.includes("://")) {
    // A URL for some other host. (Bare "gitlab.com/a/b" is rejected below,
    // since owner names can't contain dots.)
    return null;
  }

  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");

  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === "." || name === "..") {
    return null;
  }
  return { owner, name };
}
