//! Fernhollow Post (examples/mountain-post), the vertical slice of the mountain post office game, played as a player would
//! through the shared harness (`nova_runtime::testing`): the whole slice in both orders, the words against the agreed spec
//! (docs/games/mountain-post.md), one parcel at a time, no wrong hand-overs, getting in and out only where it makes sense,
//! the van and the postmaster kept out of the creek and inside the map, nothing on the screen pointing anywhere, and the end
//! card only after both deliveries and the walk back in. Every run is seeded and frame-stepped: no wall clock.

use nova_runtime::game::Game;
use nova_runtime::testing::{self, Report};
use serde_json::Value;

const GAME: &str = "examples/mountain-post";

fn game() -> Game {
    testing::load_dir(GAME).expect("the slice loads")
}

fn play(g: &mut Game, plan: &str) -> Report {
    let report = testing::play(g, plan).expect("the plan plays");
    assert!(report.errors().is_empty(), "errors: {:?}", report.errors());
    report
}

fn lua(g: &Game, expr: &str) -> String {
    g.lua_text(expr)
        .unwrap_or_else(|e| panic!("{expr}: {e}"))
        .trim_matches('"')
        .to_string()
}

fn num(g: &Game, expr: &str) -> f64 {
    lua(g, expr)
        .parse::<f64>()
        .unwrap_or_else(|_| panic!("{expr} is not a number: {}", lua(g, expr)))
}

fn logged(r: &Report) -> Vec<String> {
    r.log().into_iter().map(|(_, l)| l).collect()
}

/// The slice's route file (tools/routes/slice.json: the title, the letter, one parcel, the drive, the hand-over, back, the
/// other, back again, the end card), as it is or with the two residents swapped round.
fn slice_route(swap: bool) -> String {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/mountain-post/tools/routes/slice.json");
    let text = std::fs::read_to_string(path).expect("the route file");
    if !swap {
        return text;
    }
    text.replace("hazel", "@@")
        .replace("Hazel", "##")
        .replace("pip", "hazel")
        .replace("Pip", "Hazel")
        .replace("@@", "pip")
        .replace("##", "Pip")
}

fn plays_the_whole_slice(swap: bool) {
    let mut g = game();
    let r = testing::play(&mut g, &slice_route(swap)).expect("the route plays");
    assert!(r.errors().is_empty(), "errors: {:?}", r.errors());
    let warnings: Vec<String> = r
        .warnings()
        .into_iter()
        .filter(|w| w.contains("never held") || w.contains("did not arrive"))
        .collect();
    assert!(
        warnings.is_empty(),
        "every step got where it was going: {warnings:?}"
    );
    let log = logged(&r);
    let (first, second) = if swap {
        ("pip", "hazel")
    } else {
        ("hazel", "pip")
    };
    let at = |line: &str| {
        log.iter()
            .position(|l| l == line)
            .unwrap_or_else(|| panic!("the log has {line:?}: {log:?}"))
    };
    // in order: the letter, the first parcel taken, loaded, handed over, delivered; then the second; then the end card
    assert!(at("card letter") < at(&format!("took {first}")));
    assert!(at(&format!("took {first}")) < at(&format!("loaded {first}")));
    assert!(at(&format!("loaded {first}")) < at(&format!("handed {first} the parcel")));
    assert!(at(&format!("delivered {first}")) < at(&format!("took {second}")));
    assert!(at(&format!("delivered {second}")) < at("the end card"));
    assert_eq!(lua(&g, "require('lib.state').delivered.hazel"), "true");
    assert_eq!(lua(&g, "require('lib.state').delivered.pip"), "true");
    assert_eq!(lua(&g, "require('lib.state').ended"), "true");
    assert_eq!(lua(&g, "nova.current_scene()"), "office");
    // each resident said every one of their lines, in order, and the first "after that" line when talked to again (the route does
    // that for the second only through its ending; the first is checked in `talking_again_rotates_the_after_lines`)
    for who in ["hazel", "pip"] {
        let said: Vec<&String> = log
            .iter()
            .filter(|l| l.starts_with(&format!("dialogue {who} ")))
            .collect();
        assert!(said.len() >= 5, "{who} said {said:?}");
        // each of the hand-over's lines came with the face lib/words.lua gives it (Hazel gruff, dry, sad at the shop that shut,
        // a small smile at "...Thank you"; Pip delighted, indignant at "It SINGS."), set as the line began
        let faces: Vec<String> = (1..=5)
            .map(|i| {
                lua(
                    &g,
                    &format!("require('lib.words').people.{who}.faces.given[{i}]"),
                )
            })
            .collect();
        let start = at(&format!("handed {who} the parcel"));
        for (i, face) in faces.iter().enumerate() {
            let line = log[start..]
                .iter()
                .position(|l| l.starts_with(&format!("dialogue {who} {}: ", i + 1)))
                .map(|k| k + start)
                .unwrap_or_else(|| panic!("{who} says line {}", i + 1));
            assert_eq!(
                log[line - 1],
                format!("face {who} {face}"),
                "{who}'s line {} comes with its face",
                i + 1
            );
        }
        // the postmaster smiles as the parcel leaves their hands
        assert_eq!(log[start + 1], "face postmaster happy");
    }
    let hazel: Vec<String> = (1..=5)
        .map(|i| {
            lua(
                &g,
                &format!("require('lib.words').people.hazel.faces.given[{i}]"),
            )
        })
        .collect();
    assert_eq!(hazel, ["gruff", "neutral", "sad", "gruff", "smile"]);
    let pip: Vec<String> = (1..=5)
        .map(|i| {
            lua(
                &g,
                &format!("require('lib.words').people.pip.faces.given[{i}]"),
            )
        })
        .collect();
    assert_eq!(
        pip,
        ["delighted", "delighted", "happy", "indignant", "delighted"]
    );
    assert!(lua(&g, "require('lib.words').people.pip.given[4]").contains("It SINGS."));
    assert!(lua(&g, "require('lib.words').people.hazel.given[3]").contains("didn't open up"));
}

/// The owner's fourth notes: "Walking the player shouldn't have their arms out. For running they will". The stick alone only walks
/// (a gentle tilt slowly, a full push at the full walk, arms by the sides, never the run); holding B runs, the arms held out like
/// wings, about twice the walk and far slower than the van; with a parcel B is a brisk trot with the arms round the parcel.
#[test]
fn the_stick_alone_walks_b_runs_and_a_parcel_makes_it_a_trot() {
    let mut g = game();
    let clip = "(nova.named('postmaster').anim:time())";
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -125, 0; require('lib.camera').reset(0)" },
        { "wait": 30 },
        { "hold": ["move_y=-0.6"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "walk");
    let walk = num(&g, "nova.named('postmaster').speed");
    assert!((0.8..=1.3).contains(&walk), "a gentle tilt walks: {walk}");
    assert_eq!(lua(&g, clip), "walk");
    // the stick pushed all the way, alone: the full walk, never the run (the walk's blend only: no arms out)
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 90 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "walk");
    let full_walk = num(&g, "nova.named('postmaster').speed");
    assert!(
        (1.5..=1.62).contains(&full_walk),
        "a full push alone walks at the walk's top: {full_walk}"
    );
    assert_eq!(lua(&g, clip), "walk", "the stick alone never runs");
    assert_eq!(
        lua(&g, "tostring(nova.named('postmaster').run_held)"),
        "false"
    );
    // B held (with any push): the run
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "run"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "run");
    let run = num(&g, "nova.named('postmaster').speed");
    assert!(
        run > 2.8 && run < 3.05,
        "B runs at about twice the walk's top (1.6): {run}"
    );
    assert_eq!(
        lua(&g, clip),
        "run",
        "the run clip, nearer than the walk in the blend"
    );
    // the run clip holds both arms straight out to the sides (rz well past 60 degrees) and a little back all the way through
    let model = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/mountain-post/models/postmaster.model.json"),
    )
    .unwrap();
    let model: Value = serde_json::from_str(&model).unwrap();
    let clips = model["clips"].as_array().unwrap();
    let find = |name: &str| clips.iter().find(|c| c["name"] == name).unwrap();
    let arm = |c: &Value, part: &str| -> Vec<[f64; 3]> {
        c["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| {
                t["prop"] == "rotation" && t["part"].as_array().unwrap().last().unwrap() == part
            })
            .flat_map(|t| t["keys"].as_array().unwrap().clone())
            .map(|k| {
                let v = k["value"].as_array().unwrap();
                [
                    v[0].as_f64().unwrap(),
                    v[1].as_f64().unwrap(),
                    v[2].as_f64().unwrap(),
                ]
            })
            .collect()
    };
    let run_clip = find("run");
    let (l, r) = (arm(run_clip, "arm_l"), arm(run_clip, "arm_r"));
    assert!(!l.is_empty() && !r.is_empty());
    assert!(
        l.iter().all(|v| v[2] > 60.0 && v[0] > 0.0),
        "left arm out: {l:?}"
    );
    assert!(
        r.iter().all(|v| v[2] < -60.0 && v[0] > 0.0),
        "right arm out: {r:?}"
    );
    assert!(
        arm(find("walk"), "arm_l").iter().all(|v| v[2].abs() < 30.0),
        "the walk keeps the arms by the sides"
    );
    assert_eq!(num(&g, "nova.named('postmaster').carry_w"), 0.0);
    // letting go: back to standing
    play(&mut g, r#"{ "steps": [ { "wait": 60 } ] }"#);
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "still");
    // B let go while moving: back to the walk, the arms in again within about 0.2 s
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "run"], "frames": 30 }, { "hold": ["move_y=-1"], "frames": 14 } ] }"#,
    );
    let down = num(&g, "nova.named('postmaster').speed");
    assert!(
        down < 1.75,
        "0.23 s after B is let go, nearly back to the walk: {down}"
    );
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 30 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "walk");
    play(&mut g, r#"{ "steps": [ { "wait": 60 } ] }"#);
    // with a parcel the stick alone still walks; B is the trot, the carry over the arms (the trot itself leaves the arms alone)
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "require('lib.state').carrying = 'hazel'" }, { "hold": ["move_y=-1"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "walk");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "run"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "trot");
    assert_eq!(lua(&g, clip), "trot");
    assert_eq!(lua(&g, "nova.named('postmaster').anim:state()"), "laden");
    assert!(num(&g, "nova.named('postmaster').carry_w") > 0.95);
    let trot = num(&g, "nova.named('postmaster').speed");
    assert!(
        trot > walk && trot < run,
        "the trot is between the walk and the run: {trot}"
    );
    assert!(arm(find("trot"), "arm_l").is_empty());
    // and the van is far quicker than either (the starting van's top on the flat is about 10.5 m/s)
    assert!(run * 3.0 < 10.5);
}

#[test]
#[ignore = "long: about 17 s each; scripts/test.sh all (or one mountain_post) runs them"]
fn the_whole_slice_plays_start_to_finish_hazel_first() {
    plays_the_whole_slice(false);
}

#[test]
#[ignore = "long: about 17 s each; scripts/test.sh all (or one mountain_post) runs them"]
fn the_whole_slice_plays_start_to_finish_pip_first() {
    plays_the_whole_slice(true);
}

/// Every word of the slice is the spec's: the labels, the Mayor's letter, each conversation, the "after that" and "knock without"
/// lines, the end card. Each is checked to be in the spec's text (its whitespace made single) and in lib/words.lua.
#[test]
fn the_labels_and_every_line_are_exactly_the_specs_words() {
    let spec = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/games/mountain-post.md"),
    )
    .unwrap();
    let spec = spec
        .split("## Slice spec")
        .nth(1)
        .expect("the slice spec section")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let g = game();
    let mut words = vec![
        lua(&g, "require('lib.words').labels.letter"),
        lua(&g, "require('lib.words').labels.hazel"),
        lua(&g, "require('lib.words').labels.pip"),
        lua(&g, "require('lib.words').ending"),
    ];
    for i in 1..=2 {
        words.push(lua(&g, &format!("require('lib.words').letter[{i}]")));
    }
    for who in ["hazel", "pip"] {
        for i in 1..=5 {
            words.push(lua(
                &g,
                &format!("require('lib.words').people.{who}.given[{i}]"),
            ));
        }
        for i in 1..=2 {
            words.push(lua(
                &g,
                &format!("require('lib.words').people.{who}.after[{i}]"),
            ));
        }
        words.push(lua(
            &g,
            &format!("require('lib.words').people.{who}.without"),
        ));
    }
    for w in &words {
        let quoted = w.replace("\\'", "'");
        assert!(!quoted.is_empty());
        assert!(spec.contains(&quoted), "the spec has {quoted:?}");
    }
    // the exact lines the spec quotes, in its order (a check on the check: nothing above was empty or cut short)
    assert_eq!(
        lua(&g, "require('lib.words').labels.hazel"),
        "Hazel Brock, 3 Fern Lane"
    );
    assert_eq!(
        lua(&g, "require('lib.words').labels.pip"),
        "Pip Tansy, 7 Kettle Creek Road"
    );
    assert_eq!(
        lua(&g, "require('lib.words').labels.letter"),
        "The Postmaster, Post Road"
    );
    assert_eq!(
        lua(&g, "require('lib.words').people.hazel.given[1]"),
        "Hm. So there IS a postmaster."
    );
    assert_eq!(
        lua(&g, "require('lib.words').people.pip.given[5]"),
        "Tune in tonight. I'm going to say your name. What IS your name? Never mind, I'll say 'the Postmaster'. Sounds grander."
    );
    assert_eq!(
        lua(&g, "require('lib.words').ending"),
        "Two delivered. A few hundred to go."
    );
}

/// The label held up when a parcel is taken shows the name and the street, and the letter reads the Mayor's words on screen.
#[test]
fn taking_a_parcel_shows_its_label_and_the_letter_reads_at_the_counter() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "steps": [
        { "wait": 20 }, { "walk_to": [0.9, 0.35], "max": 300 }, { "press": "interact" }, { "wait": 30 } ],
        "print": ["nova.testing.drawn('ui_text')"] }"#,
    );
    let texts: Vec<String> = r
        .drawn("ui_text", None)
        .iter()
        .filter_map(|d| d["name"].as_str().map(String::from))
        .collect();
    assert!(
        texts
            .iter()
            .any(|t| t.starts_with("Welcome to Fernhollow.")),
        "the letter is on the screen: {texts:?}"
    );
    assert!(
        texts
            .iter()
            .any(|t| t == "P.S. The van pulls a little to the left. So did Mr. Pemberton."),
        "{texts:?}"
    );
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('pip')" }, { "until": "not T.walking()", "max": 400 },
        { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    let texts: Vec<String> = r
        .drawn("ui_text", None)
        .iter()
        .filter_map(|d| d["name"].as_str().map(String::from))
        .collect();
    assert!(
        texts.contains(&"Pip Tansy".to_string())
            && texts.contains(&"7 Kettle Creek Road".to_string()),
        "the label, big: {texts:?}"
    );
    assert_eq!(lua(&g, "require('lib.state').carrying"), "pip");
}

/// One parcel at a time: carrying one, X at the other's place on the shelf does not take it (it puts back the one carried).
#[test]
fn one_parcel_at_a_time() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('hazel')" }, { "until": "not T.walking()", "max": 400 },
        { "press": "interact" }, { "wait": 30 }, { "press": "interact" }, { "wait": 20 },
        { "lua": "nova.named('postmaster').walk_to = T.shelf_spot('pip')" }, { "until": "not T.walking()", "max": 400 },
        { "wait": 5, "lua": "OFFER = nova.scene_now():action()" } ] }"#,
    );
    assert_eq!(lua(&g, "require('lib.state').carrying"), "hazel");
    assert_eq!(
        lua(&g, "OFFER"),
        "put_back",
        "with a parcel in the arms the shelf offers to put it back, not to take another"
    );
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.state').carrying)"), "nil");
    assert_eq!(lua(&g, "require('lib.state').on_shelf.hazel"), "true");
    assert_eq!(lua(&g, "require('lib.state').on_shelf.pip"), "true");
}

/// Knocking with the wrong parcel (or none) gets the resident's "knock without" line and hands nothing over.
#[test]
fn you_cannot_hand_over_the_wrong_parcel() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "local s = require('lib.state'); s.carrying = 'pip'; s.on_shelf.pip = false", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 36" },
        { "walk_to": "hazel", "max": 600 }, { "until": "nova.scene_now():resident_near() ~= nil", "max": 200 },
        { "press": "interact" }, { "wait": 120 } ] }"#,
    );
    assert!(
        logged(&r)
            .iter()
            .any(|l| l == "dialogue hazel 1: Unless that's my chisels, I'm busy."),
        "{:?}",
        logged(&r)
    );
    assert_eq!(lua(&g, "require('lib.state').carrying"), "pip");
    assert_eq!(lua(&g, "require('lib.state').delivered.hazel"), "false");
    assert_eq!(lua(&g, "require('lib.state').delivered.pip"), "false");
}

/// After a delivery, talking again gives the "after that" lines in turn.
#[test]
fn talking_again_rotates_the_after_lines() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "local s = require('lib.state'); s.delivered.pip = true; s.on_shelf.pip = false", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = -178, 100" },
        { "walk_to": "pip", "max": 600 }, { "until": "nova.scene_now():resident_near() ~= nil", "max": 200 },
        { "press": "interact" }, { "wait": 30 }, { "press": "interact" }, { "wait": 10 }, { "press": "interact" }, { "wait": 30 },
        { "press": "interact" }, { "wait": 30 }, { "press": "interact" }, { "wait": 10 }, { "press": "interact" }, { "wait": 30 },
        { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    let said: Vec<String> = logged(&r)
        .into_iter()
        .filter(|l| l.starts_with("dialogue pip"))
        .collect();
    assert_eq!(
        said[0],
        "dialogue pip 1: Testing, testing. Can you hear that? No? Good, it's not plugged in yet."
    );
    assert_eq!(
        said[1],
        "dialogue pip 1: If Hazel asks, the aerial is staying."
    );
    assert_eq!(
        said[2],
        "dialogue pip 1: Testing, testing. Can you hear that? No? Good, it's not plugged in yet."
    );
}

/// Y gets in only beside the van; Y gets out only when the van has stopped.
#[test]
fn getting_in_and_out_works_only_where_it_should() {
    let mut g = game();
    // far from the van, Y does nothing
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 10, "lua": "local p = nova.named('postmaster'); p.x, p.z = 2, -160" }, { "press": "van" }, { "wait": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    // beside its left doorway, Y gets in (at once: the engine starts)
    let r = play(
        &mut g,
        r#"{ "lua": "T = require('lib.testkit')", "steps": [ { "lua": "T.to_van('door')" }, { "until": "not T.walking()", "max": 900 }, { "press": "van" },
        { "until": "nova.scene_now().mode == 'van'", "max": 300 }, { "wait": 30 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "van");
    assert_eq!(lua(&g, "nova.named('postmaster').seated"), "true");
    assert!(
        r.json["sounds"].to_string().contains("engine_start"),
        "the engine is heard: {}",
        r.json["sounds"]
    );
    // moving, Y does not get out
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["go"], "frames": 150 }, { "hold": ["go"], "press": "van", "frames": 10 } ] }"#,
    );
    assert!(num(&g, "nova.named('van').speed") > 3.0);
    assert_eq!(
        lua(&g, "nova.scene_now().mode"),
        "van",
        "no getting out at speed"
    );
    // stopped, it does: out by the driver's door, beside the van, not inside it
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "until": "nova.named('van'):stopped()", "max": 400 }, { "press": "van" }, { "wait": 90 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    let d = num(
        &g,
        "math.sqrt((nova.named('postmaster').x - nova.named('van').x)^2 + (nova.named('postmaster').z - nova.named('van').z)^2)",
    );
    assert!(
        (1.2..3.5).contains(&d),
        "the postmaster stands beside the van ({d} m from its middle)"
    );
}

/// The van and the postmaster cannot get into the creek or the gorge, or past the map's edges: driven straight at them, they stop
/// at the bank and at the edge.
#[test]
fn the_van_and_the_postmaster_cannot_leave_the_map_or_enter_the_creek() {
    let mut g = game();
    // for every frame: neither stands in the water (off the bridge) and both are inside the limits
    let always = "(function() local w = require('lib.world'); for _, e in ipairs({ nova.named('van'), nova.named('postmaster') }) do \
        if not w.on_bridge(e.x, e.z) then local o, d = w.nearest('water', e.x, e.z); if o and d < o.width / 2 then return false end end; \
        local L = w.limits; if e.x < L.x0 + 20 or e.x > L.x1 - 20 or e.z < L.z0 + 20 or e.z > L.gorge then return false end end; return true end)()";
    let drive_at = |g: &mut Game, x: f64, z: f64, heading: f64| {
        let plan = format!(
            r#"{{ "start_scene": "valley", "always": "{always}", "steps": [
                {{ "wait": 5, "lua": "local v = nova.named('van'); v:teleport({x}, {z}, {heading}); nova.scene_now().mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').seated = true" }},
                {{ "hold": ["go"], "frames": 600 }} ] }}"#
        );
        play(g, &plan)
    };
    // at the creek, south of the bridge, from the west bank heading east (-x); at the gorge from the barrier; at the east edge
    drive_at(&mut g, -85.0, -20.0, -std::f64::consts::FRAC_PI_2);
    assert!(
        num(
            &g,
            "(function() local o, d = require('lib.world').nearest('water', nova.named('van').x, nova.named('van').z); return d or 99 end)()"
        ) > 2.0
    );
    drive_at(&mut g, 20.0, 222.0, 0.0);
    assert!(num(&g, "nova.named('van').z") < 236.0);
    drive_at(&mut g, -200.0, 0.0, -std::f64::consts::FRAC_PI_2);
    assert!(num(&g, "nova.named('van').x") > -230.0);
    drive_at(&mut g, 0.0, -220.0, std::f64::consts::PI);
    assert!(num(&g, "nova.named('van').z") > -245.0);
    // on foot: into the creek, and out to the west edge
    let walk = |g: &mut Game, x: f64, z: f64, tx: f64, tz: f64| {
        play(
            g,
            &format!(
                r#"{{ "start_scene": "valley", "always": "{always}", "steps": [
            {{ "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = {x}, {z}; p.walk_to = {{ {tx}, {tz} }}" }}, {{ "wait": 900 }} ] }}"#
            ),
        );
    };
    walk(&mut g, -92.0, -20.0, -110.0, -20.0);
    walk(&mut g, 200.0, 0.0, 260.0, 0.0);
    assert!(num(&g, "nova.named('postmaster').x") < 230.0);
}

/// Nothing on the screen points at a destination: no pin, arrow, marker, route or waypoint is ever drawn, and the minimap draws only
/// the roads (lines inside its disc) and the "you" mark, with its disc under them.
#[test]
fn nothing_on_screen_points_at_a_destination() {
    let mut g = game();
    let check = |r: &Report, where_: &str| {
        let ui = r.drawn("ui", None);
        for d in &ui {
            let name = d["name"].as_str().unwrap_or("").to_lowercase();
            for bad in [
                "pin",
                "arrow",
                "marker",
                "route",
                "waypoint",
                "destination",
                "target",
            ] {
                assert!(!name.contains(bad), "{where_}: {name:?} is drawn");
            }
        }
        // the minimap: its disc's middle and reach, from the disc sprite
        let disc = r.drawn("ui_sprite", Some("minimap_disc"));
        assert_eq!(disc.len(), 1, "{where_}: one minimap disc");
        let (cx, cy, rw) = (
            disc[0]["x"].as_f64().unwrap(),
            disc[0]["y"].as_f64().unwrap(),
            disc[0]["w"].as_f64().unwrap() / 2.0,
        );
        let inside = |x: f64, y: f64| ((x - cx).powi(2) + (y - cy).powi(2)).sqrt() <= rw + 1.0;
        // (the roads are soft strokes since the fifth play's weak points: a bar for each piece and a round joint at each bend, each
        // within the disc; a piece reaches at most half its length either side of its middle)
        let roads: Vec<Value> = r
            .drawn("ui_sprite", None)
            .into_iter()
            .filter(|s| {
                let n = s["name"].as_str().unwrap_or("");
                n.ends_with("minimap_road") || n.ends_with("minimap_joint")
            })
            .collect();
        assert!(!roads.is_empty(), "{where_}: roads on the minimap");
        for l in &roads {
            let (x, y, w) = (
                l["x"].as_f64().unwrap(),
                l["y"].as_f64().unwrap(),
                l["w"].as_f64().unwrap(),
            );
            assert!(
                ((x - cx).powi(2) + (y - cy).powi(2)).sqrt() + w / 2.0 <= rw + 1.0,
                "{where_}: a road outside the minimap's disc: {l}"
            );
        }
        let in_disc: Vec<String> = r
            .drawn("ui_sprite", None)
            .iter()
            .filter(|s| inside(s["x"].as_f64().unwrap(), s["y"].as_f64().unwrap()))
            .map(|s| s["name"].as_str().unwrap_or("").to_string())
            .collect();
        for n in &in_disc {
            assert!(
                // (and the north tab on its rim: the fifth play's; it says where north is, not where anything is)
                n.contains("minimap_disc")
                    || n.ends_with("ui/you")
                    || n.ends_with("ui/minimap_north")
                    || n.ends_with("ui/minimap_road")
                    || n.ends_with("ui/minimap_joint"),
                "{where_}: only the disc and you in the minimap: {in_disc:?}"
            );
        }
        assert!(
            in_disc.iter().any(|n| n.ends_with("ui/you")),
            "{where_}: you are on the minimap"
        );
    };
    // on foot, carrying Hazel's parcel, near Post Road
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "require('lib.state').carrying = 'hazel'", "steps": [ { "wait": 30 } ] }"#,
    );
    check(&r, "on foot");
    // driving with a parcel in the back, at the junction with Fern Lane
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "require('lib.state').van_load = { 'pip' }", "steps": [
        { "wait": 5, "lua": "local v = nova.named('van'); v:teleport(6, -100, 0); nova.scene_now().mode = 'van'; v.driven = true; nova.named('postmaster').seated = true" },
        { "hold": ["go"], "frames": 200 } ] }"#,
    );
    check(&r, "driving");
    // the paper map: the sheet, and nothing on it but the sheet (its own marks are in its picture: the roads, their names, the post office)
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 10 }, { "press": "map" }, { "wait": 30 } ] }"#,
    );
    let sprites: Vec<String> = r
        .drawn("ui_sprite", None)
        .iter()
        .map(|s| s["name"].as_str().unwrap_or("").to_string())
        .collect();
    assert!(
        sprites
            .iter()
            .any(|s| s.ends_with("ui/map") || s.ends_with("ui/map_720")),
        "the paper map is open: {sprites:?}"
    );
    assert!(
        !sprites.iter().any(|s| s.ends_with("ui/you")),
        "no mark for you over the paper map: {sprites:?}"
    );
}

