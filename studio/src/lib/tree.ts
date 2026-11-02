import type { FileEntry } from "./types";

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  children: TreeNode[];
}

/// Builds the nested tree from the backend's flat, sorted list. Folders come before files at each
/// level, both in name order, and a file whose parent folder is missing from the list still appears.
export function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, size: 0, children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);

  const folder = (path: string): TreeNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = folder(slash < 0 ? "" : path.slice(0, slash));
    const node: TreeNode = { name: path.slice(slash + 1), path, dir: true, size: 0, children: [] };
    parent.children.push(node);
    folders.set(path, node);
    return node;
  };

  for (const entry of entries) {
    if (entry.dir) {
      folder(entry.path);
      continue;
    }
    const slash = entry.path.lastIndexOf("/");
    const parent = folder(slash < 0 ? "" : entry.path.slice(0, slash));
    parent.children.push({ name: entry.path.slice(slash + 1), path: entry.path, dir: false, size: entry.size, children: [] });
  }

  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

export type FileKind = "lua" | "scene" | "sheet" | "manifest" | "json" | "image" | "model" | "sound" | "font" | "other";

export function fileKind(path: string): FileKind {
  const lower = path.toLowerCase();
  if (lower === "nova.json") return "manifest";
  if (lower.endsWith(".scene.json")) return "scene";
  if (lower.endsWith(".sprite.json")) return "sheet";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "lua": return "lua";
    case "json": return "json";
    case "png": return "image";
    case "glb": return "model";
    case "wav": case "ogg": return "sound";
    case "ttf": case "otf": return "font";
    default: return "other";
  }
}

/// Flattens the open folders so the tree can be drawn as a simple list with depth.
export function visibleRows(nodes: TreeNode[], open: Set<string>, depth = 0): { node: TreeNode; depth: number }[] {
  const rows: { node: TreeNode; depth: number }[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.dir && open.has(node.path)) rows.push(...visibleRows(node.children, open, depth + 1));
  }
  return rows;
}
