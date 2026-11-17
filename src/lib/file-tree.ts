import type { TreeEntry, TreeEntryType } from "./github/types";

export interface FileNode {
  name: string;
  path: string;
  type: TreeEntryType;
  size?: number;
  /** Present on directories, sorted: directories first, then alphabetical. */
  children?: FileNode[];
}

export interface FileTreeStats {
  files: number;
  dirs: number;
}

/** Convert GitHub's flat path list into a nested, sorted tree. */
export function buildFileTree(entries: TreeEntry[]): { root: FileNode[]; stats: FileTreeStats } {
  const root: FileNode = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map<string, FileNode>([["", root]]);
  const stats: FileTreeStats = { files: 0, dirs: 0 };

  const ensureDir = (path: string): FileNode => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : path.slice(0, slash));
    const node: FileNode = { name: path.slice(slash + 1), path, type: "dir", children: [] };
    parent.children!.push(node);
    dirs.set(path, node);
    stats.dirs++;
    return node;
  };

  for (const entry of entries) {
    if (entry.type === "dir") {
      ensureDir(entry.path);
      continue;
    }
    const slash = entry.path.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : entry.path.slice(0, slash));
    parent.children!.push({
      name: entry.path.slice(slash + 1),
      path: entry.path,
      type: entry.type,
      size: entry.size,
    });
    if (entry.type === "file") stats.files++;
  }

  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      const ad = a.type === "dir" ? 0 : 1;
      const bd = b.type === "dir" ? 0 : 1;
      return ad - bd || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root.children!);

  return { root: root.children!, stats };
}
