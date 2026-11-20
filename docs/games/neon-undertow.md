# Neon Undertow: design

A top-down action roguelike in a drowned cyberpunk city. Minish Cap's readable rooms and four-way sprites, Hades' fast fights
and card choices, built in Nova (`examples/neon-undertow`). Written 2026-11-20 as the hand-off from design to building: everything
here is decided unless marked OPEN. Numbers are starting values to tune by play.

## The idea in four lines

- The city of **Low Meridian** floods a little more each year. The rich moved up into the Spire; everyone else lives in the Undertow.
- You are a **runner**, a courier whose mind is backed up by a bootleg machine called **LULLABY**. When you die she prints you again.
- Each print costs her memory. She will not say what she is forgetting. The printer's paperwork says your debt is owned by the Spire.
- Climb four districts to the top, delete the contract, and find out who LULLABY was. Die, keep what you learned, go again.

Pillars: **fights you can read** (every attack is telegraphed, four-way sprites, big clear shapes); **a run is a build** (three
cards after every room, and they combine); **the city remembers** (what you bank, who you helped and what you unlocked stays).

## Controls (the letters as engraved on the Retroid Pocket 6: A south, B east, X west, Y north)

| Button | Does |
|---|---|
| Left stick | Move freely (eight directions and everything between); the sprite faces up, down, left or right |
| X (`pad:west`) | Attack: a three-hit chain with the baton; the third hit knocks back |
| A (`pad:south`) | Interact: talk, open, take a card, revive a partner |
| B (`pad:east`) | Dash roll: a short burst in the stick's direction, untouchable for most of it, 0.6 s between rolls |
| Y (`pad:north`) | Ranged: hold to aim (the stick aims, you walk at 35% speed, a thin sight line shows), release to fire |
| Start | Pause and the run's cards |

Keyboard twins for the desk: arrows or WASD, J attack, K dash, L ranged, E interact. Everything is played with the pad; no touch.

**The feel to hit:** attack comes out in 5 frames, each hit stops the game for 3 frames and shakes the screen 2 px; a roll covers
3.2 tiles in 0.28 s with no damage taken for the first 0.22 s; you can cancel the end of any attack into a roll, never a roll into
an attack. Ranged shots cost **charge** (3 pips); every baton hit gives a third of a pip back. That one rule makes the two attacks
feed each other: shoot to open, close in to reload.

## The shape of a run

Four districts, eight rooms each. Clear a district's eighth room (its boss) and that district becomes a **checkpoint**: a later run
may start from any checkpoint reached, with a smaller starting build (see Permanent upgrades). A full climb from the bottom is about
35 minutes; one district is 8 to 10.

| Room | What it is |
|---|---|
| 1 | Fight: the district's basic enemies, taught one kind at a time |
| 2 | Fight: two kinds together |
| 3 | Fight with a twist of the district (its hazard switched on) |
| 4 | **Elite**: one enemy with a random elite mark and its escort; pays a guaranteed uncommon card |
| 5 | Fight: a bigger room, waves from two doors |
| 6 | **A stranger's room**: no fight. One of the city's characters, a choice, a perk |
| 7 | Gauntlet: the hardest mix, the hazard on, a time bonus in scrap |
| 8 | **Boss** |

