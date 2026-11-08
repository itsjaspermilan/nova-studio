// One physics world, written once for 2D and 3D: included by `physics::d2` and `physics::d3`, which bring Rapier's prelude
// for their dimension and the helpers `vec`, `out`, `rot_in`, `rot_out`, `ang_in`, `ang_out`, `cuboid`, `box_shape`, `mesh`,
// `hull`, `hinge_with`, `ball_with`, `UP` and `DIM3`. Bodies are known by their index in `slots` (the world's own ids).

use crate::physics::{
    BodyDesc, CharacterMove, CharacterOpts, Contact, JointDesc, JointKind, Kind, RayHit, Shape,
};
use std::sync::mpsc;

struct Slot {
    body: RigidBodyHandle,
    kind: Kind,
    /// Its velocity before the step, for how hard it hit something during it.
    before: Vector,
}

pub struct World {
    pw: PhysicsWorld,
    slots: Vec<Option<Slot>>,
    live: usize,
    joints: Vec<Option<ImpulseJointHandle>>,
    /// A body that never moves, for joints to "the world".
    anchor: Option<RigidBodyHandle>,
    events_tx: mpsc::Sender<CollisionEvent>,
    events_rx: mpsc::Receiver<CollisionEvent>,
    contacts: Vec<Contact>,
}

