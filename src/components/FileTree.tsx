"use client";

import { useEffect, useRef } from "react";
import type { FileNode } from "@/lib/file-tree";
import { ChevronIcon, FileIcon, FolderIcon, SubmoduleIcon } from "./icons";

interface FileTreeProps {
  nodes: FileNode[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function FileTree({
  nodes,
  expanded,
  selectedPath,
  onToggleDir,
  onSelectFile,
  onExpandAll,
  onCollapseAll,
}: FileTreeProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the selected file visible, e.g. after navigating from the side panel.
  useEffect(() => {
    if (!selectedPath) return;
    const el = listRef.current?.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedPath, expanded]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 border-b border-slate-200 px-3 py-2 text-xs">
        <span className="pl-1 text-slate-500">Select a file to see its imports</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onExpandAll}
            className="rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            className="rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Collapse all
          </button>
        </div>
      </div>
      <ul
        ref={listRef}
        role="tree"
        aria-label="Repository files"
        className="max-h-[36rem] min-h-[16rem] overflow-auto py-2 font-mono text-[13px]"
      >
        {nodes.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggleDir={onToggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </ul>
    </div>
  );
}

interface TreeRowProps {
  node: FileNode;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function TreeRow({ node, depth, expanded, selectedPath, onToggleDir, onSelectFile }: TreeRowProps) {
  const indent = { paddingLeft: `${depth * 1.125 + 0.75}rem` };

  if (node.type === "dir") {
    const isOpen = expanded.has(node.path);
    return (
      <li role="treeitem" aria-expanded={isOpen} aria-selected={false}>
        <button
          type="button"
          onClick={() => onToggleDir(node.path)}
          style={indent}
          className="flex w-full items-center gap-1.5 py-[3px] pr-3 text-left text-slate-800 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none"
        >
          <ChevronIcon className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} width={14} height={14} />
          <FolderIcon open={isOpen} className="shrink-0 text-sky-600" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children && node.children.length > 0 && (
          <ul role="group">
            {node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const selected = node.path === selectedPath;
  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        data-path={node.path}
        onClick={() => onSelectFile(node.path)}
        style={indent}
        className={`flex w-full items-center gap-1.5 py-[3px] pr-3 text-left focus-visible:outline-none ${
          selected
            ? "bg-indigo-50 text-indigo-900 shadow-[inset_2px_0_0] shadow-indigo-500"
            : "text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-100"
        }`}
      >
        <span className="w-[14px] shrink-0" />
        {node.type === "submodule" ? (
          <SubmoduleIcon className="shrink-0 text-violet-500" />
        ) : (
          <FileIcon className={`shrink-0 ${selected ? "text-indigo-500" : "text-slate-400"}`} />
        )}
        <span className="truncate">{node.name}</span>
        {node.type === "submodule" && <span className="ml-1 text-[11px] text-slate-400">submodule</span>}
        {node.size !== undefined && (
          <span className="ml-auto shrink-0 pl-4 text-[11px] tabular-nums text-slate-400">{formatBytes(node.size)}</span>
        )}
      </button>
    </li>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
