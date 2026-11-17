import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoInput } from "../src/lib/github/parse.ts";

const ok = { owner: "vercel", name: "swr" };

test("accepts common GitHub repository formats", () => {
  for (const input of [
    "https://github.com/vercel/swr",
    "http://github.com/vercel/swr/",
    "https://www.github.com/vercel/swr",
    "github.com/vercel/swr",
    "https://github.com/vercel/swr.git",
    "git@github.com:vercel/swr.git",
    "https://github.com/vercel/swr/tree/main/src",
    "  vercel/swr  ",
  ]) {
    assert.deepEqual(parseRepoInput(input), ok, input);
  }
});

test("keeps dots, underscores and hyphens in repo names", () => {
  assert.deepEqual(parseRepoInput("vercel/next.js"), { owner: "vercel", name: "next.js" });
  assert.deepEqual(parseRepoInput("my-org/my_repo-2"), { owner: "my-org", name: "my_repo-2" });
});

test("rejects non-repository input", () => {
  for (const input of [
    "",
    "   ",
    "vercel",
    "https://github.com/vercel",
    "https://gitlab.com/vercel/swr",
    "gitlab.com/vercel/swr",
    "not a url",
    "-bad/owner",
    "owner/..",
  ]) {
    assert.equal(parseRepoInput(input), null, JSON.stringify(input));
  }
});
