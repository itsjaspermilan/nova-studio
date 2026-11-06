//! The game audio mixer: sound effects and one music track.
//!
//! It is plain data in, samples out: no audio device, no allocation while rendering (voices
//! live in a vector reserved up front), so it can be driven from a real-time audio callback
//! and tested anywhere. Scripts queue [`Command`]s; the host forwards them to the mixer on the
//! audio thread. Samples are 16-bit stereo, played with four-point cubic (Catmull-Rom) interpolation, so any source
//! rate plays at any device rate and `pitch` is just a faster or slower step. (Cubic keeps the highs that linear
//! interpolation dulls and the images it adds when a sound is slowed down; a sound sped up past about 1.5 times can still
//! alias, since there is no low-pass before the step.) Streamed music is still linear: it plays at its own rate.

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
    /// At most this many copies of this sound at once (0 for no limit): one more makes the oldest copy of the same sound
    /// give way, instead of an unrelated sound.
    pub limit: u32,
}

pub enum Command {
    Play(Box<Play>),
    /// Stop one voice, fading out over `fade` seconds (0 stops at once).
    Stop {
        id: u64,
        fade: f32,
    },
    /// Change a playing sound: any of its volume, pan and pitch. The change glides over a few milliseconds, so a
    /// script can set it every frame (an engine that follows the revs) without clicks.
    Set {
        id: u64,
        volume: Option<f32>,
        pan: Option<f32>,
        pitch: Option<f32>,
    },
    StopAll,
    StopMusic {
        fade: f32,
    },
    SfxVolume(f32),
    MusicVolume(f32),
    /// How much of a playing sound goes to the room's reverb (0 to 1).
    Send {
        id: u64,
        send: f32,
    },
    /// The room that sends go to (`None` takes it away).
    Room(Option<Room>),
    /// Jump the playing music to `seconds` into the track. A streamed track needs a fresh `feed` that starts there; a
    /// track held in memory just moves its playhead.
    SeekMusic {
        seconds: f64,
        feed: Option<StreamFeed>,
    },
}

/// The reverb room: how long it rings (0 to 1), how dull its tail is (0 to 1) and how loud it is (0 to 2).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Room {
    pub size: f32,
    pub damping: f32,
    pub mix: f32,
}

/// A Freeverb-style room: eight comb filters and four all-passes a side, fed the mix of both channels. It allocates once, when the
/// room is made, and never while rendering.
struct Reverb {
    combs: [Vec<(Vec<f32>, usize, f32)>; 2],
    allpass: [Vec<(Vec<f32>, usize)>; 2],
    feedback: f32,
    damp: f32,
    mix: f32,
}

