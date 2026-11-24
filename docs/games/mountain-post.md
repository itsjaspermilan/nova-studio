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

**The conversations** (text boxes, a babble voice per character; the player's lines are not shown). Rewritten after the owner's
seventh play ("Too much text", "pacing", "tone of the words"): three lines at the hand-over, one line each time they are talked to
again (the two "after that" lines take turns), one at the door without the parcel; warmer, shorter, the facts kept lighter (the
bridge out, the Mayor, Pemberton). The braces are the engine's text markup (`nova.ui.rich_text`, docs/project-format.md "Rich
text"): `{slow}` typed slowly, `{big}` larger and bolder, `{wave}` letters bobbing, `{shake}` jitter, `{pop}` letters popping
in, `{pause=s}` a wait; used where a line has a feeling to carry, not on every line. The face for each line is in brackets.

Hazel, when handed her parcel:
- "Hm. So there {slow}IS{/slow} a postmaster." (gruff)
- "My chisels. Ordered them the winter Pemberton shut up shop and the lake bridge went." (sad)
- "I'd fix that bridge, if the Mayor and I were speaking. We're not.{pause=0.3} {slow}...{/slow}Thank you." (smile)

Hazel, after that (talk again): "Still here? Mind my wall on Fern Lane. Everybody clips it." (dry) / "Tell Pip his aerial
{shake}hums{/shake} through my teeth." (gruff)

Pip, when handed his parcel:
- "{big}{wave}IT CAME!{/wave}{/big} It actually came! You're {pop}real!{/pop}" (delighted)
- "A whole year I told the radio the mail was coming back. Nobody believed me!" (indignant)
- "This valve gets Fernhollow Radio past the creek. The lake side too, once there's a bridge!" (happy)

Pip, after that: "Tonight I say your name on the radio. {shake}Live.{/shake} No pressure!" (surprised) / "If Hazel asks, the
aerial {wave}sings{/wave}. It does {big}not{/big} hum." (indignant)

If you knock without their parcel: Hazel: "Unless that's my chisels, I'm busy." (gruff) Pip: "Is it here? Is it?{pause=0.3}
...Oh. Hello anyway!" (surprised)

~~The first conversations (replaced after the seventh play):~~ Hazel's five lines were "Hm. So there IS a postmaster." / "Chisels.
I ordered these two winters back. Built a whole porch without them." / "Pemberton never lost a parcel in forty years, then one
morning he just didn't open up. Same winter the lake bridge went." / "I'd have rebuilt that bridge myself, if the Mayor and I were
speaking. We're not. Don't ask." / "...Thank you. Mind the left on Fern Lane. Everybody clips my wall."; after that "Still here?
The wall's fine. Mostly." / "If you see Pip, tell him his aerial hums through my teeth." Pip's were "IT CAME! It actually came!
You're real!" / "I've been telling everyone on the radio the mail's coming back. Every morning. For a year. Nobody believed me!" /
"This valve means Fernhollow Radio can reach past the creek again. Maybe even the lake side, when there's a bridge." / "Hazel says
my aerial hums. It does not hum. It SINGS." / "Tune in tonight. I'm going to say your name. What IS your name? Never mind, I'll say
'the Postmaster'. Sounds grander."; after that "Testing, testing. Can you hear that? No? Good, it's not plugged in yet." / "If Hazel
asks, the aerial is staying."

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
  horn.~~ (replaced 2026-11-23, the sixth play) ~~In the van X moves the lever one gear towards P.~~ (swapped by the owner, 2026-11-23) In the van X moves the lever one gear towards L.
- **Y** (left) gets into the van at its left doorway, and out of it when it has stopped.
- **A** (right) confirms in menus only: Start on the title, the pause menu's choice, and Take in the van's parcel panel (a menu).
  ~~In the van (the sixth play) A moves the lever one gear towards L.~~ (swapped by the owner, 2026-11-23) In the van A moves it one gear towards P.
- **The van's lever** (the sixth play: an automatic with PRNDL; ~~P R N D L~~ replaced 2026-11-23 by the ninth notes, "We can remove the Neutral gear and the Lower Gear": **P R D**): ~~A steps toward L, X toward P~~ ~~X steps toward L (along the row P R N D L), A toward P (swapped by the owner, 2026-11-23)~~ **A steps toward D (P, R, D), X toward P**; the column
  reads P R D top to bottom. ~~Shown bottom left beside the minimap~~ (replaced: "We should move the PRNDL to the right along
  with an analog speedometer") it is shown in the bottom right with an analog speedometer (~~0 to 40 km/h~~ 0 to 100 km/h since "the speedo should go to 100 km/h but the van caps out at 40 since there are no upgrades yet": Van.TUNE.cap holds D at 40 km/h on the flat, L at about 23; the minimap's frame, a
  soft red needle, eased; backing up it shows the speed it backs at). ~~The PRNDL panel beside the dial, with X and A glyphs,
  and the handbrake lamp in the dial's foot~~ (replaced: "merge them in a nice UI way. Not just two separate shapes"; "We don't
  need the button chips there either") it is ONE round instrument: the gears a row ~~P R N D L~~ P R D in the dial's foot (the current
  one on the red key), the handbrake's "(P)" warning light over the hub, bold dark ticks, the needle resting on a peg below the
  0; no button glyphs. The prompts stand above it while driving (lib/gear_hud.lua). It is in P each time someone gets in, and left in P on getting out.
  ~~Among P, R, N and D it moves only with L2 held and the van all but stopped (under 0.5 m/s); otherwise a soft click and "Hold
  the brake to shift".~~ (replaced: "We can remove the brake requirement honestly") It moves at once with no pedal; the one guard:
  never into P while moving faster than 1 m/s, nor into R while going forwards faster than that (a soft click and "Stop to
  shift"). P holds the wheels; R backs up on R2 (a soft reversing beeper sounds every 1.2 s, only in R); ~~N rolls free, down a
  slope too~~ (no N now); D drives ~~L pulls harder, brakes on the engine and tops out at about 58 % of D~~ (no L now: D keeps its behaviour). Each shift is a
  gentle clunk. **Creep** ("We need to add creep for D R and L"): in D and R (~~and L~~) with the pedals up the van creeps at idle, ~~built
  up over about a second and a half~~ and, since "the creep should start sooner technically" (the ninth notes), it starts at once: the force builds in about 0.3 s
  (two eases of Van.TUNE.creep_build 0.12 s, so the acceleration never jumps), the van moves visibly within half a second and is at 1 m/s in about a second: about 1.25 to 1.35 m/s on Post Road in D, 1.0 backwards in R, a little slower on
  the grass; D slows on a climb (and rolls back on a very steep one). Any touch of L2 or the handbrake
  takes it away and holds a stopped van still; P never creeps. A creeping van is moving: Y gets out once it is stopped on
  the brake or in P (Van.TUNE.creep, creep_pull, creep_band, creep_build, creep_brake).
- **L3** (the left stick's click) sounds the horn while driving (it was X).
- **B** (bottom), held: on foot, run (the stick alone only walks); driving, the handbrake (the rear wheels lock, the van slows firmly,
  in a bend at speed the tail steps out a little; standing, it holds the van still on a slope; the brake lamps light).
- **Select** (the minus button) opens and closes the paper map. **Start** pauses (resume, quit). **L1** / **R1** go round the
  parcel card, or the van's panel at its open back. **R2** goes (forwards in D, backwards in R), **L2** brakes
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
  ~~Cream above, sand below~~ (replaced: "Also let's make the van blue with a red stripe") a soft mail blue above (PAL.mailBlue), a deeper blue below, one red band between that sweeps down along the bonnet; cream FERNHOLLOW POST letters; a chunky tailpipe under the rear bumper on the driver's side puffs soft exhaust while the engine runs (from getting in until getting out: "We should add a tailpipe with exhaust for the truck"). The cab is **open-sided**: a tall rounded
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
- **Spacing (one scale, after the owner's sixth play: "some padding is too tight, and some is too large"):** every gap, padding
  and margin in `lib/ui.lua`, `cards.lua`, `dialogue.lua` and `gear_hud.lua` is one of five named steps, `ui.SP`: **xs 4, s 8,
  m 12, l 16, xl 24** (units of the 540-line screen, times `ui.S`); a test refuses a raw `+ s(n)` added to a position in those
  files. The rules (`ui.PAD*`, `ui.GAP`, `ui.EDGE`, `ui.FRAME`, `ui.box`, `ui.inset`):

  | Rule | Value | Used by |
  | --- | --- | --- |
  | `PAD` (inside the frame) | m across, s down | text panels: the parcel card, the van's panel, the pickup tip, the pause menu's buttons use PAD_LONG's across |
  | `PAD_SMALL` | s across, xs down | prompt chips, the "Stop to shift" slip |
  | `PAD_LONG` | xl across, m down | running text: the dialogue box, the letter, the end card, the pause menu |
  | `GAP` | s | an icon or a button to its word (chips, panels, tips); between chips s |
  | row gaps | xs between lines of one block, s between blocks | the card's three lines, the panel's rows, the letter's rule and paragraphs (l between paragraphs, xl before the signature) |
  | `EDGE` | xl | the screen's edge to a corner element: the parcel card, the prompt chips, the minimap, the instrument, the dialogue box |
  | `FRAME` | big 0.5 (cards, dialogue, letter, menus, the map's frame), small 0.36 (chips, tips, the van's panel, the slip), key 0.45 (title strips, name tags) | `ui.panel`, `ui.key` |
  | `RADIUS`, shadow | m; the shadow is xs across and s down | `ui.panel` |
  | tags and strips | name tag: l either side, s above and below; title strip: xl either side, s above and below | `ui.tag`, `ui.title_strip` |
  | the instrument | the gears are xl apart; the chips stand s above it; the slip is s clear of the dial | `lib/gear_hud.lua` |

  The padding is measured inside the frame's wood (`ui.inset(k)`: 16, 16 and 24 pixels of the kit times the frame scale), so a
  panel's size is `ui.box(content_w, content_h, pad, frame)` and its text is never nearer than `s` to the wood, nor short text
  further than `xl` from it (the test `text_keeps_the_scales_distance_from_every_panels_frame` measures the drawn words of the card,
  the van's panel, the tip and the slip). Changes against the first design: the chips were 32 high with 17 either side of a
  text-only word and now come from the rule (a little taller, s either side of the button); the corner card grew its padding
  from 12 to the rule and lost its fixed width (it is `ui.box` round a 180-unit text column); the van's panel and the tip were
  hand-placed (their lines 17 and 22 apart, the tip's name 9 from its top and its word 6 from the bottom) and are now laid out
  from the content; the slip's 14 either side is s plus the frame; the dialogue box was 142 high with its text 24 down and is now
  120 with m down; the letter's margins went from 36 to the frame plus xl; the end card (150 high, its words 44 down) and the pause
  menu (230 high, 52 down) shrank to their content; the map frame's picture is xs inside the wood; the instrument's gears went from
  14 apart (keys 17 wide: they touched) to xl.
  A title strip sits across a panel's top edge, half over it.
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

The owner, 2026-11-23: "We can remove the brake requirement honestly." (shifting needs no brake; only shifting into P or R while
moving faster than about 1 m/s is refused.)

The owner, 2026-11-23: "I do want to keep the PRNDL UI on screen." The gear display stays whenever driving; removing the button
chips later (feedback for later, item 1) must not remove it.
The owner, 2026-11-23: "We should move the PRNDL to the right along with an analog speedometer."

The owner, 2026-11-23: "We don't need the camera dodge when the player is behind the van or other characters." (the van and
characters simply hide the postmaster for a moment; nothing is cut and the camera does not move for them.)

The owner, 2026-11-23: "I also think the circle cutout comes on too aggressively. It should only be present when the camera is
really blocked by some item. Think about other games." And: "For the speedo and gears, can we merge them in a nice UI way. Not
just two separate shapes."
The owner, on the cluster: "We don't need the button chips there either." (no X/A glyphs on the instrument.)

**Done for these notes (the camera and the post office room, 2026-11-23).**
- **No camera dodge.** `lib/camera.lua` no longer lifts or swings for the van or a resident; the camera stays on its orbit and drift
  and the postmaster is hidden for a moment (`DODGE`, `person_between` gone). Neither the van nor people are ever cut away. The one
  thing left: an eye that would be inside the van's body is lifted just over it.
- **The see-through circle only when really blocked** (`lib/occluders.lua`, data `lib/occluders_data.lua` made by
  `tools/occluders.mjs` from the models' own triangles and the valley scene: tree crowns, the forest masses, the post office with its
  porch roof, the cabins, the workshop; never grass, ferns, bushes, rocks, fences, people or the van). Three lines from the eye
  (feet's end, middle, head) are walked through those shapes; the cut comes on only when two of three are hidden, or the eye is inside
  a crown or a roof. The hole is small (0.85 m round the postmaster, stopping 0.6 m short of them) and takes only what lies between;
  it fades in over 0.2 s and, once clear, holds 0.25 s and fades out over 0.3 s (`camera.CUT`). The porch roof follows the same rule.
  Indoors and in talk views nothing is cut. Pictures: `build/gallery/1_` to `8_`. Test: `the_see_through_circle_*`.
  Regenerate the data after changing a tree or building model or the valley scene: `scripts/env.sh node examples/mountain-post/tools/occluders.mjs`.
- **The front counter** is 3.1 m long (x -1.5..1.6, was 4.4): the walks round both ends are 1.85 m wide, 1.33 m clear of the
  postmaster's 0.26 m radius (was 0.85 m at the right). The computer, desk set, letter and bell moved with it. Test:
  `the_front_counter_has_wide_walks_round_both_ends_and_every_tile_is_reachable`.
- **The backroom** behind the conveyor hatch is 4 m deep with the belt running back on trestles, a rack of parcels along it, a lamp
  (and a warm point light), the hatch taller (2.3 m) and the flaps a short parted curtain. From the fixed camera only the lit
  floor and what is low on it show through (the view looks down about 35 degrees and a little to the right), and the hatch's top
  reaches the picture's top edge.
- **The counter's tiles** are raised bevelled plates (1.6 cm, 10 cm of the darker top between them) instead of flat paint, under 4x MSAA.

- **Near-camera fade** (the owner's note after the circle pictures: a big crown next to the camera filled the screen with green).
  `nova.see_through` gained `near_from` and `near_amount` (documented in `docs/project-format.md` and `nova-api.json`, GPU-tested in
  `see_through_gpu.rs`): scenery within 2 m of the eye is wholly gone, all there beyond 4 m (`camera.NEAR_FADE`, in the open, in the
  van, and out of the post office's door, where the porch fades out the same way out to 6 m), independent of the small circle. The
  circle now counts only blockers beyond that near range. An eye that would sit in or within 3 m of a tree's crown is drawn in toward
  the postmaster (`camera.PULL`: down to 0.55 of the boom, eased, held 0.5 s). Buildings are not pulled from: they fade. Test:
  `scenery_within_2_m_of_the_eye_fades_out_whole_and_the_boom_comes_in_from_a_crown`.

## The owner's notes, 2026-11-23 (evening)

1. "I thought we were removing the requirement to brake when shifting gears?" (It is removed in the build installed after
   this note; the build they played was older.)
2. "We should add a tailpipe with exhaust for the truck."
3. "We can remove the conveyor belt from the post office. Looks kinda dumb haha."
4. "Instead of creating a popup when the user picks up a package, there should be a similar floating tooltip when the player
   is near the package that shows a trimmed version of that popup. Also there should be a white outline on what the user is
   about to pickup."
5. "Let's angle the fox tail a little higher."
6. "Also let's make the van blue with a red stripe."
7. "Let's switch what X and A do while driving." (X now steps toward L, A toward P.)
8. "the speedo should go to 100 km/h but the van caps out at 40 since there are no upgrades yet"
### After the sixth play's cast: "I like the yellow outfit. Make the hat much bigger though. Fix the weakpoints" (2026-11-23)

- **The hat**: a big slouchy bucket hat in the chibi way: the crown follows the head a couple of centimetres off it from just over the
  brows to a soft dome on top, a broad thick brim (2.4 cm, a rounded edge) drooping gently all round, the whole hat tipped back so
  the brim's front clears the eyes, a bigger enamel envelope pin. Each ear comes up through an oval hole with a rolled rim, cut as
  wide as the ear swung 0.32 rad any way; the fox's ear springs now swing at most 0.25 (tested: no ear edge crosses the hat at any
  such swing). `hat_size` makes it roomier. Seated, hat and ears are under the cab's lining (the seat 2.5 cm lower, into the cushion).
- **Painted edges**: the model's picture keeps each painted block 8 texels into a 16-texel cell (the game's smaller copies average
  up to 16 texels at a time) and pads every edge with its own paint's colour; the engine's smaller copies no longer turn wholly
  see-through texels black. Measured in the game's own frames at eight metres, the collar, patch, placket and the restored pockets
  meet the cardigan with no light rim (the "pale rims" of the last report were a misreading of single-pixel golden edges in
  enlarged pictures; the padding and gutters are kept because they stop a real dark fringe at smaller sizes).
- **The porch steps**: the body's height is the floor averaged over 40 cm along the way it goes, and on and near steps the hips
  glide (at most 0.65 m/s), the straight legs flexing a little more for a moment (0.72 to 1.32 of their length), so it climbs rather
  than hops: the hips' largest move in a frame on the steps is 2.6 cm going up and 1.7 going down (7.8 cm before; the walk's own bob
  on the flat is 1.6), the walk is 20% slower on them, and a foot going up onto a step lifts higher.
- **Feet on hillsides**: each standing foot lies along the slope under it (tipped and rolled, up to 0.35 rad), its lowest point on
  the ground; on the steepest open hillside no point of a sole goes more than a centimetre into the ground, walking across or up.
- **The shoulders**: rounder, broader shoulders on the torso and a slightly bigger shoulder ball, so the arm's ball sinks 4 cm into the
  body and the crease where they meet is shallow.
- examples/starter-3d's hero is made again with the current maker (trousers, not a skirt).
- **Weak points left**: the hat's ear holes are faceted at close range (the crown's faces are cut whole; the rolled rim hides most
  of it). The stair glide is only on the postmaster (the residents have no steps on their paths). Nothing is tried on the Retroid.
- **The tail** ("Let's angle the fox tail a little higher"): the brush sweeps up behind, 25 degrees higher than before with its tip
  curling up; it still swings on its spring, is put away at the wheel, and stays behind him clear of a carried parcel.

**Done for these notes (the conveyor, and picking up, 2026-11-23).**
- **No conveyor belt.** The hatch, flaps, belt, slats, backroom and its light are gone (the models `conveyor_window` and `belt_slat`, their
  entity and scene object, the belt code); the back wall is plain right across, and the package counter is just its ten tiles.
- **Picking up has no popup.** Near a parcel on a tile a small tip floats over it (`ui.tip`, the van panel's style: paper panel, a tail
  down to a point over the item through `camera.project`, eased, clamped on the screen): the recipient's name over the street, and the X
  button with "Take". The Mayor's letter has the same tip ("Letter from the Mayor", X "Read") before the card you read. X on a parcel
  puts it in the arms (a soft paper sound; the corner card shows it); the big label card is gone. The tip fades out when you walk away or
  another parcel becomes the nearest, then comes up over that one.
- **A white outline** on the one about to be picked up (the nearest takeable parcel, or the letter): new in the engine, `nova.model`'s
  `outline = { color, width }` (documented in `project-format.md` and `nova-api.json`, GPU test `outline_gpu.rs`): an inverted hull in
  `outline.wgsl`, 2.5 px wide at any distance, not cut by the see-through, one more draw of the mesh. Pictures:
  `build/gallery/pick_*`. Tests: `a_parcel_shows_a_tip_near_and_is_taken_without_a_popup_...`, `only_the_nearest_parcel_gets_the_tip_...`.
9. "The colour scheme for the player seems a little drab."
10. "We should have some limits on how much padding UI elements get to contribute to our overall theme. I feel some padding is
    too tight, and some is too large."
11. "The interior of buildings should follow a grid system so that furniture and other items can be placed easily down the
    road."

### "The colour scheme for the player seems a little drab" (2026-11-23)

Three brighter outfits were pictured in the valley at the game camera, close and beside the blue van (`build/gallery/bright-options-*.png`, not committed): A a marigold cardigan, denim trousers, a tomato-red bucket hat and a teal neckerchief; B a sunflower cardigan, teal trousers and the tomato hat; C as A with a teal hat and a tomato neckerchief. **Chosen: A.** The marigold pops off the grass and the grey road without matching the fox's own orange, the denim legs read against the road and the fur, the tomato hat answers the van's red band, and the teal neckerchief is one bright accent; the teal hat (C) and the teal trousers (B) sank into the grass at eight metres. Nothing of it is a uniform. Hazel's shirt is a warmer rust and her trousers olive, Pip's vest sunnier and his trousers a clearer blue. The colours are `CAST` in tools/palette.mjs.
12. "Sorry flip X and A while driving again": while driving A steps toward L, X toward P (as before the swap).
13. "There's a weird bug where you can see the side windows extending past the van when you're looking at the back of the
    window."
14. On the brighter cast: "Looks too much like the paddington colours haha" (no red bucket hat with blue nearby).
## Rooms and the placement grid

The owner, 2026-11-23: "The interior of buildings should follow a grid system so that furniture and other items can be placed easily down
the road." (Later the player decorates the post office and their home.) Every interior is built this way; the post office is the first.

- **Cell size 0.5 m.** The post office is 7 x 5 m inside (the room was 5.2 deep; it is now 5.0 so the rows are whole): **14 columns by 10
  rows**, column 0 at the left wall (x = -3.5), row 0 at the back wall (z = -2.5). 0.5 m is the smallest square a person's footprint
  (a 0.5 m cell for a 0.26 m radius) and the smallest piece of furniture (a stool) fill, and it divides every wall and counter length. The
  counter tiles were 0.6 m: they are now 0.5 m, one cell each, so the package counter is just its cells. A counter's top has its own
  finer grid (`surfaces` in the room's data): 0.25 m cells for the front counter (12 x 4), the package counter's own 0.5 m cells.
- **Footprint and facing.** A piece has a footprint `size = [w, d]` in cells before it is turned, a facing `face` of 0, 90, 180 or 270
  (0 faces +z, into the room from the back wall; 90 faces +x, 180 faces -z, 270 faces -x; a quarter turn swaps w and d), and a position
  `cell = [col, row]` that is the footprint's top-left cell, so the piece's middle always lies on the grid (the object's x, z are that
  middle, its y the floor, a counter's top, or the bottom of its wall cells). A `layer` of `"flat"` is for rugs and mats: things stand on
  them and they overlap nothing; every other piece is solid to its own surface. Models are built with their origin at the middle of
  their footprint on the surface (wall things: on the wall plane at the middle of their cells, facing +z), so turning is just `ry`.
- **Wall cells.** Each wall is a row of cells along it (14 on the back wall, 10 on the side walls) by rows of `wall_step` 0.5 m up from the
  floor (6 up to the 3 m wall top). A wall piece has `surface = "wall:back"` (or `wall:right`, `wall:left`), `cell = [along, height]`
  and `size = [w, h]` in those cells: the pigeonholes are cells 0-3 at height 3-4 (1.5 to 2.5 m), the picture frame 5-7, the clock 10, the
  calendar 12, the notice board on the right wall at 1-2. The window (left wall, rows 4-6, 1.0 to 2.0 m) and the door (front wall,
  columns 8-9) are structure; their cells are in the room's grid data and the door's floor cells stay free.
- **Where it is stored: the scene file, as data.** The format has no grid field of its own (the studio's snap step is an editor setting
  and is not saved), so this uses what it has: the room object's `props.grid` (cell, origin, cols, rows, wall_step, wall_height, the door,
  the window, `surfaces`) and each object's `props.surface`, `cell`, `size`, `face` (and `layer`); props pass through untouched. The
  object's x, y, z are still written (the engine places by them) and always agree with the cell. The tool `tools/scene.mjs` writes
  them from one table, `PLACED` in `tools/office-layout.mjs`, which the models share. Nothing about the layout is in Lua.
- **`lib/room_grid.lua`** reads that data (`RG.load("office")`) and answers: `RG.place` / `RG.world` / `RG.cell_at` (cells and world
  points), `RG.cells` (what a footprint covers), `RG.problems` (a list, empty when sound: every piece on the grid, inside its surface,
  no two solid pieces overlapping on one surface, a counter's top grid on its counter, nothing solid in the door's cells), `RG.free_cells`
  and `RG.free_top_cells(room, counter)` (the free cells, what a decorating mode would offer), `RG.gap_beside` (free cells beside a piece to
  the wall: the walks round a counter's ends) and `RG.reachable` (a person's walk between two points over the floor cells, round what is
  solid, with the postmaster's 0.26 m radius). Set `require("lib.room_grid").debug = true` and the room draws its cells and footprints
  (solid red, flat blue, the door green; off by default): `tools/routes/office-grid.json`, pictures `build/gallery/grid_*.png`.
- **A decorating mode** would take `RG.free_cells` (and a counter's `free_top_cells`, a wall's free cells), let the player pick a piece with
  its footprint, move a ghost over the cells with the stick (snapping by whole cells, turning by quarter turns), colour it red where
  `RG.problems` would complain (overlap, outside, in the door, or `RG.reachable` from the door to the tiles failing), and on confirm
  write the object (`surface`, `cell`, `size`, `face`, and x, y, z from `RG.place`) into the room's data. **The player's home** is the same:
  a `grid` on its room object and the same props on each piece; only the numbers change.
- Tests: `every_piece_of_the_post_office_sits_on_the_grid_and_the_walks_stay_clear` (on the grid, inside, no overlap, the door reaches the
  aisle before each of the ten tiles, the letter's counter and the stool, 4 free cells at each end of the front counter, the free cells
  counted: 112 of 140 on the floor, 27 on the front counter's top, 4 on the package counter's).

### "Looks too much like the Paddington colours" (2026-11-23)

A big red hat on a small animal with blue near it read as that famous bear. Four outfits were pictured in the valley, close and beside the blue van (`build/gallery/own-options-*.png`, not committed), all with the marigold or coral cardigan, the big slouchy hat with its ear holes and the envelope pin: 1 an oatmeal hat with a teal band, marigold cardigan, olive-brown cord trousers, teal neckerchief; 2 a sage hat with a mustard band, coral cardigan, cream trousers; 3 a plum hat with a marigold band, marigold cardigan, sage trousers, cream scarf; 4 a moss hat with a cream band, marigold cardigan, cream trousers, plum neckerchief. **Chosen: 1.** The pale hat stands out against the grass, the road and the blue van at eight metres (the sage and moss hats sank into the grass, the plum one went dark), the marigold is sunny and clearly not his orange fur, and the teal band and neckerchief tie it together: a cheerful rambling postie, no famous red and blue. `hat_band_color` (character3d_make) colours a bucket hat's band and its ear holes' rims.

## The owner's seventh play: the interview (2026-11-23)

Judged right: the walking and running ("Feels right"), the van ("Pleasant as is"), the camera ("Good"), the frame rate
("Smooth"). To change, in the owner's words:

- **Music:** "Too repetitive." Chosen fix: several pieces (three or four) that take turns, with quiet between them.
- **Grass:** "The grass texture fades away too soon from the player's view. Is there a way to fix that in an efficient way? I
  like BoTW's grass system."
- **Trees:** "Trees look a little blobby still. Also the shadows from the trees disappear even though the tree is still in
  view. Can we do that efficiently too?"
- **Bridge:** "The bridge doesn't connect to the roads properly still. I love what you did with the roads otherwise."
- **Houses:** "The houses look barren still. Also we should have a minimum thickness to prevent stick looking things and keep
  that cozy, cartoony look. I guess because there's no texture?"
- **Signs:** "Junctions are nice! The roads blend in together well but the signs need some work. They don't always follow the
  direction of the road and the text doesn't line up properly."
- **Atmosphere:** "Something feels missing from the world and I can't pinpoint it. Maybe the fact that there's no blur and
  fading in the distance? Maybe because there's no skybox or sun visible? Maybe because there's nothing floating around the
  area, like leaves or wind strokes or something?" Asked which first: all four (sky and sun, distance haze, floating life,
  lived-in details).
- **Conversations:** "We should add some text effects to the engine. Like jittery text for scared, or all caps for excited. A
  slight animation to the letters that will add some identity to the game." Also too much text, pacing, and the tone of the
  words. "I don't like that when the text starts to appear, sometimes the text box will 'type' the word on one line then
  realize that it needs to go on the next line." (Coordinator's defaults where not specified: shorter first talks of two or
  three lines, warmer and simpler words, faster text with a press to finish the line.)

### What the seventh play changed: the bridge's joins and the signposts (2026-11-23)

- **The bridge** ("doesn't connect to the roads properly still"). Pictured close from both banks, from the walking and the driving
  camera, from the side at deck height and from above (`build/gallery/bridge-before/`), the faults were: the road came at the deck
  skewed (Kettle Creek Road's line bent 8 degrees off the deck's axis at the west end, 2.5 at the east, so the square-cut end and the
  deck's end met at a wedge); the ground at the west end stood 0.34 m above the deck and at the east end 0.34 m below it (the road's
  profile fell too steeply for the terrain's 11 % grade limit, so the deck, a flat average of the two, was buried at one end and
  floating at the other, and the deck's collision sloped while its picture did not); the deck was 4.6 m wide against a road lit 5.6 m
  wide, its threshold strip only 4.4 m across; the rails ended at the deck's end in mid air; and the last row of planks was
  swallowed by the bank. Now (`tools/layout.mjs`, `tools/models.mjs` "bridge", `scripts/lib/roadnet.mjs`): the road's control points run
  straight along the deck's axis (the deck's 22 m, at 20 degrees, between two control points of the road with another 10 m of straight
  line either side), the road's profile drops to the deck's level 30 m before it (ground within 4 cm of the deck at both ends and
  across its width), the deck is 5.6 m wide, the road's lit width (and the threshold strip, which now covers the carriageway and its
  lit shoulder), 53 planks laid flush to both end lines on a stone sill, and a stout capped end post on a stone footing stands at each
  corner on the bank, 0.3 m past the deck, with the rails running from post to post (`entities/bridge.lua` `half` 2.8). The van's
  body height over the deck either way (frame by frame, from 10 m before to 10 m after): no step over 2 cm a frame, vertical
  acceleration 1.2 m/s2 at most (the open gravel road: about 1). Tests `the_bridge_meets_the_road_at_both_ends_in_line_width_and_height`,
  `the_van_crosses_the_bridge_both_ways_without_a_bump`. `tools/routes/roads.mjs` pictures both ends.
- **The signposts** ("they don't always follow the direction of the road and the text doesn't line up properly"). The sixth play's
  fix swung each arm up to 40 degrees off its road so it could be read from the approaches; that is what the owner saw. Every arm
  now points along its road again (`layout.mjs` SIGNS names a road and a way along it, `scene.mjs` takes the road's direction over
  8 m either side of the post's foot; within 4 degrees, the point showing the way the road goes), and readability comes from the
  corner the post stands in (Kettle Creek's moved to the south-east corner of its junction, 3 m off the road: the least angle a
  board is seen at from 25 m, from any road that comes to a post, is 21 degrees for a board along that road and 40 degrees for one
  across it; at 12 m none is under 14) and from the lettering being on both faces (it was already; checked from the back: the words read
  the right way round, the point on the other side). The lettering's faults, found by looking from 5 m at both faces of every board:
  the words were 2.98 to 3.11 m wide on a panel 3.0 m long, so they ran into the point and off the rim; the picture's box, not its ink,
  was centred (a descender's room under capitals); the two lines of KETTLE CREEK / ROAD were centred by their advance widths. Now
  (`tools/art.mjs`, section "signs", `lib/sign_art.lua`): each picture is cropped to the ink of its words (3 texels round), the lines
  centred on one another by their ink, the capitals 0.36 m (0.29 on the two-line board) on boards of 2.5 and 2.7 m of words, the
  picture's middle put where the margin to the rim equals the margin to the point's edge (0.11 m all round, the same on every
  board), at the panel's height. Tests `every_arm_points_along_its_road`, `the_lettering_is_centred_in_each_panel_on_both_faces`,
  `every_signpost_board_is_seen_at_a_readable_angle_from_each_approach`. `tools/routes/signs.mjs` pictures every post from every
  approach and every board from both faces. Weak points: a board along the road you are on is still seen at 21 degrees from 25 m
  (the words foreshortened to a third of their length): read it from 12 m; and from the north on Post Road the Fern Lane board is 40 degrees at 25 m but 14 at
  12 m (it turns edge-on as you come on).

### What the seventh play changed: the talks (text effects, the layout, the pace, the words)

- **Text effects in Nova** (`nova.ui.rich_text`, docs/project-format.md "Rich text"): markup a writer types in a line, `{shake}`,
  `{wave}`, `{big}`, `{slow}`, `{pop}`, `{c=red}`, `{pause}`. Every letter of a talk rises softly into place with a quick fade as
  it appears (0.16 s, a fifth of its size): the game's own little animation. One quad a letter, as plain text; everything is a
  function of the line and the time, so a test sees the same picture every run.
- **Laid out before it is typed:** the whole line is wrapped first and typed into its final places, big letters' room
  included; no word starts on one line and jumps to the next, nothing reflows (test
  `the_talk_is_laid_out_before_it_is_typed_and_never_reflows`).
- **The pace:** Hazel 46 letters a second, Pip 60 (spaces count), a short pause after a comma, a longer one after a full stop,
  the longest after "..."; the babble follows the letters as they come out and the mouth moves only while they do (it rests in
  the pauses). X once shows the rest of the line at once (a tenth-of-a-second ripple), X again goes on; the "next" button fades
  in and bobs softly once the line is out. The talk opens snappily: the camera glides in 0.4 s (was 0.55) and out in 0.45 s
  (was 0.6), the box rises the last few units into place in 0.1 s, the first letter comes 0.06 s after.
- **The words:** three lines at each hand-over (were five), one line each time after, short and warmer (the conversations above).
- **Weak points:** the effects are judged from pictures at 1280x720, not yet read on the Retroid; `{shake}` at the dialogue's
  size moves letters about 2 px, readable but subtle in a still; the face changes per line, not inside a line (Hazel smiles from
  the start of "I'd fix that bridge", not at "...Thank you").

### The seventh play: grass, trees and shadows

"The grass texture fades away too soon from the player's view ... I like BoTW's grass system", "Trees look a little blobby still"
and "the shadows from the trees disappear even though the tree is still in view". Three engine features, all opt-in (Pine Ridge
Rally is unchanged: `scripts/rally/verify.sh` 563 files identical), and the game turns them on:

- **Real grass** (`nova.grass`, docs/project-format.md "Grass"): clumps of six blades grown on the GPU round the camera, about
  ten clumps a square metre near it, thinning out to 32 m with no line where they end; 0.3 m tall (0.18 to 0.42), coloured from
  the ground's own 4 m colour grid and its big painted patches, darker at the root and lighter and warmer at the tip, swaying in
  the valley's wind with gusts that travel across the meadow, bending away from the postmaster's feet and the van's two axles,
  lit with the sun's shadows, casting none. Where it grows is `terrain/grass.png` (0.5 m a pixel, `tools/grass.mjs`): none on the
  road network's real surface (junctions and aprons included, thinning over the last 1.5 m), on the bridge's deck, in the creek,
  the gorge or the lake, on porches and steps, under the houses, round walls, fences, rocks and benches. **Run `tools/grass.mjs`
  again whenever the roads, the bridge or the scene move** (a test checks every road, gravel, bridge, water, porch and house spot).
- **The painted ground carries on further**: three sizes of strokes (1.1 m dabs, three times that, and 10 m sweeps), each fading
  where it would be under a few pixels across the view while the next carries on, and the paint noise read anisotropically, so
  the meadow keeps its painted look to 80 m and more (it was flat from about 20 m) with no fade line and no shimmer.
- **Shadows far off** (`nova.shadows { far = 110 }`): the 40 m map now lies over what the camera sees out to about 34 m and a
  third map of the big casters (trees, houses, walls, the forest masses) takes the view on to 110 m, fading over its last 15 m.
- **Trees**: a birch's crown is now a ring of five separate leaf clusters round a darker core, every other one higher, with
  notches between them where the sky shows, and one on top; each cluster has a lighter cap where the sun falls and a pale branch
  out to it from the trunk. Bushes are clusters with caps too. Pines and larches have more, shorter tiers (four or five), each a
  skirt of branches whose every other side is a long drooping tip and the sides between notched in deep, the underside hollow and
  painted darker, each tier lighter than the one below. The far versions are three such tiers (were two), and every treetop of a
  forest mass has a lighter cap. No crown reaches further out or higher than before. The same recipes are in `prop3d_make`'s
  painted tree, pine and bush.

Triangles per model, before and after: pine 408 / 528, pine2 528 / 648, pine3 408 / 528, pine_far 180 / 280, larch and
larch_small 488 / 598, larch_far 180 / 280, birch 694 / 1024, bush and bush2 400 / 480, forest_long 528 / 708, forest_tall and
forest_round 448 / 592. Per frame (`nova.perf().triangles`, shadow passes included, `tools/routes/grass-bench.json` on a desktop):
walking in the meadow 258,000 before and 410,000 after, low across the meadow 282,000 and 434,000, the driving camera on Post Road
301,000 and 454,000, the view of the tree shadows into the distance 311,000 and 476,000. Of the increase about 120,000 is the grass
(about 6,500 clumps of 18 triangles) and the rest the trees' new shapes and the far shadow map's casters.

**Cost on the Retroid: not measured yet.** The device was unreachable for most of the work and the one run was stopped (the owner
was using it). To measure: the camera-turn route (`scripts/bench/fernhollow-camera-turn.json`, 2,000 frames) and
`tools/routes/grass-bench.json` (`--play`: walking, low across the meadow, driving on Post Road, tree shadows, the forest edge,
printing `nova.perf().gpu_ms`), each with the build before and after, `--no-audio`, alternating twice, and the after build with
the grass turned off (`nova.grass()`) and then the far map off, to split the cost. Budget asked for: at most 1.0 to 1.5 ms of GPU
in the walking and driving views, 60 fps held. On a desktop (Apple M4, 1280 x 720, busy machine) the walking view's GPU time
rose by roughly 1.5 to 2 ms; that GPU is not the Adreno and the readings are noisy, so this says nothing certain about the
device. If the device is over budget, the levers are `density` (10 to 6), `distance` (32 to 24) and `far` (110 to 80).

**Pictures** (1280 x 720, `build/gallery/`, not committed): `seventh-<view>-before.png` and `-after.png` for the meadow from the
walking camera, low across the meadow, the driving camera on Post Road, the trees' shadows into the distance, a birch close and at
40 m, a pine close, pines and larches at 40 m, the forest edge and the hillside. The route is `tools/routes/grass.json`.

**Weak points**: from the van's higher camera the blades read as a fine texture rather than blades (they are 0.3 m tall); the
grass map has to be made again when the roads or the scene change (a test catches it); the far shadow map is 11 cm a texel, so
tree shadows past 35 m are soft; grass under a tree is lit by the shadow map but gets no extra darkening at the trunk; how it all
looks in motion on the Retroid's screen (the gusts, the bending, any crawl) is not yet seen by the owner.
### What the seventh play changed: the houses (a minimum thickness, painted surfaces, lived-in details)

The owner: "The houses look barren still. Also we should have a minimum thickness to prevent stick looking things and keep that
cozy, cartoony look. I guess because there's no texture?" and, for the world, "lived-in details".

- **A chunky minimum** (`HOUSE.min` in `tools/models.mjs`, written into the house style's comment). At house scale a post, rail,
  fence board, mast leg or brace (anything over 1.2 m long and under 20 cm wide) is at least **10 cm** through, a window bar or small
  trim (over 0.5 m) at least **6 cm**, a board or plate (20 cm wide or more) at least 3 cm, and only flat paint under 3 cm (a
  floorboard line, a wainscot) is thinner; indoors and on a desk (`min.indoor`) half of that. Round things count by their diameter.
  What had to change: window bars 6 x 7 cm (were 3 cm deep), the mast's legs 20 cm (were 13), its rungs 11 cm and thinned out to every
  1.2 m, its crosspieces 12 cm, its top spike 14 cm; **the guy wires are gone** (the game drew 1-pixel lines from its top): three
  timber braces of 20 cm run from the legs at 5.5 m to stone pads 3.6 m out, so nothing is a thread; saw-horse and table legs 10 cm,
  the held plank 20 x 6 cm, the mailbox post 14 cm, the porch rail's balusters as before; indoors the picture rails, the kick board,
  the pigeonholes' shelves and the window bars. Each new prop is made to it (rails of a garden fence 10 cm, its pickets 12 x 7 cm,
  the washing line a rope 10 cm thick, a bicycle's tubes 10 cm).
  **Test:** `every_model_is_chunky_nothing_is_a_stick` (tests/mountain_post.rs) reads the minimum from `HOUSE.min` and measures every
  solid of every model `tools/models.mjs` makes (about 1,000: a box by its size, a cylinder by its diameter, a tube by its diameter and
  line, a mesh along its own principal axes, so a turned plank is measured as it is) and lists each stick by name and size. The bridge
  and the signposts (another round's) and the ferns (felt sheets) are left out by name.
- **Painted surfaces on buildings** (the owner's guess, "because there's no texture", was right: three more paint kinds beside the
  trees' and the grass's, `docs/project-format.md`, "Painted surfaces"): `wood`, `roof` and `stone` in `mesh.wgsl`'s own block ("painted
  buildings"), worked out in the model's space on the plane the surface lies in, so they fit any house turned any way:
  **boards** every 32 cm (20 cm on a deck), each a shade warmer or cooler by a hash of its row, each length of it a little different,
  a soft seam 2.5 cm wide, a lighter lip on the upper edge and grain streaks about a metre long; **roof tiles** in rows of 26 cm up
  the slope (found from the surface itself, so the porch's shallow roof and the gable's steep one both fit), 36 cm tiles with every
  other row half a tile along, each a little different, a soft scalloped shadow under each row and a joint between tiles; **stone**
  in courses of 22 cm with blocks of about 42 cm in a different place on each course, each its own shade and a little rounded, soft
  mortar and a slow mottle. Every part is faded to the plain colour (and a slightly darker average) where it is under a few pixels
  wide, so far houses are calm: nothing shimmers. The walls' siding is now this paint, not geometry: the painted lines (thousands of
  4 cm slivers on every wall) are gone. Walls, decks, steps, benches, fences, tables, planks, shutters and crates are `wood`; the roofs
  (gable, porch, workshop) `roof`; plinths, chimneys, the mast's footing, the washing line's feet and the post office's side steps
  `stone`. Cost: two to four reads of the noise picture a painted pixel (the grass's six or so are the dearest); the new kinds add
  no vertices and no draw (the kind rides in each vertex's `emissive` like the others) and the models have fewer triangles of
  siding than before. **Test:** `painted_walls_roofs_and_stone_vary_near_and_are_calm_far_off` (tests/paint_gpu.rs: near, each kind
  varies more than the plain surface and stays as bright; at 400 m a pixel is calm) and `the_buildings_are_painted_as_boards_tiles_and_stone`
  (the written .glb files carry the kinds).
- **Lived-in details** (`tools/models.mjs` the new models, `tools/scene.mjs` `detail(...)`, which places each at a house in the house's
  own metres, moved off a road if it must be; a scene file as always). Built into the houses: a **box of flowers under every window**
  (rounded blooms in the house's colours), **shutters** (the post office's dark green pair each side, Pip's teal and mustard odd pair),
  a **lantern** by each door (it glows), a **doormat**, **pots of flowers** each side, the post office's **side door** with two stone
  steps in its left end wall; **Hazel's** wall rack of tools (axe, spade, saw), a rocking chair with rockers. Placed: **post office** a
  bicycle with a basket against its right end wall, **crates and parcels and a sack** stacked by the side door, a long raised **flower
  bed** each side of the steps, a **watering can**; **Hazel** (tools, timber, tidy) a vegetable **garden** with a picket fence (neat
  rows of cabbage, lettuce, carrot and onion, a bean teepee), a **chopping block** with an axe and split logs and a second **wood pile**
  by her workshop, a **wheelbarrow** with logs, a **ladder** on the cabin's end wall, a **rain barrel**, a watering can and a **bird
  feeder**; **Pip** (antennas, wires, a messy charm) a stout **aerial** on his ridge with a thick pipe of cable down the corner, a
  crooked-fenced **flower plot** with sunflowers at the back, **tyre planters**, a **tinker bench** in the open (his radio in pieces, a
  coil of red cable as thick as a hose, a lamp), a **washing line** whose odd socks, shirt, sheet and long johns (`cloths`, its own
  model, drawn 1.3 m up so that the wind moves them: `sway` is the more the higher above the model's origin) sway, a bird feeder, and
  **the flag up on his mailbox** (`mailbox_up`: `flag_up` in the scene file, `entities/mailbox.lua`). The chimneys' smoke is as it
  was. The paths and doors stay clear: **Test** `the_lived_in_details_are_placed_and_the_doors_stay_clear` (each is in the scene file,
  and from each door a walk 2.2 m wide and 14 m long has none of their feet in it); that nothing stands on a road is the road test's
  (`valley_roads_nothing_placed_stands_on_a_road` reads every object of the scene).
- **Pictures** (1280 x 720, made by the agent, not committed): `build/gallery/houses/` before and after, each house from the walking and
  the driving camera, the post office front, and a sheet of the new props (`new-props-sheet-1.png`, `-2.png`); the route is
  `tools/routes/houses.json`.
- **Weak points:** the houses are heavier: the post office 3,800 to 6,800 triangles, Hazel's cabin 2,600 to 4,700, Pip's 2,400 to 4,600
  (the flower boxes, pots and lanterns are rounded), the two gardens 5,000 to 6,600 each (a picket and a cabbage is a rounded solid);
  about 34,000 more triangles in the valley in all, in three places (the houses' yards), not measured on the Retroid. The boards' seams read a little strongly at 3 to 6 m
  and fade out by about 60 m (a pixel of 9 cm); the roof tiles are a regular grid close up, which is the toy look but not a hand's.
  The wood paint treats a post's side as a wall (a seam every 32 cm), so posts and fence rails are painted but cream trim is not.
  `foliage` on the flower boxes' leaves was tried and dropped (its core darkening reads from the model's axis, far from a window).
  The paint kinds' numbers (5, 6, 7) follow the water's: another round adding kinds should add after them.
### What the seventh play changed: the music ("too repetitive")

Four pieces for the felt piano now take turns, each playing once and ending, with quiet between them in which only the ambience
plays (as in games where each part of the day has its own piece). All four are written note by note in `tools/music.mjs` by one
builder, and each is five stems of one song (piano, bass, brushes, pad, celesta), so the layered driving rule works for every piece:

| piece | key, tempo | length | character | form |
| --- | --- | --- | --- | --- |
| Fernhollow (kept) | F major, 68, 4/4 | 2:06 | the morning walk | intro A B C A''' and an ending (A', A'' and B' cut; no loop now) |
| Thistle Lane | G major, 104, 4/4 | 1:46 | bright and skipping: dotted eighths over an oom-pa left hand | intro A A' B (E minor) C (a trio in C) A'' and a coda |
| Stillwater | E flat major, 58, 4/4 | 2:03 | reflective and slow: long notes and sighs | intro A B (C minor) A' (closing on C minor) and a three-bar coda |
| Meadowsweet | D major, 120, 3/4 | 1:53 | a folksy waltz: oom-pah-pah, a flat-seven C in the middle | intro A A' B (G, B minor) A'' (up an octave) A''' and a coda |

Each ends by slowing into a rolled chord and a bar of silence (two in the waltz) for the room to ring out. Measured offline (whole
pieces, BS.1770): the piano alone -18.0 LUFS in all four (0.01 LU apart); all five stems -16.6, -17.0, -16.9 and -16.9 (1.0 to 1.5
dB over the piano, 0.49 LU apart); sound_report finds no clipping and no clicks in any of the eight renders, 1 ms of silence at the
start and 1.1 to 4.1 s of silence at the end (the last 50 ms under -83 dBFS); on a small speaker the pieces lose 0.8 to 1.5 dB.

**The playlist** (`lib/music.lua`, `music.playlist_step`): the first piece starts about 6 s after the game begins; the pieces come
from a shuffled bag (all four before any again; a new bag never starts with the piece just played); between two pieces a quiet of
20 to 60 s, one time in five 30 to 60 s longer. The driving layers follow whichever piece plays (the rule runs in the quiet too, so a
piece that starts mid-drive starts with what the drive earned); the post office, the cards and the conversations behave as before
(the piano alone, ducked). The playlist lives in the module, so walking in and out of the post office does not restart a piece; the
ending card cuts a quiet to 2 s.

**On the handheld:** only the playing piece is decoded (`nova.music.layers(..., { loop = false })`: the stems end together and their
five decoder threads stop). Eight seconds before a piece starts, `nova.music.prepare` starts its decoders, so its opening (1.5 s a
stem, 256 KB each) is decoded during the quiet and the piece does not start with five decoders bursting at once. The cost that grew:
every Ogg in `music/` is held compressed in memory from the start, now 26 MB for the twenty stems (it was 11.5 MB for one piece's
five); the brushes stems are the biggest (about 2 MB each). Not measured on the Retroid.

`scripts/env.sh node examples/mountain-post/tools/music.mjs --audition` renders each piece (piano alone and full, for sound_report)
and writes `build/audition/mountain-post-pieces-excerpts.m4a`: three minutes, 44 s of each piece from its first A, the piano alone
for 21 s and then the four layers fading in. **Nobody has listened to any of it**: offline renders and measurements only.

- **The post office name board**: it was on the wall, so the porch roof hid the lower line of words and the main roof slope buried the rest. It now stands on two short posts on the porch roof front edge (tools/models.mjs post_office), 4.0 x 0.9 m; its words (tools/art.mjs, signs section) are solid cream rounded capitals cropped to their ink, the two lines centred on one another and the block on the panel (2.7 x 0.66 m, margin 0.12 m), no faded alpha. Pictures: build/gallery/po-after/.
## The sky, the haze and the floating life (after the seventh play, 2026-11-23)

The owner: "Something feels missing from the world and I can't pinpoint it. Maybe the fact that there's no blur and fading in the
distance? Maybe because there's no skybox or sun visible? Maybe because there's nothing floating around the area, like leaves or wind
strokes or something?" All three are in (the engine parts are documented in `docs/project-format.md`, "A painted sky, a sun where the
light is, and haze" and "Floating life"); `scenes/valley.lua` and `lib/atmosphere.lua` set them.

- **Sky and sun.** `nova.sky { style = "painted", sun = true, ... }`: a soft gradient from a pale warm horizon to clear blue, rounded
  cream clouds in three bands round the horizon (two flat tones, a bluer underside, soft edges, a lit rim towards the sun) drifting
  with the wind, a round sun with a wide glow, and a far blue range of rounded hills along the horizon with its feet in the haze.
  The sun stands where the light comes from, so it agrees with the shadows; the light was lowered a little (from about 55 to 42
  degrees up, still late morning) so that the sun and its glow are in view when you look up the valley towards the south-east.
  The far mountain models (`far_mountain`, 900 m out) were never drawn (the view ends at 400 m); the painted range stands in for them.
- **Haze.** `nova.fog { near = 50, far = 380, height = 22, floor = 4, desaturate = 0.25, sun = 0.5 }`: aerial perspective from
  about 50 m, a third of the way by 200 m, most of the way by 300 m and complete at 380 m (inside the view's end, which never
  shows), thicker low in the valley, far colours fading first, warmer towards the sun. (It was a plain fog from 90 m to 1100 m: there
  was almost none in the view.) The bloom threshold went from 0.82 to 0.92 so that the cream clouds do not glow.
- **Floating life** (`lib/atmosphere.lua`): 22 leaves from the crowns of the trees near you, a white wind curl every four or five
  seconds, 36 motes of pollen that glint when you look towards the sun, 5 butterflies over the flowers, bushes and gardens, and a
  flock of up to 5 birds every half a minute or so that passes over or comes down on the grass by a tree and flies off when you come
  near. All of it is the engine's (`nova.ambient`), round the camera, following `nova.wind`; off indoors.

Pictures (1280 x 720, `build/gallery/`, not committed): `atmosphere-<view>-before.png` and `-after.png` for the valley towards the sun,
away from it, from the bridge down the creek, a high view over the valley, the walking camera in the meadow and driving on Post Road,
and `atmosphere-life-*.png` (leaves, curls, butterflies, motes, close). The routes are `tools/routes/atmosphere.json` and
`tools/routes/life.json`. Tests: `the_valleys_sky_shows_the_sun_where_the_light_comes_from_and_the_land_fades_into_a_haze`,
`floating_life_stays_near_the_camera_within_its_caps_and_is_off_indoors`, and `tests/atmosphere_gpu.rs` (the sun's place on the
picture against the light, plain and painted; the haze against distance on the GPU and on the CPU).

**Cost.** No Lua runs for any of it each frame (`lib/atmosphere.lua` reads the scene once on entering the valley); the floating life is
moved in Rust (about 120 quads a frame at most with the game's counts, a handful of instanced draws). On a desktop (Apple M4, the
`nature-bench` route, two runs each, the machine busy with other builds) the render time a frame moved by -0.4 to +0.4 ms, within its
noise. **Not measured on the Retroid**: it was unreachable over SSH (host down) while this was done; `scripts/handheld-bench.sh` is the
way to measure it (the target is at most about 1 ms of GPU added at 1280 x 720).

## The owner's eighth play (2026-11-23, after the grass and sky)

Device: 60 fps holds (GPU 10.4 ms, about 4 ms headroom). The owner's notes, in their words:

1. "The flowers look kinda weird. Just like blobs on sticks. Instead of using 3D assets, don't some games use 2D assets for the
   less important items?"
2. "The pop in of grass and stuff is quite evident. Is there an efficient way we can fix that without adding too much load?"
3. "The wind has jagged edges, it's too solid white, and doesn't happen often enough."
4. "We can remove the green tops on the rock walls. The rock also needs some texture."
5. "We should add some lakes throughout the map because the hills look barren."
6. "What can you think of to keep the player on the road and not get stuck in the 'empty' areas? I do want to add some secret
   areas after some time but for the most part we should smartly prevent the user from accessing the empty areas."
7. "I don't think you did the removal of all the chips. I still see 'Y to exit' and 'Select' for map. I also don't see the
   control menu." (From the feedback for later: remove the button chips entirely; a Controls option in the main menu.)
8. "We should add some texture to the tree wood. We don't have to have those black parts sticking out of the birch trees either.
   I think we can simplify it with texture."
9. "There should be a driveway at the homes and buildings. Right now we're just driving on grass."
10. "The player kind of looks like he's shuffling when he's walking."
11. "I liked the post master cap that we had earlier. The bucket hat makes the character look like some kind of explorer."

### What the eighth play changed: no button chips, a Controls page (note 7)

"I still see 'Y to exit' and 'Select' for map. I also don't see the control menu." (From the feedback for later: "remove the button
chips from the UI entirely ... a 'Controls' option in the main menu.")

- **No button is drawn in play.** `ui.chip`, `ui.hints`, the Select key, the L1/R1 keys, the dialogue's X cap, the cap over the office's
  free tile and the "A Take" / "X Load package" rows are gone (also `Valley:hints`, `Office:hints`, `gear_hud.hints_floor`). What stays is
  information: the van's panel (tag, name and street, "1 of 2" between two slate arrows, "Load package" / "The van is full" / "The van is
  empty" in plain words), the pickup tip (name and street), the corner card (its count between the same arrows), the dialogue's "next"
  (a small slate arrow bobbing at the box's corner) and the PRNDL instrument while driving. A test (`no_button_prompts_are_drawn_in_play...`)
  refuses any button cap or hint word on foot, at the van's back, driving, in the office and in a conversation.
- **Controls** is the second choice of the title menu (Start, Controls) and of the pause menu (Resume, Controls, Quit): plain red / paper
  keys, no glyphs. The page (`cards.controls_layout`, rows in `words.controls_rows`) has two columns, "On foot" and "Driving", each row
  the button as engraved on the Retroid (A, B, X, Y in the kit's caps; L1, R1, R2, L2, L3, Select, Start and the sticks on slate keys)
  and what it does, and a foot line for menus (D-pad, A, B). It is the one place the game draws buttons. B or Start goes back (to the
  pause menu, or the title). A test checks every row's buttons against `nova.json` and that every action the game reads is on the page.
### What the eighth play changed: bark and stone (notes 4 and 8)

Three new paint kinds (`bark`, `birch`, `rock`: docs/project-format.md, "Painted surfaces"; their own block in `mesh.wgsl`, kinds 8 to
10), all paint and no geometry.

- **Trunks and branches (note 8).** `trunk()` in `tools/nature.mjs` paints bark: furrows up the trunk (soft, warm brown, a lighter lip
  beside each, plates a little lighter and darker, a darker foot). Pines, larches, their far versions (`pine_far`, `larch_far`: the
  same `trunk()`, so near and far match) and the stump have it; the forest masses have no trunks. A birch's trunk and its branches are
  painted `birch`: white with dark horizontal dashes, a few grey blotches, a faint banding and a dark foot. **The five black boxes
  that stuck out of the birch are gone** (60 triangles): the birch is 980 triangles (was 1024; the trunks went from six sides to eight, so
  the pines gained 16 each).
- **Rocks and the wall (note 4).** Rocks and every stone of `stone_wall` are painted `rock`: two sizes of grain, strata, a few painted
  cracks, a lighter top and a darker base. The moss caps are gone from the wall (the four green slabs are now flat stones of the wall's
  own grey, a little lighter, so the wall still has a coping) and **from the big boulder as well**: a moss puff on a boulder read as the
  same flat green blob the owner objected to on the walls, and a rock with real texture needs no help to look old (`rock_big` is 192
  triangles, was 264). The log's moss patch is left as it was (it is not a rock or a wall). The wall uses `rock`, not `stone`: `stone` is
  courses with mortar for a mortared building, and the wall is dry-stacked single stones, so courses over them would draw two sets of
  joints.
- **Mip-calm.** Furrows, dashes and cracks fade to a slightly darker or greyer average where they are under a few pixels wide; the grain
  a little later. Test `painted_bark_birch_and_rock_vary_near_and_are_calm_far_off` (tests/paint_gpu.rs).
- **Pictures** (1280 x 720, not committed): `build/gallery/bark-before/` and `bark-after/` (a wall close and at 15 m, the big boulder, a
  rock, rocks at 12 m, a birch close, at 10 m and at 40 m, a pine's and a larch's trunk close, a pine at 40 m). The route generator is
  not kept; the views are the grass route's `TREE` helper and a `SPOT` camera.
- **Tests**: `trunks_and_branches_are_painted_bark_and_a_birch_has_no_pieces_stuck_on`,
  `rocks_and_stone_walls_are_painted_rock_with_no_moss_caps` (tests/mountain_post.rs).
- **Weak points**: the bark is read round the model's y axis, so a horizontal log is not painted bark (it keeps its plain look); the
  pattern is in the model's own space, so a tree scaled up 2.5 times has furrows 2.5 times as wide; a crack on the wall runs across
  stones as one line (the pattern does not know where one stone ends); none of it has been seen on the Retroid's screen.
### What the eighth play changed: the walk and the cap (notes 10 and 11)

**"Shuffling" (note 10).** Measured first, from what the gait draws on the flat road (the sole's lowest point over the ground at the
top of each swing, the ankle's rise, one foot's landing to the other's, the hips' highest less lowest): at the full walk the foot
cleared the ground by 5.7 cm and the hips bobbed 2 cm; at a gentle push 3.9 cm and 1.1 cm; at a creep 3.4 cm. The swing was a low
symmetric arc, the soles stayed flat until they had to roll, the arms swung 26 degrees, and from the game's camera the feet hide
under the body and the tail, so what reads there is the bob and the arms. Now (tests at the end of
`crates/nova-runtime/tests/mountain_post.rs`, `the_walk_lifts_its_feet_reaches_and_bobs_rather_than_shuffling`):

| stick | speed | peak sole clearance | peak ankle rise | step | hips' bob |
| --- | --- | --- | --- | --- | --- |
| full | 1.6 m/s | 5.7 -> 8.3 cm | 7.1 -> 9.5 cm | 0.371 -> 0.383 m | 2.0 -> 3.0 cm |
| 0.5 | 0.89 m/s | 3.9 -> 6.2 cm | 4.5 -> 6.8 cm | 0.305 -> 0.317 m | 1.1 -> 2.1 cm |
| 0.3 | 0.53 m/s | 3.4 -> 5.4 cm | 3.5 -> 5.9 cm | 0.258 -> 0.266 m | 0.7 -> 1.3 cm |

- Each foot peels up onto its toe in the last half of its stance (the push-off, up to 0.55 rad at a walk), is picked up early in its
  swing (the arc's top at 0.42 of it, 7 cm at a walk, 6 cm at half, 4 cm at a creep) and then reaches out to land on its heel with
  the toes up (0.3 rad at a walk), rolling flat in about a tenth of a second (`nova.gait`'s new `toe_off`, `lift_peak`,
  `heel_strike`, `heel_settle`; docs/project-format.md). Either roll goes only as far as the leg still reaches the moved ankle, so
  the feet do not slide (the slide, sink and float tests pass unchanged: under 1.5 cm a step everywhere, most under 0.2).
- The step is a little longer and the beat a little calmer: the walk clip swings 51 degrees each way (48 before), 0.476 s a cycle at
  1.6 m/s (0.455), 4.2 steps a second (4.4); the stride is 0.76 m, though a step measures 0.383 m where the short leg cannot reach the
  full half-stride (a longer clip, 53 degrees, left the standing foot at the end of its toe roll every step and hurried the beat).
- The hips bob half again as much (3 cm at a walk), roll more over the standing foot (0.05 rad) and shift further over it (1.4 cm);
  the arms swing 40 degrees each way against the legs (26). At a gentle push the walk clip is still mixed with standing, so the arms
  swing less there (a second walk point at half speed made the hips hop on the porch steps and was dropped).
- On and near the porch steps the walk eases back to the quieter step the stair glide was tuned for (blended over about a tenth of a
  second), so the steps still climb smoothly (1.1 cm a frame at most) and no toe or heel goes into a tread.
- Pictures (1280x720, made by the agent, not committed): `build/gallery/walk-before-*.png` and `walk-after-*.png`, from the side,
  the front and the game's camera, at a full push and at half.

**The cap (note 11).** `hat: "peaked"` on a chibi animal is now a big soft postal cap built like the bucket hat (character3d_make):
the crown follows the head a couple of centimetres off it from just over the brows, puffing out a little over a deep band and up to
a soft round top; a short curved peak comes out over the brows (deepest in the middle, running out to nothing at the sides, a shade
darker than the band); the ears come up through holes with rolled rims in the band's colour, cut for the ear swung 0.32 rad any way
(the maker's test checks every edge of each ear against the cap's triangles at those swings; no clip turns an ear, and the springs
swing them at most 0.25); the envelope pin on the front of the crown. Its crown is finer than the bucket hat's (34 rings of 64): the
faces cut whole round the ear holes had left a slit from each hole to the top. `hat: "bucket"` is unchanged. Three caps were pictured
close, at the game's distance on the road and beside the blue van (`build/gallery/cap-options-*.png`, left to right): A an oatmeal
crown with a deep teal band and peak; B a soft teal crown with a darker teal band; C an oatmeal crown with an olive-brown band.
**Chosen: A** (`CAST.oatmeal`, `CAST.tealDeep`): the pale crown stands out against the grass, the road and the van at the game's
distance, the deep teal ties it to the neckerchief without the two running together; B's teal crown ran into the neckerchief and
the van's blue, and C's olive peak read as khaki, the explorer again. Nothing navy, no badge, no red. Seated, the cap clears the
cab's lining. Pictures: `build/gallery/cap-front.png`, `cap-three-quarter.png`, `cap-side.png`, `cap-back.png`, `cap-above.png`,
`cap-game-distance-road.png`, `cap-game-distance-van.png`, `cap-seated-in-van.png`, `cap-conversation.png`, and the bucket hat it
replaces, `hat-before-bucket-three-quarter.png`.

- **Weak points:** nothing is tried on the Retroid. From the game's high camera behind him the feet are mostly hidden under the body
  and the tail, so the new lift reads mainly from the side and the front; behind, it is the bob and the arms. The cap has about 1,400
  more triangles than the bucket hat (the postmaster is 21,800). The ear holes' rolled rims stand up a little round the ears like
  hoops when seen from the side, as they did on the bucket hat.
### What the eighth play changed: the flowers, the grass's fade, the wind curls (notes 1 to 3)

- **Flowers as painted pictures** (note 1). The 260 scattered 3D "flowers" (blobs on sticks) and the gardens' five are gone; the
  engine grows painted pictures among the grass blades instead (`nova.grass`'s `flowers`, docs/project-format.md "Grass"): five kinds
  drawn by image_make in the soft-toy palette (`tools/flora.mjs` makes `textures/flora.png`: daisies, buttercups, lupines, clover,
  dandelions), each plant two triangles stood up facing the camera (tilted back a little when the camera looks down), in patches of
  about 7 m over a third of the meadow (mostly one or two kinds a patch), 0.5 m tall, swaying and bending with the grass, lit like the
  ground, gone by 28 m. They grow only where `terrain/grass.png` is full, so never on a road, a gravel path, a junction, the bridge, a
  porch or by the water (the test checks every plant the engine would stand, over the whole valley); each `flowers` object of the scene
  file (the gardens) is now a spot where they grow thick (`entities/flowers.lua` draws nothing itself; `entities/valley_ground.lua`
  passes the spots). The ferns stay 3D (they read well); the flower beds, window boxes, pots and Pip's plot are still models.
- **No pop** (note 2). Every blade fades by its own distance: its distance is jittered by up to 9% by its number (no ring where the
  grass thins or ends), the clumps that the thinning drops come up out of the ground one after another over 40% of the count (a few
  metres of a walk, never a frame), and over the last quarter of the 32 m the rest dissolves by coverage (4x MSAA: soft). The flowers
  do the same over the last third of their distance. Scenery with its own `max_distance` (the 2,600 tufts at 38 m, the ferns at 50 m)
  now ends piece by piece (up to 12% nearer by where each stands) and dissolves over the last 30% (it was all at once over the last
  12%). The squares of 8 m are only what is drawn: nothing fades a square at a time. The pines' and larches' far models trade places
  over 16 m by the screen-door crossfade at 110 m, as before.
- **Wind curls** (note 3): thin ribbons (about 6 cm, pointed at both ends, palest at the tail) of a slightly blue-tinted white at about
  half alpha, drawn blended in their own pass with soft edges (`gfx/ribbon.rs`; a see-through model's pixels under 0.3 of alpha are
  cut, which made the old curls' hard edges and dithered fade); five may be about at once, one every second or so (sooner as the wind
  gusts), up to twice as often and twice as many on the hills (from 22 m of ground up; the meadow is at about 19 m, the hilltops 34 m).

**Pictures** (1280 x 720, `build/gallery/`, not committed): `eighth-flowers-close-*`, `eighth-flowers-10m-*`, `eighth-meadow-low-*`,
`eighth-walk-strip-*` (eight frames a third of a second apart, running across the meadow), `eighth-curls-open-*`, `eighth-curls-hill-*`, each
`-before` (the build at 25d06b6a) and `-after`. The route is `tools/routes/eighth.json` (`tools/routes/eighth.mjs` writes it).

**Cost on a desktop** (Apple M4, 1280 x 720, 4x MSAA, `tools/routes/grass-bench.json`, the build before and after alternated six times,
the machine busy with other agents' builds): the GPU readings flip between about 3 and 4 ms by the GPU's clock state in both builds, and
the medians moved by -0.5 to +0.7 ms view by view (walking 3.1 to 3.2 ms, low across the meadow 3.9 to 3.4, driving 3.9 to 3.7, the tree
shadows 3.3 to 4.0, the forest edge 3.4 to 3.0): no change this machine can resolve. Triangles a frame rose by 22,000 to 30,000 (5 to
6%): the clumps that now come up gradually instead of all at once (counted though most are still short) and the flowers (two triangles
each). Saved: the 265 flower models and the curls' 24 blended model draws (one draw for all the ribbons now). **Not measured on the
Retroid.**

**Weak points**: the flower beds, window boxes, pots and Pip's plot are still 3D blobs (they are the houses' models, `tools/models.mjs`);
the lupines read as soft spikes rather than bells; the motes still fade by a screen-door (a dotted disc as one fades); the cost on the
device is not measured.

### What the eighth play changed: ponds, the playable area and its edge, driveways (notes 5, 6 and 9)

**Ponds** (note 5). Three small still ponds, none on a road's line (tools/layout.mjs `PONDS`): **Reed Pond** in the hollow between Post
Road and Fern Lane's bend (the one to walk to: a meadow runs down to it from Post Road, a 6 m jetty you can walk out on and a bench on its
east bank), **Alder Pond** east of Post Road (seen from Post Road and Kettle Creek Road; the playable area's edge crosses it, so the water
is the edge there), **Tarn Pond** on a shelf cut into the valley's west side above Hazel's (outside the playable area, seen over the shelf's lip
from the edge behind her cabin, where the old track up to it is a secret way, below; not seen from the road). Each is a level plot (a terrain pad at its own height) with a bowl carved by two or three
overlapping strokes, so the shore is rounded and irregular; tools/scene.mjs finds the shoreline on the made ground and writes it into the
scene (`pond`: `level`, `shore`). entities/pond.lua lays the water as **still water** (`nova.mesh.make { paint = "water", still = true }`,
an engine addition: round ripples that only shimmer, more sky in them, a softer foam line, the shallows lighter) and 1 m ground cells round
it instead of the valley's 4 m squares (smooth waterline, the bank darker where wet). Reeds in runs along the shores, rafts of lily pads,
a few rocks. No grass in the water (tools/grass.mjs), no tree, wall or hedge in it; a walker is kept on the bank (lib/world.lua), except
on the jetty's boards (a `deck` with its own `level` and `pier`). The paper map draws them (map_make's new `ponds: { kind: "pond" }`).
The minimap draws only roads, so not the ponds.

**The playable area** (note 6; and the owner driving off the BRIDGE OUT end down the gorge's bank to the river). The scene's `playable`
object holds one outline (tools/bounds.mjs, made from shapes and traced on a 1 m grid): 26 m either side of Post Road's middle, 23 m of a
lane's, 14 m of a drive's, a round meadow at each house and yard, the picnic spot, the overlook, the bridge, Reed Pond with its meadow,
Alder Pond's near shore; never past the gorge's lip (N 220.5, just behind the BRIDGE OUT barrier) or into the map's rim. lib/world.lua
keeps the van and the postmaster inside it (`world.play_edge`, `world.push_out`, `world.move`): a walker's step outward is eased over the
last two metres; the van meets **rough ground** over the last 12 m of grass heading out (up to 22 m/s^2 more rolling, only when heading
out, never on a road: entities/van.lua `edge`), so it comes up to the edge slowly and stops there without a bounce or a knock. Its edge is
always something you can see (tools/scene.mjs, walking round the outline): along the gorge a split-rail fence on from the barrier, rock
outcrops below it; where the ground beyond rises or falls steeply, rock outcrops with pines; by Hazel's and the post office a hedge, by
Pip's a rail fence; at the water nothing; elsewhere, in stretches of about 45 m, mostly a forest edge (trees 4.6 m apart with bushes
under them and a forest mass behind), now and then a low stone wall or a run of hedge. Forest masses now fill the land beyond the edge
(each wholly outside it). **Secret ways** (`playable.secrets`, closed now, each with the land it opens): `tarn_track`, a fallen tree
across the old track to Tarn Pond, and `south_road`, a pair of locked field gates across Post Road's south end; `world.open_secret(id)`
adds the land beyond (its model is still to be taken away when one opens).

**Driveways** (note 9). tools/layout.mjs `DRIVES`, part of the one road network (tools/roads.mjs): the post office's leaves Post Road at
a junction of its own (filleted, its tarmac apron running 15 m up it with the ragged edge into the gravel) and bends into a gravel yard
north of the office, where **the van now starts** (facing back up the drive); Hazel's and Pip's carry on from their lane's end, narrowing,
through the gate into a round gravel yard in front of the house. The game reads them as gravel (`driveway` objects: world.surface, the
van's tyres), the grass is off them, the mailboxes, gate posts and signposts are off them. The junction data has three junctions now.

Tests (crates/nova-runtime/tests/mountain_post.rs, at its end): `the_ponds_are_carved_and_filled_with_no_grass_or_trees_in_them_and_a_walker_stays_out`,
`the_driveways_are_joined_to_the_roads_without_gaps_and_read_as_gravel`, `the_postmaster_and_the_van_cannot_leave_the_playable_area_from_any_side`
(every third point of the outline, a walker straight out and at two slants; every twelfth, the van at 40 km/h straight and slanted;
the owner's way down the gorge's bank from four places), `the_roads_houses_bridge_barrier_and_reed_pond_stay_inside_and_the_secret_ways_are_closed`.
Pictures: tools/routes/eighth.mjs (`build/gallery/eighth/`). Tools: `tools/edge-models.mjs` (hedge, field gate, fallen tree, reeds, lily
pads, jetty, outcrop), `tools/heights.mjs` (the made ground, read back), `tools/plan.mjs` (a plan from above with the playable area's edge).

Weak points: the edge adds about 80 trees, 110 hedges and 40 outcrops (513 trees, 73 forest masses in all): the device's frame time is
not measured. The ponds' foam line is drawn by the water shader's depth, so a very shallow shore can look a little white. Opening a secret
way does not yet take its fallen tree or gates away.

12. On the van on slopes (with a screenshot): "the wheels don't act like a normal car in video games. It turns slanted and extends out of
    the vehicle for some reason. Like other video games have cars, can we do it how other games handle cars"

    Done (entities/van.lua, tools/van.mjs): the wheels were root parts of the model beside the body. The body leaned and pitched about
    its own foot while each wheel stayed upright and was only lifted straight up by the world, so on a bank the body swung away from
    its wheels (out of the wells, slanted against the body). Now the wheels are the body's children and hang as in driving games: a
    fixed mount each (the axle in the model), the spring moving the wheel only along the body's up (`Van.TRAVEL`: 10 cm down, 8 cm
    up, the most the round well allows), steered about the body's up and spun about the axle (part `ry`, `rx`: Ry * Rx inside the
    body). The travel comes from a ray down the body's -up to the ground **as drawn**: the meadow is 4 m flat squares
    (entities/valley_ground.lua) that stand up to 22 cm off `nova.terrain_height` on the curved steep banks, so a tyre put on
    terrain_height sank into the grass at one end and floated at the other; the van now reads that mesh (`Van.ground_at`), roads at
    terrain_height, decks and the bridge at their own height. A wheel that would need more than its travel up lifts the body (the
    bump stop). The body may lean and pitch up to 0.6 rad (it stopped at 0.3, about 17 degrees). Tests: `the_vans_wheels_hang_from_the_body_as_in_a_driving_game`
    (a 20 degree climb, descent and side slopes, full lock, a kerb: against the engine's posing) and `..._over_the_bridge`. Pictures:
    `tools/routes/van-wheels.json` (out `build/gallery/van-wheels`). Weak point: the postmaster and the camera still stand on
    terrain_height, which on those banks is not quite the drawn grass.

## The owner's ninth notes (2026-11-23)

1. "The flowers flicker for some reason."
2. "We should add a floating tooltip when the character is near another character. It should just say 'Talk' with a small chip in
   the bottom right with the X button. The text boxes should have an arrow at the bottom when the player is done speaking that
   line, letting the user know that there is more text. There can also be an X chip in the bottom right."
3. "Similar to #2 we should have a button in the van storage view that says 'Take' or 'Store' (depending on if the char is holding
   a package or not). There should be a small chip in the bottom right with the A button."
4. "All roads should just be gravel honestly. We should add some dust that comes up but not too much. The double lines that appear
   in the gravel shouldn't be there I think. We should think of another way to add texture to the gravel roads."
5. "The windscreen on the van should be a little shorter vertically."
6. "We can remove the Neutral gear and the Lower Gear." (The lever is P R D.)
7. "The driveways should be closer to the homes. Especially for the post office."
8. "Also the creep should start sooner technically."

**Notes 5 and 6, and a later note on the creep (the gearbox's half; the coordinator relayed "Also the creep should start sooner technically").**
- *Windscreen* (tools/van.mjs, `WIN.y1` 1.50 to 1.44): the opening is 0.44 m high instead of 0.50 (12 % off the top; the bottom stays on the dash).
  Frame, pillars, both-sided pane, cab ceiling and linings are unchanged (they follow `WS` and `WIN`; the "nothing outside the skin" test passes);
  the seated postmaster is seen whole through it from the front and the chase side. Lettering and the wheel mounts are untouched.
- *The lever is P R D*: `Van.ORDER`, the instrument's row (lib/gear_hud.lua, letters SP.xl apart about the hub), the Controls page's rows
  (lib/words.lua: A "Gear towards D", X "Gear towards P"), the autopilot (it walks `Van.ORDER`, so it goes P, R, D; its D-or-L test is D). L's extra
  pull, top speed, engine braking and note went; so did N's roll. The tuning keys `low_power`, `low_top`, `low_brake` and the `L` creep entries are gone.
- *Creep sooner*: `Van.TUNE.creep_build` 0.45 to 0.12 s, applied twice in a row (`creep_j` then `creep_k`), so the pull is at 90 % in about 0.3 s but starts
  smoothly (the largest change in acceleration a step is under 0.12 m/s^2). Measured on Post Road: D moves 0.27 m/s half a second after the brake is let
  go and reaches 1 m/s after 1.25 s, R 0.33 m/s at half a second; both settle where they did.
- Pictures (not committed): `build/gallery/ninth-van/` (front, side, three-quarter, before and after), `build/gallery/ninth-windscreen/`, `build/gallery/ninth-gears/`.
  Routes: `tools/routes/ninth-gears.json`, `ninth-windscreen.json`. Tests at the end of tests/mountain_post.rs (`only_p_r_and_d_exist_...`,
  `the_lever_steps_p_r_d_...`, `the_autopilot_drives_through_p_r_d_only_...`; the creep test is `d_and_r_creep_at_idle_at_once_...`).

### What the ninth notes changed: three small chips back (notes 2 and 3)

The eighth play removed every button chip; the owner now asks for a few small, deliberate ones. Exactly three places draw one, each the
same cap (`ui.corner_chip`: the kit's round button, `ui.CHIP` = 24 units, its middle `s` in from the box's right edge and `xs` up from
its bottom, so it overlaps the corner a little), and nothing else in play draws a cap:

- **The talk tip** (`Valley:fade_talk_tip`, `ui.tip` with `chip = "X"`): a small floating tip over the resident's head (anchored with
  `camera.project`, eased, clamped, a tail), "Talk" or, with their parcel in the arms, "Hand over", with the X chip. It shows exactly when
  X would talk or hand over (`Valley:actions`: the same reach and facing as the talk itself), fades up in 0.18 s and away in 0.12 s.
- **The dialogue box:** once a line has finished typing, an X chip on the box's bottom-right corner; with more lines to come also a small
  slate arrow at the bottom centre, bobbing. **On the last line: the chip only, no arrow** (nothing more follows; X closes). Neither shows
  while the line is typing. (The old arrow in the box's right corner is gone.)
- **The van's panel:** a red button row, "Take" (empty hands, parcels inside) or "Store" (a parcel in the arms, room inside), with the A
  chip on the panel's bottom-right corner. **A does both** (`nova.json` is unchanged: A is `confirm`; at the back `Valley` now reads
  `confirm` for "load" as well as "pick", and X no longer loads). A full van shows just the plain note "The van is full" and an empty
  one "The van is empty": no button, no chip. The Controls page's on-foot A row reads "Take or store at the van"; the slice's route
  file presses A to store.

### What the ninth notes changed: every road gravel, the dust, the driveways by the homes (notes 4 and 7)

**All gravel** (note 4). Post Road is gravel like the lanes (tools/layout.mjs), so the valley has no tarmac left: no painted centre or
edge lines, no tarmac aprons at the junctions and no ragged edge where tarmac met gravel; the junctions, the drives and the yards are the
same gravel, and the bridge's deck stays timber. The "double lines" the owner saw were the gravel column of the road sheet: two wheel
ruts 1.45 m either side of the middle (20 % darker, with washboard ripples), which on a 4.6 m lane read as two dark lines. The new look
(surface_make's road option `gravel: "soft"`, studio/mcp/makers/surface.mjs `softGravel`; tools/terrain.mjs makes textures/road.png
with it; the sheet's other columns, and Pine Ridge's sheet, are as before): over the carriageway an even gravel with a slightly lighter
crown, stones at two sizes (about 12 and 25 cm, each lit on one side with a soft shadow on the other; the grain picture carries the grit
under them), fewer larger pebbles, warm and cool patches, and worn wheel paths that are only a little smoother and darker and come and
go every 10 to 30 m, each side on its own (never two lines); past the carriageway grass tufts creep in over the edge band and the ragged
edge runs into a soft olive verge near the meadow's colour. The colours are tools/roads.mjs `GRAVEL` (the road builder's opt-in
`colours`: a warm light gravel, its edge band a little darker, no pale stripe). The road builder's opt-in `even` (scripts/lib/roadnet.mjs)
keeps the stones round everywhere: a junction's patch carries the through road's picture on mirrored instead of blending two pictures
(which drew the stones out into swirls), a narrow road runs its picture along faster by as much as it is squeezed across, the strips
round a yard and a corner run theirs by their own length (they were stretched to meet, which drew rings round the yards), and a yard is
laid along the road into it. The lanes' junctions keep the 6 m corners they had as tarmac (`kerb`). Sampled from the sheet, the gravel's
darkest band along it is within 4 % of its mean (the ruts were 20 % under the crown). The game hears every road as gravel
(lib/world.lua, the scene's road lines, lib/road_junctions.lua), so the van's tyres and engine sound read gravel everywhere; a junction's
gravel rides as smoothly as its tarmac did (entities/van.lua BUMPS `packed`: braking into a junction on the lanes' 1.8 cm of bumps
drove the front springs into their stops) and the extra rolling on gravel is 0.05 m/s2 (it was 0.12 on the lanes; the van was tuned on
Post Road's tarmac, and its creep in D is still 1.2 m/s there).

**The dust** (note 4, "some dust that comes up but not too much"). entities/van.lua `Van:dust` (self-contained, from update) and
`Van:draw_dust` (from draw), `Van.DUST`: soft sandy puffs from just behind each rear wheel in turn while it rolls on gravel; none under
3 m/s (11 km/h), growing to full at 9.5 m/s (34 km/h): about 5 alive at a cruise, more braking hard (+55 %), more again sliding on the
handbrake (+90 %); at most 16 alive (the oldest gives way); each rises 0.3 m/s, swells to about 1 m across, drifts with the valley's
wind (60 degrees, a breeze) and fades over 1.6 s; none on the grass or the bridge's deck. They are drawn with a new engine call,
`nova.puff(x, y, z, radius, color)` (docs/project-format.md, Particles): a soft round blob drawn blended in the wind curls' pass, its alpha
falling smoothly to nothing at the rim, because a billboard drops pixels under 0.3 of alpha and cut a faint puff hard.

**The driveways by the homes** (note 7). Each yard is now right by its building (tools/layout.mjs DRIVES): the post office's drive runs
straight in from Post Road (14 m, its own 3.6 m corners) to a yard beside the north end of the porch, its gravel 3.4 m from the foot of
the steps and 5.8 m from the door (it was 19 m), where the van starts nose in with its back doors to the drive (the postmaster loads it
in the open, the camera behind him, and backs out to the road; the way down the steps to the road stays open south of it; a slice
played through by the autopilot backs out and turns as a driver would). Hazel's and Pip's drives carry on through their gates to a yard
about 2 m from the front of the porch (the gravel 3.1 m and 2.8 m from the doors; they were 6 and 9 m), Hazel and Pip standing beside
it (`resident`). The yards lie on their houses' plots, so they need no level pads of their own. The meadow north of the post office
where the old yard was stays in the playable area; the flower bed that stood where the yard is now runs along the north end wall, and
the flowers and the post office's north flower spot moved off the yards. The grass map, the occluders, the paper map and the junctions'
data were made again.

Tests (crates/nova-runtime/tests/mountain_post.rs, at its end): `valley_roads_are_all_gravel_with_no_tarmac_paint_or_apron`,
`the_vans_dust_rises_only_on_gravel_at_speed_and_is_capped`, `each_driveway_ends_by_its_buildings_door_and_the_van_starts_beside_the_post_office`;
`valley_roads_tarmac_meets_gravel_only_at_the_end_of_each_junctions_apron` is gone with the tarmac. Pictures: tools/routes/ninth-roads.mjs
(Post Road, the Fern Lane junction, Fern Lane and each drive from the driving and the walking camera, the post office's yard from above
and from Post Road; `build/gallery/ninth-roads`, the same views before in `build/gallery/ninth-before`, not committed) and
tools/routes/dust.json (pulling away, a cruise from behind and beside, braking, the handbrake, the dust drifting off).

Weak points: the stones are in the 64 m road sheet (6 cm a texel): close up from the walking camera they are soft, and the pattern
repeats every 64 m along a road; the grain picture carries the finest grit. A junction's patch meets the joining lane's picture along
the mouth: even gravel hides the join, but a careful look can find it. The post office's yard is small (6 m across): the van backs out
of it rather than turning in it. The dust is not seen on the device yet (16 blended puffs at most; their overdraw is not measured), and
the van's ride on Post Road now rumbles like a lane (1.8 cm of bumps; the junctions are packed smooth).

## The owner's tenth notes (2026-11-23, on the Retroid build f83c3ae9)

- "The flowers still flicker. It's at random times. When the camera is way up. When the player walks through them etc."
- "We should add the floating tooltip to the van 'Enter' then the Y chip in the bottom right of the tooltip"
- "Van door: The side that's closer to the windscreen can be trimmed to allow for a larger A pillar."
- "The camera can rotate a little faster when the player turns so that way the player doesn't have to use the Right Stick as often."
- "Camera: I like the 'top down' camera of the indoor areas. Let's keep that for the player every time they're walking even outside. when the player gets in the van we can move the camera closer to the ground, similar to what it's at now while driving."
- "We can be more lenient with the van gearing. If the player is max speed in Drive, and goes to R or P, the car should just brake hard to get the user there."
## The owner's tenth notes (2026-11-23): the Enter tip, the A pillar, a lenient lever

1. "We should add the floating tooltip to the van 'Enter' then the Y chip in the bottom right of the tooltip."
2. "Van door: The side that's closer to the windscreen can be trimmed to allow for a larger A pillar."
3. "We can be more lenient with the van gearing. If the player is max speed in Drive, and goes to R or P, the car should just brake
   hard to get the user there."

**Note 1: the Enter tip** (scenes/valley.lua `Valley:fade_enter_tip`, `Valley.ENTER_AT`; words.talk.enter). Y is the van action
(`"van": ["pad:north", "key:KeyF"]` in nova.json, north = Y on the Nintendo layout), so the chip is Y and nothing was rebound. The tip
is the Talk tip's own (`ui.tip`, the same paper panel, tail and `ui.corner_chip` on its bottom-right corner), saying "Enter", floating
over the cab's roof at the driver's doorway (van metres 0.7, 1.85, 0.5). It shows exactly when Y would get in (`Valley:actions`'
"get_in": van stopped, at the doorway, nothing in the arms), fades in over 0.18 s and out over 0.12 s like the Talk tip, and goes with
the card, a conversation or the fade out. Against the other two floating things: the Talk tip is only offered away from the van (so
never at the same time), and the rear panel (2.5 m behind it, over the open doors) wins the screen if both reach at once: the Enter tip
waits while the panel is up (`panel_mode`). The no-chips test now allows four chips: the Talk X, the dialogue's X, the panel's A and
this Y.

**Note 2: a wider A pillar** (tools/van.mjs `A_PILLAR`). The model has no door; the "door" is the driver's doorway cut in the skin
(one smooth body, cut-outs). Its front edge followed the windscreen's lean 0.10 m behind the glass; now 0.20 m (`doorFront`): the body
strip between the glass and the doorway, the A pillar, is twice as wide, and the doorway 10 cm shorter at the front, where its edge now
meets the wheel well's rim nearer the apex. The cab's inside faces, the step and the windscreen are unchanged (they key off the same
edge or the glass). Regenerated: models/van.model.json and van.glb. Pictures: `build/gallery/van-door-before-*` and `van-door-after-*`
(side, three-quarter, front three-quarter).

**Note 3: a lenient lever** (entities/van.lua `Van:shift`, `Van:engage`, `Van.SHIFT`; lib/gear_hud.lua). Nothing is refused any more.
Choosing a gear that does not suit the speed (P above 1 m/s either way, R going forwards above 1 m/s, D going backwards above it) is
taken at once and held as `want`: the lever stays where it was, the pedals are ignored, the creep is off and the van brakes at
`Van.SHIFT.decel` = 7 m/s^2 (full speed in D, 11 m/s, stops in about 1.6 s) with its brake lamps on; when it is all but stopped
(`engage` 0.35 m/s) the gear takes with its clunk (R then starts creeping back, P holds). A second press goes on from the pending gear
(D, X, X is P); pressing back to the gear it is still in cancels, so D to R to D at speed never braked and carries on. `timeout` 6 s:
if it somehow never slows enough, the gear takes anyway, so it cannot hang; getting out (`Van:park`) clears it. The instrument shows
the chosen gear at once on its red key, breathing softer while pending (the engaged letter stays plain), the slip beside it says
"Slowing to shift" (`hint` "slow"), and the key goes solid as the gear takes; `hud.shown` is still the engaged gear, `hud.pending`
the waiting one. The old refusal ("Stop to shift", the click) is gone from the lever; the slip's "stop" text stays in `HINTS`. The
autopilot is unchanged (it brakes before it shifts anyway).

Tests (crates/nova-runtime/tests/mountain_post.rs, new ones at the end): `the_enter_tip_shows_only_in_reach_of_the_doorway_with_a_y_chip`,
`the_a_pillar_beside_the_doorway_is_wider`, `shifting_to_r_or_p_at_full_speed_brakes_hard_and_then_engages`,
`d_to_r_and_back_to_d_at_speed_carries_on_and_a_pending_shift_cannot_hang`. Changed in place: `no_button_prompts_are_drawn_in_play_and_the_instrument_stays`
(one chip, "Enter", at the door), `the_lever_starts_in_p_moves_at_once_and_only_refuses_p_or_r_on_the_move` (the rolling part: pending,
no refusal).

Weak points: the braking is felt only in the numbers and pictures here, not on the device; 7 m/s^2 on gravel may dip the nose a lot
(the suspension takes the pitch). The Enter tip's spot is over the roof, so a low camera behind the van may put it off the top of the
screen (the tip keeps itself on screen). Pressing X at speed no longer clicks to refuse, so nothing "tells" the player the shift
is waiting beyond the breathing key and the slip.
