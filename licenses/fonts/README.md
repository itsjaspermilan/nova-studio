# Bundled fonts

Embedded in the runtime (`crates/nova-runtime/assets/fonts/`), all under the SIL Open Font License 1.1.
Each font's own licence text sits beside this file. They are used unmodified.

| Name in Nova | Font | Source |
| --- | --- | --- |
| `sans` | Inter | github.com/google/fonts, ofl/inter |
| `rounded` | Fredoka | ofl/fredoka |
| `pixel` | Press Start 2P | ofl/pressstart2p |
| `terminal` | VT323 | ofl/vt323 |
| `mono` | JetBrains Mono | ofl/jetbrainsmono |
| `serif` | Lora | ofl/lora |
| `comic` | Bangers | ofl/bangers |
| `display` | Cinzel | ofl/cinzel |
| `script` | Pacifico | ofl/pacifico |

Downloaded 2026-11-02 from `https://raw.githubusercontent.com/google/fonts/main/ofl/<name>/`.
Inter, Fredoka, JetBrains Mono, Lora and Cinzel are variable fonts: the rasteriser uses their default
weight (it does not apply weight axes).

## Fonts in example projects

| Project file | Font | Source |
| --- | --- | --- |
| `examples/pine-ridge-rally/fonts/barlow_cond_italic.ttf` | Barlow Condensed ExtraBold Italic | ofl/barlowcondensed |
| `examples/pine-ridge-rally/fonts/barlow_cond_heavy.ttf` | Barlow Condensed ExtraBold | ofl/barlowcondensed |
| `examples/pine-ridge-rally/fonts/barlow_cond.ttf` | Barlow Condensed Bold | ofl/barlowcondensed |
| `examples/pine-ridge-rally/fonts/barlow.ttf`, `barlow_medium.ttf`, `barlow_semibold.ttf` | Barlow Regular, Medium, SemiBold | ofl/barlow |

Barlow (Copyright 2017 The Barlow Project Authors, SIL Open Font License 1.1, no reserved font name; `Barlow-OFL.txt`), static
instances, downloaded 2026-11-08 from the same Google Fonts repository and used unmodified (renamed files only).
