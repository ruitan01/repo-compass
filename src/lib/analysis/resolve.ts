/**
 * Path helpers and TypeScript-style module probing against the repository's
 * file list. Pure: no I/O. Paths are repository-relative POSIX paths with no
 * leading slash; the repository root is "".
 */

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Join and normalize POSIX paths. Returns null if the result escapes the repository root. */
export function joinPath(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
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

export function isRelativeSpecifier(spec: string): boolean {
  return spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");
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
 * Find the file a module path refers to: .js → .ts mapping, exact match,
 * extension probing, then directory index files.
 */
export function probeModule(base: string, files: ReadonlySet<string>): string | null {
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

/** Resolve a relative specifier against the importing file. */
export function resolveRelative(fromPath: string, spec: string, files: ReadonlySet<string>): string | null {
  const base = joinPath(dirname(fromPath), spec);
  return base === null ? null : probeModule(base, files);
}
