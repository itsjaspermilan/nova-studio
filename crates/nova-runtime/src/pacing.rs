//! Smooths the time step the game is given. The screen shows a new picture every vsync, 16.67 ms apart on a 60 Hz panel to the
//! microsecond, but the time between the moments the game starts its frames wanders by a millisecond or two (the thread is
//! woken a little early or late). Moving everything by the measured time then moves it unevenly between pictures that were shown
//! evenly: a car at 40 m/s that moves 0.67 m a frame jumps 7 cm more or less from one picture to the next, which the eye sees as
//! a stutter though no frame was late. So the game is given whole display periods: one normally, two when a vsync was missed.
//! What that leaves over or short is kept account of, fading, so a late wake-up and the early one after it even out, and a long
//! run of slightly long frames (a panel at 59.6 Hz taken to be 60) adds a period now and then rather than piling up.
//!
//! The wobble can be large. Under gamescope on the Retroid Pocket 6 (2026-11-23) a quarter of the frames started 25 ms after
//! the last and the next one 8 ms after that, while the panel showed one picture every 16.7 ms: a 25 ms step is one and a half
//! periods, and passing it on as it was made a turning camera jump. The account gives both of them one period.

const WINDOW: usize = 63;
/// The period is worked out again this often (in frames), and held between.
const RECOMPUTE: usize = 30;
/// Refresh rates that panels have: an estimate within 4% of one is taken to be it exactly.
const NOMINAL_HZ: [f32; 7] = [48.0, 50.0, 60.0, 72.0, 90.0, 120.0, 144.0];
/// How far (in periods) the time not yet given must reach past a whole number before one more period is given: a frame
/// measured at 1.5 periods after one of 0.5 is one late wake-up, not a missed vsync.
const LEAN: f32 = 0.25;
/// A step of more periods than this (a real hitch, a loading pause) is given as it was measured.
const MOST: f32 = 6.5;
/// How much of the account is kept from one frame to the next: it only has to carry a late wake-up over to the next frame.
const KEEP: f32 = 0.95;

#[derive(Default)]
pub struct Pacer {
    recent: Vec<f32>,
    next: usize,
    frames: usize,
    period: Option<f32>,
    /// Real time that has passed but not yet been given to the game (negative: given ahead of time), in seconds; fading.
    owed: f32,
}

impl Pacer {
    /// The step to give the game for a frame that was measured to take `dt` seconds.
    pub fn step(&mut self, dt: f32) -> f32 {
        // what the display does: the middle of the recent steps that look like single periods (4 to 25 ms)
        if (0.004..0.025).contains(&dt) {
            if self.recent.len() < WINDOW {
                self.recent.push(dt);
            } else {
                self.recent[self.next] = dt;
                self.next = (self.next + 1) % WINDOW;
            }
        }
        self.frames += 1;
        if self.recent.len() >= 12
            && (self.period.is_none() || self.frames.is_multiple_of(RECOMPUTE))
        {
            let mut sorted = self.recent.clone();
            sorted.sort_by(f32::total_cmp);
            let median = sorted[sorted.len() / 2];
            let nominal = NOMINAL_HZ
                .iter()
                .map(|hz| 1.0 / hz)
                .find(|p| (median - p).abs() < 0.04 * p);
            self.period = Some(nominal.unwrap_or(median));
        }
        let Some(period) = self.period else {
            return dt;
        };
        let periods = dt / period;
        // a real hitch, or a frame far shorter than the period (the display changed): pass the time on as it was
        if !(0.25..=MOST).contains(&periods) {
            self.owed = 0.0;
            return dt;
        }
        let mut k = (periods - LEAN).round().max(1.0);
        self.owed = self.owed * KEEP + dt - k * period;
        if self.owed > period {
            k += 1.0;
            self.owed -= period;
        } else if self.owed < -period && k > 1.0 {
            k -= 1.0;
            self.owed += period;
        }
        k * period
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Frame steps as a 60 Hz display shows them, with the thread waking up to 1.8 ms early or late.
    fn wobbly(n: usize) -> Vec<f32> {
        let mut seed = 7u32;
        (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let jitter = ((seed >> 8) as f32 / (1 << 24) as f32 - 0.5) * 3.6e-3;
                1.0 / 60.0 + jitter
            })
            .collect()
    }

    #[test]
    fn a_wobbly_step_is_made_even_without_drifting_from_real_time() {
        let mut pacer = Pacer::default();
        let raw = wobbly(600);
        let given: Vec<f32> = raw.iter().map(|&d| pacer.step(d)).collect();
        let settled = &given[60..];
        let (lo, hi) = settled
            .iter()
            .fold((f32::MAX, 0.0f32), |(a, b), &d| (a.min(d), b.max(d)));
        assert!(
            hi - lo < 2e-4,
            "the steps given are even once the display's period is known: {lo} to {hi}"
        );
        let (real, ours): (f32, f32) = (raw.iter().sum(), given.iter().sum());
        assert!(
            (real - ours).abs() < 0.05 * real.max(1e-3) + 0.03,
            "time kept: {real} against {ours}"
        );
    }

    #[test]
    fn a_missed_frame_is_two_periods_and_a_real_hitch_is_passed_on() {
        let mut pacer = Pacer::default();
        for d in wobbly(100) {
            pacer.step(d);
        }
        let period = pacer.step(1.0 / 60.0);
        // a missed vsync is two periods, exactly; a long pause is what it was
        assert!((pacer.step(2.03 / 60.0) - 2.0 * period).abs() < 1e-5);
        pacer.step(1.0 / 60.0);
        assert!((pacer.step(0.2) - 0.2).abs() < 0.02);
        assert!((pacer.step(1.0 / 60.0) - period).abs() < 1e-5);
    }

    /// The Retroid Pocket 6 under gamescope: one frame in four or so starts 25 ms after the last and the next 8 ms after that,
    /// while the panel shows a picture every 16.7 ms. Each is given one period, and no time is lost.
    #[test]
    fn a_late_wake_up_and_the_early_one_after_it_are_one_period_each() {
        let mut pacer = Pacer::default();
        for d in wobbly(100) {
            pacer.step(d);
        }
        let period = pacer.step(1.0 / 60.0);
        let pattern = [
            0.0167, 0.0169, 0.0256, 0.0080, 0.0170, 0.0165, 0.0246, 0.0091, 0.0167,
        ];
        let mut real = 0.0;
        let mut given = 0.0;
        for _ in 0..50 {
            for &d in &pattern {
                let g = pacer.step(d);
                assert!(
                    (g - period).abs() < 1e-5,
                    "{d} s was given {g} s, not one period"
                );
                real += d;
                given += g;
            }
        }
        assert!(
            (real - given).abs() < 0.01 * real + period,
            "time kept: {real} against {given}"
        );
    }

    #[test]
    fn thirty_frames_a_second_are_two_periods_each() {
        let mut pacer = Pacer::default();
        for d in wobbly(100) {
            pacer.step(d);
        }
        let period = pacer.step(1.0 / 60.0);
        for d in [0.0333, 0.0335, 0.0331, 0.0334] {
            assert!((pacer.step(d) - 2.0 * period).abs() < 1e-5);
        }
    }

    #[test]
    fn nothing_is_changed_until_the_period_is_known() {
        let mut pacer = Pacer::default();
        assert_eq!(pacer.step(0.0171), 0.0171);
    }
}
