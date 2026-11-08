//! Rigid-body physics (`nova.physics`): a 2D world and a 3D world on Rapier, each made the first time a body is added to it,
//! stepped by the framework at its fixed 60 Hz step, so a headless run gives the same numbers every time.
//!
//! The two worlds share one source (`physics_core.rs`, included twice), with the few things that differ between two and three
//! dimensions (vectors, turns, shapes, joints) written once for each in the small modules below. Everything crosses this file
//! as `[f32; 3]` (a 2D vector leaves z at 0) and `[f32; 4]` turns (a quaternion x, y, z, w in 3D; the angle in radians in
//! slot 0 in 2D), so the Lua side does not see Rapier's types. The 2D world works in metres inside; `nova.physics` turns the
//! game's pixels into metres with [`Physics::scale`] (Rapier's tolerances are tuned for sizes near a metre).

/// What a body is: moved by the simulation, never moved, moved by the game (pushing what it meets), or a walking character
/// moved by [`d3::World::character_move`] that slides along everything and shoves loose things.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Dynamic,
    Static,
    Kinematic,
    Character,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "dynamic" => Kind::Dynamic,
            "static" => Kind::Static,
            "kinematic" => Kind::Kinematic,
            "character" => Kind::Character,
            _ => return None,
        })
    }
}

/// A body's shape, in its own space (metres). Boxes are given by half their size.
#[derive(Clone, Debug)]
pub enum Shape {
    Box {
        half: [f32; 3],
    },
    Ball {
        r: f32,
    },
    /// Upright: two half-spheres of radius `r` joined by a cylinder `2 * half` tall.
    Capsule {
        half: f32,
        r: f32,
    },
    /// The smallest convex shape round these points (a dynamic model).
    Hull(Vec<[f32; 3]>),
    /// Triangles: for things that do not move (a level's ground). In 2D only the outline counts, as a hull.
    Mesh(Vec<[f32; 3]>, Vec<[u32; 3]>),
    /// Many boxes as one body (a tilemap's solid tiles, the walls of a level): centre and half size of each.
    Boxes(Vec<([f32; 3], [f32; 3])>),
}

/// Everything about a new body.
#[derive(Clone, Debug)]
pub struct BodyDesc {
    pub kind: Kind,
    pub pos: [f32; 3],
    pub rot: [f32; 4],
    pub shape: Shape,
    /// Where the shape sits from the body's position (a model whose origin is at its feet has its box above it).
    pub offset: [f32; 3],
    /// Kilograms; when not given the shape weighs `density` (1000 kg per cubic metre, water, in 3D; per square metre in 2D).
    pub mass: Option<f32>,
    pub density: f32,
    /// 0 (a sandbag) to 1 (a superball).
    pub bounce: f32,
    pub friction: f32,
    /// Only reports what passes through it (`on_hit`), stops nothing.
    pub sensor: bool,
    pub damping: f32,
    pub spin_damping: f32,
    pub fixed_rotation: bool,
    /// Continuous collision: a fast small thing (a bullet, a ball) cannot pass through a thin wall between two steps.
    pub bullet: bool,
    pub gravity_scale: f32,
}

impl Default for BodyDesc {
    fn default() -> Self {
        BodyDesc {
            kind: Kind::Dynamic,
            pos: [0.0; 3],
            rot: [0.0, 0.0, 0.0, 1.0],
            shape: Shape::Box { half: [0.5; 3] },
            offset: [0.0; 3],
            mass: None,
            density: 1000.0,
            bounce: 0.1,
            friction: 0.6,
            sensor: false,
            damping: 0.0,
            spin_damping: 0.05,
            fixed_rotation: false,
            bullet: false,
            gravity_scale: 1.0,
        }
    }
}

