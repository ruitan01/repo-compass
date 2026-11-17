/**
 * Shared types for static import analysis. Safe to import from client code.
 */
import type { GitHubErrorCode } from "../github/types";

/** One module specifier referenced by a file, merged across statements. */
export interface ImportRef {
  /** The specifier exactly as written, e.g. "./utils" or "react". */
  specifier: string;
  /** Repository path the specifier resolves to, or null if unresolved or a package. */
  resolved: string | null;
  /**
   * How the specifier was interpreted:
   * - "relative": ./ or ../ path
   * - "alias": matched tsconfig `paths` or resolved via `baseUrl`
   * - "package": anything else (npm packages, workspace packages, unknown aliases)
   */
  kind: "relative" | "alias" | "package";
  /** True if every statement using this specifier is type-only (`import type`, `export type`). */
  typeOnly: boolean;
  /** True if at least one statement re-exports from it (`export … from`). */
  reexport: boolean;
  /** 1-based line of the first statement that uses this specifier. */
  line: number;
}

export type SkipReason = "too_large" | "fetch_failed";

export interface AnalysisStats {
  /** TypeScript source files found in the tree (after excluding build output). */
  sourceFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  /** Sources not analyzed because the file-count or total-size limit was reached (not listed individually). */
  overLimit: number;
  /** Unique file → file edges that resolved inside the repository. */
  internalEdges: number;
  /** Relative or alias specifiers that didn't resolve to a file in the tree. */
  unresolved: number;
  /** Specifiers resolved to a file through tsconfig baseUrl/paths. */
  aliasResolved: number;
  /** tsconfig/jsconfig files read (including `extends` and `references` targets). */
  configFiles: number;
  durationMs: number;
}

export interface AnalysisLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** A config whose baseUrl/paths were applied, for display. Targets are repository paths. */
export interface AliasConfigSummary {
  path: string;
  baseUrl: string | null;
  paths: Array<{ pattern: string; targets: string[] }>;
}

export interface ImportAnalysis {
  /** "unsupported" when the repository has no TypeScript sources to analyze. */
  status: "ok" | "unsupported";
  message?: string;
  commit: string;
  /** Analyzed files → the specifiers they import or re-export. */
  imports: Record<string, ImportRef[]>;
  /** Any file → analyzed files that import it (sorted). */
  importedBy: Record<string, string[]>;
  /**
   * Sources skipped for a per-file reason. Sources that are in neither
   * `imports` nor `skipped` were left out by the overall limits.
   */
  skipped: Record<string, SkipReason>;
  stats: AnalysisStats;
  /** Configs that define path aliases or baseUrl for at least one analyzed file. */
  aliasConfigs: AliasConfigSummary[];
  limits: AnalysisLimits;
  /** The GitHub tree was truncated, so some files (and import targets) may be missing. */
  treeTruncated: boolean;
}

export type ImportAnalysisResponse =
  | { ok: true; data: ImportAnalysis }
  | { ok: false; error: { code: GitHubErrorCode; message: string } };
