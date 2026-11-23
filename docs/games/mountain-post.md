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

**Running** (the owner: "when the player runs, their arms go wide. Very cute"): a gentle push of the stick walks; a full push
runs with the arms held straight out to the sides. Carrying a parcel, the run is a trot with the parcel held in front.

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
   A loads it), get in at the left doorway, find the address by the signs and the paper map, get out, take it from the van's
   back (a small panel shows the parcels in the van one at a time, name and street; L1 and R1 go through them, A takes the one
   shown), hand it over at the door, talk. Come back for the other, or load both before setting out: the van holds both. The
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

**Controls** (gamepad; letters as engraved on the Retroid: A south, B east, X west, Y north). Walking: left stick moves, right
stick looks, **A** talks / takes / hands over / reads (at the van's open back: loads the parcel carried, or takes the one the
panel shows; **L1** / **R1** go through the parcels in the van), **B** gets into the van at its left doorway, **Y** opens the
paper map. Driving:
R2 goes, L2 brakes then reverses, left stick steers, right stick looks, **B** gets out (when stopped), **X** sounds the horn,
**Y** opens the paper map. Start pauses (resume, quit).

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
