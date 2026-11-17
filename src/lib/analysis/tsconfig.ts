/**
 * tsconfig.json / jsconfig.json support: parsing, `extends` chains, solution
 * style `references`, and module resolution through `baseUrl` and `paths`.
 *
 * Pure: config file contents are passed in, nothing is fetched here.
 */
import ts from "typescript";
import { dirname, isRelativeSpecifier, joinPath, probeModule, resolveRelative } from "./resolve.ts";

/** The parts of a config file that matter for module resolution. */
export interface RawTsconfig {
  extends: string[];
  baseUrl?: string;
  paths?: Record<string, string[]>;
  references: string[];
}

const CONFIG_NAME_RE = /(?:^|\/)(?:tsconfig|jsconfig)\.json$/;
const CONFIG_DIR = "${configDir}";
const MAX_EXTENDS_DEPTH = 8;

export function isConfigFile(path: string): boolean {
  return CONFIG_NAME_RE.test(path);
}

/** Parse a tsconfig/jsconfig (JSON with comments and trailing commas). Returns null if invalid. */
export function parseTsconfig(path: string, text: string): RawTsconfig | null {
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  if (error || !config || typeof config !== "object" || Array.isArray(config)) return null;

  const ext = config.extends;
  const extendsList = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((e): e is string => typeof e === "string") : [];

  const co = isObject(config.compilerOptions) ? config.compilerOptions : {};
  const result: RawTsconfig = {
    extends: extendsList,
    references: Array.isArray(config.references)
      ? config.references.flatMap((r: unknown) => (isObject(r) && typeof r.path === "string" ? [r.path] : []))
      : [],
  };
  if (typeof co.baseUrl === "string") result.baseUrl = co.baseUrl;
  if (isObject(co.paths)) {
    const paths: Record<string, string[]> = {};
    for (const [pattern, targets] of Object.entries(co.paths)) {
      if (!Array.isArray(targets)) continue;
      const valid = targets.filter((t): t is string => typeof t === "string");
      if (valid.length > 0 && countStars(pattern) <= 1) paths[pattern] = valid;
    }
    result.paths = paths;
  }
  return result;
}

/**
 * Resolve an `extends` or `references` path to a config file in the
 * repository. Package specifiers (e.g. "@tsconfig/node20") return null:
 * they live in node_modules, which we don't have.
 */
export function resolveConfigReference(fromConfig: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!isRelativeSpecifier(spec)) return null;
  const base = joinPath(dirname(fromConfig), spec);
  if (base === null) return null;
  const candidates = base.endsWith(".json") ? [base] : [`${base}.json`, base ? `${base}/tsconfig.json` : "tsconfig.json"];
  return candidates.find((c) => files.has(c)) ?? null;
}

/** The nearest tsconfig.json (or jsconfig.json) in the file's directory or its ancestors. */
export function findNearestConfig(sourcePath: string, configs: ReadonlySet<string>): string | null {
  let dir = dirname(sourcePath);
  for (;;) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = dir ? `${dir}/${name}` : name;
      if (configs.has(candidate)) return candidate;
    }
    if (!dir) return null;
    dir = dirname(dir);
  }
}

export interface PathMapping {
  pattern: string;
  /** Repository-relative target patterns, with "*" kept for substitution. */
  targets: string[];
}

/** Effective module resolution options for files governed by one config. */
export interface AliasOptions {
  /** The config file whose options apply (may be a referenced config, e.g. tsconfig.app.json). */
  configPath: string;
  /** Repository-relative baseUrl directory ("" is the root), or null if unset. */
  baseUrl: string | null;
  paths: PathMapping[];
}

interface Collected {
  baseUrl?: string | null;
  paths?: { map: Record<string, string[]>; dir: string };
}

/**
 * Compute baseUrl/paths for a config, following `extends` (later entries
 * and the config itself override earlier ones, and `paths` replaces rather
 * than merges, as in TypeScript). If the config is solution-style (no
 * options of its own but `references`), the first referenced config that
 * defines aliases is used instead.
 */
export function getAliasOptions(
  configPath: string,
  configs: ReadonlyMap<string, RawTsconfig>,
  files: ReadonlySet<string>,
): AliasOptions {
  const own = compile(configPath, configs, files);
  if (own.baseUrl !== null || own.paths.length > 0) return own;

  for (const ref of configs.get(configPath)?.references ?? []) {
    const target = resolveConfigReference(configPath, ref, files);
    if (!target || target === configPath) continue;
    const opts = compile(target, configs, files);
    if (opts.baseUrl !== null || opts.paths.length > 0) return opts;
  }
  return own;
}

function compile(configPath: string, configs: ReadonlyMap<string, RawTsconfig>, files: ReadonlySet<string>): AliasOptions {
  const leafDir = dirname(configPath);
  const collected = collect(configPath, configs, files, leafDir, []);
  const baseUrl = collected.baseUrl ?? null;

  const paths: PathMapping[] = [];
  if (collected.paths) {
    // Without baseUrl, paths are relative to the config file that declares them.
    const base = baseUrl ?? collected.paths.dir;
    for (const [pattern, rawTargets] of Object.entries(collected.paths.map)) {
      const targets = rawTargets.flatMap((t) => {
        const joined = t.startsWith(CONFIG_DIR) ? joinPath(leafDir, t.slice(CONFIG_DIR.length)) : joinPath(base, t);
        return joined === null || countStars(joined) > 1 ? [] : [joined];
      });
      if (targets.length > 0) paths.push({ pattern, targets });
    }
  }
  return { configPath, baseUrl, paths };
}

