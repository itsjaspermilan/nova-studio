# The mountain post office (working title)

Status: **design draft, 2026-11-22, for the owner to correct.** The slice below ("Slice spec") is built as `examples/mountain-post`
(Fernhollow Post, 2026-11-22; its tests are `crates/nova-runtime/tests/mountain_post.rs`). Nobody has played it yet, heard it, or run it on
the Retroid: it waits for the owner's play.
Rule for this game (the owner's, 2026-11-21): plan it properly, build ONE vertical slice, and add nothing more until the owner
has played the slice on the Retroid and said it is right.

## In one breath

You are the new postmaster of a small mountain town of animal people. The post office is run down and behind on its mail. You
drive a small delivery van (and walk) with no GPS, learn the roads by name, hand parcels to the residents, hear their stories, and
slowly put the post office and the town back together. No deadlines, no pressure, your own pace.

Near: **Easy Delivery Co** (driving a van to addresses with no GPS; simple 3D) and **Stardew Valley** (a run-down place of your
own, a fixed cast with stories, days). Not in it: romance, farming, combat, timers, fail states.

## The moment it is built around

Driving down a quiet mountain forest road, turning in at a cabin, getting out, handing a parcel to the resident, a friendly
exchange, and a small piece of the town's story.

## Decided in the interview (2026-11-22)

| Question | Answer |
|---|---|
| Cast | Everyone is an animal, the player too; simple and cute. About **12 residents** in all (about 5 in the first map, 3 or 4 in each of the other two), each with a personality, a home, a routine and a story. No love interests; some stories are small conflicts the postmaster helps resolve. |
| Driving view | A chase camera **behind the van**; the right stick looks around. |
| Van feel | **Gentle with some weight**: forgiving, leans and rolls on its springs, takes a moment to stop; rain, snow and mud make it slip a little. No damage, no fuel. |
| Finding places | The label says **name and street** ("Hazel Badger, 3 Fern Lane"). Roads have names on signs, houses have numbers, and a paper map of the town can be opened. The **minimap shows only where you are**: no destination pin, no route. |
| Time | **Days with a bedtime**: a clock from morning to night; you sleep at home to start the next day; nothing is lost by staying out. You may drive by day or night; night is harder (few lights). Storms affect driving. |
| Carrying | The van holds **both of the slice's parcels** (it was one until the owner's second notes; upgradable later). On foot you carry one and are slower. |
| Progress | Deliveries pay **coins** and raise that resident's **friendship**. Coins buy van and post office upgrades. Named **town projects** (a bridge, a rockslide) need coins, materials or favours; finishing one opens the next map. |
| The post office | The backlog sits on shelves as real parcels; you **pick** what to take, new mail comes each morning, residents drop in to post things, and you **repair and decorate** the room. |
| World | **Three maps**. The first has the post office and your home; the other two are blocked to cars until the town is rebuilt. Small enough to learn, large enough to explore. |
| Making it yours | The post office, the van, your uniform, your home and your looks can all be customised. |
| Look | Simple 3D **between clean and retro**: clean low-poly shapes and flat warm colours, crisp pixels on textures, no wobble. Big-headed animal people. |

## Assumed until the owner says otherwise

- On foot: a camera behind the postmaster; A talks or hands over, B gets in and out of the van.
- Talking: text boxes with a short voice-like babble per character, no spoken lines. Tone warm and funny, never mean.
- You can go inside the post office and your home; residents meet you at their door.
- Engine: Nova, 3D, on the Retroid first. The van uses the suspension and chase camera made for Pine Ridge; residents come from the
  character makers.
- Played with a gamepad only.

## Open (to settle before or during the slice, one at a time)

The game's name and the town's name. How long a day is. What the three maps are (forest valley, lake, high pass?). The twelve
residents: species, names, one-line stories. What upgrades exist. How saving works. Music.

## The vertical slice (a proposal: to agree in writing before anything is built)

**What it is:** about five minutes of the real game at final quality, built around the moment above.

- A piece of the first map: the post office (outside, and its room inside with a shelf of three parcels), about three named
  roads through forest with signs, and **two cabins with two residents**.
- Take a parcel, read its label, walk out, get in the van, drive there by the signs and the paper map, get out, hand it over,
  talk. Each resident has a first conversation that tells you something about the town.
- Daytime, clear weather, one track of music, the van's sounds, the forest's sounds, the babble voices.

**Left out on purpose:** night, storms, the clock and sleeping, coins, upgrades, projects, customising, the other residents and
maps, saving.

**"Right" means, on the Retroid:** the van is pleasant to drive for its own sake; the road and cabins look like a place you want
to be in; you can find an address without help and it feels good to; the two residents are charming in the first exchange;
it sounds cozy; it holds its frame rate. The owner judges each of these by playing. Until all are yes, only the slice is worked on.

## The owner's first play on the Retroid (2026-11-22: drove around, delivered nothing)

These replace the matching lines of the slice spec below where they differ.

- **Frame rate:** smooth throughout. **Finding the way:** "fine for the vertical slice but we'll want to make the world much
  bigger later on". **Sound:** not judged (not noticed or muted). **Residents:** not reached.
- **One look for everything: a soft toy diorama.** "We should think of a cohesive theme for all the assets so it doesn't look
  like a mismash asset dump." Everything rounded and chunky like toys, flat painted details, one small warm palette, no
  realistic proportions. Every model, old or new, follows this.
- **The van:** "too large and realistic. We need to have some style." The reference the owner sent is a boxy mail delivery
  truck: a tall square body with rounded top edges, a very short sloping nose, a big upright windscreen and large side windows,
  small wheels tucked under it, a flat back, a stripe along the side. Ours is a small, stubby toy of that idea (our own design,
  no real service's marks). Faults to fix: the rear doors "slide around when the vehicle turns" (they must be part of the
  body); "blocky black wheels underneath the actual wheels"; it needs **hollow wheel wells**.
- **The characters:** "Look weird honestly. Let's follow Animal Crossing a little closer": squish the heads (wider than tall),
  and make the faces **flat 2D, painted on the head**, not built from raised parts. Simpler animals: **Hazel is a bear** now
  ("a badger is tough"); Pip stays a rabbit, the postmaster a fox. Walking is a little faster.
- **Trees:** "their leaf cones are sloped the same way the ground is. On a hill that looks really weird." Trees stand upright.

## Slice spec (agreed by the owner 2026-11-22: "Yes, build that slice")

Everything below is the slice and nothing else. Names here are working names the owner may change.

**Place.** The town is **Fernhollow**, in a larch and pine valley, late morning, clear. The slice's piece of it is roughly 500 m
across, hilly, with a creek:
- **Post Road**: the main road. The post office stands on it (a small timber building with a porch, a faded sign, a parking
  spot where the van waits). It runs on to a barrier with a hand-painted **BRIDGE OUT** board where the old bridge to the lake
  side is gone (the way to a later map: you can look across, not go).
- **Fern Lane**: turns off Post Road uphill through ferns and mossy rocks to **No. 3**, Hazel's cabin and workshop, sawhorses
  outside, a stack of planks.
- **Kettle Creek Road**: turns off the other way, crosses the creek on a small wooden bridge, and ends at **No. 7**, Pip's cabin
  with a tall home-made radio mast.
- Wooden signposts with white lettering at each junction, a numbered mailbox at each gate, chimney smoke, birds, blue mountains
  far off. There is enough beside the roads (a picnic spot, an overlook, an old stone wall) that driving past a turn is pleasant.

**You.** The postmaster: a fox in a blue postal jacket and cap (looks are customised later, not in the slice).

