//! Streamed music: a background thread decodes an Ogg Vorbis file a little ahead of the audio callback and hands the
//! frames over through a lock-free ring, so a long track costs only its compressed bytes in memory instead of ten
//! megabytes a minute decoded. The audio thread never waits on the decoder: if the ring runs dry it plays silence for
//! that frame (counted as an underrun) and carries on.

use std::io::Cursor;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

/// Decoded frames held ahead of playback: about 1.5 seconds at 44.1 kHz.
const RING_FRAMES: usize = 1 << 16;

struct Ring {
    slots: Vec<AtomicU32>,
    /// Next frame to read / write (ever-increasing; the slot is `n % RING_FRAMES`).
    read: AtomicUsize,
    write: AtomicUsize,
    /// The decoder has no more frames to give (it reached the end of a non-looping track, or failed).
    done: AtomicBool,
    /// The listener went away: the decoder should stop.
    stop: AtomicBool,
    underruns: AtomicU64,
}

fn pack(f: [i16; 2]) -> u32 {
    (f[0] as u16 as u32) | ((f[1] as u16 as u32) << 16)
}
fn unpack(v: u32) -> [i16; 2] {
    [v as u16 as i16, (v >> 16) as u16 as i16]
}

impl Ring {
    fn new() -> Self {
        Self {
            slots: (0..RING_FRAMES).map(|_| AtomicU32::new(0)).collect(),
            read: AtomicUsize::new(0),
            write: AtomicUsize::new(0),
            done: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            underruns: AtomicU64::new(0),
        }
    }
}

/// The playing end of a stream (held by the mixer's voice). Dropping it stops the decoder thread.
pub struct StreamFeed {
    rate: u32,
    ring: Arc<Ring>,
}

impl Drop for StreamFeed {
    fn drop(&mut self) {
        self.ring.stop.store(true, Ordering::Release);
    }
}

impl StreamFeed {
    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// The next decoded frame, or None when none is ready yet.
    pub fn pop(&self) -> Option<[i16; 2]> {
        let read = self.ring.read.load(Ordering::Relaxed);
        if read == self.ring.write.load(Ordering::Acquire) {
            return None;
        }
        let frame = unpack(self.ring.slots[read % RING_FRAMES].load(Ordering::Relaxed));
        self.ring.read.store(read + 1, Ordering::Release);
        Some(frame)
    }

    /// True once everything has been read and no more will ever come.
    pub fn finished(&self) -> bool {
        // `done` is set after the last frame was written, so check it first, then that nothing is left.
        self.ring.done.load(Ordering::Acquire)
            && self.ring.read.load(Ordering::Relaxed) == self.ring.write.load(Ordering::Acquire)
    }

    pub fn note_underrun(&self) {
        self.ring.underruns.fetch_add(1, Ordering::Relaxed);
    }

    /// How many output frames had to be silence because the decoder was behind.
    pub fn underruns(&self) -> u64 {
        self.ring.underruns.load(Ordering::Relaxed)
    }

    /// A stream of ready-made frames fed from a thread (for tests, and anything already decoded).
    pub fn from_frames(rate: u32, frames: Vec<[i16; 2]>, looping: bool) -> Self {
        spawn(rate, move |push| {
            if frames.is_empty() {
                return;
            }
            loop {
                for f in &frames {
                    if !push(*f) {
                        return;
                    }
                }
                if !looping {
                    return;
                }
            }
        })
    }
}

/// Starts a decoder thread running `produce`, which calls `push` for every frame and stops when `push` says false.
fn spawn<F>(rate: u32, produce: F) -> StreamFeed
where
    F: FnOnce(&dyn Fn([i16; 2]) -> bool) + Send + 'static,
{
    let ring = Arc::new(Ring::new());
    let thread_ring = ring.clone();
    std::thread::Builder::new()
        .name("nova-music-decoder".into())
        .spawn(move || {
            let push = |frame: [i16; 2]| -> bool {
                loop {
                    if thread_ring.stop.load(Ordering::Acquire) {
                        return false;
                    }
                    let write = thread_ring.write.load(Ordering::Relaxed);
                    if write - thread_ring.read.load(Ordering::Acquire) < RING_FRAMES {
                        thread_ring.slots[write % RING_FRAMES]
                            .store(pack(frame), Ordering::Relaxed);
                        thread_ring.write.store(write + 1, Ordering::Release);
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(3)); // the ring is full: playback has not caught up
                }
            };
            produce(&push);
            thread_ring.done.store(true, Ordering::Release);
        })
        .expect("a thread for the music decoder");
    StreamFeed { rate, ring }
}

/// A compressed track that can be played any number of times, each play with its own decoder.
#[derive(Clone)]
pub struct StreamSource {
    bytes: Arc<[u8]>,
    pub rate: u32,
}

fn open(
    bytes: &Arc<[u8]>,
) -> Result<lewton::inside_ogg::OggStreamReader<Cursor<Arc<[u8]>>>, String> {
    lewton::inside_ogg::OggStreamReader::new(Cursor::new(bytes.clone()))
        .map_err(|e| format!("not a readable Ogg Vorbis file: {e}"))
}

