/**
 * The dependency graph around one file: the files it imports on the right,
 * the files that import it on the left. Pure and client-safe: it only reads
 * the `imports` / `importedBy` index returned by /api/repo/imports.
 */
import type { ImportAnalysis } from "../analysis/types.ts";

export type NeighborRole = "importer" | "import" | "cycle";

export interface Neighbor {
  path: string;
  /**
   * - "importer": imports the focus file
   * - "import": imported by the focus file
   * - "cycle": both (shown on the imports side with a two-way edge)
   */
  role: NeighborRole;
  /** Every statement linking the two files is type-only. */
  typeOnly: boolean;
  /** Linked through a tsconfig alias (focus → import only). */
  alias: boolean;
  /** The focus file re-exports from it (focus → import only). */
  reexport: boolean;
  /** Original specifier(s) as written in the focus file (imports side only). */
  specifiers: string[];
}

export interface Neighbors {
  importers: Neighbor[];
  /** Cycles, then imports, each in the order they appear in the focus file. */
  imports: Neighbor[];
  /** Whether the focus file itself was analyzed (so its imports are known). */
  analyzed: boolean;
}

type ImportIndex = Pick<ImportAnalysis, "imports" | "importedBy">;

/** Collect the direct neighbors of `focus`, merging specifiers that resolve to the same file. */
export function collectNeighbors(index: ImportIndex, focus: string): Neighbors {
  const refs = index.imports[focus];
  const importerPaths = new Set(index.importedBy[focus] ?? []);
  importerPaths.delete(focus);

  const byPath = new Map<string, Neighbor>();
  for (const ref of refs ?? []) {
    if (!ref.resolved || ref.resolved === focus) continue;
    const existing = byPath.get(ref.resolved);
    if (existing) {
      existing.typeOnly &&= ref.typeOnly;
      existing.alias ||= ref.kind === "alias";
      existing.reexport ||= ref.reexport;
      existing.specifiers.push(ref.specifier);
      continue;
    }
    byPath.set(ref.resolved, {
      path: ref.resolved,
      role: importerPaths.has(ref.resolved) ? "cycle" : "import",
      typeOnly: ref.typeOnly,
      alias: ref.kind === "alias",
      reexport: ref.reexport,
      specifiers: [ref.specifier],
    });
  }

  const importers: Neighbor[] = [];
  for (const path of [...importerPaths].sort(comparePaths)) {
    const back = (index.imports[path] ?? []).filter((r) => r.resolved === focus);
    const typeOnly = back.length > 0 && back.every((r) => r.typeOnly);
    const cycle = byPath.get(path);
    if (cycle) {
      // A cycle edge is type-only only if both directions are.
      cycle.typeOnly &&= typeOnly;
      continue;
    }
    importers.push({ path, role: "importer", typeOnly, alias: false, reexport: false, specifiers: [] });
  }

  // Cycles first (so they're never hidden behind "+N more"), then source order.
  const imports = [...byPath.values()];
  imports.sort((a, b) => Number(b.role === "cycle") - Number(a.role === "cycle"));
  return { importers, imports, analyzed: refs !== undefined };
}

// ---------------------------------------------------------------------------
// Layout

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 44;
export const FOCUS_WIDTH = 248;
export const FOCUS_HEIGHT = 56;
const ROW_GAP = 10;
const COLUMN_GAP = 40;
/** Horizontal distance between the focus node and the first column on each side. */
const SIDE_GAP = 104;
const MAX_ROWS = 12;
const HEADER_OFFSET = 30;

/** By default each side shows this many files, then a "+N more" node. */
export const DEFAULT_MAX_PER_SIDE = 24;

export type Side = "importers" | "imports";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutNode =
  | (Box & { kind: "focus"; id: string; path: string })
  | (Box & { kind: "neighbor"; id: string; side: Side; neighbor: Neighbor })
  | (Box & { kind: "more"; id: string; side: Side; hidden: number });

export interface LayoutEdge {
  id: string;
  /** Path of the non-focus file. */
  path: string;
  side: Side;
  role: NeighborRole;
  typeOnly: boolean;
  /** Start and end points; edges always run left to right (importer → focus → import). */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface SideHeader {
  side: Side;
  /** Anchor point: the header's text is aligned to the inner edge of the side. */
  x: number;
  y: number;
  total: number;
}

export interface FocusLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  headers: SideHeader[];
  bounds: Box;
}

export interface LayoutOptions {
  maxPerSide?: number;
  /** Sides that show every file instead of truncating. */
  expanded?: ReadonlySet<Side>;
}

/**
 * Lay the graph out in three bands: importers on the left, the focus file in
 * the middle, imports on the right. Each side wraps into columns of at most
 * MAX_ROWS files, growing outward, centered vertically on the focus node.
 * Coordinates are in graph space with the focus node centered at (0, 0).
 */
