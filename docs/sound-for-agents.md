# Sound for agents: why Nova's sounds came out like an old console, and what changed

Written 2026-11-21 after the owner played `examples/neon-undertow` on a handheld: "The sounds seem too chiptune like." Nobody had
studied why. This note says what "chiptune-like" is made of, measured; which of the parts of a produced game sound Nova could not
make and which its makers simply did not use; what Nova gained; and what remaking Neon Undertow's 69 effects and three songs changed,
in numbers.

(Neon Undertow was removed from the repository on 2026-11-21 at the owner's word; the game, its tests and its design are in the git tag `archive/neon-undertow-2026-11`. Its sounds are the ones measured here.)

**Honest limits first.** Nothing here has been listened to by a person. An agent cannot hear, and neither can `sound_report`: it
measures what produced game sounds are known to be made of (a transient, filtered noise, moving pitch and filters, low end, width, a
room, a natural fall), and an effect can have all of that and still sound bad. The remade sounds were tuned until the report stopped
advising, so "no longer toy-like" in the tables below is partly true by construction: it says the new recipes avoid what the report
looks for, not that they sound good. Everything is offline renders; the handheld's speaker was not measured. The owner's ears are the
test that is still to come.

## How the sounds were "heard"

`sound_report` gained a **make-up** line for every sound (`studio/mcp/sound.ts`, `character`), measured from the samples:

| measure | what it is | why it matters |
| --- | --- | --- |
| transient | the highs (above about 2.5 kHz) of the first 15 ms stand out against the next 45 ms by 2.5 times more than the whole sound does, and are loud enough to hear | the ear takes a crack or click as the moment of impact; without one a hit is a "boop" |
| partials, harmonic | spectral lines within 30 dB of the strongest, and whether they sit on whole multiples of the lowest | a raw square or saw is a buzzy harmonic stack; metal and bells are inharmonic |
| noise | the flatness inside each band of the loud moments, weighted by energy (0 a pure tone, 1 white noise) | impacts, shots and whooshes are mostly noise in produced games |
| movement | how much the spectrum's shape changes per 20 ms, in dB | a frozen spectrum is synthetic; real sounds move (pitch drops, filters close) |
| width | the stereo side's energy over the middle's | chip sounds are mono |
| low | the share below 150 Hz | the thump under an impact |
| tail, fall | from the peak to -40 dB, and whether the fall is exponential (a ring), a straight line, or cut short | sfxr's envelope falls in a straight-ish line to a hard zero |

From the make-up it writes **advice** for effects (`adviseEffect`): "toy-like" when three or more chip traits meet, and a concrete layer
to add for each lack (a noise transient, a filtered noise body, a pitch-dropping sub, a pitch or filter envelope, width and a room). For
songs (`adviseSong`) it reads the settings: which tracks use the plain chip voice, a triangle bass, the chip kit, no room, nothing that
ducks under a driving kick, no glue on the master. The survey of the game used exactly these numbers (the script that made the tables
was a scratch copy of `sound_report`'s analysis run over every file; the per-sound numbers can be had again with
`sound_report {"sounds": [...]}`).

## What "chiptune-like" came from, measured

Before (the files at commit 76bc4494): **69 effects and 3 songs**, all made with `sfx_write` and `song_make`.

**The effects were sfxr's model, and nothing else could be made.** An effect was one oscillator (square, saw, sine, triangle or noise)
with one envelope, a linear pitch slide or an arpeggio step, and two one-pole filters. Measured over the 69:

- **0 of 69 stereo.** Every effect was mono and dry: no room, no width. (The runtime has a shared room, `nova.sound.room`; the game does
  not use it.)
- **0 of 69 with a transient.** Nothing marked the moment of impact: a hit was a burst of noise that rose and fell in one envelope.
- **46 of 69 fell in a straight line** to a hard zero (sfxr's `(1 - x)^2` decay ending at sustain + decay); real sounds ring out
  exponentially. Only 23 read as a ring.
- **21 of 69 used the noise wave, which is held-step noise**: a new random value every `1/freq` seconds, held. That is the noise channel
  of the NES and the Atari. Measured on a long render: 90 % of its energy lies below `freq`, and it has a comb of nulls 31 to 34 dB deep
  at every multiple of `freq` (freq 1400 and 2200). Smooth white noise has 91 % of its energy above 2.2 kHz. The ear hears the comb as
  a buzzy, grainy texture: "8-bit noise".
- **The oscillators were not band-limited.** 19 of 69 effects are a square or saw at 600 Hz or more. A plain-voice saw at 880, 1661 and
  2637 Hz puts -16, -13 and -11 dB of its energy between its own harmonics (harmonics above half the sample rate fold back as
  inharmonic whistles); a band-limited saw (PolyBLEP) puts -32, -30 and -27 dB there. Aliasing is the "fizz" of cheap chip emulation.
- **21 of 69 were arpeggio fanfares** (`arpNotes` or `arpSemitones`: a square or triangle stepping through a chord): the chip idiom
  itself.
- **One source each.** No layering: a hit could not have a crack and a body and a tail; nothing had a sub under it (median 0 % of the
  energy below 150 Hz; 12 of 69 had more than 5 %). No FM, so no metal or bells; no ring modulation, so electricity was a vibrato saw.
  No pitch envelope with a curve (only a linear slide in octaves a second), no filter that moves, no saturation (a hard clamp at
  full scale).
- In all, **44 of 69 met three or more chip traits** ("toy-like" in the report).

**The songs were the chip voice, though Nova had more.** `song_make` wrote all three with triangle melody, harmony and bass and the
chip drum kit (a square-blip kick and a held-noise snare), no ducking and nothing on the master. `sound_report` now gives each four to
six pieces of advice. Measured: the Mother Coil boss track was nearly mono (side/middle 0.006); the Den and the Gutter Market tracks
barely moved (spectral movement 1.3 dB per 20 ms against 3 to 3.5 for the remakes).

### What Nova could not do, and what the makers did not use

| what produced game audio uses | effects before | songs before | now |
| --- | --- | --- | --- |
| layering (a transient + a body + a tail) | could not: one oscillator | (tracks are layers) | `layers` in an effect (up to 8) |
| filtered noise with a moving filter | could not: held-step noise, fixed one-pole filters | the studio kit's noise was filtered; unused by `song_make` | a layer's `noise`/`pink` with `filter`, `cutoff` to `cutoffEnd` |
| pitch envelope with a curve | linear `slide` only | a note's `bend` (linear) | a layer's `pitch` + `pitchTime` (exponential glide) |
| FM, inharmonic partials | could not | the `fm` instrument existed, unused | a layer's `fm`, `fmRatio`, `fmDecay` |
| ring modulation | could not | could not | a layer's `ring` |
| sub-bass thump under impacts | could not (one oscillator) | `sub` existed, unused | a sine layer with a pitch drop |
| saturation | hard clamp | a soft clip on fuller songs | `drive` |
| short room, stereo spread | could not (mono) | `reverb`, `pan`, `unison` existed, barely used | `reverb`, `room`, `width` |
| variation per play | groups (`.group.json`) existed; the game uses none | | `nova.sound.play(name, { vary = 0.05 })` |
| band-limited oscillators | not in the plain voice | in the fuller voice only | every layer's saw and square |
| detuned unison, chorus, filter movement | | existed (`unison`, `detune`, `cutoff`/`sweep`, a `chorus` effect), unused by `song_make` | `song_make`'s moods use them |
| side-chain ducking | | could not | a track's `duck` |
| drums of noise + tone | | the `studio` kit existed, unused | `song_make` uses it, and the new `punch` kit (gated, layered) |
| master compression and limiting | | existed (`master.fx`, `limit`), unused | `song_make` puts a compressor and `limit: -1` on every mood |

So for **effects** the format itself was the limit; for **songs** it was mostly the maker, which wrote the chip voice although the synth
had unison, filters, a sub, reverb, a compressor and a studio kit.

## What Nova gained

- **Layered effects** (`studio/src/lib/sfx-layers.ts`, `docs/project-format.md` "Sound effect files"): up to 8 layers, each a source
  (`sine`, `triangle`, band-limited `saw` and `square`, `noise`, `pink`, `crackle`), with `start`, `attack`/`hold`/exponential `decay`,
  `pitch`/`pitchTime`/`slide`, `vibrato`, `unison`/`detune`, `fm`/`fmRatio`/`fmDecay`, `ring`, and a moving `filter`
  (`cutoff`, `cutoffEnd`, `filterTime`, `q`); over the whole a finish: `drive`, `reverb`, `room`, `width`. A file without them renders
  byte for byte as before (tested against the committed WAVs of `examples/maker-demo`). Misspelt keys are refused with the nearest one.
  Rendered at build time into the WAV like before: the game's cost is unchanged except that a stereo effect is twice the memory (Neon
  Undertow's effects went from 3.1 MB to 7.4 MB of WAV).
- **`sfx_write`**: 27 purposes, all rebuilt in layers (step_grass, step_stone, jump, land, whoosh, sword_swing, hit, heavy_hit, hurt,
  shot, laser, zap, metal_hit, glass, explosion, enemy_die, death, tell, alarm, locked, pickup, coin, chest_open, powerup, door,
  ui_move, ui_select); `loudness` finds the volume for a level, so a sound can be remade at the place it had in the mix. A layered
  effect's `volume` may go to 4 (a gain on the layers, the peak kept under full scale). The plain voice's keys given with a layered
  purpose are refused, since they would change nothing.
- **`sound_report`**: the make-up line and the advice above, for effects and songs.
- **Songs**: a track's `duck` (side-chain pumping on every kick); the `punch` drum kit (a kick with a beater click falling 174 to 64
  Hz, a snare with a crack, two tones, a clap and a gated room, ring-modulated metal hats); `song_make`'s moods use the fuller voices
  (saw basses through an opening filter with a sub, detuned pads and leads, echo), the studio or punch kit, a compressor and a limiter,
  and there are two new moods: **`synthwave`** (driving: a sixteenth-note arpeggio, a detuned saw lead with echo, a five-voice pad and a
  saw bass that duck under a four-on-the-floor kick, clap on the snare) and **`synthwave night`** (slow and dreamy, for a hub).
- **`nova.sound.play(..., { vary = 0.05 })`**: each play a little higher or lower and quieter, from its own random numbers, so
  `math.random` and seeded runs are untouched (tested).

## Neon Undertow, before and after

Made by `examples/neon-undertow/tools/sounds.mjs` (`scripts/env.sh node examples/neon-undertow/tools/sounds.mjs`), through the tools
like a person would: every effect by `sfx_write` (a purpose, or layers), each at the level the old file measured (`loudness`); the songs
by `song_make` and then the old loudness as the master's `lufs`. Every effect keeps its name; the game's code and its 126 tests are
unchanged and pass.

**Effects, all 69:** stereo 0 → 69; with a transient 0 → 10 (the hits, slams and bursts; chimes, tells and menu sounds have none on
purpose); falling as a ring 23 → 67 (one long drag holds and then fades: `junk_drag`); "toy-like" 44 → 0 (by construction, see above);
level kept within 0.8 dB on every one (the median change 0.0). Median spectral movement 2.4 → 3.1 dB per 20 ms; median width 0 → 0.04.
Impacts gained weight below 150 Hz (12 → 25 effects with more than 5 %). The energy-weighted noisiness of impacts went *down* (the
plain hit 0.95 → 0.09), because a tonal thump now carries most of the energy and the noise sits above it as crack and crunch: the
measure says where the energy is, not what the ear notices first. Files are longer (median 0.41 → 0.56 s) because of the room's tail;
the audible part (to -40 dB, "tail" below) is about as long as before or shorter (median 0.29 → 0.24 s).

Per effect: length / audible tail in seconds, level (LUFS for 0.45 s or more, else dB RMS of the loud parts), transient, noise, width,
% below 150 Hz, the fall, and whether the report calls it toy-like. Before → after.

| effect | length / tail | level | transient | noise | width | low % | fall | toy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ally_rise | 0.56 / 0.34 → 0.73 / 0.27 | -14.1 → -14.1 | no → no | 0.00 → 0.01 | 0.00 → 0.14 | 0 → 0 | linear → exponential | toy → - |
| banner_boss | 1.15 / 0.86 → 1.00 / 0.47 | -17.6 → -17.6 | no → yes | 0.93 → 0.31 | 0.00 → 0.10 | 15 → 66 | exponential → exponential | toy → - |
| banner_clear | 0.48 / 0.28 → 0.74 / 0.33 | -11.0 → -11.2 | no → no | 0.08 → 0.05 | 0.00 → 0.04 | 0 → 0 | linear → exponential | - → - |
| banner_death | 1.00 / 0.76 → 1.10 / 0.61 | -17.0 → -17.0 | no → no | 0.00 → 0.14 | 0.00 → 0.07 | 0 → 52 | linear → exponential | toy → - |
| banner_elite | 0.65 / 0.57 → 0.61 / 0.32 | -15.8 → -15.8 | no → yes | 0.25 → 0.22 | 0.00 → 0.04 | 0 → 60 | linear → exponential | toy → - |
| banner_go | 0.63 / 0.58 → 0.85 / 0.40 | -10.7 → -10.7 | no → no | 0.20 → 0.06 | 0.00 → 0.13 | 0 → 0 | linear → exponential | toy → - |
| banner_room | 0.16 / 0.14 → 0.34 / 0.13 | -13.9 → -13.9 | no → no | 0.11 → 0.04 | 0.00 → 0.04 | 0 → 0 | linear → exponential | - → - |
| banner_win | 1.00 / 0.94 → 1.20 / 0.42 | -10.7 → -10.7 | no → yes | 0.20 → 0.03 | 0.00 → 0.13 | 0 → 0 | linear → exponential | toy → - |
| blast | 0.85 / 0.69 → 1.00 / 0.43 | -15.7 → -15.7 | no → yes | 0.97 → 0.49 | 0.00 → 0.09 | 12 → 75 | exponential → exponential | toy → - |
| boss_bark | 0.08 / 0.07 → 0.37 / 0.14 | -10.0 → -10.0 | no → yes | 0.02 → 0.15 | 0.00 → 0.05 | 0 → 47 | linear → exponential | toy → - |
| boss_burst | 0.89 / 0.76 → 0.93 / 0.43 | -16.7 → -16.7 | no → yes | 0.91 → 0.46 | 0.00 → 0.11 | 15 → 65 | exponential → exponential | toy → - |
| boss_die | 1.90 / 1.39 → 1.46 / 0.74 | -16.9 → -16.9 | no → yes | 0.88 → 0.26 | 0.00 → 0.09 | 18 → 77 | linear → exponential | toy → - |
| bottle_smash | 0.33 / 0.28 → 0.35 / 0.18 | -20.2 → -20.2 | no → no | 0.97 → 0.90 | 0.00 → 0.25 | 0 → 0 | exponential → exponential | toy → - |
| bounty_pay | 0.46 / 0.34 → 0.60 / 0.23 | -9.5 → -9.5 | no → no | 0.13 → 0.12 | 0.00 → 0.01 | 10 → 0 | linear → exponential | - → - |
| brownout | 0.81 / 0.51 → 0.77 / 0.32 | -14.4 → -14.4 | no → no | 0.02 → 0.10 | 0.00 → 0.05 | 0 → 13 | linear → exponential | toy → - |
| buy | 0.33 / 0.23 → 0.54 / 0.33 | -10.2 → -11.0 | no → no | 0.06 → 0.04 | 0.00 → 0.02 | 0 → 0 | linear → exponential | - → - |
| can_spit | 0.15 / 0.13 → 0.36 / 0.14 | -16.3 → -16.3 | no → no | 0.03 → 0.06 | 0.00 → 0.01 | 0 → 0 | linear → exponential | toy → - |
| car_slam | 0.77 / 0.66 → 0.57 / 0.28 | -16.5 → -16.5 | no → no | 0.96 → 0.12 | 0.00 → 0.02 | 17 → 75 | exponential → exponential | toy → - |
| card_rise | 0.61 / 0.28 → 0.88 / 0.28 | -15.4 → -15.4 | no → no | 0.06 → 0.10 | 0.00 → 0.06 | 0 → 0 | linear → exponential | - → - |
| card_take | 0.23 / 0.20 → 0.59 / 0.40 | -9.9 → -9.9 | no → no | 0.21 → 0.01 | 0.00 → 0.01 | 0 → 0 | linear → exponential | - → - |
| door_open | 0.37 / 0.17 → 0.59 / 0.12 | -15.6 → -15.6 | no → no | 0.01 → 0.30 | 0.00 → 0.01 | 0 → 62 | linear → exponential | toy → - |
| door_shut | 0.33 / 0.26 → 0.47 / 0.21 | -16.0 → -16.0 | no → no | 0.96 → 0.23 | 0.00 → 0.01 | 11 → 74 | linear → exponential | toy → - |
| door_unlock | 0.44 / 0.36 → 0.58 / 0.26 | -10.7 → -10.7 | no → no | 0.12 → 0.03 | 0.00 → 0.01 | 0 → 0 | linear → exponential | - → - |
| drum_clang | 0.17 / 0.14 → 0.34 / 0.14 | -17.8 → -17.8 | no → no | 0.02 → 0.01 | 0.00 → 0.01 | 0 → 0 | exponential → exponential | toy → - |
| drum_open | 1.00 / 0.69 → 1.08 / 0.50 | -8.5 → -8.8 | no → no | 0.15 → 0.01 | 0.00 → 0.06 | 0 → 0 | linear → exponential | - → - |
| empty | 0.08 / 0.07 → 0.23 / 0.11 | -12.0 → -12.0 | no → no | 0.02 → 0.04 | 0.00 → 0.02 | 0 → 0 | linear → exponential | toy → - |
| enemy_die | 0.37 / 0.28 → 0.45 / 0.21 | -16.4 → -16.4 | no → no | 0.98 → 0.14 | 0.00 → 0.03 | 3 → 58 | exponential → exponential | toy → - |
| enemy_tell | 0.40 / 0.34 → 0.51 / 0.24 | -16.4 → -16.4 | no → no | 0.13 → 0.06 | 0.00 → 0.04 | 0 → 0 | exponential → exponential | - → - |
| fire_start | 0.68 / 0.24 → 0.54 / 0.32 | -17.2 → -17.2 | no → no | 0.94 → 0.14 | 0.00 → 0.04 | 1 → 45 | exponential → exponential | toy → - |
| hit | 0.14 / 0.13 → 0.32 / 0.14 | -16.1 → -16.1 | no → yes | 0.95 → 0.09 | 0.00 → 0.01 | 14 → 33 | exponential → exponential | toy → - |
| hurt | 0.21 / 0.14 → 0.28 / 0.14 | -13.8 → -13.8 | no → no | 0.05 → 0.03 | 0.00 → 0.00 | 0 → 0 | linear → exponential | - → - |
| jinx_take | 0.66 / 0.54 → 0.88 / 0.42 | -13.5 → -13.5 | no → no | 0.45 → 0.26 | 0.00 → 0.07 | 1 → 5 | exponential → exponential | - → - |
| junk_drag | 1.00 / 0.75 → 1.06 / 0.86 | -21.0 → -21.0 | no → no | 0.88 → 0.69 | 0.00 → 0.09 | 3 → 4 | exponential → linear | toy → - |
| key_pay | 0.26 / 0.23 → 0.52 / 0.36 | -11.4 → -11.4 | no → no | 0.07 → 0.09 | 0.00 → 0.00 | 0 → 0 | linear → exponential | toy → - |
| lullaby_blip | 0.07 / 0.06 → 0.28 / 0.08 | -12.9 → -12.9 | no → no | 0.01 → 0.01 | 0.00 → 0.00 | 0 → 0 | linear → exponential | toy → - |
| magnet_slam | 0.83 / 0.70 → 0.49 / 0.28 | -16.3 → -16.3 | no → no | 0.98 → 0.38 | 0.00 → 0.01 | 17 → 83 | exponential → exponential | toy → - |
| menu_move | 0.06 / 0.05 → 0.04 / 0.03 | -13.6 → -13.6 | no → no | 0.02 → 0.05 | 0.00 → 0.01 | 0 → 0 | exponential → - | toy → - |
| menu_select | 0.16 / 0.14 → 0.32 / 0.15 | -12.2 → -12.2 | no → no | 0.12 → 0.08 | 0.00 → 0.00 | 0 → 0 | linear → exponential | - → - |
| move_in | 0.60 / 0.27 → 0.88 / 0.42 | -10.7 → -10.7 | no → no | 0.14 → 0.06 | 0.00 → 0.06 | 0 → 0 | linear → exponential | - → - |
| phase_slow | 1.00 / 0.80 → 1.42 / 0.59 | -13.7 → -13.7 | no → no | 0.00 → 0.11 | 0.00 → 0.18 | 0 → 7 | linear → exponential | toy → - |
| printed | 0.44 / 0.36 → 0.61 / 0.24 | -10.7 → -10.7 | no → no | 0.12 → 0.01 | 0.00 → 0.05 | 0 → 0 | linear → exponential | - → - |
| reroll | 0.33 / 0.30 → 0.56 / 0.17 | -10.3 → -10.3 | no → no | 0.07 → 0.08 | 0.00 → 0.08 | 0 → 0 | linear → exponential | - → - |
| rev_up | 0.47 / 0.23 → 0.69 / 0.14 | -15.8 → -15.8 | no → no | 0.45 → 0.34 | 0.00 → 0.08 | 3 → 47 | exponential → exponential | - → - |
| revive | 0.44 / 0.36 → 0.68 / 0.27 | -10.7 → -10.7 | no → no | 0.12 → 0.01 | 0.00 → 0.05 | 0 → 4 | linear → exponential | - → - |
| ricochet | 0.14 / 0.12 → 0.33 / 0.15 | -19.7 → -19.7 | no → no | 0.03 → 0.44 | 0.00 → 0.03 | 0 → 0 | linear → exponential | toy → - |
| roll | 0.26 / 0.15 → 0.50 / 0.09 | -19.9 → -19.9 | no → no | 0.93 → 0.24 | 0.00 → 0.16 | 4 → 28 | exponential → exponential | - → - |
| scrap | 0.24 / 0.14 → 0.44 / 0.23 | -9.8 → -9.8 | no → no | 0.16 → 0.03 | 0.00 → 0.01 | 0 → 0 | linear → exponential | - → - |
| set_done | 1.00 / 0.95 → 1.08 / 0.46 | -6.9 → -6.9 | no → no | 0.06 → 0.06 | 0.00 → 0.07 | 1 → 0 | linear → exponential | toy → - |
| shot | 0.25 / 0.19 → 0.41 / 0.15 | -15.3 → -15.3 | no → no | 0.12 → 0.16 | 0.00 → 0.02 | 0 → 15 | exponential → exponential | - → - |
| sign_drop | 0.39 / 0.32 → 0.37 / 0.19 | -13.9 → -13.9 | no → no | 1.00 → 0.17 | 0.00 → 0.02 | 9 → 67 | linear → exponential | toy → - |
| slug_ready | 0.13 / 0.11 → 0.40 / 0.17 | -11.8 → -11.8 | no → yes | 0.06 → 0.21 | 0.00 → 0.14 | 6 → 0 | linear → exponential | toy → - |
| stripes_on | 0.27 / 0.15 → 0.34 / 0.18 | -15.2 → -15.2 | no → no | 0.12 → 0.29 | 0.00 → 0.05 | 0 → 0 | linear → exponential | toy → - |
| stun | 0.25 / 0.18 → 0.39 / 0.18 | -17.6 → -17.6 | no → no | 0.05 → 0.07 | 0.00 → 0.01 | 0 → 0 | linear → exponential | toy → - |
| swing | 0.17 / 0.12 → 0.28 / 0.12 | -22.1 → -22.1 | no → no | 0.95 → 0.83 | 0.00 → 0.16 | 0 → 0 | linear → exponential | toy → - |
| tell_car | 1.00 / 0.59 → 1.05 / 0.48 | -9.8 → -9.8 | no → no | 0.00 → 0.06 | 0.00 → 0.07 | 0 → 0 | linear → exponential | toy → - |
| tell_lanes | 0.75 / 0.66 → 0.81 / 0.34 | -12.8 → -12.8 | no → no | 0.13 → 0.11 | 0.00 → 0.05 | 0 → 3 | exponential → exponential | - → - |
| tell_magnet | 0.85 / 0.48 → 0.94 / 0.34 | -7.7 → -7.7 | no → no | 0.19 → 0.28 | 0.00 → 0.02 | 0 → 22 | linear → exponential | - → - |
| tell_mimic | 0.45 / 0.40 → 0.59 / 0.20 | -16.2 → -16.2 | no → no | 0.99 → 0.17 | 0.00 → 0.01 | 0 → 0 | linear → exponential | toy → - |
| tell_thrower | 0.43 / 0.18 → 0.56 / 0.24 | -14.1 → -14.1 | no → no | 0.06 → 0.07 | 0.00 → 0.07 | 0 → 0 | linear → exponential | - → - |
| tell_tout | 0.41 / 0.36 → 0.61 / 0.20 | -13.4 → -13.4 | no → no | 0.09 → 0.01 | 0.00 → 0.00 | 0 → 0 | linear → exponential | - → - |
| throw | 0.21 / 0.17 → 0.30 / 0.14 | -20.6 → -20.6 | no → no | 0.98 → 0.99 | 0.00 → 0.25 | 1 → 1 | exponential → exponential | toy → - |
| tout_off | 0.41 / 0.36 → 0.46 / 0.23 | -14.1 → -14.1 | no → no | 0.05 → 0.04 | 0.00 → 0.01 | 0 → 0 | linear → exponential | toy → - |
| tram_bell | 0.50 / 0.42 → 0.79 / 0.40 | -11.6 → -11.6 | no → no | 0.00 → 0.05 | 0.00 → 0.02 | 0 → 0 | linear → exponential | toy → - |
| tram_pass | 1.75 / 0.86 → 1.60 / 0.71 | -14.9 → -14.9 | no → no | 0.88 → 0.22 | 0.00 → 0.25 | 5 → 61 | exponential → exponential | toy → - |
| wall_thud | 0.26 / 0.23 → 0.45 / 0.24 | -16.7 → -16.7 | no → yes | 0.93 → 0.07 | 0.00 → 0.01 | 10 → 86 | exponential → exponential | toy → - |
| wave_warn | 0.33 / 0.30 → 0.60 / 0.34 | -11.3 → -11.3 | no → no | 0.03 → 0.00 | 0.00 → 0.10 | 0 → 0 | exponential → exponential | toy → - |
| wipe | 0.36 / 0.31 → 0.31 / 0.13 | -19.6 → -19.6 | no → no | 0.99 → 0.99 | 0.00 → 0.41 | 0 → 1 | linear → exponential | toy → - |
| wreck_break | 0.35 / 0.27 → 0.38 / 0.21 | -17.0 → -17.0 | no → no | 0.97 → 0.17 | 0.00 → 0.02 | 1 → 61 | exponential → exponential | toy → - |
| zap | 0.18 / 0.17 → 0.29 / 0.17 | -19.3 → -19.3 | no → no | 0.56 → 0.22 | 0.00 → 0.02 | 0 → 0 | linear → exponential | - → - |

(Widths are small numbers by nature: 0.04 means the sides carry 4 % of the middle's energy, mostly the room and the noise layers; a
fully decorrelated stereo noise reads 1.)

**Music:**

| song | made as | tempo | loudness | width | movement (dB per 20 ms) | below 150 Hz | report advice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| undertow (the Gutter Market's fights) | "dungeon" chip voice → `synthwave`, A minor | 96 → 118 | -16.3 → -16.3 LUFS | 0.17 → 0.15 | 1.3 → 3.5 | 35 → 69 % | 4 → 0 |
| mother_coil (the boss) | "boss" chip voice → `synthwave`, A minor, the same theme faster | 150 → 140 | -15.2 → -15.2 LUFS | 0.006 → 0.14 | 3.4 → 3.1 | 61 → 70 % | 6 → 0 |
| den (the hub) | "calm village" chip voice → `synthwave night`, D minor | 84 → 92 | -17.1 → -17.1 LUFS | 0.05 → 0.34 | 1.3 → 3.2 | 22 → 46 % | 4 → 0 |

This first pass left two faults, both fixed in the second pass below: the fight and boss tracks were bass-heavy (about 70 % of the
energy below 150 Hz), which a handheld's speaker cannot play, and the loops were 8 bars (16 and 14 seconds).

## Second pass: small speakers, song forms, variation (2026-11-21)

**Again, plainly: nothing in either pass has been listened to by a person.** Every number here is a measurement of an offline render.
No handheld or phone speaker was measured; "a small speaker" below is a model (a second-order high-pass at 200 Hz). The owner's ears on
the Retroid are still the test.

**Small speakers.** A handheld's or a phone's speaker plays little below about 200 Hz and nearly nothing below 100. `sound_report` now
says for every sound how much of its energy lies below 200 Hz and how much quieter it would be through such a speaker, and **warns**
when more than 60 % lies below it ("most of the energy is below what a handheld's or a phone's speaker plays: add harmonics or a layer
an octave up", with the settings to change). Before this pass, 17 of Neon Undertow's 70 effects and two of its three songs crossed that
line (the worst, `wall_thud`, had 98 % below 200 Hz and would have been 10 dB quieter on the speaker). What changed:

- Effects: the "thump" used by the purposes and the game's recipes is now two layers: the pure sine kept low (for headphones) and a
  triangle knock an octave up through a low-pass, whose harmonics the speaker plays. The purposes `heavy_hit`, `door` and `locked` were
  moved up. The report's advice for a hit without weight now suggests that knock, not a pure sub.
- Songs: the `punch` kit's kick gained a knock that falls from 260 to 150 Hz with a third harmonic over its low body; the synthwave and
  boss basses are brighter saws (cutoff 850 to 1100 Hz, a little `distortion` in their `fx`, the `sub` down to 0.08 to 0.15), and the
  moods that drive have a second bass track, `bass_hi`, playing the bass line an octave up and quieter. The drum tracks are a little
  quieter in the mix (the drums alone had been as loud as the whole song).

| | below 200 Hz | through a small speaker |
| --- | --- | --- |
| effects over 60 % below 200 Hz | 17 of 70 → 0 of 70 (the most now 58 %) | worst 10.2 dB quieter → 4.3 dB |
| undertow | 79 % → 44 % | 5.9 → 2.5 dB quieter |
| mother_coil | 79 % → 45 % | 5.9 → 2.6 dB quieter |
| den | 56 % → 25 % | 3.4 → 1.5 dB quieter |

The effects that moved most (below 200 Hz in %, speaker loss in dB, level, file length, transient; before → after):

| effect | below 200 Hz | loss | level | length | transient |
| --- | --- | --- | --- | --- | --- |
| banner_boss | 82 → 36 | 6.0 → 2.6 | -17.6 → -17.6 | 1.00 → 1.05 | yes → yes |
| banner_elite | 70 → 57 | 4.8 → 3.1 | -15.8 → -15.8 | 0.61 → 0.58 | yes → yes |
| blast | 87 → 57 | 7.1 → 3.4 | -15.7 → -15.7 | 1.00 → 1.03 | yes → no |
| boss_burst | 83 → 54 | 6.0 → 3.2 | -16.7 → -16.7 | 0.93 → 0.93 | yes → no |
| boss_die | 80 → 51 | 6.6 → 3.3 | -16.9 → -16.9 | 1.46 → 1.49 | yes → yes |
| car_slam | 77 → 54 | 5.7 → 2.8 | -16.5 → -16.5 | 0.57 → 0.55 | no → no |
| door_open | 81 → 55 | 5.6 → 2.2 | -15.6 → -15.6 | 0.59 → 0.59 | no → no |
| door_shut | 96 → 23 | 8.4 → 2.0 | -16.0 → -16.0 | 0.47 → 0.46 | no → no |
| enemy_die | 73 → 28 | 4.4 → 1.7 | -16.4 → -16.4 | 0.45 → 0.44 | no → yes |
| hit | 91 → 36 | 5.3 → 2.0 | -16.1 → -16.1 | 0.32 → 0.30 | yes → yes |
| magnet_slam | 91 → 40 | 8.3 → 2.4 | -16.3 → -16.3 | 0.49 → 0.48 | no → no |
| rev_up | 65 → 34 | 4.0 → 1.8 | -15.8 → -15.8 | 0.69 → 0.66 | no → no |
| shot | 71 → 27 | 3.4 → 1.3 | -15.3 → -15.3 | 0.41 → 0.40 | no → no |
| sign_drop | 70 → 35 | 4.5 → 1.9 | -13.9 → -13.9 | 0.37 → 0.37 | no → no |
| tram_pass | 67 → 58 | 4.4 → 2.5 | -14.9 → -14.9 | 1.60 → 1.60 | no → no |
| wall_thud | 98 → 46 | 10.2 → 2.7 | -16.7 → -16.7 | 0.45 → 0.46 | yes → no |
| wreck_break | 66 → 28 | 4.0 → 1.6 | -17.0 → -17.0 | 0.38 → 0.38 | no → no |

Every effect kept its level exactly (the `loudness` match). Three lost the report's "transient" mark (`blast`, `boss_burst`,
`wall_thud`): the knock's harmonics now fill the highs right after the crack too, so the crack stands out less against them by the
report's measure. Whether that is heard as a softer hit is for a listener to say. The report calls none of the 70 toy-like.

**Song forms.** `song_make` now writes a song in sections by default: an intro that plays once (pads and the arpeggio, hats, a snare roll
that stops short of the loop), then A (the tune), B (its own tune on other chords, the bass pushing octaves, the hats opening, a kick
before each bar), a break (the drums drop out, held bass and pads, a roll), and A again (the tune with a third over it, the hats
doubled), with a fill at the end of every section and a crash where the next one starts. That is 32 bars, or 40 for a fast song (a
second B) so the loop lasts 50 seconds or more. The song's `loop` runs from the first A to the end, and the game follows it:
`song_write` now writes a song's loop region as the Ogg's `LOOPSTART`/`LOOPLENGTH`, the renderer wraps the last notes', echoes' and
reverb's tails onto the loop's start (not the intro), and the seam is judged there. The loop comes back from the last A's fill into the
first A, as any section goes to the next. `form: "loop"` gives the old 8-bar loop. `sound_report` warns when a looping piece repeats in
under 45 seconds (a jingle or sting under 10 seconds is left alone).

| song | before (first pass) | now | loop | below 200 Hz | width | movement |
| --- | --- | --- | --- | --- | --- | --- |
| undertow | 16.3 s, all of it looping | 65.1 s: intro, A, B, break, A again | 57 s, from bar 5 | 79 → 44 % | 0.15 → 0.24 | 3.5 → 4.7 dB |
| mother_coil | 13.7 s | 68.6 s: intro, A, B, B, break, A again (140 bpm) | 62 s | 79 → 45 % | 0.14 → 0.23 | 3.1 → 4.9 dB |
| den | 20.9 s | 83.5 s: intro, A, B, break, A again (92 bpm) | 73 s | 56 → 25 % | 0.34 → 0.40 | 3.2 → 5.0 dB |

Each kept its loudness (-16.3, -15.2 and -17.1 LUFS) through the master's `lufs`; the report finds no warning and no advice on them.

**`dash_attack`** (added by another agent in the plain voice: a rising burst of held-step noise) is now in `tools/sounds.mjs`: a pink-noise
whoosh that rises for 0.13 s and ends in a sharp crack with a low thump (a knock and a sub) and a crunch, at its old level (-18.9 dB).

**Variation per play.** The game now plays its most repeated sounds with `vary`: the baton swing (0.03, small, since its pitch already
climbs with the chain), the hit (0.06), the dash attack (0.04), shots (0.05), the roll (0.05), enemy deaths (0.06), wreckage, bottles,
thuds, the boss's bursts and clangs, the car's slams, ricochets, throws, spits and zaps (0.05 to 0.06), and scrap pickups (0.02, since
their pitch climbs with the count). Not the menus, the banners or the tells, whose pitch carries meaning. The game has no footstep sounds.

## Looping surface sounds: "a bunch of suction cups" (2026-11-21)

The owner played Pine Ridge Rally on the handheld: the gravel "seems like a bunch of suction cups going on and off". The cause was the
loop, not the game's volume steering (the mixer glides every `nova.sound.set` over about 10 ms, and the game steers it every step). Measured
on the old `tyre_gravel.wav` (2.97 s, built round the circle so it had no seam): its bed was noise through one narrow 320 Hz hump (three
spectral lines of 6 to 8 % at 332, 423 and 483 Hz: a faint pitch) multiplied by an 8 to 50 Hz random swell (depth 0.5, floor 0.25), under
228 sharp, ringing grains a second in six narrow bands (38 a second each, Q 2.5 to 4). The 1 ms level had a spread (CV) of 0.57 (plain noise
of the same spectrum: 0.12) and 52 % of the level's movement lay between 16 and 64 Hz (noise: 19 %): a flutter of roughly 30 times a second
plus pips well apart enough to be heard one by one. Dirt (CV 0.50, 39 % flutter) and snow (CV 0.56, 48 %; its "creak" swell ran at 12 to 45
Hz) had the same fault; tarmac (CV 0.31, 17 %) and sand did not (its ripple is the low band's own, no flutter).

What a loose surface needs: a dense, broadband texture (thousands of small random grains a second, far past what the ear separates, under a
bed of filtered noise), no pitch, and only a slow breath of level (under 4 Hz). `driving_sounds_make` now makes `tyre_gravel`, `tyre_dirt`
and `tyre_snow` that way (CV 0.26, 0.28, 0.35; flutter 18, 17, 17 %; no spectral line above 2 %), and two layers of their own: `tyre_slide` (the
spray of a sideways slip: brighter, smoother) and `stone` (four takes of a short dry tock; played now and then at speed, a few a second at most). In
the game (`lib/audio.lua`) speed and slip are smoothed over time, every surface in the mix has a weight that fades in and out (an equal-power
crossfade when the surface changes) instead of a loop that is stopped and started, and the slide layer follows the slip. The new loops are
about 2 dB louder than the old ones at the same RMS (they are brighter: K-weighted loudness), so the game's gains were lowered to keep the mix.
Nobody has listened to it: a test (`studio/mcp/makers/engine.test.ts`) keeps the numbers above from sliding back, which is not the same as
the sound being good.

## The piano's twang (Fernhollow, 2026-11-22)

The owner, of Mountain Post's felt-piano piece on the handheld: "The piano sounds kinda twangy and annoying still." The piece was already
dull (little above 2.5 kHz), so the cause was looked for in the `piano` voice itself, on single notes (C2 to C6, `vel` 0.35 and 0.65,
`brightness` 0.34, rendered by `renderSong` and measured partial by partial with a windowed DFT). Before → after:

| what | before | after | a soft felt piano |
| --- | --- | --- | --- |
| beating of the two strings (a partial's level against its own smooth fall, 0.2 to 2.9 s) | equal strings, a random detune per partial: dips of 42 to 46 dB (C4's 3rd, C5's 1st and 2nd, C6's 1st and 2nd: the fundamental of a held C5 or C6 vanishes a second or two in) | the second string at 0.3 of the first, one detune for the pair (0.25 to 0.6 cents): 0.4 to 1.5 dB in C2 to C4, 5 to 7 dB in C5 and C6 | slow, shallow beats under 1 Hz |
| C6's centroid from 0.3 to 1 s | rises 1.2 → 2.8 kHz (the fundamental cancels) | falls 1.06 → 1.05 kHz | falls (it mellows) |
| partials 2 and 3 under the first, soft C4 | -3.9, -7.0 dB (a sawtooth's 1/k) | -6.6, -11.3 dB; the 10th -42 dB | 6 to 12 dB a partial |
| above 2.5 kHz, soft C4 / C5 (0.5 s) | -31.7 / -23.9 dB | -45.5 / -34.9 dB | nearly absent |
| the hammer's comb (partials 9 to 14 against 8) in C2 and C3 | a second hump 8 to 13 dB over the 8th, ringing 4 to 10 s (600 Hz to 1.8 kHz: nasal) | the comb shallow (0.7 to 1): partials keep falling | no hump |
| high partials' fall, soft C4 (T60) | irregular, 2.6 to 9 s for 2 to 4 kHz | 3.5 s at 2.4 kHz down to 1.8 s at 4.2 kHz; the fundamental 14.6 s | the higher, the faster |
| attack (10 to 90 %) | 4 to 28 ms | 4.5 to 21 ms (a sin² rise of 5 to 18 ms, longer soft and in the bass) plus a 300 Hz felt thump (+11 dB below 400 Hz in the first 23 ms) | 5 to 15 ms, rounded |
| damper, C4 key-up (level at 50 / 200 / 400 ms) | -1.8 / -7.1 / -23.6 dB: a straight fade that holds, then drops in its last 130 ms | -6.5 / -22 / -51 dB, the high partials first, a faint thump | a quick, gentle fall |
| inharmonicity (8th partial, C4 / C5) | +6 / +10.5 cents | the same | a few cents to tens: not the cause |
| energy off the partials | -33 to -37 dB | the same | |

So the twang was the deep, independent beating of every partial (each one swelling and vanishing on its own clock, which reads as a
"wah" and a thin, nasal sustain), helped by the sawtooth-like spectrum, the comb's hump in the bass that rang on, and the damper's late
drop. The voice (`pianoVoice` in studio/src/lib/song.ts) now has a steep felt low-pass above a corner that a harder note and `brightness`
raise, a gentle `1/k^tilt`, a quieter second string with one detune, decay rates that grow with the partial's frequency, and its own
damper over the track's `release` (renderSong holds the envelope at its level after the key is let go and lets the voice fall). Every
other instrument renders byte for byte as before (checked on every wave with plain, rich and room settings, every preset and both
alternative Fernhollow voices). A test ("a felt piano, not a twang", song-tools.test.ts) keeps the soft spectrum, the shallow beating, the
mellowing, the rounded start and the damper's fall. The piece itself (whole song, old voice → new): centroid 638 → 494 Hz; 1 to 2.5 kHz
-8.7 → -12.4 dB and 2.5 to 5 kHz -19.2 → -29.5 dB of the whole. **Nobody has listened to it**: the numbers say it is softer and steadier,
not that it pleases.

## Layered music that follows the game (Fernhollow, 2026-11-23)

The owner: "pretty simple when not in the vehicle, then as the player drives more and more layers can come on", and then "for stopping,
the layers should start to fade as the speed slows". Nova already had `nova.music.layers` / `nova.music.layer` (stems started together,
a level per stem, changes on a steady bar grid). What was missing, and is now there:

- **Making the stems.** `song_write` takes `stems` and writes one Ogg per stem (`renderStems` in song.ts): each the song with only its
  tracks heard, the same length and loop points, the room shared out exactly (the reverb is linear, so the stems' rooms add up to the
  song's), and **one gain for all**, from their sum: the master's `lufs` and `limit` are met by the stack, not by each stem (the
  studio's Stems export brought every stem up to the target on its own, so a soft bass came out as loud as the tune). The master's
  effects, the soft clip of fuller songs and the peak guard act on a whole mix and would not add up, so stems leave them out
  (`renderSong(song, rate, { linear: true })`; a test checks that the stems add up to the song).
- **The piece's own bar lines.** A song whose tempo eases has no steady bar, so a fixed `bpm` drifts off its bar lines within a few
  sections. `song_write` writes the bar lines into each Ogg (the WAV's `cue ` points, which `nova-ogg` keeps as the comment `BARS`), and
  `nova.music.layers` uses the first stem's: `at = "bar"` lands on the piece's next bar line, round the loop too.
- **Sample-locked stems.** Before, a stem whose decoder fell behind played silence and stood still while the others ran on: it came back
  late and stayed late. Now if any stem has not got the next block decoded, all of them wait (the music is silent for that moment and it is
  counted as underruns), so they cannot drift. And `nova.music.position` now wraps at a file's loop points (it wrapped only at the end).
- **The latest request wins:** a level change asked for `now` drops one of the same stem still waiting for a bar line (so a layer that
  was about to come in does not jump back up after the van has slowed).

The cost on a handheld: every stem is decoded all the time, heard or not; five stems are five decoder threads, five rings of 1.5 s of
decoded audio (256 KB each) and the compressed files in memory (Fernhollow: about 11 MB for five 206 s stems; the noisy brushes stem is
the biggest, 3.8 MB). Decoding Vorbis is a small share of one core per stem; it has not been measured on the Retroid.

The game's side (`examples/mountain-post/lib/music.lua`) is a small rule, `music.step`, the same one the audition clip uses (it runs
in the game through `music.simulate`). It earns layers with steady driving and lets them in on bar lines, but on the way down it follows
the speed at once (no bar lines: the owner wanted them to thin as the van slows), eased over a second and moved only in steps of 0.05,
so cruising wobbles do not make it pump. Measured offline (whole piece, LUFS): piano -18.0, +bass -17.4, +brushes -16.9, +pad -16.4,
+celesta -16.3; no clicks in any stage or in the drive clip. **Nobody has listened to it.**

## Pieces that take turns (Mountain Post, 2026-11-23)

The owner, of the one looping piece: "Too repetitive." The fix chosen was several pieces that take turns with quiet between them, so
`examples/mountain-post/tools/music.mjs` now builds four pieces from one builder (a piece is its tempo, beats a bar, chords,
left-hand patterns and a `write` that lays out sections note by note; the builder derives the four driving layers from the chords
and the tune, so every piece keeps them) and `lib/music.lua` plays them as a shuffled playlist. What it took in Nova:

- **Pieces that end.** `nova.music.layers(names, { loop = false })` plays the stems once; they end together and their decoders stop.
  A song for this has no `loop` and ends on rests: the renderer wraps tails that run past the end onto the start, so the last bar
  should be silence long enough for the room (3 to 4 s here); sound_report then finds no click at either end.
- **Starting without a burst.** `nova.music.prepare(names, { loop = false })` starts the stems' decoders ahead; the next
  `nova.music.layers` of the same names takes them with their opening decoded. Call it a few seconds before, in the quiet.
- **Matching the pieces.** Each piece's master target is set so that its piano alone measures -18 LUFS; the full stacks came out
  within 0.5 LU of each other without further work, because every piece's layers are made the same way.
- **3/4.** A waltz is `beatsPerBar: 3`; the bar lines (and so `at = "bar"`) follow it.

Costs: every Ogg in `music/` is held compressed from the start (20 stems of about two minutes: 26 MB); one piece is decoded at a
time. **Nobody has listened to the pieces.**

## Not done, and why

- **No listening test.** Measurements are not a listening test; the owner should play the game and say.
- **No shared room.** The game does not use `nova.sound.room`; each effect carries its own short room.
- **No sample libraries.** Recorded impacts and foley would beat synthesis for realism, but downloads need the owner's say-so and a
  licence check. Everything here is synthesised from original code.
- **The sound editor has no controls for layers.** It keeps them when saving and says the sliders are the plain voice; layers are edited in
  the file or with `sfx_write`.
- **Not added:** convolution reverb, per-note filter automation in songs, a song chorus beyond the existing `chorus` effect, noise
  "colours" beyond white and pink, sample-accurate per-play layer choice (groups of variants exist: `.group.json`).
- **The measures have blind spots.** "Noise" is weighted by energy (a hit with a loud thump reads tonal); the transient test needs the
  first 15 ms to be brighter than the next 45, so a sound that starts soft and swells (a tell, a whoosh) has none by design; a "fall"
  is judged from where the sound last stood within 6 dB of its peak. They were tuned on these 69 sounds and the 27 purposes, nothing
  else.
