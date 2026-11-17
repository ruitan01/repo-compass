"use client";

import { useState } from "react";
import type { FileNode } from "@/lib/file-tree";
import { ChevronIcon, FileIcon, FolderIcon, SubmoduleIcon } from "./icons";

interface FileTreeProps {
  nodes: FileNode[];
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

export function FileTree({ nodes }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div>
      <div className="flex items-center justify-end gap-1 border-b border-slate-200 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setExpanded(new Set(collectDirPaths(nodes)))}
          className="rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setExpanded(new Set())}
          className="rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          Collapse all
        </button>
      </div>
      <ul role="tree" aria-label="Repository files" className="max-h-[32rem] overflow-auto py-2 font-mono text-[13px]">
        {nodes.map((node) => (
          <TreeRow key={node.path} node={node} depth={0} expanded={expanded} onToggle={toggle} />
        ))}
      </ul>
    </div>
  );
}

interface TreeRowProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function TreeRow({ node, depth, expanded, onToggle }: TreeRowProps) {
  const indent = { paddingLeft: `${depth * 1.125 + 0.75}rem` };

  if (node.type === "dir") {
    const isOpen = expanded.has(node.path);
    return (
      <li role="treeitem" aria-expanded={isOpen} aria-selected={false}>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
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
              <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li role="treeitem" aria-selected={false}>
      <div style={indent} className="flex items-center gap-1.5 py-[3px] pr-3 text-slate-700 hover:bg-slate-50">
        <span className="w-[14px] shrink-0" />
        {node.type === "submodule" ? (
          <SubmoduleIcon className="shrink-0 text-violet-500" />
        ) : (
          <FileIcon className="shrink-0 text-slate-400" />
        )}
        <span className="truncate">{node.name}</span>
        {node.type === "submodule" && <span className="ml-1 text-[11px] text-slate-400">submodule</span>}
        {node.size !== undefined && (
          <span className="ml-auto shrink-0 pl-4 text-[11px] tabular-nums text-slate-400">{formatBytes(node.size)}</span>
        )}
      </div>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
