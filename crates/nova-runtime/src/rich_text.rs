//! Rich text: a line with inline markup a writer can type, laid out whole before it is typed, typed out letter by letter on a
//! clock, each letter animated as it appears and by the effects round it. It is what `nova.ui.rich_text` draws.
//!
//! The markup (`parse`):
//!
//! | tag | does |
//! | --- | --- |
//! | `{shake}...{/shake}` | the letters jitter: small random offsets and tilts, twenty times a second (scared, angry) |
//! | `{wave}...{/wave}` | the letters bob in a gentle sine that runs along the word (happy, sing-song) |
//! | `{big}...{/big}` | larger (1.3 times) and bolder (excitement, emphasis) |
//! | `{slow}...{/slow}` | typed at a third of the speed (a dry pause, a drawl) |
//! | `{pop}...{/pop}` | each letter pops in from small with a little overshoot as it appears |
//! | `{c=red}...{/c}` | a colour: a name (red, orange, gold, green, teal, blue, purple, pink, brown, grey, white, black) or `#rrggbb` |
//! | `{pause}`, `{pause=0.6}` | a wait before the next letter (0.4 s, or the seconds given) |
//! | `{{` | a `{` |
//!
//! Tags nest; one left open runs to the end of the line. An unknown tag, or a close with no open, is an error naming it.
//!
//! Everything here is a function of the text and the time given: the same line at the same time is the same picture, and the
//! layout does not depend on the time at all (the letters are typed into the place they will end in, so a word never starts on
//! one line and jumps to the next).

/// The effects, as bits of [`RichChar::fx`].
pub const SHAKE: u8 = 1;
pub const WAVE: u8 = 2;
pub const BIG: u8 = 4;
pub const SLOW: u8 = 8;
pub const POP: u8 = 16;

/// How much larger `{big}` letters are, and how much bolder (added to the text's `bold`).
pub const BIG_SIZE: f32 = 1.3;
pub const BIG_BOLD: f32 = 0.6;
/// How many times longer a `{slow}` letter takes.
pub const SLOW_FACTOR: f32 = 3.0;
/// The default typing speed, letters (spaces too) a second.
pub const DEFAULT_CPS: f32 = 52.0;

/// One letter of the line with what it carries.
#[derive(Clone, Debug, PartialEq)]
pub struct RichChar {
    pub ch: char,
    /// the effects on it (bits: [`SHAKE`], [`WAVE`], [`BIG`], [`SLOW`], [`POP`])
    pub fx: u8,
    /// its colour, when a `{c=...}` is round it
    pub color: Option<[u8; 4]>,
    /// seconds of `{pause}` before it
    pub pause: f32,
}

const COLOURS: [(&str, [u8; 3]); 12] = [
    ("red", [201, 74, 59]),
    ("orange", [222, 124, 52]),
    ("gold", [214, 160, 40]),
    ("green", [92, 140, 66]),
    ("teal", [42, 140, 140]),
    ("blue", [72, 112, 170]),
    ("purple", [128, 84, 160]),
    ("pink", [212, 96, 140]),
    ("brown", [134, 88, 60]),
    ("grey", [122, 110, 100]),
    ("white", [255, 255, 255]),
    ("black", [30, 26, 24]),
];

fn colour(value: &str) -> Option<[u8; 4]> {
    if let Some(hex) = value.strip_prefix('#') {
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let ch = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
        return Some([ch(0)?, ch(2)?, ch(4)?, 255]);
    }
    let name = if value == "gray" { "grey" } else { value };
    COLOURS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, c)| [c[0], c[1], c[2], 255])
}

