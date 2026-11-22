# The mountain post office (working title)

Status: **design draft, 2026-11-22, for the owner to correct. Nothing is built.**
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
| Carrying | The van holds **one parcel** at first (upgradable). On foot you carry one and are slower. |
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
nothing fussy. Cream with a red stripe, FERNHOLLOW POST on its side. Holds one parcel. A cheerful horn.

**The residents.**
- **Hazel Brock**, a badger, retired carpenter, 3 Fern Lane. Gruff, dry, kind underneath. Her parcel: a set of chisels she
  ordered two winters ago.
- **Pip Tansy**, a young rabbit who runs a one-rabbit radio station from his cabin, 7 Kettle Creek Road. Talks fast, hopeful,
  easily delighted. His parcel: a valve for his transmitter.

**What happens.**
1. You start inside the post office: dusty, half the shelves empty, one shelf with **three items**: a letter addressed to "The
   Postmaster, Post Road", a parcel for "Hazel Brock, 3 Fern Lane", a parcel for "Pip Tansy, 7 Kettle Creek Road".
2. The letter is for you: read it at the counter. It is from the Mayor (a heron, Odette Marsh, unseen in the slice):
   "Welcome to Fernhollow. The post office is yours, such as it is. Mr. Pemberton left two winters ago and nobody has had a
   letter since. Take your time. We have waited this long. P.S. The van pulls a little to the left. So did Mr. Pemberton."
3. Take a parcel (one at a time), read its label, walk out, get in the van, find the address by the signs and the paper map,
   get out, hand it over at the door, talk. Come back for the other. The order is the player's.
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
stick looks, **A** talks / takes / hands over / reads, **B** gets into the van when beside it, **Y** opens the paper map. Driving:
R2 goes, L2 brakes then reverses, left stick steers, right stick looks, **B** gets out (when stopped), **X** sounds the horn,
**Y** opens the paper map. Start pauses (resume, quit).

**Sound.** The van's engine (soft, small, a little rattly), tyres on gravel and tarmac, the horn, doors; forest air, birds, the
creek near the bridge, Pip's radio faintly near his cabin, sawing near Hazel's; footsteps; a babble voice for each of Hazel
(low, slow), Pip (high, fast) and paper sounds for labels and the letter. One piece of music: slow, warm, acoustic-feeling (soft
plucked lead, round bass, brushed drums), quiet enough to drive to, readable on small speakers.

**Quality bar.** Final quality, not a prototype: the owner will judge the van's feel, the look of the place, finding an address
unaided, the charm of the two exchanges, the sound, and the frame rate, on the Retroid (which gives games a 1280x720 screen).
