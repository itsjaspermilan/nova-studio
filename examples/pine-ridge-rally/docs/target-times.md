# How long a made-up course should take

The custom stage and the Daily Race (`lib/generate.lua`) show three target times before a race and the medal after it. They are
worked out, not guessed (`lib/targets.lua`):

```
target = ideal(course, car) x margin[kind of course][class of car][medal]
```

**The ideal** is `racing.ideal_time` (`lib/racing.lua`): the car's own speed profile along the course's racing line, at the share of
grip (0.86) and brakes (0.92) the game's drivers count on at their best, with the hills' pull on the way. A stage is timed from a
standstill at the start line to the finish; a circuit race is its laps, as `ideal lap x laps + 2.5 s` for the standing start. The ideal
already grows with everything that makes a course long or hard: its length, how many bends and how tight (each bend's speed is what
the tyres can hold), the surface (gravel, sand and snow hold less), the hills, and the car (its power, gears, grip, brakes, and how it
copes off tarmac). So the margins need only what the ideal leaves out.

**The margins** come from the game's own drivers. Each drove the same 36 made-up courses alone (no traffic), from the green light to
the finish: the computer at its best (the autopilot, F9), and the three rivals on Normal (Mika, Dax and Rosa: `lib/race.lua`'s RIVALS
times `state.rival_levels` Normal). The 36 cover both kinds (18 stages, 18 circuits of their own laps), every bends setting, every
length (Short to Epic), all five places, tarmac, loose and mixed surfaces, all three hills settings, and a road car (Apex GT, "sport")
and a 4x4 (Outback, "everyday"). Every run finished; one (ZS6G-DC8M, a fast flowing tarmac stage in the road car) put the three
quickest drivers briefly off the road.

Their time divided by the ideal, by kind of course and class of car (mean, and the slowest 10%):

| Course, car | Autopilot | Mika (best rival) | Dax | Rosa (slowest) |
| --- | --- | --- | --- | --- |
| stage, road car (10) | 1.034 (p90 1.124) | 1.042 (1.125) | 1.057 (1.127) | 1.071 (1.095) |
| stage, 4x4 (8) | 1.003 (1.011) | 1.009 (1.020) | 1.021 (1.040) | 1.039 (1.066) |
| circuit, road car (10) | 1.058 (1.084) | 1.069 (1.100) | 1.088 (1.110) | 1.112 (1.131) |
| circuit, 4x4 (8) | 1.043 (1.066) | 1.052 (1.079) | 1.074 (1.098) | 1.096 (1.133) |

What made a difference, and what did not:

- **Stage or circuit**: circuits are 2 to 4% slower against their ideal (a standing start on the grid, and laps of many corners the
  drivers take a little under the profile). A term of its own.
- **Class of car**: the 4x4 drives within about 1% of its ideal on a stage; the road car, faster and more nervous on loose ground,
  3 to 4%. A term of its own (the data has one car of each class: the other cars of a class are assumed to behave like it).
- **Bends and surface**: a fit of each driver's ratio on the tight bends a kilometre and the share of loose road gave small,
  *negative* coefficients (-0.7% per tight bend a km, -0.9% for all-loose; residual spread 2.7 to 3.1%): the ideal already charges
  for both, slightly too much if anything. No term.
- **Length**: means of 1.03 to 1.05 for the autopilot at every length (Short to Epic). No term.

**The margins chosen**: gold at about the best rival's mean (a clean, fast run: Mika's pace), silver at about Dax's mean (a decent
run), bronze at the slowest rival's slow end plus 3% (a finish without big mistakes: Rosa's 90th percentile, then room for one or two
moments off line):

| | gold | silver | bronze |
| --- | --- | --- | --- |
| stage, road car | 1.045 | 1.065 | 1.13 |
| stage, 4x4 | 1.015 | 1.03 | 1.10 |
| circuit, road car | 1.07 | 1.09 | 1.16 |
| circuit, 4x4 | 1.055 | 1.08 | 1.165 |

With them the drivers' medals over the 36 courses are: autopilot 30 gold, 5 silver, 1 bronze; Mika 25 gold, 9 silver, 2 bronze; Dax 7
gold, 17 silver, 12 bronze; Rosa 2 gold, 8 silver, 26 bronze; nobody went without a medal. A rally stage's section "times to beat" on a
made-up stage are each section's ideal at the gold pace.

