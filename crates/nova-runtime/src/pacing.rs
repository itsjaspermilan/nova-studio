//! Smooths the time step the game is given. The screen shows a new picture every vsync, 16.67 ms apart on a 60 Hz panel to the
//! microsecond, but the time between the moments the game starts its frames wanders by a millisecond or two (the thread is
//! woken a little early or late). Moving everything by the measured time then moves it unevenly between pictures that were shown
//! evenly: a car at 40 m/s that moves 0.67 m a frame jumps 7 cm more or less from one picture to the next, which the eye sees as
//! a stutter though no frame was late. So a step within a little of one display period (or a whole number of them, when a frame
//! was missed) is given as exactly that, and anything else is passed on as it was.

const WINDOW: usize = 63;
/// The period is worked out again this often (in frames), and held between.
const RECOMPUTE: usize = 30;
/// Refresh rates that panels have: an estimate within 4% of one is taken to be it exactly.
const NOMINAL_HZ: [f32; 7] = [48.0, 50.0, 60.0, 72.0, 90.0, 120.0, 144.0];
/// A step this close (as a share of the period) to a whole number of periods is taken to be that number.
const TOLERANCE: f32 = 0.14;

#[derive(Default)]
pub struct Pacer {
    recent: Vec<f32>,
    next: usize,
    frames: usize,
    period: Option<f32>,
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
        if self.recent.len() >= 12 && (self.period.is_none() || self.frames.is_multiple_of(RECOMPUTE)) {
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
        let k = (dt / period).round();
        if (1.0..=6.0).contains(&k) && (dt - k * period).abs() < TOLERANCE * period {
            k * period
        } else {
            dt
        }
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
    fn a_missed_frame_and_a_real_hitch_are_passed_on() {
        let mut pacer = Pacer::default();
        for d in wobbly(100) {
            pacer.step(d);
        }
        let period = pacer.step(1.0 / 60.0);
        // a missed vsync is two periods, exactly; a 25 ms frame is not a whole number of periods and stays as it was
        assert!((pacer.step(2.03 / 60.0) - 2.0 * period).abs() < 1e-5);
        assert_eq!(pacer.step(0.025), 0.025);
        assert_eq!(pacer.step(0.2), 0.2);
    }

    #[test]
    fn nothing_is_changed_until_the_period_is_known() {
        let mut pacer = Pacer::default();
        assert_eq!(pacer.step(0.0171), 0.0171);
    }
}
