//! Which point out.iter().find(|l| l.position[1] == 3.0)ights a frame uses, and how they come and go. A script may ask for any number of lights each frame; the
//! renderer takes a budget of the ones that matter most (nearest the camera, by the edge of their reach) and fades a light
//! in or out over a quarter of a second when the choice changes, so that walking past a row of lamps does not make them
//! flick on and off. A light that is new is on at once and one that is no longer asked for is off at once: a muzzle flash
//! or a pickup that vanishes is the script's decision, not the renderer's.

use crate::gfx::PointLight;

/// Lights kept in the view at once (the renderer's array also has room for the few that are fading out).
pub const LIGHT_BUDGET: usize = 16;
/// Most lights a script can ask for in a frame; the rest are ignored.
const MAX_REQUESTS: usize = 256;
/// Fade speed: a light goes from off to on in this many seconds.
const FADE_SECONDS: f32 = 0.25;
/// A light that is on keeps its place against one that is just as near by this many metres (no flicker at the boundary).
const KEEP_BONUS: f32 = 2.0;

#[derive(Clone, Copy)]
struct Tracked {
    position: [f32; 3],
    radius: f32,
    level: f32,
}

#[derive(Default)]
pub struct LightFader {
    tracked: Vec<Tracked>,
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

impl LightFader {
    /// The lights to draw this frame (at most `capacity`), from what the script asked for, with colours scaled by how far
    /// each has faded in. A light is the same one as last frame's if it is near where that was (lights that move, a lantern
    /// carried by a player, move less than that in a frame).
    pub fn resolve(
        &mut self,
        requests: &[PointLight],
        eye: [f32; 3],
        dt: f32,
        capacity: usize,
    ) -> Vec<PointLight> {
        let requests = &requests[..requests.len().min(MAX_REQUESTS)];
        // which of last frame's lights each request is (the nearest within reach of it, each used once)
        let mut taken = vec![false; self.tracked.len()];
        let previous: Vec<Option<Tracked>> = requests
            .iter()
            .map(|r| {
                let tolerance = 0.5 + r.radius * 0.25;
                let best = self
                    .tracked
                    .iter()
                    .enumerate()
                    .filter(|(i, t)| !taken[*i] && (t.radius - r.radius).abs() < 0.01)
                    .map(|(i, t)| (i, distance(t.position, r.position)))
                    .filter(|(_, d)| *d <= tolerance)
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                best.map(|(i, _)| {
                    taken[i] = true;
                    self.tracked[i]
                })
            })
            .collect();
        // the most important first: nearest to the camera by the edge of its reach
        let mut order: Vec<usize> = (0..requests.len()).collect();
        let score = |i: usize| {
            let d = distance(requests[i].position, eye);
            let held = previous[i].is_some_and(|t| t.level >= 0.5);
            (d - requests[i].radius).max(0.0) + d * 0.001 - if held { KEEP_BONUS } else { 0.0 }
        };
        order.sort_by(|&a, &b| score(a).total_cmp(&score(b)));
        let mut chosen = vec![false; requests.len()];
        for &i in order.iter().take(LIGHT_BUDGET.min(capacity)) {
            chosen[i] = true;
        }
        let step = if FADE_SECONDS > 0.0 {
            dt / FADE_SECONDS
        } else {
            1.0
        };
        let mut next = Vec::with_capacity(requests.len());
        let mut levels = vec![0.0f32; requests.len()];
        for (i, r) in requests.iter().enumerate() {
            let target = if chosen[i] { 1.0 } else { 0.0 };
            // a light seen for the first time is on or off at once; one seen before moves toward its target
            let level = match previous[i] {
                None => target,
                Some(t) => {
                    if target > t.level {
                        (t.level + step).min(target)
                    } else {
                        (t.level - step).max(target)
                    }
                }
            };
            levels[i] = level;
            next.push(Tracked {
                position: r.position,
                radius: r.radius,
                level,
            });
        }
        self.tracked = next;
        // those chosen first, then the ones still fading out (brightest first) while there is room
        let mut out = Vec::new();
        let mut fading: Vec<usize> = Vec::new();
        for &i in &order {
            if levels[i] <= 0.001 {
                continue;
            }
            if chosen[i] {
                out.push(i);
            } else {
                fading.push(i);
            }
        }
        fading.sort_by(|&a, &b| levels[b].total_cmp(&levels[a]));
        out.extend(fading);
        out.truncate(capacity);
        out.into_iter()
            .map(|i| {
                let r = requests[i];
                PointLight {
                    color: [
                        r.color[0] * levels[i],
                        r.color[1] * levels[i],
                        r.color[2] * levels[i],
                    ],
                    ..r
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lamp(x: f32) -> PointLight {
        PointLight {
            position: [x, 2.0, 0.0],
            radius: 5.0,
            color: [1.0, 1.0, 1.0],
        }
    }

    fn lamps(from: f32, count: usize) -> Vec<PointLight> {
        (0..count).map(|i| lamp(from + i as f32 * 10.0)).collect()
    }

    #[test]
    fn the_nearest_lights_are_used_not_the_first_asked_for() {
        let mut f = LightFader::default();
        // 40 lamps along a street, asked for far end first; the camera is at the near end
        let mut asked = lamps(0.0, 40);
        asked.reverse();
        let out = f.resolve(&asked, [0.0, 2.0, 0.0], 1.0 / 60.0, 20);
        assert_eq!(out.len(), LIGHT_BUDGET);
        assert!(
            out.iter().all(|l| l.position[0] <= 150.0),
            "the sixteen nearest"
        );
    }

    #[test]
    fn a_light_that_changes_places_with_another_fades_instead_of_switching() {
        let mut f = LightFader::default();
        let asked = lamps(0.0, 20);
        // standing at the start: lamps 0..15 are lit at full
        let out = f.resolve(&asked, [0.0, 2.0, 0.0], 1.0 / 60.0, 20);
        assert!(out.iter().all(|l| l.color[0] == 1.0));
        // walk to the other end in one jump: the far ones must come in and the near ones go out over a few frames
        let mut brightest_new: f32 = 0.0;
        let mut frames = 0;
        loop {
            let out = f.resolve(&asked, [200.0, 2.0, 0.0], 1.0 / 60.0, 20);
            frames += 1;
            let at = |x: f32| {
                out.iter()
                    .find(|l| l.position[0] == x)
                    .map_or(0.0, |l| l.color[0])
            };
            if frames == 1 {
                assert!(
                    at(190.0) < 0.2,
                    "a light that is coming in starts dim: {}",
                    at(190.0)
                );
                assert!(
                    at(0.0) > 0.8,
                    "a light that is going out starts bright: {}",
                    at(0.0)
                );
                assert!(out.len() <= 20);
            }
            brightest_new = brightest_new.max(at(190.0));
            if at(0.0) == 0.0 && at(190.0) == 1.0 {
                break;
            }
            assert!(frames < 60, "it settles within a second");
        }
        assert!(
            frames >= 10,
            "it takes a quarter of a second, not one frame: {frames}"
        );
        assert_eq!(brightest_new, 1.0);
    }

    #[test]
    fn a_new_light_is_on_at_once_and_one_not_asked_for_is_gone_at_once() {
        let mut f = LightFader::default();
        let out = f.resolve(&[lamp(1.0)], [0.0; 3], 1.0 / 60.0, 20);
        assert_eq!(out[0].color, [1.0; 3], "a muzzle flash is not faded in");
        assert!(f.resolve(&[], [0.0; 3], 1.0 / 60.0, 20).is_empty());
    }

    #[test]
    fn a_light_that_moves_a_little_each_frame_is_the_same_light() {
        let mut f = LightFader::default();
        let mut asked = lamps(0.0, 20);
        f.resolve(&asked, [0.0; 3], 1.0 / 60.0, 20);
        // the far lamps are out of the set; one of them is carried toward the player a metre a frame (less than the reach that makes two lights the same one)
        let mut x = 160.0;
        let mut levels = Vec::new();
        for _ in 0..60 {
            x -= 1.0;
            asked[19] = PointLight {
                position: [x, 3.0, 0.0],
                ..lamp(x)
            };
            let out = f.resolve(&asked, [0.0; 3], 1.0 / 60.0, 20);
            levels.push(
                out.iter()
                    .find(|l| l.position[1] == 3.0)
                    .map_or(0.0, |l| l.color[0]),
            );
        }
        assert!(
            levels.iter().any(|l| *l > 0.0 && *l < 1.0),
            "it was faded in, not switched: {levels:?}"
        );
        // it comes in smoothly as it nears the front of the queue, never jumping by more than the fade step
        for w in levels.windows(2) {
            assert!(
                w[1] - w[0] <= 1.0 / 60.0 / FADE_SECONDS + 1e-4,
                "{levels:?}"
            );
        }
    }
}