**How people are built** (the owner, 2026-11-22, on seeing the first pictures: "I don't like how tall the characters are. Use Animal
Crossing New Horizons as an example. We don't have to worry too much about elbows and knees that way."): short and round, about
two to two and a half heads tall, a big head on a small body, stubby arms and legs as single pieces with no elbows or knees,
mitten hands, simple feet, big simple eyes. About a metre tall, and the world is sized to them.

**Faces** (the owner: "The facial features should also be larger so they can emote."): large wide-set eyes, clear eyebrows, a
readable mouth, a big simple nose or muzzle, bold enough to read from the driving camera. A small set of expressions (neutral,
happy, delighted, gruff, surprised, talking, blink) that change with each line of a conversation; idle blinking.

**Running** (the owner: "when the player runs, their arms go wide. Very cute"): ~~a gentle push of the stick walks; a full push
runs with the arms held straight out to the sides~~ (replaced by the owner's fourth notes: the stick alone only walks, B held runs,
and the run banks into turns; see the end of this file). Carrying a parcel, the run is a trot with the parcel held in front.

**The van.** Simple, like a modern high-roof panel van (the owner: "the van isn't simple like a Sprinter"): one tall smooth box
with soft edges, a short sloping bonnet into a big windscreen, clean flat sides, two tall rear doors, plain lights; no roof rack,
nothing fussy. Cream with a red stripe, FERNHOLLOW POST on its side. Holds both of the slice's parcels (carried out one at a time, so
loading two is two trips from the shelf). A cheerful horn. (The shape since the owner's second notes: see the end of this file.)

**The residents.**
- **Hazel Brock**, a bear (was a badger until the first play), retired carpenter, 3 Fern Lane. Gruff, dry, kind underneath. Her parcel: a set of chisels she
  ordered two winters ago.
- **Pip Tansy**, a young rabbit who runs a one-rabbit radio station from his cabin, 7 Kettle Creek Road. Talks fast, hopeful,
  easily delighted. His parcel: a valve for his transmitter.

**What happens.**
1. You start inside the post office: dusty, half the shelves empty, one shelf with **three items**: a letter addressed to "The
   Postmaster, Post Road", a parcel for "Hazel Brock, 3 Fern Lane", a parcel for "Pip Tansy, 7 Kettle Creek Road".
2. The letter is for you: read it at the counter. It is from the Mayor (a heron, Odette Marsh, unseen in the slice):
   "Welcome to Fernhollow. The post office is yours, such as it is. Mr. Pemberton left two winters ago and nobody has had a
   letter since. Take your time. We have waited this long. P.S. The van pulls a little to the left. So did Mr. Pemberton."
3. Take a parcel (one at a time), read its label, walk out, put it in the back of the van (its rear doors open as you come near;
   X loads it), get in at the left doorway (Y), find the address by the signs and the paper map, get out, take it from the van's
   back (a small panel shows the parcels in the van one at a time, name and street; L1 and R1 go through them, A takes the one
   shown), hand it over at the door (X), talk. (The buttons as the fourth notes have them: "Controls" below.) Come back for the other, or load both before setting out: the van holds both. The
   order is the player's.
4. When both are delivered and you are back at the post office, the slice ends quietly on a card: "Two delivered. A few hundred
   to go."

**The conversations** (text boxes, a babble voice per character; the player's lines are not shown; keep these words unless the
owner changes them).

Hazel, when handed her parcel:
- "Hm. So there IS a postmaster."
- "Chisels. I ordered these two winters back. Built a whole porch without them."
- "Pemberton never lost a parcel in forty years, then one morning he just didn't open up. Same winter the lake bridge went."
- "I'd have rebuilt that bridge myself, if the Mayor and I were speaking. We're not. Don't ask."
- "...Thank you. Mind the left on Fern Lane. Everybody clips my wall."

Hazel, after that (talk again): "Still here? The wall's fine. Mostly." / "If you see Pip, tell him his aerial hums through my
teeth."

Pip, when handed his parcel:
- "IT CAME! It actually came! You're real!"
- "I've been telling everyone on the radio the mail's coming back. Every morning. For a year. Nobody believed me!"
- "This valve means Fernhollow Radio can reach past the creek again. Maybe even the lake side, when there's a bridge."
- "Hazel says my aerial hums. It does not hum. It SINGS."
- "Tune in tonight. I'm going to say your name. What IS your name? Never mind, I'll say 'the Postmaster'. Sounds grander."

Pip, after that: "Testing, testing. Can you hear that? No? Good, it's not plugged in yet." / "If Hazel asks, the aerial is
staying."

If you knock without their parcel: Hazel: "Unless that's my chisels, I'm busy." Pip: "Is it here? Is it? ...Oh. Hello anyway!"

**Finding your way.** Labels give name and street. The **paper map** (one button) is a hand-drawn sheet of the slice's roads with
their names and the post office marked; no house numbers, no marker for you, no destination. The **minimap** is a small disc that
shows the roads right around you and you; nothing else. Nothing in the world points the way except signposts and mailbox numbers.

**Controls** (replaced 2026-11-22 by the owner's fourth notes; the old paragraph, which also put the letters at the wrong places,
was: ~~A south, B east, X west, Y north; A talks, takes, hands over, reads, loads and takes from the van; B gets in and out; X the
horn; Y the paper map~~). The letters are the ones engraved on the Retroid, whose face buttons are laid out Nintendo-style: **A on
the right**, **B at the bottom**, **X at the top**, **Y on the left** (Android reports them by letter: A is `pad:south`, B
`pad:east`, X `pad:west`, Y `pad:north`, read off the device 2026-11-12; nova.json binds by those names, and the prompts draw the
same letter).
- **X** (top) interacts on foot: talk, take from the shelf, read the letter, put a parcel back, hand over, and "Load package" at the
  van's open back; it goes on in a conversation and closes the label, the letter and the end card. ~~In the van X sounds the
  horn.~~ (replaced 2026-11-23, the sixth play) In the van X moves the lever one gear towards P.
- **Y** (left) gets into the van at its left doorway, and out of it when it has stopped.
- **A** (right) confirms in menus only: Start on the title, the pause menu's choice, and Take in the van's parcel panel (a menu).
  In the van (the sixth play) A moves the lever one gear towards L.
- **The van's lever** (the sixth play: an automatic with PRNDL): A steps toward L (down the column), X toward P (up); the column
  reads P R N D L top to bottom, shown bottom left beside the minimap with the handbrake lamp (lib/gear_hud.lua). It is in P each
  time someone gets in, and left in P on getting out. Among P, R, N and D it moves only with L2 held and the van all but stopped
  (under 0.5 m/s); otherwise a soft click and "Hold the brake to shift" (or "Stop to shift"). D and L change freely at any speed.
  P holds the wheels; R backs up on R2 (a soft reversing beeper sounds every 1.2 s, only in R); N rolls free, down a slope too;
  D drives; L pulls harder, brakes on the engine and tops out at about 58 % of D (the steep lanes). Each shift is a gentle clunk.
- **L3** (the left stick's click) sounds the horn while driving (it was X).
- **B** (bottom), held: on foot, run (the stick alone only walks); driving, the handbrake (the rear wheels lock, the van slows firmly,
  in a bend at speed the tail steps out a little; standing, it holds the van still on a slope; the brake lamps light).
- **Select** (the minus button) opens and closes the paper map. **Start** pauses (resume, quit). **L1** / **R1** go round the
  parcel card, or the van's panel at its open back. **R2** goes (forwards in D and L, backwards in R), **L2** brakes
  (~~brakes then reverses~~: only brakes since the sixth play), the left stick moves or steers, the right stick looks.
- Keyboard (tests and the desktop): X is Space (or the X key), Y is F, A is Enter, B is Shift, Select is M (or Tab), Start is
  Escape (or P), L1 / R1 are Z / C, the stick and the pedals are the arrows or WASD, Q / E look, H the horn.

**Sound.** The van's engine (soft, small, a little rattly), tyres on gravel and tarmac, the horn, doors; forest air, birds, the
creek near the bridge, Pip's radio faintly near his cabin, sawing near Hazel's; footsteps; a babble voice for each of Hazel
(low, slow), Pip (high, fast) and paper sounds for labels and the letter. One piece of music: slow, warm, acoustic-feeling (soft
plucked lead, round bass, brushed drums), quiet enough to drive to, readable on small speakers.

**Quality bar.** Final quality, not a prototype: the owner will judge the van's feel, the look of the place, finding an address
unaided, the charm of the two exchanges, the sound, and the frame rate, on the Retroid (which gives games a 1280x720 screen).

## One look: a soft toy diorama (after the owner's first play, 2026-11-22)

The owner: "We should think of a cohesive theme for all the assets so it doesn't look like a mishmash asset dump." The rule for
every model that is not a character (trees, rocks, plants, cabins, the post office, signs, mailboxes, the bridge, the barrier,
furniture, parcels, the van):

- **Rounded and chunky, like toys.** Every edge softened (a box's by a quarter of its thinnest side, up to 14 cm); round things
  shaded smooth; trees are soft stacked cones and puffs, rocks are pebbles; nothing thinner than about 6 cm.
- **Flat painted details.** A stripe, a window, a number, bark marks: colour on the surface or a shallow recess, never fiddly
  geometry.
- **One small warm palette**, a little muted: creams, a post-office red, mustard, a soft sky blue, three woods, two stones, a slate
  roof, greens from deep pine to bright larch; no pure black or white (a dark is a warm brown-grey).
- **No realistic proportions.** Squat and generous, sized for villagers about a metre tall.

The palette and the softening rule live in one module, `examples/mountain-post/tools/palette.mjs`, which every maker in that
folder imports (`models.mjs`, `nature.mjs`, `van.mjs`, `art.mjs`). Characters are made elsewhere and are not under this rule yet.

**What the first play changed** (besides the characters): the van is now a small stubby toy of a boxy mail truck (2.9 m long,
1.9 m high: a tall square body with rounded edges, a very short sloping nose, a big upright windscreen, big cab windows, a flat
back, small wheels in hollow wells, one red stripe, FERNHOLLOW POST); its rear doors are the body's children in the model, so
they lean, roll, pitch and turn with it (they used to be drawn as pieces of their own, tilted but not carried by the body's
turn, so they slid off it in a bend); the dark discs that read as a second set of blocky wheels (fixed "arches" in the body that
the sprung wheels moved away from) are gone. Trees, bushes, the mast, the signposts and the mailboxes stand upright on slopes
(the renderer used to lift every vertex by the ground under it, which leans a tall cone with the hillside; Nova now has
`lift = "upright"`). The postmaster walks, runs and trots 15% faster, the clips played 15% faster so the feet keep step.

## The owner's second notes (2026-11-22, from pictures of the build)

These replace the matching lines above where they differ.

- **The van:** "Let's shorten it and add that slope at the back that the reference image has. Also the windows look really weird."
  "The player should be visible through the windows of the truck also. We can also make the truck have no doors." Now a stubby
  toy of the classic boxy mail truck, 2.4 m long (2.5 with its chunky dark bumpers), 1.48 wide, 2.0 high: a tall square box
  over the rear two thirds whose front is the cab, a big upright windscreen in a dark frame, a low short bonnet stepping down
  from it to a blunt nose (two small square lamps, a small grille), small dark steel wheels in round hollow wells, and behind
  the rear wheel the underside sweeping up to the rear bumper while the back leans in to a roof with a rounded lip all round.
  Cream above, sand below, one red band between that sweeps down along the bonnet. The cab is **open-sided**: a tall rounded
  doorway each side, no doors, a seat and a steering wheel inside; the windscreen is a real opening (a toy's: no glass). The
  rear doors (part of the body) have open windows into a lined hold, and the hold has a window into the cab, so from the chase
  camera behind the driver's head shows through the back. **The postmaster sits at the wheel** while driving (the
  `sit` clip of character3d_make), carried by the body as it leans, hands on the wheel, which turns with the steering, the head
  turning a little into a bend, a smile at the horn. The parcels in the van ride on the hold's floor.
- **Getting in and out, loading:** "the player is forced to watch the character walking slowly with the package to the back...
  Let's scrap all that." Nothing walks the postmaster anywhere now. The rear doors swing open by themselves as they come near
  the back and shut as they walk away; carrying a parcel there, the prompt is **Load package** (A), and it goes in at once. With
  empty hands and parcels in the van, a panel shows them one at a time (L1 / R1, A takes). B at the **left doorway** (the
  driver's side) puts them in the seat at once; getting out puts them beside it, facing the way the van faces.
- **Buildings:** "When leaving any building ... The user should just be outside." A short fade (0.3 s) through the post office's
  door either way; outside they stand a step from the door facing away from it, inside just within it, the stick theirs at once.
- **Cameras:** on foot outdoors the camera is further back and higher, looking down on a small character in a diorama ("zoom out
  the camera and raise a bit to make the world feel a little smaller"); the driving camera a little higher too. Neither goes
  inside the van, a tree or a building: the boom comes in where something solid is in the way (the scenery's shapes, tree
  crowns, the van's body). Getting out of the van the view glides from behind the van to behind the postmaster, beside it,
  outside. Inside the post office: one fixed view from high over the room ("a simple top down view like Animal Crossing"), the
  front wall cut away to a low stub and no ceiling; the stick moves the postmaster as the screen shows the room.
- **Trees:** "Can we cut the trees a bit? Or do it in a different way?" About 2,400 single trees became some 440 in deliberate
  clumps of three to eight by the roads and the houses with open grass between, a big "hero" tree at each signpost and gate, and
  where nobody goes (the valley's sides, beyond the creek, the far bank, the edges) a few dozen soft forest masses: lumpy rows of
  big puffs in the pine greens with a scalloped top and a darker foot (tools/nature.mjs, placed by tools/scene.mjs).

## The owner's second play on the Retroid (2026-11-22: finished both deliveries)

Kept: the indoor top-down camera ("seems good!"), leaving the van ("perfect"), the trees in clumps ("Better, keep it"), loading at
the back ("Good first pass!"). To change, in the owner's words:

- **Van:** "Don't like it still. It seems too tall still, we need to make it shorter (vertically). The turning is too aggressive
  and doesn't feel like there's actual weight to it. The back doors look like a bunch of rectangles just stuck together, not a
  solid door." And: "the van can be slower to start and wait for the upgrades to be faster".
- **Walking:** "The character walk needs to be reworked a bit. I think the animation needs to slow down a bit and the player
  should be able to move faster."
- **Camera on foot:** "When walking I think we can clone the Animal Crossing camera." "When leaving the post office, I think we
  can be further away from the post office because as the user walks, the camera turns around quickly." "If I just walk around
  in a circle, there is quite a bit of stutter that happens."
- **Prompts:** "If I'm close to the van trying to get the package, I only get an option to 'knock' even though 1 I'm not at a
  door, 2 I'm not trying to talk to the person and they keep following me."
- **Sound:** "The music is a little repetitive. Can we use piano? Also I think the ambiance is a little loud at times."
- **UI:** "Can we spruce up the menu UI a bit? Looks kinda bad. Maybe let's make a UI system with Kenney assets? I want a cohesive
  theme that we can use. Then we can use that for the van menu. Also if there is only one item in the van, the menu should still
  pop up to show what's there. Instead of listing all the active packages in the top left, the user should be able to scroll
  through them with LB/RB assuming they're not in the van storage menu." The owner approved downloading one Kenney pack: UI Pack
  2.0 (CC0), from kenney.nl.
## The owner's second play: the menus, the parcel card, the music, the ambience (2026-11-22)

These replace the matching lines above where they differ (the slice spec's "Sound" line about the music, step 3's panel).

- **One UI theme:** "Can we spruce up the menu UI a bit? Looks kinda bad. Maybe let's make a UI system with Kenney assets? I want a
  cohesive theme that we can use." Every piece of UI is now drawn from one small kit (below), made from Kenney's UI Pack (CC0).
- **The van's panel:** "if there is only one item in the van, the menu should still pop up to show what's there." It did, but
  only within 1.35 m of the spot behind the van, while the doors swung open at 2.1 m: walking up, the doors opened and nothing
  showed until the postmaster stood at the bumper. The panel now opens with the doors (2.0 m), one parcel or two.
- **One parcel card:** "Instead of listing all the active packages in the top left, the user should be able to scroll through
  them with LB/RB assuming they're not in the van storage menu." One card in the top-left corner shows one parcel on the go:
  "carrying" (in the postmaster's arms, shown first) or "in the van". Parcels still on the office's shelf are not counted: the
  shelf shows them, and the card is for what you are out delivering. With more than one, "1 of 2" and L1 / R1 under it; L1 and
  R1 go round them on foot, driving and in the office. At the van's open back L1 and R1 are the panel's: the card fades back
  without its count and buttons and keeps its parcel. During a conversation or under a card it is hidden.
- **Music:** "The music is a little repetitive. Can we use piano?" A new piece for felt piano alone (below).
- **Ambience:** "I think the ambiance is a little loud at times." Measured and brought under the music (below, "Sound levels").

### UI theme

Made by `tools/ui-kit.mjs` from ten pictures of Kenney's **UI Pack 2.0** (grey set, drawn at twice the size), recoloured into the
toy palette by a gradient map (the pack's four greys become ours); the files and their sources are listed in
`licenses/kenney-ui-pack.txt` (and the game's own `licenses/`, which `nova export` adds to the exported THIRD-PARTY.txt). Drawn by
`lib/ui.lua`; nothing else in the game draws a panel, a button or a chip.

| Piece | Picture | Use |
| --- | --- | --- |
| panel | `ui/kit/panel`: cream paper (#f3e6c8) on a wooden frame (#9a6a44) with a darker foot (#6f4a31) | every card, the dialogue box, the van's panel, the pause menu, the map's frame, the letter, the end card, prompt chips |
| key | `ui/kit/raised` / `pressed` (neutral, tinted), or the paper `panel` / `panel_down` | buttons (the chosen one red), the title strip, name tags, L1 / R1 |
| round | `ui/kit/round` / `round_down`, tinted | the face buttons: A red, B mustard, X blue, Y green, letters in cream |
| select | a slate key (as L1 / R1) with "Select" on it (`ui.select_key`) | the paper map's button |
| slip | `ui/kit/slip`: white with the post's red double edge | a parcel's label (the label card, the van's panel) |
| rule | `ui/kit/rule`: a wooden groove | under the letter's address, between the card and its count |
| chevrons | `ui/kit/chev_l` / `chev_r`, slate | beside L1 and R1 |

- **Colours:** paper #f3e6c8, ink #3e3631 (text), faint #7a6550 (second lines), wood #9a6a44, post red #c94a3b (title strips, the
  chosen button, "in the van"), postal blue #4f78ad ("carrying"), mustard #e2b04a, green #6f9f52, slate #706660 (shoulder keys),
  cream #fff8ea (text on red and on keys). Speakers' tags: Hazel #86583c, Pip #d29634.
- **Fonts (after the owner's third play: "Seems too generic Word document"):** one face for every word, `rounded` (Fredoka,
  the one bundled with the engine), in two weights: regular (the face a little thickened, `bold` 0.55: its own is light for
  small paper text) and heavy (`bold` 1.3: names, headings, buttons, button letters). All of it goes through `ui.text`, which
  forces the face. The serif (Lora) is used by no game file (a test scans for it). The only other face is the Mayor's name at
  the foot of the letter, in `script` (Pacifico); the baked art (title, map, signs) is rounded too. The pack's Kenney Future
  was left out: a hard geometric face that fights the soft toys.
- **Scale (the same notes: "we can make the UI elements a little smaller"):** every length and size in `lib/ui.lua`, `cards.lua`
  and `dialogue.lua` goes through one scale, `ui.S = 0.82` (`ui.s(n)`), with floors in the screen's units (1.33 px each at
  720p): body 15 = 20 px, small lines and hints 13 = 17 px. Sizes below are the first design's, times `ui.S`; the minimap went
  from radius 74 to 64 and the map sheet to 88% to match.
- **Sizes** (the screen's units, 540 high, before the scale): headings 26 on a 46-high strip; buttons 24 to 28 on 56-high keys;
  prompts 19 on 40-high chips with a 25 button; dialogue and names 22 to 25; small labels 15. A panel's frame is drawn at half the
  pack's double size (8 units), a chip's at 0.4.
- **Spacing:** 18 to 22 units from the screen's edge (cards 20, 18 from the top-left; prompts 22 from the bottom-right, 10
  apart); 18 inside a panel; a title strip sits across a panel's top edge, half over it.
- **Behaviour:** a button cap or key shows held (the flat picture, lower by its foot) while its button is down; cards rise 30 units
  and fade in over 0.2 s over a dimming of the world; the end card dims nearly to black first. The van's parcel panel is no
  card but a light overlay: it fades and slides up in 0.2 s when the postmaster comes to the open back with empty hands and
  parcels inside, fades away when they walk off, and never takes the stick, the camera or the clock (Valley:fade_picker).

### The music: "Fernhollow" for felt piano

`tools/music.mjs` writes it note by note: F major, 68 to the minute easing to 61 at the end of each section, two hands on Nova's
new `piano` instrument (struck strings from their partials, a little sharp as a stiff string's are, falling in two stages,
a felt hammer; `brightness` 0.34 and 0.26: muted), a room, nothing else (no drums, no bass but the left hand). Two bars of left
hand play once; then 57 bars loop, about 3 minutes 20: A (the tune, a broken-chord left hand), A' (ornamented, the left hand in
flowing eighths), B (D minor and B flat, lower and quieter over long chords), A'' (the tune an octave up, soft, the left hand
thinned), C (B flat: a slow rising tune over rolling arpeggios, the fullest, ending on a bar with no tune), B' (B an octave up
over C's arpeggios), A''' (once more, ending on a new cadence) and a last bar of one low held F. Phrases end on rests; the level
rises and falls within each section and across the piece. -18 LUFS, played at 0.3 (about -28.5 LUFS heard on foot, a little
under the voices and well under the horn). **Nobody has listened to it**: offline renders and `sound_report` only.

**"The piano sounds kinda twangy and annoying still"** (the owner, on the handheld). Not brightness (the piece was already dull above
2.5 kHz) but the instrument; measured on single notes (the full numbers are in `docs/sound-for-agents.md`, "The piano's twang"):
its two strings a note were equally loud, so every partial beat to nothing (dips of 40 to 46 dB: a held C5 or C6 lost its
fundamental a second or two in and the centroid of C6 jumped from 1.2 to 2.8 kHz, a slow "wah" on every note); the partials fell
like a sawtooth's (the second only 3.5 dB under the first) and the high ones rang as long as the low; the hammer's comb lifted
partials 9 to 14 of the left hand's notes back up into a nasal hump (600 Hz to 1.8 kHz, ringing 4 to 10 s); and the damper was a
straight fade that held, then dropped 20 dB in its last 130 ms. Nova's `piano` is now voiced as a felt piano (song.ts) and the
piece is played on it again (right hand `brightness` 0.38, left 0.18, releases 0.5 and 0.7, a duller room, damping 0.7; the
intro's last chord lifts a beat early so that nothing of it still rings at the loop's start). Form, notes and length are unchanged
(-18 LUFS, 206.5 s, the seam matches). Two other voices for the same notes are a switch in `tools/music.mjs` (`VOICE`: "felt",
"epiano", "celesta"), and `scripts/env.sh node examples/mountain-post/tools/music.mjs --audition` writes the same 24.7 s of each (A bars 1 to 3,
B bars 1 and 2, C bars 1 and 2, as the song mixes them, all at -17.4 to -18 LUFS) to `build/audition/` as WAV and AAC for the
owner to choose by ear. **Nobody has listened to any of it.**

**Layers while driving** (the owner, after the clips: "I like A for the day and I like C for the nighttime. Is there a way to get
creative with the audio? So it's pretty simple when not in the vehicle, then as the player drives more and more layers can come on?";
then: "for stopping, the layers should start to fade as the speed slows"). The piece (same form, key, tempo and length) is five stems
of one song, written in `tools/music.mjs` and played together, sample-locked, by `lib/music.lua`:

| stem | what it plays | alone (LUFS) | the stack so far |
| --- | --- | --- | --- |
| piano | the felt piano: the tune and a lighter left hand (A', C and B' keep only the beats of their flowing eighths) | -18.0 | -18.0 |
| bass | a round bass (a saw through a low filter at 380 Hz): the root on 1 and the fifth on 3 | -25.6 | -17.4 |
| brushes | a shaker on the eighths with a ghost just before beats 3 and 1 (the lilt), soft taps on 2 and 4, softened at the top | -27.1 | -16.9 |
| pad | warm, slow strings (three detuned saws through a low filter) holding each chord from D3 up | -25.4 | -16.4 |
| celesta | the celesta answering the tune in its rests (its last two notes an octave up), an arpeggio where the tune is silent | -26.0 | -16.3 |

All five are 1.7 dB louder than the piano alone (under the 3 dB allowed); the music still plays at 0.3 on foot and lower in the
cab (0.72 of that, as before), so the full stack in the van is about 1.2 dB under the piano on foot, well under the voices. On the
handheld's speaker the stack plays about 1.8 dB quieter than on headphones (the bass sits low: alone, 36 % of it is under 80 Hz),
the piano alone 1.1 dB. sound_report warns that the layer stems start late and have long silences: that is right for a stem (the
intro and the breath are the piano's alone, the celesta only answers), and every stem's loop seam matches. The rule (`lib/music.lua`, `music.step`; the game calls it each frame): on foot, indoors (0.26, a touch lower) and on the title
the piano alone; getting in changes nothing; driving faster than 2 m/s earns the layers one by one (the first after about 4.5 s of
driving, then one about every 9 s, 1.6 times sooner at cruise), each fading in over 3.5 s from the piece's next bar line; the
layers follow the speed on the way down, from 6 m/s to 0.8 m/s, the last earned first, eased over a second and changed only in
steps of 0.05 (so wobbles at cruise do nothing), and gone by a stop; pulling away again brings the earned ones back with the speed,
with no new wait; getting out forgets the drive (what is left fades over 3 s); a card or a conversation leaves the piano alone, a
little lower (0.8). `--audition` writes each stage as a file (build/audition/stages/) and a 68 s drive
(build/audition/fernhollow-drive.wav and .m4a: on foot, in at 6 s, the layers joining at 12.8, 18.4, 24.0 and 29.7 s, slowing for a
junction at 34 s and thinning, pulling away at 40 s and filling again, stopping at 55 to 59 s, out at 61 s), with the levels from
the game's own rule (music.simulate, run in the game) placed on the bar lines as the mixer places them. **Nobody has listened to
it.**

**For the night, later:** the owner liked the celesta clip (C) "for the nighttime". Night is not in the slice; `tools/music.mjs`
keeps "celesta" as the named night voice (`NIGHT_VOICE`; set `VOICE` to it to hear the layers under it).

### Sound levels

The ambience as rendered by `tools/ambience.mjs` (a minute at each place, the music stopped; LUFS by BS.1770; "loudest 3 s" is
the short-term maximum, "loudest moment" the 400 ms momentary maximum). Before → after:

| Where | whole minute | loudest 3 s | loudest moment |
| --- | --- | --- | --- |
| on the creek's bridge | -21.8 → -31.3 | -21.3 → -30.7 | -20.4 → -28.8 |
| driving over the bridge (engine silenced) | -31.1 → -36.7 | -21.6 → -32.8 | -18.1 → -28.2 |
| Hazel's gate, while she saws | -29.2 → -32.9 | -28.1 → -32.1 | -25.4 → -29.9 |
| Pip's gate | -30.6 → -34.3 | -29.3 → -33.3 | -26.1 → -30.6 |
| the post office's yard (air and birds) | -30.6 → -34.3 | -29.3 → -33.3 | -26.1 → -30.6 |
| the music on foot, for comparison | -28.5 to -29.4 | -27 | -26 |

**The ceiling** for the whole bed, wherever you stand or drive: **-30 LUFS over any three seconds and -28 for its loudest
moment**, under the music (about -28.5) and the voices (about -22). The loud one was the creek: -22 LUFS on its bridge, 6 dB over
the music, and it jumped by 10 dB for a moment driving over it (the mixer took its level from the camera, which glides and
jumps). It is now 12 dB quieter there; its level and its place along the bed glide over half a second however the camera moves,
and the radio's likewise. The air is 3.5 dB lower (lower still in the cab), the birds 4.4 dB lower, never two at once and never
right overhead, and Hazel's saw 4 dB lower. Pip's radio and tinkering stay faint from his gate (under -50 LUFS), louder near
his cabin. Offline renders, not a listening test: the Retroid's speaker has not heard any of it.
## The owner's second play on the Retroid (2026-11-22, the whole slice)

These replace the matching lines above where they differ (the UI theme, the music and the ambience were another round's).

- **The van:** "It seems too tall still ... The turning is too aggressive and doesn't feel like there's actual weight to it. The back
  doors look like a bunch of rectangles just stuck together, not a solid door." "The van can be slower to start and wait for the
  upgrades to be faster." Now 1.7 m high (was 2.0) and 1.56 wide (1.48), the seat lowered so the seated postmaster's cap clears the
  cab's lining; each rear door is one rounded panel with one framed window pressed into it, a handle by the single seam, two hinges
  (tools/van.mjs). The feel is one table, `Van.TUNE` in entities/van.lua, which upgrades will raise: a leisurely pull-away (0 to 30
  km/h in about 6 s) and a top of about 10.5 m/s (it was 16); the wheels follow the stick at no more than full lock a second, eased,
  with less lock the faster it goes; the body's turning catches up with the wheels over about a quarter of a second; past 3.2 m/s^2 of
  sideways pull it turns much less than asked (it runs wide, gently), and it leans further for the pull it has.
- **Walking:** "the animation needs to slow down a bit and the player should be able to move faster." Walk 1.6 m/s, run 3.0, trot
  with a parcel 2.2 (were 1.15, 2.15, 1.45). The clips take longer strides (legs swing 48 degrees each way in the walk), each cycle
  longer, played at their own pace at the top of each gait, so the feet keep to the ground (tools/strides.mjs, which patches the
  model's clips in its .model.json and .glb alike). Steps are calmer than before: 0.46 s a walk cycle at 1.6 m/s (0.37 at 1.15), 0.26
  s a run cycle at 3.0 (0.23 at 2.15); legs this short cannot go slower at these speeds without sliding. Hazel and Pip walk the same.
- **The camera, on foot and driving** (asked to choose, the owner: "I do still want to have the chase camera while walking and
  driving ... like GTA V not Forza Horizon. So the player can orbit the camera but as the player drives it'll drift back to the rear
  view"; and "We can have the camera start behind the player while on foot and exiting a building"): one rule for both. The right stick
  orbits (and tilts between limits) and the camera stays where it was put while the stick was used in the last moment and for as long
  as the postmaster stands or the van is stopped; 1.2 s after the stick is let go, and only while moving, it drifts back behind the
  way of travel, slowly on foot (at most 0.55 rad/s, less at a stroll, nothing walking straight at it), quicker in the van (growing
  with speed), the drift's speed eased in and out. On foot it is high and steep like a village diorama game (42 degrees down, 14.5 m
  back, a 26 degree lens: the postmaster about a sixth of the screen, a little below the middle); driving, lower and wider. Nothing
  pushes it in: what stands between it and the postmaster or the van is cut away round them (`nova.see_through`, new in the engine).
  It starts behind the postmaster whenever the stick becomes theirs outdoors (the valley, out of the post office's door, out of the
  van, after a talk). The office's fixed view is unchanged.
- **Stutter** ("If I just walk around in a circle, there is quite a bit of stutter"): the old camera's swing-behind stopped dead the
  moment the way of walking came to face it (a 0.7 s wait), then set off again at once at a fixed turn, and its boom snapped in at
  anything in the way; walking a circle did both again and again. The new camera's turn and position change smoothly frame to frame
  (a test walks a circle with and without the right stick).
- **Prompts and residents** ("I only get an option to 'knock' even though 1 I'm not at a door, 2 I'm not trying to talk to the
  person and they keep following me"): at the van's open back and its doorway only the van's prompts show; out of doors a resident's
  prompt is Talk (or Hand over with their parcel), only close to them and facing them; Knock only at a front door with the resident
  indoors (nobody is, in the slice). A resident comes a couple of steps from their work towards their gate, turns to the postmaster
  and stays there: they no longer walk after them.

## The owner's third play on the Retroid (2026-11-22)

"We're getting close!" To change, in the owner's words:

- **Van menu:** "The game shouldn't pause when dealing with the van storage, just have the menu fade up and the user can select
  what they need. Also we can make the UI elements a little smaller. Also can we pick a different font for everything? Seems too
  generic Word document." Done: see "UI theme" (a light overlay;
  one scale, 18% smaller; one rounded face).
- **Camera:** "I don't like that the van dithers away to make way for the player." "I think we can tilt the camera down a bit
  while walking out and driving" (asked: lower and more behind, more level, with the road and horizon ahead; not more top-down).
- **Steering:** "The 'turn back to straight' when the player eases off the left stick while driving is too slow." "We can also
  increase the turn radius for the van."
- **Van shape:** "We gotta reassess the van. It looks kinda borked now and too wide. We can slim it down and use those reference
  images." The rule from here: keep the reference mail truck's own proportions (about 1 : 0.45 : 0.55 long, wide, high) and
  scale the whole thing, rather than shrinking one side at a time.

### What the third play changed (the van, its lamps, the steering, the cameras; the van's panel and the UI are another round's)

- **The van, from the reference's own proportions** (tools/van.mjs): 2.97 m long over its bumpers, 1.34 wide, 1.63 high (1 : 0.45 :
  0.55; the reference truck is about 1 : 0.43 : 0.48, ours a little shorter and taller for its length, gently chibi), wheels 0.54
  across (a third of its height). One smooth skin lofted from three explicit curves (the side's top and bottom lines, the plan's
  half-width, the cross-section), its nose and back rounded over, the windscreen's pillars rounded in plan, with everything cut into
  it (the wells, the doorways, the windscreen, the opening behind the rear doors, the two tones and the band): the car kit's approach
  (studio/mcp/makers/car/kit.mjs). From the side: a dark bumper, a blunt nose 0.74 high, a short bonnet (16% of the length) rising
  to a windscreen leaning back 12.5 degrees nearly to the roof, one flat roof with a thin lip, an upright back leaning in 6 cm, the
  underside sweeping up at 25 degrees behind the rear wheel to the step. The front wheel under the front of the open doorway, the
  rear at 70% of the length. The red band swoops down past the doorway towards the front wheel. Lightly tinted glass in the
  windscreen and the rear doors' windows: it made bodies see-through before because Nova blended a whole mesh when any of its
  vertices was see-through; now only the see-through triangles are blended (crates/nova-runtime/src/gfx.rs, `solid_first`).
- **Lamps** (the owner: "we should add lights. Taillights, headlights etc."): their own parts. Square headlamps at the nose's outer
  corners, softly lit, an amber lamp beside each; at the back a stack each side of the doors (red tail lamp, amber indicator, white
  reverse lamp); amber side markers at the front corners, red at the back. The tail lamps glow bright while braking, the reverse
  lamps light while backing up (entities/van.lua, `Van:lamps()`); `Van.LIGHTS.beams` casts two spot lights from the headlamps for
  a night to come (off in the slice). Indicators stay unlit.
- **Steering:** letting go of the stick brings the wheels back at 5 times their turn-in speed with a quick easing, and the body
  straightens with them: at 6 m/s the van runs straight 0.27 s after a full-lock turn is let go (turn-in is unchanged). Less lock
  (18.3 degrees): a 10 m kerb-to-kerb circle at a crawl (it was 9.2), 11.4 m at 4 m/s, wider still faster. The test driver
  (lib/autopilot.lua) slows before a sharp bend or turn-in and, in a three-point turn, puts the wheel over before each leg.
- **Cameras:** the van is never cut away (`see_through = false`, new in `nova.model`); on foot, when the van would hide the
  postmaster, the camera lifts (or swings) just enough for them to show past it, and eases back. Lower and more behind: on foot the
  boom rises 26 degrees from 8 m behind them with a 42 degree lens, the camera looking down 15 degrees (the postmaster in the lower
  middle, the horizon along the top); driving it rises 16 degrees from 9.6 m, looking down 7 (the van in the lower third, the road
  and the horizon ahead). Coming out of the post office they step out to the foot of the porch (4 m) and everything within 6 m of the
  camera is cut away there (the porch roof and posts), easing back to the usual 2.5 m by 9 m out.
- **The cab's sides** (the owner, on the pictures: "they would go around the wheel well and have a step in them too. We can remove the
  passenger side door and just keep it as a window"): the left doorway's foot is low (0.36 m) with a dark ribbed step inside, lower
  than the cab floor, level from its back until it meets the front wheel's well and then rising round it 7 cm clear of the lip; its
  front edge leans with the windscreen pillar, its top corners round. The right side has no doorway: one window (0.48 x 0.44 m, at
  the windscreen's height) in a dark frame with a tinted pane, the panel and the band unbroken below it.

## The owner's fourth round of notes (2026-11-22)

- **Van doors:** "they wouldn't be square, they would go around the wheel well and have a step in them too. We can remove the
  passenger side door and just keep it as a window." (Done.) "You can increase the wheelbase of the van a bit. So don't increase
  the body length but you can move back the back wheels a bit."
- **Controls** (letters as engraved on the Retroid), replacing the slice spec's:
  X: interact, continue conversation. Y: enter/exit vehicle. A: confirm items in menus. B: hold to run while walking, hold for
  handbrake while driving.
- **Walking and running:** "Walking the player shouldn't have their arms out. For running they will and turning will also tilt
  them slightly in the direction that they're turning in."

### What the fourth round changed (the controls, walking and running, the handbrake, the wheelbase)

- **Controls:** as "Controls" in the slice spec now says. nova.json's actions: `interact` (X, `pad:west`), `van` (Y, `pad:north`),
  `confirm` (A, `pad:south`), `run` and `handbrake` (both B, `pad:east`), `map` (Select, `pad:select`); `act` and `horn` are
  gone. Every prompt chip, the dialogue's continue button, the van's panel, the pause and title hints show the new letters, and the
  map's button is a small slate "Select" key of the kit. A test (`x_y_a_b_and_select_do_what_the_owner_listed_and_nothing_else`)
  presses each button where the others belong: A never talks or loads, X never confirms the pause menu or takes from the panel, Y
  only gets in and out, the map opens and closes on Select only. The routes (tools/routes/*.json) press the new buttons.
- **Walking and running** (entities/postmaster.lua): the left stick alone walks, a gentle push slowly, a push of 0.9 or more at the
  full walk (1.6 m/s), the arms by the sides. B held runs (3.0 m/s): the arms out like wings, in and out over about 0.2 s (the walk and
  run clips are mixed by speed, which eases a little quicker into and out of the run). Running, the body banks into a turn like an
  aeroplane: a roll of 0.11 rad per rad/s of turn, at most 13 degrees, eased over about a tenth of a second, level going straight, none
  in a sharp about-turn; a 45 degree change of direction banks about 8 to 9 degrees. Walking does not bank. With a parcel B is the
  trot (2.2 m/s, the arms round the parcel) and banks half as much. The dust and the light steps stay with the run; residents never run.
- **Handbrake** (entities/van.lua, `Van.TUNE.handbrake` and the `hb_` numbers): held, the rear wheels lock (they stop turning), it slows
  by 4 m/s^2 whatever the pedals do, and the brake lamps light. From 3 m/s up (fully from 7) the locked rear lets the tail step out: the
  body turns up to 70% more than the wheels ask and the sideways grip falls to 30%, easing off once the van slides 7 degrees, so in a
  bend at the top speed it settles about 10 degrees out and comes back in line when let go. Standing, it holds the van on a slope.
- **Wheelbase** (tools/van.mjs): the rear axle moved back from 70% of the length to 77% (z -0.59 to -0.79; the wheelbase 1.31 to 1.51
  m), the body's length and the front axle unchanged. The rear well and its lining follow it; the underside now sweeps up at 32 degrees
  from under the back of the wheel to the rear bumper (it was 25 degrees from further forward), and the well's lining no longer hangs
  below the swept underside. The lock went from 18.3 to 20.9 degrees, the same tan(lock) / wheelbase, so the kerb-to-kerb circle at a
  crawl is still about 10 m (the test keeps it at 9 to 10.5). Both slice orders still complete with the test driver.
- **Not checked on the Retroid:** the letters were read off the device on 2026-11-12 for the Android build; on its Linux side (Armada
  or Zaviya, gilrs) the face buttons are named by position, which may put X and Y (and A and B) the other way round there.

## The owner's fifth play on the Retroid (2026-11-22)

- "The key prompts all seem perfect!" (the letters on screen match the engraved buttons on the Linux side).
- **Music:** "The piano sounds kinda twangy and annoying still."
- **Character movement:** "We need to rethink the character movement and animations. We're getting close but how do we perfect
  it a bit? Make it more seamless and actually match up to make sure it doesn't look like the character is a stiff person
  sliding while walking."
- **Paper map:** "How can we spruce up the map? Maybe build a proper generator?"
- **Minimap:** "The direction should move when rotated to follow the players camera direction. There should be a North marker on
  the map too."
- **Road signs:** "hard to see from far away. Some of the lines don't show up almost like a rendering issue?"
- **Van:** "the turning radius while slow isn't as tight as I would hope it to be."

### What the fifth play changed: the paper map, the minimap, the road signs, the van's tight turn

(The music and the characters' movement are other rounds'.)

- **The paper map** ("Maybe build a proper generator?"): Nova has a map generator now, `map_make` (`studio/mcp/makers/townmap.ts`,
  docs/mcp.md), usable by any game: from a scene's road lines, water, buildings and trees and its terrain's heightmap it draws an
  illustrated paper map. Fernhollow's is `tools/map.mjs` (the old painted sheet in `tools/art.mjs` is gone): warm parchment with darker
  edges, fibres and two folds; the hills in soft bands lit from the north-west with faint contours; Kettle Creek as a blue ribbon with a
  darker bank and its name along it, the gorge, the lake beyond with "the lake side"; some 460 little drawn pines and round trees where
  the scene has them, thinned to a grid; Post Road as a cased cream ribbon with a dashed middle, the lanes narrower and sandier; the
  creek's bridge, the BRIDGE OUT sign and the broken lake bridge; the post office with its flag and an envelope (named), the two cabins
  and Hazel's workshop as little houses (not named, no numbers), the picnic spot, the overlook (named), the stone wall, Pip's mast; each
  road's name lettered along its curve (Post Road twice), never over another name, an icon or another road; a compass rose, a scale bar
  (0, 50, 100 m) and a "Fernhollow" cartouche over the lake. 734 x 990: one texel a pixel on a 1080p screen, where Select shows it
  nearly as tall as the screen in the kit's frame (`lib/cards.lua`), two thirds of that on the Retroid's 720p. Built for a bigger world:
  more names on longer roads, symbols thinned by the pixel, a bigger `size` for a pan-and-zoom sheet later; for now it is one sheet.
- **The minimap** ("The direction should move when rotated to follow the players camera direction. There should be a North marker"):
  the disc turns with the camera: up is where the camera looks, the roads turn under the mark, which shows the postmaster's (or the
  van's) facing against the camera's; a red "N" tab rides the wooden rim where north is (`lib/ui.lua`). It follows the camera's own
  smooth turn (no snap through south, where the yaw wraps: a test turns it through). Restyled with the kit's wooden frame round a
  disc of the paper map's meadow, the roads in the map's colours, every road's casing drawn before every fill so they join.
- **The road signs** ("hard to see from far away. Some of the lines don't show up almost like a rendering issue?"): it was a rendering
  fault. The lettering is a picture laid on each face of the board (640 x 110), and the engine gave a picture mipmaps only when both its
  sides were powers of two (or anisotropy was on), so from the van the full-size picture was read at every distance: at 25 m its 4-texel
  border line and the letters' thinner strokes fell between the samples and broke into dashes, and they shimmered as the van moved. Every
  smooth picture now gets its whole chain of mipmaps at any size, each level the average of the area it covers
  (`crates/nova-runtime/src/gfx.rs`, `smooth_levels`, `mip_chain`, with a test). The road's painted lines were checked too: they come
  from a 1024 x 1024 picture that always had its mipmaps, and they run on unbroken into the distance (their worn patches are painted).
  And the signs are made to be read: one board each way a road goes (Post Road has an arm each way at both junctions, level with each
  other; the side road's arm above), 3.6 m long (4.8 for KETTLE CREEK RD) and 0.72 m high, a light wooden rim round a dark panel (the
  quiet outline that keeps them apart from the trees), bold cream capitals 0.36 m high (0.32 on the long board) with no hairlines, the
  point showing the way, the arms at 3.0 and 2.15 m where the chase camera sees them face on. From the van at 1280 x 720 a name reads at
  25 m and 40 m, and at 60 m the board is plainly a sign (a hero tree hides part of Fern Lane's from Post Road there). Mailbox numbers are
  bigger, dark on a cream plate filling the box's side.
- **The van's turning** ("the turning radius while slow isn't as tight as I would hope"): below 1.8 m/s the wheels go over to 31 degrees
  (`Van.TUNE.lock_slow`), a kerb-to-kerb circle of 6.4 m (it was about 10: the outer front corner's circle, measured, fits between Post
  Road's edges, so a U-turn there is one sweep); the extra lock eases away smoothly by 4 m/s, where the circle is 11.4 m as before, wider
  faster; the quick return to straight and the eased turn-in are unchanged, and the wheels move a little quicker at a crawl
  (`slow_steer`), so full lock still takes about a second. The front wheels are drawn turned at most 25 degrees (`drawn_lock`): at 31 the
  tyre's back pushed through its round well. Both slice orders still complete with the test driver, which now puts the wheel over to
  the crawl's lock in a three-point turn.
- **Not checked on the Retroid**: everything above is pictures from the desktop renderer at 1280 x 720 and tests. The map's lettering
  is drawn at two thirds of its size on the device's screen; the pictures say it reads, the device has not.

### The weak points of that round, fixed (2026-11-23)

- **The map at 720p:** it was the 1080p picture drawn at two thirds, so its lettering was soft on the Retroid. Nova now tells a game the
  screen's real size, `nova.view("pixels")` (1280, 720 on the device), and the map is drawn twice by `tools/map.mjs`, each at the size it
  is shown: `ui/map_720` (482 x 650) and `ui/map` (724 x 976). `lib/cards.lua` picks by the pixel height and draws it one texel to a
  pixel with its corner on a whole pixel (a test checks both screens), so the lettering is exactly as drawn.
- **The minimap's roads:** each road is a stroked line now: soft-edged bars with a round joint at every bend (sprites made by
  `tools/art.mjs`, so a road at any angle has smooth edges and does not shimmer as the disc turns), every casing before every fill.
- **The map's shading:** the creek's cut in the heightmap was being shaded as a long dark slope. The generator shades and bands the land
  from the terrain with its water channels and banks filled in from the ground round them and lightly smoothed, draws the contours from a
  smoother copy still (a small bump had made a stray ring near the bottom right), only where the ground really slopes, and fades them
  near the sheet's edge (the land rising to the map's rim drew a ruled line by the frame). Also: trees are kept off roads and names by
  their crowns too, the scale bar and compass keep off water and roads (the bar takes the next shorter length when that finds a clear
  place: 50 m on Fernhollow's), and a road's name stands a little further from a bridge.
- **The KETTLE CREEK RD board:** one family now: every board 3.6 m; the long name on two lines (KETTLE CREEK over ROAD, 0.29 m capitals)
  on a board 1.12 m high, hung a little higher (3.2 m), the post 3.9 m.
- **Trees in front of the signs:** a rule in `tools/scene.mjs`: from every road that comes to a signpost, along its last 70 m either way,
  the line from over the road to each board passes no tree's crown (a test checks it from the scene file, crowns measured from the
  models). Every approach was looked at from 60 m.
- **Measured distances:** `tools/routes/signs.json` places the van, measures the camera-to-signpost distance and corrects it, and logs
  it: 10.1, 25.0, 40.0 and 60.0 m (12.4 m was the nearest from the south at the Kettle Creek junction: the van is then at the junction).
  Measured from the driving camera at 1280 x 720: every name reads at 25 m and 40 m; at 60 m each board is plainly a sign, and FERN LANE
  can still just be read.
- **The lettering test:** it checks the mip level the GPU reads from the driving camera at 25 m (level 4) and 60 m (level 5): at 25 m
  at least three quarters of the lettering's solid area must stay solid (this lettering keeps about 0.9; the lettering before the fifth
  play kept 0.17, so the test would have caught it).
### What the fifth play changed: walking and running (the movement and the animation)

"It doesn't look like the character is a stiff person sliding while walking." Measured first: the old clips, played by time at a
rate chosen from the speed, had the sole that touched the ground slide 17 to 60 cm a step (at a creep worst of all); the chibi's
straight legs swung so that the foot on the ground was the one coming forward.

- **Played by the ground covered** (Nova: the animator's `by = "distance"`, docs/project-format.md): the walk, run and trot move on
  by the metres walked over each clip's stride (`"stride"` in the model file, written by character3d_make and tools/strides.mjs:
  0.728 m walk, 0.765 m run, 0.664 m trot), mixed by speed, one cycle shared by every state, so B pressed or let go and a parcel taken
  or set down carry on with the same foot. Below the walk the stride shortens with the speed (short steps, not slow motion).
- **Feet that keep to the ground** (Nova: `nova.gait`, `crates/nova-runtime/lua/gait.lua`): each foot is fixed where it lands; each
  frame the one-piece leg is turned from the hip to reach it (a foot behind rolls onto its toe, one in front lands on its heel, the
  leg may lengthen or shorten up to 12% and 16%); the hips sit as high as the feet allow and dip 2 to 3 cm as a foot lands, sway and
  roll over the standing foot, the shoulders turn against them; a stop finishes the step in the air and brings the other foot up;
  a turn on the spot shuffles. On the porch and the bridge's deck the postmaster is drawn lifted as one by the ground under him, so
  the creek's bank under the bridge no longer bends him.
- **Weight:** the speed is a critically damped spring (0.15 to 0.3 s to the full walk, longer to the run, a settle of about 0.25 s to
  a stop, longer from a run); the body turns at a limited rate with the head looking first, goes the way it faces (up to 78 degrees
  off it while turning), and a turn right back brakes nearly straight, then pivots: it never slides backwards facing the wrong way.
  It leans into setting off and back as it stops.
- **Life:** springs (`follow`) on the head (lags and nods), the fox's ears, the tail (swings out of a turn), the satchel (now its own
  part), the mittens (a follow-through at each arm swing) and the arms out in the run; standing a while, a look round or a shift of
  weight now and then. Hazel walks at 1.25 m/s with a heavy rolling gait (more roll and sway, little bounce, a slower beat); Pip at
  1.6 with a shorter stride (a quicker beat), a big bounce, high feet and long ears that trail and flop. The ears are parts of their
  own now (character3d_make).
- **Measured** (tests at the end of crates/nova-runtime/tests/mountain_post.rs; the sole as drawn, its point on the ground followed
  frame to frame): at every stick tilt from 0.2 to full, the run, the trot, starting, stopping, run to walk and back, turning at a
  walk and a run, a turn right back and a turn on the spot, no standing sole slides more than 0.6 cm in a step, most under 0.2 (the test allows 1.5);
  up, down and across the steepest open hillside near the road, up the porch steps and onto the bridge, under 1.5 cm. Pictures:
  `build/gallery/` (made by the agent, not committed).
- **Not done or not checked:** nothing is tried on the Retroid yet. On the porch's 15 cm steps a straight 20 cm leg cannot stand on
  two steps at once: the hips jump less than before but a toe can poke into the next riser for a frame. The probe's "slide" is the
  model's own drawing; the per-vertex hill lift (the renderer) shears the body a little on a steep slope.

## The owner's sixth play on the Retroid (2026-11-23)

"You can fix the rough spots. Go for it." Their notes, in their words:

1. "Truck Storage UI: The popup currently blocks the player. Let's have the UI appear a little smaller (we can leave the text
   size but remove some of the bulk in the UI) but make it appear floating above the truck doors. So it'll technically move
   with the camera to remain above the doors. The maximum capacity for the truck storage should be 4 parcels for now. We'll
   work on upgrades later. If nothing is in the truck, we can have that show in the floating popup."
2. "Truck rear windows are only one way windows for some reason."
3. "Truck bed doesn't cover the full area. I can see the grass through it."
4. "We don't need to have the circle cut through other characters or the truck if the player is hidden behind them."
5. "Can we add a subtle texture to the grass? I liked how BoTW did it. Shouldn't be too expensive right? Same feedback for
   the trees, they just look like blobs now."
6. "Let's fix the building generator to keep a consistent look. I want it to be a little more rounded."
7. "Let's remove the messenger bag that the main character has. Also by default let's have the character wear pants not a
   skirt. Can we also attach the arms and legs to the characters. They still look like separate pieces."
8. "The character's outfit looks like a police officer with the blue outfit and the badge. Let's rethink this a bit but I
   think we're close!"
9. "Let's make the character facial features (eyes and mouth) a little bit bigger. Almost anime style but not that huge."
10. "There's a weird rectangular piece atop the van. I don't think we need it?"
11. "Let's tweak the truck controls to be more engaging. We should show the drive selection in the bottom left. Default is
    Park. We can make the truck function like a real automatic with PRNDL gear selection. A will go 'up' a gear. X will go
    'down' a gear. Park, Reverse, Neutral, Drive, Lower (for those tougher hills). Brake (LT) just operates as brake. The
    vehicle should be in brake when switching between P, R, N, D. The vehicle can move between D and L freely. We also need
    to add a non-annoying reverse sound when the van is in R. There should also be a handbrake indicator near the drive
    symbol in the UI."
12. "Pressing start should actually pause the game."
13. "Pressing Select for the map should actually pause the game."

Settled by the owner: "A towards L, X towards P". The gear column reads P R N D L top to bottom; A steps down toward L, X
up toward P. Decided by the coordinator: the horn, displaced from X, moves to the left stick click (L3) while driving.
Decided by the coordinator where the notes left room: "up" a gear moves toward P (P R N D L, as a real column shifter reads
top to bottom), "down" toward L; the horn, displaced from X, moves to the left stick click (L3) while driving.

### Sixth play, the UI half (notes 1, 4, 12, 13 and the minimap's rim)

- **The van's panel floats over the doors (1):** `lib/ui.lua` `ui.van_panel`, placed by `Valley:panel_anchor`: the point in the middle of
  the rear doorway 0.3 m over the roof line (van metres 0, 1.9, -1.45) is projected to the screen every frame by `camera.project`
  (`lib/camera.lua`: the eye, target and lens the frame was set with; no engine call was needed) and the panel stands on it, bottom
  centre, a small tail pointing down, clamped whole on the screen, the anchor eased (16 per second) so it does not jitter. Seen from
  the front, where the point would land on the postmaster, it stands over their head instead. Same text sizes, a thinner frame
  (scale 0.34), no title strip: a small red "Van 2/4" tag (held over capacity) on its corner. Three states: parcels in the van (one
  line, the name and the street, "A Take", with more than one "1 of 2" and L1 / R1), a parcel in the arms ("X Load package"), and an
  empty van ("The van is empty", "Van 0/4"). The bottom-right "Load package" chip is gone while the panel is up. Nothing is locked.
- **Capacity 4:** `state.VAN_HOLDS = 4` (an upgrade will raise it). A fifth parcel is refused when X is pressed: the panel's line turns
  red, "The van is full", for about two seconds, a low tick, and the parcel stays in the arms.
- **Nobody is cut (4):** residents, the postmaster, the driver and what they carry are drawn with `see_through = false`, like the
  van (the scene sets it on the residents' and the postmaster's option tables when it starts: their own files stay as they were);
  only scenery is cut. The camera's dodge (`camera.DODGE`) now also treats each resident as a cylinder (0.42 m, 1.7 m) between the eye
  and the postmaster, and lifts or swings round them as it does for the van.
- **Start and Select stop the world (12, 13):** the cause was that nothing ever called `nova.pause`: the card was drawn and the
  scene's update went on running everything. Now while the pause menu or the paper map is open (valley and post office) the scene
  calls `nova.pause(true)` (entities, animations, the engine's clock: wind, clouds, water) and returns early from its own update: the
  stick and the camera are not read, the scene's clock, the ambience's timers (the birds), the doors and the panel's fade stand, the
  van's engine is silenced. The music goes on, **ducked** (its `quiet` level, 0.8 of the usual: 0.24 outdoors), not stopped; its
  layer timers do not advance (its `quiet` input already holds them). Closing the card resumes from the same moment.
- **Minimap rim:** the roads were cut flat at the meadow's edge. They are now cut a little further out (62) and the disc's rim
  (`sprites/ui/minimap_rim.png`, made by `tools/art.mjs minimap`: the paper edge and the wood, nothing inside) is drawn over them, so
  they run under the frame.
- Pictures (made by the agent, not committed): `examples/mountain-post/build/gallery/final/`. Not checked on the Retroid.
Decided by the coordinator where the notes left room, and then by the owner: A steps toward L (down the column), X toward P (up);
the column reads P R N D L top to bottom. The horn, displaced from X, moves to the left stick click (L3) while driving.
### What the sixth play changed: the buildings' one look, the signs, the bridge's far half, the map's small print, the bass (note 6 and rough spots)

- **One house style** (`tools/models.mjs`, the `HOUSE` object and the helpers made from it: `plinth`, `walls`, `gableRoof`, `leanRoof`,
  `windowAt`, `doorAt`, `porch`, `chimney`). Every box edge of a building is rounded by the one radius, 16 cm (0.4 of the thin side
  where that is less; before: a quarter of it, 14 cm at most); the roofs are soft thick plates (22 cm) of one pitch (rise 0.6 of half the
  span) overhanging 45 cm with a rounded ridge cap, porch and shed roofs are plates of the same thickness and overhang that fall 45 cm;
  every house stands on a rounded stone plinth sticking out 15 cm, with cream corner boards 24 cm square and board lines every 32 cm
  (the log cabin too: its wall is a painted board wall in the log colour, no longer a stack of cylinders); windows are 1.1 x 0.95 m
  of glass in a 13 cm cream frame with a cross of 6 cm bars and a sill; doors 1.1 x 2.15 m in a 14 cm cream frame; porch posts 18 cm
  square and cream; fence, gate and barrier posts the same 18 cm in wood; rails 10 cm; chimneys a stone stack, a cap and a dark flue.
  The workshop is a shed on four posts on little stone footings; the mast has a plinth in small; the bridge's rails and posts are the
  fence's. Colours only from the palette (`tools/palette.mjs`; the off-palette paper, wall and dust colours are now shades of it).
  New buildings should be made with these helpers. Heights, doors and decks are where they were (the scene's decks, the chimneys'
  smoke at 6.5, 5.8 and 4.9 m, the sign board and the BRIDGE OUT board), so nothing else moved. Test
  `the_buildings_share_one_house_style_rounded_and_in_the_palette`.
- **Signposts** (`tools/layout.mjs` SIGNS `turn`): a board pointing along its road is edge-on from that road, so each arm is swung off its
  road's line (at most 40 degrees, chosen by a search over the turns that keeps the arms 50 degrees apart) until every board, from
  every road that comes to the post, 25 m out, is seen at 30 degrees or more (before, Kettle Creek's Post Road boards from the south:
  5 to 11 degrees; now at least 30). The sight-line rule for trees follows the swung arms. Test
  `every_signpost_board_is_seen_at_a_readable_angle_from_each_approach`.
- **The old bridge's far half** (`tools/scene.mjs` BRIDGE_VIEW): no forest mass stands in the corridor from the BRIDGE OUT barrier to the
  far ruin (5 m either side at the barrier, 16 m at the ruin, and 6 m past it); one mass at the far rim was left out. Test
  `no_forest_mass_hides_the_old_bridges_far_half_from_the_barrier`.
- **The paper map's small print**: `map_make` gained `text_min` (px; the subtitle and the scale's numbers grow to it, a name that finds
  no room is left out rather than shrunk below it, and every placed word reports its `px`); both maps are made with 16 (the subtitle and
  the scale's numbers were 13 px on the 720p map; now 16, the place names 16, the roads 18); the names were laid out again (the
  road names repeat sooner, "the lake side" moved west of the cartouche) so every word is still there.
- **The bass layer on a small speaker** (`tools/music.mjs`): measured with `sound_report` on the bass stem alone, before: 36 % of its
  energy under 80 Hz, 77 % under 200 Hz, 6.1 dB quieter through a small speaker (with the report's warning); after: 4 % under 80 Hz,
  44 % under 200 Hz, 2.6 dB quieter, no warning (spectral centroid 150 -> 275 Hz). The low voice is still a saw, opened from 380 to 560 Hz,
  with its fundamental cut (a parametric EQ dip at 60 Hz, 9 dB) and a lift at 250 Hz; a second voice, the same line an octave up (a saw
  at 640 Hz), carries the 2nd and 3rd harmonics. The five stems are still the same length and in step. **Nobody has listened to it**:
  these are numbers from the offline render and a model of a small speaker (a 200 Hz high-pass); the owner's ears on the Retroid are the test.
### What the sixth play changed: the cast (notes 7, 8 and 9, and the rough spots of the walk)

- **No bag** on the postmaster (its part, its spring and its strap are gone; the parcel is still carried at the chest).
- **Trousers by default** (character3d_make, every character): the seat of the trousers and two short legs with a turn-up, in the
  trouser colour; a skirt only with `skirt: true` (a robe is a dress). Hazel's apron is painted over her green trousers.
- **Limbs joined to the body**: the top of each arm and leg is a ball round its own pivot, sunk 2 to 5 cm into the body (rounder
  shoulders on the torso take the arms' balls), so a turn of the limb never opens a gap, the sleeve runs out of the shoulder and
  the trouser leg out of the seat. Tested in every clip and every gait pose (walk, run with the arms out, trot with a parcel, sitting
  in the van, the legs stretched and squashed): the pivots never move on the body.
- **The outfit** (note 8): three options pictured in the valley at the game's camera (`build/gallery/outfit-options-*.png`, made by
  the agent, not committed): A a moss-green cardigan with no hat, B a mustard cardigan with a rust bucket hat, C a rust cardigan with
  a moss round cap; all with a cream shirt collar, an envelope patch, wooden buttons, brown or khaki trousers, no belt, no badge.
  **Chosen: B.** Mustard stands out against the grass, the road and the fox's own orange at eight metres (the moss green sank into
  the grass, the rust into the fur), and the soft hat with its envelope pin says "the post" where no hat said only "a fox"; the ears
  still stand up beside it. Nothing of it reads as a uniform: knitted, warm-coloured, a floppy brim.
- **Bigger faces** (note 9): the eyes are about a quarter wider and a third taller (taller ovals), set a little higher and further
  apart to stay clear of a snout or a muzzle, with a bigger glint and a second small one; the mouths a fifth bigger; the brows ride
  higher (the frown's inner end had been cut off by the eyes' patch before).
- **Upright on slopes**: the cast is drawn lifted as one by the ground under its own place (`lift = "origin"`), the gait given the
  whole ground from there, so a hillside no longer shears the body; the feet stand on the slope where the gait puts them.
- **The porch steps**: each foot lands wholly on one tread (with room for the toe roll), a foot in the air keeps its whole sole over
  the ground, a straight leg too short to lift its foot onto the step above swings it forward (going down, on the way it is), and a
  standing foot the leg can no longer reach is swung back clear of the riser. Measured over every point of both soles every frame,
  up and down at a walk and a run: under 1.2 cm into any step (it was 15 cm, a whole riser, at a run).
- **Not checked**: nothing on the Retroid yet. A flat foot on a steep hillside still meets it at the middle of its sole (the toe
  can dip up to 3 cm into an uphill slope, the test's limit; grass hides most of it). Painted edges (the collar, the patch, the placket) show a pale
  rim at the game's distance: the decals' see-through texels bleed when the texture is minified.

## Feedback for later (the owner, 2026-11-23)

Given as "more feedback for later": not started yet; to pick up after the sixth-play work is merged and installed.

1. "We can remove the button chips from the UI entirely. We can have a 'Controls' option in the main menu."
2. "The package station in the post office." (To ask: what should change about it.)
3. "Subtle feedback when shifting gears correctly/incorrectly."
4. "Little faces next to the residents' names."
5. "Character carrying the parcel. The parcel should move with the player's arms."
### What the sixth play changed: grass, trees and the creek (note 5, and the creek's rough spot)

"Can we add a subtle texture to the grass? I liked how BoTW did it. Shouldn't be too expensive right? Same feedback for the trees,
they just look like blobs now." An original painted look in that spirit (no assets of that game's), kept a soft toy diorama:
rounded, chunky, flat-ish painted colour, textured but not realistic. Nova now has **painted surfaces** (docs/project-format.md,
"Painted surfaces"): a surface says it is ground, foliage, canopy or water, and the plain look's shader paints it from one small
repeating picture of noise the engine makes (`gfx/paint.rs`), read a few times a pixel; its mip levels calm a pattern where it would
be finer than a pixel.

- **The grass** (`entities/valley_ground.lua`, `paint = "ground"`): big soft patches of warmer and cooler green (about 20 m and 7 m),
  and near the camera painterly dabs of lighter and darker green about a metre long with finer blade streaks, laid one way here and
  another there; they fade to the calm colour by about 20 m from the walking camera, and nothing shimmers on the 1280 x 720 picture.
  Slopes facing the sun are a little warmer and lighter, those turned away a little cooler; hollows are darker and rises lighter
  (`lib/world.lua` `ground_color`, shared by the ground and the banks). No grass tufts were added (the groundcover already plants
  grass near the roads; a tuft layer was not needed for the look and would cost draws).
- **The trees** (`tools/nature.mjs`, regenerated): broadleaf crowns are a few leaf clumps, each a ball with bulges of its own; pine
  and larch tiers have uneven, ragged rims whose tips droop by different amounts; every leafy shape is painted as foliage (leaf
  clumps bend the light, leaf dabs of about 18 cm, a darker core where the crown faces in or down, a sunlit rim, the sun wrapping
  softly round it; the pattern is fixed to the tree, so it sways with it). The far versions (`pine_far`, `larch_far`) are two ragged
  tiers painted the same, so the switch at 110 m does not change the look. The forest masses are clumps too, painted as canopy, the
  pine-green ones drawn up into soft spires so the scalloped edge reads as conifer tops. No crown reaches further than before (the
  signs' sight lines are measured from them). The same recipe is in Nova: `prop3d_make` with `style: "painted"` (tree, pine, bush),
  and `ground3d_make` with `painted: true`; both opt-in, so Pine Ridge Rally and every example are unchanged (`scripts/rally/verify.sh`:
  563 files identical).
- **The creek** (`entities/water.lua`, `paint = "water"`): ripples stretched along the flow move downstream, the sun glints on them and
  the sky shows at a slant; the shallows are lighter, foam lines run along both waterlines and round the bridge's trestle posts. The
  waterline was a row of steps: the valley's 4 m squares were lowered round the water, and the heightmap's 2 m cells cut the channel's
  sides into a saw. Now a strip of finer ground lies along both banks (0.5 m across round the waterline, painted as ground, darker
  where wet), on the heightmap smoothed along the stream, and the 4 m squares are left out under it: the waterline wanders by under
  0.18 m from one row to the next (0.37 m on the plain heightmap; a test checks it).

Triangles per model, before and after: pine 318 / 408, pine2 408 / 528, pine3 318 / 408, pine_far 100 / 180, larch and larch_small
368 / 488, larch_far 100 / 180, birch 516 / 694, bush and bush2 360 / 400, forest_long 294 / 528, forest_tall and forest_round 252 / 448.
Per frame (shadow passes included, `nova.perf().triangles` in `tools/routes/nature-bench.json`): the driving view on Post Road
261,000 before and 332,000 after, the walking view in the meadow 202,000 and 253,000, the far valley 186,000 and 226,000. Of the
increase about half is the trees and masses and half the creek's banks and finer water (the banks are one mesh, never culled).

**Cost.** On the Retroid (`scripts/handheld-bench.sh`, the camera-turn route, 2,000 frames each, the same engine with the old and the
new game): the GPU's mean time a frame went from 6.99 ms to 7.36 ms (+0.37 ms, each mean of 33 one-second readings with a spread of
about 0.5 ms; measured with the banks a row every 1.5 m, before they were thinned to every 3 m, so the final build is a little
cheaper), Lua unchanged (5.3 and 5.1 ms); both at a steady 60 fps. (The GPU readings at a capped 60 fps depend on the clock the
driver picks, so they are higher than the 5.3 ms measured before; the difference between the two runs is what counts.) Entering the
valley takes about 180 ms longer on the device (the banks are made in Lua at the first frame). On a desktop (Apple M4, the world drawn
at 2160 lines so that the pixels' work dominates; `tools/routes/nature-bench.json`, the best of three runs): the render time a
frame went from 11.9 to 13.5 ms walking, 12.1 to 13.6 driving, 12.0 to 13.1 on the hillside, 10.7 to 11.8 over the far valley and
12.1 to 13.8 at the creek: about 1.1 to 1.7 ms at nine times the device's pixels, so 0.12 to 0.19 ms at 1280 x 720 on that GPU.
(Desktop runs vary by about a millisecond between runs while other work runs on the machine; Metal there gives no GPU timer.)

**Pictures** (1280 x 720, the same views before and after, `build/gallery/`, not committed): `nature-before-after-1.png` and `-2.png`
(each row before on the left, after on the right: the meadow from the walking and the driving camera, the hillside, the far valley,
a birch and a pine close up, trees at 20 and 50 m, the forest masses, the creek at the bridge and upstream), each also as
`nature-<view>-before.png` and `-after.png`; `nature-models-after.png` (the trees and masses one by one) and `prop3d-painted.png`
(prop3d_make's low and painted tree, pine and bush). The route is `tools/routes/nature.json`.

**Not checked:** how it looks and feels on the Retroid's screen in motion (strokes crawling or not as the camera turns, the water's
speed); the owner should look at the grass from the walking camera and at the creek from the bridge.

## The post office room (the owner, 2026-11-23)

"There should be a full width counter at the back of the office where the packages will be. Only one package per square
'tile' of countertop. Obv to start there are only two packages, but when we code the actual game, there will be a backlog to
deliver. We can have a 'picture frame' at the back wall above all the packages that has the total number of packages to
deliver. I'm imagining that eventually there will be more packages than just the ones that are on the package counter. We can
have a small conveyor belt 'window' to show that there is a potential 'backroom'.

In front of the package counter, we should keep the existing counter that's already there. We can put a little desk mat,
stamp, some envelopes, and an old computer where the user can perform upgrades. We don't have to make the PC interactable just
yet."

The owner, 2026-11-23: "We need to add creep for D R and L." (idle creep like a real automatic: off the brake in D, R or L the
van eases forward or back at walking pace; none in P or N.)