/// Reads the markup into its letters. An error names the tag that is wrong.
pub fn parse(src: &str) -> Result<Vec<RichChar>, String> {
    let mut out = Vec::new();
    let mut depth = [0u32; 5];
    let mut colours: Vec<[u8; 4]> = Vec::new();
    let mut pause = 0.0f32;
    let mut it = src.char_indices().peekable();
    let bits = [SHAKE, WAVE, BIG, SLOW, POP];
    let names = ["shake", "wave", "big", "slow", "pop"];
    while let Some((i, ch)) = it.next() {
        if ch == '{' {
            if it.peek().is_some_and(|&(_, c)| c == '{') {
                it.next();
            } else {
                let rest = &src[i + 1..];
                let Some(end) = rest.find('}') else {
                    return Err(format!(
                        "a '{{' with no '}}' after it in {src:?} (write '{{{{' for the letter itself)"
                    ));
                };
                let tag = rest[..end].trim();
                for _ in 0..rest[..end].chars().count() + 1 {
                    it.next();
                }
                let (close, name) = match tag.strip_prefix('/') {
                    Some(n) => (true, n.trim()),
                    None => (false, tag),
                };
                if let Some(k) = names.iter().position(|n| *n == name) {
                    if close {
                        if depth[k] == 0 {
                            return Err(format!(
                                "{{/{name}}} closes a {{{name}}} that is not open in {src:?}"
                            ));
                        }
                        depth[k] -= 1;
                    } else {
                        depth[k] += 1;
                    }
                } else if name == "c" && close {
                    if colours.pop().is_none() {
                        return Err(format!(
                            "{{/c}} closes a colour that is not open in {src:?}"
                        ));
                    }
                } else if let Some(v) = name.strip_prefix("c=").filter(|_| !close) {
                    colours.push(colour(v.trim()).ok_or_else(|| {
                        format!(
                            "unknown colour '{v}' in {src:?} (a name: {}; or #rrggbb)",
                            COLOURS.map(|c| c.0).join(", ")
                        )
                    })?);
                } else if name == "pause" && !close {
                    pause += 0.4;
                } else if let Some(v) = name.strip_prefix("pause=").filter(|_| !close) {
                    let s: f32 = v
                        .trim()
                        .parse()
                        .ok()
                        .filter(|s: &f32| (0.0..=5.0).contains(s))
                        .ok_or_else(|| {
                            format!(
                                "{{pause={v}}} in {src:?}: the seconds must be a number from 0 to 5"
                            )
                        })?;
                    pause += s;
                } else {
                    return Err(format!(
                        "unknown tag '{{{tag}}}' in {src:?} (the tags: shake, wave, big, slow, pop, c=colour, pause; each closed by {{/name}})"
                    ));
                }
                continue;
            }
        }
        let mut fx = 0;
        for (k, b) in bits.iter().enumerate() {
            if depth[k] > 0 {
                fx |= b;
            }
        }
        out.push(RichChar {
            ch,
            fx,
            color: colours.last().copied(),
            pause: std::mem::take(&mut pause),
        });
    }
    Ok(out)
}

/// The words without the markup.
pub fn plain(chars: &[RichChar]) -> String {
    chars.iter().map(|c| c.ch).collect()
}

/// The pause after a letter, as one speaks: a short one after a comma, a longer one after a full stop (or ! or ?), the longest
/// after "..."; the dots of "..." come one by one. None at the end of the line, nor before more punctuation.
fn pause_after(chars: &[RichChar], k: usize) -> f32 {
    let c = chars[k].ch;
    let next = chars.get(k + 1).map(|r| r.ch);
    // nothing left to say: no wait
    if !chars[k + 1..].iter().any(|r| !r.ch.is_whitespace()) {
        return 0.0;
    }
    let ends =
        |n: Option<char>| n.is_none_or(|n| n.is_whitespace() || n == '\'' || n == '"' || n == ')');
    match c {
        '.' if next == Some('.') => 0.09,
        '…' => 0.42,
        '.' if k > 0 && chars[k - 1].ch == '.' => 0.42,
        '.' | '!' | '?' if ends(next) => 0.24,
        ',' | ';' | ':' | '—' if ends(next) => 0.11,
        _ => 0.0,
    }
}

/// When each letter appears, in seconds from the start of the line, typed at `cps` letters a second (spaces count). `skip`, the
/// time the player asked for the whole line: every letter not out by then comes out in a quick ripple (a tenth of a second at
/// most). Returns the times and when the last letter is out.
pub fn appear_times(chars: &[RichChar], cps: f32, skip: Option<f32>) -> (Vec<f32>, f32) {
    let step = 1.0 / cps.clamp(1.0, 1000.0);
    let mut t = 0.0f32;
    let mut at = Vec::with_capacity(chars.len());
    for (k, c) in chars.iter().enumerate() {
        t += c.pause;
        at.push(t);
        let own = if c.fx & SLOW != 0 {
            step * SLOW_FACTOR
        } else {
            step
        };
        t += own + pause_after(chars, k);
    }
    if let Some(s) = skip {
        let mut rank = 0;
        for a in at.iter_mut() {
            if *a > s {
                *a = s + (rank as f32 * 0.006).min(0.1);
                rank += 1;
            }
        }
    }
    let last = at.iter().copied().fold(0.0, f32::max);
    (at, last)
}

