# Players and local co-op

Written 2026-11-08 for two Retroid Pocket 6 handhelds on one home wifi. Code: `crates/nova-runtime/src/players.rs`
(seats, per-player actions, glyphs, saved controls), `net.rs` (the wifi connection), `game/players_api.rs` (the Lua
side), `android_input.rs` (JNI: controllers, vibration, multicast lock, device name), `input.rs` (one pad per device).
Example: `examples/coop-test`. Tests: unit tests in those files and `tests/coop.rs`.

## Players on one device

Every connected controller is a player. A pad gets a **seat** (player 1 to 4) the first time it is seen and keeps it
while it is connected. When it goes away its seat is kept for it; when the same pad comes back (the same device, or on
desktop one with the same name) it sits down in it again. A new pad takes the lowest empty seat; only when every seat is
taken or kept does it take over a kept one. Player 1 is always this device's own: the keyboard, the mouse, touch, and
input that comes from no particular controller (`adb shell input keyevent`) belong to player 1.

On Android each controller is told apart by its input device id (a small patch to `vendor/winit`, see its
`NOVA-PATCH.md`) and known by its descriptor, which stays the same across reconnects; the list of controllers is asked
for once a second (`InputDevice.getDeviceIds`), which is how a controller that is switched off is noticed. On desktop
`gilrs` lists the pads.

Actions are read for anyone or for one player:

```lua
nova.input.down("jump")        -- anyone: every pad and every key (what a one-player game wants; unchanged)
nova.input.down("jump", 2)     -- player 2: `pad:south` in the binding means player 2's pad; keys are player 1's
local p = nova.input.player(2) -- the same, as an object: p.pressed("jump"), p.axis("move_x"), p.rumble(0.5, 0.2)
for _, e in ipairs(nova.input.player_events()) do ... end   -- { player, kind = "joined" | "left" | "back", name }
nova.input.players()           -- { { player, name, connected, remote, rumble }, ... }
```