/// The end card comes only when both parcels are delivered and the postmaster walks back into the post office.
#[test]
fn the_end_card_appears_only_after_both_deliveries_and_the_return() {
    let mut g = game();
    // one delivered: back in the office, no card
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "local s = require('lib.state'); s.delivered.hazel = true; s.on_shelf.hazel = false; s.came_out = true", "steps": [ { "wait": 240 } ] }"#,
    );
    assert!(!logged(&r).iter().any(|l| l == "the end card"));
    assert_eq!(r.drawn_count("ui_text", Some("Two delivered")), 0);
    // both delivered, still out in the valley: no card
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "local s = require('lib.state'); s.delivered.hazel = true; s.delivered.pip = true; s.on_shelf.hazel = false; s.on_shelf.pip = false", "steps": [ { "wait": 240 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Two delivered")), 0);
    // and walking in: the card, with the spec's words
    let r = play(
        &mut g,
        r#"{ "lua": "T = require('lib.testkit')", "steps": [ { "lua": "T.to_office()" }, { "until": "nova.current_scene() == 'office'", "max": 1200 },
        { "until": "require('lib.cards').kind() == 'ending'", "max": 200 }, { "wait": 180 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "the end card"));
    assert_eq!(
        r.drawn_count("ui_text", Some("Two delivered. A few hundred to go.")),
        1
    );
    // X closes it and the game goes on
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");
}

/// Start opens the pause menu (Resume, Quit); Resume closes it.
#[test]
fn the_pause_menu_has_resume_and_quit() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 10 }, { "press": "pause" }, { "wait": 20 } ] }"#,
    );
    let texts: Vec<String> = r
        .drawn("ui_text", None)
        .iter()
        .filter_map(|d| d["name"].as_str().map(String::from))
        .collect();
    assert!(
        texts.contains(&"Resume".to_string()) && texts.contains(&"Quit".to_string()),
        "{texts:?}"
    );
    play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");
}

#[allow(dead_code)]
fn unused(_: Value) {}

/// The cast's faces are painted on their heads (character3d_make's chibi build): each model carries every drawing of the eyes,
/// brows and mouth as a part of its head, all but the first of each set hidden at rest, and lib/face.lua shows exactly one of
/// each set: the expression's, a blink, and while a line is said the mouth's open partner. Hazel's face at rest is the
/// half-lidded "dry" one; the postmaster's and Pip's the plain one.
#[test]
fn each_face_shows_one_drawing_of_each_set_and_blinks_and_talks_with_painted_parts() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    let sets = [
        "eye_open eye_happy eye_wide eye_half eye_shut",
        "brow_flat brow_frown brow_up brow_sad",
        "mouth_closed mouth_smile mouth_open mouth_grin mouth_frown mouth_o",
    ];
    for who in ["postmaster", "hazel", "pip"] {
        let parts = lua(&g, &format!("table.concat(nova.model_parts('{who}'), ' ')"));
        for set in sets {
            for name in set.split(' ') {
                assert!(
                    parts.split(' ').any(|p| p == name),
                    "{who} has no part {name}: {parts}"
                );
            }
        }
        // the model file hides all but the first of each set
        let file =
            std::fs::read_to_string(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
                format!("../../examples/mountain-post/models/{who}.model.json"),
            ))
            .expect("the model file");
        assert_eq!(
            file.matches("\"hidden\": true").count(),
            4 + 3 + 5,
            "{who}: hidden drawings"
        );
        assert!(
            file.contains("\"name\": \"face_paint\""),
            "{who}: the nose and patches are painted"
        );
        // the parts table shows exactly one of each set, for every expression, blinking or not, talking or not
        let shown = |expr: &str, blink: bool, open: bool| -> Vec<String> {
            let shown = lua(
                &g,
                &format!(
                    "(function() local F = require('lib.face'); local f = F.new(1, nova.named('{who}').mood.rest); F.set(f, '{expr}'); \
                     f.blink = {}; f.open = {open}; local t = F.parts(f); local out = {{}}; \
                     for k, v in pairs(t) do if v.visible then out[#out + 1] = k end end; table.sort(out); return table.concat(out, ' ') end)()",
                    if blink { 0.1 } else { 0.0 }
                ),
            );
            shown.split(' ').map(str::to_string).collect()
        };
        for expr in [
            "neutral",
            "smile",
            "happy",
            "delighted",
            "gruff",
            "dry",
            "sad",
            "surprised",
            "indignant",
        ] {
            for (blink, open) in [(false, false), (true, false), (false, true)] {
                let on = shown(expr, blink, open);
                assert_eq!(on.len(), 3, "{who} {expr}: {on:?}");
                for set in sets {
                    assert_eq!(
                        on.iter()
                            .filter(|p| set.split(' ').any(|n| n == p.as_str()))
                            .count(),
                        1,
                        "{who} {expr}: {on:?}"
                    );
                }
                assert_eq!(
                    on.iter().any(|p| p == "eye_shut"),
                    blink,
                    "{who} {expr} blink {blink}: {on:?}"
                );
            }
            // talking swaps the mouth for its partner, and only the mouth
            let still = shown(expr, false, false);
            let open = shown(expr, false, true);
            assert_ne!(still, open, "{who} {expr}: the mouth moves");
            assert_eq!(
                still
                    .iter()
                    .filter(|p| !p.starts_with("mouth_"))
                    .collect::<Vec<_>>(),
                open.iter()
                    .filter(|p| !p.starts_with("mouth_"))
                    .collect::<Vec<_>>()
            );
        }
        let rest = shown("neutral", false, false);
        let eyes = if who == "hazel" {
            "eye_half"
        } else {
            "eye_open"
        };
        assert!(rest.iter().any(|p| p == eyes), "{who} at rest: {rest:?}");
    }
}

/// Hazel is a bear now (the owner's first play: "a badger is tough"), in a carpenter's apron; the postmaster a fox in a cap
/// with an envelope on the chest, Pip a rabbit with headphones. Nothing in the game calls anyone a badger any more.
#[test]
fn hazel_is_a_bear_and_nothing_says_badger() {
    let root =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/mountain-post");
    let cast = std::fs::read_to_string(root.join("tools/cast.mjs")).expect("the cast's recipe");
    let line = |name: &str| {
        cast.lines()
            .find(|l| l.contains(&format!("name: \"{name}\"")))
            .unwrap_or_default()
            .to_string()
    };
    assert!(
        line("hazel").contains("species: \"bear\"")
            && line("hazel").contains("accessory: \"apron\""),
        "{}",
        line("hazel")
    );
    assert!(
        line("postmaster").contains("species: \"fox\"")
            && line("postmaster").contains("hat: \"peaked\"")
    );
    assert!(
        line("pip").contains("species: \"rabbit\"")
            && line("pip").contains("accessory: \"headphones\"")
    );
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("a folder") {
            let path = entry.expect("an entry").path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            if path.is_dir() {
                if name != "build" {
                    stack.push(path);
                }
                continue;
            }
            if !(name.ends_with(".lua")
                || name.ends_with(".mjs")
                || name.ends_with(".scene.json")
                || name == "nova.json")
            {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("a text file");
            assert!(
                !text.to_lowercase().contains("badger"),
                "{} still says badger",
                path.display()
            );
        }
    }
    // the dialogue itself is unchanged: Hazel is still gruff and dry
    let g = game();
    assert_eq!(
        lua(&g, "require('lib.words').people.hazel.faces.given[1]"),
        "gruff"
    );
}
// ---- the owner's first play on the Retroid (2026-11-22): the van, the trees ----------------------------------------------------------

/// "The back doors on the van aren't really fixed to the van. They slide around when the vehicle turns." The doors are the body's
/// children in the model now, so whatever the body does (lean, roll, pitch, the lift of its springs), each door's hinge does with
/// it: in a brisk bend with the doors swung open, every hinge is exactly where the body's own turn puts the hinge's place at rest.
#[test]
fn the_vans_rear_doors_ride_with_the_body_through_a_turn() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [
            { "wait": 5, "lua": "local v = nova.named('van'); v:teleport(-40, -78, 1.75); nova.scene_now().mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').seated = true; require('lib.testkit').drive('hazel')" },
            { "until": "math.abs(nova.named('van').yaw_rate or 0) > 0.2 and math.abs(nova.named('van').speed) > 5", "max": 2500 },
            { "lua": "nova.scene_now().back_doors = function() end; nova.named('van').back_want = 1" },
            { "until": "nova.named('van').back_open > 0.8 and math.abs(nova.named('van').roll) > 0.015", "max": 1500 } ] }"#,
    );
    // (the body's lean must be real for the check to mean anything; the slower starting van leans less)
    let roll = num(&g, "nova.named('van').roll").abs();
    assert!(roll > 0.015, "the van leans in the bend: {roll}");
    assert_eq!(
        lua(
            &g,
            "(function() local p = {} for _, n in ipairs(nova.model_parts('van')) do p[#p + 1] = n end table.sort(p) return table.concat(p, ' ') end)()"
        ),
        "body door_l door_l_leaf door_r door_r_leaf lamp_brake lamp_head lamp_indicator_back lamp_indicator_front lamp_reverse lamp_reverse_off lamp_tail steering wheel_fl wheel_fr wheel_rl wheel_rr"
    );
    // each hinge as posed with the van's own parts table, against the body's turn (its roll about z, then its pitch about x, then
    // its lift) applied to the hinge at rest
    let off = num(
        &g,
        "(function() local v = nova.named('van'); local b = v.parts_table.body; local now = nova.model_pose('van', { parts = v.parts_table }); \
         local rest = nova.model_pose('van'); local worst = 0; \
         for _, n in ipairs({ 'door_l', 'door_r' }) do local h = rest[n]; \
           local x, y = h.x * math.cos(b.rz) - h.y * math.sin(b.rz), h.x * math.sin(b.rz) + h.y * math.cos(b.rz); \
           local y2, z = y * math.cos(b.rx) - h.z * math.sin(b.rx), y * math.sin(b.rx) + h.z * math.cos(b.rx); \
           local p = now[n]; local d = math.sqrt((p.x - x) ^ 2 + (p.y - (y2 + b.y)) ^ 2 + (p.z - z) ^ 2); if d > worst then worst = d end end; \
         return worst end)()",
    );
    assert!(
        off < 0.01,
        "a door's hinge is {off} m off the body in the bend"
    );
    // and it did move with the body (a door left at its place at rest would be this far off)
    let moved = num(
        &g,
        "(function() local v = nova.named('van'); local now = nova.model_pose('van', { parts = v.parts_table }); local rest = nova.model_pose('van'); \
         local h, p = rest.door_l, now.door_l; return math.sqrt((p.x - h.x) ^ 2 + (p.y - h.y) ^ 2 + (p.z - h.z) ^ 2) end)()",
    );
    assert!(
        moved > 0.02,
        "the hinge rode with the leaning body: {moved}"
    );
}

/// "There are also blocky black wheels underneath the actual wheels of the van." They were dark discs in the body (round "arches"
/// at a fixed height that the sprung wheels moved away from). Now every round shape laid along x (a wheel's shape) belongs to one
/// of the four wheels, each wheel is a tyre with a hub, and each turns in a well cut out of the body ("hollow wheel wells").
#[test]
fn the_van_has_four_wheels_in_hollow_wells_and_no_stray_wheel_shapes() {
    fn walk(
        p: &Value,
        wheels: &mut Vec<(String, f64)>,
        stray: &mut Vec<String>,
        wells: &mut Vec<(f64, f64)>,
    ) {
        let name = p["name"].as_str().unwrap_or("").to_string();
        let is_wheel = name.starts_with("wheel_");
        if is_wheel {
            wheels.push((name.clone(), p["origin"][2].as_f64().unwrap_or(0.0) / 16.0));
            assert!(
                p["cubes"].as_array().is_some_and(|c| c.len() >= 3),
                "{name}: a tyre, a hub and a cap at least"
            );
        }
        for c in p["cubes"].as_array().into_iter().flatten() {
            let round = c["shape"] == "cylinder" || c["shape"] == "sphere";
            let along_x = c["rotation"]
                .as_array()
                .is_some_and(|r| r.get(2).and_then(Value::as_f64) == Some(90.0));
            let big = c["size"]
                .as_array()
                .and_then(|s| s.first())
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                / 16.0
                > 0.25;
            if round && along_x && big && !is_wheel {
                stray.push(format!("{name}: a {} disc {:?}", c["shape"], c["size"]));
            }
            for m in c["modifiers"].as_array().into_iter().flatten() {
                for cut in m["cuts"].as_array().into_iter().flatten() {
                    if cut["remove"] == true && cut["view"] == "side" {
                        let zs: Vec<f64> = cut["points"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|p| p[0].as_f64().unwrap() / 16.0)
                            .collect();
                        wells.push((
                            zs.iter().cloned().fold(f64::MAX, f64::min),
                            zs.iter().cloned().fold(f64::MIN, f64::max),
                        ));
                    }
                }
            }
        }
        for ch in p["children"].as_array().into_iter().flatten() {
            walk(ch, wheels, stray, wells);
        }
    }
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/mountain-post/models/van.model.json");
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("the van's model"))
        .expect("json");
    let (mut wheels, mut stray, mut wells) = (Vec::new(), Vec::new(), Vec::new());
    for p in doc["parts"].as_array().expect("parts") {
        walk(p, &mut wheels, &mut stray, &mut wells);
    }
    assert!(
        stray.is_empty(),
        "round wheel-like shapes outside the wheels: {stray:?}"
    );
    assert_eq!(wheels.len(), 4, "four wheels: {wheels:?}");
    for (name, z) in &wheels {
        assert!(
            wells.iter().any(|&(a, b)| a < *z - 0.3 && b > *z + 0.3),
            "{name} at z {z} turns in a well cut out of the body: {wells:?}"
        );
    }
    // and in the game: where the van stands, only the van's own model is drawn (no second wheel model, no stand-in)
    let mut g = game();
    g.record_drawn();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let (vx, vz) = (
        num(&g, "nova.named('van').x"),
        num(&g, "nova.named('van').z"),
    );
    let drawn = g.drawn(Some("model"), None);
    let near_van: Vec<&Value> = drawn["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter(|i| {
            let (x, z) = (
                i["x"].as_f64().unwrap_or(1e9),
                i["z"].as_f64().unwrap_or(1e9),
            );
            (x - vx).abs() < 2.0 && (z - vz).abs() < 2.0
        })
        .collect();
    assert!(
        !near_van.is_empty() && near_van.iter().all(|i| i["name"] == "van"),
        "only the van's own model is drawn where it stands: {near_van:?}"
    );
}

/// "The trees do this weird thing where all their leaf cones are sloped the same way the ground is." The renderer lifted every
/// vertex by the ground under it, which shears a tall thing on a hillside; trees, bushes, the mast, the signposts and the mailboxes
/// are now drawn `upright` (the engine's `lift = "upright"`, checked on the GPU by tests/upright_gpu.rs): the foot follows the slope,
/// the crown stays level. Every tree kind in the valley says so, and the valley has trees on slopes steep enough for it to matter.
#[test]
fn every_tree_in_the_valley_stands_upright_on_its_slope() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 2 } ] }"#,
    );
    let report = lua(
        &g,
        "(function() local kinds, steep, bad = {}, 0, {} \
           for _, o in ipairs(nova.scene_data('valley').objects) do \
             if o.kind:match('^pine') or o.kind:match('^larch') or o.kind == 'birch' or o.kind:match('^bush') then \
               kinds[o.kind] = true; local gx, gz = nova.terrain_slope(o.x, o.z); if math.sqrt(gx * gx + gz * gz) > 0.5 then steep = steep + 1 end end end \
           local n = 0 for k in pairs(kinds) do n = n + 1; local c = require('entities.' .. k); if c.__lift ~= 'upright' then bad[#bad + 1] = k end end \
           table.sort(bad) return n .. ' kinds, ' .. steep .. ' on steep ground; not upright: ' .. table.concat(bad, ' ') end)()",
    );
    let (kinds, rest) = report.split_once(" kinds, ").expect("the report");
    assert!(kinds.parse::<u32>().unwrap() >= 8, "{report}");
    let steep: u32 = rest.split_once(' ').unwrap().0.parse().unwrap();
    assert!(
        steep > 50,
        "the valley has trees on slopes over 50%: {report}"
    );
    assert!(report.ends_with("not upright: "), "{report}");
}

// ---- the owner's second notes (2026-11-22): no forced walks, a van that holds both parcels, an open cab, the cameras -------------

/// "When leaving any building, there is this awkward walk the character does that's super jank and can't be skipped. The user
/// should just be outside." Through the post office's door either way: a short fade (under half a second), then the postmaster
/// stands a step from the door facing away from it, the stick theirs at once, with nowhere they are being walked to. And no scene
/// walks the postmaster anywhere: the only walk in the game's scenes is the tests' own `lead_to`.
#[test]
fn going_through_the_post_office_door_is_a_short_fade_and_no_forced_walk() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "steps": [ { "wait": 10 }, { "walk_to": [0.9, 1.7], "max": 300 },
        { "hold": ["move_y=1"], "until": "nova.current_scene() == 'valley'", "max": 120 }, { "wait": 1 } ] }"#,
    );
    let log = r.log();
    let frame = |line: &str| {
        log.iter()
            .find(|(_, l)| l.starts_with(line))
            .unwrap_or_else(|| panic!("{line}: {log:?}"))
            .0
    };
    let fade = frame("valley: entered") - frame("office: out of the door");
    assert!(fade <= 24, "out of the door in {fade} frames");
    assert_eq!(lua(&g, "nova.named('postmaster').control"), "true");
    assert_eq!(lua(&g, "tostring(nova.named('postmaster').walk_to)"), "nil");
    let d = num(
        &g,
        "(function() local p, d = nova.named('postmaster'), nova.named('office_door'); return math.sqrt((p.x - d.x)^2 + (p.z - d.z)^2) end)()",
    );
    // (at the foot of the porch since the third play's lower camera: lib/camera.lua PORCH)
    assert!((3.6..4.4).contains(&d), "out at the foot of the porch: {d}");
    let away = num(
        &g,
        "(function() local p, d = nova.named('postmaster'), nova.named('office_door'); return math.abs((p.face - (d.ry or 0) + math.pi) % (2 * math.pi) - math.pi) end)()",
    );
    assert!(away < 0.05, "facing away from the door: {away}");
    // and straight back in: the same short fade, standing just inside, free at once (the camera is behind them, looking out from the
    // building: back in is towards it, down on the stick)
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=1"], "until": "nova.current_scene() == 'office'", "max": 240 }, { "wait": 1 } ] }"#,
    );
    let log = r.log();
    let entered = log
        .iter()
        .find(|(_, l)| l.starts_with("office: entered"))
        .expect("in");
    let left = log
        .iter()
        .find(|(_, l)| l.starts_with("valley: into the office"))
        .expect("through the door");
    assert!(entered.0 - left.0 <= 24);
    assert_eq!(lua(&g, "nova.named('postmaster').control"), "true");
    assert_eq!(lua(&g, "tostring(nova.named('postmaster').walk_to)"), "nil");
    assert!(num(&g, "nova.named('postmaster').z") < num(&g, "nova.named('office_exit').z") - 0.5);
    // no scene leads the postmaster by the hand
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/mountain-post/scenes");
    for name in ["valley.lua", "office.lua", "title.lua"] {
        let text = std::fs::read_to_string(root.join(name)).unwrap();
        assert!(
            !text.contains("walk_to = {"),
            "{name} walks the postmaster somewhere"
        );
        let paths = text.matches("walk_path = ").count();
        assert!(
            paths == 0
                || (name == "valley.lua" && paths == 1 && text.contains("function Valley:lead_to")),
            "{name}: a scripted walk"
        );
        assert!(
            !text.contains("self.seq"),
            "{name}: a sequence that takes the stick"
        );
    }
}

/// "As the player approaches, the van doors automatically open with a prompt for the user that says 'load package'." The rear doors
/// swing open by themselves as the postmaster comes near the back and shut as they walk away; with a parcel in the arms the prompt
/// is "Load package", and X puts it in the hold at once (the stick never taken).
#[test]
fn the_rear_doors_open_by_themselves_and_x_loads_the_package() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.carrying = 'hazel'; S.on_shelf.hazel = false",
        "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point({ 0, 0, -6 }); p.face = nova.named('van').heading" },
        { "wait": 20, "lua": "DOORS0 = nova.named('van').back_want" },
        { "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.named('van').back_open > 0.9", "max": 60 }, { "wait": 2 } ] }"#,
    );
    assert_eq!(lua(&g, "DOORS0"), "0", "shut while the postmaster is away");
    assert!(logged(&r).iter().any(|l| l == "back doors open"));
    assert_eq!(lua(&g, "(nova.scene_now():actions())"), "load");
    assert_eq!(r.drawn_count("ui_text", Some("Load package")), 1);
    let r = play(
        &mut g,
        r#"{ "always": "nova.named('postmaster').control", "steps": [ { "press": "interact" }, { "wait": 5 } ] }"#,
    );
    assert!(
        r.warnings().iter().all(|w| !w.contains("always")),
        "{:?}",
        r.warnings()
    );
    assert!(logged(&r).iter().any(|l| l == "loaded hazel"));
    assert_eq!(lua(&g, "tostring(require('lib.state').carrying)"), "nil");
    assert_eq!(
        lua(&g, "table.concat(require('lib.state').van_load, ' ')"),
        "hazel"
    );
    // walking away, they shut
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s = nova.scene_now(); nova.named('postmaster').walk_to = { s:van_point({ 0, 0, -6 }) }" },
        { "until": "not require('lib.testkit').walking()", "max": 600 }, { "wait": 40 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "back doors shut"));
    assert!(num(&g, "nova.named('van').back_open") < 0.05);
}

/// "When going to the back of the van to pick up a package, a menu will appear where the user can press LB or RB to cycle through
/// the packages that are in the van and select which one they want to load." The van holds both of the day's parcels (two trips
/// from the shelf); at the open back with empty hands a panel shows them one at a time, L1 and R1 go round, A takes the one shown (the panel is a menu);
/// with one parcel left the panel shows it without the shoulder buttons.
#[test]
fn the_van_holds_both_parcels_and_the_panel_at_the_back_picks_one() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.carrying = 'hazel'",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():actions() == 'load'", "max": 60 }, { "press": "interact" }, { "wait": 5, "lua": "S.carrying = 'pip'" },
        { "until": "nova.scene_now():actions() == 'load'", "max": 60 }, { "press": "interact" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "require('lib.state').VAN_HOLDS"), "2");
    assert_eq!(
        lua(&g, "table.concat(require('lib.state').van_load, ' ')"),
        "hazel pip"
    );
    // the panel: the first loaded, its label, and L1 and R1 to go round
    let r = play(&mut g, r#"{ "steps": [ { "wait": 3 } ] }"#);
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel");
    assert_eq!(r.drawn_count("ui_text", Some("In the van")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("1 of 2")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("L1")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("R1")), 1);
    assert!(r.drawn_count("ui_text", Some("Hazel Brock")) >= 1);
    play(
        &mut g,
        r#"{ "steps": [ { "press": "next" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "pip");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "next" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel", "round again");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "prev" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "pip");
    // A takes the one shown, and the other stays in the van
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 3 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "unloaded pip"));
    assert_eq!(lua(&g, "require('lib.state').carrying"), "pip");
    assert_eq!(
        lua(&g, "table.concat(require('lib.state').van_load, ' ')"),
        "hazel"
    );
    // carrying one, the back offers to load it, not the panel; loaded and taken again, the panel shows the one shown
    assert_eq!(lua(&g, "(nova.scene_now():actions())"), "load");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 3 }, { "press": "next" }, { "wait": 3 }, { "press": "confirm" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "require('lib.state').carrying"), "pip");
    assert_eq!(
        lua(&g, "table.concat(require('lib.state').van_load, ' ')"),
        "hazel"
    );
    // with empty hands and one parcel in the van: the panel shows it, with no L1 and R1
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.carrying = nil; S.delivered.pip = true" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel");
    assert_eq!(r.drawn_count("ui_text", Some("In the van")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("L1")), 0);
    assert_eq!(r.drawn_count("ui_text", Some(" of ")), 0);
    // the corner cards: each parcel in the van
    assert_eq!(r.drawn_count("ui_text", Some("in the van")), 1);
}

/// "We can also make the truck have no doors." Y gets in only at the LEFT doorway (the driver's side, the van's +x), with the
/// prompt "Get in", and at once (no walk round); not at the right doorway. Getting out puts the postmaster beside the left doorway.
/// Carrying a parcel, the doorway says to load it at the back.
#[test]
fn getting_in_is_at_the_left_doorway_and_at_once() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point({ -1.2, 0, 0.26 })" },
        { "wait": 5 }, { "press": "van" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(
        lua(&g, "nova.scene_now().mode"),
        "foot",
        "not from the right side"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR)" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Get in")), 1);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "van" }, { "wait": 2 } ] }"#,
    );
    let log = r.log();
    assert!(
        log.iter().any(|(f, l)| l == "in the van" && *f <= 2),
        "{log:?}"
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "van");
    assert_eq!(lua(&g, "nova.named('postmaster').seated"), "true");
    // out again: beside the left doorway
    play(
        &mut g,
        r#"{ "steps": [ { "wait": 20 }, { "press": "van" }, { "wait": 2 } ] }"#,
    );
    let side = num(
        &g,
        "(function() local v, p = nova.named('van'), nova.named('postmaster'); local dx, dz = p.x - v.x, p.z - v.z; return dx * math.cos(v.heading) - dz * math.sin(v.heading) end)()",
    );
    assert!((1.0..1.5).contains(&side), "out on the left: {side} m");
    // carrying a parcel, the doorway does not take it in: it is loaded at the back
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "require('lib.state').carrying = 'hazel'" }, { "wait": 3 }, { "press": "van" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    assert_eq!(r.drawn_count("ui_text", Some("Load it at the back")), 1);
}

/// "When leaving the van, currently the camera is like clipped inside the van facing the player." From the moment Y is pressed,
/// for every frame of the glide and after, the camera's eye is outside the van's body and nothing solid stands between it and the
/// postmaster.
#[test]
fn the_camera_is_outside_the_van_after_getting_out() {
    let mut g = game();
    let inside = "(function() local e, v = require('lib.camera').state.eye, nova.named('van'); local s, c = math.sin(v.heading), math.cos(v.heading); \
        if e[2] > nova.terrain_height(v.x, v.z) + 2.2 then return false end; \
        for _, off in ipairs(v.BODY.offs) do if (e[1] - v.x - s * off)^2 + (e[3] - v.z - c * off)^2 < v.BODY.r^2 then return true end end; return false end)()";
    // (since the owner's second play nothing pushes the camera in: what stands between it and the postmaster is cut away round them,
    // so "clear" is the cut-away following the postmaster)
    let clear = "(function() local s, p = require('lib.camera').state.see, nova.named('postmaster'); \
        return s ~= nil and math.abs(s[1] - p.x) < 0.01 and math.abs(s[3] - p.z) < 0.01 end)()";
    for (x, z, h) in [(13.5, -170.5, 0.3), (8.0, -60.0, 0.1), (150.0, 30.0, 0.9)] {
        let plan = format!(
            r#"{{ "start_scene": "valley", "steps": [
            {{ "wait": 5, "lua": "local v = nova.named('van'); v:teleport({x}, {z}, {h}); local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in(); require('lib.camera').reset({h})" }},
            {{ "wait": 60 }}, {{ "press": "van" }},
            {{ "always": "not {inside} and {clear}", "wait": 90 }} ] }}"#
        );
        let r = play(&mut g, &plan);
        assert!(
            r.warnings().iter().all(|w| !w.contains("always")),
            "at {x}, {z}: {:?}",
            r.warnings()
        );
        assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    }
}

