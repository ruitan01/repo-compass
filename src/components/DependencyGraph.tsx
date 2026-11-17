"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { ImportAnalysis } from "@/lib/analysis/types";
import {
  clampZoom,
  collectNeighbors,
  edgePath,
  fitViewport,
  layoutFocusGraph,
  READABLE_ZOOM,
  zoomAround,
  type FocusLayout,
  type LayoutEdge,
  type LayoutNode,
  type Side,
  type Viewport,
} from "@/lib/graph/focus-graph";
import type { AnalysisState } from "./ImportPanel";
import { FileIcon, FitIcon, GraphIcon, MinusIcon, PlusIcon, SpinnerIcon } from "./icons";

interface DependencyGraphProps {
  analysis: AnalysisState;
  selectedPath: string | null;
  onNavigate: (path: string) => void;
}

/**
 * Interactive dependency graph centered on the selected file: importers on
 * the left, imports on the right. Click a node to make it the new center
 * (the file tree follows). Drag to pan, scroll or use the buttons to zoom.
 */
export function DependencyGraph({ analysis, selectedPath, onNavigate }: DependencyGraphProps) {
  return (
    <section aria-label="Dependency graph" className="flex min-w-0 flex-col">
      {analysis.status === "ready" && analysis.data.status === "ok" && selectedPath ? (
        <GraphView data={analysis.data} focus={selectedPath} onNavigate={onNavigate} />
      ) : (
        <>
          <Toolbar />
          <Canvas>
            <GraphPlaceholder analysis={analysis} hasSelection={selectedPath !== null} onNavigate={onNavigate} />
          </Canvas>
        </>
      )}
    </section>
  );
}

const NO_SIDES: ReadonlySet<Side> = new Set();

