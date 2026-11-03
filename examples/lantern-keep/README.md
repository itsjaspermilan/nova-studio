# Lantern Keep

A small top-down dungeon game for Nova: three rooms, a key in each, a locked door at the east wall, slimes that creep and
bats that fly, a sword, hearts, a best time. Everything is plain files: Lua in `entities/`, `scenes/` and `lib/`, room
layouts in `scenes/room*.scene.json` (a tilemap and the objects in it), pixel sprites and tiles in `sprites/`, sounds and
a song made in the sound and music editors' format.

```sh
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- run examples/lantern-keep
```

| Keys | |
| --- | --- |
| Arrows or WASD, left stick | walk |
| Z or Space, gamepad west or south | sword |
| F9 | the computer plays (for tests and demos); it stays on from room to room |

## How it was made

`scripts/lantern/build.mjs` draws the sprites and tiles, makes the sounds and the song and lays out the rooms, by calling the
Nova MCP server's tools (`sprite_write`, `sfx_write`, `song_write`, `scene_write`), so the files are the ones the studio's
editors write and can open again. The game's code is hand-written.

What it uses of the engine: tilemaps with solid tiles (`slide`, `map:set` to open the door), sprite sheets with animation tags,
tags and `on_collide_<tag>`, `nova.nearest`, particles (`nova.burst`), scene inheritance (`nova.scene(base, { index = 2 })`),
saved best time (`nova.save`), music and sound effects, and the default input actions plus two of its own (`nova.json`).

`crates/nova-runtime/tests/lantern.rs` plays the game from the title screen with the autopilot and checks that it can be won.
Not tried: a person playing it, on a phone or a handheld; the difficulty is a guess.
