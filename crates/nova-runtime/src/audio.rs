//! Audio output: the salvaged C11 sample-clock core rendering into a cpal stream.
//!
//! The C core is single-owner: exactly one thread (the audio callback) renders, and
//! nothing else touches the renderer after it has been moved into the callback.
//! The callback does not allocate or lock; it publishes counters through atomics.

use std::ffi::c_char;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::mixer::{Command, Mixer};

const NOVA_AUDIO_MAX_BLOCK: usize = 4096; // audio/audio.h

#[repr(C)]
struct RawProgram {
    _private: [u8; 0],
}
#[repr(C)]
struct RawRenderer {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn nova_audio_demo_program(
        rate: u32,
        out: *mut *mut RawProgram,
        error: *mut c_char,
        error_size: usize,
    ) -> bool;
    fn nova_audio_program_release(program: *mut RawProgram);
    fn nova_audio_renderer_create(
        program: *mut RawProgram,
        out: *mut *mut RawRenderer,
        error: *mut c_char,
        error_size: usize,
    ) -> bool;
    fn nova_audio_renderer_destroy(renderer: *mut RawRenderer);
    fn nova_audio_render(renderer: *mut RawRenderer, stereo: *mut f32, frames: usize) -> u32;
}

fn c_message(buffer: &[c_char]) -> String {
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The core's looping demo score, rendered live. Owns the C renderer.
pub struct DemoRenderer {
    raw: *mut RawRenderer,
}

// SAFETY: the renderer has no thread affinity; the core requires only that a single
// thread renders at a time, which holds because `DemoRenderer` is moved, never shared.
unsafe impl Send for DemoRenderer {}

impl DemoRenderer {
    pub fn new(rate: u32) -> Result<Self, String> {
        let mut error = [0 as c_char; 256];
        let mut program: *mut RawProgram = std::ptr::null_mut();
        // SAFETY: out-pointers and the error buffer are valid for the stated sizes.
        let ok =
            unsafe { nova_audio_demo_program(rate, &mut program, error.as_mut_ptr(), error.len()) };
        if !ok {
            return Err(format!("audio program: {}", c_message(&error)));
        }
        let mut raw: *mut RawRenderer = std::ptr::null_mut();
        // SAFETY: `program` is valid; the renderer retains it, so we release our reference.
        let ok = unsafe {
            nova_audio_renderer_create(program, &mut raw, error.as_mut_ptr(), error.len())
        };
        unsafe { nova_audio_program_release(program) };
        if !ok {
            return Err(format!("audio renderer: {}", c_message(&error)));
        }
        Ok(Self { raw })
    }

    /// Fills interleaved stereo float frames; returns false if the core reported a fault.
    pub fn render(&mut self, stereo: &mut [f32]) -> bool {
        let mut ok = true;
        for block in stereo.chunks_mut(NOVA_AUDIO_MAX_BLOCK * 2) {
            let frames = block.len() / 2;
            // SAFETY: `block` holds `frames` stereo frames and `raw` is a live renderer.
            ok &= unsafe { nova_audio_render(self.raw, block.as_mut_ptr(), frames) } == 0;
        }
        ok
    }
}

impl Drop for DemoRenderer {
    fn drop(&mut self) {
        // SAFETY: created by nova_audio_renderer_create and destroyed exactly once.
        unsafe { nova_audio_renderer_destroy(self.raw) };
    }
}

#[derive(Default)]
pub struct AudioStats {
    pub callbacks: AtomicU64,
    pub max_callback_micros: AtomicU64,
    pub last_callback_micros: AtomicU64,
    pub faults: AtomicU32,
    pub stream_errors: AtomicU32,
    pub sample_rate: AtomicU32,
    pub channels: AtomicU32,
    pub voices: AtomicU32,
    pub dropped_commands: AtomicU32,
}

pub struct AudioOut {
    _stream: cpal::Stream,
    pub stats: Arc<AudioStats>,
    pub description: String,
    sender: Option<SyncSender<Command>>,
}

impl AudioOut {
    /// Hands a sound command to the audio thread. Dropped (and counted) if the queue is full,
    /// which only happens when scripts queue hundreds of sounds faster than they play.
    pub fn send(&self, command: Command) {
        if let Some(sender) = &self.sender
            && sender.try_send(command).is_err()
        {
            self.stats.dropped_commands.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// What the audio thread renders: the C core's demo score (the M1 benchmark) or the game mixer.
enum Source {
    Demo(DemoRenderer),
    Mixer(Mixer, Receiver<Command>),
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut source: Source,
    stats: Arc<AudioStats>,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = config.channels as usize;
    let gain = match source {
        Source::Demo(_) => 0.5,
        Source::Mixer(..) => 1.0,
    };
    let mut scratch: Vec<f32> = vec![0.0; NOVA_AUDIO_MAX_BLOCK * 2];
    let callback_stats = stats.clone();
    let error_stats = stats;
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let started = Instant::now();
                let frames = data.len() / channels.max(1);
                if scratch.len() < frames * 2 {
                    // Only grows on an unusually large device buffer; never in steady state.
                    scratch.resize(frames * 2, 0.0);
                }
                match &mut source {
                    Source::Demo(renderer) => {
                        if !renderer.render(&mut scratch[..frames * 2]) {
                            callback_stats.faults.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Source::Mixer(mixer, commands) => {
                        while let Ok(command) = commands.try_recv() {
                            mixer.apply(command);
                        }
                        mixer.render(&mut scratch[..frames * 2]);
                        callback_stats
                            .voices
                            .store(mixer.active_voices() as u32, Ordering::Relaxed);
                    }
                }
                for (frame, out) in data.chunks_mut(channels.max(1)).enumerate() {
                    let (l, r) = (scratch[frame * 2], scratch[frame * 2 + 1]);
                    for (channel, sample) in out.iter_mut().enumerate() {
                        let v = match (channels, channel) {
                            (1, _) => 0.5 * (l + r),
                            (_, 0) => l,
                            (_, 1) => r,
                            _ => 0.0,
                        };
                        *sample = T::from_sample_(v.clamp(-1.0, 1.0) * gain);
                    }
                }
                let micros = started.elapsed().as_micros() as u64;
                callback_stats.callbacks.fetch_add(1, Ordering::Relaxed);
                callback_stats
                    .last_callback_micros
                    .store(micros, Ordering::Relaxed);
                callback_stats
                    .max_callback_micros
                    .fetch_max(micros, Ordering::Relaxed);
            },
            move |error| {
                log::error!("audio stream error: {error}");
                error_stats.stream_errors.fetch_add(1, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| format!("cannot open audio stream: {e}"))
}

/// `game` selects the mixer for project games; otherwise the benchmark's demo score plays.
pub fn start(game: bool) -> Result<AudioOut, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("no audio output device")?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("no output config: {e}"))?;
    let format = supported.sample_format();
    let config = supported.config();
    let rate: u32 = config.sample_rate;
    let stats = Arc::new(AudioStats::default());
    stats.sample_rate.store(rate, Ordering::Relaxed);
    stats
        .channels
        .store(config.channels as u32, Ordering::Relaxed);
    let (source, sender) = if game {
        let (tx, rx) = sync_channel::<Command>(512);
        (Source::Mixer(Mixer::new(rate), rx), Some(tx))
    } else {
        if rate != 44100 && rate != 48000 {
            return Err(format!(
                "device rate {rate} Hz is not supported by the audio core (44100/48000)"
            ));
        }
        (Source::Demo(DemoRenderer::new(rate)?), None)
    };
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, config, source, stats.clone())?,
        cpal::SampleFormat::I16 => build::<i16>(&device, config, source, stats.clone())?,
        other => return Err(format!("unsupported device sample format {other:?}")),
    };
    stream
        .play()
        .map_err(|e| format!("cannot start audio stream: {e}"))?;
    let description = format!("{rate} Hz {} ch {format:?}", config.channels);
    log::info!("audio started: {description}");
    Ok(AudioOut {
        _stream: stream,
        stats,
        description,
        sender,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_score_renders_audible_finite_stereo() {
        let mut renderer = DemoRenderer::new(48_000).expect("renderer");
        let mut block = vec![0.0f32; 48_000 * 2]; // one second, larger than one core block
        assert!(renderer.render(&mut block));
        assert!(block.iter().all(|v| v.is_finite()));
        let peak = block.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak > 0.05 && peak < 4.0, "peak {peak}");
    }

    #[test]
    fn unsupported_rate_is_rejected_with_a_message() {
        let error = DemoRenderer::new(96_000).err().expect("must fail");
        assert!(error.starts_with("audio program:"), "{error}");
    }

    #[allow(dead_code)]
    fn _assert_send<T: Send>() {}
    #[test]
    fn renderer_is_send() {
        _assert_send::<DemoRenderer>();
    }
}