/// "The player should be visible through the windows of the truck also." Driving, the postmaster is drawn sitting in the cab (the
/// sit clip), at the seat as the body carries it, the steering wheel turning with the front wheels and the head into the bend.
#[test]
fn the_driver_is_drawn_in_the_seat_while_driving() {
    let mut g = game();
    g.record_drawn();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "hold": ["go", "steer=0.8"], "frames": 90 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').anim:state()"), "sit");
    let drawn = g.drawn(Some("model"), None);
    let items = drawn["items"].as_array().expect("items");
    let pm: Vec<&Value> = items.iter().filter(|i| i["name"] == "postmaster").collect();
    assert_eq!(pm.len(), 1, "the postmaster is drawn once");
    let seat_x = num(
        &g,
        "(function() local v, p = nova.named('van'), nova.named('postmaster'); local x = v:to_world(p.SEAT[1], p.SEAT[2], p.SEAT[3]); return x end)()",
    );
    let seat_z = num(
        &g,
        "(function() local v, p = nova.named('van'), nova.named('postmaster'); local _, _, z = v:to_world(p.SEAT[1], p.SEAT[2], p.SEAT[3]); return z end)()",
    );
    let (x, z) = (pm[0]["x"].as_f64().unwrap(), pm[0]["z"].as_f64().unwrap());
    assert!(
        (x - seat_x).abs() < 0.05 && (z - seat_z).abs() < 0.05,
        "drawn at the seat: {x}, {z} against {seat_x}, {seat_z}"
    );
    // on the driver's (left) side of the cab, the steering wheel and the head turned with the steering
    let side = num(
        &g,
        &format!(
            "(function() local v = nova.named('van'); return ({x} - v.x) * math.cos(v.heading) - ({z} - v.z) * math.sin(v.heading) end)()"
        ),
    );
    assert!(
        (0.1..0.6).contains(&side),
        "on the driver's side of the cab: {side}"
    );
    assert!(num(&g, "nova.named('van').steer") > 0.3);
    assert!(num(&g, "nova.named('van').parts_table.steering.ry") < -0.4);
    assert!(num(&g, "nova.named('postmaster').mood.table.head.ry").abs() > 0.1);
}

/// "When in a building, we should just have a simple top down view like Animal Crossing." In the post office the view is one fixed
/// place high over the cut-away front wall looking down into the room, whatever the postmaster does, and the stick moves them as the
/// screen shows it (up is into the room, away from the camera).
#[test]
fn the_post_office_is_seen_from_one_fixed_view_from_above() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "steps": [ { "wait": 10, "lua": "nova.named('postmaster').z = 1.5; E0 = { table.unpack(require('lib.camera').state.eye) }; Z0 = nova.named('postmaster').z" },
        { "hold": ["move_y=-1"], "frames": 40 }, { "hold": ["move_x=1"], "frames": 30 } ] }"#,
    );
    let moved = num(
        &g,
        "math.abs(require('lib.camera').state.eye[1] - E0[1]) + math.abs(require('lib.camera').state.eye[2] - E0[2]) + math.abs(require('lib.camera').state.eye[3] - E0[3])",
    );
    assert!(moved < 1e-6, "the view never moves: {moved}");
    assert!(
        num(&g, "require('lib.camera').state.eye[2]") > 6.0,
        "high over the room"
    );
    assert!(
        num(&g, "nova.named('postmaster').z") < num(&g, "Z0") - 0.5,
        "up on the stick goes into the room"
    );
}

/// "Can we cut the trees a bit? Or do it in a different way?" The valley is planted as a toy diorama is: some 400 to 600 real trees
/// in clumps by the roads and the houses (it had about 2,400), a few dozen soft forest masses where nobody goes, and the ferns and
/// grass no thicker than before to make up for it.
#[test]
fn the_valley_has_clumps_of_trees_and_forest_masses_not_thousands_of_trees() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 2 } ] }"#,
    );
    let count = |pattern: &str| {
        num(
            &g,
            &format!(
                "(function() local n = 0 for _, o in ipairs(nova.scene_data('valley').objects) do if o.kind:match('{pattern}') then n = n + 1 end end return n end)()"
            ),
        )
    };
    let trees = count("^pine") + count("^larch") + count("^birch$");
    assert!((400.0..=600.0).contains(&trees), "{trees} trees");
    let masses = count("^forest_");
    assert!((20.0..=80.0).contains(&masses), "{masses} forest masses");
    let plants = num(
        &g,
        "(function() local n = 0 for _, o in ipairs(nova.scene_data('valley').objects) do if o.kind == 'groundcover' then for _, p in ipairs(o.props.plants) do n = n + p.count end end end return n end)()",
    );
    assert!(plants <= 6360.0, "{plants} ferns, grasses and flowers");
}

// ---- the owner's second play on the Retroid (2026-11-22): one UI kit, the parcel card, the piano, a quieter bed -----------------

/// The UI pictures the game may draw: the kit (Kenney's UI Pack recoloured, sprites/ui/kit/) and the game's own painted pictures
/// that are content, not chrome (the parcel's icon, the paper map, the minimap's disc and "you" mark, the logo, the title's valley).
fn assert_ui_from_the_kit(r: &Report, where_: &str) {
    let sprites: Vec<String> = r
        .drawn("ui_sprite", None)
        .iter()
        .map(|s| s["name"].as_str().unwrap_or("").to_string())
        .collect();
    for s in &sprites {
        let ok = s.contains("ui/kit/")
            || [
                "ui/parcel_icon",
                "ui/map",
                "ui/map_720",
                "ui/minimap_disc",
                "ui/minimap_north",
                "ui/minimap_road",
                "ui/minimap_joint",
                "ui/you",
                "ui/logo",
                "ui/title_bg",
            ]
            .iter()
            .any(|n| s.ends_with(n));
        assert!(ok, "{where_}: {s:?} is not from the kit: {sprites:?}");
    }
    assert!(
        sprites.iter().any(|s| s.contains("ui/kit/")),
        "{where_}: the kit draws it: {sprites:?}"
    );
}

/// "Can we spruce up the menu UI a bit? ... a cohesive theme that we can use." Every piece of UI on the screen is drawn from the
/// one kit: the title, the prompts on foot and driving, the parcel card, the van's panel, the label, the letter, the map, the
/// pause menu, both residents' dialogue and the end card. No scene or card draws a rectangle of its own any more (lib/ui.lua
/// does, for a panel's soft shadow, a dimming and a fade), and the kit's pictures are in the game with the pack's licence.
#[test]
fn every_piece_of_ui_is_drawn_from_the_one_kit() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "title", "steps": [ { "wait": 100 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the title");
    assert_eq!(r.drawn_count("ui_text", Some("Start")), 1);
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "local S = require('lib.state'); S.carrying = 'hazel'; S.van_load = { 'pip' }", "steps": [ { "wait": 20 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "on foot");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "map" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the paper map");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "map" }, { "wait": 20 } ] }"#,
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "pause" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the pause menu");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 20 } ] }"#,
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "driving");
    assert_eq!(r.drawn_count("ui_text", Some("Get out")), 1);
    // a conversation with each: the name on a key of the kit over the box
    for (who, name, x, z) in [("hazel", "Hazel", 150, 36), ("pip", "Pip", -178, 100)] {
        let mut g = game();
        let r = play(
            &mut g,
            &format!(
                r#"{{ "start_scene": "valley", "lua": "require('lib.state').carrying = '{who}'", "steps": [
                {{ "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = {x}, {z}" }},
                {{ "walk_to": "{who}", "max": 600 }}, {{ "until": "nova.scene_now():resident_near() ~= nil", "max": 200 }},
                {{ "press": "interact" }}, {{ "wait": 90 }} ] }}"#
            ),
        );
        assert_ui_from_the_kit(&r, who);
        assert_eq!(r.drawn_count("ui_text", Some(name)), 1, "{who}'s name tag");
        assert!(r.drawn_count("ui_sprite", Some("ui/kit/raised")) >= 1);
    }
    // the office: the letter, a label, the end card
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "steps": [ { "wait": 20 }, { "walk_to": [0.9, 0.35], "max": 300 }, { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the letter");
    assert!(r.drawn_count("ui_sprite", Some("ui/kit/rule")) >= 1);
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('pip')" }, { "until": "not T.walking()", "max": 400 },
        { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the label");
    assert!(r.drawn_count("ui_sprite", Some("ui/kit/slip")) >= 1);
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "local s = require('lib.state'); s.delivered.hazel = true; s.delivered.pip = true; s.on_shelf.hazel = false; s.on_shelf.pip = false; s.came_out = true; nova.goto_scene('office')", "steps": [
        { "until": "require('lib.cards').kind() == 'ending'", "max": 300 }, { "wait": 200 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the end card");
    assert_eq!(
        r.drawn_count("ui_text", Some("Two delivered. A few hundred to go.")),
        1
    );
    // the kit's pictures and the pack's licence travel with the game
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for f in [
        "panel",
        "panel_down",
        "raised",
        "pressed",
        "round",
        "round_down",
        "slip",
        "rule",
        "chev_l",
        "chev_r",
    ] {
        assert!(
            root.join(format!("{GAME}/sprites/ui/kit/{f}.png"))
                .is_file(),
            "{f}.png"
        );
    }
    let licence = std::fs::read_to_string(root.join(format!("{GAME}/licenses/kenney-ui-pack.txt")))
        .expect("the game's copy of the pack's licence");
    assert!(
        licence.contains("Creative Commons Zero")
            && licence.contains("button_rectangle_depth_flat")
    );
    assert_eq!(
        licence,
        std::fs::read_to_string(root.join("licenses/kenney-ui-pack.txt")).unwrap()
    );
    for f in [
        "lib/cards.lua",
        "lib/dialogue.lua",
        "scenes/title.lua",
        "scenes/valley.lua",
        "scenes/office.lua",
    ] {
        let text = std::fs::read_to_string(root.join(format!("{GAME}/{f}"))).unwrap();
        assert!(
            !text.contains("nova.ui.rect"),
            "{f} draws through lib/ui.lua"
        );
    }
}

/// "Instead of listing all the active packages in the top left, the user should be able to scroll through them with LB/RB
/// assuming they're not in the van storage menu." One card in the corner shows one parcel on the go (carried first, then those
/// in the van), where it is, and with more than one "1 of 2" and L1 / R1; L1 and R1 go round them on foot and driving. At the
/// van's open back the panel has L1 and R1: the card fades back without its count or buttons and stays on its parcel; in a
/// conversation it is hidden.
#[test]
fn one_corner_card_goes_round_the_parcels_with_l1_and_r1() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.carrying = 'hazel'; S.van_load = { 'pip' }",
        "steps": [ { "wait": 20 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Hazel Brock")), 1);
    assert_eq!(
        r.drawn_count("ui_text", Some("Pip Tansy")),
        0,
        "one card, not a stack"
    );
    assert_eq!(r.drawn_count("ui_text", Some("carrying")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("1 of 2")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("L1")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("R1")), 1);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "next" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Pip Tansy")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("in the van")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("2 of 2")), 1);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "next" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(
        r.drawn_count("ui_text", Some("Hazel Brock")),
        1,
        "round again"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "prev" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Pip Tansy")), 1);
    // driving, too
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }, { "wait": 10 }, { "press": "next" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Hazel Brock")), 1);
    // one parcel: the card shows it, with no count and no buttons; none: no card
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.van_load = {}" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Hazel Brock")), 1);
    assert_eq!(r.drawn_count("ui_text", Some(" of ")), 0);
    assert_eq!(r.drawn_count("ui_text", Some("L1")), 0);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.carrying = nil" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("Hazel Brock")), 0);
    // at the van's open back with both in it: the panel has L1 and R1, the card does not move
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "S = require('lib.state'); T = require('lib.testkit'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.van_load = { 'hazel', 'pip' }",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 }, { "until": "nova.scene_now():picker() ~= nil", "max": 120 }, { "wait": 5 } ] }"#,
    );
    let shown = lua(&g, "require('lib.parcels').current().which");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "next" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(
        lua(&g, "nova.scene_now():picker()"),
        "pip",
        "R1 is the panel's"
    );
    assert_eq!(
        lua(&g, "require('lib.parcels').current().which"),
        shown,
        "the card stays on its parcel"
    );
    assert_eq!(
        r.drawn_count("ui_text", Some(" of ")),
        1,
        "only the panel counts"
    );
    assert_eq!(r.drawn_count("ui_text", Some("L1")), 1);
    // in a conversation the card is hidden and L1 / R1 do nothing to it
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "S = require('lib.state'); S.carrying = 'hazel'; S.van_load = { 'pip' }", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 36" },
        { "walk_to": "hazel", "max": 600 }, { "until": "nova.scene_now():resident_near() ~= nil", "max": 200 },
        { "press": "interact" }, { "wait": 30, "lua": "SHOWN = require('lib.parcels').current().which" }, { "press": "next" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(r.drawn_count("ui_text", Some("in the van")), 0);
    assert_eq!(r.drawn_count("ui_text", Some(" of ")), 0);
    assert_eq!(
        lua(&g, "require('lib.parcels').current().which"),
        lua(&g, "SHOWN")
    );
}

/// "If there is only one item in the van, the menu should still pop up to show what's there." Walking from the doorway round to
/// the back with one parcel in the van, the panel opens with the doors (it used to wait until the postmaster stood at the bumper,
/// 1.35 m from the spot behind the van, while the doors had swung open at 2.1 m), and shows the parcel without a count.
#[test]
fn the_vans_panel_opens_with_the_doors_for_a_single_parcel() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "S = require('lib.state'); T = require('lib.testkit'); S.on_shelf.hazel = false; S.van_load = { 'hazel' }",
        "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR)" },
        { "wait": 5, "lua": "local s = nova.scene_now(); local x, z = s:van_point({ 1.0, 0, -2.4 }); local bx, bz = s:van_point(s.BACK); local p = nova.named('postmaster'); p.walk_path = { { x, z }, { bx, bz } }; p.walk_to = nil; p.walk_pace = 0.8" },
        { "until": "nova.scene_now():picker() ~= nil", "max": 600 } ] }"#,
    );
    let at = num(&g, "nova.scene_now():to_back()");
    assert!(
        (1.35..2.1).contains(&at),
        "the panel opened {at} m from the back, as the doors swung open"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "until": "not T.walking()", "max": 300 }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel");
    assert_eq!(r.drawn_count("ui_text", Some("In the van")), 1);
    assert_eq!(
        r.drawn_count("ui_text", Some("Hazel Brock")),
        2,
        "the panel and the faded card"
    );
    assert_eq!(r.drawn_count("ui_text", Some(" of ")), 0);
    assert_eq!(r.drawn_count("ui_text", Some("Take")), 1);
}

/// "The music is a little repetitive. Can we use piano?" The one piece is for piano alone (Nova's `piano` instrument: struck
/// strings, felt-muted), two hands and no drums; it plays a short intro once and then loops for over two and a half minutes
/// through sections that come back changed (A A' B A'' C B' A'''), with rests in the tune, bars without it, and a level that
/// rises and falls; the tempo only ever eases below its own.
#[test]
fn the_song_is_a_long_piano_piece_in_sections() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let song: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(format!("{GAME}/music/fernhollow.song.json"))).unwrap(),
    )
    .unwrap();
    let tracks = song["tracks"].as_array().unwrap();
    assert!(!tracks.is_empty());
    // (the piano is the stem that always plays: its two hands; the layers that join while driving are tested at the end)
    for t in tracks
        .iter()
        .filter(|t| t["name"] == "right hand" || t["name"] == "left hand")
    {
        assert_eq!(t["kind"], "synth", "no drums");
        assert_eq!(t["wave"], "piano", "{}", t["name"]);
        assert!(
            t["brightness"].as_f64().unwrap() < 0.5,
            "a soft, felt piano"
        );
    }
    let spb = song["stepsPerBeat"].as_f64().unwrap();
    let bpm = song["bpm"].as_f64().unwrap();
    let (from, to) = (
        song["loop"]["from"].as_f64().unwrap(),
        song["loop"]["to"].as_f64().unwrap(),
    );
    assert!(from > 0.0, "an intro that plays once");
    assert_eq!(to, song["length"].as_f64().unwrap());
    let seconds = (to - from) / spb * 60.0 / bpm;
    assert!(seconds >= 150.0, "the loop is {seconds} s");
    for t in song["tempos"].as_array().unwrap() {
        assert!(t["bpm"].as_f64().unwrap() <= bpm);
    }
    let names: Vec<&str> = song["markers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();
    for s in ["A", "A'", "B", "A''", "C", "B'", "A'''"] {
        assert!(names.contains(&s), "the section {s}: {names:?}");
    }
    let right = tracks[0]["notes"].as_array().unwrap();
    let bar = 4.0 * spb;
    let mut quiet_bars = 0;
    let mut b = from;
    while b < to {
        if !right
            .iter()
            .any(|n| (b..b + bar).contains(&n["step"].as_f64().unwrap()))
        {
            quiet_bars += 1;
        }
        b += bar;
    }
    assert!(quiet_bars >= 2, "{quiet_bars} bars without the tune");
    let (lo, hi) = right
        .iter()
        .map(|n| n["vel"].as_f64().unwrap())
        .fold((1.0f64, 0.0f64), |(a, b), v| (a.min(v), b.max(v)));
    assert!(hi - lo > 0.25, "the level rises and falls: {lo} to {hi}");
    assert!(
        root.join(format!("{GAME}/music/fernhollow_piano.ogg"))
            .is_file()
    );
}

/// "I think the ambiance is a little loud at times." The bed is steady: the creek's level eases when the camera jumps (from the
/// post office's yard to the creek's bridge in one frame), never more than a small step a frame, and is heard on the bridge;
/// birds never call two at once; the levels are the measured ones (tools/ambience.mjs: under -30 LUFS over any three seconds
/// everywhere it was rendered; docs/games/mountain-post.md, "Sound levels").
#[test]
fn the_ambience_eases_and_never_jumps() {
    let mut g = game();
    let expr = "math.floor(1000 * require('lib.ambience').creek_volume())";
    let r = play(
        &mut g,
        &format!(
            r#"{{ "start_scene": "valley", "steps": [ {{ "wait": 30 }},
            {{ "wait": 150, "lua": "local p = nova.named('postmaster'); p.x, p.z = -105, 55.2; require('lib.camera').reset(1.57)", "record": "{expr}" }},
            {{ "wait": 1800 }} ] }}"#
        ),
    );
    let runs = r.record(expr);
    assert!(runs.len() > 3, "the creek's level was recorded: {runs:?}");
    let values: Vec<f64> = runs.iter().map(|(_, _, v)| v.parse().unwrap()).collect();
    for w in values.windows(2) {
        assert!(
            (w[1] - w[0]).abs() <= 12.0,
            "a step of {} thousandths in a frame: {runs:?}",
            w[1] - w[0]
        );
    }
    assert!(
        *values.last().unwrap() > 20.0,
        "on the bridge the creek is heard: {runs:?}"
    );
    assert!(num(&g, "require('lib.ambience').LEVEL.air") <= 0.3);
    let starts: Vec<u64> = r.json["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| {
            let t = s["text"].as_str()?;
            if t.starts_with("sound bird_") {
                s["frame"].as_u64()
            } else {
                None
            }
        })
        .collect();
    assert!(starts.len() >= 5, "birds call: {starts:?}");
    for w in starts.windows(2) {
        assert!(w[1] - w[0] >= 130, "two birds at once: {starts:?}");
    }
}

// ---- the owner's second play on the Retroid (2026-11-22): the van, the walk, the camera, the stutter, the prompts ----------------

/// "the van can be slower to start and wait for the upgrades to be faster." The starting van's numbers are one table (Van.TUNE);
/// at full throttle on the road (held in place, so nothing but its own pull, rolling and air count) it pulls away leisurely and
/// tops out near 10.5 m/s, not the old 16.
#[test]
fn the_starting_van_is_slow_to_pull_away_and_tops_out_near_ten_and_a_half() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); v:teleport(4.5, -150, 0); v.driven = true; v.ctl.go, v.ctl.brake, v.ctl.steer = 1, 0, 0; \
         local t30; for i = 1, 2400 do v:drive(1 / 60); v.x, v.z, v.heading = 4.5, -150, 0; if not t30 and v.speed >= 8.33 then t30 = i / 60 end end; \
         return string.format('%.3f %.3f %s', v.speed, t30 or -1, v.surface) end)()",
    );
    let parts: Vec<&str> = out.split(' ').collect();
    let (top, t30): (f64, f64) = (parts[0].parse().unwrap(), parts[1].parse().unwrap());
    assert!((9.8..=11.2).contains(&top), "top speed {top} m/s ({out})");
    assert!(
        (4.0..=9.0).contains(&t30),
        "0 to 30 km/h in {t30} s ({out})"
    );
    // the numbers live in one named table, for the upgrades to raise
    for key in [
        "power",
        "top",
        "brake",
        "steer_speed",
        "yaw_lag",
        "lock_fast",
        "corner",
    ] {
        assert!(
            num(&g, &format!("nova.named('van').TUNE.{key}")) > 0.0,
            "Van.TUNE.{key}"
        );
    }
}

/// "The turning is too aggressive and doesn't feel like there's actual weight to it." A flick of the stick turns the wheels in no
/// faster than Van.TUNE.steer_speed a second (coming back is quicker since the third play: a test at the end); at speed the stick gives less lock; the body's turning follows the wheels over a
/// moment (no jump in the yaw rate); a bend taken fast runs wide (the sideways pull stays near Van.TUNE.corner) rather than darting.
#[test]
fn the_vans_steering_is_rate_limited_less_at_speed_and_the_body_takes_a_moment() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local T = v.TUNE; v:teleport(4.5, -150, 0); v.driven = true; \
         local function hold(go, steer, n) local w = { steer = 0, yaw = 0, side = 0 }; for i = 1, n do local s0, y0 = v.steer, v.yaw_rate or 0; v.ctl.go, v.ctl.brake, v.ctl.steer = go, 0, steer; v:drive(1 / 60); v.x, v.z = 4.5, -150; \
           w.steer = math.max(w.steer, math.abs(v.steer - s0)); w.yaw = math.max(w.yaw, math.abs((v.yaw_rate or 0) - y0)); w.side = math.max(w.side, math.abs((v.yaw_rate or 0) * v.speed)) end; return w end; \
         hold(1, 0, 1800); local fast = v.speed; local a = hold(1, -1, 240); local lock_fast = math.abs(v.steer); local b = hold(1, 1, 120); \
         v:teleport(4.5, -150, 0); v.driven = true; hold(0.25, 0, 60); local c = hold(0.25, -1, 240); local lock_slow = math.abs(v.steer); \
         return string.format('%.3f %.5f %.5f %.3f %.3f %.3f %.3f %.3f', fast, math.max(a.steer, c.steer), math.max(a.yaw, c.yaw), lock_fast, lock_slow, a.side, T.steer_speed, T.corner) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    let (fast, steer_step, yaw_step, lock_fast, lock_slow, side, steer_speed, corner) =
        (v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    assert!(fast > 9.5, "at speed: {out}");
    // (at a crawl the wheels go over further since the fifth play, Van.TUNE.lock_slow, and a little quicker, `slow_steer` times, so
    // full lock still takes about a second there)
    let slow_steer = num(&g, "nova.named('van').TUNE.slow_steer");
    assert!(
        steer_step <= steer_speed * slow_steer / 60.0 + 1e-6,
        "the wheels move at most {steer_speed} (x {slow_steer} at a crawl) of full lock a second: a step of {steer_step} ({out})"
    );
    assert!(
        lock_fast < 0.65 && lock_slow > 0.9,
        "less lock at speed ({lock_fast}) than at a crawl ({lock_slow})"
    );
    assert!(
        yaw_step < 0.03,
        "the body's turning eases (largest change of yaw rate in a frame {yaw_step} rad/s)"
    );
    assert!(
        side < corner + 1.5,
        "a full-lock bend at speed runs wide: sideways pull {side} m/s^2 (corner {corner})"
    );
}

/// "The back doors look like a bunch of rectangles just stuck together, not a solid door." "It seems too tall still." Each rear
/// door is one solid panel (one shape, with its window cut into it) on a leaf part, with a handle and hinges; the van is squat:
/// its parts under 1.7 m, and the seated postmaster's head in the cab, under the roof.
#[test]
fn the_van_is_squat_and_each_rear_door_is_one_solid_panel() {
    let model = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/mountain-post/models/van.model.json"),
    )
    .unwrap();
    let model: Value = serde_json::from_str(&model).unwrap();
    fn find<'a>(parts: &'a [Value], name: &str) -> Option<&'a Value> {
        for p in parts {
            if p["name"] == name {
                return Some(p);
            }
            if let Some(children) = p["children"].as_array()
                && let Some(f) = find(children, name)
            {
                return Some(f);
            }
        }
        None
    }
    let parts = model["parts"].as_array().unwrap();
    for side in ["l", "r"] {
        let leaf = find(parts, &format!("door_{side}_leaf")).expect("a leaf");
        let cubes = leaf["cubes"].as_array().unwrap();
        let panels = cubes
            .iter()
            .filter(|c| {
                c["shape"] == "mesh"
                    && c["modifiers"]
                        .as_array()
                        .is_some_and(|m| m.iter().any(|m| m["type"] == "cutout"))
            })
            .count();
        assert_eq!(panels, 1, "door_{side}: one panel with its window cut in");
        assert!(
            cubes.len() <= 3,
            "door_{side}'s leaf is the panel, its pane and a handle: {} shapes",
            cubes.len()
        );
    }
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let high = num(
        &g,
        "(function() local top = 0 for _, p in pairs(nova.model_pose('van')) do if p.y > top then top = p.y end end return top end)()",
    );
    assert!(high < 1.75, "the van's parts all sit under 1.75 m: {high}");
    // the seated driver's head and cap: the top of the figure standing is as far over its head's joint as it is seated, and that is
    // under the cab's lining (the roof 1.6 m, its lining 1.48: tools/van.mjs since the third play)
    let top = num(
        &g,
        "(function() local P = nova.named('postmaster'); local sit = nova.model_pose('postmaster', { clip = 'sit', time = 0 }); local rest = nova.model_pose('postmaster'); \
         return P.SEAT[2] + sit.head.y + (1.04 - rest.head.y) end)()",
    );
    assert!(
        (1.2..1.48).contains(&top),
        "the driver's cap ({top} m) is in the cab, under the lining"
    );
}

