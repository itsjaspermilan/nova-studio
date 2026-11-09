// A counter that goes up whenever a command is added or removed, so a Svelte effect or $derived that lists the commands runs again.
import { untrack } from "svelte";
import { commands } from "./commands";

export const commandsRev = $state({ n: 0 });
commands.onChange(() => {
  // (untracked: a command is often added from inside an effect, and adding to the counter reads it, which would make that effect depend on
  // what it changes and run for ever)
  untrack(() => {
    commandsRev.n += 1;
  });
});
