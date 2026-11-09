// The studio's four workspaces (docs/studio-workspaces.md): Model (3D), Sprites (2D), Sound, and Engine (code, scenes and the rest).
// Every file belongs to exactly one, which decides where its tab lives; a document is open in one place at a time.

export type WorkspaceId = "model" | "sprites" | "sound" | "engine";

export interface Workspace {
  id: WorkspaceId;
  title: string;
  /// What this workspace opens, in plain words, for its empty page.
  blurb: string;
}

export const WORKSPACES: Workspace[] = [
  { id: "model", title: "Model", blurb: "3D models and their animation" },
  { id: "sprites", title: "Sprites", blurb: "Pictures, sprite sheets and animations" },
  { id: "sound", title: "Sound", blurb: "Sound effects and music" },
  { id: "engine", title: "Engine", blurb: "Code, scenes, tracks and the game itself" },
];

export function workspaceOf(path: string): WorkspaceId {
  const p = path.toLowerCase();
  if (p.endsWith(".model.json") || p.endsWith(".glb") || p.endsWith(".gltf")) return "model";
  if (p.endsWith(".sprite.json") || p.endsWith(".png")) return "sprites";
  if (p.endsWith(".sfx.json") || p.endsWith(".song.json") || p.endsWith(".wav") || p.endsWith(".ogg")) return "sound";
  return "engine";
}

export function workspaceTitle(id: WorkspaceId): string {
  return WORKSPACES.find((w) => w.id === id)!.title;
}

/// Which of a list of paths belong to a workspace.
export function inWorkspace<T extends { path: string }>(items: T[], id: WorkspaceId): T[] {
  return items.filter((i) => workspaceOf(i.path) === id);
}