/// "the animation needs to slow down a bit and the player should be able to move faster." At the top of each gait the clip plays
/// at the pace at which its feet keep to the ground (the ankles' backward speed, measured from the poses, against the speed: the
/// same share as character3d_make's own slide-free walk), each cycle is calmer than before, and the residents walk the same way.
#[test]
fn the_feet_do_not_slide_at_the_new_speeds_and_the_steps_are_calmer() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -125, 0; require('lib.camera').reset(0)" } ] }"#,
    );
    // (character3d_make's walk, slide-free at 0.767 m/s by its answer, measures 0.629 m/s of ankle: the sole's roll is the rest)
    let share = 0.629 / 0.767;
    let mut seen = Vec::new();
    // (the stick alone walks; B held runs, or trots with a parcel)
    for (push, carry, gait, old_cycle) in [
        ("move_y=-1", false, "walk", 0.373),
        ("move_y=-1\", \"run", false, "run", 0.228),
        ("move_y=-1\", \"run", true, "trot", 0.275),
    ] {
        let lua_carry = if carry { "'hazel'" } else { "nil" };
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "require('lib.state').carrying = {lua_carry}" }}, {{ "hold": ["{push}"], "frames": 90 }} ] }}"#
            ),
        );
        assert_eq!(lua(&g, "nova.named('postmaster').gait"), gait);
        let speed = num(&g, "nova.named('postmaster').speed");
        let rate = num(&g, "nova.named('postmaster').anim.speed");
        let ankle = num(
            &g,
            &format!("(require('lib.testkit').foot_speed('postmaster', '{gait}'))"),
        );
        let duration = num(
            &g,
            &format!("select(2, require('lib.testkit').foot_speed('postmaster', '{gait}'))"),
        );
        let feet = ankle / share * rate;
        assert!(
            (feet - speed).abs() / speed < 0.06,
            "{gait}: the feet go back at {feet} m/s under a body going {speed}"
        );
        let cycle = duration / rate;
        assert!(
            cycle > old_cycle * 1.08,
            "{gait}: a step cycle of {cycle} s at {speed} m/s, calmer than the old {old_cycle} s"
        );
        seen.push((gait, speed));
        play(
            &mut g,
            r#"{ "steps": [ { "lua": "require('lib.state').carrying = nil" }, { "wait": 40 } ] }"#,
        );
    }
    assert!(
        seen[0].1 > 1.5 && seen[1].1 > 2.8 && seen[2].1 > 2.1,
        "{seen:?}"
    );
    // the soles stay on the ground through each cycle (the lower foot within 2.5 cm of it: no sinking at the end of a long step)
    for clip in ["walk", "run", "trot"] {
        let low = num(
            &g,
            &format!(
                "(function() local d; for _, k in ipairs(nova.model_clips('postmaster')) do if k.name == '{clip}' then d = k.duration end end; \
                 local lo = 1; for i = 0, 31 do local p = nova.model_pose('postmaster', {{ clip = '{clip}', time = d * i / 32 }}); lo = math.min(lo, p.foot_l.low, p.foot_r.low) end; return lo end)()"
            ),
        );
        assert!(low > -0.025, "{clip}: a sole sinks {low} m into the ground");
    }
    for who in ["hazel", "pip"] {
        let ankle = num(
            &g,
            &format!("(require('lib.testkit').foot_speed('{who}', 'walk'))"),
        );
        // their walk plays at its own pace (the animator's rate 1) at their walking speed, 1.6 m/s
        assert!(
            ((ankle / share) - 1.6).abs() < 0.1,
            "{who}'s walk does not slide at 1.6 m/s: {}",
            ankle / share
        );
    }
}

/// The camera, one rule on foot and in the van (the owner: "the player can orbit the camera but as the player drives it'll drift
/// back to the rear view"): it stays where the right stick put it while the postmaster stands, and for a moment after the stick is
/// let go even while moving; then, moving, it drifts back behind the way of travel, its turn never faster than the drift's limit;
/// a turn on the spot hardly moves it.
#[test]
fn the_camera_holds_where_it_was_put_then_drifts_behind_slowly_while_moving() {
    let mut g = game();
    let yaw = "require('lib.camera').state.yaw";
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -150, math.pi / 2; require('lib.camera').reset(math.pi / 2)" },
        { "wait": 20 }, { "hold": ["look_x=1"], "frames": 36 }, { "wait": 30 } ] }"#,
    );
    let orbited = num(&g, yaw);
    assert!(
        (orbited - std::f64::consts::FRAC_PI_2).abs() > 1.0,
        "the stick orbits it: {orbited}"
    );
    // standing: it stays put, however long
    play(&mut g, r#"{ "steps": [ { "wait": 300 } ] }"#);
    assert!(
        (num(&g, yaw) - orbited).abs() < 1e-6,
        "standing, the camera stays where it was put"
    );
    // a touch more of the stick, then running off along +x: for a moment it still stays put, then it comes round behind them, never
    // faster than its limit
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["look_x=0.5"], "frames": 4 }, { "wait": 25 } ] }"#,
    );
    let put = num(&g, yaw);
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); p.walk_pace = 2.8; p.walk_to = { p.x + 60, p.z }" }, { "wait": 40 } ] }"#,
    );
    assert!(
        (num(&g, yaw) - put).abs() < 1e-6,
        "just after the stick, moving, it waits"
    );
    let r = play(
        &mut g,
        r#"{ "each_frame": "PY = require('lib.camera').state.yaw",
        "always": "math.abs((require('lib.camera').state.yaw - PY + math.pi) % (2 * math.pi) - math.pi) <= require('lib.camera').FOOT.rate / 60 + 1e-6",
        "steps": [ { "wait": 600 } ] }"#,
    );
    assert!(
        r.warnings().iter().all(|w| !w.contains("always")),
        "{:?}",
        r.warnings()
    );
    let behind = num(
        &g,
        &format!("math.abs(({yaw} - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi)"),
    );
    assert!(
        behind < 0.3,
        "it came round behind the way of travel: {behind} rad off"
    );
    // turning on the spot leaves it nearly still
    let before = num(&g, yaw);
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); p.walk_to = nil; p.walk_path = nil" }, { "wait": 60 },
        { "hold": ["move_y=1"], "frames": 8 }, { "hold": ["move_x=-1"], "frames": 8 }, { "hold": ["move_y=-1"], "frames": 8 }, { "wait": 60 } ] }"#,
    );
    let turned = (num(&g, yaw) - before).abs();
    assert!(
        turned < 0.08,
        "a turn on the spot hardly moves it: {turned} rad"
    );
}

/// Driving, the same rule, quicker: orbited round to the side, the view comes back behind the van as it drives on.
#[test]
fn driving_the_camera_returns_to_the_rear_view_after_orbiting() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 5, "lua": "T.board(); T.drive('hazel')" }, { "wait": 400 }, { "hold": ["look_x=1"], "frames": 45 } ] }"#,
    );
    let off = "math.abs((require('lib.camera').state.yaw - nova.named('van').heading + math.pi) % (2 * math.pi) - math.pi)";
    let side = num(&g, off);
    assert!(side > 1.0, "the stick orbits the driving view: {side} rad");
    assert!(num(&g, "nova.named('van').speed") > 3.0);
    play(&mut g, r#"{ "steps": [ { "wait": 360 } ] }"#);
    let back = num(&g, off);
    assert!(back < 0.3, "back behind the van: {back} rad off");
}

/// "If I just walk around in a circle, there is quite a bit of stutter." The cause was the camera's swing-behind: walking round, it
/// followed the facing, stopped dead the moment the way of walking came to face it (a 0.7 s wait), then set off again at once at a
/// fixed turn (and its boom snapped in at anything in the way). Now, walking a circle (the stick turned steadily round), without and
/// with the right stick, the postmaster's step, the eye's step and the camera's turn each change smoothly from one frame to the next.
#[test]
fn walking_a_circle_moves_the_postmaster_and_the_camera_smoothly() {
    let mut g = game();
    let setup = r#""lua": "STICK = 0; local orig = nova.input.axis; nova.input.axis = function(n) if STICK_ON and n == 'move_x' then return math.cos(STICK) elseif STICK_ON and n == 'move_y' then return math.sin(STICK) end return orig(n) end; T = require('lib.testkit')",
        "each_frame": "if STICK_ON then STICK = STICK + 0.03 end""#;
    let r = play(
        &mut g,
        &format!(
            r#"{{ "start_scene": "valley", {setup}, "steps": [
            {{ "wait": 10, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -150, 0; require('lib.camera').reset(0)" }},
            {{ "wait": 20, "lua": "STICK_ON = true" }},
            {{ "wait": 30 }},
            {{ "always": "T.smooth_step({{ body = 0.004, eye = 0.006, yaw = 0.0012 }})", "wait": 600 }},
            {{ "lua": "T.prev, T.step = nil, nil" }},
            {{ "always": "T.smooth_step({{ body = 0.004, eye = 0.09, yaw = 0.006 }})", "hold": ["look_x=0.6"], "frames": 120 }},
            {{ "always": "T.smooth_step({{ body = 0.004, eye = 0.09, yaw = 0.006 }})", "wait": 240 }} ] }}"#
        ),
    );
    assert!(
        r.warnings().iter().all(|w| !w.contains("always")),
        "{:?} worst {}",
        r.warnings(),
        lua(
            &g,
            "string.format('%.5f %.5f %.5f', T.worst.body, T.worst.eye, T.worst.yaw)"
        )
    );
    assert!(num(&g, "T.worst.yaw") > 0.0, "the camera did turn");
}

/// "If I'm close to the van trying to get the package, I only get an option to 'knock' even though 1 I'm not at a door, 2 I'm not
/// trying to talk to the person." With the van parked right by Hazel: at its open back the prompt is the van's (load, or the panel),
/// at its doorway it is Y to get in and nothing on X; a step away, facing her, it is Talk (or Hand over with her parcel); turned
/// away, nothing; Knock only at a front door with the resident indoors.
#[test]
fn at_the_van_the_vans_prompts_win_over_a_resident_near() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "nova.named('postmaster').x, nova.named('postmaster').z = 150, 36" },
        { "wait": 120 },
        { "lua": "local h, v, s = nova.named('hazel'), nova.named('van'), nova.scene_now(); v:teleport(h.meet[1], h.meet[2] + 3.7, 0); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.BACK); p.face = math.pi; require('lib.state').carrying = 'pip'" },
        { "wait": 60 } ] }"#,
    );
    let actions = "(function() local a, b, r = nova.scene_now():actions(); return tostring(a) .. ' ' .. tostring(b) .. ' ' .. (r and r.who or '-') end)()";
    let hazel_d = num(
        &g,
        "math.sqrt((nova.named('hazel').x - nova.named('postmaster').x)^2 + (nova.named('hazel').z - nova.named('postmaster').z)^2)",
    );
    assert!(
        hazel_d < 2.4,
        "Hazel stands within talking reach: {hazel_d} m"
    );
    assert_eq!(lua(&g, actions), "load nil -", "with a parcel at the back");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s = require('lib.state'); s.carrying = nil; s.van_load = { 'pip' }" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, actions), "pick nil -", "empty-handed at the back");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local s, p = nova.scene_now(), nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); p.face = math.pi" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, actions), "nil get_in -", "at the doorway");
    // a step towards her, facing her: Talk (her parcel in hand: Hand over)
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local h, p = nova.named('hazel'), nova.named('postmaster'); p.x, p.z = h.x + 1.3, h.z; p.face = math.atan(h.x - p.x, h.z - p.z)" }, { "wait": 1 } ] }"#,
    );
    assert_eq!(lua(&g, actions), "talk nil hazel");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "require('lib.state').carrying = 'hazel'" }, { "wait": 1 } ] }"#,
    );
    assert_eq!(lua(&g, actions), "give nil hazel");
    // turned away from her, nothing to say
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "require('lib.state').carrying = nil; local p = nova.named('postmaster'); p.face = p.face + math.pi" }, { "wait": 1 } ] }"#,
    );
    assert_eq!(lua(&g, actions), "nil nil -");
    // Knock: at her front door, only while she is indoors
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local d, p = nova.named('door_hazel'), nova.named('postmaster'); p.x, p.z = d.x - 0.6, d.z - 0.6" }, { "wait": 1 } ] }"#,
    );
    assert!(!lua(&g, actions).starts_with("knock"));
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "nova.named('hazel').outside = false" }, { "wait": 1 } ] }"#,
    );
    assert!(
        lua(&g, actions).starts_with("knock"),
        "{}",
        lua(&g, actions)
    );
}

/// "they keep following me." A resident comes a couple of steps from their work towards their gate, turns to the postmaster and
/// stays there, wherever the postmaster walks about near them.
#[test]
fn residents_meet_the_postmaster_at_their_gate_and_do_not_follow() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 41" }, { "wait": 150 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('hazel').mode"), "meet");
    let at_meet = "(function() local h = nova.named('hazel'); return math.sqrt((h.x - h.meet[1])^2 + (h.z - h.meet[2])^2) end)()";
    assert!(num(&g, at_meet) < 0.25, "she has come to her meeting place");
    let from_home = "(function() local h = nova.named('hazel'); return math.sqrt((h.x - h.home[1])^2 + (h.z - h.home[2])^2) end)()";
    // the postmaster wanders round her, near and further, for some 20 seconds: she stays put
    let r = play(
        &mut g,
        r#"{ "always": "(function() local h = nova.named('hazel'); return math.sqrt((h.x - h.meet[1])^2 + (h.z - h.meet[2])^2) < 0.3 end)()",
        "steps": [ { "lua": "local h, p = nova.named('hazel'), nova.named('postmaster'); p.walk_pace = 2.6; p.walk_path = { { h.x + 4, h.z - 3 }, { h.x - 4, h.z - 5 }, { h.x - 5, h.z + 2 }, { h.x + 3, h.z + 4 }, { h.x + 6, h.z }, { h.x + 1.5, h.z + 0.5 } }; p.walk_to = nil" },
        { "until": "not require('lib.testkit').walking()", "max": 1200 }, { "wait": 60 } ] }"#,
    );
    assert!(
        r.warnings().iter().all(|w| !w.contains("always")),
        "she followed: {:?}",
        r.warnings()
    );
    assert!(num(&g, from_home) < 2.1);
    let off = num(
        &g,
        "(function() local h, p = nova.named('hazel'), nova.named('postmaster'); return math.abs((math.atan(p.x - h.x, p.z - h.z) - h.face + math.pi) % (2 * math.pi) - math.pi) end)()",
    );
    assert!(off < 0.3, "she faces the postmaster: {off} rad off");
}

/// "The game shouldn't pause when dealing with the van storage, just have the menu fade up." The panel at the van's open back is
/// a light overlay: it fades up (about 0.2 s) when the postmaster comes to the back with empty hands and parcels inside, and away
/// when they walk off; the stick, the clock and the world carry on the whole time.
#[test]
fn the_van_panel_is_a_light_overlay_the_postmaster_keeps_walking_through() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.van_load = { 'hazel', 'pip' }; S.carrying = nil",
        "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local v = nova.named('van'); local p = nova.named('postmaster'); p.x, p.z = s:van_point({ 0, 0, -2.2 }); p.face = v.heading + math.pi; require('lib.camera').reset(p.face)" },
        { "wait": 3 } ] }"#,
    );
    // just come to the back: the panel is on its way up, and has not been waited for
    let a0 = num(&g, "nova.scene_now().picker_a");
    assert!(
        a0 > 0.0 && a0 < 0.4,
        "the panel starts to fade up at once: {a0}"
    );
    play(&mut g, r#"{ "steps": [ { "wait": 15 } ] }"#);
    assert!(num(&g, "nova.scene_now().picker_a") > 0.99, "up in ~0.2 s");
    assert_eq!(lua(&g, "(nova.scene_now():picker())"), "hazel");
    let p0 = (
        num(&g, "nova.named('postmaster').x"),
        num(&g, "nova.named('postmaster').z"),
    );
    // walking on with the stick, with the panel shown: nothing locks, the postmaster moves, the clock and time scale are untouched
    let r = play(
        &mut g,
        r#"{ "always": "nova.named('postmaster').control and nova.time_scale() == 1", "steps": [
        { "lua": "SEEN = 0; T0 = nova.time()" },
        { "hold": ["move_y=-0.8"], "frames": 20, "lua": "if nova.scene_now().picker_a > 0.5 then SEEN = SEEN + 1 end" },
        { "lua": "X1 = { nova.named('postmaster').x, nova.named('postmaster').z }; A1 = nova.scene_now().picker_a; T1 = nova.time()" },
        { "hold": ["move_y=-0.8"], "frames": 12 } ] }"#,
    );
    assert!(
        r.warnings().iter().all(|w| !w.contains("always")),
        "{:?}",
        r.warnings()
    );
    let p1 = (num(&g, "X1[1]"), num(&g, "X1[2]"));
    assert!(
        ((p1.0 - p0.0).powi(2) + (p1.1 - p0.1).powi(2)).sqrt() > 0.15,
        "the postmaster walked while the panel was up: {p0:?} to {p1:?}"
    );
    assert!(
        num(&g, "A1") > 0.5,
        "still shown a moment later: {}",
        num(&g, "A1")
    );
    assert!(num(&g, "SEEN") >= 1.0);
    assert!(
        (num(&g, "T1") - num(&g, "T0") - 20.0 / 60.0).abs() < 0.03,
        "the clock ran on while the panel was up"
    );
    assert_eq!(lua(&g, "nova.time_scale()"), "1");
    // walking off: the panel fades away with the zone, and the doors shut
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-0.8"], "frames": 150 }, { "wait": 20 } ] }"#,
    );
    assert!(
        lua(&g, "tostring(nova.scene_now():picker())") == "nil",
        "out of the zone"
    );
    assert_eq!(num(&g, "nova.scene_now().picker_a"), 0.0);
    assert_eq!(lua(&g, "nova.time_scale()"), "1");
}

/// "Pick a different font for everything": the game's words are one face, the rounded one, in two weights. The serif (Lora) is
/// not used by any file of the game, in its Lua or in its tool recipes; only the Mayor's signature stays in the script face.
#[test]
fn no_game_file_uses_the_serif_and_the_script_face_is_only_the_mayors_signature() {
    let root =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/mountain-post");
    let mut hits = Vec::new();
    let mut script = Vec::new();
    fn walk(dir: &std::path::Path, hits: &mut Vec<String>, script: &mut Vec<String>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            if p.is_dir() {
                if name != "build" && name != "models" && name != "terrain" {
                    walk(&p, hits, script);
                }
                continue;
            }
            if !matches!(
                p.extension().and_then(|x| x.to_str()),
                Some("lua" | "mjs" | "json")
            ) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&p) else {
                continue;
            };
            for (i, line) in text.lines().enumerate() {
                let l = line.to_lowercase();
                if l.contains("serif") && !l.contains("sans-serif")
                    || l.contains("lora") && l.contains("font")
                {
                    hits.push(format!("{}:{}", p.display(), i + 1));
                }
                if l.contains("\"script\"") || l.contains("font: \"script") {
                    script.push(format!("{}:{}", name, i + 1));
                }
            }
        }
    }
    walk(&root, &mut hits, &mut script);
    assert!(hits.is_empty(), "the serif face is still used: {hits:?}");
    assert_eq!(
        script.len(),
        1,
        "only the signature is in the script: {script:?}"
    );
    assert!(script[0].starts_with("cards.lua"), "{script:?}");
}

/// The wording in the new face and the smaller sizes: every dialogue line fits its box (the lines wrapped inside the box's width,
/// all of them in the box's height), the letter fits its page, and the smallest text is not under the handheld minimum.
#[test]
fn every_line_of_the_dialogue_and_the_letter_fits_its_box_in_the_rounded_face() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        r#"(function()
          local words, dialogue, cards, ui = require('lib.words'), require('lib.dialogue'), require('lib.cards'), require('lib.ui')
          local bad = {}
          local L = dialogue.layout(1280)
          local maxh = L.h - L.pad_top - 14
          for who, p in pairs(words.people) do
            local all = {}
            for _, k in ipairs({ 'given', 'after', 'without' }) do
              local v = p[k]
              if type(v) == 'string' then all[#all + 1] = v else for _, s in ipairs(v) do all[#all + 1] = s end end
            end
            for _, line in ipairs(all) do
              local _, h = nova.ui.text_size(line, { font = 'rounded', size = L.size, width = L.text_w, line_spacing = L.spacing, bold = 0.55 })
              if h > maxh then bad[#bad + 1] = who .. ' ' .. math.floor(h) .. ' > ' .. math.floor(maxh) .. ': ' .. line:sub(1, 30) end
            end
          end
          local C = cards.letter_layout(1280)
          if C.h > 560 or C.h1 <= 0 then bad[#bad + 1] = 'letter ' .. math.floor(C.h) end
          if ui.F.body * 4 / 3 < 20 or ui.F.small * 4 / 3 < 17 or ui.F.hint * 4 / 3 < 17 then bad[#bad + 1] = 'sizes' end
          return #bad == 0 and 'ok' or table.concat(bad, ' | ')
        end)()"#,
    );
    assert_eq!(out, "ok");
}

// ---- the owner's third play (2026-11-22) ----------------------------------------------------------------------------------------

/// "We gotta reassess the van. It looks kinda borked now and too wide. We can slim it down and use those reference images." The van
/// keeps the reference mail truck's own proportions, scaled as a whole (tools/van.mjs): 2.9 to 3.0 m long over its bumpers, 1.30
/// to 1.38 wide over its body (the mirrors stick out), 1.60 to 1.68 high, length : width : height about 1 : 0.45 : 0.55, wheels
/// 0.52 to 0.56 across; its lamps are parts of their own, the lit brake and reverse lamps hidden at rest.
#[test]
fn the_van_keeps_the_mail_trucks_proportions_and_has_lamps() {
    let bytes = std::fs::read(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/mountain-post/models/van.glb"),
    )
    .unwrap();
    let mesh = nova_runtime::model::import_glb(&bytes).expect("the van's glb");
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    let (mut wlo, mut whi) = (f32::MAX, f32::MIN);
    for v in &mesh.vertices {
        for k in 0..3 {
            lo[k] = lo[k].min(v.position[k]);
            hi[k] = hi[k].max(v.position[k]);
        }
        // (the body's width, under the mirrors)
        if (0.3..1.05).contains(&v.position[1]) {
            wlo = wlo.min(v.position[0]);
            whi = whi.max(v.position[0]);
        }
    }
    let (length, width, height) = (hi[2] - lo[2], whi - wlo, hi[1] - lo[1].max(0.0));
    let sizes = format!("{length:.3} x {width:.3} x {height:.3}");
    assert!((2.9..=3.0).contains(&length), "length {sizes}");
    assert!((1.30..=1.38).contains(&width), "width {sizes}");
    assert!((1.60..=1.68).contains(&height), "height {sizes}");
    let (w, h) = (width / length, height / length);
    assert!(
        (0.43..=0.47).contains(&w) && (0.53..=0.57).contains(&h),
        "1 : {w:.3} : {h:.3} ({sizes})"
    );
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let wheel = 2.0 * num(&g, "nova.model_pose('van').wheel_fl.y");
    assert!((0.52..=0.56).contains(&wheel), "wheels {wheel} m across");
    // the owner's fourth notes: "don't increase the body length but you can move back the back wheels a bit": the front axle where it
    // was (0.72), the rear one moved back from 70% of the length to about 77% (a 1.51 m wheelbase, was 1.31), the body as long as before
    let front = num(&g, "nova.model_pose('van').wheel_fl.z");
    let rear = num(&g, "nova.model_pose('van').wheel_rl.z");
    let rear_at = (hi[2] as f64 - rear) / length as f64;
    assert!((front - 0.72).abs() < 0.01, "the front axle stays: {front}");
    assert!(
        (0.75..=0.79).contains(&rear_at),
        "the rear axle at {rear_at} of the length (it was 0.70)"
    );
    assert!(
        (1.45..=1.56).contains(&(front - rear)),
        "the wheelbase {}",
        front - rear
    );
    assert!(
        num(&g, "nova.named('van').wheelbase") > 1.45,
        "the van drives on the model's wheelbase"
    );
    let parts = lua(
        &g,
        "(function() local p = {} for _, n in ipairs(nova.model_parts('van')) do p[n] = true end; return tostring(p.lamp_head and p.lamp_tail and p.lamp_brake and p.lamp_reverse and p.lamp_reverse_off and p.lamp_indicator_front and p.lamp_indicator_back) end)()",
    );
    assert_eq!(parts, "true", "the lamps are parts of their own");
    // (the lit brake and reverse lamps are hidden in the model until the game shows them)
    let model: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../examples/mountain-post/models/van.model.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let body = &model["parts"][0];
    for name in ["lamp_brake", "lamp_reverse"] {
        let part = body["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == name)
            .expect(name);
        assert_eq!(
            part["hidden"],
            Value::Bool(true),
            "{name} is hidden at rest"
        );
    }
}

/// The lamps work: the tail lamps glow bright while braking (L2 while going forward), the reverse lamps light while backing up, and
/// the headlamps are lit softly (Van.LIGHTS.head); neither the brake nor the reverse lamps show while just driving or parked.
#[test]
fn braking_lights_the_tail_lamps_and_reversing_the_reverse_lamps() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "LIT = function() local v = nova.named('van'); local pt = v.parts_table; return tostring(pt.lamp_head.visible) .. ' ' .. tostring(pt.lamp_brake.visible) .. ' ' .. tostring(pt.lamp_reverse.visible) .. ' ' .. tostring(pt.lamp_reverse_off.visible) end",
        "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "wait": 5, "lua": "PARKED = LIT()" },
        { "hold": ["go"], "frames": 120, "lua": "" },
        { "hold": ["go"], "frames": 1, "lua": "DRIVING = LIT()" },
        { "hold": ["brake"], "frames": 6 },
        { "hold": ["brake"], "frames": 1, "lua": "BRAKING = LIT(); BRAKE_SPEED = nova.named('van').speed" },
        { "hold": ["brake"], "until": "nova.named('van').speed < -0.8", "max": 400 },
        { "hold": ["brake"], "frames": 1, "lua": "REVERSING = LIT()" } ] }"#,
    );
    // (each value is the frame's draw: head, brake, reverse lit, reverse unlit)
    assert_eq!(
        lua(&g, "PARKED"),
        "true false false true",
        "parked: headlamps only"
    );
    assert_eq!(lua(&g, "DRIVING"), "true false false true", "driving on");
    assert!(
        num(&g, "BRAKE_SPEED") > 0.5,
        "still rolling forward while braking"
    );
    assert_eq!(
        lua(&g, "BRAKING"),
        "true true false true",
        "braking: the tail lamps bright"
    );
    assert_eq!(
        lua(&g, "REVERSING"),
        "true false true false",
        "reversing: the reverse lamps lit"
    );
}

