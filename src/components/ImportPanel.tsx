"use client";

import { useMemo, type ReactNode } from "react";
import { isAnalyzableSource } from "@/lib/analysis/sources";
import type { ImportAnalysis, ImportRef } from "@/lib/analysis/types";
import type { GitHubErrorCode } from "@/lib/github/types";
import { formatBytes } from "./FileTree";
import { AlertIcon, ArrowLeftIcon, ExternalIcon, FileIcon, SpinnerIcon } from "./icons";

export type AnalysisState =
  | { status: "loading" }
  | { status: "ready"; data: ImportAnalysis }
  | { status: "error"; code: GitHubErrorCode; message: string }
  /** Empty repository: nothing to analyze. */
  | { status: "none" };

interface ImportPanelProps {
  analysis: AnalysisState;
  selectedPath: string | null;
  /** Base URL for linking to files, e.g. https://github.com/o/r/blob/<sha> */
  blobBase: string;
  canGoBack: boolean;
  onBack: () => void;
  onNavigate: (path: string) => void;
  onRetry: () => void;
}

export function ImportPanel(props: ImportPanelProps) {
  const { analysis, selectedPath } = props;

  return (
    <aside aria-label="Imports" className="flex min-h-0 flex-col border-t border-slate-200 bg-slate-50/60 lg:border-l lg:border-t-0">
      <div className="max-h-[38.5rem] min-h-[16rem] overflow-auto">
        {analysis.status === "error" ? (
          <PanelMessage tone="error" title="Import analysis failed" onRetry={props.onRetry}>
            {analysis.message}
          </PanelMessage>
        ) : selectedPath ? (
          <FileDetails {...props} path={selectedPath} />
        ) : (
          <Overview analysis={analysis} onNavigate={props.onNavigate} />
        )}
      </div>
    </aside>
  );
}

