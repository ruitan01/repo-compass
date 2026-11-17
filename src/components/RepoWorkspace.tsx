"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ImportAnalysisResponse } from "@/lib/analysis/types";
import { buildFileTree, type FileNode } from "@/lib/file-tree";
import type { RepoTree } from "@/lib/github/types";
import { FileTree } from "./FileTree";
import { ImportPanel, type AnalysisState } from "./ImportPanel";
import { BranchIcon, FolderIcon, StarIcon } from "./icons";

/**
 * The result view for one repository at one commit: header, file tree and
 * import side panel. Mount it with a key of repo@commit so state resets
 * when a different repository is loaded.
 */
export function RepoWorkspace({ data }: { data: RepoTree }) {
  const { root, stats } = useMemo(() => buildFileTree(data.entries), [data.entries]);
  const { repo } = data;
  const analysis = useImportAnalysis(repo.fullName, data.commit);

  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const reveal = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) next.add(path.slice(0, i));
      return next.size === prev.size ? prev : next;
    });

  const navigate = (path: string) => {
    if (path === selected) return;
    if (selected) setHistory((h) => [...h, selected]);
    setSelected(path);
    reveal(path);
  };

  const back = () => {
    const prev = history.at(-1) ?? null;
    setHistory((h) => h.slice(0, -1));
    setSelected(prev);
    if (prev) reveal(prev);
  };

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

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
              {data.commit && <span className="font-mono text-slate-400">@{data.commit.slice(0, 7)}</span>}
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
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <FileTree
            nodes={root}
            expanded={expanded}
            selectedPath={selected}
            onToggleDir={toggleDir}
            onSelectFile={navigate}
            onExpandAll={() => setExpanded(new Set(collectDirPaths(root)))}
            onCollapseAll={() => setExpanded(new Set())}
          />
          <ImportPanel
            analysis={analysis.state}
            selectedPath={selected}
            blobBase={`${repo.htmlUrl}/blob/${data.commit}`}
            canGoBack={selected !== null}
            onBack={back}
            onNavigate={navigate}
            onRetry={analysis.retry}
          />
        </div>
      )}
    </div>
  );
}

/** Fetch the import analysis for a repository at a commit. */
function useImportAnalysis(fullName: string, commit: string) {
  const [state, setState] = useState<AnalysisState>(commit ? { status: "loading" } : { status: "none" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!commit) return;
    const controller = new AbortController();
    const url = `/api/repo/imports?repo=${encodeURIComponent(fullName)}&commit=${commit}`;
    fetch(url, { signal: controller.signal })
      .then((res) => res.json() as Promise<ImportAnalysisResponse>)
      .then((body) => {
        if (controller.signal.aborted) return;
        setState(body.ok ? { status: "ready", data: body.data } : { status: "error", ...body.error });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          code: "network_error",
          message: "Couldn't reach the Repo Compass server. Check your connection and try again.",
        });
      });
    return () => controller.abort();
  }, [fullName, commit, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  return { state, retry };
}

function collectDirPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "dir") {
      out.push(n.path);
      if (n.children) collectDirPaths(n.children, out);
    }
  }
  return out;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
      {children}
    </span>
  );
}
