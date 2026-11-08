-- Physics Toybox: rigid bodies in Nova (nova.physics, Rapier inside). Two scenes, both laid out in scene files:
--   scenes/stack.scene.json  a 2D wall of crates to knock down with a cannon, a seesaw and a chain
--   scenes/pile.scene.json   a 3D yard of crates and barrels to walk into, kick and throw balls at
-- A fires, Y drops a crate, X puts everything back, L or R goes to the other scene. F9 lets the computer play
-- (for timing it on a device); F3 logs the physics' cost.
nova.physics.settings { scale = 40 } -- a 40-pixel crate is a metre across
nova.start("stack")
