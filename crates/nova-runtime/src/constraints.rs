//! Constraints on a model's parts, made in the studio (`"constraints"` on a part; glTF node `extras.nova.constraints`) and kept live in the game:
//! rules that adjust a pose after an animation has said what it is. `Limit` keeps a part's turn between bounds, `Copy` follows another
//! part's turn, `Reach` bends a limb of three parts so its end meets a target. The same rules as the studio's `lib/model-constraints.ts`, which
//! applies them to what it shows and bakes them into keys.
//!
//! Turns are compared as degrees about x, y and z in the order the studio uses (three.js "XYZ", glam's `EulerRot::XYZ`).

use crate::ik;
use crate::model::PartPose;
use glam::{EulerRot, Mat4, Quat, Vec3};

#[derive(Clone, Debug, PartialEq)]
pub enum Constraint {
    /// Keep the turn between `min` and `max` (degrees about x, y, z).
    Limit { min: [f32; 3], max: [f32; 3] },
    /// Follow the turn of the part at `from` (names from the root joined by `/`) on the chosen axes, `mix` of the way (0 to 1).
    Copy {
        from: String,
        axes: [bool; 3],
        mix: f32,
    },
    /// Bend the limb this part starts (it, its first child, that child's first child) so its end is at `target` (in the model's space,
    /// metres), the middle joint bending toward the direction `pole`.
    Reach { target: [f32; 3], pole: [f32; 3] },
}

/// What a part contributes: where it hangs, how it rests, and its rules.
pub struct PartInfo<'a> {
    pub name: &'a str,
    pub parent: Option<usize>,
    pub rest: Mat4,
    pub constraints: &'a [Constraint],
}

/// Reads `extras.nova.constraints` of a glTF node (a JSON string): the list of rules, malformed ones skipped.
pub fn parse(raw: &str) -> Vec<Constraint> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(list) = v["nova"]["constraints"].as_array() else {
        return Vec::new();
    };
    let three = |v: &serde_json::Value| -> Option<[f32; 3]> {
        let a = v.as_array()?;
        let mut out = [0.0f32; 3];
        for (i, slot) in out.iter_mut().enumerate() {
            let n = a.get(i)?.as_f64()? as f32;
            if !n.is_finite() {
                return None;
            }
            *slot = n;
        }
        Some(out)
    };
    list.iter()
        .filter_map(|c| match c["type"].as_str()? {
            "limit" => Some(Constraint::Limit {
                min: three(&c["min"])?,
                max: three(&c["max"])?,
            }),
            "copy" => {
                let axes = c["axes"].as_array()?;
                Some(Constraint::Copy {
                    from: c["from"].as_str()?.to_string(),
                    axes: [
                        axes.first()?.as_bool()?,
                        axes.get(1)?.as_bool()?,
                        axes.get(2)?.as_bool()?,
                    ],
                    mix: (c["mix"].as_f64()? as f32).clamp(0.0, 1.0),
                })
            }
            "reach" => Some(Constraint::Reach {
                target: three(&c["target"])?,
                pole: three(&c["pole"]).unwrap_or([0.0, 0.0, 1.0]),
            }),
            _ => None,
        })
        .collect()
}

fn euler_deg(q: Quat) -> [f32; 3] {
    let (x, y, z) = q.to_euler(EulerRot::XYZ);
    [x.to_degrees(), y.to_degrees(), z.to_degrees()]
}

fn from_euler_deg(e: [f32; 3]) -> Quat {
    Quat::from_euler(
        EulerRot::XYZ,
        e[0].to_radians(),
        e[1].to_radians(),
        e[2].to_radians(),
    )
}

fn clamp_between(v: f32, a: f32, b: f32) -> f32 {
    v.clamp(a.min(b), a.max(b))
}

fn rotation_of(parts: &[PartInfo], poses: &[PartPose], i: usize) -> Quat {
    poses[i]
        .rotation
        .unwrap_or_else(|| parts[i].rest.to_scale_rotation_translation().1)
}

/// Every part's place in the model with the poses as they are now (parents come before their children).
fn worlds(parts: &[PartInfo], poses: &[PartPose]) -> Vec<Mat4> {
    let mut world = vec![Mat4::IDENTITY; parts.len()];
    for (i, p) in parts.iter().enumerate() {
        let (s0, r0, t0) = p.rest.to_scale_rotation_translation();
        let local = Mat4::from_scale_rotation_translation(
            poses[i].scale.unwrap_or(s0),
            poses[i].rotation.unwrap_or(r0),
            poses[i].translation.unwrap_or(t0),
        );
        world[i] = p.parent.map_or(local, |q| world[q] * local);
    }
    world
}

