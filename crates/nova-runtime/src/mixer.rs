//! The game audio mixer: sound effects and one music track.
//!
//! It is plain data in, samples out: no audio device, no allocation while rendering (voices
//! live in a vector reserved up front), so it can be driven from a real-time audio callback
//! and tested anywhere. Scripts queue [`Command`]s; the host forwards them to the mixer on the
//! audio thread. Samples are 16-bit stereo, played with linear interpolation, so any source
//! rate plays at any device rate and `pitch` is just a faster or slower step.

use std::sync::Arc;

use crate::stream::StreamFeed;

pub const MAX_VOICES: usize = 32;

/// Decoded audio: interleaved stereo 16-bit frames at the file's own rate.
#[derive(Debug)]
pub struct Sample {
    pub rate: u32,
    pub frames: Vec<[i16; 2]>,
}

impl Sample {
    pub fn seconds(&self) -> f32 {
        self.frames.len() as f32 / self.rate.max(1) as f32
    }
}

pub struct Play {
    pub id: u64,
    pub sample: Arc<Sample>,
    /// Streamed music: when set the sound comes from this feed and `sample` is only a placeholder.
    pub stream: Option<StreamFeed>,
    pub volume: f32,
    /// -1 (left) to 1 (right).
    pub pan: f32,
    /// 1 is normal speed and pitch; 2 is an octave up.
    pub pitch: f32,
    pub looping: bool,
    pub music: bool,
    /// Seconds to fade in from silence.
    pub fade_in: f32,
}

pub enum Command {
    Play(Box<Play>),
    /// Stop one voice, fading out over `fade` seconds (0 stops at once).
    Stop {
        id: u64,
        fade: f32,
    },
    StopAll,
    StopMusic {
        fade: f32,
    },
    SfxVolume(f32),
    MusicVolume(f32),
}

/// Where a streamed voice is: the two decoded frames around the playhead.
struct StreamState {
    feed: StreamFeed,
    cur: Option<[i16; 2]>,
    next: Option<[i16; 2]>,
    /// 0 to 1 between `cur` and `next`.
    frac: f64,
    /// The feed has run out for good: the voice ends when it reaches the last frame.
    last: bool,
}

struct Voice {
    id: u64,
    sample: Arc<Sample>,
    stream: Option<StreamState>,
    pos: f64,
    step: f64,
    gain_l: f32,
    gain_r: f32,
    looping: bool,
    music: bool,
    fade: f32,
    fade_step: f32,
    fade_target: f32,
    stopping: bool,
}

pub struct Mixer {
    voices: Vec<Voice>,
    device_rate: u32,
    sfx_volume: f32,
    music_volume: f32,
}

fn pan_gains(volume: f32, pan: f32) -> (f32, f32) {
    // Equal-power pan law: constant loudness from left to right.
    let angle = (pan.clamp(-1.0, 1.0) + 1.0) * std::f32::consts::FRAC_PI_4;
    (volume * angle.cos(), volume * angle.sin())
}

fn soft_clip(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.8 {
        x
    } else {
        x.signum() * (0.8 + 0.2 * ((a - 0.8) / 0.2).tanh())
    }
}