/// Two bodies started (or stopped) touching during a step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub a: u32,
    pub b: u32,
    pub started: bool,
    /// One of them is a sensor (nothing was stopped).
    pub sensor: bool,
    /// Where they touch and the direction from a to b (zero when not known, as for sensors).
    pub point: [f32; 3],
    pub normal: [f32; 3],
    /// How fast they met, along the normal (metres a second): for choosing how loud a knock is.
    pub speed: f32,
}

#[derive(Clone, Copy, Debug)]
pub enum JointKind {
    /// Glued together as they are now.
    Fixed,
    /// Turning about an axis through the anchor (a door, a wheel, a seesaw). In 2D the axis is the screen's.
    Hinge,
    /// Turning any way about the anchor (a chain link, a pendulum in 3D; a hinge in 2D).
    Ball,
    /// No further apart than `max`, slack when closer.
    Rope { max: f32 },
    /// Pulled back towards `length` apart.
    Spring {
        length: f32,
        stiffness: f32,
        damping: f32,
    },
    /// Sliding along an axis (a piston, a lift).
    Slider,
}

#[derive(Clone, Debug)]
pub struct JointDesc {
    pub kind: JointKind,
    /// The world point the two are held at (for a rope or a spring: on a; `anchor_b` for the end on b).
    pub anchor: [f32; 3],
    pub anchor_b: Option<[f32; 3]>,
    pub axis: [f32; 3],
    /// For a hinge (radians) or a slider (metres).
    pub limits: Option<[f32; 2]>,
    /// Turn (or slide) at this speed, with this strength.
    pub motor: Option<(f32, f32)>,
    /// Let the two joined bodies still collide with each other.
    pub collide: bool,
}

/// How a character walks.
#[derive(Clone, Copy, Debug)]
pub struct CharacterOpts {
    pub max_slope_degrees: f32,
    pub step: f32,
    pub snap: f32,
    /// Its weight when it shoves loose bodies (kg).
    pub mass: f32,
}

