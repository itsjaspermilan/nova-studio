# Physics Toybox

Rigid bodies in Nova (`nova.physics`, Rapier inside), controller only.

- **Knock it down** (`scenes/stack.scene.json`, 2D): a cannon (d-pad or stick up and down to aim, A to fire), a wall of 21
  crates, a tower of six on a ledge, a seesaw on a hinge with a crate on it, and a chain of seven links. Y drops a crate from the sky.
- **The yard** (`scenes/pile.scene.json`, 3D): a wall of 33 crates and a heap of 10, four barrels lying on a ramp (their
  shape is the hull round the model, so they roll), a door on a hinge, and a walker (a `character` body) that shoves what it
  walks into. Left stick walks, right stick turns the camera, A throws a ball, Y drops a crate in front.

X puts everything back, L or R goes to the other scene. F9 lets the computer play both scenes in turn (for timing on a device);
every five seconds, and on F3, the log gets a `toybox:` line with the number of bodies and the physics step's average and worst cost.

Everything placed is a scene object with its body in its class or its props: the levels are data, not code.

Art: Kenney's Platformer Kit pictures and button prompts, the crate and the character (Sky Garden) and the barrel (Potion Panic),
and the knock sound; all CC0 (see `licenses/kenney-*.txt`). The ball is a Nova model (`models/ball.model.json`).
