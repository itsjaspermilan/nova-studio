-- Ember Swarm, a probe game (docs/probes.md): a 3D survivors-style shooter made to find the engine's limits.
-- It lives on the ground (x, z), so collisions and distances use that plane; the squares of the broad phase are 2 m.
nova.collision { plane = "xz", cell = 2 }
nova.start("arena")