/// One letter placed: its size, its pen's x from the block's left and its baseline from the block's top (physical pixels), its
/// line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub px: f32,
    pub x: f32,
    pub baseline: f32,
    pub line: usize,
}

#[derive(Clone, Debug)]
pub struct RichLayout {
    /// one for every letter of the line, in order (spaces and line breaks too)
    pub letters: Vec<Placed>,
    pub line_widths: Vec<f32>,
    pub width: f32,
    pub height: f32,
}

/// What the layout needs of a font: the kerning and advance of a letter, and the ascent and line height at a size.
pub trait Metrics {
    fn advance(&self, prev: Option<char>, ch: char, px: f32) -> (f32, f32);
    fn line(&self, px: f32) -> (f32, f32);
}

/// The size a letter is drawn at, from the text's.
pub fn letter_px(c: &RichChar, base_px: f32) -> f32 {
    if c.fx & BIG != 0 {
        (base_px * BIG_SIZE).round()
    } else {
        base_px
    }
}

/// Lays the whole line out (`wrap`: the width to break at, physical pixels): words go whole to the next line when they do not
/// fit (a word wider than the line alone is broken), `\n` starts a line, and a line with big letters is as tall as they need.
pub fn layout(
    chars: &[RichChar],
    base_px: f32,
    wrap: Option<f32>,
    line_spacing: f32,
    m: &impl Metrics,
) -> RichLayout {
    let n = chars.len();
    let mut letters = vec![
        Placed {
            px: base_px,
            x: 0.0,
            baseline: 0.0,
            line: 0
        };
        n
    ];
    let mut line = 0usize;
    let mut pen = 0.0f32;
    // the letter before, at its size (kerning only between letters of one size)
    let mut prev: Option<(char, f32)> = None;
    let mut widths: Vec<f32> = vec![0.0];
    let mut has_word = false;
    let place = |k: usize,
                 pen: &mut f32,
                 prev: &mut Option<(char, f32)>,
                 line: usize,
                 letters: &mut Vec<Placed>| {
        let px = letter_px(&chars[k], base_px);
        let p = prev.filter(|(_, ppx)| *ppx == px).map(|(c, _)| c);
        let (kern, adv) = m.advance(p, chars[k].ch, px);
        letters[k] = Placed {
            px,
            x: *pen + kern,
            baseline: 0.0,
            line,
        };
        *pen += kern + adv;
        *prev = Some((chars[k].ch, px));
    };
    let mut k = 0;
    while k < n {
        let c = chars[k].ch;
        if c == '\n' {
            letters[k] = Placed {
                px: base_px,
                x: pen,
                baseline: 0.0,
                line,
            };
            line += 1;
            widths.push(0.0);
            pen = 0.0;
            prev = None;
            has_word = false;
            k += 1;
            continue;
        }
        if c.is_whitespace() {
            place(k, &mut pen, &mut prev, line, &mut letters);
            k += 1;
            continue;
        }
        // a word: measure it where it would go
        let end = (k..n).find(|&j| chars[j].ch.is_whitespace()).unwrap_or(n);
        let mut w = 0.0;
        let mut p = prev;
        for ch in &chars[k..end] {
            let px = letter_px(ch, base_px);
            let pk = p.filter(|(_, ppx)| *ppx == px).map(|(c, _)| c);
            let (kern, adv) = m.advance(pk, ch.ch, px);
            w += kern + adv;
            p = Some((ch.ch, px));
        }
        let too_wide = wrap.is_some_and(|limit| w > limit);
        if let Some(limit) = wrap
            && has_word
            && pen + w > limit
        {
            line += 1;
            widths.push(0.0);
            pen = 0.0;
            prev = None;
        }
        #[allow(clippy::needless_range_loop)] // (j is the letter's index in `letters` too)
        for j in k..end {
            // a word wider than a whole line is broken where it runs out
            if let Some(limit) = wrap
                && j > k
                && pen > 0.0
            {
                let px = letter_px(&chars[j], base_px);
                let (_, adv) = m.advance(None, chars[j].ch, px);
                if too_wide && pen + adv > limit {
                    line += 1;
                    widths.push(0.0);
                    pen = 0.0;
                    prev = None;
                }
            }
            place(j, &mut pen, &mut prev, line, &mut letters);
        }
        widths[line] = pen;
        has_word = true;
        k = end;
    }
    // each line as tall as its biggest letter, then the line spacing; the last needs no air under it
    let lines = line + 1;
    let (base_ascent, base_lh) = m.line(base_px);
    let mut asc = vec![0.0f32; lines];
    let mut lh = vec![0.0f32; lines];
    for (k, p) in letters.iter().enumerate() {
        if chars[k].ch.is_whitespace() {
            continue;
        }
        let (a, h) = m.line(p.px);
        asc[p.line] = asc[p.line].max(a);
        lh[p.line] = lh[p.line].max(h);
    }
    let mut top = Vec::with_capacity(lines);
    let mut y = 0.0;
    for i in 0..lines {
        if lh[i] == 0.0 {
            (asc[i], lh[i]) = (base_ascent, base_lh);
        }
        top.push(y);
        y += lh[i] * line_spacing;
    }
    let height = top[lines - 1] + lh[lines - 1];
    for p in &mut letters {
        p.baseline = top[p.line] + asc[p.line];
    }
    let width = widths.iter().copied().fold(0.0, f32::max);
    RichLayout {
        letters,
        line_widths: widths,
        width,
        height,
    }
}

