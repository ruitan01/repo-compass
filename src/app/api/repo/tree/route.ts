import { GitHubError, getRepoTree, parseRepoInput, type RepoTreeResponse } from "@/lib/github";

/**
 * GET /api/repo/tree?repo=<github url or owner/name>
 * Returns the recursive file tree of a public repository's default branch.
 */
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("repo") ?? "";
  const ref = parseRepoInput(input);

  if (!ref) {
    return json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Enter a GitHub repository URL like https://github.com/owner/repo, or owner/repo.",
        },
      },
      400,
    );
  }

  try {
    const data = await getRepoTree(ref);
    return json({ ok: true, data }, 200);
  } catch (err) {
    if (err instanceof GitHubError) {
      return json({ ok: false, error: { code: err.code, message: err.message } }, err.status);
    }
    console.error("Unexpected error fetching repo tree", err);
    return json(
      { ok: false, error: { code: "upstream_error", message: "Something went wrong while fetching the repository." } },
      500,
    );
  }
}

function json(body: RepoTreeResponse, status: number) {
  return Response.json(body, { status });
}
