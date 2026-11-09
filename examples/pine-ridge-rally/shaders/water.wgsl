// Open water in free roam (lakes and the sea): wind ripples over the surface, a darker blue in the deep and a paler one where it is
// shallow over the land, the sun glinting on the crests and the sky in the surface at a glancing view. Drawn see-through.
// params: x, y, z the camera's place (for the glint and the sky's reflection), w how clear the water is (0 to 1).
// param2: x the sun's height (0 at the horizon, 1 overhead), y how windy (ripple strength).

fn wave(p: vec2<f32>, t: f32) -> vec2<f32> {
    // three trains of ripples crossing at angles: the slope they give the surface
    var g = vec2<f32>(0.0);
    let d1 = normalize(vec2<f32>(1.0, 0.35));
    let d2 = normalize(vec2<f32>(-0.4, 1.0));
    let d3 = normalize(vec2<f32>(0.7, -0.9));
    g = g + d1 * cos(dot(p, d1) * 0.9 - t * 1.6) * 0.5;
    g = g + d2 * cos(dot(p, d2) * 1.7 - t * 2.3) * 0.3;
    g = g + d3 * cos(dot(p, d3) * 3.1 - t * 3.0) * 0.2;
    return g;
}

fn shade(s: Surface) -> vec4<f32> {
    let p = s.world.xz;
    let wind = max(s.param2.y, 0.2);
    let slope = wave(p, s.time) * wind;
    let n = normalize(vec3<f32>(-slope.x * 0.08, 1.0, -slope.y * 0.08));
    var surface = s;
    surface.normal = n;
    let colour = mix(vec3<f32>(0.10, 0.32, 0.40), vec3<f32>(0.04, 0.16, 0.30), 0.6 + 0.4 * sin(p.x * 0.01 + p.y * 0.013));
    var rgb = nova_light(surface, colour);
    let eye = s.param.xyz;
    let to_eye = normalize(eye - s.world);
    // the sun's glint, and the sky in the surface (more at a glancing view)
    let sun = normalize(vec3<f32>(0.5, max(s.param2.x, 0.15), 0.4));
    let glint = pow(max(dot(reflect(-sun, n), to_eye), 0.0), 80.0);
    rgb = rgb + vec3<f32>(1.0, 0.95, 0.85) * glint * 1.2;
    let fresnel = pow(1.0 - max(dot(n, to_eye), 0.0), 4.0);
    rgb = mix(rgb, vec3<f32>(0.70, 0.82, 0.92), fresnel * 0.55);
    let alpha = mix(s.param.w, 0.97, fresnel);
    return vec4<f32>(nova_fog(s, rgb), alpha);
}
