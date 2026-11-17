import "server-only";

import { HOUR, PromiseCache } from "../cache";
import { getFileText, getTreeAtCommit } from "../github";
import type { RepoRef } from "../github/types";
import { buildImportGraph } from "./imports";
import { isAnalyzableSource, sourcePriority } from "./sources";
import { createModuleResolver, findNearestConfig, isConfigFile, parseTsconfig, resolveConfigReference, type RawTsconfig } from "./tsconfig";
import type { AliasConfigSummary, AnalysisLimits, ImportAnalysis, SkipReason } from "./types";

export const LIMITS: AnalysisLimits = {
  maxFiles: 800,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
};
const FETCH_CONCURRENCY = 16;
// tsconfig/jsconfig files, including extends/references targets.
const MAX_CONFIG_FILES = 60;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_ALIAS_CONFIGS_SHOWN = 20;

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
      aliasConfigs: [],
      stats: {
        sourceFiles: 0,
        analyzedFiles: 0,
        skippedFiles: 0,
        overLimit: 0,
        internalEdges: 0,
        unresolved: 0,
        aliasResolved: 0,
        configFiles: 0,
        durationMs: Date.now() - started,
      },
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

  const sizes = new Map(files.map((f) => [f.path, f.size ?? 0]));
  const [texts, configs] = await Promise.all([
    mapWithConcurrency(selected, FETCH_CONCURRENCY, (path) => getFileText(repo, commit, path)),
    loadConfigs(repo, commit, selected, allPaths, sizes),
  ]);
  const fetched: Array<{ path: string; text: string }> = [];
  selected.forEach((path, i) => {
    const text = texts[i];
    if (text === null) skipped[path] = "fetch_failed";
    else fetched.push({ path, text });
  });

  const resolver = createModuleResolver(allPaths, configs);
  const graph = buildImportGraph(fetched, resolver.resolve);
  const aliasConfigs = summarizeAliasConfigs(fetched.map((f) => f.path), resolver.optionsFor);

  return {
    ...base,
    status: "ok",
    imports: graph.imports,
    importedBy: graph.importedBy,
    skipped,
    aliasConfigs,
    stats: {
      sourceFiles: sources.length,
      analyzedFiles: fetched.length,
      skippedFiles: Object.keys(skipped).length + overLimit,
      overLimit,
      internalEdges: graph.internalEdges,
      unresolved: graph.unresolved,
      aliasResolved: graph.aliasResolved,
      configFiles: configs.size,
      durationMs: Date.now() - started,
    },
  };
}

/**
 * Fetch the tsconfig/jsconfig files that govern the selected sources, plus
 * whatever they `extends` or `references` inside the repository.
 */
async function loadConfigs(
  repo: RepoRef,
  commit: string,
  sources: string[],
  allPaths: ReadonlySet<string>,
  sizes: ReadonlyMap<string, number>,
): Promise<Map<string, RawTsconfig>> {
  const candidates = new Set([...allPaths].filter(isConfigFile));
  const configs = new Map<string, RawTsconfig>();
  if (candidates.size === 0) return configs;

  const requested = new Set<string>();
  let queue: string[] = [];
  const enqueue = (path: string | null) => {
    if (!path || requested.has(path) || requested.size >= MAX_CONFIG_FILES) return;
    if ((sizes.get(path) ?? 0) > MAX_CONFIG_BYTES) return;
    requested.add(path);
    queue.push(path);
  };
  for (const src of sources) enqueue(findNearestConfig(src, candidates));

  while (queue.length > 0) {
    const batch = queue;
    queue = [];
    const texts = await mapWithConcurrency(batch, FETCH_CONCURRENCY, (path) => getFileText(repo, commit, path));
    batch.forEach((path, i) => {
      const text = texts[i];
      const parsed = text === null ? null : parseTsconfig(path, text);
      if (!parsed) return;
      configs.set(path, parsed);
      for (const ref of [...parsed.extends, ...parsed.references]) enqueue(resolveConfigReference(path, ref, allPaths));
    });
  }
  return configs;
}

function summarizeAliasConfigs(
  analyzed: string[],
  optionsFor: ReturnType<typeof createModuleResolver>["optionsFor"],
): AliasConfigSummary[] {
  const byPath = new Map<string, AliasConfigSummary>();
  for (const path of analyzed) {
    const opts = optionsFor(path);
    if (!opts || byPath.has(opts.configPath) || (opts.baseUrl === null && opts.paths.length === 0)) continue;
    byPath.set(opts.configPath, { path: opts.configPath, baseUrl: opts.baseUrl, paths: opts.paths });
    if (byPath.size >= MAX_ALIAS_CONFIGS_SHOWN) break;
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
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
