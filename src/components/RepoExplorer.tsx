"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { buildFileTree } from "@/lib/file-tree";
import { parseRepoInput } from "@/lib/github/parse";
import type { GitHubErrorCode, RepoTree, RepoTreeResponse } from "@/lib/github/types";
import { FileTree } from "./FileTree";
import { AlertIcon, BranchIcon, FolderIcon, GitHubIcon, SpinnerIcon, StarIcon } from "./icons";

type State =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "success"; data: RepoTree }
  | { status: "error"; code: GitHubErrorCode; message: string };

const EXAMPLES = ["vercel/swr", "sindresorhus/ky", "pmndrs/zustand"];

const ERROR_TITLES: Record<GitHubErrorCode, string> = {
  invalid_input: "That doesn't look like a GitHub repository",
  not_found: "Repository not found",
  rate_limited: "GitHub rate limit reached",
  unauthorized: "GitHub authentication failed",
  upstream_error: "GitHub returned an error",
  network_error: "Couldn't reach GitHub",
};

export function RepoExplorer() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const inFlight = useRef<AbortController | null>(null);

  async function load(raw: string) {
    const ref = parseRepoInput(raw);
    if (!ref) {
      setState({
        status: "error",
        code: "invalid_input",
        message: "Enter a GitHub repository URL like https://github.com/owner/repo, or owner/repo.",
      });
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ status: "loading", label: `${ref.owner}/${ref.name}` });

    try {
      const res = await fetch(`/api/repo/tree?repo=${encodeURIComponent(raw.trim())}`, {
        signal: controller.signal,
      });
      const body = (await res.json()) as RepoTreeResponse;
      if (controller.signal.aborted) return;
      if (body.ok) setState({ status: "success", data: body.data });
      else setState({ status: "error", ...body.error });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setState({
        status: "error",
        code: "network_error",
        message: "Couldn't reach the Repo Compass server. Check your connection and try again.",
      });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void load(input);
  }

  const loading = state.status === "loading";

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl" noValidate>
        <label htmlFor="repo-url" className="sr-only">
          GitHub repository URL
        </label>
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/60 transition focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-200/70 sm:flex-row">
          <div className="flex flex-1 items-center gap-2.5 px-3">
            <GitHubIcon className="shrink-0 text-slate-400" width={18} height={18} />
            <input
              id="repo-url"
              name="repo"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://github.com/owner/repository"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-11 w-full bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading && <SpinnerIcon />}
            {loading ? "Exploring…" : "Explore repository"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={loading}
              onClick={() => {
                setInput(`https://github.com/${ex}`);
                void load(ex);
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-xs text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      <section aria-live="polite" className="mx-auto mt-10 w-full max-w-4xl">
        {state.status === "loading" && <LoadingState label={state.label} />}
        {state.status === "error" && (
          <ErrorState
            code={state.code}
            message={state.message}
            onRetry={state.code === "invalid_input" ? undefined : () => void load(input)}
          />
        )}
        {state.status === "success" && <RepoResult data={state.data} />}
      </section>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 text-sm text-slate-600">
        <SpinnerIcon className="text-slate-500" />
        Fetching the file tree for <span className="font-mono font-medium text-slate-900">{label}</span>…
      </div>
      <div className="space-y-2.5 p-5" aria-hidden>
        {[62, 48, 70, 40, 55, 34, 66].map((w, i) => (
          <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${(i % 3) * 1.1}rem` }}>
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-slate-200" />
            <div className="h-3 animate-pulse rounded bg-slate-200" style={{ width: `${w * 0.5}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ code, message, onRetry }: { code: GitHubErrorCode; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-5 py-4">
      <AlertIcon className="mt-0.5 shrink-0 text-red-600" width={18} height={18} />
      <div className="flex-1">
        <p className="font-semibold text-red-900">{ERROR_TITLES[code]}</p>
        <p className="mt-1 text-sm text-red-800">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function RepoResult({ data }: { data: RepoTree }) {
  const { root, stats } = useMemo(() => buildFileTree(data.entries), [data.entries]);
  const { repo } = data;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-lg font-semibold text-slate-900 hover:underline"
            >
              {repo.fullName}
            </a>
            {repo.description && <p className="mt-1 text-sm text-slate-600">{repo.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Pill>
              <BranchIcon width={13} height={13} /> {data.ref}
            </Pill>
            <Pill>
              <StarIcon width={13} height={13} /> {repo.stars.toLocaleString()}
            </Pill>
            {data.entries.length > 0 && (
              <Pill>
                {stats.files.toLocaleString()} files · {stats.dirs.toLocaleString()} folders
              </Pill>
            )}
          </div>
        </div>
      </header>

      {data.truncated && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900">
          This repository is very large, so GitHub returned only part of its file tree. Some files are not shown.
        </div>
      )}

      {data.entries.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <FolderIcon className="text-slate-300" width={36} height={36} />
          <p className="mt-3 font-medium text-slate-800">This repository is empty</p>
          <p className="mt-1 text-sm text-slate-500">
            There are no files on the <span className="font-mono">{data.ref}</span> branch yet.
          </p>
        </div>
      ) : (
        <FileTree key={`${repo.fullName}@${data.sha}`} nodes={root} />
      )}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
      {children}
    </span>
  );
}