impl StreamSource {
    /// Checks the file's header (channels and rate) without decoding it; a broken file fails here, at load.
    pub fn new(bytes: Vec<u8>) -> Result<Self, String> {
        let bytes: Arc<[u8]> = bytes.into();
        let reader = open(&bytes)?;
        let channels = reader.ident_hdr.audio_channels;
        let rate = reader.ident_hdr.audio_sample_rate;
        if channels == 0 || channels > 2 {
            return Err(format!(
                "{channels} channels is not supported; use mono or stereo"
            ));
        }
        if !(8_000..=192_000).contains(&rate) {
            return Err(format!(
                "{rate} Hz is outside the supported 8000 to 192000 Hz"
            ));
        }
        Ok(Self { bytes, rate })
    }

    /// Starts decoding from the beginning. A looping stream goes back to the start when it ends, without a gap.
    pub fn start(&self, looping: bool) -> StreamFeed {
        let bytes = self.bytes.clone();
        spawn(self.rate, move |push| {
            loop {
                let Ok(mut reader) = open(&bytes) else { return };
                let channels = reader.ident_hdr.audio_channels as usize;
                let mut produced = false;
                while let Ok(Some(packet)) = reader.read_dec_packet_itl() {
                    for frame in packet.chunks_exact(channels) {
                        let f = if channels == 1 {
                            [frame[0], frame[0]]
                        } else {
                            [frame[0], frame[1]]
                        };
                        produced = true;
                        if !push(f) {
                            return;
                        }
                    }
                }
                if !looping || !produced {
                    return;
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(feed: &StreamFeed, want: usize) -> Vec<[i16; 2]> {
        let mut out = Vec::new();
        let start = std::time::Instant::now();
        while out.len() < want && start.elapsed() < Duration::from_secs(5) {
            match feed.pop() {
                Some(f) => out.push(f),
                None if feed.finished() => break,
                None => std::thread::sleep(Duration::from_millis(1)),
            }
        }
        out
    }

    #[test]
    fn frames_arrive_in_order_and_the_stream_then_finishes() {
        let frames: Vec<[i16; 2]> = (0..1000).map(|i| [i, -i]).collect();
        let feed = StreamFeed::from_frames(44100, frames.clone(), false);
        assert_eq!(drain(&feed, 2000), frames);
        assert!(feed.finished());
        assert!(feed.pop().is_none());
    }

    #[test]
    fn a_stream_longer_than_the_ring_is_not_lost_or_reordered() {
        let frames: Vec<[i16; 2]> = (0..RING_FRAMES * 2 + 123)
            .map(|i| [(i % 30000) as i16, (i % 777) as i16])
            .collect();
        let feed = StreamFeed::from_frames(44100, frames.clone(), false);
        let got = drain(&feed, frames.len());
        assert_eq!(got.len(), frames.len());
        assert!(got == frames, "frames differ");
    }

    #[test]
    fn negative_samples_survive_packing() {
        for f in [[0, 0], [-1, 1], [i16::MIN, i16::MAX], [12345, -12345]] {
            assert_eq!(unpack(pack(f)), f);
        }
    }

    #[test]
    fn a_looping_stream_keeps_going_and_dropping_it_stops_the_thread() {
        let feed = StreamFeed::from_frames(8000, vec![[1, 1], [2, 2], [3, 3]], true);
        let got = drain(&feed, 10);
        assert_eq!(
            &got[..7],
            &[[1, 1], [2, 2], [3, 3], [1, 1], [2, 2], [3, 3], [1, 1]]
        );
        assert!(!feed.finished());
        let ring = feed.ring.clone();
        drop(feed);
        assert!(ring.stop.load(Ordering::Acquire));
        // The thread notices and marks itself done.
        let start = std::time::Instant::now();
        while !ring.done.load(Ordering::Acquire) && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(
            ring.done.load(Ordering::Acquire),
            "the decoder thread stopped"
        );
    }

    #[test]
    fn an_empty_stream_finishes_at_once() {
        let feed = StreamFeed::from_frames(8000, vec![], true);
        assert!(drain(&feed, 1).is_empty());
        assert!(feed.finished());
    }

    #[test]
    fn broken_files_are_clear_errors() {
        assert!(
            StreamSource::new(vec![])
                .err()
                .unwrap()
                .contains("not a readable Ogg Vorbis")
        );
        assert!(
            StreamSource::new(b"OggS\0\x02garbage".to_vec())
                .err()
                .unwrap()
                .contains("not a readable Ogg Vorbis")
        );
    }

    /// With `NOVA_TEST_OGG=/path/a.ogg` the streamed frames must equal the fully decoded ones, and looping must restart.
    #[test]
    fn a_real_file_streams_the_same_samples_as_it_decodes_to() {
        let Ok(path) = std::env::var("NOVA_TEST_OGG") else {
            return;
        };
        let bytes = std::fs::read(&path).unwrap();
        let whole = crate::assets::decode_ogg(&bytes).unwrap();
        let source = StreamSource::new(bytes).unwrap();
        assert_eq!(source.rate, whole.rate);
        let once = source.start(false);
        let got = drain(&once, whole.frames.len() + 10);
        assert_eq!(got.len(), whole.frames.len());
        assert!(
            got == whole.frames,
            "streamed frames match the decoded ones"
        );
        let looped = source.start(true);
        let twice = drain(&looped, whole.frames.len() * 2);
        assert_eq!(
            &twice[whole.frames.len()..],
            &whole.frames[..],
            "the second pass is the file again"
        );
        eprintln!("streamed {path}: {} frames, twice", whole.frames.len());
    }
}