function GraphView({ data, focus, onNavigate }: { data: ImportAnalysis; focus: string; onNavigate: (path: string) => void }) {
  // Not remounted per file, so nodes can glide to their new positions. The
  // "Show all" choice and hover are per focus file, so reset them on change.
  const [expansion, setExpansion] = useState<{ focus: string; sides: ReadonlySet<Side> }>({ focus, sides: new Set() });
  const expanded = expansion.focus === focus ? expansion.sides : NO_SIDES;
  const [hoverState, setHovered] = useState<string | null>(null);

  const neighbors = useMemo(() => collectNeighbors(data, focus), [data, focus]);
  const layout = useMemo(() => layoutFocusGraph(focus, neighbors, { expanded }), [focus, neighbors, expanded]);
  const { viewport, containerRef, animating, fit, zoomBy, wasDrag } = usePanZoom(layout);
  // The clicked node becomes the center (and its button disappears), so keep
  // focus on the canvas rather than losing it to the page.
  const navigateFromGraph = (path: string) => {
    containerRef.current?.focus({ preventScroll: true });
    onNavigate(path);
  };
  const hovered = hoverState && layout.edges.some((e) => e.path === hoverState) ? hoverState : null;

  const empty = neighbors.importers.length === 0 && neighbors.imports.length === 0;
  const partial = data.stats.overLimit > 0 || data.treeTruncated;

  return (
    <>
      <Toolbar
        zoom={viewport.k}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(0.8)}
        onFit={fit}
      />
      <Canvas
        containerRef={containerRef}
        viewport={viewport}
        label={`Dependency graph for ${focus}. ${neighbors.importers.length} importers, ${neighbors.imports.length} imports. Use + and − to zoom, 0 to fit, arrow keys to pan.`}
      >
        <div
          className={`absolute left-0 top-0 origin-top-left ${animating ? "transition-transform duration-300 ease-out motion-reduce:transition-none" : ""}`}
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}
          onClickCapture={(e) => {
            // A drag that started on a node must not also click it.
            if (wasDrag()) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <Edges layout={layout} focus={focus} hovered={hovered} />
          {layout.headers.map((h) => (
            <div
              key={h.side}
              className={`absolute whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide ${
                h.side === "imports" ? "text-indigo-600" : "-translate-x-full text-emerald-700"
              }`}
              style={{ left: h.x, top: h.y }}
            >
              {h.side === "imports" ? `Imports · ${h.total}` : `Imported by · ${h.total}`}
            </div>
          ))}
          {layout.nodes.map((node) => (
            <GraphNode
              key={node.kind === "neighbor" ? node.neighbor.path : node.id}
              node={node}
              data={data}
              neighborCounts={node.kind === "focus" ? { in: neighbors.importers.length, out: neighbors.imports.length } : undefined}
              hovered={hovered}
              onHover={setHovered}
              onNavigate={navigateFromGraph}
              onExpand={(side) => setExpansion({ focus, sides: new Set(expanded).add(side) })}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
          <Legend />
          <div className="flex flex-col items-end gap-1.5">
            {!neighbors.analyzed && (
              <Note>This file&apos;s own imports weren&apos;t analyzed, so only its importers are shown.</Note>
            )}
            {empty && neighbors.analyzed && <Note>No other file in this repository imports or is imported by this file.</Note>}
            {partial && !empty && <Note>Partial analysis: some importers may be missing.</Note>}
          </div>
        </div>
      </Canvas>
    </>
  );
}

// ---------------------------------------------------------------------------
// Nodes and edges

function GraphNode({
  node,
  data,
  neighborCounts,
  hovered,
  onHover,
  onNavigate,
  onExpand,
}: {
  node: LayoutNode;
  data: ImportAnalysis;
  neighborCounts?: { in: number; out: number };
  hovered: string | null;
  onHover: (path: string | null) => void;
  onNavigate: (path: string) => void;
  onExpand: (side: Side) => void;
}) {
  const style = { left: node.x, top: node.y, width: node.width, height: node.height };
  const position = "absolute transition-[left,top] duration-300 ease-out motion-reduce:transition-none";

  if (node.kind === "focus") {
    const { name, dir } = splitPath(node.path);
    return (
      <div
        style={style}
        title={node.path}
        className={`${position} flex items-center gap-2.5 rounded-xl bg-indigo-600 px-3.5 text-white shadow-lg shadow-indigo-600/25 ring-4 ring-indigo-100`}
      >
        <FileIcon className="shrink-0 text-indigo-200" width={16} height={16} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] font-semibold">{name}</span>
          <span className="block truncate font-mono text-[11px] text-indigo-200">{shortDir(dir) || "/"}</span>
        </span>
        {neighborCounts && (
          <span className="shrink-0 text-right font-mono text-[10px] leading-tight tabular-nums text-indigo-100">
            ← {neighborCounts.in}
            <br />
            {neighborCounts.out} →
          </span>
        )}
      </div>
    );
  }

  if (node.kind === "more") {
    return (
      <button
        type="button"
        style={style}
        onClick={() => onExpand(node.side)}
        className={`${position} motion-safe:animate-fade-in rounded-lg border border-dashed border-slate-300 bg-white/80 px-3 text-left text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}
      >
        +{node.hidden.toLocaleString()} more · <span className="underline underline-offset-2">Show all</span>
      </button>
    );
  }

  const { neighbor, side } = node;
  const { name, dir } = splitPath(neighbor.path);
  const analyzed = data.imports[neighbor.path] !== undefined;
  const isHovered = hovered === neighbor.path;
  const dimmed = hovered !== null && !isHovered;
  const accent =
    neighbor.role === "cycle"
      ? "border-amber-300 hover:border-amber-400 focus-visible:ring-amber-400"
      : side === "imports"
        ? "border-slate-200 hover:border-indigo-300 focus-visible:ring-indigo-400"
        : "border-slate-200 hover:border-emerald-300 focus-visible:ring-emerald-400";
  const relation =
    neighbor.role === "cycle"
      ? "imports and is imported by the selected file"
      : side === "imports"
        ? "imported by the selected file"
        : "imports the selected file";

  return (
    <button
      type="button"
      style={style}
      onClick={() => onNavigate(neighbor.path)}
      onMouseEnter={() => onHover(neighbor.path)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(neighbor.path)}
      onBlur={() => onHover(null)}
      title={`${neighbor.path}\n${relation}${neighbor.specifiers.length ? `\nas ${neighbor.specifiers.join(", ")}` : ""}`}
      aria-label={`${neighbor.path}, ${relation}`}
      className={`${position} group motion-safe:animate-fade-in flex items-center gap-2 rounded-lg border bg-white px-2.5 text-left shadow-sm transition-[left,top,opacity,box-shadow] focus-visible:outline-none focus-visible:ring-2 ${accent} ${
        isHovered ? "shadow-md" : ""
      } ${dimmed ? "opacity-60" : ""}`}
    >
      <FileIcon
        className={`shrink-0 ${analyzed ? (side === "imports" ? "text-indigo-400" : "text-emerald-500") : "text-slate-300"}`}
        width={14}
        height={14}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] text-slate-800 group-hover:text-slate-950">{name}</span>
        <span className="block truncate font-mono text-[10.5px] text-slate-400">{shortDir(dir) || "/"}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {neighbor.role === "cycle" && <NodeBadge tone="amber">cycle</NodeBadge>}
        {neighbor.typeOnly && <NodeBadge>type</NodeBadge>}
        {neighbor.alias && neighbor.role !== "cycle" && !neighbor.typeOnly && <NodeBadge>alias</NodeBadge>}
      </span>
    </button>
  );
}

function NodeBadge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" }) {
  return (
    <span
      className={`rounded px-1 text-[9.5px] font-medium leading-[14px] ${
        tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}

const EDGE_COLORS = {
  importers: { base: "#6ee7b7", active: "#059669" }, // emerald-300 / 600
  imports: { base: "#a5b4fc", active: "#4f46e5" }, // indigo-300 / 600
  cycle: { base: "#fcd34d", active: "#d97706" }, // amber-300 / 600
};

function Edges({ layout, focus, hovered }: { layout: FocusLayout; focus: string; hovered: string | null }) {
  const sorted = hovered
    ? [...layout.edges.filter((e) => e.path !== hovered), ...layout.edges.filter((e) => e.path === hovered)]
    : layout.edges;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
      <defs>
        {Object.entries(EDGE_COLORS).flatMap(([name, c]) =>
          (["base", "active"] as const).map((variant) => (
            <marker
              key={`${name}-${variant}`}
              id={`arrow-${name}-${variant}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={c[variant]} />
            </marker>
          )),
        )}
      </defs>
      {sorted.map((edge) => (
        <EdgePath key={`${focus}|${edge.id}`} edge={edge} active={hovered === edge.path} dimmed={hovered !== null && hovered !== edge.path} />
      ))}
    </svg>
  );
}

function EdgePath({ edge, active, dimmed }: { edge: LayoutEdge; active: boolean; dimmed: boolean }) {
  const palette = edge.role === "cycle" ? "cycle" : edge.side;
  const variant = active ? "active" : "base";
  const marker = `url(#arrow-${palette}-${variant})`;
  return (
    <path
      d={edgePath(edge.from, edge.to)}
      fill="none"
      stroke={EDGE_COLORS[palette][variant]}
      strokeWidth={active ? 2.25 : 1.5}
      strokeDasharray={edge.typeOnly ? "5 4" : undefined}
      markerEnd={marker}
      markerStart={edge.role === "cycle" ? marker : undefined}
      opacity={dimmed ? 0.35 : 1}
      className="motion-safe:animate-fade-in"
    />
  );
}

// ---------------------------------------------------------------------------
// Chrome: toolbar, canvas, legend, placeholder

function Toolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;
}) {
  const disabled = zoom === undefined;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 pl-1 font-medium text-slate-700">
        <GraphIcon className="text-slate-400" width={14} height={14} /> Dependency graph
        <span className="ml-2 hidden font-normal text-slate-400 md:inline xl:hidden 2xl:inline">Drag to pan · Ctrl + scroll to zoom</span>
      </span>
      <div className="flex items-center gap-0.5">
        <ToolButton label="Zoom out" onClick={onZoomOut} disabled={disabled}>
          <MinusIcon width={14} height={14} />
        </ToolButton>
        <span className="w-11 text-center tabular-nums text-slate-500">{disabled ? "–" : `${Math.round(zoom * 100)}%`}</span>
        <ToolButton label="Zoom in" onClick={onZoomIn} disabled={disabled}>
          <PlusIcon width={14} height={14} />
        </ToolButton>
        <ToolButton label="Fit to view" onClick={onFit} disabled={disabled}>
          <FitIcon width={14} height={14} />
          <span className="ml-1">Fit</span>
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center rounded-md px-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const GRID_SIZE = 20;

function Canvas({
  children,
  containerRef,
  viewport,
  label,
}: {
  children: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
  viewport?: Viewport;
  label?: string;
}) {
  // A dot grid that moves and scales with the graph.
  const size = GRID_SIZE * (viewport?.k ?? 1);
  const interactive = containerRef !== undefined;
  return (
    <div
      ref={containerRef}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "application" : undefined}
      aria-roledescription={interactive ? "graph" : undefined}
      aria-label={label}
      className={`relative h-[36rem] touch-none select-none overflow-hidden bg-slate-50/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 ${
        interactive ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        backgroundImage: "radial-gradient(circle, rgb(203 213 225 / 0.7) 1px, transparent 1px)",
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: viewport ? `${viewport.x}px ${viewport.y}px` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-600 shadow-sm backdrop-blur">
      <LegendItem color={EDGE_COLORS.importers.active}>imported by</LegendItem>
      <LegendItem color={EDGE_COLORS.imports.active}>imports</LegendItem>
      <LegendItem color={EDGE_COLORS.cycle.active}>both (cycle)</LegendItem>
      <LegendItem color="#94a3b8" dashed>
        type-only
      </LegendItem>
    </div>
  );
}

function LegendItem({ color, dashed, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="pointer-events-auto max-w-xs rounded-lg border border-amber-200 bg-amber-50/95 px-2.5 py-1.5 text-[11px] text-amber-900 shadow-sm">
      {children}
    </p>
  );
}

function GraphPlaceholder({
  analysis,
  hasSelection,
  onNavigate,
}: {
  analysis: AnalysisState;
  hasSelection: boolean;
  onNavigate: (path: string) => void;
}) {
  const suggestions = useMemo(() => {
    if (analysis.status !== "ready") return [];
    return Object.entries(analysis.data.importedBy)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([path]) => path);
  }, [analysis]);

  let body: ReactNode;
  if (analysis.status === "loading") {
    body = (
      <span className="inline-flex items-center gap-2">
        <SpinnerIcon className="text-slate-500" /> Analyzing imports…
      </span>
    );
  } else if (analysis.status === "error") {
    body = "The graph needs the import analysis, which failed. See the side panel to try again.";
  } else if (analysis.status === "none") {
    body = "This repository has no files yet.";
  } else if (analysis.data.status === "unsupported") {
    body = analysis.data.message ?? "Import analysis isn't available for this repository.";
  } else if (!hasSelection) {
    body = (
      <>
        <p className="font-medium text-slate-800">Select a file to center the graph on it</p>
        <p className="mt-1">You&apos;ll see what it imports on the right and what imports it on the left.</p>
        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {suggestions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onNavigate(p)}
                title={p}
                className="max-w-[14rem] truncate rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-xs text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                {splitPath(p).name}
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-slate-500">
      <GraphIcon className="mb-3 text-slate-300" width={32} height={32} />
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pan & zoom

const DRAG_THRESHOLD = 4;
const KEY_PAN = 60;

/**
 * Pan (pointer drag, arrow keys) and zoom (Ctrl/⌘ + wheel, pinch, plain
 * wheel once the graph has focus, +/- keys) for a graph container. The view is refit whenever the layout
 * changes, and on resize until the user moves the view themselves.
 */
function usePanZoom(layout: FocusLayout) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [animating, setAnimating] = useState(false);
  const userMoved = useRef(false);
  const dragged = useRef(false);
  const viewportRef = useRef(viewport);

  const apply = useCallback((next: Viewport, animate: boolean) => {
    viewportRef.current = next;
    setAnimating(animate);
    setViewport(next);
  }, []);

  /** `readable`: don't zoom out past READABLE_ZOOM (automatic fits); otherwise fit everything (Fit button). */
  const fitNow = useCallback(
    (animate: boolean, readable = true) => {
      const el = containerRef.current;
      if (!el || el.clientWidth === 0) return;
      userMoved.current = false;
      apply(fitViewport(layout.bounds, el.clientWidth, el.clientHeight, 32, readable ? READABLE_ZOOM : undefined), animate);
    },
    [layout.bounds, apply],
  );

  // Fit on mount and when the layout changes (e.g. "Show all").
  const firstFit = useRef(true);
  useLayoutEffect(() => {
    fitNow(!firstFit.current);
    firstFit.current = false;
  }, [fitNow]);

  // Refit on resize, unless the user has panned or zoomed.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!userMoved.current) fitNow(false);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitNow]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      userMoved.current = true;
      apply(zoomAround(viewportRef.current, factor, el.clientWidth / 2, el.clientHeight / 2), true);
    },
    [apply],
  );

  // Wheel zoom needs a non-passive listener to prevent page scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Plain scrolling only zooms once the graph has focus (after a click or
      // Tab), so scrolling the page past the graph isn't hijacked. Ctrl/⌘ +
      // scroll and trackpad pinch (reported as ctrlKey) always zoom.
      if (!e.ctrlKey && !e.metaKey && !el.contains(document.activeElement)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
      userMoved.current = true;
      apply(zoomAround(viewportRef.current, factor, e.clientX - rect.left, e.clientY - rect.top), false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply]);

  // Pointer drag to pan. Pointer capture is only taken once the pointer has
  // moved past a small threshold, so plain clicks still reach the nodes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let start: { id: number; x: number; y: number; v: Viewport } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || start) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, v: viewportRef.current };
      dragged.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragged.current = true;
        el.setPointerCapture(e.pointerId);
      }
      userMoved.current = true;
      apply({ ...start.v, x: start.v.x + dx, y: start.v.y + dy }, false);
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      start = null;
      // The click that ends a drag is dispatched right after pointerup; clear
      // the flag afterwards so later keyboard "clicks" aren't swallowed.
      if (dragged.current) setTimeout(() => (dragged.current = false), 0);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [apply]);

  // Keyboard: + / - zoom, 0 fits, arrows pan (when the canvas itself has focus).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== el || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = viewportRef.current;
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [KEY_PAN, 0],
        ArrowRight: [-KEY_PAN, 0],
        ArrowUp: [0, KEY_PAN],
        ArrowDown: [0, -KEY_PAN],
      };
      if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") zoomBy(0.8);
      else if (e.key === "0") fitNow(true, false);
      else if (pan[e.key]) {
        userMoved.current = true;
        apply({ ...v, x: v.x + pan[e.key][0], y: v.y + pan[e.key][1] }, true);
      } else return;
      e.preventDefault();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [apply, fitNow, zoomBy]);

  return {
    viewport: { ...viewport, k: clampZoom(viewport.k) },
    containerRef,
    animating,
    fit: () => fitNow(true, false),
    zoomBy,
    /** True if the last pointer gesture was a drag; resets after reading. */
    wasDrag: () => {
      const d = dragged.current;
      dragged.current = false;
      return d;
    },
  };
}

// ---------------------------------------------------------------------------

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), dir: slash === -1 ? "" : path.slice(0, slash) };
}

/** Keep the most specific end of long directory paths: "packages/…/src/utils". */
function shortDir(dir: string, max = 30): string {
  if (dir.length <= max) return dir;
  const parts = dir.split("/");
  let tail = parts.at(-1)!;
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}/${tail}`;
    if (parts[0].length + next.length + 3 > max) break;
    tail = next;
  }
  return `${parts[0]}/…/${tail}`;
}