impl Reverb {
    fn new(rate: u32, room: Room) -> Self {
        let scale = rate as f32 / 44100.0;
        let side = |spread: usize| {
            (
                [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
                    .iter()
                    .map(|n| {
                        (
                            vec![0.0; (((n + spread) as f32) * scale).round().max(1.0) as usize],
                            0,
                            0.0,
                        )
                    })
                    .collect::<Vec<_>>(),
                [556, 441, 341, 225]
                    .iter()
                    .map(|n| {
                        (
                            vec![0.0; (((n + spread) as f32) * scale).round().max(1.0) as usize],
                            0,
                        )
                    })
                    .collect::<Vec<_>>(),
            )
        };
        let (cl, al) = side(0);
        let (cr, ar) = side(23);
        Self {
            combs: [cl, cr],
            allpass: [al, ar],
            feedback: 0.72 + room.size.clamp(0.0, 1.0) * 0.26,
            damp: 0.05 + room.damping.clamp(0.0, 1.0) * 0.5,
            mix: room.mix.clamp(0.0, 2.0),
        }
    }

    /// Adds the reverb of `wet` (interleaved stereo sends) to `out`.
    fn process(&mut self, wet: &[f32], out: &mut [f32]) {
        for frame in 0..wet.len() / 2 {
            let input = (wet[frame * 2] + wet[frame * 2 + 1]) * 0.015;
            for ch in 0..2 {
                let mut y = 0.0;
                for c in &mut self.combs[ch] {
                    let v = c.0[c.1];
                    c.2 = v * (1.0 - self.damp) + c.2 * self.damp;
                    c.0[c.1] = input + c.2 * self.feedback;
                    c.1 += 1;
                    if c.1 >= c.0.len() {
                        c.1 = 0;
                    }
                    y += v;
                }
                for a in &mut self.allpass[ch] {
                    let v = a.0[a.1];
                    a.0[a.1] = y + v * 0.5;
                    y = v - y;
                    a.1 += 1;
                    if a.1 >= a.0.len() {
                        a.1 = 0;
                    }
                }
                out[frame * 2 + ch] += y * 3.0 * self.mix;
            }
        }
    }
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
    /// Source frames played so far, counting from where the stream started (a seek starts it part way in).
    consumed: f64,
    /// How far into the track this stream began, in source frames.
    started_at: f64,
}

struct Voice {
    id: u64,
    sample: Arc<Sample>,
    stream: Option<StreamState>,
    pos: f64,
    step: f64,
    gain_l: f32,
    gain_r: f32,
    /// Where `gain_l`, `gain_r` and `step` are gliding to, and what they were made from.
    target: (f32, f32, f64),
    volume: f32,
    pan: f32,
    pitch: f32,
    source_rate: u32,
    looping: bool,
    music: bool,
    fade: f32,
    fade_step: f32,
    fade_target: f32,
    stopping: bool,
    /// How much of this voice goes to the reverb (0 to 1).
    send: f32,
}

pub struct Mixer {
    voices: Vec<Voice>,
    reverb: Option<Reverb>,
    /// Scratch for the voices that send to the reverb, and the sends themselves (grown once to the callback's size).
    tmp: Vec<f32>,
    wet: Vec<f32>,
    device_rate: u32,
    sfx_volume: f32,
    music_volume: f32,
    /// Output frames of streamed music that were silence because the decoder was behind.
    underruns: u64,
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
fn render_stream(voice: &mut Voice, volume: f32, out: &mut [f32]) -> u64 {
    let mut underruns = 0;
    let frames = out.len() / 2;
    let Some(s) = voice.stream.as_mut() else {
        return 0;
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
                return underruns;
            }
            s.feed.note_underrun();
            underruns += 1;
            continue;
        };
        let b = match s.next {
            Some(b) => b,
            None if s.last => a,
            None => {
                s.feed.note_underrun(); // the decoder is behind: silence, and wait here
                underruns += 1;
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
                return underruns;
            }
        }
        let t = s.frac as f32;
        let l = a[0] as f32 + (b[0] as f32 - a[0] as f32) * t;
        let r = a[1] as f32 + (b[1] as f32 - a[1] as f32) * t;
        let g = volume * voice.fade / 32768.0;
        out[frame * 2] += l * g * voice.gain_l;
        out[frame * 2 + 1] += r * g * voice.gain_r;
        s.frac += voice.step;
        s.consumed += voice.step;
        while s.frac >= 1.0 {
            s.frac -= 1.0;
            if s.last && s.next.is_none() {
                voice.pos = f64::INFINITY; // played the last frame
                return underruns;
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
    underruns
}

/// Catmull-Rom interpolation between `p1` and `p2` (`t` 0 to 1), with `p0` and `p3` the frames either side. It passes through
/// the frames themselves and reproduces a straight line exactly.
fn cubic(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    0.5 * (2.0 * p1
        + (p2 - p0) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
        + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t)
}

/// Draws one voice into `out` (stereo, `frames` long): a streamed one from its decoder, a loaded one by cubic interpolation. Returns the
/// frames of silence a streamed voice had to play because its decoder was behind.
fn render_voice(voice: &mut Voice, volume: f32, glide: f32, frames: usize, out: &mut [f32]) -> u64 {
    if voice.stream.is_some() {
        return render_stream(voice, volume, out);
    }
    let data = &voice.sample.frames;
    let last = data.len() - 1;
    for frame in 0..frames {
        if voice.gain_l != voice.target.0
            || voice.gain_r != voice.target.1
            || voice.step != voice.target.2
        {
            voice.gain_l += (voice.target.0 - voice.gain_l) * glide;
            voice.gain_r += (voice.target.1 - voice.gain_r) * glide;
            voice.step += (voice.target.2 - voice.step) * glide as f64;
            if (voice.gain_l - voice.target.0).abs() < 1e-5
                && (voice.gain_r - voice.target.1).abs() < 1e-5
            {
                (voice.gain_l, voice.gain_r) = (voice.target.0, voice.target.1);
            }
            if (voice.step - voice.target.2).abs() < 1e-6 {
                voice.step = voice.target.2;
            }
        }
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
        // the four frames round the playhead: a looping sound wraps; a one-shot carries its first and last slopes on
        // (so that a ramp stays straight to its ends)
        let len = data.len() as isize;
        let at = |k: isize| -> [f32; 2] {
            let f = |j: usize| [data[j][0] as f32, data[j][1] as f32];
            if voice.looping {
                f(k.rem_euclid(len) as usize)
            } else if k < 0 && len > 1 {
                let (a, b) = (f(0), f(1));
                [2.0 * a[0] - b[0], 2.0 * a[1] - b[1]]
            } else if k > last as isize && len > 1 {
                let (a, b) = (f(last), f(last - 1));
                [2.0 * a[0] - b[0], 2.0 * a[1] - b[1]]
            } else {
                f(k.clamp(0, last as isize) as usize)
            }
        };
        let (p0, p1, p2, p3) = (
            at(i as isize - 1),
            at(i as isize),
            at(i as isize + 1),
            at(i as isize + 2),
        );
        let l = cubic(p0[0], p1[0], p2[0], p3[0], t);
        let r = cubic(p0[1], p1[1], p2[1], p3[1], t);
        let g = volume * voice.fade / 32768.0;
        out[frame * 2] += l * g * voice.gain_l;
        out[frame * 2 + 1] += r * g * voice.gain_r;
        voice.pos += voice.step;
    }
    0
}

impl Mixer {
    pub fn new(device_rate: u32) -> Self {
        Self {
            voices: Vec::with_capacity(MAX_VOICES + 1),
            reverb: None,
            tmp: Vec::new(),
            wet: Vec::new(),
            device_rate: device_rate.max(1),
            sfx_volume: 1.0,
            music_volume: 1.0,
            underruns: 0,
        }
    }

    /// Frames of streamed music that played as silence because the decoder was behind, since the mixer started.
    pub fn underruns(&self) -> u64 {
        self.underruns
    }

    /// Seconds into the current music track, wrapped for looping tracks once the track's length is known.
    pub fn music_position(&self) -> Option<f64> {
        let v = self.voices.iter().find(|v| v.music && !v.stopping)?;
        match &v.stream {
            Some(s) => {
                let rate = s.feed.rate() as f64;
                let mut frames = s.started_at + s.consumed;
                if let Some(len) = s.feed.pass_frames() {
                    frames %= len as f64;
                }
                Some(frames / rate)
            }
            None => {
                let len = v.sample.frames.len() as f64;
                Some((v.pos % len.max(1.0)) / v.sample.rate.max(1) as f64)
            }
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.len()
    }

    /// The ids of the playing voices, oldest first (for tests).
    #[cfg(test)]
    fn voice_ids(&self) -> Vec<u64> {
        self.voices.iter().map(|v| v.id).collect()
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
                } else if p.limit > 0
                    && self
                        .voices
                        .iter()
                        .filter(|v| Arc::ptr_eq(&v.sample, &p.sample))
                        .count()
                        >= p.limit as usize
                {
                    // Too many copies of this very sound (a hundred enemies dying at once): the oldest copy gives way.
                    if let Some(i) = self
                        .voices
                        .iter()
                        .position(|v| Arc::ptr_eq(&v.sample, &p.sample))
                    {
                        self.voices.remove(i);
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
                    consumed: 0.0,
                    started_at: 0.0,
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
                    target: (
                        gain_l,
                        gain_r,
                        source_rate as f64 / self.device_rate as f64
                            * p.pitch.clamp(0.05, 16.0) as f64,
                    ),
                    volume: p.volume.max(0.0),
                    pan: p.pan,
                    pitch: p.pitch.clamp(0.05, 16.0),
                    source_rate,
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
                    send: 0.0,
                });
            }
            Command::Send { id, send } => {
                for v in self.voices.iter_mut().filter(|v| v.id == id) {
                    v.send = send.clamp(0.0, 1.0);
                }
            }
            Command::Room(room) => {
                self.reverb = room.map(|r| Reverb::new(self.device_rate, r));
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
            Command::Set {
                id,
                volume,
                pan,
                pitch,
            } => {
                let device_rate = self.device_rate as f64;
                for v in self.voices.iter_mut().filter(|v| v.id == id) {
                    v.volume = volume.map_or(v.volume, |x| x.clamp(0.0, 4.0));
                    v.pan = pan.map_or(v.pan, |x| x.clamp(-1.0, 1.0));
                    if v.stream.is_none() {
                        v.pitch = pitch.map_or(v.pitch, |x| x.clamp(0.05, 16.0));
                    }
                    let (l, r) = pan_gains(v.volume, v.pan);
                    v.target = (l, r, v.source_rate as f64 / device_rate * v.pitch as f64);
                    if v.stream.is_some() {
                        (v.gain_l, v.gain_r) = (l, r); // streamed music changes at once
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
            Command::SeekMusic { seconds, feed } => {
                let seconds = seconds.max(0.0);
                if let Some(voice) = self.voices.iter_mut().find(|v| v.music && !v.stopping) {
                    match (voice.stream.as_mut(), feed) {
                        (Some(s), Some(feed)) => {
                            // The old decoder stops when its feed is dropped; the new one starts where we were asked.
                            let started = seconds * feed.rate() as f64;
                            *s = StreamState {
                                feed,
                                cur: None,
                                next: None,
                                frac: 0.0,
                                last: false,
                                consumed: 0.0,
                                started_at: started,
                            };
                        }
                        (None, _) => {
                            let end = voice.sample.frames.len() as f64;
                            voice.pos =
                                (seconds * voice.sample.rate as f64).min((end - 1.0).max(0.0));
                        }
                        (Some(_), None) => {} // a streamed track cannot move without a feed that starts there
                    }
                }
            }
        }
    }

    /// Adds `out.len() / 2` stereo frames of sound to `out` (interleaved, overwritten).
    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let frames = out.len() / 2;
        let room = self.reverb.is_some();
        if room {
            if self.wet.len() != out.len() {
                self.wet.resize(out.len(), 0.0);
                self.tmp.resize(out.len(), 0.0);
            }
            self.wet.fill(0.0);
        }
        // glide towards a volume, pan or pitch a script asked for (about 10 ms)
        let glide = 1.0 - (-1.0 / (0.01 * self.device_rate as f32)).exp();
        for voice in &mut self.voices {
            let volume = if voice.music {
                self.music_volume
            } else {
                self.sfx_volume
            };
            if room && voice.send > 0.0 {
                // a voice that sends to the room is drawn into the scratch first, then added to the output and (by its send) to the room
                self.tmp.fill(0.0);
                self.underruns += render_voice(voice, volume, glide, frames, &mut self.tmp);
                for (o, t) in out.iter_mut().zip(&self.tmp) {
                    *o += t;
                }
                for (w, t) in self.wet.iter_mut().zip(&self.tmp) {
                    *w += t * voice.send;
                }
            } else {
                self.underruns += render_voice(voice, volume, glide, frames, out);
            }
        }
        if let Some(reverb) = self.reverb.as_mut() {
            reverb.process(&self.wet, out);
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
            limit: 0,
        }
    }

    fn render(m: &mut Mixer, frames: usize) -> Vec<f32> {
        let mut out = vec![9.0; frames * 2];
        m.render(&mut out);
        out
    }

    /// A rising ramp that loops: the sample value says where the playhead is.
    fn ramp(frames: usize) -> Arc<Sample> {
        sample(
            1000,
            (0..frames)
                .map(|i| [i as i16 * 10, i as i16 * 10])
                .collect(),
        )
    }

    #[test]
    fn a_limit_makes_copies_of_one_sound_give_way_to_each_other_not_to_other_sounds() {
        let mut m = Mixer::new(1000);
        let hit = ramp(2000);
        let jingle = ramp(2000);
        m.apply(Command::Play(Box::new(play(1, &jingle))));
        for id in 2..=11 {
            m.apply(Command::Play(Box::new(Play {
                limit: 3,
                ..play(id, &hit)
            })));
        }
        let ids: Vec<u64> = m.voice_ids();
        assert_eq!(
            ids,
            [1, 9, 10, 11],
            "the jingle stays; only the newest three hits play"
        );
        // without a limit all of them play
        let mut m = Mixer::new(1000);
        for id in 1..=10 {
            m.apply(Command::Play(Box::new(play(id, &hit))));
        }
        assert_eq!(m.voice_ids().len(), 10);
    }

    #[test]
    fn a_playing_sound_can_change_pitch_volume_and_pan_and_glides_there() {
        let mut m = Mixer::new(1000);
        let s = ramp(2000);
        m.apply(Command::Play(Box::new(Play {
            looping: true,
            ..play(1, &s)
        })));
        let out = render(&mut m, 100);
        // normal speed: one source frame per output frame (the centre pan takes the left channel to 0.707)
        let base = out[2 * 99] - out[2 * 98];
        assert!(
            (base - 10.0 * std::f32::consts::FRAC_1_SQRT_2 / 32768.0).abs() < 1e-6,
            "{base}"
        );
        m.apply(Command::Set {
            id: 1,
            volume: None,
            pan: None,
            pitch: Some(2.0),
        });
        let out = render(&mut m, 400);
        // gliding: the step is between 1 and 2 soon after, and settles at 2 (20 units of ramp per frame)
        let early = out[2 * 3] - out[2 * 2];
        let late = out[2 * 399] - out[2 * 398];
        assert!(
            early > base * 1.0 && early < base * 2.0,
            "glides: {early} between {base} and {}",
            base * 2.0
        );
        assert!(
            (late - base * 2.0).abs() < 1e-6,
            "settles at twice the speed: {late}"
        );

        m.apply(Command::Set {
            id: 1,
            volume: Some(0.0),
            pan: None,
            pitch: None,
        });
        let out = render(&mut m, 600);
        assert!(out[2 * 599].abs() < 1e-6, "silent once the glide is done");
        m.apply(Command::Set {
            id: 1,
            volume: Some(1.0),
            pan: Some(1.0),
            pitch: None,
        });
        let out = render(&mut m, 600);
        assert!(
            out[2 * 599].abs() < 1e-6 && out[2 * 599 + 1].abs() > 0.01,
            "all on the right: {:?}",
            &out[2 * 599..]
        );
    }

    #[test]
    fn changing_a_sound_that_is_gone_does_nothing() {
        let mut m = Mixer::new(1000);
        m.apply(Command::Set {
            id: 99,
            volume: Some(2.0),
            pan: None,
            pitch: Some(3.0),
        });
        assert_eq!(m.active_voices(), 0);
        let s = constant(1000, 1000, 10);
        m.apply(Command::Play(Box::new(play(1, &s))));
        m.apply(Command::Set {
            id: 2,
            volume: Some(0.0),
            pan: None,
            pitch: None,
        });
        let out = render(&mut m, 5);
        assert!(out[0] > 0.0, "another sound's id leaves this one alone");
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
            limit: 0,
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

    #[test]
    fn the_music_position_follows_playback_for_memory_and_streamed_tracks() {
        let frames: Vec<[i16; 2]> = vec![[1000, 1000]; 4000]; // 4 seconds at 1000 Hz
        let mut m = Mixer::new(1000);
        assert_eq!(m.music_position(), None);
        let mut p = play(1, &sample(1000, frames.clone()));
        p.music = true;
        m.apply(Command::Play(Box::new(p)));
        render(&mut m, 500);
        let pos = m.music_position().unwrap();
        assert!((pos - 0.5).abs() < 0.01, "half a second in, got {pos}");
        let mut streamed = Mixer::new(1000);
        streamed.apply(Command::Play(Box::new(stream_play(
            1,
            StreamFeed::from_frames(1000, frames, true),
        ))));
        let _ = render_until_done(&mut streamed, 500);
        let pos = streamed.music_position().unwrap();
        assert!(
            pos > 0.3 && pos <= 0.7,
            "about half a second of a stream, got {pos}"
        );
        streamed.apply(Command::StopMusic { fade: 0.0 });
        assert_eq!(streamed.music_position(), None);
    }

    #[test]
    fn seeking_moves_a_memory_track_and_restarts_a_stream_part_way_in() {
        let ramp: Vec<[i16; 2]> = (0..2000)
            .map(|i| [(i * 8) as i16, (i * 8) as i16])
            .collect();
        let mut m = Mixer::new(1000);
        let mut p = play(1, &sample(1000, ramp.clone()));
        p.music = true;
        m.apply(Command::Play(Box::new(p)));
        m.apply(Command::SeekMusic {
            seconds: 1.5,
            feed: None,
        });
        let out = render(&mut m, 4);
        assert!(
            out[0] > 0.2,
            "the sound jumped to the ramp's later, louder part: {}",
            out[0]
        );
        assert!((m.music_position().unwrap() - 1.504).abs() < 0.01);
        let mut s = Mixer::new(1000);
        s.apply(Command::Play(Box::new(stream_play(
            1,
            StreamFeed::from_frames(1000, ramp.clone(), false),
        ))));
        let _ = render_until_done(&mut s, 20);
        s.apply(Command::SeekMusic {
            seconds: 1.5,
            feed: Some(StreamFeed::from_frames_at(1000, ramp, false, 1500)),
        });
        let got = render_until_done(&mut s, 400);
        let first_sound = got.chunks(2).find(|c| c[0] != 0.0).unwrap()[0];
        assert!(
            first_sound > 0.2,
            "the stream restarted near 1.5 seconds in, first sample {first_sound}"
        );
        let pos = s.music_position().unwrap();
        assert!(pos > 1.5 && pos < 2.0, "{pos}");
        // Seeking with nothing playing does nothing, and a negative time means the start.
        let mut idle = Mixer::new(1000);
        idle.apply(Command::SeekMusic {
            seconds: -3.0,
            feed: None,
        });
        assert_eq!(idle.active_voices(), 0);
    }

    #[test]
    fn underruns_are_counted_when_the_decoder_is_behind() {
        let mut m = Mixer::new(1000);
        // A feed that stays empty for a while: nothing has been decoded yet at the first render.
        let feed = StreamFeed::from_frames_at(1000, vec![[500, 500]; 10], false, 0);
        m.apply(Command::Play(Box::new(stream_play(1, feed))));
        let mut out = vec![0.0; 2000];
        m.render(&mut out); // immediately: the decoder thread may not have produced anything yet
        let _ = render_until_done(&mut m, 100);
        // Whatever the timing, a track that finishes cleanly may count some underruns but never a negative or absurd number.
        assert!(m.underruns() <= 2000);
        let mut late = Mixer::new(1000);
        let never = StreamFeed::from_frames(1000, vec![], true); // finishes at once having produced nothing
        late.apply(Command::Play(Box::new(stream_play(2, never))));
        let start = std::time::Instant::now();
        while late.active_voices() > 0 && start.elapsed() < std::time::Duration::from_secs(3) {
            let mut chunk = vec![0.0; 64];
            late.render(&mut chunk);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert_eq!(
            late.active_voices(),
            0,
            "a stream with no audio ends instead of counting underruns forever"
        );
    }
}

#[cfg(test)]
mod reverb_tests {
    use super::*;

    fn click() -> Arc<Sample> {
        let mut frames = vec![[0i16; 2]; 64];
        frames[0] = [20000, 20000];
        Arc::new(Sample { rate: 8000, frames })
    }

    fn play(id: u64, sample: &Arc<Sample>) -> Command {
        Command::Play(Box::new(Play {
            id,
            stream: None,
            sample: sample.clone(),
            volume: 1.0,
            pan: 0.0,
            pitch: 1.0,
            looping: false,
            music: false,
            fade_in: 0.0,
            limit: 0,
        }))
    }

    fn tail_energy(room: Option<Room>, send: f32) -> f32 {
        let mut m = Mixer::new(8000);
        m.apply(Command::Room(room));
        m.apply(play(1, &click()));
        m.apply(Command::Send { id: 1, send });
        let mut out = vec![0.0f32; 2 * 4000];
        m.render(&mut out);
        // the click itself is over in 64 frames: what is heard after that is the room
        out[2 * 200..].iter().map(|x| x * x).sum()
    }

    #[test]
    fn a_sound_sent_to_a_room_rings_on_after_it_ends_and_only_then() {
        let room = Some(Room {
            size: 0.6,
            damping: 0.4,
            mix: 1.0,
        });
        let wet = tail_energy(room, 1.0);
        assert!(wet > 0.001, "the room rings: {wet}");
        assert_eq!(
            tail_energy(room, 0.0),
            0.0,
            "nothing is sent, nothing rings"
        );
        assert_eq!(tail_energy(None, 1.0), 0.0, "no room, no ring");
        // a bigger room rings longer and a dull one is quieter
        let big = tail_energy(
            Some(Room {
                size: 1.0,
                damping: 0.4,
                mix: 1.0,
            }),
            1.0,
        );
        let small = tail_energy(
            Some(Room {
                size: 0.1,
                damping: 0.4,
                mix: 1.0,
            }),
            1.0,
        );
        assert!(big > small, "{big} against {small}");
        // the dry sound is untouched by the room
        let mut dry = Mixer::new(8000);
        dry.apply(play(1, &click()));
        let mut wet_mixer = Mixer::new(8000);
        wet_mixer.apply(Command::Room(room));
        wet_mixer.apply(play(1, &click()));
        wet_mixer.apply(Command::Send { id: 1, send: 1.0 });
        let (mut a, mut b) = (vec![0.0f32; 2 * 4], vec![0.0f32; 2 * 4]);
        dry.render(&mut a);
        wet_mixer.render(&mut b);
        assert_eq!(
            a, b,
            "the first frames, before the room has anything to say, are the same"
        );
    }
}

#[cfg(test)]
mod interpolation_tests {
    use super::*;

    #[test]
    fn cubic_passes_through_the_frames_and_keeps_a_straight_line_straight() {
        assert_eq!(cubic(3.0, 5.0, 9.0, 4.0, 0.0), 5.0);
        assert_eq!(cubic(3.0, 5.0, 9.0, 4.0, 1.0), 9.0);
        // a line: 0, 10, 20, 30
        assert!((cubic(0.0, 10.0, 20.0, 30.0, 0.3) - 13.0).abs() < 1e-4);
    }

    #[test]
    fn a_sine_slowed_down_is_closer_to_the_sine_than_linear_interpolation() {
        // a 4 kHz sine at 16 kHz (four frames to a cycle), played at half speed: the in-between frames lie on the same sine
        let rate = 16000;
        let freq = 3000.0f32; // 5.3 frames a cycle: linear interpolation cuts the peaks
        let frames: Vec<[i16; 2]> = (0..400)
            .map(|i| {
                let v = (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin();
                [(v * 20000.0) as i16; 2]
            })
            .collect();
        let sample = Arc::new(Sample {
            rate,
            frames: frames.clone(),
        });
        let mut m = Mixer::new(rate);
        m.apply(Command::Play(Box::new(Play {
            id: 1,
            stream: None,
            sample,
            volume: 1.0,
            pan: -1.0,
            pitch: 0.5,
            looping: false,
            music: false,
            fade_in: 0.0,
            limit: 0,
        })));
        let mut out = vec![0.0f32; 2 * 200];
        m.render(&mut out);
        // pan -1 is all left: gain 1. Output frame k reads position k / 2.
        let (mut cubic_error, mut linear_error) = (0.0f32, 0.0f32);
        for k in 10..190 {
            let pos = k as f32 / 2.0;
            let truth = (2.0 * std::f32::consts::PI * freq * pos / rate as f32).sin();
            let got = out[2 * k] * 32768.0 / 20000.0 / soft_clip_gain();
            cubic_error += (got - truth).powi(2);
            let i = pos as usize;
            let t = pos - i as f32;
            let lin = (frames[i][0] as f32 * (1.0 - t) + frames[i + 1][0] as f32 * t) / 20000.0;
            linear_error += (lin - truth).powi(2);
        }
        assert!(
            cubic_error < linear_error * 0.5,
            "cubic {cubic_error} against linear {linear_error}"
        );
    }

    /// The mixer's soft clip leaves a signal below about 0.6 almost alone; this is its gain at 0.6 of full scale.
    fn soft_clip_gain() -> f32 {
        soft_clip(0.6) / 0.6
    }
}