/// Mixes a streamed voice into `out`. The decoder runs on its own thread; here frames are only taken from the ring,
/// and if it is empty the frame is silence (an underrun) and the playhead does not move.
fn render_stream(voice: &mut Voice, volume: f32, out: &mut [f32]) {
    let frames = out.len() / 2;
    let Some(s) = voice.stream.as_mut() else {
        return;
    };
    for frame in 0..frames {
        // Make sure the two frames around the playhead are loaded.
        if s.cur.is_none() {
            s.cur = s.feed.pop();
            s.next = None;
        }
        if s.cur.is_some() && s.next.is_none() && !s.last {
            s.next = s.feed.pop();
            if s.next.is_none() && s.feed.finished() {
                s.last = true;
            }
        }
        let Some(a) = s.cur else {
            if s.feed.finished() {
                voice.pos = f64::INFINITY; // nothing was ever decoded, or it all played already
                return;
            }
            s.feed.note_underrun();
            continue;
        };
        let b = match s.next {
            Some(b) => b,
            None if s.last => a,
            None => {
                s.feed.note_underrun(); // the decoder is behind: silence, and wait here
                continue;
            }
        };
        // Fades only move on frames that are really played, so waiting for the decoder never eats into a fade-in.
        if voice.fade != voice.fade_target {
            if voice.fade < voice.fade_target {
                voice.fade = (voice.fade + voice.fade_step).min(voice.fade_target);
            } else {
                voice.fade = (voice.fade - voice.fade_step).max(voice.fade_target);
            }
            if voice.stopping && voice.fade <= 0.0 {
                voice.pos = f64::INFINITY;
                return;
            }
        }
        let t = s.frac as f32;
        let l = a[0] as f32 + (b[0] as f32 - a[0] as f32) * t;
        let r = a[1] as f32 + (b[1] as f32 - a[1] as f32) * t;
        let g = volume * voice.fade / 32768.0;
        out[frame * 2] += l * g * voice.gain_l;
        out[frame * 2 + 1] += r * g * voice.gain_r;
        s.frac += voice.step;
        while s.frac >= 1.0 {
            s.frac -= 1.0;
            if s.last && s.next.is_none() {
                voice.pos = f64::INFINITY; // played the last frame
                return;
            }
            s.cur = s.next.take();
            if s.cur.is_none() {
                s.frac = 0.0;
                break;
            }
            s.next = s.feed.pop();
            if s.next.is_none() && s.feed.finished() {
                s.last = true;
            }
        }
    }
}

