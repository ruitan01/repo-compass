# Repo Compass

A visual codebase onboarding tool that helps students and junior developers understand unfamiliar GitHub repositories. Built for MPCS 51238 (Design, Build, Ship).

> **Status: Stage 3A.** Paste a public GitHub repository, browse its file tree, and click any file to see what it imports and what imports it. Imports through tsconfig path aliases (e.g. `@/*`) and `baseUrl` are resolved. The visual dependency graph, accounts (Clerk), persistence (Supabase), and AI features are not built yet.

The original project proposal page is kept at [`index.html`](./index.html).

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Cache Components enabled) + TypeScript
- Tailwind CSS v4
- GitHub REST API + raw.githubusercontent.com (called server-side only)
- TypeScript compiler API for static import parsing (server-side only)

## Getting started

Requirements: Node.js 20.9+ (developed on Node 24) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and enter a repository, e.g. `https://github.com/vercel/swr` or `vercel/swr`.

### Optional: GitHub token

Without a token, GitHub allows **60 API requests per hour per IP**. A new repository lookup uses 3 (metadata, branch head, tree); repeat lookups within a few minutes are served from cache. File contents for import analysis come from raw.githubusercontent.com, which doesn't count against this limit. To raise the limit to 5,000/hour, create a `.env.local` file:

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

### Import analysis

After the tree loads, the client requests `/api/repo/imports` for the same commit. The server:

1. Picks TypeScript sources (`.ts`, `.tsx`, `.mts`, `.cts`; not `.d.ts`; not under `node_modules`, `dist`, `build`, `.next`, `coverage`).
2. Applies limits before downloading anything: **800 files**, **256 KB per file**, **12 MB total**. Root `src/`, `source/`, `lib/`, `app/` are analyzed first, and tests, examples, docs and scripts last.
3. Downloads files at the pinned commit (16 at a time) and parses each with `ts.createSourceFile`. It records `import … from`, side-effect `import "x"`, `export … from`, and `import x = require()`, and tracks whether each one is type-only.
4. Resolves each specifier against the repository's file list (see below).
5. Builds both directions of the index (`imports` and `importedBy`).

### Module resolution

Every specifier is classified as `relative`, `alias` or `package`:

