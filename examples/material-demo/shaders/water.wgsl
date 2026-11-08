// Water: rings of ripples spreading from two points, a deeper colour away from the edge, the sun glinting on the crests and the
// sky in the surface where you look across it. Drawn see-through (blend = true on the entity).
// params: s.param.x ripple speed, s.param.y how many rings a metre, s.param.z how clear the water is (0 to 1).

fn ripple(p: vec2<f32>, centre: vec2<f32>, t: f32, rings: f32) -> vec2<f32> {
    let d = p - centre;
    let r = length(d);
    // how the height changes along the ground: rings, fading with distance
    let wave = cos(r * rings - t) * exp(-r * 0.18);
    return d / max(r, 0.001) * wave;
}

fn shade(s: Surface) -> vec4<f32> {
    let t = s.time * s.param.x * 3.0;
    let rings = s.param.y;
    let p = s.world.xz;
    let slope = ripple(p, vec2<f32>(-1.5, -6.5), t, rings) + ripple(p, vec2<f32>(2.0, -5.0), t * 1.3, rings * 0.8) * 0.7;
    // the ripples tip the surface's normal
    let n = normalize(vec3<f32>(-slope.x * 0.12, 1.0, -slope.y * 0.12));
    var surface = s;
    surface.normal = n;
    // deeper (darker, bluer) towards the middle of the pool
    let edge = min(min(s.uv.x, 1.0 - s.uv.x), min(s.uv.y, 1.0 - s.uv.y));
    let deep = smoothstep(0.0, 0.25, edge);
    let colour = mix(vec3<f32>(0.18, 0.5, 0.58), vec3<f32>(0.03, 0.17, 0.32), deep);
    var rgb = nova_light(surface, colour);
    // the sun's glint on the crests
    let to_eye = normalize(vec3<f32>(0.0, 3.2, 9.5) - s.world);
    let glint = pow(max(dot(reflect(normalize(vec3<f32>(-0.55, -0.8, -0.35)), n), to_eye), 0.0), 60.0);
    rgb = rgb + vec3<f32>(1.0, 0.95, 0.85) * glint * 1.5;
    // the sky in it, more at a glancing view
    let fresnel = pow(1.0 - max(dot(n, to_eye), 0.0), 4.0);
    rgb = mix(rgb, vec3<f32>(0.75, 0.85, 0.95), fresnel * 0.6);
    let alpha = mix(s.param.z, 0.95, fresnel);
    return vec4<f32>(nova_fog(s, rgb), alpha);
}