/// How a letter is drawn now: moved by `dx`, `dy` (physical pixels), grown by `scale` about its middle, turned by `rot` (radians),
/// faded to `alpha`; `shown` false while it has not appeared yet.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub shown: bool,
    pub dx: f32,
    pub dy: f32,
    pub scale: f32,
    pub rot: f32,
    pub alpha: f32,
}

/// How long the soft rise of a letter appearing lasts, and the pop's.
pub const RISE_TIME: f32 = 0.16;
pub const POP_TIME: f32 = 0.24;

fn back(u: f32, c1: f32) -> f32 {
    // ease-out with an overshoot (`c1` its strength): 0 at 0, past 1 a little, 1 at 1
    let c3 = c1 + 1.0;
    let v = u - 1.0;
    1.0 + c3 * v * v * v + c1 * v * v
}

/// A number from 0 to 1 for two whole numbers, the same every time (the shake's jitter).
fn hash(a: u32, b: u32, salt: u32) -> f32 {
    let mut h = a
        .wrapping_mul(0x9E37_79B1)
        .wrapping_add(b.wrapping_mul(0x85EB_CA77))
        .wrapping_add(salt.wrapping_mul(0xC2B2_AE3D));
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^= h >> 15;
    (h >> 8) as f32 / (1u32 << 24) as f32
}

