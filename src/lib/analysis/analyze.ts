import "server-only";

import { HOUR, PromiseCache } from "../cache";
import { getFileText, getTreeAtCommit } from "../github";
import type { RepoRef } from "../github/types";
import { buildImportGraph } from "./imports";
import { isAnalyzableSource, sourcePriority } from "./sources";
import type { AnalysisLimits, ImportAnalysis, SkipReason } from "./types";

export const LIMITS: AnalysisLimits = {
  maxFiles: 800,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
};
const FETCH_CONCURRENCY = 16;

// Results are addressed by commit SHA, so they never go stale.
const analysisCache = new PromiseCache<ImportAnalysis>(30);

/** Analyze relative imports of a repository at a specific commit. Cached per commit. */
export function analyzeRepoImports(repo: RepoRef, commit: string): Promise<ImportAnalysis> {
  const key = `${repo.owner}/${repo.name}@${commit}`.toLowerCase();
  return analysisCache.getOrCreate(key, 12 * HOUR, () => runAnalysis(repo, commit));
}

async function runAnalysis(repo: RepoRef, commit: string): Promise<ImportAnalysis> {
  const started = Date.now();
  const tree = await getTreeAtCommit(repo, commit);
  const files = tree.entries.filter((e) => e.type === "file");
  const allPaths = new Set(files.map((f) => f.path));

  const sources = files
    .filter((f) => isAnalyzableSource(f.path))
    .sort((a, b) => sourcePriority(a.path) - sourcePriority(b.path) || a.path.localeCompare(b.path));

  const base = {
    commit,
    imports: {},
    importedBy: {},
    skipped: {},
    limits: LIMITS,
    treeTruncated: tree.truncated,
  };

  if (sources.length === 0) {
    const hasJs = files.some((f) => /\.(?:js|jsx|mjs|cjs)$/i.test(f.path));
    return {
      ...base,
      status: "unsupported",
      message: hasJs
        ? "This repository has no TypeScript source files. Import analysis currently supports .ts, .tsx, .mts and .cts files; JavaScript support is planned."
        : "This repository has no TypeScript source files to analyze.",
      stats: { sourceFiles: 0, analyzedFiles: 0, skippedFiles: 0, overLimit: 0, internalEdges: 0, unresolved: 0, durationMs: Date.now() - started },
    };
  }

  // Apply limits before fetching anything.
  const skipped: Record<string, SkipReason> = {};
  const selected: string[] = [];
  let totalBytes = 0;
  let overLimit = 0;
  for (const f of sources) {
    const size = f.size ?? 0;
    if (size > LIMITS.maxFileBytes) skipped[f.path] = "too_large";
    else if (selected.length >= LIMITS.maxFiles || totalBytes + size > LIMITS.maxTotalBytes) overLimit++;
    else {
      selected.push(f.path);
      totalBytes += size;
    }
  }

  const texts = await mapWithConcurrency(selected, FETCH_CONCURRENCY, (path) => getFileText(repo, commit, path));
  const fetched: Array<{ path: string; text: string }> = [];
  selected.forEach((path, i) => {
    const text = texts[i];
    if (text === null) skipped[path] = "fetch_failed";
    else fetched.push({ path, text });
  });

  const graph = buildImportGraph(fetched, allPaths);

  return {
    ...base,
    status: "ok",
    imports: graph.imports,
    importedBy: graph.importedBy,
    skipped,
    stats: {
      sourceFiles: sources.length,
      analyzedFiles: fetched.length,
      skippedFiles: Object.keys(skipped).length + overLimit,
      overLimit,
      internalEdges: graph.internalEdges,
      unresolved: graph.unresolved,
      durationMs: Date.now() - started,
    },
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
