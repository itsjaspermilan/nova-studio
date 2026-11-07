//! Drawing many animated models cheaply: the level of detail of a model that plays a clip, and the sharing of one pose (one set
//! of joint matrices) between every character that draws the same model, clip and moment.

use super::retained_api::Lod;

/// Which pose a character is in: the clip (its number among the model's clips) and the moment in it, snapped to the pose step.
/// Two draws of one model with equal keys have equal joint matrices, so they share one set of them in the frame's palette.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) struct PoseKey {
    pub clip: u32,
    /// The snapped time in the clip (its seconds as `f32` bits; times are never negative).
    pub time: u32,
}

impl PoseKey {
    /// The key of a clip at `local` seconds (already folded into the clip's own length) and the time the pose is made at.
    /// A `step` of 0 (or less) keeps the exact time, so only draws at precisely the same moment share; a step such as 1/15
    /// snaps the time down to a multiple of it, so that a crowd with every phase becomes a few dozen poses.
    pub fn new(clip: usize, local: f32, step: f32) -> (Self, f32) {
        let local = if local.is_finite() {
            local.max(0.0)
        } else {
            0.0
        };
        let snapped = if step > 1e-4 {
            (local / step).floor() * step
        } else {
            local
        };
        (
            Self {
                clip: clip as u32,
                time: snapped.to_bits(),
            },
            snapped,
        )
    }
}

/// How strongly the near (animated or full) model and the far (cheaper) one are drawn at a distance: the screen-door
/// dissolve of each (`None`: not drawn; 0: solid; the near copy at `-t` and the far one at `t` fill every pixel once).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct LodDissolve {
    pub near: Option<f32>,
    pub far: Option<f32>,
}

pub(super) fn lod_dissolve(state: Lod) -> LodDissolve {
    match state {
        Lod::Near => LodDissolve {
            near: Some(0.0),
            far: None,
        },
        Lod::Far => LodDissolve {
            near: None,
            far: Some(0.0),
        },
        Lod::Blend(t) => LodDissolve {
            near: Some(-t),
            far: Some(t),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::retained_api::lod_state;

    #[test]
    fn nearby_moments_share_a_pose_when_snapped() {
        let step = 1.0 / 15.0;
        let (a, ta) = PoseKey::new(2, 0.50, step);
        let (b, _) = PoseKey::new(2, 0.52, step);
        let (c, _) = PoseKey::new(2, 0.60, step);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(ta <= 0.50 && 0.50 - ta < step);
    }

    #[test]
    fn exact_times_only_share_when_equal() {
        let (a, _) = PoseKey::new(0, 0.5, 0.0);
        let (b, _) = PoseKey::new(0, 0.5, 0.0);
        let (c, _) = PoseKey::new(0, 0.5001, 0.0);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn different_clips_do_not_share() {
        assert_ne!(PoseKey::new(0, 0.3, 0.1).0, PoseKey::new(1, 0.3, 0.1).0);
    }

    #[test]
    fn a_crowd_of_random_phases_becomes_few_poses() {
        let step = 1.0 / 15.0;
        let duration = 1.2f32;
        let keys: std::collections::HashSet<_> = (0..300)
            .map(|i| PoseKey::new(0, (i as f32 * 0.6180339).fract() * duration, step).0)
            .collect();
        assert!(keys.len() <= 18, "{} poses", keys.len());
    }

    #[test]
    fn bad_times_are_zero() {
        assert_eq!(PoseKey::new(0, f32::NAN, 0.1).1, 0.0);
        assert_eq!(PoseKey::new(0, -3.0, 0.1).1, 0.0);
    }

    #[test]
    fn the_far_model_takes_over_past_the_distance() {
        let at = |d| lod_dissolve(lod_state(d, 40.0, 6.0));
        assert_eq!(at(10.0).near, Some(0.0));
        assert_eq!(at(10.0).far, None);
        assert_eq!(at(90.0).near, None);
        assert_eq!(at(90.0).far, Some(0.0));
        let mid = at(40.0);
        let (n, f) = (mid.near.unwrap(), mid.far.unwrap());
        assert!(n < 0.0 && f > 0.0 && (n + f).abs() < 1e-6);
    }
}