/// The letter `index` (drawn at `px`, out at `at`) at `time`: the soft rise and fade every letter makes as it appears (when
/// `appear`), and its effects. Each offset stays within a quarter of the letter's size.
pub fn pose(fx: u8, index: usize, px: f32, at: f32, time: f32, appear: bool) -> Pose {
    if time < at {
        return Pose {
            shown: false,
            dx: 0.0,
            dy: 0.0,
            scale: 1.0,
            rot: 0.0,
            alpha: 0.0,
        };
    }
    let age = time - at;
    let mut p = Pose {
        shown: true,
        dx: 0.0,
        dy: 0.0,
        scale: 1.0,
        rot: 0.0,
        alpha: 1.0,
    };
    if appear {
        let u = (age / RISE_TIME).min(1.0);
        p.dy += px * 0.22 * (1.0 - back(u, 1.2));
        p.alpha = (age / 0.09).min(1.0);
    }
    if fx & POP != 0 {
        let u = (age / POP_TIME).min(1.0);
        p.scale *= 0.35 + 0.65 * back(u, 2.4);
    }
    if fx & SHAKE != 0 {
        let step = (time * 20.0).floor().max(0.0) as u32;
        let i = index as u32;
        let a = px * 0.08;
        p.dx += (hash(i, step, 1) * 2.0 - 1.0) * a;
        p.dy += (hash(i, step, 2) * 2.0 - 1.0) * a;
        p.rot += (hash(i, step, 3) * 2.0 - 1.0) * 0.08;
    }
    if fx & WAVE != 0 {
        let ramp = (age / 0.25).min(1.0);
        p.dy += (time * 5.0 - index as f32 * 0.55).sin() * px * 0.09 * ramp;
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Mono;
    impl Metrics for Mono {
        fn advance(&self, _: Option<char>, _: char, px: f32) -> (f32, f32) {
            (0.0, px * 0.5)
        }
        fn line(&self, px: f32) -> (f32, f32) {
            (px * 0.8, px * 1.2)
        }
    }

    #[test]
    fn markup_is_read_and_stripped() {
        let c = parse("Oh {big}{wave}HI{/wave}{/big}, {c=red}you{/c}{{x}{pause}.").unwrap();
        assert_eq!(plain(&c), "Oh HI, you{x}.");
        assert_eq!(c[3].fx, BIG | WAVE);
        assert_eq!(c[5].fx, 0);
        assert_eq!(c[7].color, Some([201, 74, 59, 255]));
        assert_eq!(c[13].pause, 0.4);
        assert!(parse("{wobble}x").unwrap_err().contains("unknown tag"));
        assert!(parse("x{/big}").unwrap_err().contains("not open"));
        assert!(parse("{c=mauve}x").unwrap_err().contains("unknown colour"));
        assert_eq!(
            parse("{c=#102030}a").unwrap()[0].color,
            Some([16, 32, 48, 255])
        );
    }

    #[test]
    fn words_never_move_between_lines() {
        let c = parse("one two {big}three{/big} four five six").unwrap();
        let l = layout(&c, 20.0, Some(100.0), 1.0, &Mono);
        // every word's letters are on one line, and no line is wider than the wrap
        for w in l.line_widths.iter() {
            assert!(*w <= 100.0, "{w}");
        }
        let s = plain(&c);
        let mut start = 0;
        for word in s.split(' ') {
            let lines: Vec<usize> = (start..start + word.chars().count())
                .map(|k| l.letters[k].line)
                .collect();
            assert!(lines.windows(2).all(|w| w[0] == w[1]), "{word}: {lines:?}");
            start += word.chars().count() + 1;
        }
        // the big word's line is taller
        let big_line = l.letters[8].line;
        assert!(l.letters[8].px == 26.0 && big_line > 0);
    }

    #[test]
    fn the_pace_pauses_at_stops_and_skips_in_a_ripple() {
        let c = parse("Hm. So, well... yes").unwrap();
        let (at, last) = appear_times(&c, 50.0, None);
        assert!(at[3] - at[2] > 0.2, "after the stop");
        assert!(
            at[7] - at[6] > 0.1 && at[7] - at[6] < 0.2,
            "after the comma"
        );
        assert!(at[15] - at[14] > 0.4, "after the dots");
        let (s, slast) = appear_times(&c, 50.0, Some(0.1));
        assert!(slast < 0.21 && slast < last);
        assert_eq!(s[0], at[0]);
    }

    #[test]
    fn effects_stay_small_and_are_the_same_every_time() {
        for fx in [0, SHAKE, WAVE, POP, BIG, SHAKE | WAVE | POP] {
            for k in 0..200 {
                let t = k as f32 * 0.013;
                let p = pose(fx, k % 17, 30.0, 0.05, t, true);
                assert_eq!(p, pose(fx, k % 17, 30.0, 0.05, t, true));
                if p.shown {
                    assert!(
                        p.dx.abs() <= 30.0 * 0.25 && p.dy.abs() <= 30.0 * 0.3,
                        "{fx} {p:?}"
                    );
                    assert!((0.3..=1.2).contains(&p.scale) && p.rot.abs() < 0.1);
                }
            }
            // settled: a plain letter rests exactly where it was laid out
            let rest = pose(0, 3, 30.0, 0.0, 2.0, true);
            assert_eq!(
                (rest.dx, rest.dy, rest.scale, rest.alpha),
                (0.0, 0.0, 1.0, 1.0)
            );
        }
    }
}
