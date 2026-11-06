//! Two-bone inverse kinematics: where a limb's middle joint goes so that its far end reaches a target (a foot on the step it is
//! about to stand on, a hand on a ledge), and the turns that take the limb there. Plain maths on points; `nova.ik` in `game.rs` applies
//! it to a model's parts.

use glam::{Quat, Vec3};

/// The shortest turn that takes the direction `from` to the direction `to` (the identity if either is nothing).
pub fn arc(from: Vec3, to: Vec3) -> Quat {
    let (a, b) = (from.normalize_or_zero(), to.normalize_or_zero());
    if a == Vec3::ZERO || b == Vec3::ZERO {
        return Quat::IDENTITY;
    }
    Quat::from_rotation_arc(a, b)
}

/// A limb of two bones from `root` through `mid` to `tip` (their places now), asked to reach `target`. `pole` is a point the middle
/// joint should bend toward (a knee toward the front, an elbow toward the back); without one, it bends the way it bends now.
/// Returns the new place of the middle joint, the new place of the tip (the target if it can be reached, otherwise as near as the
/// limb stretches, in the target's direction) and whether the target was reachable. The bone lengths are kept.
pub fn two_bone(
    root: Vec3,
    mid: Vec3,
    tip: Vec3,
    target: Vec3,
    pole: Option<Vec3>,
) -> (Vec3, Vec3, bool) {
    let a = (mid - root).length();
    let b = (tip - mid).length();
    let to_target = target - root;
    let wanted = to_target.length();
    if a < 1e-6 || b < 1e-6 || wanted < 1e-6 {
        return (mid, tip, false);
    }
    let u = to_target / wanted;
    // how far the limb can stretch or fold: never fully straight (it would have no direction to bend) nor fully folded
    let (lo, hi) = ((a - b).abs() + 1e-4, a + b - 1e-4);
    let reachable = wanted >= lo && wanted <= hi;
    let d = wanted.clamp(lo, hi);
    // the law of cosines: the middle joint is `x` along the line to the target and `h` off it
    let x = (a * a - b * b + d * d) / (2.0 * d);
    let h = (a * a - x * x).max(0.0).sqrt();
    // which way off the line: toward the pole, or the way the limb bends now
    let toward = pole.map_or(mid - root, |p| p - root);
    let mut n = toward - u * toward.dot(u);
    if n.length_squared() < 1e-10 {
        n = (mid - root) - u * (mid - root).dot(u);
    }
    if n.length_squared() < 1e-10 {
        // a straight limb with no pole: any direction across the line will do
        n = u.cross(if u.y.abs() < 0.9 { Vec3::Y } else { Vec3::X });
    }
    let n = n.normalize();
    (root + u * x + n * h, root + u * d, reachable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1e-4
    }

    #[test]
    fn a_reachable_target_is_reached_with_the_bones_the_same_length() {
        let (root, mid, tip) = (
            Vec3::ZERO,
            Vec3::new(0.0, -1.0, 0.0),
            Vec3::new(0.0, -2.0, 0.0),
        );
        let target = Vec3::new(0.6, -1.2, 0.3);
        let (m, t, reached) = two_bone(root, mid, tip, target, Some(Vec3::new(0.0, 0.0, 5.0)));
        assert!(reached);
        assert!(close(t, target), "the tip is on the target: {t:?}");
        assert!(
            ((m - root).length() - 1.0).abs() < 1e-4,
            "upper bone length"
        );
        assert!(((t - m).length() - 1.0).abs() < 1e-4, "lower bone length");
        assert!(m.z > 0.0, "the knee bends toward the pole (+z): {m:?}");
    }

    #[test]
    fn the_other_pole_bends_the_other_way() {
        let (root, mid, tip) = (
            Vec3::ZERO,
            Vec3::new(0.0, -1.0, 0.0),
            Vec3::new(0.0, -2.0, 0.0),
        );
        let target = Vec3::new(0.0, -1.2, 0.0);
        let (front, _, _) = two_bone(root, mid, tip, target, Some(Vec3::new(0.0, 0.0, 5.0)));
        let (back, _, _) = two_bone(root, mid, tip, target, Some(Vec3::new(0.0, 0.0, -5.0)));
        assert!(front.z > 0.1 && back.z < -0.1, "{front:?} {back:?}");
    }

    #[test]
    fn a_target_out_of_reach_stretches_toward_it_and_says_so() {
        let (root, mid, tip) = (
            Vec3::ZERO,
            Vec3::new(0.0, -1.0, 0.0),
            Vec3::new(0.0, -2.0, 0.0),
        );
        let target = Vec3::new(0.0, -5.0, 0.0);
        let (m, t, reached) = two_bone(root, mid, tip, target, None);
        assert!(!reached);
        assert!(
            t.y < -1.99 && t.y > -2.0,
            "stretched almost straight: {t:?}"
        );
        assert!(
            m.x.abs() < 0.05,
            "the middle joint is almost in line: {m:?}"
        );
        // and too close folds the limb without going wrong
        let (m, t, reached) = two_bone(root, mid, tip, Vec3::new(0.0, -0.00001, 0.0), None);
        assert!(!reached && m.is_finite() && t.is_finite());
    }

    #[test]
    fn the_arc_takes_one_direction_to_another() {
        let q = arc(Vec3::X, Vec3::Z);
        assert!(close(q * Vec3::X, Vec3::Z));
        assert_eq!(arc(Vec3::ZERO, Vec3::Z), Quat::IDENTITY);
        // opposite directions still give a turn that works
        assert!(close(arc(Vec3::X, -Vec3::X) * Vec3::X, -Vec3::X));
    }
}