impl Default for CharacterOpts {
    fn default() -> Self {
        CharacterOpts {
            max_slope_degrees: 45.0,
            step: 0.3,
            snap: 0.2,
            mass: 70.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CharacterMove {
    pub pos: [f32; 3],
    pub grounded: bool,
}

/// A ray hit: the body, how far along, where, and the surface's direction there.
#[derive(Clone, Copy, Debug)]
pub struct RayHit {
    pub body: u32,
    pub distance: f32,
    pub point: [f32; 3],
    pub normal: [f32; 3],
}

pub mod d2 {
    //! The 2D world (x right, y down as on the screen; turns in radians, positive clockwise on the screen).
    use rapier2d::control::{CharacterAutostep, CharacterLength, KinematicCharacterController};
    use rapier2d::prelude::*;

    const DIM3: bool = false;
    const UP: Vector = Vector::NEG_Y;
    pub const DEFAULT_GRAVITY: [f32; 3] = [0.0, 9.81, 0.0];

    fn vec(a: [f32; 3]) -> Vector {
        Vector::new(a[0], a[1])
    }
    fn out(v: Vector) -> [f32; 3] {
        [v.x, v.y, 0.0]
    }
    fn rot_in(r: [f32; 4]) -> Rotation {
        Rotation::new(r[0])
    }
    fn rot_out(r: &Rotation) -> [f32; 4] {
        [r.angle(), 0.0, 0.0, 0.0]
    }
    fn ang_in(a: [f32; 3]) -> AngVector {
        a[2]
    }
    fn ang_out(a: AngVector) -> [f32; 3] {
        [0.0, 0.0, a]
    }
    fn cuboid(h: [f32; 3]) -> ColliderBuilder {
        ColliderBuilder::cuboid(h[0], h[1])
    }
    fn box_shape(h: [f32; 3]) -> SharedShape {
        SharedShape::cuboid(h[0], h[1])
    }
    fn mesh(points: &[[f32; 3]], _tris: &[[u32; 3]]) -> Option<ColliderBuilder> {
        hull(points)
    }
    fn hull(points: &[[f32; 3]]) -> Option<ColliderBuilder> {
        let p: Vec<Vector> = points.iter().map(|&p| vec(p)).collect();
        ColliderBuilder::convex_hull(&p)
    }
    fn hinge_with(
        axis: Vector,
        a1: Vector,
        a2: Vector,
        limits: Option<[f32; 2]>,
        motor: Option<(f32, f32)>,
    ) -> GenericJoint {
        let _ = axis;
        let mut b = RevoluteJointBuilder::new()
            .local_anchor1(a1)
            .local_anchor2(a2);
        if let Some(l) = limits {
            b = b.limits(l);
        }
        if let Some((v, f)) = motor {
            b = b.motor_velocity(v, f);
        }
        b.into()
    }
    fn ball_with(
        axis: Vector,
        a1: Vector,
        a2: Vector,
        limits: Option<[f32; 2]>,
        motor: Option<(f32, f32)>,
    ) -> GenericJoint {
        hinge_with(axis, a1, a2, limits, motor)
    }

    include!("physics_core.rs");
}

pub mod d3 {
    //! The 3D world (y up; turns as quaternions).
    use rapier3d::control::{CharacterAutostep, CharacterLength, KinematicCharacterController};
    use rapier3d::prelude::*;

    const DIM3: bool = true;
    const UP: Vector = Vector::Y;
    pub const DEFAULT_GRAVITY: [f32; 3] = [0.0, -9.81, 0.0];

    fn vec(a: [f32; 3]) -> Vector {
        Vector::new(a[0], a[1], a[2])
    }
    fn out(v: Vector) -> [f32; 3] {
        [v.x, v.y, v.z]
    }
    fn rot_in(r: [f32; 4]) -> Rotation {
        let q = Rotation::from_xyzw(r[0], r[1], r[2], r[3]);
        if q.length_squared() > 1e-12 {
            q.normalize()
        } else {
            Rotation::IDENTITY
        }
    }
    fn rot_out(r: &Rotation) -> [f32; 4] {
        [r.x, r.y, r.z, r.w]
    }
    fn ang_in(a: [f32; 3]) -> AngVector {
        vec(a)
    }
    fn ang_out(a: AngVector) -> [f32; 3] {
        out(a)
    }
    fn cuboid(h: [f32; 3]) -> ColliderBuilder {
        ColliderBuilder::cuboid(h[0], h[1], h[2])
    }
    fn box_shape(h: [f32; 3]) -> SharedShape {
        SharedShape::cuboid(h[0], h[1], h[2])
    }
    fn mesh(points: &[[f32; 3]], tris: &[[u32; 3]]) -> Option<ColliderBuilder> {
        let p: Vec<Vector> = points.iter().map(|&p| vec(p)).collect();
        ColliderBuilder::trimesh(p, tris.to_vec()).ok()
    }
    fn hull(points: &[[f32; 3]]) -> Option<ColliderBuilder> {
        let p: Vec<Vector> = points.iter().map(|&p| vec(p)).collect();
        ColliderBuilder::convex_hull(&p)
    }
    fn hinge_with(
        axis: Vector,
        a1: Vector,
        a2: Vector,
        limits: Option<[f32; 2]>,
        motor: Option<(f32, f32)>,
    ) -> GenericJoint {
        let mut b = RevoluteJointBuilder::new(axis)
            .local_anchor1(a1)
            .local_anchor2(a2);
        if let Some(l) = limits {
            b = b.limits(l);
        }
        if let Some((v, f)) = motor {
            b = b.motor_velocity(v, f);
        }
        b.into()
    }
    fn ball_with(
        _axis: Vector,
        a1: Vector,
        a2: Vector,
        _limits: Option<[f32; 2]>,
        _motor: Option<(f32, f32)>,
    ) -> GenericJoint {
        SphericalJointBuilder::new()
            .local_anchor1(a1)
            .local_anchor2(a2)
            .into()
    }

    include!("physics_core.rs");
}

/// Both worlds and the game's choice of 2D scale. Body ids are `index * 2 + 1` in the 2D world and `index * 2 + 2` in the 3D
/// one, so an id says which world it is in and 0 is never a body.
pub struct Physics {
    pub d2: Option<d2::World>,
    pub d3: Option<d3::World>,
    /// Pixels in a metre, for the 2D world (50: a 32-pixel crate is 64 cm across).
    pub scale: f32,
    pub gravity2: [f32; 3],
    pub gravity3: [f32; 3],
}

impl Default for Physics {
    fn default() -> Self {
        Physics {
            d2: None,
            d3: None,
            scale: 50.0,
            gravity2: d2::DEFAULT_GRAVITY,
            gravity3: d3::DEFAULT_GRAVITY,
        }
    }
}

/// Which world an id belongs to, and its index there.
pub fn split_id(id: u32) -> Option<(bool, u32)> {
    if id == 0 {
        return None;
    }
    Some(((id - 1) % 2 == 1, (id - 1) / 2))
}

pub fn id2(index: u32) -> u32 {
    index * 2 + 1
}

pub fn id3(index: u32) -> u32 {
    index * 2 + 2
}

impl Physics {
    /// Everything goes (a new scene).
    pub fn clear(&mut self) {
        self.d2 = None;
        self.d3 = None;
    }

    pub fn world2(&mut self) -> &mut d2::World {
        let g = self.gravity2;
        self.d2.get_or_insert_with(|| d2::World::new(g))
    }

    pub fn world3(&mut self) -> &mut d3::World {
        let g = self.gravity3;
        self.d3.get_or_insert_with(|| d3::World::new(g))
    }

    /// One fixed step of both worlds (only those that exist cost anything).
    pub fn step(&mut self, dt: f32) {
        if let Some(w) = &mut self.d2 {
            w.step(dt);
        }
        if let Some(w) = &mut self.d3 {
            w.step(dt);
        }
    }

    pub fn body_count(&self) -> usize {
        self.d2.as_ref().map_or(0, |w| w.len()) + self.d3.as_ref().map_or(0, |w| w.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crate_at(y: f32) -> BodyDesc {
        BodyDesc {
            pos: [0.0, y, 0.0],
            shape: Shape::Box { half: [0.5; 3] },
            ..Default::default()
        }
    }

    fn ground3(w: &mut d3::World) -> u32 {
        w.add(&BodyDesc {
            kind: Kind::Static,
            pos: [0.0, -0.5, 0.0],
            shape: Shape::Box {
                half: [20.0, 0.5, 20.0],
            },
            ..Default::default()
        })
        .unwrap()
    }

    #[test]
    fn a_crate_falls_and_rests_on_the_ground() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        ground3(&mut w);
        let c = w.add(&crate_at(3.0)).unwrap();
        for _ in 0..180 {
            w.step(1.0 / 60.0);
        }
        let (p, _) = w.pose(c).unwrap();
        assert!(
            (p[1] - 0.5).abs() < 0.05,
            "rests on top of the ground, at {p:?}"
        );
        assert!(w.sleeping(c), "and goes to sleep");
    }

    #[test]
    fn a_stack_of_crates_stands_and_a_shove_knocks_it_down() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        ground3(&mut w);
        let ids: Vec<u32> = (0..5)
            .map(|i| w.add(&crate_at(0.5 + i as f32 * 1.01)).unwrap())
            .collect();
        for _ in 0..240 {
            w.step(1.0 / 60.0);
        }
        let top = w.pose(ids[4]).unwrap().0;
        assert!(
            top[0].abs() < 0.05 && (top[1] - 4.5).abs() < 0.1,
            "the stack stands: top at {top:?}"
        );
        // a heavy ball thrown at the bottom crate
        let mut ball = BodyDesc {
            pos: [-4.0, 0.6, 0.0],
            shape: Shape::Ball { r: 0.4 },
            mass: Some(3000.0),
            ..Default::default()
        };
        ball.bullet = true;
        let b = w.add(&ball).unwrap();
        w.set_velocity(b, [14.0, 0.0, 0.0]);
        for _ in 0..240 {
            w.step(1.0 / 60.0);
        }
        let top = w.pose(ids[4]).unwrap().0;
        assert!(top[1] < 2.0, "the stack fell: top at {top:?}");
    }

    #[test]
    fn the_same_inputs_give_the_same_numbers() {
        let run = || {
            let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
            ground3(&mut w);
            let mut ids = Vec::new();
            for i in 0..20 {
                let mut d = crate_at(1.0 + i as f32 * 0.7);
                d.pos[0] = (i % 3) as f32 * 0.3;
                d.rot = [0.0, (i as f32 * 0.37).sin() * 0.3, 0.0, 1.0];
                ids.push(w.add(&d).unwrap());
            }
            for _ in 0..300 {
                w.step(1.0 / 60.0);
            }
            ids.iter().map(|&i| w.pose(i).unwrap()).collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn contacts_report_both_bodies_and_how_hard() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        let g = ground3(&mut w);
        let c = w.add(&crate_at(5.0)).unwrap();
        let mut hits = Vec::new();
        for _ in 0..120 {
            w.step(1.0 / 60.0);
            hits.extend(w.take_contacts());
        }
        let first = hits.iter().find(|h| h.started).expect("a contact");
        assert!((first.a == c && first.b == g) || (first.a == g && first.b == c));
        assert!(
            first.speed > 5.0 && first.speed < 12.0,
            "fell about 4.5 m: {}",
            first.speed
        );
        assert!(
            first.normal[1].abs() > 0.9,
            "upright normal {:?}",
            first.normal
        );
    }

    #[test]
    fn a_sensor_reports_what_enters_and_stops_nothing() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        ground3(&mut w);
        let s = w
            .add(&BodyDesc {
                kind: Kind::Static,
                pos: [0.0, 2.0, 0.0],
                sensor: true,
                shape: Shape::Box {
                    half: [1.0, 0.25, 1.0],
                },
                ..Default::default()
            })
            .unwrap();
        let c = w.add(&crate_at(4.0)).unwrap();
        let mut entered = false;
        let mut left = false;
        for _ in 0..120 {
            w.step(1.0 / 60.0);
            for h in w
                .take_contacts()
                .into_iter()
                .filter(|h| h.a == s || h.b == s)
            {
                assert!(h.sensor);
                assert!((h.a == s && h.b == c) || (h.a == c && h.b == s));
                if h.started {
                    entered = true
                } else {
                    left = true
                }
            }
        }
        assert!(entered && left);
        assert!((w.pose(c).unwrap().0[1] - 0.5).abs() < 0.05);
    }

    #[test]
    fn rays_find_the_nearest_body() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        let g = ground3(&mut w);
        let c = w.add(&crate_at(0.5)).unwrap();
        w.step(1.0 / 60.0);
        let hit = w
            .ray([0.0, 5.0, 0.0], [0.0, -1.0, 0.0], 10.0, None, false)
            .unwrap();
        assert_eq!(hit.body, c);
        assert!((hit.distance - 4.0).abs() < 0.02);
        let hit = w
            .ray([0.0, 5.0, 0.0], [0.0, -1.0, 0.0], 10.0, Some(c), false)
            .unwrap();
        assert_eq!(hit.body, g);
        assert!(
            w.ray([0.0, 5.0, 0.0], [0.0, 1.0, 0.0], 10.0, None, false)
                .is_none()
        );
    }

    #[test]
    fn a_hinge_keeps_a_door_on_its_post() {
        let mut w = d3::World::new([0.0, 0.0, 0.0]);
        let post = w
            .add(&BodyDesc {
                kind: Kind::Static,
                pos: [0.0, 1.0, 0.0],
                shape: Shape::Box {
                    half: [0.05, 1.0, 0.05],
                },
                ..Default::default()
            })
            .unwrap();
        let door = w
            .add(&BodyDesc {
                pos: [0.55, 1.0, 0.0],
                shape: Shape::Box {
                    half: [0.5, 1.0, 0.05],
                },
                ..Default::default()
            })
            .unwrap();
        w.joint(
            door,
            Some(post),
            &JointDesc {
                kind: JointKind::Hinge,
                anchor: [0.0, 1.0, 0.0],
                anchor_b: None,
                axis: [0.0, 1.0, 0.0],
                limits: None,
                motor: None,
                collide: false,
            },
        )
        .unwrap();
        w.impulse(door, [0.0, 0.0, 30.0]);
        for _ in 0..30 {
            w.step(1.0 / 60.0);
        }
        let (p, _) = w.pose(door).unwrap();
        let r = (p[0] * p[0] + p[2] * p[2]).sqrt();
        assert!((r - 0.55).abs() < 0.03, "swings about the post: {p:?}");
        assert!(p[2].abs() > 0.05, "and has swung");
        assert!((p[1] - 1.0).abs() < 0.02);
    }

    #[test]
    fn a_character_walks_into_a_crate_and_shoves_it() {
        let mut w = d3::World::new(d3::DEFAULT_GRAVITY);
        ground3(&mut w);
        let ch = w
            .add(&BodyDesc {
                kind: Kind::Character,
                pos: [-3.0, 0.9, 0.0],
                shape: Shape::Capsule { half: 0.5, r: 0.4 },
                ..Default::default()
            })
            .unwrap();
        let c = w
            .add(&BodyDesc {
                mass: Some(10.0),
                ..crate_at(0.5)
            })
            .unwrap();
        let mut grounded = false;
        for _ in 0..180 {
            let m = w
                .character_move(
                    ch,
                    [3.0 / 60.0, -0.1, 0.0],
                    1.0 / 60.0,
                    &CharacterOpts::default(),
                )
                .unwrap();
            grounded = m.grounded;
            w.step(1.0 / 60.0);
        }
        assert!(grounded);
        let crate_x = w.pose(c).unwrap().0[0];
        assert!(crate_x > 0.5, "the crate was pushed along: {crate_x}");
        let me = w.pose(ch).unwrap().0;
        assert!(me[0] < crate_x, "and the character is behind it: {me:?}");
    }

    #[test]
    fn two_d_balls_bounce_and_boxes_from_tiles_hold_them() {
        let mut w = d2::World::new(d2::DEFAULT_GRAVITY);
        // a floor of three one-metre tiles at y = 5 (y grows downwards)
        w.add(&BodyDesc {
            kind: Kind::Static,
            shape: Shape::Boxes(
                (0..3)
                    .map(|i| ([i as f32 + 0.5, 5.5, 0.0], [0.5, 0.5, 0.0]))
                    .collect(),
            ),
            ..Default::default()
        })
        .unwrap();
        let ball = w
            .add(&BodyDesc {
                pos: [1.5, 0.0, 0.0],
                shape: Shape::Ball { r: 0.25 },
                bounce: 0.8,
                ..Default::default()
            })
            .unwrap();
        let mut lowest: f32 = 0.0;
        let mut rose_after = false;
        let mut last = 0.0;
        for _ in 0..240 {
            w.step(1.0 / 60.0);
            let y = w.pose(ball).unwrap().0[1];
            if y > lowest {
                lowest = y;
            } else if y < last && lowest > 4.0 {
                rose_after = true;
            }
            last = y;
        }
        assert!(
            lowest <= 4.77 && lowest > 4.6,
            "lands on the floor's top: {lowest}"
        );
        assert!(rose_after, "and bounces back up");
    }

    #[test]
    fn ids_say_their_world() {
        assert_eq!(split_id(id2(0)), Some((false, 0)));
        assert_eq!(split_id(id3(0)), Some((true, 0)));
        assert_eq!(split_id(id3(7)), Some((true, 7)));
        assert_eq!(split_id(0), None);
    }
}