impl World {
    pub fn new(gravity: [f32; 3]) -> World {
        let (events_tx, events_rx) = mpsc::channel();
        let mut pw = PhysicsWorld {
            gravity: vec(gravity),
            ..Default::default()
        };
        pw.integration_parameters.dt = 1.0 / 60.0;
        World {
            pw,
            slots: Vec::new(),
            live: 0,
            joints: Vec::new(),
            anchor: None,
            events_tx,
            events_rx,
            contacts: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.live
    }

    pub fn is_empty(&self) -> bool {
        self.live == 0
    }

    pub fn set_gravity(&mut self, g: [f32; 3]) {
        self.pw.gravity = vec(g);
        self.pw.wake_up_all(true);
    }

    fn slot(&self, id: u32) -> Option<&Slot> {
        self.slots.get(id as usize).and_then(|s| s.as_ref())
    }

    fn body(&self, id: u32) -> Option<&RigidBody> {
        let h = self.slot(id)?.body;
        self.pw.bodies.get(h)
    }

    fn body_mut(&mut self, id: u32) -> Option<&mut RigidBody> {
        let h = self.slot(id)?.body;
        self.pw.bodies.get_mut(h)
    }

    pub fn kind(&self, id: u32) -> Option<Kind> {
        self.slot(id).map(|s| s.kind)
    }

    /// A new body; None when its shape cannot be made (a hull of fewer than enough points, an empty mesh).
    pub fn add(&mut self, d: &BodyDesc) -> Option<u32> {
        let id = self.slots.len() as u32;
        let pose = Pose::from_parts(vec(d.pos), rot_in(d.rot));
        let builder = match d.kind {
            Kind::Dynamic => RigidBodyBuilder::dynamic(),
            Kind::Static => RigidBodyBuilder::fixed(),
            Kind::Kinematic | Kind::Character => RigidBodyBuilder::kinematic_position_based(),
        };
        let mut builder = builder
            .pose(pose)
            .linear_damping(d.damping.max(0.0))
            .angular_damping(d.spin_damping.max(0.0))
            .gravity_scale(d.gravity_scale)
            .ccd_enabled(d.bullet)
            .user_data(id as u128);
        if d.fixed_rotation || d.kind == Kind::Character {
            builder = builder.lock_rotations();
        }
        let offset = vec(d.offset);
        let collider = match &d.shape {
            Shape::Box { half } => Some(cuboid(half.map(|h| h.max(1e-3)))),
            Shape::Ball { r } => Some(ColliderBuilder::ball(r.max(1e-3))),
            Shape::Capsule { half, r } => Some(ColliderBuilder::capsule_y(half.max(0.0), r.max(1e-3))),
            Shape::Hull(points) => hull(points),
            Shape::Mesh(points, tris) => {
                if d.kind == Kind::Static {
                    mesh(points, tris)
                } else {
                    hull(points)
                }
            }
            Shape::Boxes(list) => {
                if list.is_empty() {
                    None
                } else {
                    let parts = list
                        .iter()
                        .map(|(c, h)| (Pose::from_translation(vec(*c)), box_shape(h.map(|v| v.max(1e-3)))))
                        .collect();
                    Some(ColliderBuilder::compound(parts))
                }
            }
        }?;
        let mut collider = collider
            .translation(offset)
            .restitution(d.bounce.clamp(0.0, 1.0))
            .friction(d.friction.max(0.0))
            .sensor(d.sensor)
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .user_data(id as u128);
        collider = match d.mass {
            Some(m) => collider.mass(m.max(1e-3)),
            None => collider.density(d.density.max(1e-3)),
        };
        if d.sensor || d.kind == Kind::Character || d.kind == Kind::Kinematic {
            // a sensor notices characters and moving platforms too, and a character notices what it walks into
            collider = collider.active_collision_types(ActiveCollisionTypes::all());
        }
        let handle = self.pw.bodies.insert(builder);
        self.pw.insert_collider(collider, Some(handle));
        self.slots.push(Some(Slot {
            body: handle,
            kind: d.kind,
            before: Vector::ZERO,
        }));
        self.live += 1;
        Some(id)
    }

    pub fn remove(&mut self, id: u32) -> bool {
        let Some(slot) = self.slots.get_mut(id as usize).and_then(|s| s.take()) else {
            return false;
        };
        self.pw.remove_body_with_colliders(slot.body, true);
        self.live -= 1;
        true
    }

    /// One step of `dt` seconds; contacts that started or stopped during it are kept for [`World::take_contacts`].
    pub fn step(&mut self, dt: f32) {
        self.pw.integration_parameters.dt = dt.clamp(1e-4, 0.1);
        for slot in self.slots.iter_mut().flatten() {
            if slot.kind == Kind::Dynamic
                && let Some(b) = self.pw.bodies.get(slot.body) {
                    slot.before = b.linvel();
                }
        }
        let (force_tx, _) = mpsc::channel();
        let (tear_tx, _) = mpsc::channel();
        let collector = ChannelEventCollector::new(self.events_tx.clone(), force_tx, tear_tx);
        self.pw.step_with_events(&(), &collector);
        // forces last one step
        for slot in self.slots.iter().flatten() {
            if slot.kind == Kind::Dynamic
                && let Some(b) = self.pw.bodies.get_mut(slot.body) {
                    b.reset_forces(false);
                    b.reset_torques(false);
                }
        }
        while let Ok(ev) = self.events_rx.try_recv() {
            let (h1, h2, started, flags) = match ev {
                CollisionEvent::Started(a, b, f) => (a, b, true, f),
                CollisionEvent::Stopped(a, b, f) => (a, b, false, f),
            };
            if flags.contains(CollisionEventFlags::REMOVED) {
                continue;
            }
            let (Some(c1), Some(c2)) = (self.pw.colliders.get(h1), self.pw.colliders.get(h2)) else {
                continue;
            };
            let (a, b) = (c1.user_data as u32, c2.user_data as u32);
            if c1.parent().is_none() || c2.parent().is_none() {
                continue;
            }
            let sensor = flags.contains(CollisionEventFlags::SENSOR);
            let before = |id: u32| self.slot(id).map_or(Vector::ZERO, |s| s.before);
            let rel = before(a) - before(b);
            let mut contact = Contact {
                a,
                b,
                started,
                sensor,
                point: [0.0; 3],
                normal: [0.0; 3],
                speed: rel.length(),
            };
            if started && !sensor
                && let Some(pair) = self.pw.narrow_phase.contact_pair(h1, h2)
                    && let Some((m, c)) = pair.find_deepest_contact() {
                        let n = m.data.normal;
                        contact.normal = out(n);
                        contact.point = out(c1.position().transform_point(c.local_p1));
                        contact.speed = rel.dot(n).abs();
                    }
            self.contacts.push(contact);
        }
    }

    pub fn take_contacts(&mut self) -> Vec<Contact> {
        std::mem::take(&mut self.contacts)
    }

    /// Position and turn.
    pub fn pose(&self, id: u32) -> Option<([f32; 3], [f32; 4])> {
        let b = self.body(id)?;
        Some((out(b.translation()), rot_out(b.rotation())))
    }

    /// The bodies the simulation moved in the last step (dynamic and awake), each as id, x, y, z, the four numbers of its
    /// turn and its velocity x, y, z (eleven numbers), appended to `into`: what the framework copies back to entities.
    pub fn moved(&self, into: &mut Vec<f32>) {
        for (i, slot) in self.slots.iter().enumerate() {
            let Some(slot) = slot else { continue };
            if slot.kind != Kind::Dynamic {
                continue;
            }
            let Some(b) = self.pw.bodies.get(slot.body) else { continue };
            if b.is_sleeping() {
                continue;
            }
            let p = out(b.translation());
            let r = rot_out(b.rotation());
            let v = out(b.linvel());
            into.extend_from_slice(&[i as f32, p[0], p[1], p[2], r[0], r[1], r[2], r[3], v[0], v[1], v[2]]);
        }
    }

    pub fn sleeping(&self, id: u32) -> bool {
        self.body(id).is_some_and(|b| b.is_sleeping())
    }

    /// Put a body somewhere at once (a respawn); a kinematic body or character glides there in the next step instead.
    pub fn place(&mut self, id: u32, pos: [f32; 3], rot: Option<[f32; 4]>) {
        let Some(kind) = self.kind(id) else { return };
        let Some(b) = self.body_mut(id) else { return };
        let rot = rot.map(rot_in).unwrap_or(*b.rotation());
        let pose = Pose::from_parts(vec(pos), rot);
        match kind {
            Kind::Kinematic | Kind::Character => b.set_next_kinematic_position(pose),
            _ => b.set_position(pose, true),
        }
    }

    /// Put a kinematic body (or a character) there at once, with no sweep (a teleport).
    pub fn teleport(&mut self, id: u32, pos: [f32; 3]) {
        let Some(b) = self.body_mut(id) else { return };
        let pose = Pose::from_parts(vec(pos), *b.rotation());
        b.set_position(pose, true);
        b.set_next_kinematic_position(pose);
    }

    /// Linear and angular velocity.
    pub fn velocity(&self, id: u32) -> Option<([f32; 3], [f32; 3])> {
        let b = self.body(id)?;
        Some((out(b.linvel()), ang_out(b.angvel())))
    }

    pub fn set_velocity(&mut self, id: u32, v: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.set_linvel(vec(v), true);
        }
    }

