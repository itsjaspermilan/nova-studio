// The one keymap the studio uses: read at start-up, applied to the command registry.
import { commands } from "./commands";
import { KeymapSettings } from "./keymap";

export const keymap = new KeymapSettings(commands);