**How long that is, in seconds**: a Short (2 km) stage takes a road car about 50 to 85 s ideal depending on its bends and surface, a
Medium (3.5 km) one 90 to 120 s, a Long (5 km) one about 150 to 180 s and an Epic (8 km) one about 225 to 235 s; circuits of 3 Short laps
about 110 to 140 s, of 2 Epic laps about 205 to 265 s (the per-course table below).

## The runs

`TT` lines of `crates/nova-runtime/tests/rally.rs` (`generated_course_times_ideal`, `_mika`, `_dax`, `_rosa`), 2026-11-21, on a desktop.
Columns: the course's code; kind; bends (1 Flowing, 2 Mixed, 3 Technical); length (1 Short to 4 Epic); place (1 Forest, 2 Autumn,
3 Canyon, 4 Snow, 5 Harbour); share of loose road; car class; tight bends (radius under 33 m) a km; the ideal; each driver's ratio.

| Code | Kind | Bends | Len | Place | Loose | Class | Tight/km | Ideal | Auto | Mika | Dax | Rosa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W6MW-WTQZ | stage | 1 | 1 | 1 | 1.00 | sport | 0.00 | 48.6 s | 1.000 | 1.000 | 1.013 | 1.043 |
| MZ33-QNCK | circuit | 1 | 1 | 2 | 1.00 | sport | 0.00 | 110.1 s | 1.046 | 1.057 | 1.076 | 1.103 |
| ALB2-6WYS | stage | 2 | 1 | 3 | 1.00 | sport | 4.23 | 69.6 s | 1.025 | 1.032 | 1.045 | 1.061 |
| H8HS-DRLN | circuit | 2 | 1 | 4 | 1.00 | sport | 0.00 | 116.4 s | 1.081 | 1.086 | 1.100 | 1.124 |
| XMD5-U28M | stage | 3 | 1 | 5 | 0.00 | everyday | 4.03 | 83.8 s | 0.995 | 1.003 | 1.013 | 1.032 |
| 3857-9QQW | circuit | 3 | 1 | 1 | 0.00 | everyday | 0.00 | 140.0 s | 1.044 | 1.055 | 1.090 | 1.133 |
| JFF5-S3CQ | stage | 1 | 2 | 2 | 0.00 | everyday | 0.00 | 110.0 s | 1.000 | 1.002 | 1.008 | 1.016 |
| A9UA-KVYQ | circuit | 1 | 2 | 3 | 0.00 | everyday | 0.00 | 198.7 s | 1.046 | 1.050 | 1.062 | 1.073 |
| WV49-26LY | stage | 2 | 2 | 4 | 0.00 | sport | 1.09 | 92.1 s | 1.028 | 1.041 | 1.051 | 1.064 |
| JVHK-ZZ8L | circuit | 2 | 2 | 5 | 0.00 | sport | 0.56 | 166.5 s | 1.041 | 1.053 | 1.083 | 1.105 |
| K94F-45QZ | stage | 3 | 2 | 1 | 0.69 | sport | 2.74 | 117.2 s | 1.028 | 1.039 | 1.058 | 1.080 |
| B3HK-VYCZ | circuit | 3 | 2 | 2 | 0.68 | sport | 0.69 | 181.6 s | 1.042 | 1.054 | 1.077 | 1.098 |
| SATJ-EAYV | stage | 1 | 3 | 3 | 0.69 | everyday | 0.00 | 149.2 s | 1.004 | 1.008 | 1.020 | 1.033 |
| J58P-85LU | circuit | 1 | 3 | 4 | 0.68 | everyday | 0.00 | 189.3 s | 1.038 | 1.044 | 1.055 | 1.069 |
| YJ42-NE8V | stage | 2 | 3 | 5 | 0.31 | everyday | 1.66 | 178.9 s | 1.011 | 1.018 | 1.035 | 1.054 |
| Z92E-M4QW | circuit | 2 | 3 | 1 | 1.00 | everyday | 0.00 | 199.9 s | 1.038 | 1.048 | 1.086 | 1.111 |
| MUAD-3DCM | stage | 3 | 3 | 2 | 1.00 | sport | 2.55 | 163.0 s | 1.044 | 1.048 | 1.067 | 1.091 |
| DNPH-V7YQ | circuit | 3 | 3 | 3 | 1.00 | sport | 1.08 | 183.5 s | 1.063 | 1.076 | 1.089 | 1.112 |
| KPRU-J4LQ | stage | 1 | 1 | 4 | 1.00 | sport | 0.00 | 56.9 s | 0.992 | 1.006 | 1.031 | 1.063 |
| 5BSE-BX8U | circuit | 1 | 1 | 5 | 0.00 | sport | 0.00 | 107.3 s | 1.054 | 1.063 | 1.081 | 1.117 |
| 5PD9-E3QP | stage | 2 | 1 | 1 | 0.00 | everyday | 1.93 | 70.6 s | 0.998 | 1.004 | 1.010 | 1.030 |
| CBKZ-LWCN | circuit | 2 | 1 | 2 | 0.00 | everyday | 1.04 | 157.5 s | 1.066 | 1.079 | 1.094 | 1.112 |
| YWTY-36YY | stage | 3 | 1 | 3 | 0.00 | everyday | 4.99 | 85.1 s | 0.996 | 1.002 | 1.017 | 1.042 |
| QR94-UZLN | circuit | 3 | 1 | 4 | 0.00 | everyday | 0.00 | 141.4 s | 1.035 | 1.043 | 1.061 | 1.086 |
| ZS6G-DC8M | stage | 1 | 2 | 5 | 0.00 | sport | 0.00 | 77.1 s | 1.124 | 1.125 | 1.127 | 1.054 |
| 5CWH-T2QV | circuit | 1 | 2 | 1 | 0.68 | sport | 0.00 | 152.1 s | 1.084 | 1.089 | 1.098 | 1.111 |
| RY6G-9BCX | stage | 2 | 2 | 2 | 0.69 | sport | 0.28 | 93.7 s | 1.023 | 1.030 | 1.043 | 1.066 |
| L6YE-95YL | circuit | 2 | 2 | 3 | 0.68 | sport | 0.83 | 188.4 s | 1.034 | 1.046 | 1.075 | 1.097 |
| 8S8C-PELL | stage | 3 | 2 | 4 | 0.69 | everyday | 2.85 | 147.3 s | 1.009 | 1.020 | 1.040 | 1.066 |
| SE8W-H98K | circuit | 3 | 2 | 5 | 0.32 | everyday | 0.14 | 214.7 s | 1.040 | 1.063 | 1.098 | 1.129 |
| 2MW3-Y9QR | stage | 1 | 4 | 1 | 1.00 | everyday | 0.00 | 234.2 s | 1.009 | 1.012 | 1.022 | 1.038 |
| SGB8-S4CR | circuit | 1 | 4 | 2 | 1.00 | everyday | 0.00 | 263.5 s | 1.035 | 1.038 | 1.043 | 1.053 |
| F3K7-8CYZ | stage | 2 | 4 | 3 | 1.00 | sport | 0.74 | 224.5 s | 1.028 | 1.040 | 1.063 | 1.095 |
| MPRX-F7LW | circuit | 2 | 4 | 4 | 1.00 | sport | 0.21 | 251.4 s | 1.053 | 1.064 | 1.086 | 1.119 |
| 44MA-VG8L | stage | 3 | 4 | 5 | 0.00 | sport | 3.21 | 227.2 s | 1.045 | 1.054 | 1.071 | 1.090 |
| 7PDC-B6QK | circuit | 3 | 4 | 1 | 0.00 | sport | 0.21 | 205.4 s | 1.084 | 1.100 | 1.110 | 1.131 |

To measure again (after changing the generator, the drivers, the cars or `racing.lua`), run the four tests side by side and redo the
tables from their `TT` lines:

```sh
scripts/env.sh cargo test --release -p nova-runtime --test rally generated_course_times -- --ignored --nocapture --test-threads 4
```

## What this does not know

- Nobody has driven these courses with a pad. The drivers are the game's computer drivers; a person on a handheld may well be slower
  than Rosa at first, which would make bronze hard. Watch the first players' Daily results and widen bronze if few get a medal.
- One car of each class was driven. The other road cars (from the Pip to the Kestrel GT2) and 4x4s (up to the 6x6) get the same
  margins over their own ideal; their own ideal differs a lot, but how near a driver gets to it may differ too.
- The drivers drove alone. A circuit race with rivals adds traffic, which costs the player a little more than the table shows.
