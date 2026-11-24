// ---- ribbons (gfx/ribbon.rs): soft strokes in the air, blended in their own pass (nova.ambient's wind curls) ----
// Appended to mesh.wgsl (its globals and fog_over are used). The alpha falls smoothly from the middle line to nothing at the edges:
// no pixel is cut, so the edge is as soft at any size and a faint stroke stays faint instead of breaking into dots.

struct RibbonIn {
    @location(0) position: vec3<f32>,
    @location(1) across: vec2<f32>,   // x: -1 to 1 across; y: the alpha
    @location(2) color: vec3<f32>,
};

struct RibbonOut {
    @builtin(position) position: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) across: vec2<f32>,
    @location(2) color: vec3<f32>,
};

@vertex
fn vs_ribbon(in: RibbonIn) -> RibbonOut {
    var out: RibbonOut;
    out.position = globals.view_proj * vec4<f32>(in.position, 1.0);
    out.world = in.position;
    out.across = in.across;
    // a little of the day's light: bright and faintly warm under the sun, greyer in a dull light
    out.color = in.color * (0.78 + 0.22 * globals.light_color.rgb);
    return out;
}

@fragment
fn fs_ribbon(in: RibbonOut) -> @location(0) vec4<f32> {
    let v = abs(in.across.x);
    let a = in.across.y * (1.0 - smoothstep(0.2, 1.0, v));
    if (a < 0.002) {
        discard;
    }
    return vec4<f32>(fog_over(in.world, in.color), a);
}