/// "The 'turn back to straight' when the player eases off the left stick while driving is too slow." "We can also increase the
/// turn radius for the van." (The circle kept after the fourth notes moved the rear axle back: the lock is 20.9 degrees on the 1.51 m
/// wheelbase, the same tan(lock) / wheelbase as 18.3 on 1.31.) Let go at 6 m/s after a full-lock turn, the van runs straight again (wheels and body) within 0.35 s,
/// quicker than the same wheels take to turn in. The circles (the fifth play's: tight when crawling, unchanged from 4 m/s up): 5.8 to
/// 6.8 m kerb to kerb at 1.5 m/s (it was about 10), 10.8 to 12.3 m at 4 m/s, wider at 6.
#[test]
fn the_wheels_come_back_quickly_and_the_van_sweeps_round_a_wider_circle() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local dt = 1 / 60; \
         local function step(spd, steer) v.ctl.go = v.speed < spd and 1 or 0; v.ctl.brake = v.speed > spd + 0.3 and 0.3 or 0; v.ctl.steer = steer; v:drive(dt); v.x, v.z = 4.5, -150 end; \
         v:teleport(4.5, -150, 0); v.driven = true; for i = 1, 900 do step(6, 0) end; \
         local t_in = 0; for i = 1, 180 do step(6, 1); if t_in == 0 and math.abs(v.steer) > 0.9 * 0.688 then t_in = i * dt end end; \
         local speed, t_back = v.speed, nil; for i = 1, 180 do step(6, 0); if not t_back and math.abs(v.yaw_rate) < 0.03 and math.abs(v.steer) < 0.02 then t_back = i * dt end end; \
         local function circle(spd) v:teleport(4.5, -150, 0); v.driven = true; local xs, zs, turned, last = {}, {}, 0, v.heading; \
           for i = 1, 6000 do v.ctl.go = v.speed < spd and 0.6 or 0; v.ctl.brake = v.speed > spd + 0.2 and 0.3 or 0; v.ctl.steer = 1; v:drive(dt); \
             if i > 240 then turned = turned + math.abs(v.heading - last); local x, _, z = v:to_world(0.64, 0, 0.72); xs[#xs + 1], zs[#zs + 1] = x, z; if turned > 2 * math.pi + 0.2 then break end end; last = v.heading end; \
           local a, b = math.huge, -math.huge; for _, q in ipairs(xs) do a, b = math.min(a, q), math.max(b, q) end; return b - a end; \
         return string.format('%.3f %.3f %.3f %.3f %.3f %.3f', speed, t_in, t_back or 9, circle(1.5), circle(4), circle(6)) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    let (speed, t_in, t_back, slow, quicker, fast) = (v[0], v[1], v[2], v[3], v[4], v[5]);
    eprintln!("turning circles: {slow} m at 1.5 m/s, {quicker} m at 4, {fast} m at 6");
    assert!((5.7..6.4).contains(&speed), "at 6 m/s: {out}");
    assert!(
        t_back <= 0.35,
        "straight again {t_back} s after letting go ({out})"
    );
    assert!(
        t_back < t_in,
        "back to straight ({t_back} s) quicker than turning in ({t_in} s)"
    );
    // (the owner's fifth play: "the turning radius while slow isn't as tight as I would hope": at a crawl the wheels go over to
    // Van.TUNE.lock_slow, about 6.3 m kerb to kerb; from 4 m/s up the circles are what they were, 11 to 12 m at 4 m/s)
    assert!(
        (5.8..=6.8).contains(&slow),
        "kerb-to-kerb circle at a crawl: {slow} m"
    );
    assert!(
        (10.8..=12.3).contains(&quicker),
        "at 4 m/s still the wide, weighty circle: {quicker} m"
    );
    assert!(
        fast > quicker + 0.5,
        "wider at 6 m/s: {fast} m against {quicker} m"
    );
}

/// "I don't like that the van dithers away to make way for the player." The van (and the driver in it, and the parcels in its hold)
/// is drawn with see_through = false: never cut away. Standing just beyond the van from the camera, the camera lifts (or swings)
/// until the postmaster's middle and head both show past it, and eases back down once the van is out of the way.
#[test]
fn the_van_is_never_cut_away_and_the_camera_goes_round_it() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "CAM = require('lib.camera'); SEEN = function() local c, p, v = CAM.state, nova.named('postmaster'), nova.named('van'); local g = require('lib.world').height(p.x, p.z); local e = c.eye; return not CAM.van_between(v, e[1], e[2], e[3], p.x, g + 0.4, p.z) and not CAM.van_between(v, e[1], e[2], e[3], p.x, g + 0.85, p.z) end",
        "steps": [ { "wait": 3, "lua": "local v = nova.named('van'); v:teleport(4.5, -132, 0); local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -129.0, 0; CAM.reset(0)" },
        { "wait": 60 },
        { "lua": "SEEN_THEN = SEEN(); LIFT = CAM.state.dodge_p; SWING = CAM.state.dodge_y" },
        { "lua": "local p = nova.named('postmaster'); p.x, p.z = 4.5, -110" },
        { "wait": 180 },
        { "lua": "LIFT_AWAY = CAM.state.dodge_p" } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(nova.named('van').draw_opts.see_through)"),
        "false",
        "the van is never cut away"
    );
    assert_eq!(
        lua(&g, "SEEN_THEN"),
        "true",
        "the postmaster shows past the van"
    );
    let (lift, swing) = (num(&g, "LIFT"), num(&g, "SWING"));
    assert!(
        lift > 0.05 || swing.abs() > 0.05,
        "the camera moved round the van: lift {lift}, swing {swing}"
    );
    assert!(lift < 0.7, "only as far as it must: {lift} rad");
    assert!(
        num(&g, "LIFT_AWAY") < 0.03,
        "and back once the van is out of the way: {}",
        num(&g, "LIFT_AWAY")
    );
}

/// "I think we can tilt the camera down a bit while walking out and driving" (asked: lower and more behind, more level, the road and
/// the horizon ahead). On foot the boom rises 24 to 28 degrees from 8 to 9 m with a lens about 40 degrees, the view looking down
/// less (the horizon in the top of the picture); driving it rises 14 to 18 degrees. Each still tilts with the right stick round
/// the new default.
#[test]
fn the_cameras_are_lower_and_more_behind() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -150, math.pi; require('lib.camera').reset(math.pi)" }, { "wait": 30 } ] }"#,
    );
    let foot = lua(
        &g,
        "(function() local F, V = require('lib.camera').FOOT, require('lib.camera').VAN; return string.format('%.2f %.2f %.2f %.2f %.2f %.2f %.2f %.2f', math.deg(F.pitch), F.dist, F.fov, math.deg(F.view), math.deg(V.pitch), math.deg(F.low), math.deg(F.high), math.deg(V.view)) end)()",
    );
    let v: Vec<f64> = foot.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(
        (24.0..=28.0).contains(&v[0]),
        "on foot {} degrees down ({foot})",
        v[0]
    );
    assert!(
        (8.0..=9.0).contains(&v[1]) && (38.0..=44.0).contains(&v[2]),
        "8 to 9 m, a lens about 40 ({foot})"
    );
    assert!(
        v[3] < 21.0 * 0.95,
        "the view looks down less than half the lens, so the horizon shows ({foot})"
    );
    assert!(
        (14.0..=18.0).contains(&v[4]),
        "driving {} degrees down ({foot})",
        v[4]
    );
    assert!(
        v[5] < v[0] && v[6] > v[0],
        "the stick tilts both ways round the default ({foot})"
    );
    // the eye stands that far behind and above the postmaster, looking out past them
    let eye = lua(
        &g,
        "(function() local c, p = require('lib.camera').state, nova.named('postmaster'); local g = require('lib.world').height(p.x, p.z); local dx, dz = c.eye[1] - p.x, c.eye[3] - p.z; return string.format('%.2f %.2f %.2f', math.sqrt(dx * dx + dz * dz), c.eye[2] - g, math.deg(math.atan(c.eye[2] - c.at[2], math.sqrt((c.at[1] - c.eye[1])^2 + (c.at[3] - c.eye[3])^2)))) end)()",
    );
    let e: Vec<f64> = eye.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(
        (6.5..8.5).contains(&e[0]) && (3.5..5.0).contains(&e[1]),
        "behind and above: {eye}"
    );
    assert!(
        (13.0..18.0).contains(&e[2]),
        "looking down {} degrees",
        e[2]
    );
}

/// "Technically they wouldn't be square, they would go around the wheel well and have a step in them too. We can remove the
/// passenger side door and just keep it as a window." The left (driver's) doorway's foot runs low and level from its back, then
/// rises round the front wheel's well a constant gap clear of it; the right side has no opening below the window line (one window,
/// the wheel wells aside); a dark step sits inside the doorway, lower than the cab floor.
#[test]
fn the_left_doorway_goes_round_the_wheel_well_and_the_right_side_is_a_window() {
    let model: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../examples/mountain-post/models/van.model.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let scale = model["scale"].as_f64().unwrap();
    let body = &model["parts"][0];
    let cuts: Vec<&Value> = body["cubes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["modifiers"].as_array())
        .flatten()
        .filter(|m| m["type"] == "cutout")
        .flat_map(|m| m["cuts"].as_array().unwrap().iter())
        .collect();
    let pts = |c: &Value| -> Vec<(f64, f64)> {
        c["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p[0].as_f64().unwrap() * scale,
                    p[1].as_f64().unwrap() * scale,
                )
            })
            .collect()
    };
    let side_openings = |flank: &str| -> Vec<Vec<(f64, f64)>> {
        cuts.iter()
            .filter(|c| c["view"] == "side" && c["remove"] == Value::Bool(true))
            .filter(|c| c["only"].is_null() || c["only"] == flank)
            .map(|c| pts(c))
            // (the wheel wells: round the axles, under 0.7 m)
            .filter(|p| p.iter().any(|&(_, y)| y > 0.7))
            .collect()
    };
    // the right: one opening, a window, nothing of it below 0.95 m
    let right = side_openings("-x");
    assert_eq!(right.len(), 1, "one window on the right, no doorway");
    let low = right[0].iter().map(|&(_, y)| y).fold(f64::MAX, f64::min);
    assert!(
        low >= 0.95,
        "the right window starts at {low} m: no opening below the window line"
    );
    // the left: the doorway, its foot low and behind the well, its lower front round the well a constant gap clear
    let left = side_openings("+x");
    assert_eq!(left.len(), 1, "one doorway on the left");
    let door = &left[0];
    let (axle, arch_y, arch_r) = (0.72, 0.29, 0.34);
    let foot = door.iter().map(|&(_, y)| y).fold(f64::MAX, f64::min);
    assert!(
        foot < arch_y + arch_r,
        "the doorway's foot ({foot} m) is lower than the top of the wheel well: a step inside it"
    );
    let round: Vec<f64> = door
        .iter()
        .filter(|&&(z, y)| y < 0.85 && y > foot + 0.02 && (z - axle).abs() < 0.4)
        .map(|&(z, y)| ((z - axle).powi(2) + (y - arch_y).powi(2)).sqrt())
        .collect();
    assert!(
        round.len() >= 6,
        "the lower front follows the well: {round:?}"
    );
    for d in &round {
        assert!(
            (d - arch_r - 0.07).abs() < 0.015,
            "a constant gap above the well's lip: {round:?}"
        );
    }
    assert!(
        door.iter()
            .any(|&(z, y)| (z - axle).abs() < 0.05 && y > arch_y + arch_r),
        "the doorway's foot passes over the top of the wheel"
    );
    // the step: dark, inside the doorway's foot, under the cab floor (0.5 m)
    let step = body["cubes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| {
            c["shape"] == "mesh"
                && c["color"] == "#4d4641"
                && c["verts"]
                    .as_array()
                    .is_some_and(|v| v.iter().all(|p| p[1].as_f64().unwrap() * scale < 0.45))
        })
        .count();
    assert!(step >= 1, "a dark step inside the doorway");
}

/// The owner's fourth notes, the buttons by the letters engraved on the Retroid: "X: Interact, continue conversation. Y: Enter/Exit
/// vehicle. A: Confirm items in menus. B: Hold to run while walking, hold for handbrake while driving." The bindings say so (and the
/// engine's glyph for each source is that letter), the map is on Select, and each button does its own things and nothing else: A
/// never talks, reads, takes from the shelf or loads, X never confirms the pause menu, starts the game or takes from the van's
/// panel, Y only gets in and out, and the map opens and closes on Select only.
#[test]
fn x_y_a_b_and_select_do_what_the_owner_listed_and_nothing_else() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cfg: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(format!("{GAME}/nova.json"))).unwrap(),
    )
    .unwrap();
    let pad = |action: &str| -> Vec<String> {
        cfg["input"][action]
            .as_array()
            .unwrap_or_else(|| panic!("{action} is bound"))
            .iter()
            .filter_map(|v| v.as_str())
            .filter(|s| s.starts_with("pad:"))
            .map(String::from)
            .collect()
    };
    let mut g = game();
    for (action, source, letter) in [
        ("interact", "pad:west", "X"),
        ("van", "pad:north", "Y"),
        ("confirm", "pad:south", "A"),
        ("run", "pad:east", "B"),
        ("handbrake", "pad:east", "B"),
    ] {
        assert_eq!(
            pad(action),
            vec![source.to_string()],
            "{action} is {letter} only"
        );
        assert_eq!(
            lua(&g, &format!("(nova.input.glyph('{source}'))")),
            letter,
            "{source} is the button engraved {letter}"
        );
    }
    assert_eq!(
        pad("map"),
        vec!["pad:select".to_string()],
        "the map is on Select"
    );
    assert!(cfg["input"].get("act").is_none() && cfg["input"].get("horn").is_none());

    // the title: X does not start, A does
    play(
        &mut g,
        r#"{ "steps": [ { "wait": 60 }, { "press": "interact" }, { "wait": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.current_scene()"), "title");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "until": "nova.current_scene() == 'office'", "max": 120 }, { "wait": 30 } ] }"#,
    );
    // the office: at the letter A does nothing, X reads it; A and Y do not close it, X does
    play(
        &mut g,
        r#"{ "steps": [ { "walk_to": [0.9, 0.35], "max": 300 }, { "press": "confirm" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 30 }, { "press": "confirm" }, { "wait": 10 }, { "press": "van" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "letter");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");

    // the valley on foot, beside Hazel with her parcel: A, Y and B do not hand it over; X does, and only X goes on
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "require('lib.state').carrying = 'hazel'", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 36" },
        { "walk_to": "hazel", "max": 600 }, { "until": "nova.scene_now():resident_near() ~= nil", "max": 200 },
        { "press": "confirm" }, { "wait": 10 }, { "press": "van" }, { "wait": 10 }, { "press": "run" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(require('lib.dialogue').active())"),
        "false",
        "A does not interact on foot"
    );
    assert_eq!(lua(&g, "require('lib.state').carrying"), "hazel");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 200 }, { "press": "confirm" }, { "wait": 10 }, { "press": "van" }, { "wait": 10 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "handed hazel the parcel"));
    assert!(
        !logged(&r).iter().any(|l| l.starts_with("dialogue hazel 2")),
        "A and Y do not go on with a conversation"
    );
    assert_eq!(
        lua(&g, "tostring(require('lib.dialogue').active())"),
        "true"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 10 } ] }"#,
    );
    assert!(
        logged(&r).iter().any(|l| l.starts_with("dialogue hazel 2")),
        "X goes on"
    );

    // the pause menu: X, B and Y do not choose; A chooses (Resume)
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 10 }, { "press": "pause" }, { "wait": 10 },
        { "press": "interact" }, { "wait": 5 }, { "press": "run" }, { "wait": 5 }, { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(require('lib.cards').kind())"),
        "pause",
        "X does not confirm the pause menu"
    );
    play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");

    // the map: Select opens it; X, A and Y leave it open; Select closes it
    play(
        &mut g,
        r#"{ "steps": [ { "press": "map" }, { "wait": 30 }, { "press": "interact" }, { "wait": 5 }, { "press": "confirm" }, { "wait": 5 }, { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "map");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "map" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(require('lib.cards').kind())"), "nil");

    // the van's back: carrying, A and Y do not load and X does; empty-handed at the panel, X and Y do not take and A does
    let r = play(
        &mut g,
        r#"{ "lua": "T = require('lib.testkit'); S = require('lib.state'); S.carrying = 'hazel'; S.on_shelf.hazel = false", "steps": [
        { "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():actions() == 'load'", "max": 60 },
        { "press": "confirm" }, { "wait": 5 }, { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert!(!logged(&r).iter().any(|l| l.starts_with("loaded")));
    assert_eq!(r.drawn_count("ui_text", Some("Load package")), 1);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 5 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "loaded hazel"));
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 5 }, { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert!(!logged(&r).iter().any(|l| l.starts_with("unloaded")));
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 5 } ] }"#,
    );
    assert!(
        logged(&r).iter().any(|l| l == "unloaded hazel"),
        "A takes from the panel"
    );

    // the doorway: X, A and B do not get in; Y does; in the van X is the horn, A nothing, and Y (stopped) gets out
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.carrying = nil; local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR)" }, { "wait": 5 },
        { "press": "interact" }, { "wait": 5 }, { "press": "confirm" }, { "wait": 5 }, { "press": "run" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    assert_eq!(r.drawn_count("ui_text", Some("Get in")), 1);
    play(
        &mut g,
        r#"{ "steps": [ { "press": "van" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "van");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 5 }, { "press": "confirm" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(
        logged(&r).iter().filter(|l| *l == "horn").count(),
        1,
        "X sounds the horn"
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "van");
    assert_eq!(r.drawn_count("ui_text", Some("Get out")), 1);
    play(
        &mut g,
        r#"{ "steps": [ { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
}

/// "For running they will [have their arms out] and turning will also tilt them slightly in the direction that they're turning in."
/// Running (B held), a turn banks the body into it, like an aeroplane: right in a right turn, left in a left one, up to about 13
/// degrees, eased, and level again going straight. Walking the same turns does not bank at all. Trotting with a parcel banks about
/// half as much as running.
#[test]
fn b_runs_and_the_run_banks_into_turns_and_the_walk_does_not() {
    // (each run: straight ahead, a right turn, straight, a left turn, straight; the most and least roll seen, and the roll at the end)
    let turns = |run: bool, carry: bool| -> (f64, f64, f64) {
        let mut g = game();
        let b = if run { r#", "run""# } else { "" };
        let carry = if carry { "'hazel'" } else { "nil" };
        play(
            &mut g,
            &format!(
                r#"{{ "start_scene": "valley", "lua": "require('lib.state').carrying = {carry}; LO, HI = 0, 0",
                "each_frame": "local p = nova.named('postmaster'); LO, HI = math.min(LO, p.bank or 0), math.max(HI, p.bank or 0)",
                "steps": [ {{ "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -125, 0; require('lib.camera').reset(0)" }},
                {{ "hold": ["move_y=-1"{b}], "frames": 40 }},
                {{ "hold": ["move_y=-1", "move_x=1"{b}], "frames": 14 }},
                {{ "hold": ["move_y=-1"{b}], "frames": 30 }},
                {{ "hold": ["move_y=-1", "move_x=-1"{b}], "frames": 14 }},
                {{ "hold": ["move_y=-1"{b}], "frames": 40 }} ] }}"#
            ),
        );
        (
            num(&g, "LO"),
            num(&g, "HI"),
            num(&g, "nova.named('postmaster').bank"),
        )
    };
    let deg = |r: f64| r.to_degrees();
    let (lo, hi, end) = turns(true, false);
    assert!(
        deg(hi) > 7.0 && deg(hi) <= 15.0,
        "running, a right turn banks right (the top to the model's -x: a positive roll), up to about 13 degrees: {}",
        deg(hi)
    );
    assert!(
        deg(lo) < -7.0 && deg(lo) >= -15.0,
        "running, a left turn banks left: {}",
        deg(lo)
    );
    assert!(
        deg(end).abs() < 0.5,
        "level again running straight: {}",
        deg(end)
    );
    let (wlo, whi, _) = turns(false, false);
    assert!(
        wlo.abs() < 1e-3 && whi.abs() < 1e-3,
        "walking does not bank: {} {}",
        deg(wlo),
        deg(whi)
    );
    let (tlo, thi, _) = turns(true, true);
    assert!(
        thi > hi * 0.3 && thi < hi * 0.7 && tlo < lo * 0.3 && tlo > lo * 0.7,
        "the trot banks about half as much: {} {} against {} {}",
        deg(tlo),
        deg(thi),
        deg(lo),
        deg(hi)
    );
}

/// "B: ... hold for handbrake while driving." Held, the rear wheels lock (they stop turning), the van slows firmly (about 4 m/s^2,
/// far more than rolling), the brake lamps light; turning with it at some speed the tail steps out a little (the van turns more than
/// without it and slides a few degrees, never wildly) and comes back into line once let go; held standing on a slope it keeps the
/// van where it is.
#[test]
fn the_handbrake_slows_and_holds_and_lets_the_tail_step_out_gently() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local dt = 1 / 60; v.driven = true; \
         local function run(n, go, steer, hb) local slip, yaw = 0, 0; for i = 1, n do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = go, 0, steer, hb; v:drive(dt); \
           v.x, v.z = 4.5, -150; \
           local sh, ch = math.sin(v.heading), math.cos(v.heading); local vf, vl = v.velx * sh + v.velz * ch, v.velx * ch - v.velz * sh; \
           slip = math.max(slip, math.abs(math.atan(vl, math.abs(vf) + 1e-6))); yaw = math.max(yaw, math.abs(v.yaw_rate or 0)) end; return slip, yaw end; \
         local function up(spd) v:teleport(4.5, -150, 0); v.driven = true; for i = 1, 1200 do v.ctl.go = v.speed < spd and 1 or 0; v.ctl.brake = v.speed > spd + 0.3 and 0.3 or 0; v.ctl.steer, v.ctl.handbrake = 0, 0; v:drive(dt); v.x, v.z = 4.5, -150 end end; \
         up(8); local s0, r0 = v.speed, v.spin_rear; run(30, 0, 0, 1); local s1 = v.speed; local lit = v:lamps().brake; local locked = math.abs(v.spin_rear - r0) < 1e-9; \
         up(8); local c0 = v.speed; run(30, 0, 0, 0); local coast = c0 - v.speed; \
         up(7); local slip0, yaw0 = run(45, 0.3, 1, 0); \
         up(7); local slip1, yaw1 = run(45, 0.3, 1, 1); run(60, 0.3, 0, 0); \
         local sh, ch = math.sin(v.heading), math.cos(v.heading); local after = math.abs(math.atan(v.velx * ch - v.velz * sh, v.velx * sh + v.velz * ch)); \
         return string.format('%.3f %.3f %s %s %.3f %.4f %.3f %.4f %.3f %.4f', s0, s1, tostring(lit), tostring(locked), coast, slip0, yaw0, slip1, yaw1, after) end)()",
    );
    let v: Vec<&str> = out.split(' ').collect();
    let f = |i: usize| v[i].parse::<f64>().unwrap();
    let (s0, s1, coast) = (f(0), f(1), f(4));
    let decel = (s0 - s1) / 0.5;
    assert!(
        (3.5..=5.2).contains(&decel),
        "slows firmly: {decel} m/s^2 ({out})"
    );
    assert!(
        coast < 0.6,
        "rolling alone loses little in the same time: {out}"
    );
    assert_eq!(v[2], "true", "the brake lamps light with it");
    assert_eq!(v[3], "true", "the rear wheels are locked");
    let (slip0, yaw0, slip1, yaw1, after) = (f(5), f(6), f(7), f(8), f(9));
    assert!(
        yaw1 > yaw0 * 1.15,
        "the tail steps out: it turns more ({yaw1} against {yaw0}; {out})"
    );
    assert!(
        slip1.to_degrees() > slip0.to_degrees() + 2.0 && slip1.to_degrees() < 20.0,
        "a little slide, gentle: {} degrees (without it {})",
        slip1.to_degrees(),
        slip0.to_degrees()
    );
    assert!(
        after.to_degrees() < 1.5,
        "back in line a second after letting go: {}",
        after.to_degrees()
    );

    // standing on a slope: driven with nothing pressed it rolls; on the handbrake it stays
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local W = require('lib.world'); local dt = 1 / 60; local bx, bz, best = 0, 0, 0; \
         for x = -240, 240, 2 do for z = -240, 240, 2 do local gx, gz = nova.terrain_slope(x, z); local s = math.sqrt(gx * gx + gz * gz); \
           local r, dr = W.nearest('road', x, z); \
           if r and dr < r.width / 2 and s > best and s < 0.25 and not W.blocked(x, z, 2.5) and not W.on_bridge(x, z) and not nova.scenery.push(x, z, 2.5) then best, bx, bz = s, x, z end end end; \
         local gx, gz = nova.terrain_slope(bx, bz); local h = math.atan(gx, gz); \
         local function hold(hb) v:teleport(bx, bz, h); v.driven = true; for i = 1, 300 do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, 0, 0, hb; v:drive(dt) end; return math.sqrt((v.x - bx) ^ 2 + (v.z - bz) ^ 2) end; \
         return string.format('%.3f %.3f %.3f', best, hold(0), hold(1)) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(v[0] > 0.08, "a slope to stand on: {out}");
    assert!(
        v[1] > 1.0,
        "it rolls down the slope without the handbrake: {out}"
    );
    assert!(v[2] < 0.02, "held still on the handbrake: {out}");
}

// ---- the owner's fifth play on the Retroid (2026-11-22): the paper map, the minimap, the road signs, the van's tight turn ----------

fn game_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/mountain-post")
}

/// "How can we spruce up the map? Maybe build a proper generator?" The paper map is drawn by Nova's map generator (map_make, called by
/// tools/map.mjs from the valley's scene and terrain), not painted by hand in tools/art.mjs any more; Select shows it nearly as tall
/// as the screen, in the kit's frame, at its own proportions; and nothing is drawn over it: no mark for the player, no destination.
#[test]
fn the_paper_map_comes_from_the_generator_and_marks_neither_you_nor_where_to_go() {
    let root = game_dir();
    let recipe = std::fs::read_to_string(root.join("tools/map.mjs")).expect("tools/map.mjs");
    assert!(
        recipe.contains("tool(\"map_make\"") && recipe.contains("scene: \"valley\""),
        "the map is the generator's, from the valley's scene"
    );
    for word in ["you", "player", "destination"] {
        assert!(
            !recipe.contains(&format!("label: \"{word}")),
            "the map's recipe names no {word}"
        );
    }
    let art = std::fs::read_to_string(root.join("tools/art.mjs")).expect("tools/art.mjs");
    assert!(
        !art.contains("\"ui/map\""),
        "tools/art.mjs no longer paints the map"
    );
    // (the weak point after the fifth play: drawn at two thirds on the Retroid's 720p screen, the lettering went soft. Now there is a
    // picture for each screen, chosen by nova.view("pixels") and drawn one texel to a pixel, its corner on a whole pixel)
    let mut g = game();
    let mut r = None;
    for (screen, picture) in [(1080.0, "ui/map"), (720.0, "ui/map_720")] {
        let png =
            std::fs::read(root.join(format!("sprites/{picture}.png"))).expect("the map's picture");
        let map = nova_runtime::assets::decode_png(&png).expect("a PNG");
        g.set_pixel_scale(screen as f32 / 540.0);
        let run = play(
            &mut g,
            r#"{ "start_scene": "valley", "steps": [ { "wait": 10, "lua": "local c = require('lib.cards'); if c.active() then c.close() end" }, { "wait": 5 }, { "press": "map" }, { "wait": 40 } ] }"#,
        );
        assert_eq!(
            lua(&g, "table.concat({ nova.view('pixels') }, ' ')"),
            format!("{} {}", screen as i64 * 16 / 9, screen as i64),
            "nova.view('pixels') on a {screen}p screen"
        );
        let sheet = run.drawn("ui_sprite", Some("ui/map"));
        assert_eq!(sheet.len(), 1, "the paper map is open");
        assert_eq!(
            sheet[0]["name"].as_str().unwrap(),
            picture,
            "the {screen}p picture"
        );
        let px = screen / 540.0;
        let (w, h, x) = (
            sheet[0]["w"].as_f64().unwrap() * px,
            sheet[0]["h"].as_f64().unwrap() * px,
            (sheet[0]["x"].as_f64().unwrap() - sheet[0]["w"].as_f64().unwrap() / 2.0) * px,
        );
        assert!(
            (w - map.width as f64).abs() < 0.01 && (h - map.height as f64).abs() < 0.01,
            "{screen}p: one texel a pixel ({w}x{h} px for a {}x{} picture)",
            map.width,
            map.height
        );
        assert!(
            (x - x.round()).abs() < 0.01,
            "{screen}p: on a whole pixel ({x})"
        );
        assert!(
            h >= 0.88 * screen,
            "{screen}p: nearly as tall as the screen: {h} px"
        );
        r = Some(run);
    }
    g.set_pixel_scale(1.0);
    let r = r.unwrap();
    let sheet = r.drawn("ui_sprite", Some("ui/map"));
    let (w, h) = (
        sheet[0]["w"].as_f64().unwrap(),
        sheet[0]["h"].as_f64().unwrap(),
    );
    let (sx, sy) = (
        sheet[0]["x"].as_f64().unwrap(),
        sheet[0]["y"].as_f64().unwrap(),
    );
    for s in r.drawn("ui_sprite", None) {
        let n = s["name"].as_str().unwrap_or("");
        let (x, y) = (s["x"].as_f64().unwrap(), s["y"].as_f64().unwrap());
        let over = (x - sx).abs() < w / 2.0 && (y - sy).abs() < h / 2.0;
        assert!(
            !over || n.starts_with("ui/map") || n.contains("ui/kit/"),
            "{n} is drawn over the map"
        );
    }
    assert!(
        r.drawn("ui_sprite", Some("ui/you")).is_empty(),
        "no mark for you"
    );
    assert!(
        r.drawn("ui_text", None).iter().all(|t| {
            let (x, y) = (t["x"].as_f64().unwrap(), t["y"].as_f64().unwrap());
            (x - sx).abs() > w / 2.0 || (y - sy).abs() > h / 2.0
        }),
        "no words written over the map"
    );
}