impl Mixer {
    pub fn new(device_rate: u32) -> Self {
        Self {
            voices: Vec::with_capacity(MAX_VOICES + 1),
            device_rate: device_rate.max(1),
            sfx_volume: 1.0,
            music_volume: 1.0,
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.len()
    }

    pub fn apply(&mut self, command: Command) {
        match command {
            Command::Play(p) => {
                let mut p = p;
                if p.stream.is_none() && p.sample.frames.is_empty() {
                    return;
                }
                if p.music {
                    // One music track at a time: the old one fades out as the new one fades in.
                    for v in self.voices.iter_mut().filter(|v| v.music) {
                        v.stopping = true;
                        v.fade_target = 0.0;
                        v.fade_step = 1.0 / (0.3 * self.device_rate as f32);
                    }
                } else if self.voices.iter().filter(|v| !v.music).count() >= MAX_VOICES {
                    // Out of voices: the oldest effect gives way.
                    if let Some(i) = self.voices.iter().position(|v| !v.music) {
                        self.voices.remove(i);
                    }
                }
                let (gain_l, gain_r) = pan_gains(p.volume.max(0.0), p.pan);
                let fading_in = p.fade_in > 0.0;
                let source_rate = p.stream.as_ref().map_or(p.sample.rate, StreamFeed::rate);
                let stream = p.stream.take().map(|feed| StreamState {
                    feed,
                    cur: None,
                    next: None,
                    frac: 0.0,
                    last: false,
                });
                self.voices.push(Voice {
                    id: p.id,
                    step: source_rate as f64 / self.device_rate as f64
                        * p.pitch.clamp(0.05, 16.0) as f64,
                    sample: p.sample,
                    stream,
                    pos: 0.0,
                    gain_l,
                    gain_r,
                    looping: p.looping,
                    music: p.music,
                    fade: if fading_in { 0.0 } else { 1.0 },
                    fade_step: if fading_in {
                        1.0 / (p.fade_in * self.device_rate as f32)
                    } else {
                        0.0
                    },
                    fade_target: 1.0,
                    stopping: false,
                });
            }
            Command::Stop { id, fade } => {
                if fade <= 0.0 {
                    self.voices.retain(|v| v.id != id);
                } else {
                    for v in self.voices.iter_mut().filter(|v| v.id == id) {
                        v.stopping = true;
                        v.fade_target = 0.0;
                        v.fade_step = (v.fade.max(0.0001)) / (fade * self.device_rate as f32);
                    }
                }
            }
            Command::StopAll => self.voices.clear(),
            Command::StopMusic { fade } => {
                if fade <= 0.0 {
                    self.voices.retain(|v| !v.music);
                } else {
                    for v in self.voices.iter_mut().filter(|v| v.music) {
                        v.stopping = true;
                        v.fade_target = 0.0;
                        v.fade_step = (v.fade.max(0.0001)) / (fade * self.device_rate as f32);
                    }
                }
            }
            Command::SfxVolume(v) => self.sfx_volume = v.clamp(0.0, 2.0),
            Command::MusicVolume(v) => self.music_volume = v.clamp(0.0, 2.0),
        }
    }

    /// Adds `out.len() / 2` stereo frames of sound to `out` (interleaved, overwritten).
    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let frames = out.len() / 2;
        for voice in &mut self.voices {
            let volume = if voice.music {
                self.music_volume
            } else {
                self.sfx_volume
            };
            if voice.stream.is_some() {
                render_stream(voice, volume, out);
                continue;
            }
            let data = &voice.sample.frames;
            let last = data.len() - 1;
            for frame in 0..frames {
                // Fade towards the target (in or out).
                if voice.fade != voice.fade_target {
                    if voice.fade < voice.fade_target {
                        voice.fade = (voice.fade + voice.fade_step).min(voice.fade_target);
                    } else {
                        voice.fade = (voice.fade - voice.fade_step).max(voice.fade_target);
                    }
                    if voice.stopping && voice.fade <= 0.0 {
                        voice.pos = f64::INFINITY; // finished: removed below
                        break;
                    }
                }
                let i = voice.pos as usize;
                if i > last {
                    if voice.looping {
                        voice.pos -= data.len() as f64;
                        if voice.pos as usize > last {
                            voice.pos = 0.0;
                        }
                    } else {
                        voice.pos = f64::INFINITY;
                        break;
                    }
                }
                let i = voice.pos as usize;
                let t = (voice.pos - i as f64) as f32;
                let a = data[i];
                let b = if i < last {
                    data[i + 1]
                } else if voice.looping {
                    data[0]
                } else {
                    a
                };
                let l = a[0] as f32 + (b[0] as f32 - a[0] as f32) * t;
                let r = a[1] as f32 + (b[1] as f32 - a[1] as f32) * t;
                let g = volume * voice.fade / 32768.0;
                out[frame * 2] += l * g * voice.gain_l;
                out[frame * 2 + 1] += r * g * voice.gain_r;
                voice.pos += voice.step;
            }
        }
        self.voices.retain(|v| v.pos.is_finite());
        for s in out.iter_mut() {
            *s = soft_clip(*s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(rate: u32, frames: Vec<[i16; 2]>) -> Arc<Sample> {
        Arc::new(Sample { rate, frames })
    }

    fn constant(rate: u32, value: i16, frames: usize) -> Arc<Sample> {
        sample(rate, vec![[value, value]; frames])
    }

    fn play(id: u64, s: &Arc<Sample>) -> Play {
        Play {
            id,
            stream: None,
            sample: s.clone(),
            volume: 1.0,
            pan: 0.0,
            pitch: 1.0,
            looping: false,
            music: false,
            fade_in: 0.0,
        }
    }

    fn render(m: &mut Mixer, frames: usize) -> Vec<f32> {
        let mut out = vec![9.0; frames * 2];
        m.render(&mut out);
        out
    }

    #[test]
    fn silence_when_nothing_plays_and_a_voice_ends_after_its_sample() {
        let mut m = Mixer::new(1000);
        assert!(render(&mut m, 4).iter().all(|&s| s == 0.0));
        m.apply(Command::Play(Box::new(play(1, &constant(1000, 16384, 10)))));
        assert_eq!(m.active_voices(), 1);
        let out = render(&mut m, 20);
        assert!(
            out[..2].iter().all(|&s| s > 0.2),
            "centre pan plays on both sides: {:?}",
            &out[..2]
        );
        assert!(
            out[20..].iter().all(|&s| s == 0.0),
            "silent after the sample ends"
        );
        assert_eq!(m.active_voices(), 0, "the finished voice is gone");
    }

    #[test]
    fn pitch_changes_speed_and_sample_rate_is_converted() {
        // A ramp lets us see how fast the playhead moves.
        let ramp = sample(1000, (0..100).map(|i| [i * 100, i * 100]).collect());
        let mut fast = Mixer::new(1000);
        fast.apply(Command::Play(Box::new(Play {
            pitch: 2.0,
            volume: 2.0,
            ..play(1, &ramp)
        })));
        let mut normal = Mixer::new(1000);
        normal.apply(Command::Play(Box::new(Play {
            volume: 2.0,
            ..play(1, &ramp)
        })));
        let (f, n) = (render(&mut fast, 10), render(&mut normal, 10));
        // Frame k of the fast voice reads ramp position 2k; of the normal one, k.
        assert!((f[2 * 4] - n[2 * 8]).abs() < 0.01, "{} vs {}", f[8], n[16]);

        // A 500 Hz sample on a 1000 Hz device advances half a frame per output frame.
        let slow = sample(500, (0..10).map(|i| [i * 1000, i * 1000]).collect());
        let mut m = Mixer::new(1000);
        m.apply(Command::Play(Box::new(play(1, &slow))));
        let out = render(&mut m, 4);
        let at = |k: usize| out[k * 2];
        // Output frame k reads position 0.5 * k of a ramp worth 1000 per frame; centre pan is cos(pi/4).
        let expected = |k: usize| 500.0 * k as f32 / 32768.0 * std::f32::consts::FRAC_1_SQRT_2;
        for k in 0..4 {
            assert!(
                (at(k) - expected(k)).abs() < 1e-4,
                "frame {k}: {} vs {}",
                at(k),
                expected(k)
            );
        }
    }

    #[test]
    fn looping_voices_keep_playing_and_wrap_without_a_gap() {
        let s = sample(1000, vec![[8000, 8000], [-8000, -8000]]);
        let mut m = Mixer::new(1000);
        m.apply(Command::Play(Box::new(Play {
            looping: true,
            ..play(1, &s)
        })));
        let out = render(&mut m, 9);
        assert_eq!(m.active_voices(), 1);
        let signs: Vec<bool> = (0..9).map(|k| out[k * 2] > 0.0).collect();
        assert_eq!(
            signs,
            [true, false, true, false, true, false, true, false, true],
            "alternates through every wrap"
        );
    }

    #[test]
    fn pan_is_equal_power_and_volume_scales() {
        let s = constant(1000, 16384, 4);
        let mut left = Mixer::new(1000);
        left.apply(Command::Play(Box::new(Play {
            pan: -1.0,
            ..play(1, &s)
        })));
        let l = render(&mut left, 1);
        assert!(l[0] > 0.45 && l[1].abs() < 1e-4, "hard left: {l:?}");
        let mut right = Mixer::new(1000);
        right.apply(Command::Play(Box::new(Play {
            pan: 1.0,
            volume: 0.5,
            ..play(1, &s)
        })));
        let r = render(&mut right, 1);
        assert!(
            r[1] > 0.2 && r[1] < 0.3 && r[0].abs() < 1e-4,
            "hard right, half volume: {r:?}"
        );
        let mut centre = Mixer::new(1000);
        centre.apply(Command::Play(Box::new(play(1, &s))));
        let c = render(&mut centre, 1);
        let power = c[0] * c[0] + c[1] * c[1];
        let hard = l[0] * l[0];
        assert!(
            (power - hard).abs() < 1e-3,
            "constant power across the pan: {power} vs {hard}"
        );
    }

    #[test]
    fn fades_stop_and_music_replacement_work() {
        let s = constant(1000, 20000, 5000);
        let mut m = Mixer::new(1000);
        m.apply(Command::Play(Box::new(Play {
            fade_in: 0.1,
            looping: true,
            ..play(1, &s)
        })));
        let out = render(&mut m, 200);
        assert!(
            out[0] < 0.01 && out[2 * 50] > 0.1 && out[2 * 150] > out[2 * 50] * 0.9,
            "fades in over 100 frames"
        );
        m.apply(Command::Stop { id: 1, fade: 0.05 });
        let out = render(&mut m, 100);
        assert!(
            out[0] > out[2 * 30] && out[2 * 60] == 0.0,
            "fades out over 50 frames then silence"
        );
        assert_eq!(m.active_voices(), 0);

        m.apply(Command::Play(Box::new(Play {
            music: true,
            looping: true,
            ..play(10, &s)
        })));
        m.apply(Command::Play(Box::new(Play {
            music: true,
            looping: true,
            ..play(11, &s)
        })));
        render(&mut m, 400); // the old track's 0.3 s fade ends
        assert_eq!(m.active_voices(), 1, "only the new music is left");
        m.apply(Command::StopMusic { fade: 0.0 });
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn effects_are_limited_to_32_voices_and_music_is_not_counted() {
        let s = constant(1000, 100, 1000);
        let mut m = Mixer::new(1000);
        m.apply(Command::Play(Box::new(Play {
            music: true,
            looping: true,
            ..play(999, &s)
        })));
        for id in 0..50 {
            m.apply(Command::Play(Box::new(play(id, &s))));
        }
        assert_eq!(
            m.active_voices(),
            MAX_VOICES + 1,
            "32 effects plus the music"
        );
        m.apply(Command::StopAll);
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn output_never_exceeds_full_scale_however_loud_the_mix() {
        let s = constant(1000, 32767, 100);
        let mut m = Mixer::new(1000);
        for id in 0..32 {
            m.apply(Command::Play(Box::new(Play {
                volume: 2.0,
                ..play(id, &s)
            })));
        }
        let out = render(&mut m, 50);
        assert!(
            out.iter().all(|s| s.abs() <= 1.0 && s.is_finite()),
            "soft-clipped"
        );
        assert!(out[0] > 0.9, "but still loud");
    }

    #[test]
    fn volume_controls_scale_effects_and_music_separately() {
        let s = constant(1000, 16384, 100);
        let mut m = Mixer::new(1000);
        m.apply(Command::SfxVolume(0.0));
        m.apply(Command::Play(Box::new(play(1, &s))));
        assert!(render(&mut m, 2).iter().all(|&x| x == 0.0), "muted effects");
        m.apply(Command::Play(Box::new(Play {
            music: true,
            ..play(2, &s)
        })));
        assert!(render(&mut m, 2)[0] > 0.2, "music is independent");
        m.apply(Command::MusicVolume(0.0));
        assert!(render(&mut m, 2).iter().all(|&x| x == 0.0));
    }

    #[test]
    fn empty_samples_and_extreme_pitches_are_harmless() {
        let mut m = Mixer::new(48000);
        m.apply(Command::Play(Box::new(play(1, &sample(44100, vec![])))));
        assert_eq!(m.active_voices(), 0);
        let s = constant(44100, 1000, 10);
        m.apply(Command::Play(Box::new(Play {
            pitch: 1000.0,
            ..play(2, &s)
        })));
        m.apply(Command::Play(Box::new(Play {
            pitch: -5.0,
            ..play(3, &s)
        })));
        let out = render(&mut m, 100);
        assert!(out.iter().all(|x| x.is_finite()));
    }

    fn stream_play(id: u64, feed: StreamFeed) -> Play {
        Play {
            id,
            stream: Some(feed),
            sample: Arc::new(Sample {
                rate: 1000,
                frames: Vec::new(),
            }),
            volume: 1.0,
            pan: 0.0,
            pitch: 1.0,
            looping: false,
            music: true,
            fade_in: 0.0,
        }
    }

    /// Renders until `frames` are collected or the mixer has no voices left (the decoder thread needs a moment).
    fn render_until_done(m: &mut Mixer, frames: usize) -> Vec<f32> {
        let mut all = Vec::new();
        let start = std::time::Instant::now();
        while all.len() < frames * 2 && start.elapsed() < std::time::Duration::from_secs(5) {
            let mut chunk = vec![0.0; 64];
            m.render(&mut chunk);
            all.extend(chunk);
            if m.active_voices() == 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        all
    }

    #[test]
    fn a_streamed_voice_sounds_like_the_same_samples_played_from_memory() {
        let frames: Vec<[i16; 2]> = (0..300)
            .map(|i| [(i * 90) as i16, (-i * 60) as i16])
            .collect();
        let mut memory = Mixer::new(1000);
        memory.apply(Command::Play(Box::new(play(
            1,
            &sample(1000, frames.clone()),
        ))));
        let expected = render_until_done(&mut memory, 300);
        let mut streamed = Mixer::new(1000);
        streamed.apply(Command::Play(Box::new(stream_play(
            1,
            StreamFeed::from_frames(1000, frames, false),
        ))));
        let got = render_until_done(&mut streamed, 300);
        let _ = render_until_done(&mut streamed, 1); // one more look: the voice ends once its last frame has been played
        assert_eq!(
            streamed.active_voices(),
            0,
            "the streamed voice ends with its stream"
        );
        // The streamed voice may start a frame or two after the decoder woke up; compare the part that is sound.
        let nonzero = |v: &[f32]| v.iter().position(|&x| x != 0.0).unwrap_or(0);
        let (a, b) = (nonzero(&expected), nonzero(&got));
        let n = 2 * 280;
        assert_eq!(
            &expected[a..a + n],
            &got[b..b + n],
            "same samples, same interpolation"
        );
    }

    #[test]
    fn a_looping_stream_keeps_playing_and_stopping_the_music_ends_it() {
        let mut m = Mixer::new(1000);
        let mut p = stream_play(
            1,
            StreamFeed::from_frames(1000, vec![[16384, 16384]; 50], true),
        );
        p.looping = true;
        m.apply(Command::Play(Box::new(p)));
        let out = render_until_done(&mut m, 400);
        assert!(
            out.len() >= 800 && m.active_voices() == 1,
            "still going after several passes"
        );
        assert!(
            out[out.len() - 64..].iter().all(|&s| s > 0.1),
            "and still sounding"
        );
        m.apply(Command::StopMusic { fade: 0.0 });
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn a_stream_that_is_behind_plays_silence_and_catches_up_without_losing_frames() {
        let mut m = Mixer::new(1000);
        let feed = StreamFeed::from_frames(1000, vec![[8000, 8000]; 40], false);
        m.apply(Command::Play(Box::new(stream_play(1, feed))));
        // Render at once, before the decoder thread has necessarily produced anything.
        let mut first = vec![0.0; 8];
        m.render(&mut first);
        let rest = render_until_done(&mut m, 100);
        let heard = first
            .iter()
            .chain(rest.iter())
            .filter(|&&s| s > 0.05)
            .count()
            / 2;
        assert!(
            heard >= 38,
            "all frames were played whatever the timing, heard {heard}"
        );
    }

    #[test]
    fn a_streamed_voice_obeys_pan_pitch_and_fade() {
        let mut fast = Mixer::new(1000);
        let mut p = stream_play(
            1,
            StreamFeed::from_frames(1000, vec![[16000, 16000]; 100], false),
        );
        p.pitch = 2.0;
        p.pan = -1.0;
        fast.apply(Command::Play(Box::new(p)));
        let out = render_until_done(&mut fast, 100);
        let lit = out.chunks(2).filter(|c| c[0] > 0.1).count();
        assert!(
            (45..=55).contains(&lit),
            "twice as fast: about 50 frames of sound, got {lit}"
        );
        assert!(out.chunks(2).all(|c| c[1].abs() < 1e-3), "hard left");
        let mut fading = Mixer::new(1000);
        let mut f = stream_play(
            1,
            StreamFeed::from_frames(1000, vec![[16000, 16000]; 400], true),
        );
        f.fade_in = 0.1;
        fading.apply(Command::Play(Box::new(f)));
        let out = render_until_done(&mut fading, 200);
        let first_sound = out.chunks(2).position(|c| c[0] > 0.0).unwrap();
        assert!(out[first_sound * 2] < 0.05, "starts quiet");
        assert!(out[out.len() - 2] > 0.2, "and reaches full volume");
    }
}
