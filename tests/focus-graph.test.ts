import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImportRef } from "../src/lib/analysis/types.ts";
import {
  DEFAULT_MAX_PER_SIDE,
  FOCUS_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
  collectNeighbors,
  fitViewport,
  layoutFocusGraph,
  zoomAround,
  type Neighbors,
} from "../src/lib/graph/focus-graph.ts";

const ref = (specifier: string, resolved: string | null, extra: Partial<ImportRef> = {}): ImportRef => ({
  specifier,
  resolved,
  kind: resolved === null && !specifier.startsWith(".") ? "package" : "relative",
  typeOnly: false,
  reexport: false,
  line: 1,
  ...extra,
});

test("collects imports in source order and importers sorted by path", () => {
  const n = collectNeighbors(
    {
      imports: {
        "src/a.ts": [
          ref("./z", "src/z.ts"),
          ref("react", null),
          ref("@/lib/b", "src/lib/b.ts", { kind: "alias", reexport: true }),
          ref("./missing", null),
        ],
        "src/c10.ts": [ref("./a", "src/a.ts", { typeOnly: true })],
        "src/c2.ts": [ref("./a", "src/a.ts")],
      },
      importedBy: { "src/a.ts": ["src/c10.ts", "src/c2.ts"] },
    },
    "src/a.ts",
  );
  assert.equal(n.analyzed, true);
  assert.deepEqual(
    n.imports.map((x) => [x.path, x.role, x.alias, x.reexport]),
    [
      ["src/z.ts", "import", false, false],
      ["src/lib/b.ts", "import", true, true],
    ],
  );
  assert.deepEqual(
    n.importers.map((x) => [x.path, x.typeOnly]),
    [
      ["src/c2.ts", false],
      ["src/c10.ts", true],
    ],
  );
});

test("merges specifiers that resolve to the same file", () => {
  const n = collectNeighbors(
    {
      imports: {
        "a.ts": [ref("./b", "b.ts", { typeOnly: true }), ref("./b.js", "b.ts"), ref("~/b", "b.ts", { kind: "alias", typeOnly: true })],
      },
      importedBy: {},
    },
    "a.ts",
  );
  assert.equal(n.imports.length, 1);
  assert.deepEqual(n.imports[0], {
    path: "b.ts",
    role: "import",
    typeOnly: false, // one of the three statements is a value import
    alias: true,
    reexport: false,
    specifiers: ["./b", "./b.js", "~/b"],
  });
});

test("marks two-way dependencies as cycles and shows them once", () => {
  const n = collectNeighbors(
    {
      imports: {
        "a.ts": [ref("./d", "d.ts"), ref("./b", "b.ts", { typeOnly: true })],
        "b.ts": [ref("./a", "a.ts", { typeOnly: true })],
        "c.ts": [ref("./a", "a.ts")],
      },
      importedBy: { "a.ts": ["b.ts", "c.ts"], "b.ts": ["a.ts"], "d.ts": ["a.ts"] },
    },
    "a.ts",
  );
  // Cycles are listed first so they're never hidden behind "+N more".
  assert.deepEqual(
    n.imports.map((x) => [x.path, x.role, x.typeOnly]),
    [
      ["b.ts", "cycle", true],
      ["d.ts", "import", false],
    ],
  );
  assert.deepEqual(
    n.importers.map((x) => x.path),
    ["c.ts"],
  );
});

test("files that weren't analyzed still show their importers", () => {
  const n = collectNeighbors(
    { imports: { "src/a.ts": [ref("./styles.css", "src/styles.css")] }, importedBy: { "src/styles.css": ["src/a.ts"] } },
    "src/styles.css",
  );
  assert.equal(n.analyzed, false);
  assert.deepEqual(n.imports, []);
  assert.deepEqual(
    n.importers.map((x) => x.path),
    ["src/a.ts"],
  );
});

test("ignores self-imports", () => {
  const n = collectNeighbors({ imports: { "a.ts": [ref("./a", "a.ts")] }, importedBy: { "a.ts": ["a.ts"] } }, "a.ts");
  assert.deepEqual([n.imports, n.importers], [[], []]);
});

const neighborsOf = (importers: number, imports: number): Neighbors => {
  const make = (prefix: string, count: number, role: "importer" | "import") =>
    Array.from({ length: count }, (_, i) => ({
      path: `${prefix}${i}.ts`,
      role,
      typeOnly: false,
      alias: false,
      reexport: false,
      specifiers: [],
    }));
  return { importers: make("in", importers, "importer"), imports: make("out", imports, "import"), analyzed: true };
};