/// "The direction should move when rotated to follow the players camera direction. There should be a North marker on the map too."
/// The minimap turns with the camera: whatever way the camera looks, a point straight ahead of it is straight up the disc; the
/// red north tab sits on the rim where north is; the "you" mark shows the postmaster's facing against the camera's; and turning the
/// camera through the wrap-around (south, where its yaw jumps from pi to -pi) moves everything on the disc smoothly, without a snap.
#[test]
fn the_minimap_turns_with_the_camera_and_its_north_tab_rides_the_rim() {
    let mut g = game();
    use std::f64::consts::{FRAC_PI_2, PI};
    for yaw in [0.0f64, FRAC_PI_2, PI, -FRAC_PI_2, 2.4, -0.7] {
        let r = play(
            &mut g,
            &format!(
                r#"{{ "start_scene": "valley", "steps": [ {{ "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -150, {face}; require('lib.camera').reset({yaw})" }}, {{ "wait": 20 }} ] }}"#,
                face = yaw + 0.6
            ),
        );
        let disc = r.drawn("ui_sprite", Some("minimap_disc"));
        let north = r.drawn("ui_sprite", Some("minimap_north"));
        assert_eq!(
            (disc.len(), north.len()),
            (1, 1),
            "the disc and its north tab"
        );
        let (cx, cy) = (
            disc[0]["x"].as_f64().unwrap(),
            disc[0]["y"].as_f64().unwrap(),
        );
        let (nx, ny) = (
            north[0]["x"].as_f64().unwrap() - cx,
            north[0]["y"].as_f64().unwrap() - cy,
        );
        let at = nx.atan2(-ny);
        let view = num(&g, "math.atan(require('lib.camera').forward())");
        let off = (at - view + std::f64::consts::PI).rem_euclid(2.0 * std::f64::consts::PI)
            - std::f64::consts::PI;
        assert!(
            off.abs() < 0.04,
            "camera yaw {view}: north tab at {at} rad round the disc"
        );
        let rim = (nx * nx + ny * ny).sqrt();
        assert!(
            (60.0..=72.0).contains(&rim),
            "the tab rides the rim: {rim} from the middle"
        );
        // a point 40 m straight ahead of the camera is straight up the disc
        let ahead = lua(
            &g,
            "(function() local u = require('lib.ui').MINIMAP; local fx, fz = require('lib.camera').forward(); local p = nova.named('postmaster'); \
             local x, y = u.to(p.x + fx * 40, p.z + fz * 40); local x0, y0 = u.to(p.x, p.z); return string.format('%.3f %.3f', x - x0, y - y0) end)()",
        );
        let v: Vec<f64> = ahead.split(' ').map(|s| s.parse().unwrap()).collect();
        assert!(
            v[0].abs() < 0.05 && v[1] < -25.0,
            "straight ahead is straight up: {ahead}"
        );
        // the "you" mark: the postmaster's facing against the camera's (0.6 rad to the left of the camera's look)
        let you = num(&g, "require('lib.ui').MINIMAP.you");
        let want = view - (yaw + 0.6);
        let d = (you - want + std::f64::consts::PI).rem_euclid(2.0 * std::f64::consts::PI)
            - std::f64::consts::PI;
        assert!(d.abs() < 0.01, "you mark turned {you}, wanted {want}");
    }
    // through the wrap-around: the camera turned 0.006 rad a step from 2.9 to 3.4 (its yaw going from pi to -pi on the way), the
    // disc drawn each step; a point 50 m north and the north tab never jump
    let out = lua(
        &g,
        "(function() local ui, cam = require('lib.ui'), require('lib.camera'); local p = nova.named('postmaster'); local w, h = nova.view('exact'); \
         local jump, last = 0, nil; for k = 0, 83 do cam.reset(2.9 + k * 0.006); ui.minimap(p.x, p.z, p.face, w, h, math.atan(cam.forward())); \
         local x, y = ui.MINIMAP.to(p.x, p.z + 50); if last then jump = math.max(jump, math.sqrt((x - last[1]) ^ 2 + (y - last[2]) ^ 2)) end; last = { x, y } end; \
         return jump end)()",
    );
    let jump: f64 = out.parse().unwrap();
    assert!(
        jump < 0.4,
        "smooth through the wrap-around: the largest step {jump} units"
    );
}

/// "The road signs are hard to see from far away. Some of the lines don't show up almost like a rendering issue?" The cause: the
/// lettering's pictures (640 x 110, not powers of two) got no mipmaps, so from the van the renderer read the full-size picture at every
/// distance and strokes thinner than the gap between its samples broke up or vanished. Every smooth picture now gets its whole chain
/// (gfx::smooth_levels), each level the average of the area it covers. And the lettering has no thin strokes: the mip level the
/// GPU reads from the driving camera (its own field of view, 1280 x 720, the board at 300 texels a metre; the coarser of the two
/// levels trilinear filtering blends) keeps the letters solid. At 25 m at least three quarters of the lettering's solid area (alpha
/// at least a half) is still solid; at 60 m the letters are still there (some texel at least 0.6). A thin stroke averages below a
/// half as soon as it is narrower than a texel of its level, so it fails the first: the lettering before the fifth play kept 0.17 of
/// its solid area at 25 m (and none at 60), this keeps about 0.9. The boards are one family (3.6 m), one per road each way, at the
/// chase camera's height.
#[test]
fn the_road_signs_lettering_keeps_its_strokes_at_a_distance_and_the_boards_face_the_van() {
    let root = game_dir();
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    let fov = num(&g, "require('lib.camera').VAN.fov").to_radians();
    // the coarser mip level read at a distance: texels per screen pixel, log2, rounded up
    let level_at = |d: f64| {
        let px_per_m = 720.0 / (2.0 * d * (fov / 2.0).tan());
        (300.0 / px_per_m).log2().ceil() as usize
    };
    let (near, far) = (level_at(25.0), level_at(60.0));
    assert_eq!((near, far), (4, 5), "the levels read at 25 m and 60 m");
    for name in ["sign_fern_lane", "sign_post_road", "sign_kettle_creek_rd"] {
        let png = std::fs::read(root.join(format!("sprites/fx/{name}.png"))).expect("the words");
        let img = nova_runtime::assets::decode_png(&png).expect("a PNG");
        let levels = nova_runtime::gfx::smooth_levels(img.width, img.height);
        assert_eq!(
            levels,
            32 - img.width.max(img.height).leading_zeros(),
            "{name}: its whole mip chain"
        );
        let chain = nova_runtime::gfx::mip_chain(&img, levels);
        // (each level: its solid area, in full-size texels, and its strongest texel)
        let (mut w, mut h, mut at) = (img.width as usize, img.height as usize, 0usize);
        let mut cover = Vec::new();
        for level in 0..levels {
            let px = &chain[at..at + w * h * 4];
            let solid =
                px.chunks(4).filter(|p| p[3] >= 128).count() as f64 * (1u64 << (2 * level)) as f64;
            let max = px.chunks(4).map(|p| p[3]).max().unwrap_or(0);
            cover.push((solid, max));
            at += w * h * 4;
            (w, h) = ((w / 2).max(1), (h / 2).max(1));
        }
        let share = cover[near].0 / cover[0].0;
        assert!(
            share >= 0.75,
            "{name} at 25 m (level {near}): {share:.2} of the letters still solid"
        );
        assert!(
            cover[far].1 >= 153,
            "{name} at 60 m (level {far}): the letters still there ({})",
            cover[far].1
        );
        // the letters are big: 0.32 m or more of capitals at 300 texels a metre (tools/art.mjs SIGN_PPM)
        assert!(
            img.height as f64 / 300.0 > 0.5,
            "{name}: the words' picture is {} m high",
            img.height as f64 / 300.0
        );
    }
    for sign in ["sign_1", "sign_2"] {
        let out = lua(
            &g,
            &format!(
                "(function() local s = nova.named('{sign}'); local t = {{}}; for _, d in ipairs(s.drawn) do t[#t + 1] = string.format('%s|%.2f|%.2f|%s', d.text, d.y, d.board.h, d.model) end; return table.concat(t, ';') end)()"
            ),
        );
        let arms: Vec<Vec<String>> = out
            .split(';')
            .map(|a| a.split('|').map(str::to_string).collect())
            .collect();
        assert_eq!(arms.len(), 3, "{sign}: a board each way a road goes: {out}");
        assert_eq!(
            arms.iter().filter(|a| a[0] == "POST ROAD").count(),
            2,
            "{sign}: Post Road both ways"
        );
        for a in &arms {
            let y: f64 = a[1].parse().unwrap();
            assert!(
                (2.0..=3.25).contains(&y),
                "{sign}: {} at {y} m, near the chase camera's height",
                a[0]
            );
            // (one family: a long name on two lines on the tall board, never a longer board)
            assert_eq!(
                a[3],
                if a[0].len() > 12 {
                    "sign_arm_tall"
                } else {
                    "sign_arm"
                },
                "{sign}: {} on its board",
                a[0]
            );
            let words_h: f64 = a[2].parse().unwrap();
            assert!(
                words_h < if a[0].len() > 12 { 1.12 } else { 0.72 },
                "{sign}: {} fits its board's height ({words_h} m)",
                a[0]
            );
        }
        let posts: Vec<&Vec<String>> = arms.iter().filter(|a| a[0] == "POST ROAD").collect();
        assert_eq!(
            posts[0][1], posts[1][1],
            "{sign}: Post Road's two arms level"
        );
    }
}

/// "For the van, the turning radius while slow isn't as tight as I would hope it to be." At a crawl the wheels go over to
/// Van.TUNE.lock_slow (31 degrees; a kerb-to-kerb circle of about 6.4 m: the circle test above), the extra lock easing away by 4
/// m/s, where the wide, weighty turning is unchanged; the drawn wheels stop at Van.TUNE.drawn_lock (inside their wells); and the
/// lock the stick gives never jumps as the speed changes.
#[test]
fn the_van_turns_tightly_at_a_crawl_and_as_before_from_four_metres_a_second() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local T = v.TUNE; local jump, last = 0, nil; \
         for k = 0, 120 do local s = v.lock_share(k * 0.1); if last then jump = math.max(jump, math.abs(s - last)) end; last = s end; \
         return string.format('%.4f %.4f %.4f %.4f %.4f %.4f', math.deg(v.lock_share(0) * T.lock), math.deg(v.lock_share(1.5) * T.lock), \
           math.deg(v.lock_share(4) * T.lock), math.deg((1 - (1 - T.lock_fast) * 4 / T.top) * T.lock), jump, math.deg(T.drawn_lock)) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(
        (30.0..=32.0).contains(&v[0]) && (v[0] - v[1]).abs() < 0.01,
        "full lock at a crawl: {out}"
    );
    assert!(
        (v[2] - v[3]).abs() < 0.01,
        "at 4 m/s the lock is what it was: {out}"
    );
    assert!(v[4] < 0.06, "the lock eases with the speed, no step: {out}");
    assert!(
        v[5] < v[0] && v[5] >= 20.9,
        "the wheels are drawn turned less than the lock, at least the old lock: {out}"
    );
    // standing, with the stick hard over, the drawn front wheels stop at drawn_lock
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "hold": ["steer=1"], "frames": 150 } ] }"#,
    );
    let drawn = num(&g, "math.abs(nova.named('van').parts_table.wheel_fl.ry)");
    assert!(
        (drawn - num(&g, "nova.named('van').TUNE.drawn_lock")).abs() < 1e-6,
        "the front wheels are drawn at drawn_lock: {drawn}"
    );
    assert!(
        num(&g, "math.abs(nova.named('van').steer)") > 1.4,
        "while the van steers on to the crawl's full lock"
    );
}

// ---- the music in layers (the owner, after the clips: "pretty simple when not in the vehicle, then as the player drives more and
// more layers can come on"; and "for stopping, the layers should start to fade as the speed slows") ---------------------------------

