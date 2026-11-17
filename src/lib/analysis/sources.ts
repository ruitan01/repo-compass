/**
 * Which files are analyzed, and in what order. No dependencies, so it is
 * safe to use from client code (e.g. to explain why a file has no data).
 */

const SOURCE_RE = /\.(?:ts|tsx|mts|cts)$/i;
const DECLARATION_RE = /\.d\.(?:ts|mts|cts)$/i;
// Build output and dependencies, never worth analyzing.
const EXCLUDED_DIR_RE = /(?:^|\/)(?:node_modules|dist|build|\.next|coverage)\//;
// The project's main source folders at the repository root.
const PRIMARY_DIR_RE = /^(?:src|source|lib|app)\//;
// Tests, examples, docs etc. are analyzed last when limits apply.
const LOW_PRIORITY_RE =
  /(?:^|\/)(?:__tests__|__mocks__|tests?|spec|e2e|examples?|fixtures?|benchmarks?|bench|demos?|docs?|playground|scripts)\/|\.(?:test|spec|stories|bench)\.[cm]?tsx?$/i;

/** Whether a path is a TypeScript source file that analysis would parse. */
export function isAnalyzableSource(path: string): boolean {
  return SOURCE_RE.test(path) && !DECLARATION_RE.test(path) && !EXCLUDED_DIR_RE.test(path);
}

/**
 * Lower is analyzed first: root src/lib folders, then other sources, then
 * tests and examples. Only matters when a repository exceeds the file limit.
 */
export function sourcePriority(path: string): number {
  if (LOW_PRIORITY_RE.test(path)) return 2;
  return PRIMARY_DIR_RE.test(path) ? 0 : 1;
}