function Overview({ analysis, onNavigate }: { analysis: AnalysisState; onNavigate: (path: string) => void }) {
  const mostImported = useMemo(() => {
    if (analysis.status !== "ready") return [];
    return Object.entries(analysis.data.importedBy)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 6);
  }, [analysis]);

  if (analysis.status === "loading") {
    return (
      <div className="flex items-center gap-2.5 px-5 py-5 text-sm text-slate-600">
        <SpinnerIcon className="text-slate-500" /> Analyzing TypeScript imports…
      </div>
    );
  }
  if (analysis.status === "none") {
    return <PanelMessage title="Nothing to analyze">This repository has no files yet.</PanelMessage>;
  }
  if (analysis.status !== "ready") return null;

  const { data } = analysis;
  if (data.status === "unsupported") {
    return <PanelMessage title="Import analysis unavailable">{data.message}</PanelMessage>;
  }

  const s = data.stats;
  return (
    <div className="space-y-5 px-5 py-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Import analysis</h2>
        <p className="mt-1 text-sm text-slate-600">Select a file in the tree to see what it imports and what imports it.</p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Files analyzed" value={`${s.analyzedFiles.toLocaleString()} / ${s.sourceFiles.toLocaleString()}`} />
        <Stat label="Internal imports" value={s.internalEdges.toLocaleString()} />
      </dl>
      <Notes data={data} />
      {mostImported.length > 0 && (
        <Section title="Most imported files">
          {mostImported.map(([path, importers]) => (
            <FileLink key={path} path={path} onNavigate={onNavigate} meta={`${importers.length}`} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Notes({ data }: { data: ImportAnalysis }) {
  const s = data.stats;
  const notes: string[] = [];
  if (s.overLimit > 0) {
    notes.push(
      `${s.overLimit.toLocaleString()} files weren't analyzed because of the ${data.limits.maxFiles.toLocaleString()}-file limit. Root src/ and lib/ folders are analyzed first, tests and examples last.`,
    );
  }
  const tooLarge = Object.values(data.skipped).filter((r) => r === "too_large").length;
  if (tooLarge > 0) notes.push(`${tooLarge} files larger than ${formatBytes(data.limits.maxFileBytes)} were skipped.`);
  const failed = Object.values(data.skipped).filter((r) => r === "fetch_failed").length;
  if (failed > 0) notes.push(`${failed} files couldn't be downloaded from GitHub.`);
  if (data.treeTruncated) notes.push("GitHub truncated this repository's file tree, so some imports may not resolve.");
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function FileDetails({
  analysis,
  path,
  blobBase,
  canGoBack,
  onBack,
  onNavigate,
}: ImportPanelProps & { path: string }) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? "" : path.slice(0, slash);

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-5 py-3.5 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200/60 disabled:invisible"
          >
            <ArrowLeftIcon width={13} height={13} /> Back
          </button>
          <a
            href={`${blobBase}/${encodePath(path)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
          >
            View on GitHub <ExternalIcon width={12} height={12} />
          </a>
        </div>
        <h2 className="mt-1.5 break-all font-mono text-sm font-semibold text-slate-900">{name}</h2>
        {dir && <p className="break-all font-mono text-xs text-slate-500">{dir}/</p>}
      </header>

      <div className="space-y-5 px-5 py-4">
        {analysis.status === "loading" && (
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <SpinnerIcon className="text-slate-500" /> Analyzing TypeScript imports…
          </div>
        )}
        {analysis.status === "ready" && (
          <AnalyzedFile data={analysis.data} path={path} blobBase={blobBase} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

function AnalyzedFile({
  data,
  path,
  blobBase,
  onNavigate,
}: {
  data: ImportAnalysis;
  path: string;
  blobBase: string;
  onNavigate: (path: string) => void;
}) {
  if (data.status === "unsupported") {
    return <p className="text-sm text-slate-600">{data.message}</p>;
  }

  const refs = data.imports[path];
  const importers = data.importedBy[path] ?? [];
  const lineUrl = (line: number) => `${blobBase}/${encodePath(path)}#L${line}`;

  return (
    <>
      {refs ? (
        <ImportsList refs={refs} lineUrl={lineUrl} onNavigate={onNavigate} />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
          {notAnalyzedReason(data, path)}
        </p>
      )}

      <Section title="Imported by" count={importers.length}>
        {importers.length === 0 ? (
          <Empty>
            {data.stats.overLimit > 0
              ? "No analyzed file imports this file. Some files weren't analyzed, so there may be importers that aren't shown."
              : "No TypeScript file in this repository imports this file with a relative import."}
          </Empty>
        ) : (
          importers.map((p) => <FileLink key={p} path={p} onNavigate={onNavigate} />)
        )}
      </Section>
    </>
  );
}

function ImportsList({
  refs,
  lineUrl,
  onNavigate,
}: {
  refs: ImportRef[];
  lineUrl: (line: number) => string;
  onNavigate: (path: string) => void;
}) {
  const internal = refs.filter((r) => r.resolved);
  const unresolved = refs.filter((r) => !r.external && !r.resolved);
  const external = refs.filter((r) => r.external);

  return (
    <>
      <Section title="Imports" count={internal.length}>
        {internal.length === 0 ? (
          <Empty>This file doesn&apos;t import other files from this repository.</Empty>
        ) : (
          internal.map((r) => (
            <FileLink
              key={r.specifier}
              path={r.resolved!}
              title={r.specifier}
              onNavigate={onNavigate}
              badges={<Badges r={r} />}
              line={{ n: r.line, href: lineUrl(r.line) }}
            />
          ))
        )}
      </Section>

      {unresolved.length > 0 && (
        <Section title="Unresolved" count={unresolved.length}>
          <p className="px-2 pb-1 text-xs text-slate-500">Relative imports that don&apos;t match a file in the repository.</p>
          {unresolved.map((r) => (
            <div key={r.specifier} className="flex items-center gap-2 px-2 py-1 font-mono text-xs text-slate-700">
              <span className="truncate">{r.specifier}</span>
              <LineLink n={r.line} href={lineUrl(r.line)} />
            </div>
          ))}
        </Section>
      )}

      {external.length > 0 && (
        <Section title="Packages & aliases" count={external.length}>
          <div className="flex flex-wrap gap-1.5 px-2 pt-0.5">
            {external.map((r) => (
              <a
                key={r.specifier}
                href={lineUrl(r.line)}
                target="_blank"
                rel="noreferrer"
                title={`Line ${r.line}`}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:border-slate-300"
              >
                {r.specifier}
                {r.typeOnly && <span className="ml-1 text-slate-400">type</span>}
              </a>
            ))}
          </div>
          <p className="px-2 pt-2 text-xs text-slate-500">Non-relative imports aren&apos;t resolved yet, including tsconfig path aliases.</p>
        </Section>
      )}
    </>
  );
}

function notAnalyzedReason(data: ImportAnalysis, path: string): string {
  const reason = data.skipped[path];
  if (reason === "too_large") return `Not analyzed: this file is larger than the ${formatBytes(data.limits.maxFileBytes)} limit.`;
  if (reason === "fetch_failed") return "Not analyzed: the file couldn't be downloaded from GitHub.";
  if (isAnalyzableSource(path)) {
    return `Not analyzed: this repository has more TypeScript files than the ${data.limits.maxFiles.toLocaleString()}-file analysis limit.`;
  }
  return "Imports are only extracted from TypeScript source files (.ts, .tsx, .mts, .cts). Other files can still be imported by them.";
}

function Badges({ r }: { r: ImportRef }) {
  return (
    <>
      {r.typeOnly && <Badge>type</Badge>}
      {r.reexport && <Badge>re-export</Badge>}
    </>
  );
}

function FileLink({
  path,
  title,
  meta,
  badges,
  line,
  onNavigate,
}: {
  path: string;
  title?: string;
  meta?: string;
  badges?: ReactNode;
  line?: { n: number; href: string };
  onNavigate: (path: string) => void;
}) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? "" : path.slice(0, slash);
  return (
    <div className="group flex items-center gap-1 rounded-md hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-slate-200">
      <button
        type="button"
        onClick={() => onNavigate(path)}
        title={title ? `${title} → ${path}` : path}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-md"
      >
        <FileIcon className="shrink-0 text-slate-400 group-hover:text-indigo-500" width={14} height={14} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] text-slate-800 group-hover:text-indigo-700">{name}</span>
          {dir && <span className="block truncate font-mono text-[11px] text-slate-400">{dir}</span>}
        </span>
        {badges}
        {meta && <span className="shrink-0 text-xs tabular-nums text-slate-500">{meta}</span>}
      </button>
      {line && <LineLink n={line.n} href={line.href} />}
    </div>
  );
}

function LineLink({ n, href }: { n: number; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open line ${n} on GitHub`}
      className="mr-1 shrink-0 rounded px-1 font-mono text-[11px] tabular-nums text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      L{n}
    </a>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-slate-200/80 px-1.5 py-px text-[11px] font-medium normal-case tracking-normal text-slate-600">
            {count}
          </span>
        )}
      </h3>
      <div className="-mx-2 space-y-0.5">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 text-[10px] font-medium text-slate-500">{children}</span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-sm text-slate-500">{children}</p>;
}

function PanelMessage({
  title,
  children,
  tone = "neutral",
  onRetry,
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "error";
  onRetry?: () => void;
}) {
  return (
    <div className="px-5 py-6">
      <div className="flex gap-2.5">
        <AlertIcon className={`mt-0.5 shrink-0 ${tone === "error" ? "text-red-600" : "text-slate-400"}`} width={16} height={16} />
        <div>
          <p className={`text-sm font-semibold ${tone === "error" ? "text-red-900" : "text-slate-900"}`}>{title}</p>
          <p className={`mt-1 text-sm ${tone === "error" ? "text-red-800" : "text-slate-600"}`}>{children}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