/// The rule of lib/music.lua, run on its own (music.step, as the game runs it each frame): on foot nothing joins the piano; driving
/// earns the four layers in order, the first after about 4.5 s and then about every 9 s of driving (sooner at cruise), each entering
/// on a bar line; small wobbles at cruise change nothing; slowing thins them as the speed falls, the last earned first, gone by a
/// stop; pulling away brings the earned ones back within a couple of seconds, with no new wait; getting out forgets the drive; a card
/// or a conversation leaves the piano alone.
#[test]
fn the_music_rule_is_piano_on_foot_layers_while_driving_and_they_follow_the_speed_down() {
    let g = game();
    let out = lua(
        &g,
        r#"(function()
      local m = require('lib.music')
      local st = m.new_state()
      local dt = 0.05
      local log = {}
      local function run(seconds, input)
        local changes = {}
        for _ = 1, math.floor(seconds / dt + 0.5) do
          local speed = type(input.speed) == 'function' and input.speed(st.t) or input.speed
          for _, c in ipairs(m.step(st, dt, { driving = input.driving, speed = speed, quiet = input.quiet })) do
            c.t = st.t
            changes[#changes + 1] = c
            log[#log + 1] = c
          end
        end
        return changes
      end
      local function level(i) return st.sent[i] end
      -- on foot for half a minute: nothing joins
      assert(#run(30, { driving = false, speed = 0 }) == 0, 'on foot the piano is alone')
      -- in the van, standing: nothing changes at once
      assert(#run(3, { driving = true, speed = 0 }) == 0, 'getting in changes nothing')
      -- driving at cruise: the layers are earned in order, each entering on a bar line
      local t0 = st.t
      local got = run(40, { driving = true, speed = 9 })
      local first = {}
      for _, c in ipairs(got) do if not first[c.layer] then first[c.layer] = c end end
      for i = 1, 4 do
        assert(first[i], 'layer ' .. i .. ' joined')
        assert(first[i].at == 'bar', 'layer ' .. i .. ' enters on a bar line')
        if i > 1 then assert(first[i].t > first[i - 1].t + 3, 'one at a time: ' .. i) end
      end
      assert(first[1].t - t0 > 2.5 and first[1].t - t0 < 6, 'the first after a few seconds: ' .. (first[1].t - t0))
      assert(first[4].t - t0 < 35, 'all four within half a minute at cruise: ' .. (first[4].t - t0))
      assert(st.earned == 4 and level(4) == 1, 'all four in full')
      -- small wobbles at cruise: nothing pumps
      assert(#run(15, { driving = true, speed = function(t) return 9 + 0.5 * math.sin(t * 1.7) end }) == 0, 'wobbles at cruise change nothing')
      -- slowing to a stop over 4 s: the layers thin as the speed falls, the last earned first, all gone by the stop
      local down = st.t
      local thinning = run(5, { driving = true, speed = function(t) return math.max(0, 9 * (1 - (t - down) / 4)) end })
      local gone = {}
      for _, c in ipairs(thinning) do
        assert(c.at == 'now', 'no waiting for a bar line on the way down')
        if c.level == 0 and not gone[c.layer] then gone[c.layer] = c.t end
      end
      for i = 1, 4 do assert(gone[i], 'layer ' .. i .. ' faded as the van slowed') end
      assert(gone[4] <= gone[3] and gone[3] <= gone[2] and gone[2] <= gone[1], 'the last earned goes first')
      assert(gone[4] - down < 3.5, 'it starts as the speed falls, not at the stop: ' .. (gone[4] - down))
      run(1, { driving = true, speed = 0 })
      for i = 1, 4 do assert(level(i) == 0, 'stopped: the piano alone') end
      assert(st.earned == 4, 'a stop keeps what this drive earned')
      -- pulling away: the earned layers come back with the speed, without a new wait
      local away = st.t
      run(6, { driving = true, speed = function(t) return math.min(9, 9 * (t - away) / 3) end })
      for i = 1, 4 do assert(level(i) == 1, 'layer ' .. i .. ' back with the speed') end
      -- a card: the piano alone; closed again, they return
      run(3, { driving = true, speed = 9, quiet = true })
      for i = 1, 4 do assert(level(i) == 0, 'under a card the piano is alone') end
      run(3, { driving = true, speed = 9 })
      assert(level(4) == 1, 'after the card')
      -- getting out: everything fades and the drive is forgotten
      local out = run(1, { driving = false, speed = 0 })
      for _, c in ipairs(out) do assert(c.level == 0 and c.fade >= 2, 'out of the van: a fade of a few seconds') end
      assert(st.earned == 0 and level(1) == 0, 'the drive is forgotten')
      return 'ok ' .. #log
    end)()"#,
    );
    assert!(out.starts_with("ok"), "{out}");
}

/// The game plays the music as five stems of one piece from the start (the piano heard, the rest silent), and in the valley the
/// rule is wired to the van: driving earns layers, braking to a stop leaves only the piano, getting out forgets the drive.
#[test]
fn the_valley_plays_the_stems_and_driving_brings_in_the_layers() {
    let mut g = game();
    let status = "(function() local s = require('lib.music').status(); return s.earned .. ' ' .. table.concat(s.levels, ',') end)()";
    let r = play(
        &mut g,
        &format!(
            r#"{{ "start_scene": "valley", "steps": [ {{ "wait": 30 }},
            {{ "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }},
            {{ "hold": ["go", "steer=0.5"], "frames": 740, "record": "{status} --driving" }},
            {{ "hold": ["brake"], "frames": 150 }}, {{ "wait": 120 }},
            {{ "wait": 60, "record": "{status} --stopped" }},
            {{ "press": "van", "frames": 5 }}, {{ "wait": 200, "record": "{status} --out" }} ] }}"#
        ),
    );
    let started: Vec<String> = r.json["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| s["text"].as_str().map(str::to_string))
        .filter(|t| t.starts_with("music"))
        .collect();
    assert!(
        started.iter().any(|t| t
            == "music layers fernhollow_piano + fernhollow_bass + fernhollow_brushes + fernhollow_pad + fernhollow_celesta"),
        "{started:?}"
    );
    // the last value each phase recorded: what has been earned, and each layer's level
    let at = |tag: &str| -> (f64, Vec<f64>) {
        let runs = r.record(&format!("{status} --{tag}"));
        let v = &runs
            .last()
            .unwrap_or_else(|| panic!("nothing recorded {tag}"))
            .2;
        let (e, l) = v.split_once(' ').unwrap();
        (
            e.parse().unwrap(),
            l.split(',').map(|x| x.parse().unwrap()).collect(),
        )
    };
    let (earned, levels) = &at("driving");
    assert!(
        *earned >= 2.0,
        "twelve seconds of driving (most of it pulling away) earn layers: {earned} {levels:?}"
    );
    assert!(
        levels[0] > 0.9,
        "the first layer plays at speed: {levels:?}"
    );
    let (earned_stopped, levels) = &at("stopped");
    assert!(
        levels.iter().all(|l| *l == 0.0),
        "stopped: the piano alone {levels:?}"
    );
    assert_eq!(earned_stopped, earned, "a stop keeps what was earned");
    assert_eq!(at("out").0, 0.0, "getting out forgets the drive");
}

/// The stems stay in step: one length, one loop and one set of bar lines for all five (the mixer starts them on one frame and makes
/// them wait for each other: mixer.rs, streamed_stems_wait_for_each_other_and_stay_in_step), and the bar lines are the piece's own.
#[test]
fn the_five_stems_share_one_length_one_loop_and_the_pieces_bar_lines() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    // the length of an Ogg in frames: the granule position of its last page
    let frames = |bytes: &[u8]| -> u64 {
        let at = bytes.windows(4).rposition(|w| w == b"OggS").unwrap();
        u64::from_le_bytes(bytes[at + 6..at + 14].try_into().unwrap())
    };
    type Stem = (u64, Option<(u64, u64)>, Vec<u64>); // its length, its loop, its bar lines
    let mut first: Option<Stem> = None;
    for stem in ["piano", "bass", "brushes", "pad", "celesta"] {
        let bytes =
            std::fs::read(root.join(format!("{GAME}/music/fernhollow_{stem}.ogg"))).unwrap();
        let len = frames(&bytes);
        let src = nova_runtime::stream::StreamSource::new(bytes).unwrap();
        assert!(src.loop_points.is_some(), "{stem}: the loop's points");
        assert!(
            src.bars.len() >= 50,
            "{stem}: the bar lines ({})",
            src.bars.len()
        );
        let this = (len, src.loop_points, src.bars.clone());
        match &first {
            None => first = Some(this),
            Some(f) => assert_eq!(f, &this, "{stem} is not in step with the piano"),
        }
    }
    // the bar lines follow the piece's tempo (it eases at the ends of sections), so they are not evenly spaced
    let bars = &first.unwrap().2;
    let gaps: Vec<u64> = bars.windows(2).map(|w| w[1] - w[0]).collect();
    assert!(
        gaps.iter().max().unwrap() - gaps.iter().min().unwrap() > 1000,
        "{gaps:?}"
    );
    // the stems replace the single file the piece used to be (the game plays only them)
    assert!(!root.join(format!("{GAME}/music/fernhollow.ogg")).exists());
}

// ---- the weak points left after the fifth play (2026-11-23) ----------------------------------------------------------------------

/// The widest a model reaches out from its middle on the ground (metres at scale 1): its crown, for a tree.
fn crown_of(model: &Value) -> f64 {
    fn walk(part: &Value, ox: f64, oz: f64, mx: &mut f64) {
        let (ox, oz) = (
            ox + part["origin"][0].as_f64().unwrap_or(0.0),
            oz + part["origin"][2].as_f64().unwrap_or(0.0),
        );
        for c in part["cubes"].as_array().into_iter().flatten() {
            let mut reach =
                |x: f64, z: f64| *mx = mx.max(((x + ox).powi(2) + (z + oz).powi(2)).sqrt());
            for v in c["verts"].as_array().into_iter().flatten() {
                reach(v[0].as_f64().unwrap_or(0.0), v[2].as_f64().unwrap_or(0.0));
            }
            if let (Some(f), Some(s)) = (c["from"].as_array(), c["size"].as_array()) {
                let (fx, fz) = (f[0].as_f64().unwrap(), f[2].as_f64().unwrap());
                for (dx, dz) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
                    reach(
                        fx + dx * s[0].as_f64().unwrap(),
                        fz + dz * s[2].as_f64().unwrap(),
                    );
                }
            }
            for q in c["profile"].as_array().into_iter().flatten() {
                *mx = mx.max(q[0].as_f64().unwrap_or(0.0));
            }
        }
        for ch in part["children"].as_array().into_iter().flatten() {
            walk(ch, ox, oz, mx);
        }
    }
    let mut mx = 0.0;
    for p in model["parts"].as_array().into_iter().flatten() {
        walk(p, 0.0, 0.0, &mut mx);
    }
    mx * model["scale"].as_f64().unwrap_or(1.0)
}

/// "At 60 m a tree hides part of the Fern Lane board from Post Road." The rule (tools/scene.mjs): from every road that comes to a
/// signpost, along its last 70 m either way, the line from over the road (where the chase camera rides) to each of the post's boards
/// passes no tree's crown. Checked here from the scene file itself, with each tree's crown measured from its model and its size.
#[test]
fn no_tree_stands_between_an_approaching_van_and_a_signpost() {
    let root = game_dir();
    let scene: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("scenes/valley.scene.json")).unwrap(),
    )
    .unwrap();
    let objects = scene["objects"].as_array().unwrap();
    let mut crowns = std::collections::HashMap::new();
    for kind in ["pine", "pine2", "pine3", "larch", "larch_small", "birch"] {
        let model: Value = serde_json::from_str(
            &std::fs::read_to_string(root.join(format!("models/{kind}.model.json"))).unwrap(),
        )
        .unwrap();
        crowns.insert(kind, crown_of(&model));
    }
    let trees: Vec<(f64, f64, f64, String)> = objects
        .iter()
        .filter_map(|o| {
            let k = o["kind"].as_str()?;
            let c = crowns.get(k)?;
            Some((
                o["x"].as_f64()?,
                o["z"].as_f64()?,
                c * o["props"]["sx"].as_f64().unwrap_or(1.0),
                k.to_string(),
            ))
        })
        .collect();
    assert!(trees.len() > 300, "the valley's trees: {}", trees.len());
    let roads: Vec<Vec<(f64, f64)>> = objects
        .iter()
        .filter(|o| o["kind"] == "roadline")
        .map(|o| {
            o["props"]["points"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
                .collect()
        })
        .collect();
    let seg = |a: (f64, f64), b: (f64, f64), p: (f64, f64)| {
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let t =
            (((p.0 - a.0) * dx + (p.1 - a.1) * dz) / (dx * dx + dz * dz).max(1e-9)).clamp(0.0, 1.0);
        ((p.0 - a.0 - dx * t).powi(2) + (p.1 - a.1 - dz * t).powi(2)).sqrt()
    };
    let mut lines = 0;
    for sign in objects.iter().filter(|o| o["kind"] == "signpost") {
        let at = (sign["x"].as_f64().unwrap(), sign["z"].as_f64().unwrap());
        let mut boards = vec![at];
        for arm in sign["props"]["arms"].as_array().unwrap() {
            let ry = arm["ry"].as_f64().unwrap();
            boards.push((at.0 + ry.cos() * 1.75, at.1 - ry.sin() * 1.75));
        }
        for road in &roads {
            let (best, bd) = road
                .iter()
                .enumerate()
                .map(|(i, p)| (i, ((p.0 - at.0).powi(2) + (p.1 - at.1).powi(2)).sqrt()))
                .fold((0, f64::MAX), |m, v| if v.1 < m.1 { v } else { m });
            if bd > 30.0 {
                continue;
            }
            for dir in [1i64, -1] {
                let (mut i, mut acc) = (best as i64, 0.0);
                while acc < 70.0 && (0..road.len() as i64).contains(&(i + dir)) {
                    let (a, b) = (road[i as usize], road[(i + dir) as usize]);
                    acc += ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
                    i += dir;
                    if acc < 8.0 {
                        continue;
                    }
                    for &board in &boards {
                        lines += 1;
                        for (x, z, crown, kind) in &trees {
                            let away = ((x - board.0).powi(2) + (z - board.1).powi(2)).sqrt();
                            assert!(
                                away <= 1.0 || seg(b, board, (*x, *z)) >= *crown,
                                "{}: a {kind} at {x:.1}, {z:.1} (crown {crown:.1} m) hides the board at {:.1}, {:.1} from the road {acc:.0} m out, at {:.1}, {:.1}",
                                sign["name"].as_str().unwrap_or("a signpost"),
                                board.0,
                                board.1,
                                b.0,
                                b.1
                            );
                        }
                    }
                }
            }
        }
    }
    assert!(lines > 100, "sight lines checked: {lines}");
}

// ---------------------------------------------------------------------------------------------------------------- the owner's fifth play:
// "We need to rethink the character movement and animations ... make sure it doesn't look like the character is a stiff person
// sliding while walking." The walk, run and trot are played by the ground covered and the feet are Nova's gait (nova.gait): each
// foot is fixed to the ground while it stands. These measure what is drawn: each frame the pose the game draws (nova.model_pose with
// the animator's layers and the gait's parts), the sole as the lower half of an ellipse turned with the foot, the point of it on the
// ground, and how far that very point of the sole moved on the ground since the frame before, summed over each step the foot stands.

/// The foot probe: `FP_STEP(name)` after every frame; `FP.tags[tag]` gathers, per stretch of the route (`FP.tag`), the steps, the
/// most any standing sole slid in one step (m), sank into the ground, and how far the hips went down; `FP.err` is the most the drawn
/// ankle was ever off where the gait put it.
const FOOT_PROBE: &str = r#"
FP = { tags = {}, err = 0, tag = "" }
local SOLE = { ankle = 0.044, forward = 0.025, half = 0.082, round = 0.034 }
local PTS = {}
for j = 0, 32 do
  local t = math.pi + math.pi * j / 32
  PTS[#PTS + 1] = { SOLE.forward + SOLE.half * math.cos(t), -(SOLE.ankle - SOLE.round) + SOLE.round * math.sin(t) }
end
local function place(T, j)
  local z, y = PTS[j][1], PTS[j][2]
  local ca, sa = math.cos(T.pitch), math.sin(T.pitch)
  local zz, yy = z * ca + y * sa, -z * sa + y * ca
  return T.x + zz * math.sin(T.yaw), T.y + yy, T.z + zz * math.cos(T.yaw)
end
function FP_STEP(name)
  local p = nova.named(name)
  local W = require("lib.world")
  local layers = p.anim:layers()
  for _, l in ipairs(p.walker:extra(p.carry_w and p.carry_w > 0.01 and p.carry_layer or nil)) do layers[#layers + 1] = l end
  local pose = nova.model_pose(p.model or name, { layers = layers, parts = p.walker:parts({}) })
  local feet = p.walker:feet()
  local c, s = math.cos(p.face), math.sin(p.face)
  local T = {}
  for i, fname in ipairs({ "foot_l", "foot_r" }) do
    local f = pose[fname]
    local t = { x = p.x + f.x * c + f.z * s, z = p.z - f.x * s + f.z * c, y = (p.y or 0) + f.y, yaw = feet[i].yaw, pitch = feet[i].pitch }
    if feet[i].planted then FP.err = math.max(FP.err, math.sqrt((t.x - feet[i].x) ^ 2 + (t.y - feet[i].y) ^ 2 + (t.z - feet[i].z) ^ 2)) end
    local lo, lj = math.huge, 1
    for j = 1, #PTS do local _, y = place(t, j); if y < lo then lo, lj = y, j end end
    local ground = p.on_deck and (W.height(t.x, t.z) - nova.terrain_height(p.x, p.z)) or W.lift(t.x, t.z)
    t.low, t.j, t.h = lo, lj, lo - ground
    T[i] = t
  end
  local sup = FP.sup
  -- (the support foot is one the gait has down: of two, the lower over its own ground; none in a run's flight)
  if feet[1].planted and feet[2].planted then if not sup or sup == 0 or math.abs(T[1].h - T[2].h) > 0.003 then sup = T[1].h < T[2].h and 1 or 2 end
  elseif feet[1].planted then sup = 1 elseif feet[2].planted then sup = 2 else sup = 0 end
  local prev, cur = FP.prev, FP.cur
  if cur and cur.foot == sup and sup > 0 and prev then
    local ax, _, az = place(prev[sup], T[sup].j)
    local bx, _, bz = place(T[sup], T[sup].j)
    local d = math.sqrt((bx - ax) ^ 2 + (bz - az) ^ 2)
    if d < 0.5 and T[sup].h < 0.01 and prev[sup].h < 0.01 then cur.slide = cur.slide + d end
    cur.sink = math.max(cur.sink, -T[sup].h)
    if feet[sup].planted and feet[sup].pivot == "flat" then cur.float = math.max(cur.float, T[sup].h) end
    cur.drop = math.max(cur.drop, p.walker.drop or 0)
    cur.speed, cur.n = cur.speed + (p.speed or 0), cur.n + 1
  else
    if cur and cur.n >= 3 then
      local b = FP.tags[cur.tag] or { steps = 0, slide = 0, sink = 0, drop = 0, speed = 0, float = 0 }
      FP.tags[cur.tag] = b
      b.steps, b.slide, b.sink, b.drop = b.steps + 1, math.max(b.slide, cur.slide), math.max(b.sink, cur.sink), math.max(b.drop, cur.drop)
      b.float = math.max(b.float, cur.float)
      b.speed = math.max(b.speed, cur.speed / cur.n)
    end
    FP.cur = { foot = sup, slide = 0, sink = 0, drop = 0, speed = 0, float = 0, n = 0, tag = FP.tag }
  end
  FP.sup, FP.prev = sup, T
end
function FP_TAG(tag) return FP.tags[tag] or { steps = 0, slide = 0, sink = 0, drop = 0, speed = 0, float = 0 } end
"#;

fn install_probe(g: &Game) {
    // (one line, without its comment lines)
    let probe: Vec<&str> = FOOT_PROBE
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect();
    let probe = probe.join(" ");
    assert_eq!(
        lua(g, &format!("(function() {probe} return 'ok' end)()")),
        "ok"
    );
}

/// One stretch of a route with the probe, its steps gathered under `tag`.
fn probed(g: &mut Game, who: &str, tag: &str, steps: &str) -> Report {
    play(
        g,
        &format!(
            r#"{{ "each_frame": "FP_STEP('{who}')", "steps": [ {{ "lua": "FP.tag = '{tag}'" }}, {steps} ] }}"#
        ),
    )
}

/// (steps, the most slide in a step, the most a sole sank, the hips' lowest, the top speed of a step) for a tag
fn tag(g: &Game, tag: &str) -> (f64, f64, f64, f64, f64) {
    let t = |f: &str| num(g, &format!("FP_TAG('{tag}').{f}"));
    (t("steps"), t("slide"), t("sink"), t("drop"), t("speed"))
}

/// The postmaster on the flat stretch of road south of the post office, facing along it, the camera behind.
const ON_THE_ROAD: &str = r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -125, 0; require('lib.camera').reset(0)" }, { "wait": 30 } ] }"#;

/// No foot slides at any speed: a sweep of the stick from a creep to the full walk, the run, the trot with a parcel, starting and
/// stopping at each, the run into and out of the walk, turning while walking and running, a turn right back, a turn on the spot.
/// Each standing sole's point on the ground moves less than 1.5 cm in a step (the old clips, played by time, slid 17 to 60 cm a
/// step), no sole sinks into the ground, the hips never fold up, and what is drawn is where the gait put the feet.
#[test]
fn no_foot_slides_at_any_speed_starting_stopping_or_turning() {
    let mut g = game();
    play(&mut g, ON_THE_ROAD);
    install_probe(&g);
    let mut tags: Vec<String> = Vec::new();
    for t in [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] {
        let name = format!("walk {t}");
        probed(
            &mut g,
            "postmaster",
            "",
            &format!(r#"{{ "hold": ["move_y=-{t}"], "frames": 25 }}"#),
        );
        probed(
            &mut g,
            "postmaster",
            &name,
            &format!(r#"{{ "hold": ["move_y=-{t}"], "frames": 70 }}"#),
        );
        tags.push(name);
    }
    for (name, steps) in [
        ("run", r#"{ "hold": ["move_y=-1", "run"], "frames": 90 }"#),
        ("stop from a run", r#"{ "wait": 40 }"#),
        (
            "start to a walk",
            r#"{ "hold": ["move_y=-1"], "frames": 30 }"#,
        ),
        ("stop from a walk", r#"{ "wait": 40 }"#),
        (
            "start to a run",
            r#"{ "hold": ["move_y=-1", "run"], "frames": 40 }"#,
        ),
        ("run to walk", r#"{ "hold": ["move_y=-1"], "frames": 40 }"#),
        (
            "walk to run",
            r#"{ "hold": ["move_y=-1", "run"], "frames": 40 }"#,
        ),
        (
            "turning at a walk",
            r#"{ "hold": ["move_y=-0.7", "move_x=0.7"], "frames": 100 }"#,
        ),
        (
            "turning at a run",
            r#"{ "hold": ["move_y=-0.7", "move_x=0.7", "run"], "frames": 100 }"#,
        ),
        (
            "turning right back",
            r#"{ "hold": ["move_y=1"], "frames": 60 }"#,
        ),
        ("stop", r#"{ "wait": 40 }"#),
        (
            "trot",
            r#"{ "lua": "require('lib.state').carrying = 'hazel'" }, { "hold": ["move_y=-1", "run"], "frames": 90 }"#,
        ),
        (
            "stop with a parcel",
            r#"{ "wait": 30, "lua": "require('lib.state').carrying = nil" }"#,
        ),
        (
            "turn on the spot",
            r#"{ "hold": ["move_x=1"], "frames": 6 }, { "wait": 50 }"#,
        ),
    ] {
        probed(&mut g, "postmaster", name, steps);
        tags.push(name.to_string());
    }
    probed(&mut g, "postmaster", "", r#"{ "wait": 2 }"#);
    let mut seen = Vec::new();
    for t in &tags {
        let (steps, slide, sink, drop, speed) = tag(&g, t);
        seen.push(format!(
            "{t}: {steps} steps up to {speed:.2} m/s, slid {:.2} cm, sank {:.2} cm, hips down {:.1} cm",
            slide * 100.0,
            sink * 100.0,
            drop * 100.0
        ));
        assert!(
            slide < 0.015,
            "{t}: a standing foot slid {slide} m in a step: {seen:#?}"
        );
        assert!(sink < 0.01, "{t}: a standing sole sank {sink} m: {seen:#?}");
        assert!(drop <= 0.1001, "{t}: the hips folded {drop} m: {seen:#?}");
    }
    // every stretch that moves was measured, from a creep to the run
    for t in tags
        .iter()
        .filter(|t| !t.starts_with("stop") && *t != "turn on the spot")
    {
        assert!(tag(&g, t).0 >= 1.0, "{t} has steps: {seen:#?}");
    }
    let creep = tag(&g, "walk 0.2").4;
    let run = tag(&g, "run").4;
    assert!(
        creep < 0.5 && run > 2.8,
        "the sweep goes from a creep to the run: {seen:#?}"
    );
    let err = num(&g, "FP.err");
    // (within a centimetre: a leg at its longest may leave a standing ankle a few millimetres short for a frame)
    assert!(
        err < 0.01,
        "the drawn ankles are where the gait put them: {err} m off"
    );
}

/// Starts, stops and turns read as weight: the speed eases up (about 0.2 s to the full walk, longer to the full run) and settles to
/// a stop (not at once, and not a skate); the body leans into setting off and back as it stops; a turn right back brakes, plants and
/// pivots and never goes backwards facing the wrong way; a push to the side from standing turns on the spot with the feet stepping
/// round; stopped, both feet are down under the hips.
#[test]
fn starts_stops_and_turns_read_as_weight_and_never_go_backwards() {
    let mut g = game();
    play(&mut g, ON_THE_ROAD);
    let speeds = |r: &Report| -> Vec<f64> {
        r.record("nova.named('postmaster').speed")
            .iter()
            .flat_map(|(a, b, v)| {
                std::iter::repeat_n(v.parse::<f64>().unwrap(), (b - a + 1) as usize)
            })
            .collect()
    };
    // setting off: eased (the first frame barely moving), 90% of the walk in 0.15 to 0.3 s, the lean forward more than walking on
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 40, "record": ["nova.named('postmaster').speed", "nova.named('postmaster').walker.out.spine.rx"] } ] }"#,
    );
    let v = speeds(&r);
    assert!(v[0] < 0.4, "eased, not snapped: {v:?}");
    let ninety = v.iter().position(|s| *s >= 0.9 * 1.6).unwrap();
    assert!(
        (9..=18).contains(&ninety),
        "the full walk in 0.15 to 0.3 s: frame {ninety} of {v:?}"
    );
    let lean: Vec<f64> = r
        .record("nova.named('postmaster').walker.out.spine.rx")
        .iter()
        .map(|(_, _, v)| v.parse().unwrap())
        .collect();
    let walking = *lean.last().unwrap();
    assert!(
        lean.iter().cloned().fold(0.0, f64::max) > walking + 0.005,
        "a lean into setting off, more than walking on: {lean:?}"
    );
    // the run takes a little longer to reach than the walk
    play(&mut g, r#"{ "steps": [ { "wait": 40 } ] }"#);
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "run"], "frames": 50, "record": "nova.named('postmaster').speed" } ] }"#,
    );
    let v = speeds(&r);
    let run90 = v.iter().position(|s| *s >= 0.9 * 3.0).unwrap();
    assert!(
        run90 > ninety && run90 < 36,
        "the full run a little later: frame {run90}"
    );
    // stopping from the walk: not at once, but settled within 0.4 s, leaning back
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 50 } ] }"#,
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "wait": 40, "record": ["nova.named('postmaster').speed", "nova.named('postmaster').walker.out.spine.rx"] } ] }"#,
    );
    let v = speeds(&r);
    assert!(v[2] > 0.5, "no instant freeze: {v:?}");
    let still = v.iter().position(|s| *s < 0.02).unwrap();
    assert!(still <= 24, "settled in 0.4 s: frame {still} of {v:?}");
    let back: Vec<f64> = r
        .record("nova.named('postmaster').walker.out.spine.rx")
        .iter()
        .map(|(_, _, v)| v.parse().unwrap())
        .collect();
    assert!(
        back.iter().cloned().fold(1.0, f64::min) < walking - 0.005,
        "leaning back as it stops: {back:?} against {walking}"
    );
    // both feet down under the hips once it has stopped
    let feet = lua(
        &g,
        "(function() local p = nova.named('postmaster'); local o = {}; for i, f in ipairs(p.walker:feet()) do local s, c = math.sin(p.face), math.cos(p.face); \
         local mx = (f.x - p.x) * c - (f.z - p.z) * s; local mz = (f.x - p.x) * s + (f.z - p.z) * c; o[i] = string.format('%s %.3f %.3f', tostring(f.planted), mx, mz) end; return table.concat(o, ' ') end)()",
    );
    let parts: Vec<&str> = feet.split(' ').collect();
    assert_eq!(parts[0], "true", "{feet}");
    assert_eq!(parts[3], "true", "{feet}");
    for z in [parts[2], parts[5]] {
        assert!(
            z.parse::<f64>().unwrap().abs() < 0.08,
            "under the hips: {feet}"
        );
    }
    // a turn right back from the run: it never moves against the way it faces, it ends facing the other way, it brakes first
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "run"], "frames": 60 } ] }"#,
    );
    let r = play(
        &mut g,
        r#"{ "lua": "LASTX, LASTZ, WORST = nova.named('postmaster').x, nova.named('postmaster').z, 1", "each_frame": "local p = nova.named('postmaster'); local dx, dz = p.x - LASTX, p.z - LASTZ; local d = math.sqrt(dx * dx + dz * dz); if d > 1e-4 then WORST = math.min(WORST, (dx * math.sin(p.face) + dz * math.cos(p.face)) / d) end; LASTX, LASTZ = p.x, p.z",
        "steps": [ { "hold": ["move_y=1", "run"], "frames": 90, "record": "string.format('%.3f %.3f', nova.named('postmaster').face, nova.named('postmaster').speed)" } ] }"#,
    );
    let worst = num(&g, "WORST");
    assert!(
        worst > 0.15,
        "it never goes backwards or sideways against its facing: {worst}"
    );
    let face = num(&g, "nova.named('postmaster').face");
    assert!(
        (face.rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI).abs() < 0.2,
        "facing back the other way: {face}"
    );
    let rows = r.record(
        "string.format('%.3f %.3f', nova.named('postmaster').face, nova.named('postmaster').speed)",
    );
    let first: Vec<f64> = rows[4].2.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(
        first[0].abs() < 0.3 && first[1] > 1.0,
        "it brakes before it pivots: {:?}",
        &rows[..8]
    );
    // standing, a push to the side turns it on the spot, the feet stepping round (no skating round on planted feet)
    play(&mut g, r#"{ "steps": [ { "wait": 60 } ] }"#);
    let before = num(
        &g,
        "nova.named('postmaster').walker:feet()[1].steps + nova.named('postmaster').walker:feet()[2].steps",
    );
    let at = (
        num(&g, "nova.named('postmaster').x"),
        num(&g, "nova.named('postmaster').z"),
    );
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_x=1"], "frames": 8 }, { "wait": 60 } ] }"#,
    );
    let after = num(
        &g,
        "nova.named('postmaster').walker:feet()[1].steps + nova.named('postmaster').walker:feet()[2].steps",
    );
    let moved = (num(&g, "nova.named('postmaster').x") - at.0)
        .hypot(num(&g, "nova.named('postmaster').z") - at.1);
    assert!(
        after >= before + 2.0,
        "the feet step round: {before} -> {after}"
    );
    assert!(moved < 0.35, "on the spot, near enough: {moved} m");
    assert_eq!(
        lua(
            &g,
            "tostring(nova.named('postmaster').walker:feet()[1].planted and nova.named('postmaster').walker:feet()[2].planted)"
        ),
        "true"
    );
}

/// The cycle is one for the walk, the run and the trot and it carries on through every change: B pressed and let go, a parcel
/// taken and set down (the animator's "move" and "laden" states), stopping and starting. It only ever moves forward, never jumps,
/// and the footsteps keep an even beat at an even speed.
#[test]
fn the_cycle_carries_on_through_walk_run_trot_and_b_pressed_or_let_go() {
    let mut g = game();
    play(&mut g, ON_THE_ROAD);
    let r = play(
        &mut g,
        r#"{ "lua": "PH, JUMP, BACK = nil, 0, 0", "each_frame": "local a = nova.named('postmaster').anim; local ph = a:cycle(); if PH then local d = (ph - PH) % 1; if d > 0.5 then BACK = BACK + 1 else JUMP = math.max(JUMP, d) end end; PH = ph",
        "steps": [
          { "hold": ["move_y=-1"], "frames": 40 }, { "hold": ["move_y=-1", "run"], "frames": 30 }, { "hold": ["move_y=-1"], "frames": 25 },
          { "hold": ["move_y=-1", "run"], "frames": 12 }, { "hold": ["move_y=-1"], "frames": 12 },
          { "lua": "require('lib.state').carrying = 'pip'" }, { "hold": ["move_y=-1"], "frames": 30 }, { "hold": ["move_y=-1", "run"], "frames": 30 },
          { "lua": "require('lib.state').carrying = nil" }, { "hold": ["move_y=-1", "run"], "frames": 30 }, { "wait": 30 }, { "hold": ["move_y=-0.5"], "frames": 40 } ] }"#,
    );
    assert_eq!(num(&g, "BACK"), 0.0, "the cycle never runs backwards");
    let jump = num(&g, "JUMP");
    assert!(
        jump < 0.2,
        "never more than a fifth of a cycle in a frame: {jump}"
    );
    assert_eq!(lua(&g, "nova.named('postmaster').anim:state()"), "move");
    // at the full walk the steps fall evenly, two a cycle (the cycle's length is the stride over the speed)
    let r2 = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 120 } ] }"#,
    );
    let steps: Vec<u64> = r2.json["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| {
            s["text"]
                .as_str()?
                .starts_with("sound step_")
                .then(|| s["frame"].as_u64())
                .flatten()
        })
        .collect();
    let gaps: Vec<i64> = steps
        .windows(2)
        .map(|w| w[1] as i64 - w[0] as i64)
        .skip(2)
        .collect();
    assert!(gaps.len() >= 6, "{steps:?}");
    let stride = num(&g, "select(2, nova.named('postmaster').anim:cycle())");
    let half = stride / 1.6 / 2.0 * 60.0;
    for gap in &gaps {
        assert!(
            ((*gap as f64) - half).abs() <= 2.5,
            "an even beat of about {half} frames: {gaps:?}"
        );
    }
    let _ = r;
}

/// The springs settle and never blow up, at 30 or 60 steps a second or one long step: nova.spring on its own (solved exactly, so
/// the same at both rates), and the gait's parts that follow (the head, the ears, the tail, the bag, the mittens) driven through
/// the same starts, turns and stops at both rates.
#[test]
fn the_springs_settle_and_never_blow_up_at_30_or_60_steps_a_second() {
    let mut g = game();
    play(&mut g, ON_THE_ROAD);
    let out = lua(
        &g,
        "(function() local o = {}; for _, k in ipairs({ 20, 120, 900 }) do for _, z in ipairs({ 0.05, 0.3, 1 }) do \
           local a, b, c = nova.spring { stiffness = k, damping = z }, nova.spring { stiffness = k, damping = z }, nova.spring { stiffness = k, damping = z }; \
           local most, diff = 0, 0; \
           for i = 1, 300 do a:update(1, 1 / 60); if i % 2 == 0 then b:update(1, 1 / 30); diff = math.max(diff, math.abs(a.value - b.value)) end; most = math.max(most, math.abs(a.value)) end; \
           for i = 1, 20 do c:update(1, 0.25) end; \
           o[#o + 1] = string.format('%g %g %.6f %.6f %.6f %.6f', k, z, a.value, most, diff, c.value) end end; return table.concat(o, '|') end)()",
    );
    for row in out.split('|') {
        let v: Vec<f64> = row.split(' ').map(|s| s.parse().unwrap()).collect();
        let (k, z, end, most, diff, long) = (v[0], v[1], v[2], v[3], v[4], v[5]);
        assert!(diff < 1e-6, "{row}: the same at 30 and 60 steps a second");
        assert!(
            most < 2.0 && most.is_finite(),
            "{row}: never more than one overshoot"
        );
        if z >= 1.0 {
            assert!(most <= 1.0 + 1e-9, "{row}: damping 1 never overshoots");
        }
        if z * k.sqrt() * 5.0 > 9.0 {
            assert!((end - 1.0).abs() < 1e-3, "{row}: settled in 5 s");
        }
        assert!(
            long.is_finite() && long.abs() < 2.0,
            "{row}: a long step is safe"
        );
    }
    // the gait's followers, through a start, a turn and a stop, at both rates: never past their limits, and nearly the same
    let run = |rate: u32| -> Vec<f64> {
        let out = lua(
            &g,
            &format!(
                "(function() local e = {{ x = 0, z = 0, face = 0, y = 0, speed = 0 }}; \
                 local anim = nova.animator('postmaster', {{ start = 'move', states = {{ move = {{ blend = 'speed', by = 'distance', points = {{ {{ 0, 'idle' }}, {{ 1.6, 'walk' }}, {{ 3, 'run' }} }} }} }} }}); \
                 local walker = nova.gait('postmaster', {{ follow = nova.named('postmaster').walker.o.follow }}); \
                 local dt = 1 / {rate}; local most, bad = 0, false; local rms, n = {{}}, 0; \
                 for i = 1, 3 * {rate} do local t = i * dt; \
                   local want = t < 1 and 3 or t < 2 and 1.6 or 0; e.speed = e.speed + (want - e.speed) * math.min(1, dt * 8); \
                   if t > 1 and t < 1.6 then e.face = e.face + 2.5 * dt end; \
                   e.x, e.z = e.x + math.sin(e.face) * e.speed * dt, e.z + math.cos(e.face) * e.speed * dt; \
                   anim:set('speed', e.speed); walker:update(dt, e, anim); \
                   for _, f in ipairs(walker.followers) do for _, ax in ipairs(f.axes) do local v = ax.spring.value; if v ~= v or math.abs(v) > f.max + 1e-6 then bad = true end; most = math.max(most, math.abs(v)) end end; \
                   if t < 2 then n = n + 1; local k = 0; for _, f in ipairs(walker.followers) do for _, ax in ipairs(f.axes) do k = k + 1; rms[k] = (rms[k] or 0) + ax.spring.value ^ 2 end end end end; \
                 local o = {{}}; for k = 1, #rms do o[k] = math.sqrt(rms[k] / n) end; \
                 for _, f in ipairs(walker.followers) do for _, ax in ipairs(f.axes) do o[#o + 1] = ax.spring.value end end; \
                 return tostring(bad) .. ' ' .. most .. ' ' .. #rms .. ' ' .. table.concat(o, ' ') end)()"
            ),
        );
        let mut v = out.split(' ');
        assert_eq!(
            v.next(),
            Some("false"),
            "a spring went past its limit or blew up at {rate} a second"
        );
        v.map(|s| s.parse().unwrap()).collect()
    };
    // (the most any part turned, then each spring's swing while moving (root mean square), then where each is a second after the stop)
    let (a, b) = (run(30), run(60));
    assert!(a[0] > 0.02, "the parts did move: {}", a[0]);
    assert_eq!(a.len(), b.len());
    let n = a[1] as usize;
    for (x, y) in a[2..2 + n].iter().zip(&b[2..2 + n]) {
        assert!(
            (x - y).abs() < 0.02 + 0.35 * x.max(*y),
            "30 and 60 steps a second swing alike: {:?} {:?}",
            &a[2..2 + n],
            &b[2..2 + n]
        );
    }
    // and a second after the stop, everything has settled
    for v in a[2 + n..].iter().chain(&b[2 + n..]) {
        assert!(v.abs() < 0.1, "settled: {a:?} {b:?}");
    }
}

