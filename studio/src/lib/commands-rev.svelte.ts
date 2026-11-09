// A counter that goes up whenever a command is added or removed, so a Svelte effect or $derived that lists the commands runs again.
import { commands } from "./commands";

export const commandsRev = $state({ n: 0 });
commands.onChange(() => {
  commandsRev.n++;
});
