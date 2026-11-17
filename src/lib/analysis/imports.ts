/**
 * Pure static import analysis: parsing with the TypeScript compiler API and
 * building the import / imported-by index. Module resolution is injected
 * (see tsconfig.ts), so this file only deals with syntax and bookkeeping.
 *
 * No network or framework code here, so it can be unit tested with plain Node.
 */
import ts from "typescript";
import type { ModuleResolver } from "./tsconfig.ts";
import type { ImportRef } from "./types";

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

export interface ImportGraph {
  imports: Record<string, ImportRef[]>;
  importedBy: Record<string, string[]>;
  internalEdges: number;
  unresolved: number;
  /** Specifiers resolved to a file through tsconfig baseUrl/paths. */
  aliasResolved: number;
}

/**
 * Parse every source and build both directions of the import index.
 * Resolution targets need not be analyzed themselves (e.g. .d.ts, .js or
 * .json files), only present in the repository.
 */
export function buildImportGraph(
  sources: ReadonlyArray<{ path: string; text: string }>,
  resolve: ModuleResolver,
): ImportGraph {
  const imports: Record<string, ImportRef[]> = {};
  const importedBySets = new Map<string, Set<string>>();
  let internalEdges = 0;
  let unresolved = 0;
  let aliasResolved = 0;

  for (const { path, text } of sources) {
    const merged = new Map<string, ImportRef>();
    for (const raw of extractImports(path, text)) {
      const existing = merged.get(raw.specifier);
      if (existing) {
        existing.typeOnly &&= raw.typeOnly;
        existing.reexport ||= raw.reexport;
        continue;
      }
      const { kind, resolved } = resolve(path, raw.specifier);
      merged.set(raw.specifier, {
        specifier: raw.specifier,
        resolved,
        kind,
        typeOnly: raw.typeOnly,
        reexport: raw.reexport,
        line: raw.line,
      });
    }

    const refs = [...merged.values()].sort((a, b) => a.line - b.line);
    imports[path] = refs;

    const targets = new Set<string>();
    for (const ref of refs) {
      if (ref.kind === "alias" && ref.resolved) aliasResolved++;
      if (ref.resolved && ref.resolved !== path) targets.add(ref.resolved);
      else if (ref.kind !== "package" && !ref.resolved) unresolved++;
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
  return { imports, importedBy, internalEdges, unresolved, aliasResolved };
}
