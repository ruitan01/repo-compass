import { analyzeRepoImports } from "@/lib/analysis/analyze";
import type { ImportAnalysisResponse } from "@/lib/analysis/types";
import { GitHubError, getRepoTree, parseRepoInput } from "@/lib/github";

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * GET /api/repo/imports?repo=<owner/name or URL>[&commit=<sha>]
 * Static import analysis of a repository's TypeScript files. Pass the commit
 * returned by /api/repo/tree so the analysis matches the tree being shown;
 * without it, the default branch head is used.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ref = parseRepoInput(params.get("repo") ?? "");
  const commitParam = params.get("commit");

  if (!ref || (commitParam !== null && !SHA_RE.test(commitParam))) {
    return json(
      { ok: false, error: { code: "invalid_input", message: "Provide a GitHub repository (owner/name) and, optionally, a 40-character commit SHA." } },
      400,
    );
  }

  try {
    let commit = commitParam?.toLowerCase();
    if (!commit) {
      commit = (await getRepoTree(ref)).commit;
      if (!commit) {
        return json(
          { ok: false, error: { code: "not_found", message: "This repository is empty, so there's nothing to analyze." } },
          404,
        );
      }
    }
    const data = await analyzeRepoImports(ref, commit);
    return json({ ok: true, data }, 200);
  } catch (err) {
    if (err instanceof GitHubError) {
      return json({ ok: false, error: { code: err.code, message: err.message } }, err.status);
    }
    console.error("Unexpected error analyzing imports", err);
    return json(
      { ok: false, error: { code: "upstream_error", message: "Something went wrong while analyzing imports." } },
      500,
    );
  }
}

function json(body: ImportAnalysisResponse, status: number) {
  return Response.json(body, { status });
}
