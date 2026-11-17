import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportGraph } from "../src/lib/analysis/imports.ts";
import {
  createModuleResolver,
  findNearestConfig,
  getAliasOptions,
  parseTsconfig,
  resolveConfigReference,
  type RawTsconfig,
} from "../src/lib/analysis/tsconfig.ts";

/** Build a resolver from a file list and { path: tsconfig text }. */
function setup(fileList: string[], configTexts: Record<string, string>) {
  const files = new Set([...fileList, ...Object.keys(configTexts)]);
  const configs = new Map<string, RawTsconfig>();
  for (const [path, text] of Object.entries(configTexts)) {
    const parsed = parseTsconfig(path, text);
    assert.ok(parsed, `failed to parse ${path}`);
    configs.set(path, parsed);
  }
  return { files, configs, ...createModuleResolver(files, configs) };
}

test("parses JSONC with comments and trailing commas", () => {
  const cfg = parseTsconfig(
    "tsconfig.json",
    `{
      // Next.js default
      "extends": "./base.json",
      "compilerOptions": {
        /* aliases */
        "baseUrl": ".",
        "paths": { "@/*": ["./src/*"], "bad/*/x/*": ["y"], "num": [1, "./n"], },
      },
      "references": [{ "path": "./tsconfig.app.json" }],
    }`,
  );
  assert.deepEqual(cfg, {
    extends: ["./base.json"],
    references: ["./tsconfig.app.json"],
    baseUrl: ".",
    paths: { "@/*": ["./src/*"], num: ["./n"] }, // patterns with 2+ "*" and non-string targets dropped
  });
  assert.equal(parseTsconfig("tsconfig.json", "not json"), null);
  assert.deepEqual(parseTsconfig("tsconfig.json", "{}"), { extends: [], references: [] });
});

