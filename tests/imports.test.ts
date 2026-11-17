import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportGraph, extractImports, resolveRelative } from "../src/lib/analysis/imports.ts";
import { isAnalyzableSource, sourcePriority } from "../src/lib/analysis/sources.ts";

test("extracts static imports, re-exports and import-equals with lines", () => {
  const src = [
    'import React from "react";',
    'import type { A } from "./types";',
    'import { type B, type C } from "./types2";',
    'import { type D, e } from "./mixed";',
    'import "./side-effect";',
    'export * from "./reexport";',
    'export type { T } from "./type-reexport";',
    'import fs = require("fs");',
    'const lazy = import("./dynamic");',
    'export const x = 1;',
  ].join("\n");
  assert.deepEqual(extractImports("src/a.ts", src), [
    { specifier: "react", typeOnly: false, reexport: false, line: 1 },
    { specifier: "./types", typeOnly: true, reexport: false, line: 2 },
    { specifier: "./types2", typeOnly: true, reexport: false, line: 3 },
    { specifier: "./mixed", typeOnly: false, reexport: false, line: 4 },
    { specifier: "./side-effect", typeOnly: false, reexport: false, line: 5 },
    { specifier: "./reexport", typeOnly: false, reexport: true, line: 6 },
    { specifier: "./type-reexport", typeOnly: true, reexport: true, line: 7 },
    { specifier: "fs", typeOnly: false, reexport: false, line: 8 },
  ]);
});

test("parses TSX and tolerates syntax errors", () => {
  assert.equal(extractImports("a.tsx", 'import { B } from "./b";\nexport const A = () => <B x={1} />;').length, 1);
  assert.equal(extractImports("a.ts", 'import { B } from "./b";\nconst = = ;').length, 1);
});

const files = new Set([
  "src/index.ts",
  "src/utils.ts",
  "src/view.tsx",
  "src/lib/index.ts",
  "src/esm.ts",
  "src/types.d.ts",
  "src/data.json",
  "src/legacy.js",
  "index.ts",
]);

test("resolves relative specifiers TypeScript-style", () => {
  assert.equal(resolveRelative("src/index.ts", "./utils", files), "src/utils.ts");
  assert.equal(resolveRelative("src/index.ts", "./view", files), "src/view.tsx");
  assert.equal(resolveRelative("src/index.ts", "./lib", files), "src/lib/index.ts");
  assert.equal(resolveRelative("src/lib/index.ts", "..", files), "src/index.ts");
  assert.equal(resolveRelative("src/index.ts", "./esm.js", files), "src/esm.ts");
  assert.equal(resolveRelative("src/index.ts", "./types", files), "src/types.d.ts");
  assert.equal(resolveRelative("src/index.ts", "./data.json", files), "src/data.json");
  assert.equal(resolveRelative("src/index.ts", "./legacy", files), "src/legacy.js");
  assert.equal(resolveRelative("src/lib/index.ts", "../../index", files), "index.ts");
  assert.equal(resolveRelative("src/index.ts", "./missing", files), null);
  assert.equal(resolveRelative("index.ts", "../outside", files), null);
});

test("builds imports and importedBy, merging duplicate specifiers", () => {
  const graph = buildImportGraph(
    [
      { path: "src/index.ts", text: 'import { a } from "./utils";\nimport type { T } from "./utils";\nexport * from "./lib";\nimport x from "react";\nimport "./missing";' },
      { path: "src/lib/index.ts", text: 'import { a } from "../utils";\nimport self from "./index";' },
    ],
    files,
  );
  assert.deepEqual(graph.imports["src/index.ts"], [
    { specifier: "./utils", resolved: "src/utils.ts", external: false, typeOnly: false, reexport: false, line: 1 },
    { specifier: "./lib", resolved: "src/lib/index.ts", external: false, typeOnly: false, reexport: true, line: 3 },
    { specifier: "react", resolved: null, external: true, typeOnly: false, reexport: false, line: 4 },
    { specifier: "./missing", resolved: null, external: false, typeOnly: false, reexport: false, line: 5 },
  ]);
  assert.deepEqual(graph.importedBy, {
    "src/utils.ts": ["src/index.ts", "src/lib/index.ts"],
    "src/lib/index.ts": ["src/index.ts"],
  });
  assert.equal(graph.internalEdges, 3); // self-import excluded
  assert.equal(graph.unresolved, 1);
});

test("selects and prioritizes source files", () => {
  assert.equal(isAnalyzableSource("src/a.ts"), true);
  assert.equal(isAnalyzableSource("src/a.mts"), true);
  assert.equal(isAnalyzableSource("src/a.d.ts"), false);
  assert.equal(isAnalyzableSource("src/a.js"), false);
  assert.equal(isAnalyzableSource("dist/a.ts"), false);
  assert.equal(isAnalyzableSource("packages/x/node_modules/y/a.ts"), false);
  assert.equal(sourcePriority("src/a.ts"), 0);
  assert.equal(sourcePriority("lib/deep/a.ts"), 0);
  assert.equal(sourcePriority("packages/core/src/a.ts"), 1);
  assert.equal(sourcePriority("extensions/x/a.ts"), 1);
  assert.equal(sourcePriority("src/a.test.ts"), 2);
  assert.equal(sourcePriority("test/a.ts"), 2);
  assert.equal(sourcePriority("examples/app/page.tsx"), 2);
});