export function layoutFocusGraph(focus: string, neighbors: Neighbors, options: LayoutOptions = {}): FocusLayout {
  const maxPerSide = options.maxPerSide ?? DEFAULT_MAX_PER_SIDE;
  const nodes: LayoutNode[] = [
    {
      kind: "focus",
      id: `focus:${focus}`,
      path: focus,
      x: -FOCUS_WIDTH / 2,
      y: -FOCUS_HEIGHT / 2,
      width: FOCUS_WIDTH,
      height: FOCUS_HEIGHT,
    },
  ];
  const edges: LayoutEdge[] = [];
  const headers: SideHeader[] = [];

  const placeSide = (side: Side, list: Neighbor[]) => {
    if (list.length === 0) return;
    const limit = options.expanded?.has(side) ? Infinity : maxPerSide;
    const shown = list.length > limit ? list.slice(0, Math.max(limit - 1, 0)) : list;
    const hidden = list.length - shown.length;
    const slots = shown.length + (hidden > 0 ? 1 : 0);

    const columns = Math.ceil(slots / MAX_ROWS);
    const rows = Math.ceil(slots / columns);
    const direction = side === "imports" ? 1 : -1;
    const innerEdge = direction * (FOCUS_WIDTH / 2 + SIDE_GAP);
    const columnHeight = rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;

    const slotBox = (i: number): Box => {
      const column = Math.floor(i / rows);
      const row = i % rows;
      const offset = column * (NODE_WIDTH + COLUMN_GAP);
      const x = direction === 1 ? innerEdge + offset : innerEdge - offset - NODE_WIDTH;
      // Center short final columns, so every column is balanced around y = 0.
      const inColumn = Math.min(rows, slots - column * rows);
      const height = inColumn * NODE_HEIGHT + (inColumn - 1) * ROW_GAP;
      return { x, y: -height / 2 + row * (NODE_HEIGHT + ROW_GAP), width: NODE_WIDTH, height: NODE_HEIGHT };
    };

    shown.forEach((neighbor, i) => {
      const box = slotBox(i);
      nodes.push({ kind: "neighbor", id: `${side}:${neighbor.path}`, side, neighbor, ...box });
      const midY = box.y + NODE_HEIGHT / 2;
      edges.push({
        id: `${side}:${neighbor.path}`,
        path: neighbor.path,
        side,
        role: neighbor.role,
        typeOnly: neighbor.typeOnly,
        from: side === "imports" ? { x: FOCUS_WIDTH / 2, y: 0 } : { x: box.x + NODE_WIDTH, y: midY },
        to: side === "imports" ? { x: box.x, y: midY } : { x: -FOCUS_WIDTH / 2, y: 0 },
      });
    });
    if (hidden > 0) {
      nodes.push({ kind: "more", id: `${side}:more`, side, hidden, ...slotBox(shown.length) });
    }

    headers.push({ side, x: innerEdge, y: -columnHeight / 2 - HEADER_OFFSET, total: list.length });
  };

  placeSide("importers", neighbors.importers);
  placeSide("imports", neighbors.imports);

  return { nodes, edges, headers, bounds: boundsOf(nodes, headers) };
}

function boundsOf(nodes: LayoutNode[], headers: SideHeader[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  for (const h of headers) minY = Math.min(minY, h.y - 8);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A smooth horizontal S-curve between two points, as an SVG path. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max((to.x - from.x) * 0.5, 40);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

// ---------------------------------------------------------------------------
// Viewport math (pan & zoom)

export interface Viewport {
  /** Screen-space translation of the graph origin. */
  x: number;
  y: number;
  /** Scale factor. */
  k: number;
}

export const MIN_ZOOM = 0.2;
/** Below this, node labels are hard to read; the initial view doesn't go lower. */
export const READABLE_ZOOM = 0.65;
export const MAX_ZOOM = 2.5;

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/**
 * The viewport that fits `bounds` inside a `width` × `height` screen, never
 * zooming in past 1 or out past `minZoom`. If the graph doesn't fit at that
 * zoom, the view is centered on the graph origin (the focus node) along the
 * axis that overflows, and the rest can be panned to.
 */
export function fitViewport(bounds: Box, width: number, height: number, padding = 32, minZoom = MIN_ZOOM): Viewport {
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  const k = clampZoom(Math.max(Math.min(availW / bounds.width, availH / bounds.height, 1), minZoom));
  const centerX = bounds.width * k > availW ? 0 : bounds.x + bounds.width / 2;
  const centerY = bounds.height * k > availH ? 0 : bounds.y + bounds.height / 2;
  return { k, x: width / 2 - centerX * k, y: height / 2 - centerY * k };
}

/** Zoom by `factor` keeping the graph point under screen point (sx, sy) fixed. */
export function zoomAround(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const k = clampZoom(v.k * factor);
  const ratio = k / v.k;
  return { k, x: sx - (sx - v.x) * ratio, y: sy - (sy - v.y) * ratio };
}

/** Natural, case-insensitive path order (a2 before a10). */
export function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
