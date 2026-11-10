//! Music with loop points: an Ogg whose comments say `LOOPSTART` and `LOOPLENGTH` plays from the beginning to the loop's end and then loops between the two,
//! not back to the very start. The fixture is 3 s of mono 8 kHz sound with a loop from frame 8000 to 16000 (made by the studio's encoder).

use std::time::{Duration, Instant};

use nova_runtime::stream::{StreamFeed, StreamSource};

const OGG: &[u8] = include_bytes!("fixtures/loop_points.ogg");

fn take(feed: &StreamFeed, n: usize) -> Vec<[i16; 2]> {
    let mut out = Vec::with_capacity(n);
    let deadline = Instant::now() + Duration::from_secs(10);
    while out.len() < n {
        match feed.pop() {
            Some(f) => out.push(f),
            None => {
                assert!(
                    Instant::now() < deadline,
                    "the decoder stalled at {}",
                    out.len()
                );
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }
    out
}

#[test]
fn the_loop_points_are_read_from_the_comments() {
    let source = StreamSource::new(OGG.to_vec()).expect("a readable file");
    assert_eq!(source.loop_points, Some((8000, 16000)));
}

#[test]
fn a_looping_play_goes_back_to_the_loop_start_not_the_beginning() {
    let source = StreamSource::new(OGG.to_vec()).unwrap();
    let whole = take(&source.start(false), 24_000);
    let looped = take(&source.start(true), 16_000 + 8_000 + 500);
    // first the intro and the loop once ...
    assert_eq!(&looped[..16_000], &whole[..16_000]);
    // ... then the loop again, from its start, and again after that
    assert_eq!(&looped[16_000..24_000], &whole[8_000..16_000]);
    assert_eq!(&looped[24_000..], &whole[8_000..8_500]);
}

#[test]
fn a_play_that_does_not_loop_plays_the_whole_file_and_a_late_start_comes_back_inside_the_loop() {
    let source = StreamSource::new(OGG.to_vec()).unwrap();
    let whole = take(&source.start(false), 24_000);
    // a position counted across loops (20000 is 4000 into the loop's second go) comes back inside it
    let late = take(&source.start_at(true, 20_000), 1000);
    assert_eq!(&late[..], &whole[12_000..13_000]);
}