function collect(
  configPath: string,
  configs: ReadonlyMap<string, RawTsconfig>,
  files: ReadonlySet<string>,
  leafDir: string,
  stack: string[],
): Collected {
  const raw = configs.get(configPath);
  if (!raw || stack.includes(configPath) || stack.length >= MAX_EXTENDS_DEPTH) return {};
  const nextStack = [...stack, configPath];

  const result: Collected = {};
  for (const ext of raw.extends) {
    const target = resolveConfigReference(configPath, ext, files);
    if (!target) continue;
    const parent = collect(target, configs, files, leafDir, nextStack);
    if (parent.baseUrl !== undefined) result.baseUrl = parent.baseUrl;
    if (parent.paths !== undefined) result.paths = parent.paths;
  }

  const dir = dirname(configPath);
  if (raw.baseUrl !== undefined) {
    result.baseUrl = raw.baseUrl.startsWith(CONFIG_DIR)
      ? joinPath(leafDir, raw.baseUrl.slice(CONFIG_DIR.length))
      : joinPath(dir, raw.baseUrl);
  }
  if (raw.paths !== undefined) result.paths = { map: raw.paths, dir };
  return result;
}

export type ResolutionKind = "relative" | "alias" | "package";

export interface Resolution {
  kind: ResolutionKind;
  /** Repository path, or null if it doesn't resolve to a file in the repository. */
  resolved: string | null;
}

/**
 * Resolve a non-relative specifier through `paths`, then `baseUrl`, like
 * TypeScript does before falling back to node_modules.
 *
 * - A `paths` pattern matched but no target exists → alias, unresolved.
 *   (Except a bare "*" pattern, which matches everything, including packages.)
 * - Nothing matched → package.
 */
export function resolveAlias(spec: string, opts: AliasOptions, files: ReadonlySet<string>): Resolution {
  const match = matchPattern(spec, opts.paths);
  if (match) {
    for (const target of match.mapping.targets) {
      const found = probeModule(target.replace("*", match.captured), files);
      if (found) return { kind: "alias", resolved: found };
    }
  }
  if (opts.baseUrl !== null) {
    const base = joinPath(opts.baseUrl, spec);
    const found = base === null ? null : probeModule(base, files);
    if (found) return { kind: "alias", resolved: found };
  }
  if (match && match.mapping.pattern !== "*") return { kind: "alias", resolved: null };
  return { kind: "package", resolved: null };
}

/** Exact patterns win; otherwise the wildcard pattern with the longest prefix (TypeScript's rule). */
function matchPattern(spec: string, mappings: PathMapping[]): { mapping: PathMapping; captured: string } | null {
  let best: { mapping: PathMapping; captured: string; prefixLength: number } | null = null;
  for (const mapping of mappings) {
    const star = mapping.pattern.indexOf("*");
    if (star === -1) {
      if (mapping.pattern === spec) return { mapping, captured: "" };
      continue;
    }
    const prefix = mapping.pattern.slice(0, star);
    const suffix = mapping.pattern.slice(star + 1);
    if (
      spec.length >= prefix.length + suffix.length &&
      spec.startsWith(prefix) &&
      spec.endsWith(suffix) &&
      (!best || prefix.length > best.prefixLength)
    ) {
      best = { mapping, captured: spec.slice(prefix.length, spec.length - suffix.length), prefixLength: prefix.length };
    }
  }
  return best && { mapping: best.mapping, captured: best.captured };
}

export type ModuleResolver = (fromPath: string, spec: string) => Resolution;

/**
 * Build a resolver for the whole repository. Each importing file uses the
 * options of its nearest config. Results are memoized per config.
 */
export function createModuleResolver(
  files: ReadonlySet<string>,
  configs: ReadonlyMap<string, RawTsconfig>,
): { resolve: ModuleResolver; optionsFor: (fromPath: string) => AliasOptions | null } {
  const configPaths = new Set(configs.keys());
  const nearestByDir = new Map<string, string | null>();
  const optionsByConfig = new Map<string, AliasOptions>();

  const optionsFor = (fromPath: string): AliasOptions | null => {
    const dir = dirname(fromPath);
    let configPath = nearestByDir.get(dir);
    if (configPath === undefined) {
      configPath = findNearestConfig(fromPath, configPaths);
      nearestByDir.set(dir, configPath);
    }
    if (!configPath) return null;
    let opts = optionsByConfig.get(configPath);
    if (!opts) {
      opts = getAliasOptions(configPath, configs, files);
      optionsByConfig.set(configPath, opts);
    }
    return opts;
  };

  const resolve: ModuleResolver = (fromPath, spec) => {
    if (isRelativeSpecifier(spec)) return { kind: "relative", resolved: resolveRelative(fromPath, spec, files) };
    const opts = optionsFor(fromPath);
    return opts ? resolveAlias(spec, opts, files) : { kind: "package", resolved: null };
  };

  return { resolve, optionsFor };
}

function countStars(s: string): number {
  return s.split("*").length - 1;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