test("lays out importers left, focus centered, imports right", () => {
  const layout = layoutFocusGraph("f.ts", neighborsOf(2, 3));
  const focus = layout.nodes.find((n) => n.kind === "focus")!;
  assert.equal(focus.x + focus.width / 2, 0);
  assert.equal(focus.y + focus.height / 2, 0);

  const neighbors = layout.nodes.filter((n) => n.kind === "neighbor");
  for (const n of neighbors) {
    if (n.side === "importers") assert.ok(n.x + n.width < focus.x, `${n.id} is left of focus`);
    else assert.ok(n.x > focus.x + focus.width, `${n.id} is right of focus`);
  }
  // Each side is centered vertically on the focus node.
  const outs = neighbors.filter((n) => n.side === "imports");
  assert.equal(outs[0].y + outs.at(-1)!.y + NODE_HEIGHT, 0);

  // Edges run left to right and touch the right node sides.
  assert.equal(layout.edges.length, 5);
  for (const e of layout.edges) assert.ok(e.from.x < e.to.x);
  const inEdge = layout.edges.find((e) => e.side === "importers")!;
  assert.equal(inEdge.to.x, -FOCUS_WIDTH / 2);
  const outEdge = layout.edges.find((e) => e.side === "imports")!;
  assert.equal(outEdge.from.x, FOCUS_WIDTH / 2);

  assert.deepEqual(
    layout.headers.map((h) => [h.side, h.total]),
    [
      ["importers", 2],
      ["imports", 3],
    ],
  );
});

test("wraps large sides into columns without overlaps", () => {
  const layout = layoutFocusGraph("f.ts", neighborsOf(0, 30), { expanded: new Set(["imports"]) });
  const boxes = layout.nodes.filter((n) => n.kind === "neighbor");
  assert.equal(boxes.length, 30);
  assert.equal(new Set(boxes.map((b) => b.x)).size, 3); // 30 files → 3 columns of ≤ 12
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + NODE_WIDTH && b.x < a.x + NODE_WIDTH && a.y < b.y + NODE_HEIGHT && b.y < a.y + NODE_HEIGHT;
      assert.equal(overlap, false, `${a.id} overlaps ${b.id}`);
    }
  }
  // Bounds contain every node.
  const { bounds } = layout;
  for (const n of layout.nodes) {
    assert.ok(n.x >= bounds.x && n.x + n.width <= bounds.x + bounds.width);
    assert.ok(n.y >= bounds.y && n.y + n.height <= bounds.y + bounds.height);
  }
});

test("truncates long sides with a '+N more' node unless expanded", () => {
  const n = neighborsOf(DEFAULT_MAX_PER_SIDE + 12, 3);
  const collapsed = layoutFocusGraph("f.ts", n);
  const more = collapsed.nodes.find((x) => x.kind === "more");
  assert.ok(more && more.kind === "more");
  assert.equal(more.side, "importers");
  assert.equal(more.hidden, 13);
  assert.equal(collapsed.edges.filter((e) => e.side === "importers").length, DEFAULT_MAX_PER_SIDE - 1);
  assert.equal(collapsed.headers.find((h) => h.side === "importers")!.total, DEFAULT_MAX_PER_SIDE + 12);

  const expanded = layoutFocusGraph("f.ts", n, { expanded: new Set(["importers"]) });
  assert.equal(expanded.nodes.some((x) => x.kind === "more"), false);
  assert.equal(expanded.edges.filter((e) => e.side === "importers").length, DEFAULT_MAX_PER_SIDE + 12);
});

test("a file with no neighbors is just the focus node", () => {
  const layout = layoutFocusGraph("f.ts", neighborsOf(0, 0));
  assert.equal(layout.nodes.length, 1);
  assert.deepEqual(layout.edges, []);
  assert.deepEqual(layout.headers, []);
});

test("fits bounds into the viewport and zooms around a point", () => {
  const v = fitViewport({ x: -500, y: -100, width: 1000, height: 200 }, 600, 400, 50);
  assert.equal(v.k, 0.5);
  assert.deepEqual([v.x, v.y], [300, 200]); // graph origin at the screen center

  // Small graphs are never blown up past 100%.
  assert.equal(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, 600, 400).k, 1);
  // A minimum zoom keeps labels readable; the cropped axis centers on the focus node (the origin).
  const readable = fitViewport({ x: -1500, y: -100, width: 2000, height: 200 }, 600, 400, 0, 0.5);
  assert.deepEqual(readable, { k: 0.5, x: 300, y: 200 });
  // Huge graphs are clamped to the minimum zoom.
  assert.equal(fitViewport({ x: 0, y: 0, width: 1e6, height: 10 }, 600, 400).k, MIN_ZOOM);

  // The graph point under the cursor stays put.
  const z = zoomAround({ x: 100, y: 50, k: 1 }, 2, 300, 250);
  const graphX = (300 - 100) / 1;
  assert.equal(z.k, 2);
  assert.equal(z.x + graphX * z.k, 300);
  assert.equal(zoomAround({ x: 0, y: 0, k: 2 }, 10, 0, 0).k, MAX_ZOOM);
});
