import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFileTree } from "../src/lib/file-tree.ts";

test("nests entries, sorts folders first, and counts files and folders", () => {
  const { root, stats } = buildFileTree([
    { path: "README.md", type: "file", size: 10 },
    { path: "src", type: "dir" },
    { path: "src/index.ts", type: "file", size: 5 },
    { path: "src/lib", type: "dir" },
    { path: "src/lib/b.ts", type: "file", size: 1 },
    { path: "src/lib/a.ts", type: "file", size: 1 },
    { path: "vendor", type: "submodule" },
    { path: "docs", type: "dir" },
  ]);

  assert.deepEqual(root.map((n) => n.name), ["docs", "src", "README.md", "vendor"]);
  const src = root.find((n) => n.name === "src")!;
  assert.deepEqual(src.children!.map((n) => n.name), ["lib", "index.ts"]);
  assert.deepEqual(src.children![0].children!.map((n) => n.path), ["src/lib/a.ts", "src/lib/b.ts"]);
  assert.deepEqual(stats, { files: 4, dirs: 3 });
});

test("creates missing parent folders (e.g. from a truncated tree)", () => {
  const { root, stats } = buildFileTree([{ path: "a/b/c.ts", type: "file" }]);
  assert.equal(root[0].path, "a");
  assert.equal(root[0].children![0].path, "a/b");
  assert.deepEqual(stats, { files: 1, dirs: 2 });
});

test("handles an empty repository", () => {
  assert.deepEqual(buildFileTree([]), { root: [], stats: { files: 0, dirs: 0 } });
});