fn first_child(parts: &[PartInfo], of: usize) -> Option<usize> {
    parts.iter().position(|p| p.parent == Some(of))
}

fn path_of(parts: &[PartInfo], mut i: usize) -> String {
    let mut names = vec![parts[i].name];
    while let Some(p) = parts[i].parent {
        names.push(parts[p].name);
        i = p;
    }
    names.reverse();
    names.join("/")
}

/// Applies every part's rules to the poses, parents first. A model with no rules is left alone.
pub fn apply(parts: &[PartInfo], poses: &mut [PartPose]) {
    if parts.iter().all(|p| p.constraints.is_empty()) {
        return;
    }
    let paths: Vec<String> = (0..parts.len()).map(|i| path_of(parts, i)).collect();
    for i in 0..parts.len() {
        for c in parts[i].constraints {
            match c {
                Constraint::Limit { min, max } => {
                    let mut e = euler_deg(rotation_of(parts, poses, i));
                    for a in 0..3 {
                        e[a] = clamp_between(e[a], min[a], max[a]);
                    }
                    poses[i].rotation = Some(from_euler_deg(e));
                }
                Constraint::Copy { from, axes, mix } => {
                    let Some(src) = paths.iter().position(|p| p == from) else {
                        continue;
                    };
                    let s = euler_deg(rotation_of(parts, poses, src));
                    let mut e = euler_deg(rotation_of(parts, poses, i));
                    for a in 0..3 {
                        if axes[a] {
                            e[a] += (s[a] - e[a]) * mix;
                        }
                    }
                    poses[i].rotation = Some(from_euler_deg(e));
                }
                Constraint::Reach { target, pole } => {
                    let Some(m) = first_child(parts, i) else {
                        continue;
                    };
                    let Some(g) = first_child(parts, m) else {
                        continue;
                    };
                    let w = worlds(parts, poses);
                    let (root, mid, tip) = (
                        w[i].w_axis.truncate(),
                        w[m].w_axis.truncate(),
                        w[g].w_axis.truncate(),
                    );
                    let pole_point = root + Vec3::from(*pole).normalize_or_zero() * 10.0;
                    let (new_mid, new_tip, _) =
                        ik::two_bone(root, mid, tip, Vec3::from(*target), Some(pole_point));
                    // the upper part turns so the bone to the middle joint points where it should ...
                    let parent_rot = |w: &[Mat4], k: usize| {
                        parts[k]
                            .parent
                            .map_or(Quat::IDENTITY, |p| w[p].to_scale_rotation_translation().1)
                    };
                    let upper_world = w[i].to_scale_rotation_translation().1;
                    let new_upper = ik::arc(mid - root, new_mid - root) * upper_world;
                    poses[i].rotation = Some((parent_rot(&w, i).inverse() * new_upper).normalize());
                    // ... and the middle part so the bone to the end does
                    let w2 = worlds(parts, poses);
                    let (mid2, tip2) = (w2[m].w_axis.truncate(), w2[g].w_axis.truncate());
                    let middle_world = w2[m].to_scale_rotation_translation().1;
                    let new_middle = ik::arc(tip2 - mid2, new_tip - new_mid) * middle_world;
                    poses[m].rotation =
                        Some((parent_rot(&w2, m).inverse() * new_middle).normalize());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1e-3
    }

    #[test]
    fn the_euler_order_is_the_studios() {
        // three.js: new Quaternion().setFromEuler(new Euler(30°, 40°, 50°, "XYZ"))
        let q = from_euler_deg([30.0, 40.0, 50.0]);
        let want = Quat::from_xyzw(0.360_042_17, 0.196_628_23, 0.463_826_9, 0.785_220_7);
        assert!(q.dot(want).abs() > 0.999_999, "{q:?}");
        let e = euler_deg(q);
        assert!(
            (e[0] - 30.0).abs() < 1e-3 && (e[1] - 40.0).abs() < 1e-3 && (e[2] - 50.0).abs() < 1e-3
        );
    }

    #[test]
    fn rules_are_read_from_the_node_extras_and_bad_ones_skipped() {
        let raw = r#"{"nova":{"constraints":[
            {"type":"limit","min":[-10,0,0],"max":[10,0,0]},
            {"type":"copy","from":"body/arm","axes":[true,false,true],"mix":0.5},
            {"type":"reach","target":[0,-1,0]},
            {"type":"limit","min":[0,0]},
            {"type":"mystery"}]}}"#;
        let list = parse(raw);
        assert_eq!(list.len(), 3);
        assert_eq!(
            list[2],
            Constraint::Reach {
                target: [0.0, -1.0, 0.0],
                pole: [0.0, 0.0, 1.0]
            }
        );
        assert!(parse("not json").is_empty() && parse("{}").is_empty());
    }

    fn limb(constraints: &[Vec<Constraint>]) -> (Vec<Mat4>, Vec<String>) {
        // a body, and an arm hanging from it: arm -> forearm -> hand, each one unit down
        let rests = [
            Mat4::IDENTITY,
            Mat4::from_translation(Vec3::new(0.0, 2.0, 0.0)),
            Mat4::from_translation(Vec3::new(0.0, -1.0, 0.0)),
            Mat4::from_translation(Vec3::new(0.0, -1.0, 0.0)),
        ];
        let names: Vec<String> = ["body", "arm", "forearm", "hand"]
            .map(String::from)
            .to_vec();
        let _ = constraints;
        (rests.to_vec(), names)
    }

    #[test]
    fn a_limit_clamps_the_turn_and_leaves_a_turn_inside_the_bounds() {
        let (rests, names) = limb(&[]);
        let cons = [
            vec![],
            vec![Constraint::Limit {
                min: [-30.0, 0.0, 0.0],
                max: [30.0, 0.0, 0.0],
            }],
            vec![],
            vec![],
        ];
        let parts: Vec<PartInfo> = (0..4)
            .map(|i| PartInfo {
                name: &names[i],
                parent: if i == 0 { None } else { Some(i - 1) },
                rest: rests[i],
                constraints: &cons[i],
            })
            .collect();
        let mut poses = vec![PartPose::default(); 4];
        poses[1].rotation = Some(from_euler_deg([90.0, 0.0, 0.0]));
        apply(&parts, &mut poses);
        assert!((euler_deg(poses[1].rotation.unwrap())[0] - 30.0).abs() < 1e-3);
        poses[1].rotation = Some(from_euler_deg([10.0, 0.0, 0.0]));
        apply(&parts, &mut poses);
        assert!((euler_deg(poses[1].rotation.unwrap())[0] - 10.0).abs() < 1e-3);
    }

    #[test]
    fn a_copy_follows_another_part_and_a_reach_puts_the_end_on_the_target() {
        let (rests, names) = limb(&[]);
        let cons = [
            vec![],
            vec![Constraint::Reach {
                target: [0.5, 0.8, 0.0],
                pole: [0.0, 0.0, 1.0],
            }],
            vec![],
            vec![],
        ];
        let parts: Vec<PartInfo> = (0..4)
            .map(|i| PartInfo {
                name: &names[i],
                parent: if i == 0 { None } else { Some(i - 1) },
                rest: rests[i],
                constraints: &cons[i],
            })
            .collect();
        let mut poses = vec![PartPose::default(); 4];
        apply(&parts, &mut poses);
        let w = worlds(&parts, &poses);
        assert!(
            close(w[3].w_axis.truncate(), Vec3::new(0.5, 0.8, 0.0)),
            "{:?}",
            w[3].w_axis
        );
        // the bone lengths are kept
        assert!(((w[2].w_axis - w[1].w_axis).truncate().length() - 1.0).abs() < 1e-3);
        // a copy: the forearm takes the arm's turn on x
        let cons2 = [
            vec![],
            vec![],
            vec![Constraint::Copy {
                from: "body/arm".into(),
                axes: [true, false, false],
                mix: 1.0,
            }],
            vec![],
        ];
        let parts2: Vec<PartInfo> = (0..4)
            .map(|i| PartInfo {
                name: &names[i],
                parent: if i == 0 { None } else { Some(i - 1) },
                rest: rests[i],
                constraints: &cons2[i],
            })
            .collect();
        let mut p2 = vec![PartPose::default(); 4];
        p2[1].rotation = Some(from_euler_deg([40.0, 0.0, 0.0]));
        apply(&parts2, &mut p2);
        assert!((euler_deg(p2[2].rotation.unwrap())[0] - 40.0).abs() < 1e-3);
    }
}
