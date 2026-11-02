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