**Rumble**: `nova.input.rumble(strength, seconds, player)` (or the table form with `player`). Desktop: gilrs force
feedback (Linux and Windows pads that have it; macOS has none). Android: the controller's own vibrator if it has one;
a controller that is part of the handheld (`InputDevice.isExternal()` is false, as the Retroid's built-in controls are)
shakes the handheld through the system vibrator (the `VIBRATE` permission, which every Nova APK now has). A player on
another device feels it too: the host sends it on.

**Remapping**: `nova.input.bind(action, sources, player)` changes an action for one player only (that binding reads the
player's own keys too); without a player it changes it for everyone, as before. `nova.input.save_controls()` keeps what
differs from the game's own bindings (`controls.bin` beside `save.json`) and it is read back when the game starts; a
saved action the game no longer has is skipped with a warning. `nova.input.reset_bindings(player)` undoes one player's,
`reset_bindings()` everything. `nova.input.next_source()` now also says which player pressed (`source, player`), so a
"press a button" screen can listen to one player.

**Glyphs**: `nova.input.glyph("pad:south")` is `"B", "button_b"` and `nova.input.prompt("jump", player)` gives the label,
icon and source to show for an action. Labels are by position on a Nintendo-style pad, as the Retroid prints them:
south B, east A, north X, west Y, L/R, ZL/ZR, + and −. The icon names are Kenney's Input Prompts (Nintendo Switch set)
without the `switch_` prefix. Note that the built-in `a` action is `pad:south`, which a Nintendo-style pad labels B; a
game that wants "A to confirm" binds its own action to `pad:east` (Coop Test does).

## Two devices on one wifi

```lua
nova.net.host({ players = 2 })        -- other devices on this wifi can find the game and join
local games = nova.net.find()         -- call every frame on a "Join" screen: { { id, name, players, max, full } }
nova.net.join(games[1].id)            -- "Join Jasper's Retroid"
local role, words = nova.net.status() -- "hosting" / "finding" / "joining" / "joined" / "lost", and a sentence to show
nova.net.state(t)                     -- host: what the others draw, sent every frame
local t, age = nova.net.state()       -- joined device: the newest state and how old it is
nova.net.send("chat", { text = "hi" }, 2) ; nova.net.receive()   -- messages that arrive, in order
nova.net.players() ; nova.net.events() ; nova.net.me() ; nova.net.leave()
```

A game must say `"local_network": true` in `nova.json`; without it `nova.net` refuses with that sentence, and an
Android build asks for no network access at all. With it the APK gets `INTERNET` and `CHANGE_WIFI_MULTICAST_STATE`
(both granted at install, no prompt).

### The model: the host runs the game

The host runs the whole game; a joined device sends its player's actions and draws what the host sends back. On the
host, a joined player is just another player (`nova.input.down("jump", 2)`), seated from seat 2 up like a pad, so the
same code plays two pads on one device or two devices.

Why this and not deterministic input sharing with rollback:

- **Nothing else has to be the same on both devices.** Rollback needs both devices to compute exactly the same game from
  the same inputs, every frame, and to save and restore the whole game state to re-run frames. Nova games are Lua with
  floats, `math.random`, tables iterated with `pairs` (whose order is not fixed), real time and the engine's own worker
  threads; making all of that bit-identical across devices (and a Mac) and snapshotting a Lua state 60 times a second
  is a large project, and every game would be one forgotten `pairs` away from drifting apart. Host-runs-it cannot drift.
- **Home wifi is fast enough.** Two handhelds on one access point see round trips of a few milliseconds up to some tens
  (more on a busy 2.4 GHz network). The joined player's input reaches the host about half a round trip later and the
  picture comes back after another half, so the joined player sees their own moves about one round trip late: a frame
  or two at home, which suits small action games (racing around an arena, co-op platforming, a kitchen game) though
  not a fighting game.
- **Beginners write one game.** The host's script is the game; the joined device's script draws a table. There is no
  "predict, then correct" for a beginner to get wrong. A game that wants its own player to react at once can still
  move it locally and take the host's word when it arrives.

The cost: the joined player feels the round trip, and the host sends the state every frame (keep it to what is drawn:
Coop Test's is about 300 bytes; the limit is 32 KB a packet).

### On the wire

Everything is UDP on port 47809 through the standard library (no new crates). Each packet is `NOVN`, a version byte and
a small JSON body, readable in a packet capture.

- **Finding.** A device looking for games sends `find` (with the game's id, from its name) to the broadcast address
  `255.255.255.255`, to the /24 broadcast of its own address (home wifi almost always is a /24) and to `127.0.0.1` (two
  copies on one computer), twice a second. A host of the same game answers with its name, its player count and its own
  id (a host that answers from two addresses is listed once). Android drops broadcast packets unless the app holds a
  **wifi multicast lock**; the runtime takes it while hosting or looking and lets go after. If the router blocks
  broadcast ("client isolation"), `nova.net.join("192.168.1.20")` with the host's `nova.net.address()` works.
- **Joining.** `hello` (game id, a random id for this run, the device's name) until `welcome` (the player number) or
  `refused` ("Jasper's Retroid's game is full", "That is a different game"); after five seconds without an answer, the
  join is "lost" with "Jasper's Retroid did not answer".
- **Playing.** The joined device sends `input` every frame: the value of each of its actions that is not zero, and how
  many times each action has gone down and come up since it started. A count that went up is a press on the host even
  if the packet in which the button was held was lost, so a quick tap is never dropped. The newest `input` wins (by
  sequence number). The host sends `state` every frame, newest wins. Pings twice a second measure the round trip
  (`nova.net.players()` gives `ping`).
- **Reliable messages** (`nova.net.send`, the roster, rumble) are numbered, resent every 150 ms until acknowledged, and
  handed to the game in order, once.
- **Dropping.** A device not heard from for three seconds is gone: the host's player "left" event fires, the player's
  actions are let go and its seat is kept; if the same run joins again it gets the same seat ("back"). A joined device
  that loses the host shows "Lost the connection to Jasper's Retroid"; one whose host left shows "Jasper's Retroid
  stopped the game".

Names: a device calls itself what its owner named it (Android `Settings.Global` `device_name`, else the model; macOS the
computer name), or what the game passes (`nova.net.host{ name = "Jasper" }`).

## Checked, and not

- Unit tests: seats (keeping, reclaiming by device and by name, filling empty seats first, remote seats from 2), each
  player's actions (own pad, keys for player 1, per-player bindings), remote values and counted taps, glyphs and
  prompts, saved controls, packets, and over real loopback UDP: find, join, input as player 2, state, messages in
  order both ways, roster, "full", a silent player dropped after three seconds and coming back to the same seat, a
  join with no host, the host stopping.
- `tests/coop.rs`: two copies of `examples/coop-test` in one process over loopback (host, find, join, the joined
  player's arrow key moving player 2 on the host and in the joined device's picture, the host leaving); two pads on
  one device moving their own players; a dash button chosen for player 2 saved to disk.
- Two desktop copies on this Mac (separate processes; see TODO.md for the run).
- **Not yet:** two real devices over real wifi (Arya's Retroid is not here), the multicast lock and broadcast on the
  Retroid's wifi, the JNI controller listing and vibration on the device (compiled, see TODO.md for what was run), a
  second controller on Android, latency numbers on wifi, and more than one player on a joined device (a joined device
  sends one player: its own, all its pads together).