1. **Relative** (`./`, `../`): resolved against the importing file, unchanged from Stage 2.
2. **Alias:** the importing file's nearest `tsconfig.json` (or `jsconfig.json`) is used:
   - `paths`: exact patterns win, otherwise the wildcard with the longest prefix. Targets are tried in order. They're relative to `baseUrl` if set, otherwise to the config that declares `paths` (TypeScript ≥ 4.1 behavior). `${configDir}` is supported.
   - `baseUrl`: bare specifiers are looked up under it (e.g. `components/Button` with `baseUrl: "."`), including after a `paths` match fails.
   - `extends` chains (strings or arrays, relative paths only) are followed. Later configs override earlier ones, and `paths` replaces rather than merges.
   - Solution-style configs (no options of their own, only `references`, like Vite's template) use the first referenced config that defines aliases, e.g. `tsconfig.app.json`.
3. **Package:** anything else.

Every candidate path goes through the same file probing: `./x.js` → `./x.ts`, then extensions (`.ts`, `.tsx`, `.d.ts`, … `.js`), then `dir/index.*`. A `paths` pattern that matches but whose targets don't exist (e.g. generated code like `contentlayer/generated`) is shown as an **unresolved alias**. The exception is a catch-all `"*"` pattern, which is treated as a package.

Config files are fetched alongside the sources (up to 60, 64 KB each), only for configs that govern analyzed files, plus their `extends` and `references` targets.

Repositories with no TypeScript sources get an "unsupported" result, and the tree still works.

**Not handled yet:**
- Workspace packages (e.g. `@acme/ui` resolved through `package.json` workspaces or `exports` rather than `paths`).
- `extends` from npm packages (e.g. `@tsconfig/next`): we don't have `node_modules`.
- tsconfig `include`/`exclude`: the nearest config is used even for files it excludes.
- `package.json` `imports` (`#subpath`).
- Dynamic `import()` / `require()` calls, and JavaScript sources.

### Caching

`src/lib/cache.ts` is a small in-memory LRU cache of promises. Concurrent requests share one fetch, and failed requests are never cached. Commit-addressed data (trees, analysis results) is cached for hours because it never changes. Repository metadata and branch heads are cached for 1–5 minutes. The cache is per server instance and resets on restart.

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

`GET /api/repo/imports?repo=<owner/name>&commit=<40-char sha>` (`commit` is optional and defaults to the default branch head)

```jsonc
// 200
{ "ok": true, "data": {
    "status": "ok",                      // or "unsupported" (with "message")
    "commit": "…",
    "imports":    { "src/a.ts": [
        { "specifier": "./b", "resolved": "src/b.ts", "kind": "relative", "typeOnly": false, "reexport": false, "line": 3 },
        { "specifier": "@/lib/utils", "resolved": "src/lib/utils.ts", "kind": "alias", "typeOnly": false, "reexport": false, "line": 4 },
        { "specifier": "react", "resolved": null, "kind": "package", "typeOnly": false, "reexport": false, "line": 5 } ] },
    "importedBy": { "src/b.ts": ["src/a.ts"], "src/lib/utils.ts": ["src/a.ts"] },
    "skipped":    { "src/huge.ts": "too_large" },   // per-file skips; over-limit files are only counted
    "aliasConfigs": [{ "path": "tsconfig.json", "baseUrl": null, "paths": [{ "pattern": "@/*", "targets": ["src/*"] }] }],
    "stats": { "sourceFiles": 193, "analyzedFiles": 193, "skippedFiles": 0, "overLimit": 0, "internalEdges": 235,
               "unresolved": 0, "aliasResolved": 46, "configFiles": 9, "durationMs": 1889 },
    "limits": { "maxFiles": 800, "maxFileBytes": 262144, "maxTotalBytes": 12582912 },
    "treeTruncated": false } }
```

Error codes (both endpoints): `invalid_input` (400), `not_found` (404), `rate_limited` (429), `unauthorized`, `upstream_error`, `network_error` (502).

Accepted input formats: `https://github.com/owner/repo`, `github.com/owner/repo`, `…/repo.git`, `git@github.com:owner/repo.git`, URLs with extra path such as `/tree/main/src` (the extra path is ignored for now), and `owner/repo`.

## Project structure

```
src/
  app/
    page.tsx                  Homepage
    layout.tsx, globals.css
    api/repo/tree/route.ts    GET file tree (thin wrapper around lib/github)
    api/repo/imports/route.ts GET import analysis (thin wrapper around lib/analysis)
  components/
    RepoExplorer.tsx          Input form + loading / error states
    RepoWorkspace.tsx         Result view: header, tree, side panel, selection + back history
    FileTree.tsx              Collapsible, selectable file tree (controlled)
    ImportPanel.tsx           Imports / importers side panel with navigation
    icons.tsx
  lib/
    analysis/
      analyze.ts              Server-only: limits, file download, caching
      imports.ts              Pure: TS compiler parsing + import/importedBy index (resolver injected)
      resolve.ts              Pure: path helpers, file probing, relative resolution
      tsconfig.ts             Pure: tsconfig parsing, extends/references, baseUrl/paths resolver
      sources.ts              Which files are analyzed and in what order (client-safe)
      types.ts                Shared analysis types
    cache.ts                  In-memory LRU promise cache with TTL
    github/
      client.ts               Server-only GitHub API access, error mapping, caching
      parse.ts                URL / owner-name parsing (shared by client and server)
      types.ts                Shared types and the API response shape
      index.ts                Server entry point
    file-tree.ts              Flat path list → nested sorted tree
tests/                        Unit tests (parsing, tree building, import analysis, path aliases, cache)
```

All GitHub access lives in `src/lib/github/`. `client.ts` and `analysis/analyze.ts` import `server-only`, so the build fails if either is ever imported into client code. The TypeScript compiler is never shipped to the browser.

## Known limitations

- Public repositories only, and only the default branch.
- GitHub truncates recursive trees for very large repositories (e.g. `torvalds/linux`). The UI shows a warning when that happens.
- Import analysis covers TypeScript files and relative + tsconfig-alias imports (see above). Large repositories are analyzed only partially, and the panel says so.
- The cache is in memory and per server instance.
