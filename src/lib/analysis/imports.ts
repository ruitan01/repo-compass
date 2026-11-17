/**
 * Pure static import analysis: parsing with the TypeScript compiler API,
 * relative path resolution, and building the import / imported-by index.
 *
 * No network or framework code here, so it can be unit tested with plain Node.
 */
import ts from "typescript";
import type { ImportRef } from "./types";

export function isRelativeSpecifier(spec: string): boolean {
  return spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");
}

export interface RawImport {
  specifier: string;
  typeOnly: boolean;
  reexport: boolean;
  line: number;
}

function scriptKindFor(path: string): ts.ScriptKind {
  return /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Extract static module references from a TypeScript file:
 *   import … from "x" / import "x" / import x = require("x")
 *   export … from "x" / export * from "x"
 * Dynamic import() and require() calls are not included.
 */
export function extractImports(path: string, text: string): RawImport[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKindFor(path));
  const out: RawImport[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      let typeOnly = false;
      if (clause) {
        const bindings = clause.namedBindings;
        const allNamedAreTypes =
          !!bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((el) => el.isTypeOnly);
        typeOnly = clause.isTypeOnly || (!clause.name && allNamedAreTypes);
      }
      out.push({ specifier: stmt.moduleSpecifier.text, typeOnly, reexport: false, line: lineOf(stmt) });
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.exportClause;
      const allNamedAreTypes =
        !!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((el) => el.isTypeOnly);
      out.push({
        specifier: stmt.moduleSpecifier.text,
        typeOnly: stmt.isTypeOnly || allNamedAreTypes,
        reexport: true,
        line: lineOf(stmt),
      });
    } else if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteral(stmt.moduleReference.expression)
    ) {
      out.push({
        specifier: stmt.moduleReference.expression.text,
        typeOnly: stmt.isTypeOnly,
        reexport: false,
        line: lineOf(stmt),
      });
    }
  }
  return out;
}

/** Join and normalize POSIX paths. Returns null if the result escapes the repository root. */
function joinPath(fromDir: string, spec: string): string | null {
  const parts = fromDir ? fromDir.split("/") : [];
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

// Order mirrors TypeScript's resolution: TS sources and declarations before JS.
const PROBE_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
// TypeScript's ESM convention: "./x.js" in source refers to "./x.ts".
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

/**
 * Resolve a relative specifier against the importing file, using the set of
 * files in the repository. Follows TypeScript-style rules: exact match,
 * .js → .ts mapping, extension probing, then directory index files.
 */
export function resolveRelative(fromPath: string, spec: string, files: ReadonlySet<string>): string | null {
  const slash = fromPath.lastIndexOf("/");
  const base = joinPath(slash === -1 ? "" : fromPath.slice(0, slash), spec);
  if (base === null) return null;

  const candidates: string[] = [];
  const jsExt = base.match(/\.(?:js|jsx|mjs|cjs)$/i)?.[0];
  if (jsExt) {
    const stem = base.slice(0, -jsExt.length);
    for (const ext of JS_TO_TS[jsExt.toLowerCase()]) candidates.push(stem + ext);
  }
  if (base) candidates.push(base);
  for (const ext of PROBE_EXTENSIONS) candidates.push(base + ext);
  for (const ext of PROBE_EXTENSIONS) candidates.push(base ? `${base}/index${ext}` : `index${ext}`);

  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

export interface ImportGraph {
  imports: Record<string, ImportRef[]>;
  importedBy: Record<string, string[]>;
  internalEdges: number;
  unresolved: number;
}

/**
 * Parse every source and build both directions of the import index.
 * `allFiles` is every file path in the repository (resolution targets need
 * not be analyzed themselves, e.g. .d.ts, .js or .json files).
 */
export function buildImportGraph(
  sources: ReadonlyArray<{ path: string; text: string }>,
  allFiles: ReadonlySet<string>,
): ImportGraph {
  const imports: Record<string, ImportRef[]> = {};
  const importedBySets = new Map<string, Set<string>>();
  let internalEdges = 0;
  let unresolved = 0;

  for (const { path, text } of sources) {
    const merged = new Map<string, ImportRef>();
    for (const raw of extractImports(path, text)) {
      const existing = merged.get(raw.specifier);
      if (existing) {
        existing.typeOnly &&= raw.typeOnly;
        existing.reexport ||= raw.reexport;
        continue;
      }
      const external = !isRelativeSpecifier(raw.specifier);
      merged.set(raw.specifier, {
        specifier: raw.specifier,
        resolved: external ? null : resolveRelative(path, raw.specifier, allFiles),
        external,
        typeOnly: raw.typeOnly,
        reexport: raw.reexport,
        line: raw.line,
      });
    }

    const refs = [...merged.values()].sort((a, b) => a.line - b.line);
    imports[path] = refs;

    const targets = new Set<string>();
    for (const ref of refs) {
      if (ref.resolved && ref.resolved !== path) targets.add(ref.resolved);
      else if (!ref.external && !ref.resolved) unresolved++;
    }
    for (const target of targets) {
      let set = importedBySets.get(target);
      if (!set) importedBySets.set(target, (set = new Set()));
      set.add(path);
      internalEdges++;
    }
  }

  const importedBy: Record<string, string[]> = {};
  for (const [target, set] of importedBySets) importedBy[target] = [...set].sort();
  return { imports, importedBy, internalEdges, unresolved };
}
