// The asset browser's data: the project's resources as cards you can search, filter by kind, open and drag into code or a scene.
import type { Resource, ResourceGroup, ResourceKind } from "./resources";

export interface AssetCard {
  kind: ResourceKind;
  name: string;
  /// The file a click opens.
  path: string;
  files: string[];
  /// The group it lives in ("Sprites", "3D Models"...).
  group: string;
}

/// Every resource of the groups as a card, in the groups' order.
export function assetCards(groups: ResourceGroup[]): AssetCard[] {
  return groups.flatMap((g) => g.items.map((r: Resource) => ({ kind: r.kind, name: r.name, path: r.path, files: r.files, group: g.title })));
}

/// The cards that match a search (every word in the name or the group) and, when given, a kind.
export function filterCards(cards: AssetCard[], query: string, kind: ResourceKind | "all" = "all"): AssetCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((c) => (kind === "all" || c.kind === kind) && words.every((w) => `${c.name} ${c.group}`.toLowerCase().includes(w)));
}

/// The kinds that appear among the cards, for the filter.
export function kindsOf(cards: AssetCard[]): ResourceKind[] {
  return [...new Set(cards.map((c) => c.kind))];
}

/// What dragging a card into a code editor drops: the asset's short name in quotes, which is how the game's Lua names an asset
/// (`nova.sprite("player")`; `docs/project-format.md`, short asset names).
export function dropText(card: AssetCard): string {
  const leaf = card.name.slice(card.name.lastIndexOf("/") + 1);
  return JSON.stringify(leaf);
}

/// The icon (lib/icons.ts) a card shows when it has no picture of its own.
export function iconFor(kind: ResourceKind): string {
  switch (kind) {
    case "sprite":
    case "tileset":
    case "image":
      return "sprites";
    case "model":
      return "cube";
    case "sound":
    case "song":
      return "sound";
    case "script":
    case "entity":
    case "scene":
      return "engine";
    case "project":
      return "settings";
    default:
      return "file";
  }
}