/// Up and down a steep hillside, across it, up the post office's porch steps and over the bridge: the standing soles stay on the
/// ground (neither sinking nor floating) and do not slide.
#[test]
fn feet_stay_on_the_ground_on_a_hillside_the_porch_steps_and_the_bridge() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    install_probe(&g);
    // the steepest open grass within 40 m of the road south of the post office
    let spot = lua(
        &g,
        "(function() local W = require('lib.world'); local bx, bz, best = 0, 0, 0; for x = -36, 44, 2 do for z = -160, -90, 2 do \
           local gx, gz = nova.terrain_slope(x, z); local s = math.sqrt(gx * gx + gz * gz); \
           if s > best and not W.blocked(x, z, 2.0) and not nova.scenery.push(x, z, 2.0) and W.lift(x, z) == 0 then best, bx, bz = s, x, z end end end; \
           local gx, gz = nova.terrain_slope(bx, bz); return string.format('%.3f %.3f %.4f %.4f', bx, bz, gx, gz) end)()",
    );
    let v: Vec<f64> = spot.split(' ').map(|s| s.parse().unwrap()).collect();
    let (x, z, gx, gz) = (v[0], v[1], v[2], v[3]);
    let s = gx.hypot(gz);
    assert!(s > 0.2, "a steep hillside: {spot}");
    let (ux, uz) = (gx / s, gz / s);
    // up it, down it, across it (each a walk of a few metres through the spot)
    for (name, dx, dz) in [
        ("uphill", ux, uz),
        ("downhill", -ux, -uz),
        ("across", -uz, ux),
    ] {
        let (sx, sz) = (x - dx * 2.5, z - dz * 2.5);
        let (tx, tz) = (x + dx * 2.5, z + dz * 2.5);
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = {sx}, {sz}, math.atan({dx}, {dz}); p.walk_to, p.walk_path = nil, nil" }}, {{ "wait": 20 }} ] }}"#
            ),
        );
        probed(
            &mut g,
            "postmaster",
            name,
            &format!(
                r#"{{ "lua": "local p = nova.named('postmaster'); p.walk_path = {{ {{ {tx}, {tz} }} }}; p.walk_pace = 1.6" }}, {{ "wait": 150 }}"#
            ),
        );
    }
    // the porch steps up to the post office's door, and over the bridge's deck
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.x, p.z = d.x + fx * 6, d.z + fz * 6; p.face = math.atan(-fx, -fz); p.walk_to, p.walk_path = nil, nil" }, { "wait": 20 } ] }"#,
    );
    probed(
        &mut g,
        "postmaster",
        "porch",
        r#"{ "lua": "local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.walk_path = { { d.x + fx * 1.4, d.z + fz * 1.4 } }; p.walk_pace = 1.6" }, { "wait": 260 }"#,
    );
    let porch_lift = num(
        &g,
        "require('lib.world').lift(nova.named('postmaster').x, nova.named('postmaster').z)",
    );
    assert!(porch_lift > 0.1, "up on the porch: {porch_lift}");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); local b = require('lib.world').bridge; p.x, p.z = b.ax - b.dx * 2, b.az - b.dz * 2; p.face = math.atan(b.dx, b.dz); p.walk_to, p.walk_path = nil, nil" }, { "wait": 20 } ] }"#,
    );
    probed(
        &mut g,
        "postmaster",
        "bridge",
        r#"{ "lua": "local p = nova.named('postmaster'); local b = require('lib.world').bridge; p.walk_path = { { b.ax + b.dx * b.len * 0.5, b.az + b.dz * b.len * 0.5 } }; p.walk_pace = 1.6" }, { "wait": 420 }"#,
    );
    probed(&mut g, "postmaster", "", r#"{ "wait": 2 }"#);
    for name in ["uphill", "downhill", "across", "porch", "bridge"] {
        let (steps, slide, sink, _, _) = tag(&g, name);
        assert!(steps >= 3.0, "{name}: walked ({steps} steps)");
        assert!(slide < 0.015, "{name}: a foot slid {slide} m");
        assert!(sink < 0.012, "{name}: a sole sank {sink} m");
        // (and a flat standing sole is on the ground, the deck or the step, not floating over it)
        let float = num(&g, &format!("FP_TAG('{name}').float"));
        assert!(
            float < 0.012,
            "{name}: a standing sole floated {float} m over the ground"
        );
    }
}

/// Hazel and Pip walk the same way, each with a character: their feet do not slide either; Hazel is heavier and slower (fewer steps a
/// second, a rolling gait: more roll of the hips, less bounce), Pip light and bouncy (a quicker beat, more bounce, his long ears
/// trailing back as he goes and swinging far more than the fox's).
#[test]
fn hazel_and_pip_walk_on_planted_feet_each_in_their_own_way() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    install_probe(&g);
    let mut beat = Vec::new();
    for (who, mailbox) in [("hazel", "mailbox_3"), ("pip", "mailbox_7")] {
        // the postmaster comes near: they walk to their gate; then he goes: they walk back to their work
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "local r = nova.named('{who}'); local p = nova.named('postmaster'); local b = nova.named('{mailbox}'); local dx, dz = b.x - r.x, b.z - r.z; local d = math.sqrt(dx * dx + dz * dz); p.x, p.z, p.control = r.x + dx / d * 6, r.z + dz / d * 6, false; R_ROLL, R_DROP, R_EAR = 0, 0, 0" }} ] }}"#
            ),
        );
        probed(
            &mut g,
            who,
            &format!("{who} out"),
            &format!(
                r#"{{ "wait": 120, "record": "string.format('%.3f %.3f %.3f %.3f', nova.named('{who}').speed, nova.named('{who}').walker.phase, nova.named('{who}').walker.drop or 0, nova.named('{who}').walker.out.ear_l and nova.named('{who}').walker.out.ear_l.rx or 0)" }}"#
            ),
        );
        let r = probed(
            &mut g,
            who,
            &format!("{who} back"),
            r#"{ "lua": "local p = nova.named('postmaster'); p.x = p.x + 40" }, { "wait": 150 }"#,
        );
        let _ = r;
        play(
            &mut g,
            r#"{ "steps": [ { "lua": "nova.named('postmaster').x = nova.named('postmaster').x - 40" }, { "wait": 2 } ] }"#,
        );
        // how quickly the cycle goes round at their walking speed, the bounce and the ears, while walking at their own speed
        let rows = lua(
            &g,
            &format!(
                "(function() local r = nova.named('{who}'); local e = {{ x = 0, z = 0, face = 0, y = 0, speed = 0, model = '{who}' }}; \
                 local anim = nova.animator('{who}', r.anim.spec); anim:play('move'); local w = nova.gait('{who}', r.walker.o); \
                 local dt, v = 1 / 60, r.anim.spec.states.move.points[2][1]; local cycles, lo, hi, ear, roll = 0, 1, -1, 0, 0; local last = 0; \
                 for i = 1, 240 do e.speed = math.min(v, e.speed + dt * 4); e.z = e.z + e.speed * dt; anim:set('speed', e.speed); w:update(dt, e, anim); \
                   if i > 120 then cycles = cycles + ((w.phase - last) % 1); local d = w.drop or 0; lo, hi = math.min(lo, d), math.max(hi, d); \
                     if w.out.ear_l then ear = math.max(ear, math.abs(w.out.ear_l.rx or 0)) end; \
                     local q = w.out.hips.quat; roll = math.max(roll, math.abs(2 * (q.w * q.z + q.x * q.y))) end; last = w.phase end; \
                 return string.format('%.4f %.4f %.4f %.4f %.4f', cycles / 2, hi - lo, ear, roll, v) end)()"
            ),
        );
        beat.push((who, rows));
    }
    play(&mut g, r#"{ "steps": [ { "wait": 2 } ] }"#);
    for who in ["hazel out", "hazel back", "pip out", "pip back"] {
        let (steps, slide, sink, _, _) = tag(&g, who);
        assert!(steps >= 3.0, "{who}: walked ({steps} steps)");
        assert!(slide < 0.015, "{who}: a foot slid {slide} m");
        assert!(sink < 0.01, "{who}: a sole sank {sink} m");
    }
    let parse = |s: &str| -> Vec<f64> { s.split(' ').map(|x| x.parse().unwrap()).collect() };
    let (h, p) = (parse(&beat[0].1), parse(&beat[1].1));
    // (cycles a second, the hips' bob, the ears' swing, the hips' roll, the walking speed)
    assert!(h[4] < p[4], "Hazel walks slower: {h:?} {p:?}");
    assert!(
        h[0] < p[0] * 0.85,
        "Hazel takes fewer steps a second: {h:?} {p:?}"
    );
    assert!(p[1] > h[1] * 1.5, "Pip bounces more: {h:?} {p:?}");
    assert!(
        h[3] > p[3] * 1.5,
        "Hazel rolls more over each foot: {h:?} {p:?}"
    );
    assert!(p[2] > 0.08, "Pip's ears trail back as he walks: {p:?}");
    let fox_ear = num(
        &g,
        "(function() local p = nova.named('postmaster'); local most = 0; for _, f in ipairs(p.walker.followers) do if f.part == 'ear_l' then for _, ax in ipairs(f.axes) do if ax.name == 'rx' then most = math.abs(ax.gains.speed or 0) end end end end; return most end)()",
    );
    let pip_ear = num(
        &g,
        "(function() local p = nova.named('pip'); local most = 0; for _, f in ipairs(p.walker.followers) do if f.part == 'ear_l' then for _, ax in ipairs(f.axes) do if ax.name == 'rx' then most = math.abs(ax.gains.speed or 0) end end end end; return most end)()",
    );
    assert!(
        pip_ear > fox_ear * 2.0,
        "Pip's long ears trail far more than the fox's: {pip_ear} {fox_ear}"
    );
}

// ---- the owner's polish note on the roads (2026-11-23): no gaps and no overlaps where roads meet, a logical change of surface ----

/// The valley's roads as the engine reads them: models/road_valley.glb's triangles (x, y, z, and u), from road_make's network
/// builder (scripts/lib/roadnet.mjs).
fn valley_road_triangles() -> Vec<[[f32; 4]; 3]> {
    let bytes = std::fs::read(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/mountain-post/models/road_valley.glb"),
    )
    .expect("the valley's roads: models/road_valley.glb (tools/terrain.mjs)");
    let mesh = nova_runtime::model::import_glb(&bytes).expect("the roads' glb");
    let v = |i: u32| {
        let m = &mesh.vertices[i as usize];
        [m.position[0], m.position[1], m.position[2], m.uv[0]]
    };
    mesh.indices
        .chunks(3)
        .map(|t| [v(t[0]), v(t[1]), v(t[2])])
        .collect()
}

/// "We need to adjust the road builder so that there are no gaps between connected roads and no overlaps in connected roads."
/// Fernhollow's whole network is one surface: every edge is the outline (one triangle) or shared by exactly two triangles with the
/// same end points, the outline closes into two loops (the bridge cuts Kettle Creek Road in two), one height at each place, and
/// sampled every quarter metre no point is covered twice and none inside the outline is left open.
#[test]
fn valley_roads_are_one_surface_with_no_gap_and_no_overlap() {
    use std::collections::HashMap;
    let tris = valley_road_triangles();
    assert!(tris.len() > 5000, "{} triangles", tris.len());
    type Key = (u32, u32);
    let key = |p: &[f32; 4]| (p[0].to_bits(), p[2].to_bits());
    let mut heights: HashMap<Key, f32> = HashMap::new();
    let mut edges: HashMap<(Key, Key), u32> = HashMap::new();
    let mut area = 0.0f64;
    for t in &tris {
        for p in t {
            let h = *heights.entry(key(p)).or_insert(p[1]);
            assert!(
                (h - p[1]).abs() < 1e-5,
                "two heights at {}, {}: {h} and {}",
                p[0],
                p[2],
                p[1]
            );
        }
        let (a, b, c) = (t[0], t[1], t[2]);
        area +=
            (((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) as f64).abs() / 2.0;
        for e in 0..3 {
            let (p, q) = (key(&t[e]), key(&t[(e + 1) % 3]));
            *edges
                .entry(if p < q { (p, q) } else { (q, p) })
                .or_default() += 1;
        }
    }
    let outline: Vec<_> = edges
        .iter()
        .filter(|(_, n)| **n == 1)
        .map(|(e, _)| *e)
        .collect();
    assert!(
        edges.values().all(|n| *n <= 2),
        "an edge used by three triangles or more"
    );
    // the outline: every vertex on it has an even number of outline edges (a crack or a T-junction leaves an odd one), in two loops
    let mut degree: HashMap<(u32, u32), u32> = HashMap::new();
    let mut adj: HashMap<(u32, u32), Vec<(u32, u32)>> = HashMap::new();
    for (p, q) in &outline {
        *degree.entry(*p).or_default() += 1;
        *degree.entry(*q).or_default() += 1;
        adj.entry(*p).or_default().push(*q);
        adj.entry(*q).or_default().push(*p);
    }
    let odd = degree.values().filter(|n| **n % 2 == 1).count();
    assert_eq!(
        odd, 0,
        "outline vertices that do not close (cracks or T-junctions)"
    );
    let mut seen = std::collections::HashSet::new();
    let mut loops = 0;
    for start in adj.keys() {
        if seen.contains(start) {
            continue;
        }
        loops += 1;
        let mut stack = vec![*start];
        while let Some(p) = stack.pop() {
            if seen.insert(p) {
                stack.extend(adj[&p].iter().copied());
            }
        }
    }
    assert_eq!(
        loops, 2,
        "the outline's loops: the network either side of the bridge"
    );
    // coverage, sampled every quarter metre (points on an edge left out)
    let step = 0.25f32;
    let (mut x0, mut z0, mut x1, mut z1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for t in &tris {
        for p in t {
            x0 = x0.min(p[0]);
            x1 = x1.max(p[0]);
            z0 = z0.min(p[2]);
            z1 = z1.max(p[2]);
        }
    }
    let (ox, oz) = (x0 + step * 0.3731, z0 + step * 0.6119);
    let (nx, nz) = (
        ((x1 - ox) / step) as usize + 2,
        ((z1 - oz) / step) as usize + 2,
    );
    let mut count = vec![0u8; nx * nz];
    let mut on_edge = vec![false; nx * nz];
    for t in &tris {
        let (a, b, c) = (t[0], t[1], t[2]);
        let d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
        if d.abs() < 1e-9 {
            continue;
        }
        let i0 = ((a[0].min(b[0]).min(c[0]) - ox) / step).floor().max(0.0) as usize;
        let i1 = (((a[0].max(b[0]).max(c[0]) - ox) / step).ceil() as usize).min(nx - 1);
        let j0 = ((a[2].min(b[2]).min(c[2]) - oz) / step).floor().max(0.0) as usize;
        let j1 = (((a[2].max(b[2]).max(c[2]) - oz) / step).ceil() as usize).min(nz - 1);
        for j in j0..=j1 {
            for i in i0..=i1 {
                let (px, pz) = (ox + i as f32 * step, oz + j as f32 * step);
                let w0 = ((b[0] - px) * (c[2] - pz) - (b[2] - pz) * (c[0] - px)) / d;
                let w1 = ((c[0] - px) * (a[2] - pz) - (c[2] - pz) * (a[0] - px)) / d;
                let m = w0.min(w1).min(1.0 - w0 - w1);
                if m > 1e-5 {
                    count[j * nx + i] += 1;
                } else if m > -1e-5 {
                    on_edge[j * nx + i] = true;
                }
            }
        }
    }
    let (mut holes, mut overlaps, mut covered) = (0, 0, 0);
    for j in 0..nz {
        let pz = oz + j as f32 * step;
        let mut xs: Vec<f32> = outline
            .iter()
            .filter_map(|(p, q)| {
                let (ax, az) = (f32::from_bits(p.0), f32::from_bits(p.1));
                let (bx, bz) = (f32::from_bits(q.0), f32::from_bits(q.1));
                ((az > pz) != (bz > pz)).then(|| ax + (pz - az) / (bz - az) * (bx - ax))
            })
            .collect();
        xs.sort_by(f32::total_cmp);
        for i in 0..nx {
            let k = j * nx + i;
            if on_edge[k] {
                continue;
            }
            let px = ox + i as f32 * step;
            let inside = xs.iter().filter(|x| **x > px).count() % 2 == 1;
            match count[k] {
                0 if inside => holes += 1,
                1 => covered += 1,
                n if n >= 2 => overlaps += 1,
                _ => {}
            }
        }
    }
    assert_eq!(overlaps, 0, "points covered twice (overlap)");
    assert_eq!(
        holes, 0,
        "points inside the roads' outline not covered (a gap)"
    );
    let sampled = covered as f64 * (step * step) as f64;
    assert!(
        (sampled - area).abs() / area < 0.01,
        "area of the union {sampled:.0} m2 against the triangles' {area:.0} m2"
    );
}

/// "If the road surface changes, there should be a logical transition between the two surfaces." Where a gravel lane leaves the
/// tarmac road, tarmac (the asphalt column of the road sheet) meets gravel (its gravel column) only in a band at the end of the
/// junction's apron, at each of the two junctions: nowhere else do the two surfaces touch. And the game hears it so: tarmac on
/// the junction, gravel past the apron.
#[test]
fn valley_roads_tarmac_meets_gravel_only_at_the_end_of_each_junctions_apron() {
    use std::collections::HashMap;
    let tris = valley_road_triangles();
    // (the sheet's columns, 192 of 1024 texels each: asphalt first, gravel third; the paint strips from 960. A triangle's column
    // is where the middle of its corners' u falls: a corner on the outer edge sits on the column's border)
    let kind = |t: &[[f32; 4]; 3]| {
        let u = (t[0][3] + t[1][3] + t[2][3]) / 3.0;
        let c = (u * 1024.0 / 192.0).floor() as i32;
        (c < 5).then_some(c)
    };
    type Key = (u32, u32);
    let mut edges: HashMap<(Key, Key), Vec<Option<i32>>> = HashMap::new();
    for t in &tris {
        for e in 0..3 {
            let p = (t[e][0].to_bits(), t[e][2].to_bits());
            let q = (t[(e + 1) % 3][0].to_bits(), t[(e + 1) % 3][2].to_bits());
            edges
                .entry(if p < q { (p, q) } else { (q, p) })
                .or_default()
                .push(kind(t));
        }
    }
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "#require('lib.road_junctions')"), "2");
    let junctions: Vec<(f32, f32, f32, String)> = (1..=2)
        .map(|i| {
            let j = format!("require('lib.road_junctions')[{i}]");
            (
                num(&g, &format!("{j}.at[1]")) as f32,
                num(&g, &format!("{j}.at[2]")) as f32,
                num(&g, &format!("{j}.paved")) as f32,
                lua(&g, &format!("{j}.road")),
            )
        })
        .collect();
    let mut meets = vec![0; junctions.len()];
    for ((p, _), kinds) in &edges {
        if kinds.len() == 2 && kinds[0].is_some() && kinds[1].is_some() && kinds[0] != kinds[1] {
            let (x, z) = (f32::from_bits(p.0), f32::from_bits(p.1));
            let at = junctions
                .iter()
                .position(|(jx, jz, paved, _)| {
                    let d = ((x - jx).powi(2) + (z - jz).powi(2)).sqrt();
                    d < paved + 3.0 && d > paved - 4.0
                })
                .unwrap_or_else(|| {
                    panic!("tarmac meets gravel at {x:.1}, {z:.1}, away from any junction's apron")
                });
            meets[at] += 1;
        }
    }
    for (k, (_, _, paved, road)) in junctions.iter().enumerate() {
        assert!(
            meets[k] > 10,
            "{road}: the tarmac apron ({paved:.1} m) ends in a ragged band ({} edges)",
            meets[k]
        );
    }
    for (x, z, paved, road) in &junctions {
        assert_eq!(
            lua(&g, &format!("require('lib.world').surface({x}, {z})")),
            "road",
            "the junction with {road}"
        );
        let far = format!(
            "(function() local W = require('lib.world'); for _, r in ipairs(W.roads) do if r.id == '{road}' then for _, p in ipairs(r.points) do if (p[1] - {x}) ^ 2 + (p[2] - {z}) ^ 2 > ({paved} + 2) ^ 2 then return W.surface(p[1], p[2]) end end end end end)()"
        );
        assert_eq!(lua(&g, &far), "gravel", "{road} past its apron");
    }
}

/// The ground under each junction is one level where the roads meet (within 4.5 m of the node it varies by less than 15 cm), and
/// the van drives from Post Road through the Fern Lane junction to Hazel's and on through Kettle Creek Road's to Pip's with its body
/// shaken no more within 25 m of a junction than anywhere else on the roads (its vertical acceleration).
#[test]
fn valley_roads_junctions_are_level_and_the_van_drives_through_them_smoothly() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    for i in 1..=2 {
        let j = format!("require('lib.road_junctions')[{i}]");
        let (x, z) = (
            num(&g, &format!("{j}.at[1]")),
            num(&g, &format!("{j}.at[2]")),
        );
        let spread = num(
            &g,
            &format!(
                "(function() local h0, worst = nova.terrain_height({x}, {z}), 0 for a = 0, 6.2, 0.4 do for _, r in ipairs({{ 1.5, 3, 4.5 }}) do worst = math.max(worst, math.abs(nova.terrain_height({x} + math.cos(a) * r, {z} + math.sin(a) * r) - h0)) end end return worst end)()"
            ),
        );
        assert!(
            spread < 0.15,
            "junction {i}: the ground within 4.5 m of the node varies by {spread:.3} m"
        );
    }
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [
            { "wait": 5, "lua": "T = require('lib.testkit'); J = require('lib.road_junctions'); NEAR, FAR, PV = 0, 0, nil; local v = nova.named('van'); local s = nova.scene_now(); s.mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').seated = true; v:teleport(4, -110, 0); T.drive('hazel')" },
            { "until": "T.arrived()", "max": 4000 },
            { "lua": "T.drive('pip')" },
            { "until": "T.arrived()", "max": 6000 } ],
          "each_frame": "local v = nova.named('van'); local sp = v.susp; if sp and sp.vy then if PV then local a = math.abs(sp.vy - PV) * 60; local near = false; for _, j in ipairs(J) do if (v.x - j.at[1]) ^ 2 + (v.z - j.at[2]) ^ 2 < 625 then near = true end end; if near then NEAR = math.max(NEAR, a) elseif math.abs(v.speed) > 4 then FAR = math.max(FAR, a) end end; PV = sp.vy end" }"#,
    );
    assert_eq!(
        lua(&g, "tostring(T.arrived())"),
        "true",
        "the van reached Pip's"
    );
    let (near, far) = (num(&g, "NEAR"), num(&g, "FAR"));
    assert!(near > 0.0 && far > 0.0, "measured: {near} {far}");
    assert!(
        near < 2.5 && near <= far * 1.2,
        "the body's vertical acceleration through the junctions {near:.2} m/s2, elsewhere {far:.2}"
    );
}

/// "Nothing stands on a road." Every object the valley's scene places (a signpost, a mailbox, a gate post, a fence, a wall, a tree,
/// a rock, a bench, the old bridge's ruins...) keeps its ground footprint (its model's vertices less than 0.6 m above its foot, turned
/// and sized as the scene places it) off the road surface, junction patches, corners, aprons and rounded ends included, by 0.3 m or
/// more; a signpost by 0.75 m. Only the BRIDGE OUT barrier stands across its road's end (by name), and the bridge carries its road.
#[test]
fn valley_roads_nothing_placed_stands_on_a_road() {
    use std::collections::HashMap;
    let root =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/mountain-post");
    let tris = valley_road_triangles();
    // the road's triangles and its outline's edges, filed by 4 m square
    let cell = 4.0f32;
    let key = |x: f32, z: f32| ((x / cell).floor() as i32, (z / cell).floor() as i32);
    let mut bins: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    type Key = (u32, u32);
    let mut edges: HashMap<(Key, Key), u32> = HashMap::new();
    for (k, t) in tris.iter().enumerate() {
        let (x0, x1) = (
            t.iter().map(|p| p[0]).fold(f32::MAX, f32::min),
            t.iter().map(|p| p[0]).fold(f32::MIN, f32::max),
        );
        let (z0, z1) = (
            t.iter().map(|p| p[2]).fold(f32::MAX, f32::min),
            t.iter().map(|p| p[2]).fold(f32::MIN, f32::max),
        );
        for i in key(x0, z0).0..=key(x1, z1).0 {
            for j in key(x0, z0).1..=key(x1, z1).1 {
                bins.entry((i, j)).or_default().push(k);
            }
        }
        for e in 0..3 {
            let p = (t[e][0].to_bits(), t[e][2].to_bits());
            let q = (t[(e + 1) % 3][0].to_bits(), t[(e + 1) % 3][2].to_bits());
            *edges
                .entry(if p < q { (p, q) } else { (q, p) })
                .or_default() += 1;
        }
    }
    let outline: Vec<[f32; 4]> = edges
        .iter()
        .filter(|(_, n)| **n == 1)
        .map(|((p, q), _)| {
            [
                f32::from_bits(p.0),
                f32::from_bits(p.1),
                f32::from_bits(q.0),
                f32::from_bits(q.1),
            ]
        })
        .collect();
    let on_road = |x: f32, z: f32| {
        bins.get(&key(x, z)).is_some_and(|list| {
            list.iter().any(|&k| {
                let [a, b, c] = tris[k];
                let d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
                if d.abs() < 1e-9 {
                    return false;
                }
                let w0 = ((b[0] - x) * (c[2] - z) - (b[2] - z) * (c[0] - x)) / d;
                let w1 = ((c[0] - x) * (a[2] - z) - (c[2] - z) * (a[0] - x)) / d;
                w0 >= 0.0 && w1 >= 0.0 && w0 + w1 <= 1.0
            })
        })
    };
    let to_edge = |x: f32, z: f32| {
        outline
            .iter()
            .map(|[ax, az, bx, bz]| {
                let (dx, dz) = (bx - ax, bz - az);
                let t = (((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz).max(1e-9))
                    .clamp(0.0, 1.0);
                ((x - ax - dx * t).powi(2) + (z - az - dz * t).powi(2)).sqrt()
            })
            .fold(f32::MAX, f32::min)
    };
    let scene: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("scenes/valley.scene.json")).unwrap(),
    )
    .unwrap();
    let mut feet: HashMap<String, Vec<[f32; 2]>> = HashMap::new();
    let (mut checked, mut kinds) = (0, std::collections::BTreeSet::new());
    for o in scene["objects"].as_array().unwrap() {
        let kind = o["kind"].as_str().unwrap().to_string();
        let name = o["name"].as_str().unwrap_or("");
        if name == "barrier"
            || ["bridge", "van", "postmaster", "hazel", "pip"].contains(&kind.as_str())
        {
            continue;
        }
        let foot = feet.entry(kind.clone()).or_insert_with(|| {
            let Ok(bytes) = std::fs::read(root.join(format!("models/{kind}.glb"))) else {
                return vec![];
            };
            let Ok(mesh) = nova_runtime::model::import_glb(&bytes) else {
                return vec![];
            };
            mesh.vertices
                .iter()
                .filter(|v| v.position[1] < 0.6)
                .map(|v| [v.position[0], v.position[2]])
                .collect()
        });
        if foot.is_empty() {
            continue;
        }
        let props = &o["props"];
        let (ry, sx) = (
            props["ry"].as_f64().unwrap_or(0.0) as f32,
            props["sx"].as_f64().unwrap_or(1.0) as f32,
        );
        let (ox, oz) = (
            o["x"].as_f64().unwrap() as f32,
            o["z"].as_f64().unwrap() as f32,
        );
        // (far from every road: nothing to check)
        if to_edge(ox, oz) > 40.0 {
            continue;
        }
        let want = if kind == "signpost" { 0.75 } else { 0.3 };
        let (c, s) = (ry.cos(), ry.sin());
        for [x, z] in foot.iter() {
            let (wx, wz) = (ox + (x * c + z * s) * sx, oz + (-x * s + z * c) * sx);
            assert!(
                !on_road(wx, wz),
                "{} ({kind}) at {ox}, {oz} stands on the road at {wx:.2}, {wz:.2}",
                if name.is_empty() { &kind } else { name }
            );
            let d = to_edge(wx, wz);
            assert!(
                d >= want,
                "{} ({kind}) at {ox}, {oz} is {d:.2} m from the road's edge at {wx:.2}, {wz:.2} (needs {want} m)",
                if name.is_empty() { &kind } else { name }
            );
        }
        checked += 1;
        kinds.insert(kind);
    }
    assert!(checked > 100, "objects near a road checked: {checked}");
    for k in [
        "signpost",
        "mailbox",
        "gate_post",
        "stone_wall",
        "old_bridge",
    ] {
        assert!(kinds.contains(k), "no {k} was checked: {kinds:?}");
    }
}