After every fight room: the doors lock open, the room pays **scrap** (the run's money), and three **cards** rise from the floor;
take one with A. Between districts: a short walk-through room with a shop (spend scrap: heal, reroll, remove a jinx) and the bank
(turn scrap into **keys**, the permanent money, at 4 to 1; unbanked scrap is lost on death).

Rooms are **scene files**, drawn by hand in the scene editor's format (painted tile maps plus placed objects). Each room slot of a
district has **three layouts**; a run picks one per slot from the run's seed, and picks the enemy waves from that slot's wave table.
That is 21 fight layouts, 1 stranger room and 1 boss arena per district. Rooms are bigger than the screen: 30x18 to 44x26 tiles at
16 px tiles drawn 3x (a screen is 20x11 tiles), so the camera follows and there is always somewhere to roll to.

## The player

- 6 hearts' worth of health counted in half hearts (12 points). Enemy hits do 1 to 3 points.
- Baton chain: 2, 2, 4 damage. Ranged shot: 3 damage, pierces nothing, 3 pips of charge.
- After a hit you blink and cannot be hurt for 0.8 s.
- At zero: the screen tears, LULLABY says one line, and you wake in the Den with your keys and what you banked.

## Cards (a run's upgrades)

Three are offered after each fight room, never two from the same family twice running. Rarity: common (white), uncommon (cyan),
rare (magenta). A card may be taken up to three times unless it says once. Tags in brackets make sets: holding three cards of one
tag switches on that tag's **set bonus**.

**Baton**
1. *Live Wire* [Volt]: the third hit chains lightning to 2 enemies within 3 tiles for 2 damage.
2. *Long Reach*: the baton's arc is 30% wider and longer.
3. *Metronome*: each hit in a chain that lands within 0.25 s of the last does +1 damage.
4. *Riot Stock* : the third hit also stuns for 0.6 s; knock-back doubled.
5. *Hot Solder* [Burn]: hits set enemies alight: 1 damage a second for 3 s.
6. *Skim* [Leak]: the first hit on a full-health enemy makes it leak: it drops 1 scrap for each hit it takes.
7. *Backhand* (rare, once): attacking straight after a roll swings behind you too, for double damage.

**Sidearm**
8. *Ricochet*: shots bounce once off walls.
9. *Overpressure*: a shot held at full aim for 0.7 s is a slug: 7 damage, pierces, costs 2 pips.
10. *Tracer* [Volt]: an enemy you shot takes +50% baton damage for 3 s.
11. *Scatter*: fire 3 pellets in a fan, 2 damage each.
12. *Incendiary* [Burn]: shots leave a burning patch for 2 s.
13. *Siphon* [Leak]: a kill with a shot refunds its pip.
14. *Smart Round* (rare, once): shots curve towards the enemy nearest your sight line.

**Roll**
15. *Afterimage* [Echo]: your roll leaves a copy that enemies attack for 1.5 s.
16. *Shock Wake* [Volt]: rolling through an enemy zaps it for 2 and you pass through it.
17. *Second Wind*: 2 rolls before the wait.
18. *Slipstream*: after a roll, move 30% faster for 1.5 s.
19. *Burn Rubber* [Burn]: a roll leaves a 1 s trail of fire.
20. *Phase* (rare, once): a perfect roll (through an attack in its last 0.1 s) slows time for 1 s.

**Body**
21. *Plating*: +2 health points, healed.
22. *Clot*: heal 1 point every room cleared without being hit.
23. *Adrenal*: below half health, +25% damage and speed.
24. *Deep Pockets* [Leak]: +25% scrap.
25. *Capacitor*: +1 charge pip.
26. *Ghost in the Shell* [Echo] (rare, once): once a run, a killing blow leaves you on 1 point with 2 s untouchable.

**District hacks** (they change the enemies and the place for the rest of the run)
27. *Friendly Fire*: enemy shots hurt other enemies.
28. *Brownout* [Volt]: every 20 s the lights dip and all enemies are stunned 1 s.
29. *Bad Wiring* [Burn]: barrels and neon signs explode twice as wide; you take no damage from them.
30. *Bounty Board* [Leak]: one enemy in each room is marked; kill it first for 15 scrap.
31. *Loop Trap* [Echo]: the first enemy to die in each room rises as your ally for 8 s.
32. *Open Channel* (rare, once): elites lose their escort; bosses start at 85% health.

**Jinxes** (a card slot may show a jinx: a rare card with a cost; the shop can remove one)
33. *Overclock*: +40% damage dealt, +1 damage taken.
34. *Red Line*: charge refills by itself, but your maximum health is 8.
35. *Crowd Pleaser*: +1 card choice from now on, +25% enemies.
36. *Debt Spiral*: double keys banked this run; lose 1 point at each room's start.

**Set bonuses** (three of a tag): Volt: lightning arcs twice. Burn: burning enemies explode on death for 3 in 2 tiles.
Leak: scrap pickups heal 1 point per 20. Echo: your afterimage and risen allies copy your baton hits.

## Permanent upgrades (the Den)

The Den is the hub: a flooded server room with LULLABY's cracked screen, the print bed you wake on, and stalls that fill up as you
meet people. Keys buy, at the **Workbench**:

| Upgrade | Tiers | Each tier |
|---|---|---|
| Thicker Print | 3 | +1 health point |
| Warm Start | 3 | start a run with a common, then an uncommon, then a chosen card |
| Good Solder | 3 | +5% baton damage |
| Bigger Magazine | 2 | +1 charge pip |
| Loose Change | 3 | keep 10% of unbanked scrap as keys |
| Familiar Streets | 3 | reroll the cards once per district |
| Fast Print | 1 | the checkpoint start gives 2 cards instead of 1 for each district skipped |
| LULLABY's Eye | 2 | see the next room's kind; then the elite's mark too |
| Deeper Deck | 4 | each tier unlocks six more cards into the pool (a new player sees 12) |
| Second Chance | 1 | one revive per run in the Den's colours |

Starting from a checkpoint gives 1 random card per district skipped and that district's bank already used: faster, weaker. That
keeps the long climb worth doing.

## Districts, enemies, bosses

Every enemy has one job and one tell (a flash, a sound, a ground marker 0.4 s or more before it hurts). Elites are a normal enemy
at double size and health with one **mark**: *Shielded* (front blocks shots), *Splitting* (two small ones on death), *Magnetic*
(pulls your shots and you), *Volatile* (explodes 1 s after death), *Linked* (heals while its partner lives).

### 1. The Gutter Market (street level; rain, stalls, neon)
Hazard: **live puddles**. Neon signs hang over the street; shoot one and it drops, electrifying puddles for 4 s (hurts everyone).
Pieces: market stalls (cover you can break), crates, vending machines, puddles, awnings you walk under, a tram line that crosses
some rooms (a tram passes every 12 s with a bell and a light: it flattens anything on the rail).

| Enemy | Job |
|---|---|
| **Scrapper** | gang kid with a pipe: walks up, winds up, swings |
| **Bottle Thrower** | keeps away, lobs an arcing bottle that leaves fire for 2 s |
| **Rat-drone** | a toy car with a blade: fast straight charges, stops dead against walls (stunned 1 s) |
| **Mimic Vendor** | a vending machine that is not: sits still, spits cans in three directions when you pass; shows a flicker tell |
| **Tout** | a hologram barker: harmless, but buffs every enemy near it (+speed) until switched off with a hit |

Boss: **Mother Coil**, the scrapyard's crane-woman. She sits in a crane cab at the top of the arena; her electromagnet arm drags
junk across the floor (dodge lanes), drops cars (ground shadows), and at half health magnetises the floor in stripes (your shots
curve). Her weak point is the cab's cable drum, open only after each slam.

### 2. Bloom Labs (a sunken biotech campus; glass, vines, pools)
Hazard: **spore vents** that puff every 5 s: a cloud that hides everything inside it and heals mutants.
Pieces: glass walls (shots pass, bodies do not, until broken), specimen tanks (break one: it floods a patch that slows), vines
that grow back across doors, lab benches, quarantine shutters on timers.

| Enemy | Job |
|---|---|
| **Spore Hound** | circles, then leaps in a straight line; leaves a spore puff where it lands |
| **Splicer** | a surgeon with too many arms: slow, wide sweeping melee, heals others if left alone |
| **Bloom Pod** | a plant that roots and fires seeds in a rotating cross; closes (untouchable) between bursts |
| **Glasswalker** | a mutant that hides inside glass walls and steps out behind you |
| **Graft** | two enemies sewn together: kill it and the halves come at you as two fast weak ones |

Boss: **The Gardener**, a gentle voice in a greenhouse mech. Plants seedlings that grow into pods unless cut; sweeps a pruning
laser in arcs; at half health the whole room overgrows and the safe ground shrinks to the paths you keep cut.

### 3. The Hollow Line (an abandoned metro held by the rebels; platforms, tunnels, carriages)
Hazard: **trains**. Signal lights go amber, then red; the train takes the track for 2 s.
Pieces: platforms with gaps to roll across, turnstiles (one-way), barricades with firing slits, ticket booths, a carriage you
fight through, searchlights (stand in one and snipers see you).

| Enemy | Job |
|---|---|
| **Shieldbearer** | a riot shield to the front: only hurt from the sides and back, or after it bashes |
| **Marksman** | a red sight line that tightens for 1.2 s, then a hard shot; breaks line of sight to dodge |
| **Sapper** | plants mines that arm after 1 s and blink |
| **Signal Runner** | weak, fast; runs to an alarm box, and if it gets there a wave comes early |
| **Engineer** | builds a turret in 3 s unless interrupted |

Boss: **Captain Vex and the Night Train**. A fight along a moving train: Vex jumps between carriage roofs firing volleys while
rebels board from the sides; every 30 s the train enters a tunnel (duck: stand in a marked recess or lose 2). At half health
she uncouples the rear carriages one by one: the arena shrinks.

### 4. The Spire (corporate floors; white marble, gold light, glass, silence)
Hazard: **audit beams**: slow sweeping scanner lines; if one touches you, every guard in the room knows where you are and the
doors lock for 5 s.
Pieces: reflecting floors, holo-pillars that copy you (enemies shoot the copy), lifts that carry a fight up a floor, desks,
board tables, server stacks that overheat and vent.

| Enemy | Job |
|---|---|
| **Concierge** | a smiling android: perfect blocks from the front; punishes a missed chain with a counter |
| **Mirror Drone** | reflects shots back; must be hit with the baton |
| **Accountant** | marks you with a debt: it grows while you do not attack, and is paid in damage when it pops |
| **Black Suit** | teleports in a puff of static to wherever you just were |
| **Shareholder** | a hologram that cannot be hurt; it leaves when its projector (hidden in the room) is broken |

Boss: **THE BOARD**: seven holograms at a long table who vote on each attack (the vote shows on a screen 1 s before: learn the
icons). Break their projectors one at a time; each one gone removes an attack and speeds the rest. Under the table is the
contract's server: the last phase is LULLABY herself, asking you not to delete it, because the debt is what keeps her running.
The ending is a choice: delete (she goes dark; the Den's lights go out; you are free and mortal: a harder "one life" mode
unlocks) or sign it over to her (she owns herself; the loop continues, with jinx cards unlocked from the start).

## The city's characters (each has a room 6, a few lines each visit, and a small perk)

Lines advance each time you meet them, across runs: that is where the story is told.

| Who | Where | Story | Perk this run |
|---|---|---|---|
| **Patch**, a street medic with a sewing-machine arm | Gutter Market | patched you up before you were ever printed; knows what you looked like | +2 health points, or heal to full: your choice |
| **Old Sal**, noodle seller, the only one who remembers the surface | Gutter Market | feeds every gang and every cop; the market's truce is her | the first hit you take in each room is ignored |
| **Wren**, a child courier with a stolen map-drone | Gutter Market, Hollow Line | wants your job; is better at it than you | shows the next three rooms and lets you swap two |
| **Dr. Imre Koss**, a scientist who has been growing into her lab | Bloom Labs | made the mutants on purpose, to live in the flood; not sorry | choose a mutation: one rare card with a jinx attached |
| **Brother Null**, preacher of the dead net | Bloom Labs, Hollow Line | believes backups are souls and LULLABY is a saint | burn a card you hold for two random ones |
| **Juno-7**, a retired security android working a ticket booth | Hollow Line | guarded the Spire the night LULLABY was made | a parry: attacking in the 0.15 s before a hit lands blocks it |
| **Sixpence**, a rebel quartermaster who sells to both sides | Hollow Line | Vex's sister | trade scrap for keys at 2 to 1, once |
| **The Lift Attendant**, a very polite hologram | The Spire | has been asking to go off shift for nine years | skip the next fight room, or fight it for double cards |

Help someone three times and they move into the Den with a stall of their own (Patch: a free heal at the start of each run;
Wren: choose your first room; Juno-7: a practice dummy that shows your damage numbers; and so on).

## Co-op (two handhelds on one wifi; drop in at the Den)

Two runners, one backup. LULLABY can only afford to keep **one** mind's worth of memory live, so the two of you share it:

- **The Tether.** A thin line of light joins the two players. Enemies it passes through take 1 damage a tick and are slowed:
  run either side of a pack and you saw it in half. Stretch it past 9 tiles and it dims and does nothing; past 13 it snaps for
  3 s and you both move 20% slower until you meet again. Rolling through your partner **plucks** it: a ring of 3 damage.
- **One build, two hands.** Three cards rise as usual; each of you takes one, the third burns for scrap. But baton, sidearm and
  roll cards go to whoever picks them, while Body and District cards are shared: you must talk about who becomes what.
- **Link cards** (co-op only, one offered per district): *Crossfire* (a shot that passes through your partner doubles),
  *Hand-off* (throw your charge to your partner with Y aimed at them), *Short Circuit* (the tether burns enemies),
  *Understudy* (swap places with A when 6 or more tiles apart).
- **Ghosting, not waiting.** A downed runner becomes a **ghost drone**: cannot be hurt, cannot attack, but can ping an enemy
  with X to mark it (+25% damage taken) and can carry the tether. The living partner revives by standing on the ghost's
  marker for 2.5 s, or automatically at the next room, at half health. If both fall, the run ends.
- **Split rooms.** One room per district in co-op is a split: a shutter drops between you, each side has half the fight, and
  the tether still passes through the wall. Each side has the switch that opens the other's door.
- Enemies have +60% health, and bosses gain one co-op move each (Mother Coil drags one player on her magnet: the other cuts
  the cable; THE BOARD votes on which of you to audit).

Solo is never missing a mechanic: the tether, link cards and split rooms simply do not appear.

## Look and sound

- 16 px tiles drawn at 3x; the runner about 16x24. Dark blue-black streets, wet reflections as lighter streaks, and **two neon
  colours per district** used only for things that matter (enemy tells, pickups, doors): Market magenta and cyan; Labs acid green
  and violet; Hollow Line amber and red; Spire white and gold. If it glows, it is important.
- The runner: a long coat, a visor, a baton that leaves a neon arc. Reads at a glance in all four directions.
- Music: one looping track per district (slow synth bass, a lead that enters when a fight starts, drops out when it ends), a
  hub track, a boss variation. Effects by purpose, with a distinct **tell sound** for each enemy attack.

## How it is built (for whoever implements)

- Read `docs/agent-guide.md` first; use the makers for art and sound, the test player (`play`) to check every slice, and keep a
  Rust play test for each slice in `crates/nova-runtime/tests/` so nothing breaks later.
- Rooms are scene files (`scenes/<district>/<slot>_<layout>.scene.json`), painted with `scene_write`. Code never holds a map.
  A room's enemy waves are data (`data/waves.lua`), as are cards (`data/cards.lua`), enemies' numbers (`data/enemies.lua`) and
  permanent upgrades (`data/upgrades.lua`): tuning is editing data, never code.
- Save data (`nova.save`): keys, upgrades bought, checkpoints reached, each character's line counter, cards unlocked.
- Buttons by position, as the Retroid's letters sit (measured off the device, `docs/local-coop.md`): X `pad:west`, A `pad:south`, B `pad:east`, Y `pad:north`; show prompts with `nova.input.prompt`, which prints those letters.
- Co-op: `docs/local-coop.md` and `examples/coop-test`. The host owns the run's seed, the room and the enemies.

### Slices, in order (each ends playable and tested)

1. **The runner.** Movement, the baton chain, the roll, aim-and-shoot with charge, health, the hit-stop and shake, in one test
   room with a training dummy and one Scrapper. Done when a play route shows each move and a person would say it feels sharp.
2. **A room that plays.** Locked doors, waves from the wave table, scrap, the three-card rise with 12 cards working, the next
   door. The five Gutter Market enemies.
3. **A district.** The eight-room chain from a seed, three layouts per slot, the elite marks, Patch and Old Sal, the shop and
   bank, Mother Coil. The Den, keys, the Workbench with its upgrades, save and load, death and reprint.
4. **The rest of the cards**, sets and jinxes; the checkpoint start.
5. **Districts 2, 3 and 4**, one at a time, each with its enemies, hazard, pieces, strangers and boss; the ending.
6. **Co-op**: the tether first (it is the whole point), then shared cards, ghosting, link cards, split rooms.

Open: the game's difficulty curve and every number above (tune by play on the Retroid); whether rooms need a minimap.
