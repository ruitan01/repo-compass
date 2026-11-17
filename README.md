# Repo Compass

A visual codebase onboarding tool that helps students and junior developers understand unfamiliar GitHub repositories. Built for MPCS 51238 (Design, Build, Ship).

> **Status: Stage 1.** Paste a public GitHub repository and browse its file tree. Dependency-graph analysis, accounts (Clerk), persistence (Supabase), and AI features are not built yet.

The original project proposal page is kept at [`index.html`](./index.html).

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Cache Components enabled) + TypeScript
- Tailwind CSS v4
- GitHub REST API (called server-side only)

## Getting started

Requirements: Node.js 20.9+ (developed on Node 24) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and enter a repository, e.g. `https://github.com/vercel/swr` or `vercel/swr`.

### Optional: GitHub token

Without a token, GitHub allows **60 API requests per hour per IP**, and each repository lookup uses 2. To raise the limit to 5,000/hour, create a `.env.local` file:

```bash
GITHUB_TOKEN=github_pat_xxx   # fine-grained token, no scopes needed for public repos
```

`.env*` files are git-ignored. The token is only read on the server and is never sent to the browser.

## Scripts

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Start the dev server                          |
| `npm run build` | Production build (also type-checks)           |
| `npm start`     | Serve the production build                    |
| `npm run lint`  | ESLint                                        |
| `npm test`      | Unit tests (Node's built-in test runner)      |

## How it works

```
Browser (RepoExplorer)  ──GET /api/repo/tree?repo=…──▶  Route handler  ──▶  src/lib/github  ──▶  api.github.com
```

1. The client parses the input for instant validation, then calls `/api/repo/tree`.
2. The route handler validates the input again and calls `getRepoTree()`.
3. `getRepoTree()` makes two GitHub API calls: repository metadata (for the default branch) and the recursive git tree for that branch.
4. The client turns the flat path list into a nested tree (`buildFileTree`) and renders it.

### API

`GET /api/repo/tree?repo=<url or owner/name>`

```jsonc
// 200
{ "ok": true, "data": { "repo": { "fullName": "vercel/swr", "defaultBranch": "main", ... },
                        "ref": "main", "sha": "…", "truncated": false,
                        "entries": [{ "path": "src/index.ts", "type": "file", "size": 123 }, ...] } }
// 4xx / 5xx
{ "ok": false, "error": { "code": "not_found", "message": "…" } }
```

Error codes: `invalid_input` (400), `not_found` (404), `rate_limited` (429), `unauthorized`, `upstream_error`, `network_error` (502).

Accepted input formats: `https://github.com/owner/repo`, `github.com/owner/repo`, `…/repo.git`, `git@github.com:owner/repo.git`, URLs with extra path such as `/tree/main/src` (the extra path is ignored for now), and `owner/repo`.

## Project structure

```
src/
  app/
    page.tsx                  Homepage
    layout.tsx, globals.css
    api/repo/tree/route.ts    GET handler (thin wrapper around lib/github)
  components/
    RepoExplorer.tsx          Input form + loading / error / empty / result states
    FileTree.tsx              Collapsible file tree
    icons.tsx
  lib/
    github/
      client.ts               Server-only GitHub API access + error mapping
      parse.ts                URL / owner-name parsing (shared by client and server)
      types.ts                Shared types and the API response shape
      index.ts                Server entry point
    file-tree.ts              Flat path list → nested sorted tree
tests/                        Unit tests for parse.ts and file-tree.ts
```

All GitHub access lives in `src/lib/github/`. `client.ts` imports `server-only`, so the build fails if it is ever imported into client code.

## Known limitations (Stage 1)

- Public repositories only, and only the default branch.
- GitHub truncates recursive trees for very large repositories (e.g. `torvalds/linux`). The UI shows a warning when that happens.
- Responses are not cached yet, so each lookup uses 2 GitHub API calls.
