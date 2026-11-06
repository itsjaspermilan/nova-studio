//! The characters of examples/hill-run were made from Kenney's Animated Characters (FBX) by `scripts/fbx2glb.mjs`: a skinned mesh
//! with 45 joints and three clips. This checks that the runtime reads them as such (it does not check the converter's maths: the
//! picture does, in the game).

use nova_runtime::model::import_parts;

#[test]
fn a_converted_fbx_character_has_a_skin_a_skeleton_and_its_five_clips() {
    for name in ["skater_male", "skater_female", "criminal", "cyborg"] {
        let bytes = std::fs::read(format!(
            "{}/../../examples/hill-run/models/{name}.glb",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap_or_else(|e| panic!("{name}: {e}"));
        let imported = import_parts(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut clips: Vec<(&str, f32)> = imported
            .clips
            .iter()
            .map(|c| (c.name.as_str(), c.duration))
            .collect();
        clips.sort_by(|a, b| a.0.cmp(b.0));
        assert_eq!(
            clips.iter().map(|c| c.0).collect::<Vec<_>>(),
            ["climb", "glide", "idle", "jump", "run"],
            "{name}"
        );
        let duration = |n: &str| clips.iter().find(|c| c.0 == n).unwrap().1;
        assert!((duration("idle") - 1.07).abs() < 0.02, "{name}: {clips:?}");
        assert!((duration("run") - 0.67).abs() < 0.02, "{name}: {clips:?}");
        assert!((duration("jump") - 0.5).abs() < 0.02, "{name}: {clips:?}");
        assert!(
            imported.parts.len() >= 58,
            "{name}: the skeleton is in the parts ({})",
            imported.parts.len()
        );
        assert!(
            imported
                .parts
                .iter()
                .any(|p| p.skin.as_ref().is_some_and(|s| s.joints.len() == 45)),
            "{name}: a mesh skinned to 45 joints"
        );
    }
}