    pub fn set_spin(&mut self, id: u32, w: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.set_angvel(ang_in(w), true);
        }
    }

    /// A sudden push (kg m/s): a kick, a jump, a hit.
    pub fn impulse(&mut self, id: u32, j: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.apply_impulse(vec(j), true);
        }
    }

    /// A push at a point of the body (it starts to turn too).
    pub fn impulse_at(&mut self, id: u32, j: [f32; 3], at: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.apply_impulse_at_point(vec(j), vec(at), true);
        }
    }

    /// A steady push (newtons) for the next step only: call it every step for wind, thrust, a magnet.
    pub fn force(&mut self, id: u32, f: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.add_force(vec(f), true);
        }
    }

    pub fn torque_impulse(&mut self, id: u32, t: [f32; 3]) {
        if let Some(b) = self.body_mut(id) {
            b.apply_torque_impulse(ang_in(t), true);
        }
    }

    pub fn wake(&mut self, id: u32) {
        if let Some(b) = self.body_mut(id) {
            b.wake_up(true);
        }
    }

    pub fn mass(&self, id: u32) -> f32 {
        self.body(id).map_or(0.0, |b| b.mass())
    }

    /// The first body a ray meets (`dir` need not be of unit length), not counting `ignore` and, unless asked, sensors.
    pub fn ray(&self, origin: [f32; 3], dir: [f32; 3], max: f32, ignore: Option<u32>, sensors: bool) -> Option<RayHit> {
        let d = vec(dir);
        let len = d.length();
        if len.is_nan() || len <= 1e-9 || max.is_nan() || max <= 0.0 {
            return None;
        }
        let ray = Ray::new(vec(origin), d / len);
        let mut filter = QueryFilter::default();
        if !sensors {
            filter = filter.exclude_sensors();
        }
        if let Some(h) = ignore.and_then(|i| self.slot(i)).map(|s| s.body) {
            filter = filter.exclude_rigid_body(h);
        }
        let (ch, hit) = self.pw.cast_ray_and_get_normal(&ray, max, true, filter)?;
        let body = self.pw.colliders.get(ch)?.user_data as u32;
        Some(RayHit {
            body,
            distance: hit.time_of_impact,
            point: out(ray.point_at(hit.time_of_impact)),
            normal: out(hit.normal),
        })
    }

    /// Join two bodies (b = None: to the world) at a world point.
    pub fn joint(&mut self, a: u32, b: Option<u32>, j: &JointDesc) -> Option<u32> {
        let ha = self.slot(a)?.body;
        let hb = match b {
            Some(b) => self.slot(b)?.body,
            None => match self.anchor {
                Some(h) => h,
                None => {
                    let h = self.pw.bodies.insert(RigidBodyBuilder::fixed().user_data(u32::MAX as u128));
                    self.anchor = Some(h);
                    h
                }
            },
        };
        let pa = *self.pw.bodies.get(ha)?.position();
        let pb = *self.pw.bodies.get(hb)?.position();
        let anchor = vec(j.anchor);
        let la = pa.inverse_transform_point(anchor);
        let lb = pb.inverse_transform_point(vec(j.anchor_b.unwrap_or(j.anchor)));
        let axis = {
            let v = vec(j.axis);
            if v.length_squared() > 1e-12 { v.normalize() } else { UP }
        };
        let axis_a = pa.inverse_transform_vector(axis);
        let joint: GenericJoint = match j.kind {
            JointKind::Fixed => {
                let frame1 = pa.inv_mul(&Pose::from_translation(anchor));
                let frame2 = pb.inv_mul(&Pose::from_translation(anchor));
                FixedJointBuilder::new().local_frame1(frame1).local_frame2(frame2).contacts_enabled(j.collide).into()
            }
            JointKind::Hinge => {
                let mut g = hinge_with(axis_a, la, pb.inverse_transform_point(anchor), j.limits, j.motor);
                g.set_contacts_enabled(j.collide);
                g
            }
            JointKind::Ball => {
                let mut g = ball_with(axis_a, la, pb.inverse_transform_point(anchor), j.limits, j.motor);
                g.set_contacts_enabled(j.collide);
                g
            }
            JointKind::Rope { max } => {
                RopeJointBuilder::new(max.max(0.0)).local_anchor1(la).local_anchor2(lb).contacts_enabled(j.collide).into()
            }
            JointKind::Spring { length, stiffness, damping } => SpringJointBuilder::new(length.max(0.0), stiffness, damping)
                .local_anchor1(la)
                .local_anchor2(lb)
                .contacts_enabled(j.collide)
                .into(),
            JointKind::Slider => {
                let mut b = PrismaticJointBuilder::new(axis_a)
                    .local_anchor1(la)
                    .local_anchor2(pb.inverse_transform_point(anchor))
                    .contacts_enabled(j.collide);
                if let Some(l) = j.limits {
                    b = b.limits(l);
                }
                if let Some((v, f)) = j.motor {
                    b = b.motor_velocity(v, f);
                }
                b.into()
            }
        };
        let h = self.pw.insert_impulse_joint(ha, hb, joint);
        self.joints.push(Some(h));
        Some(self.joints.len() as u32 - 1)
    }

    pub fn remove_joint(&mut self, id: u32) {
        if let Some(h) = self.joints.get_mut(id as usize).and_then(|j| j.take()) {
            self.pw.remove_impulse_joint(h);
        }
    }

    /// Walk a character by `delta` (metres), sliding along walls, climbing steps and slopes up to the limits, staying on
    /// the ground when it goes down a little, and shoving the loose bodies it walks into. Its body arrives there in the next
    /// step; the place it will be is returned at once.
    pub fn character_move(&mut self, id: u32, delta: [f32; 3], dt: f32, o: &CharacterOpts) -> Option<CharacterMove> {
        let slot = self.slot(id)?;
        if slot.kind != Kind::Character {
            return None;
        }
        let handle = slot.body;
        let body = self.pw.bodies.get(handle)?;
        let start = *body.next_position();
        let ch = *body.colliders().first()?;
        let collider = self.pw.colliders.get(ch)?;
        let shape = collider.shared_shape().clone();
        // the shape's own offset from the body
        let shape_pos = start * *collider.position_wrt_parent().unwrap_or(&Pose::IDENTITY);
        let controller = KinematicCharacterController {
            up: UP,
            offset: CharacterLength::Absolute(0.01),
            slide: true,
            autostep: if o.step > 0.0 {
                Some(CharacterAutostep {
                    max_height: CharacterLength::Absolute(o.step),
                    min_width: CharacterLength::Absolute(0.05),
                    include_dynamic_bodies: false,
                })
            } else {
                None
            },
            max_slope_climb_angle: o.max_slope_degrees.clamp(0.0, 89.0).to_radians(),
            min_slope_slide_angle: o.max_slope_degrees.clamp(0.0, 89.0).to_radians(),
            snap_to_ground: if o.snap > 0.0 { Some(CharacterLength::Absolute(o.snap)) } else { None },
            ..Default::default()
        };
        let filter = QueryFilter::default().exclude_rigid_body(handle).exclude_sensors();
        let mut collisions = Vec::new();
        let moved = {
            let qp = self.pw.query_pipeline_with_filter(filter);
            controller.move_shape(dt.max(1e-4), &qp, &*shape, &shape_pos, vec(delta), |c| collisions.push(c))
        };
        if !collisions.is_empty() {
            let mut qpm = self.pw.broad_phase.as_query_pipeline_mut(
                self.pw.narrow_phase.query_dispatcher(),
                &mut self.pw.bodies,
                &mut self.pw.colliders,
                filter,
            );
            controller.solve_character_collision_impulses(dt.max(1e-4), &mut qpm, &*shape, o.mass.max(0.1), &collisions);
        }
        let target = Pose::from_parts(start.translation + moved.translation, start.rotation);
        self.pw.bodies.get_mut(handle)?.set_next_kinematic_position(target);
        Some(CharacterMove {
            pos: out(target.translation),
            grounded: moved.grounded,
        })
    }

    /// The same move for a kinematic body that the game moves (a platform, a door): where it should be next step.
    pub fn kinematic_target(&mut self, id: u32, pos: [f32; 3], rot: Option<[f32; 4]>) {
        let Some(b) = self.body_mut(id) else { return };
        if !b.is_kinematic() {
            return;
        }
        let r = rot.map(rot_in).unwrap_or(b.next_position().rotation);
        b.set_next_kinematic_position(Pose::from_parts(vec(pos), r));
    }

    #[allow(dead_code)]
    fn is_3d() -> bool {
        DIM3
    }
}