test("Next.js style @/* without baseUrl resolves relative to the config file", () => {
  const { resolve } = setup(
    ["src/lib/utils.ts", "src/components/ui/button.tsx", "src/app/page.tsx", "src/styles/globals.css"],
    { "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }` },
  );
  assert.deepEqual(resolve("src/app/page.tsx", "@/lib/utils"), { kind: "alias", resolved: "src/lib/utils.ts" });
  assert.deepEqual(resolve("src/app/page.tsx", "@/components/ui/button"), {
    kind: "alias",
    resolved: "src/components/ui/button.tsx",
  });
  assert.deepEqual(resolve("src/app/page.tsx", "@/styles/globals.css"), { kind: "alias", resolved: "src/styles/globals.css" });
  assert.deepEqual(resolve("src/app/page.tsx", "@/lib/missing"), { kind: "alias", resolved: null });
  assert.deepEqual(resolve("src/app/page.tsx", "react"), { kind: "package", resolved: null });
  // Scoped packages that merely start with "@" are not the "@/" alias.
  assert.deepEqual(resolve("src/app/page.tsx", "@radix-ui/react-slot"), { kind: "package", resolved: null });
});

test("relative imports are unaffected by aliases and baseUrl", () => {
  const { resolve } = setup(["src/a.ts", "src/b.ts", "b.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "*": ["src/*"] } } }`,
  });
  assert.deepEqual(resolve("src/a.ts", "./b"), { kind: "relative", resolved: "src/b.ts" });
  assert.deepEqual(resolve("src/a.ts", "../b"), { kind: "relative", resolved: "b.ts" });
  assert.deepEqual(resolve("src/a.ts", "./nope"), { kind: "relative", resolved: null });
});

test("baseUrl alone resolves bare specifiers from that directory", () => {
  const { resolve } = setup(["src/components/Button.tsx", "src/lib/index.ts", "lib/top.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": "src" } }`,
  });
  assert.deepEqual(resolve("src/x.ts", "components/Button"), { kind: "alias", resolved: "src/components/Button.tsx" });
  assert.deepEqual(resolve("src/x.ts", "lib"), { kind: "alias", resolved: "src/lib/index.ts" });
  assert.deepEqual(resolve("src/x.ts", "lib/top"), { kind: "package", resolved: null }); // only looks under src/
  assert.deepEqual(resolve("src/x.ts", "react"), { kind: "package", resolved: null });
});

test("paths are relative to baseUrl when it is set", () => {
  const { resolve } = setup(["src/app/utils.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": "./src", "paths": { "~/*": ["app/*"] } } }`,
  });
  assert.deepEqual(resolve("src/index.ts", "~/utils"), { kind: "alias", resolved: "src/app/utils.ts" });
});

test("exact patterns beat wildcards, and the longest prefix wins", () => {
  const { resolve } = setup(["src/config/index.ts", "src/x/config.ts", "src/components/a.ts", "ui/a.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./ui/*"],
      "config": ["./src/config"],
      "config/*": ["./src/x/*"]
    } } }`,
  });
  assert.deepEqual(resolve("a.ts", "@/components/a"), { kind: "alias", resolved: "ui/a.ts" });
  assert.deepEqual(resolve("a.ts", "config"), { kind: "alias", resolved: "src/config/index.ts" });
  assert.deepEqual(resolve("a.ts", "config/config"), { kind: "alias", resolved: "src/x/config.ts" });
});

test("tries substitutions in order, then falls back to baseUrl", () => {
  const noBase = setup(["generated/a.ts", "src/b.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "paths": { "#/*": ["./src/*", "./generated/*"] } } }`,
  });
  assert.deepEqual(noBase.resolve("x.ts", "#/a"), { kind: "alias", resolved: "generated/a.ts" });
  assert.deepEqual(noBase.resolve("x.ts", "#/b"), { kind: "alias", resolved: "src/b.ts" });

  // With baseUrl, path targets are relative to it (shared/), so "#/a" no longer finds generated/a.ts.
  const withBase = setup(["generated/a.ts", "shared/c.ts", "shared/x/d.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": "shared", "paths": { "#/*": ["src/*", "generated/*"], "x/*": ["missing/*"] } } }`,
  });
  assert.deepEqual(withBase.resolve("x.ts", "#/a"), { kind: "alias", resolved: null });
  assert.deepEqual(withBase.resolve("x.ts", "c"), { kind: "alias", resolved: "shared/c.ts" });
  // A pattern that matches but whose targets don't exist still falls back to baseUrl.
  assert.deepEqual(withBase.resolve("x.ts", "x/d"), { kind: "alias", resolved: "shared/x/d.ts" });
});

test('a catch-all "*" pattern does not turn packages into unresolved aliases', () => {
  const { resolve } = setup(["src/types/foo.d.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "paths": { "*": ["./src/types/*"] } } }`,
  });
  assert.deepEqual(resolve("a.ts", "foo"), { kind: "alias", resolved: "src/types/foo.d.ts" });
  assert.deepEqual(resolve("a.ts", "react"), { kind: "package", resolved: null });
});

test("follows extends chains; baseUrl and paths are relative to the config that declares them", () => {
  const { resolve } = setup(["packages/ui/src/button.tsx", "apps/web/lib/db.ts", "apps/web/app/page.tsx"], {
    "tsconfig.base.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@acme/ui/*": ["packages/ui/src/*"] } } }`,
    "apps/web/tsconfig.json": `{ "extends": "../../tsconfig.base.json" }`,
  });
  assert.deepEqual(resolve("apps/web/app/page.tsx", "@acme/ui/button"), {
    kind: "alias",
    resolved: "packages/ui/src/button.tsx",
  });
  assert.deepEqual(resolve("apps/web/app/page.tsx", "apps/web/lib/db"), { kind: "alias", resolved: "apps/web/lib/db.ts" });
});

test("a child's paths replace the parent's paths entirely", () => {
  const { resolve } = setup(["packages/ui/src/button.tsx", "apps/web/lib/db.ts"], {
    "tsconfig.base.json": `{ "compilerOptions": { "paths": { "@acme/ui/*": ["./packages/ui/src/*"] } } }`,
    "apps/web/tsconfig.json": `{ "extends": "../../tsconfig.base", "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
  });
  assert.deepEqual(resolve("apps/web/app/page.tsx", "@/lib/db"), { kind: "alias", resolved: "apps/web/lib/db.ts" });
  assert.deepEqual(resolve("apps/web/app/page.tsx", "@acme/ui/button"), { kind: "package", resolved: null });
});

test("extends arrays apply in order; package extends and cycles are ignored", () => {
  const { resolve } = setup(["one/a.ts", "two/a.ts"], {
    "a.json": `{ "compilerOptions": { "paths": { "x/*": ["./one/*"] } } }`,
    "b.json": `{ "compilerOptions": { "paths": { "x/*": ["./two/*"] } } }`,
    "tsconfig.json": `{ "extends": ["@tsconfig/strictest/tsconfig.json", "./a.json", "./b.json"] }`,
  });
  assert.deepEqual(resolve("a.ts", "x/a"), { kind: "alias", resolved: "two/a.ts" });

  const looped = setup([], {
    "loop1.json": `{ "extends": "./loop2.json" }`,
    "loop2.json": `{ "extends": "./loop1.json" }`,
  });
  assert.deepEqual(getAliasOptions("loop1.json", looped.configs, looped.files), {
    configPath: "loop1.json",
    baseUrl: null,
    paths: [],
  });
});

test("${configDir} refers to the extending config's directory", () => {
  const { resolve } = setup(["apps/web/src/a.ts"], {
    "tsconfig.base.json": `{ "compilerOptions": { "paths": { "@/*": ["\${configDir}/src/*"] } } }`,
    "apps/web/tsconfig.json": `{ "extends": "../../tsconfig.base.json" }`,
  });
  assert.deepEqual(resolve("apps/web/src/b.ts", "@/a"), { kind: "alias", resolved: "apps/web/src/a.ts" });
});

test("each file uses its nearest config", () => {
  const { resolve } = setup(["apps/web/lib/a.ts", "apps/docs/lib/a.ts", "lib/a.ts"], {
    "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
    "apps/web/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
    "apps/docs/jsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }`,
  });
  assert.deepEqual(resolve("apps/web/app/page.tsx", "@/lib/a"), { kind: "alias", resolved: "apps/web/lib/a.ts" });
  assert.deepEqual(resolve("apps/docs/app/page.tsx", "@/lib/a"), { kind: "alias", resolved: "apps/docs/lib/a.ts" });
  assert.deepEqual(resolve("scripts/x.ts", "@/lib/a"), { kind: "alias", resolved: "lib/a.ts" });
});

test("solution-style configs use the referenced config that defines aliases (Vite template)", () => {
  const { resolve, optionsFor } = setup(["src/lib/utils.ts", "src/App.tsx"], {
    "tsconfig.json": `{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.app.json" }] }`,
    "tsconfig.node.json": `{ "compilerOptions": { "strict": true }, "include": ["vite.config.ts"] }`,
    "tsconfig.app.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "include": ["src"] }`,
  });
  assert.deepEqual(resolve("src/App.tsx", "@/lib/utils"), { kind: "alias", resolved: "src/lib/utils.ts" });
  assert.equal(optionsFor("src/App.tsx")?.configPath, "tsconfig.app.json");
});

test("no config means bare specifiers are packages", () => {
  const { resolve } = setup(["src/a.ts"], {});
  assert.deepEqual(resolve("src/b.ts", "src/a"), { kind: "package", resolved: null });
});

test("config lookup helpers", () => {
  const configs = new Set(["tsconfig.json", "apps/web/tsconfig.json", "apps/js/jsconfig.json"]);
  assert.equal(findNearestConfig("apps/web/src/deep/a.ts", configs), "apps/web/tsconfig.json");
  assert.equal(findNearestConfig("apps/js/a.ts", configs), "apps/js/jsconfig.json");
  assert.equal(findNearestConfig("packages/x/a.ts", configs), "tsconfig.json");
  assert.equal(findNearestConfig("a.ts", new Set()), null);

  const files = new Set(["tsconfig.base.json", "apps/web/tsconfig.json", "configs/tsconfig.json"]);
  assert.equal(resolveConfigReference("apps/web/tsconfig.json", "../../tsconfig.base.json", files), "tsconfig.base.json");
  assert.equal(resolveConfigReference("apps/web/tsconfig.json", "../../tsconfig.base", files), "tsconfig.base.json");
  assert.equal(resolveConfigReference("tsconfig.json", "./configs", files), "configs/tsconfig.json");
  assert.equal(resolveConfigReference("tsconfig.json", "@tsconfig/node20/tsconfig.json", files), null);
  assert.equal(resolveConfigReference("tsconfig.json", "../outside.json", files), null);
});

test("graph counts alias edges and unresolved aliases", () => {
  const { resolve } = setup(["src/lib/utils.ts", "src/app/page.tsx"], {
    "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
  });
  const graph = buildImportGraph(
    [
      {
        path: "src/app/page.tsx",
        text: 'import { cn } from "@/lib/utils";\nimport x from "@/gen/client";\nimport React from "react";',
      },
    ],
    resolve,
  );
  assert.deepEqual(graph.importedBy, { "src/lib/utils.ts": ["src/app/page.tsx"] });
  assert.equal(graph.aliasResolved, 1);
  assert.equal(graph.unresolved, 1);
  assert.equal(graph.imports["src/app/page.tsx"][1].kind, "alias");
});
