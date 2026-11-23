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
    // moving, Y does not get out (into D first: the brake held, A three times from P)
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "press": "confirm", "frames": 10 }, { "hold": ["brake"], "press": "confirm", "frames": 10 }, { "hold": ["brake"], "press": "confirm", "frames": 10 },
        { "hold": ["go"], "frames": 150 }, { "hold": ["go"], "press": "van", "frames": 10 } ] }"#,
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
                {{ "wait": 5, "lua": "local v = nova.named('van'); v:teleport({x}, {z}, {heading}); nova.scene_now().mode = 'van'; v.driven = true; v.gear = 'D'; v.engine_on = true; nova.named('postmaster').seated = true" }},
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
        // the minimap: its disc's middle and reach, from the disc sprite (in the left half: the van's speedometer in the bottom right
        // is drawn on the same painted disc, with the same strokes for its ticks and needle, since the sixth play)
        let left = |s: &Value| s["x"].as_f64().unwrap_or(0.0) < 480.0;
        let disc: Vec<Value> = r
            .drawn("ui_sprite", Some("minimap_disc"))
            .into_iter()
            .filter(|s| left(s))
            .collect();
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
                left(s) && (n.ends_with("minimap_road") || n.ends_with("minimap_joint"))
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
                    || n.ends_with("ui/minimap_rim")
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
        { "wait": 5, "lua": "local v = nova.named('van'); v:teleport(6, -100, 0); nova.scene_now().mode = 'van'; v.driven = true; v.gear = 'D'; nova.named('postmaster').seated = true" },
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
            && line("postmaster").contains("hat: \"bucket\"")
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
    assert_eq!(lua(&g, "require('lib.state').VAN_HOLDS"), "4");
    assert_eq!(
        lua(&g, "table.concat(require('lib.state').van_load, ' ')"),
        "hazel pip"
    );
    // the panel: the first loaded, its label, and L1 and R1 to go round
    let r = play(&mut g, r#"{ "steps": [ { "wait": 3 } ] }"#);
    assert_eq!(lua(&g, "nova.scene_now():picker()"), "hazel");
    assert_eq!(r.drawn_count("ui_text", Some("Van 2/4")), 1);
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
    assert_eq!(r.drawn_count("ui_text", Some("Van 1/4")), 1);
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
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in(); nova.named('van').gear = 'D'" },
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
                "ui/minimap_rim",
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
    assert_eq!(r.drawn_count("ui_text", Some("Van 1/4")), 1);
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
        "(function() local v = nova.named('van'); v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; v.ctl.go, v.ctl.brake, v.ctl.steer = 1, 0, 0; \
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
        "(function() local v = nova.named('van'); local T = v.TUNE; v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; \
         local function hold(go, steer, n) local w = { steer = 0, yaw = 0, side = 0 }; for i = 1, n do local s0, y0 = v.steer, v.yaw_rate or 0; v.ctl.go, v.ctl.brake, v.ctl.steer = go, 0, steer; v:drive(1 / 60); v.x, v.z = 4.5, -150; \
           w.steer = math.max(w.steer, math.abs(v.steer - s0)); w.yaw = math.max(w.yaw, math.abs((v.yaw_rate or 0) - y0)); w.side = math.max(w.side, math.abs((v.yaw_rate or 0) * v.speed)) end; return w end; \
         hold(1, 0, 1800); local fast = v.speed; local a = hold(1, -1, 240); local lock_fast = math.abs(v.steer); local b = hold(1, 1, 120); \
         v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; hold(0.25, 0, 60); local c = hold(0.25, -1, 240); local lock_slow = math.abs(v.steer); \
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
        { "wait": 5, "lua": "PARKED = LIT(); nova.named('van').gear = 'D'" },
        { "hold": ["go"], "frames": 120, "lua": "" },
        { "hold": ["go"], "frames": 1, "lua": "DRIVING = LIT()" },
        { "hold": ["brake"], "frames": 6 },
        { "hold": ["brake"], "frames": 1, "lua": "BRAKING = LIT(); BRAKE_SPEED = nova.named('van').speed" },
        { "hold": ["brake"], "until": "nova.named('van'):stopped()", "max": 400 },
        { "hold": ["brake"], "until": "math.abs(nova.named('van').speed) < 0.3", "max": 100, "lua": "nova.named('van').gear = 'R'" },
        { "hold": ["go"], "until": "nova.named('van').speed < -0.8", "max": 400 },
        { "hold": ["go"], "frames": 1, "lua": "REVERSING = LIT()" } ] }"#,
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
         v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; for i = 1, 900 do step(6, 0) end; \
         local t_in = 0; for i = 1, 180 do step(6, 1); if t_in == 0 and math.abs(v.steer) > 0.9 * 0.688 then t_in = i * dt end end; \
         local speed, t_back = v.speed, nil; for i = 1, 180 do step(6, 0); if not t_back and math.abs(v.yaw_rate) < 0.03 and math.abs(v.steer) < 0.02 then t_back = i * dt end end; \
         local function circle(spd) v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; local xs, zs, turned, last = {}, {}, 0, v.heading; \
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
/// is drawn with see_through = false: never cut away. (The camera does not move for it either: see the next test.)
#[test]
fn the_van_is_never_cut_away() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(nova.named('van').draw_opts.see_through)"),
        "false",
        "the van is never cut away"
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
    assert!(cfg["input"].get("act").is_none());
    // (the sixth play: X and A move the van's lever, so the horn has its own button, the left stick's click)
    assert_eq!(
        pad("horn"),
        vec!["pad:thumb_l".to_string()],
        "the horn is L3"
    );

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

    // the doorway: X, A and B do not get in; Y does; in the van L3 is the horn, X and A the lever (no horn), and Y (stopped) gets out
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
        r#"{ "steps": [ { "press": "interact" }, { "wait": 5 }, { "press": "confirm" }, { "wait": 5 }, { "press": "horn" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(
        logged(&r).iter().filter(|l| *l == "horn").count(),
        1,
        "L3 sounds the horn, X and A do not"
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
        "(function() local v = nova.named('van'); local dt = 1 / 60; v.driven = true; v.gear = 'D'; \
         local function run(n, go, steer, hb) local slip, yaw = 0, 0; for i = 1, n do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = go, 0, steer, hb; v:drive(dt); \
           v.x, v.z = 4.5, -150; \
           local sh, ch = math.sin(v.heading), math.cos(v.heading); local vf, vl = v.velx * sh + v.velz * ch, v.velx * ch - v.velz * sh; \
           slip = math.max(slip, math.abs(math.atan(vl, math.abs(vf) + 1e-6))); yaw = math.max(yaw, math.abs(v.yaw_rate or 0)) end; return slip, yaw end; \
         local function up(spd) v:teleport(4.5, -150, 0); v.driven = true; v.gear = 'D'; for i = 1, 1200 do v.ctl.go = v.speed < spd and 1 or 0; v.ctl.brake = v.speed > spd + 0.3 and 0.3 or 0; v.ctl.steer, v.ctl.handbrake = 0, 0; v:drive(dt); v.x, v.z = 4.5, -150 end end; \
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

    // standing on a slope: in N (no creep) with nothing pressed it rolls; on the handbrake it stays
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local W = require('lib.world'); local dt = 1 / 60; local bx, bz, best = 0, 0, 0; \
         for x = -240, 240, 2 do for z = -240, 240, 2 do local gx, gz = nova.terrain_slope(x, z); local s = math.sqrt(gx * gx + gz * gz); \
           local r, dr = W.nearest('road', x, z); \
           if r and dr < r.width / 2 and s > best and s < 0.25 and not W.blocked(x, z, 2.5) and not W.on_bridge(x, z) and not nova.scenery.push(x, z, 2.5) then best, bx, bz = s, x, z end end end; \
         local gx, gz = nova.terrain_slope(bx, bz); local h = math.atan(gx, gz); \
         local function hold(hb) v:teleport(bx, bz, h); v.driven = true; v.gear = 'N'; for i = 1, 300 do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, 0, 0, hb; v:drive(dt) end; return math.sqrt((v.x - bx) ^ 2 + (v.z - bz) ^ 2) end; \
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
            {{ "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in(); nova.named('van').gear = 'D'" }},
            {{ "hold": ["go", "steer=0.5"], "frames": 740, "record": "{status} --driving" }},
            {{ "hold": ["brake"], "frames": 150 }}, {{ "hold": ["brake"], "frames": 120 }},
            {{ "hold": ["brake"], "frames": 60, "record": "{status} --stopped" }},
            {{ "hold": ["brake"], "press": "van", "frames": 5 }}, {{ "wait": 200, "record": "{status} --out" }} ] }}"#
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
    local gx, _, gz = place(t, lj)
    local ground = p.on_deck and (W.height(gx, gz) - nova.terrain_height(p.x, p.z)) or W.lift(gx, gz)
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

// ---- the owner's sixth play, the UI half (2026-11-23): the van's floating panel, nobody cut, Start and Select stop the world ----------

/// At the van's open back the panel is a small one that floats over the doors (the owner: "The popup currently blocks the player ...
/// make it appear floating above the truck doors. So it'll technically move with the camera to remain above the doors"): its tail is
/// on the doors' point projected through the camera, the panel stands above that point and is whole on the screen, and when the
/// camera is turned the panel goes with the doors.
#[test]
fn the_vans_panel_floats_above_the_open_doors_and_follows_the_camera() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.van_load = { 'hazel', 'pip' }; S.carrying = nil",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():picker() ~= nil", "max": 120 }, { "wait": 40 } ] }"#,
    );
    let probe = "local w, h = nova.view('exact'); local b = require('lib.ui').van_panel_box; local ax, ay = nova.scene_now():panel_anchor(w, h);";
    let on_screen = |g: &Game, what: &str| {
        let (w, h) = (
            num(g, "(nova.view('exact'))"),
            num(g, "select(2, nova.view('exact'))"),
        );
        let (x, y, bw, bh) = (
            num(g, "require('lib.ui').van_panel_box.x"),
            num(g, "require('lib.ui').van_panel_box.y"),
            num(g, "require('lib.ui').van_panel_box.w"),
            num(g, "require('lib.ui').van_panel_box.h"),
        );
        assert!(
            x >= 0.0 && y >= 0.0 && x + bw <= w && y + bh <= h,
            "{what}: the panel ({x:.0}, {y:.0}, {bw:.0} x {bh:.0}) is whole on a {w} x {h} screen"
        );
        // smaller than the old one (430 x 176 at the old scale: 353 x 144), and never over the middle of the screen's lower half
        assert!(
            bw < 300.0 && bh < 110.0,
            "{what}: a lean panel, {bw:.0} x {bh:.0}"
        );
    };
    on_screen(&g, "default view");
    // the panel's tail is under the doors' point and the panel above it
    let (ax, ay) = (
        num(&g, &format!("(function() {probe} return ax end)()")),
        num(&g, &format!("(function() {probe} return ay end)()")),
    );
    let (tx, ty, py) = (
        num(&g, &format!("(function() {probe} return b.tail_x end)()")),
        num(&g, &format!("(function() {probe} return b.anchor_y end)()")),
        num(&g, &format!("(function() {probe} return b.y + b.h end)()")),
    );
    assert!(
        (tx - ax).abs() < 1.5 && (ty - ay).abs() < 1.5,
        "eased onto the doors: ({tx}, {ty}) for ({ax}, {ay})"
    );
    assert!(
        py <= ay + 1.0,
        "the panel stands over the doors' point: bottom {py} for {ay}"
    );
    // the doors' point is over the van's roof line at the back: 0.3 m over, and it is where the model's roof edge is on the screen
    assert!(num(&g, "nova.scene_now().PANEL_AT[2]") > 1.6 + 0.25);
    // orbited both ways: the panel's anchor moves with the doors on the screen, the panel stays whole
    let mut last = ax;
    for (turn, what) in [(0.9, "orbited right"), (-1.8, "orbited left")] {
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "local c = require('lib.camera').state; c.yaw = c.yaw + {turn}; c.idle = 0" }}, {{ "wait": 40 }} ] }}"#
            ),
        );
        on_screen(&g, what);
        let now = num(&g, &format!("(function() {probe} return ax end)()"));
        let moved = (now - last).abs();
        last = now;
        assert!(
            moved > 10.0,
            "{what}: the doors moved on the screen by {moved:.0}"
        );
        let tx2 = num(&g, &format!("(function() {probe} return b.tail_x end)()"));
        let ax2 = num(&g, &format!("(function() {probe} return ax end)()"));
        assert!(
            (tx2 - ax2).abs() < 2.0,
            "{what}: the panel follows the doors"
        );
    }
    // it never takes the stick: walking on, the postmaster moves
    let x0 = num(&g, "nova.named('postmaster').x");
    let z0 = num(&g, "nova.named('postmaster').z");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_x=1"], "frames": 30 } ] }"#,
    );
    let d = ((num(&g, "nova.named('postmaster').x") - x0).powi(2)
        + (num(&g, "nova.named('postmaster').z") - z0).powi(2))
    .sqrt();
    assert!(d > 0.3, "the postmaster walked {d:.2} m with the panel up");
}

/// The panel in each of its states, with the van's count over its capacity of four: parcels in the van (one line, "1 of 2" and L1 / R1),
/// a parcel in the arms ("Load package", the count), and nothing in the van ("The van is empty", 0/4).
#[test]
fn the_vans_panel_shows_its_count_and_says_when_it_is_empty() {
    let mut g = game();
    assert_eq!(lua(&g, "require('lib.state').VAN_HOLDS"), "4");
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.van_load = {}; S.carrying = nil",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():panel_mode() ~= nil", "max": 120 }, { "wait": 20 } ] }"#,
    );
    // empty van, empty hands: still a panel, saying so
    let r = play(&mut g, r#"{ "steps": [ { "wait": 3 } ] }"#);
    assert_eq!(lua(&g, "nova.scene_now():panel_mode()"), "empty");
    assert_eq!(r.drawn_count("ui_text", Some("The van is empty")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("Van 0/4")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("Take")), 0);
    // one, two, four in the van: one parcel line, the count, L1 / R1 only with more than one
    for (load, tag, many) in [
        ("{ 'hazel' }", "Van 1/4", false),
        ("{ 'hazel', 'pip' }", "Van 2/4", true),
        ("{ 'hazel', 'pip', 'hazel', 'pip' }", "Van 4/4", true),
    ] {
        let r = play(
            &mut g,
            &format!(r#"{{ "steps": [ {{ "lua": "S.van_load = {load}" }}, {{ "wait": 25 }} ] }}"#),
        );
        assert_eq!(lua(&g, "nova.scene_now():panel_mode()"), "pick");
        assert_eq!(r.drawn_count("ui_text", Some(tag)), 1, "{tag}");
        assert_eq!(r.drawn_count("ui_text", Some("Take")), 1);
        assert_eq!(r.drawn_count("ui_text", Some("L1")), many as usize);
        assert_eq!(
            r.drawn_count("ui_text", Some("Hazel Brock")),
            2,
            "the panel's line and the corner card"
        );
    }
    // carrying a parcel at the back: "Load package" with the van's count
    let r = play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.van_load = { 'pip', 'pip' }; S.carrying = 'hazel'" }, { "wait": 25 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now():panel_mode()"), "load");
    assert_eq!(r.drawn_count("ui_text", Some("Load package")), 1);
    assert_eq!(r.drawn_count("ui_text", Some("Van 2/4")), 1);
}

/// "The maximum capacity for the truck storage should be 4 parcels for now": three loaded, the fourth goes in; a fifth is refused with
/// a soft note in the panel ("The van is full"), nothing is lost and the parcel stays in the arms.
#[test]
fn the_van_holds_four_and_a_fifth_is_refused_softly() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.van_load = { 'pip', 'hazel', 'pip' }; S.carrying = 'hazel'",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():actions() == 'load'", "max": 120 }, { "wait": 20 } ] }"#,
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 4 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "loaded hazel"));
    assert_eq!(num(&g, "#require('lib.state').van_load"), 4.0);
    assert_eq!(
        r.drawn_count("ui_text", Some("The van is full")),
        0,
        "no note while it goes in"
    );
    // a fifth parcel (the slice has two; the test carries a third kind of trip)
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.carrying = 'pip'" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(
        lua(&g, "(nova.scene_now():actions())"),
        "load",
        "X still offers it"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 4 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "the van is full"));
    assert!(!logged(&r).iter().any(|l| l.starts_with("loaded")));
    assert_eq!(num(&g, "#require('lib.state').van_load"), 4.0, "still four");
    assert_eq!(
        lua(&g, "require('lib.state').carrying"),
        "pip",
        "the parcel stays in the arms"
    );
    assert_eq!(
        r.drawn_count("ui_text", Some("The van is full")),
        1,
        "the note in the panel"
    );
    assert_eq!(r.drawn_count("ui_text", Some("Van 4/4")), 1);
    // and the note goes again
    let r = play(&mut g, r#"{ "steps": [ { "wait": 150 } ] }"#);
    assert_eq!(r.drawn_count("ui_text", Some("The van is full")), 0);
    assert_eq!(r.drawn_count("ui_text", Some("Load package")), 1);
}

/// "We don't need to have the circle cut through other characters or the truck if the player is hidden behind them." Every model of a
/// person (the postmaster, the residents, the driver) and of the van is drawn with `see_through = false`, as is what they carry:
/// only scenery is cut. A recording of every nova.model call says so.
#[test]
fn the_see_through_circle_never_cuts_people_or_the_van() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "REC = {}; local orig = nova.model; nova.model = function(id, x, y, z, o) if id == 'hazel' or id == 'pip' or id == 'van' or id == 'postmaster' or id:find('parcel') then REC[id] = (REC[id] or 0) + 1; if not o or o.see_through ~= false then BAD = (BAD or '') .. id .. ' ' end end return orig(id, x, y, z, o) end; S = require('lib.state'); S.carrying = 'hazel'",
        "steps": [ { "wait": 20 } ] }"#,
    );
    let _ = r;
    assert!(num(&g, "(REC.van or 0)") > 0.0, "the van was recorded");
    assert_eq!(
        lua(&g, "tostring(BAD)"),
        "nil",
        "drawn without see_through = false"
    );
    // the residents' and the postmaster's own options say it (their draw goes through the animator's options table)
    for who in ["hazel", "pip"] {
        assert_eq!(
            lua(
                &g,
                &format!("tostring(nova.named('{who}').draw_opts.see_through)")
            ),
            "false"
        );
        assert_eq!(
            lua(
                &g,
                &format!("tostring(nova.named('{who}').parcel_opts.see_through)")
            ),
            "false"
        );
    }
    assert_eq!(
        lua(
            &g,
            "tostring(nova.named('postmaster').draw_opts.see_through)"
        ),
        "false"
    );
    assert_eq!(
        lua(&g, "tostring(nova.named('van').draw_opts.see_through)"),
        "false"
    );
    // in the driver's seat too
    let r = play(
        &mut g,
        r#"{ "lua": "BAD = nil; REC = {}", "steps": [ { "lua": "require('lib.testkit').board()" }, { "wait": 30 } ] }"#,
    );
    let _ = r;
    assert_eq!(lua(&g, "tostring(BAD)"), "nil");
    assert!(
        num(&g, "(REC.postmaster or 0)") > 0.0,
        "the driver was drawn"
    );
}

/// "Pressing start should actually pause the game." Start opens the pause menu and the world stands still: the engine's clock, the
/// van, the residents, the postmaster (the stick is not read), the scene's own timers; the music goes on, ducked. Closing it carries
/// on from the same moment.
#[test]
fn start_pauses_the_world_and_closing_it_carries_on() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "S = require('lib.state'); T = require('lib.testkit')",
        "steps": [ { "wait": 30, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 36; nova.named('van'):teleport(100, 100, 0.5)" }, { "wait": 20 } ] }"#,
    );
    let state = "local p, v, h = nova.named('postmaster'), nova.named('van'), nova.named('hazel'); local c = require('lib.camera').state; return table.concat({ nova.time(), nova.scene_now().t, p.x, p.z, p.face, v.x, v.z, v.heading, h.x, h.z, c.eye[1], c.eye[3], h.work_sound_t, v.rev or 0 }, ',')";
    let snapshot = |g: &Game| lua(g, &format!("(function() {state} end)()"));
    // walking (so that the postmaster and the camera are moving), then Start
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 20 }, { "press": "pause" }, { "wait": 6 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "card pause"));
    assert!(logged(&r).iter().any(|l| l == "paused"));
    let before = snapshot(&g);
    // held sticks and button presses while it is open: nothing in the world moves, not the clock either
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "move_x=1", "look_x=1"], "frames": 40 }, { "press": "interact" }, { "wait": 30 } ] }"#,
    );
    assert_eq!(
        snapshot(&g),
        before,
        "nothing moved, nor did time pass, while paused"
    );
    assert_eq!(
        r.drawn_count("ui_text", Some("Paused")),
        1,
        "the menu is drawn"
    );
    // the music is ducked, not stopped
    let v = num(&g, "require('lib.music').status().volume");
    assert!(
        v > 0.0 && v < 0.28,
        "the music ducks to 0.24 outdoors, is not stopped: {v}"
    );
    // Start closes it; the world goes on from there
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "pause" }, { "wait": 3 }, { "hold": ["move_y=-1"], "frames": 25 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "resumed"));
    let after = snapshot(&g);
    assert_ne!(after, before, "it carries on");
    let t_before: f64 = before.split(',').next().unwrap().parse().unwrap();
    let t_after: f64 = after.split(',').next().unwrap().parse().unwrap();
    assert!(
        t_after - t_before < 1.2,
        "the clock carried on from the same moment, {t_before} to {t_after}"
    );
}

/// "Pressing Select for the map should actually pause the game": the paper map pauses the world the same way; Select closes it.
#[test]
fn select_opens_the_map_and_pauses_the_world() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 30, "lua": "local p = nova.named('postmaster'); p.x, p.z = 150, 36; nova.named('van'):teleport(100, 100, 0.5)" }, { "wait": 20 } ] }"#,
    );
    let probe = "(function() local p, v = nova.named('postmaster'), nova.named('van'); return table.concat({ nova.time(), nova.scene_now().t, p.x, p.z, v.x, v.z }, ',') end)()";
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 10 }, { "press": "map" }, { "wait": 20 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "card map"));
    let before = lua(&g, probe);
    // (the van's rolling on its springs and the clouds would show here if the world ran on)
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1", "move_x=-1"], "frames": 30 }, { "wait": 30 } ] }"#,
    );
    assert_eq!(
        lua(&g, probe),
        before,
        "the world stood still behind the map"
    );
    assert!(
        r.drawn_count("ui_sprite", Some("ui/map")) >= 1,
        "the map is up"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "map" }, { "wait": 5 } ] }"#,
    );
    assert!(logged(&r).iter().any(|l| l == "resumed"));
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 25 } ] }"#,
    );
    assert_ne!(lua(&g, probe), before, "and carried on");
}

/// The same in the post office: Start stops the room.
#[test]
fn start_pauses_the_post_office_too() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "steps": [ { "wait": 30 } ] }"#,
    );
    let probe = "(function() local p = nova.named('postmaster'); return table.concat({ nova.time(), nova.scene_now().t, p.x, p.z }, ',') end)()";
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_x=-1"], "frames": 10 }, { "press": "pause" }, { "wait": 10 } ] }"#,
    );
    let before = lua(&g, probe);
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_x=-1"], "frames": 40 }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, probe), before);
    play(
        &mut g,
        r#"{ "steps": [ { "press": "pause" }, { "wait": 3 }, { "hold": ["move_x=-1"], "frames": 20 } ] }"#,
    );
    assert_ne!(lua(&g, probe), before);
}

/// The minimap's roads end under the frame: the disc's rim is drawn again over them, so no road shows a flat end at the edge.
#[test]
fn the_minimaps_roads_end_under_its_rim() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 30 } ] }"#,
    );
    let items: Vec<Value> = r.drawn("ui_sprite", None);
    let at = |pat: &str| {
        items
            .iter()
            .rposition(|s| s["name"].as_str().is_some_and(|n| n.ends_with(pat)))
    };
    let disc = at("ui/minimap_disc").expect("the disc");
    let rim = at("ui/minimap_rim").expect("the rim");
    let last_road = at("ui/minimap_road").expect("a road");
    assert!(
        disc < last_road && last_road < rim,
        "disc, then roads, then the rim over them"
    );
    let (d, m) = (&items[disc], &items[rim]);
    assert_eq!(
        (d["x"].as_f64(), d["y"].as_f64(), d["w"].as_f64()),
        (m["x"].as_f64(), m["y"].as_f64(), m["w"].as_f64())
    );
}

// ---- the owner's sixth play: the van's PRNDL lever, its gear display, the glass, the hold's floor, the roof -------------------------

/// The van's model file, parsed.
fn van_model() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../examples/mountain-post/models/van.model.json"),
        )
        .unwrap(),
    )
    .unwrap()
}

/// Every shape of a part and its children, each with its part's name.
fn van_shapes<'a>(p: &'a Value, out: &mut Vec<(String, &'a Value)>) {
    let name = p["name"].as_str().unwrap_or("").to_string();
    for c in p["cubes"].as_array().into_iter().flatten() {
        out.push((name.clone(), c));
    }
    for ch in p["children"].as_array().into_iter().flatten() {
        van_shapes(ch, out);
    }
}

/// A mesh shape's points in metres (the model's units are 16 to the metre).
fn mesh_points(c: &Value) -> Vec<[f64; 3]> {
    c["verts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| {
            [
                v[0].as_f64().unwrap() / 16.0,
                v[1].as_f64().unwrap() / 16.0,
                v[2].as_f64().unwrap() / 16.0,
            ]
        })
        .collect()
}

/// "Truck rear windows are only one way windows for some reason." Every pane of glass (the windscreen, the right window, both rear
/// doors' windows) is a closed solid, so it is drawn from both sides; each rear door's window is cut through both of the door's faces
/// (it was cut through the outside face only, so from inside the hold it was a blank board); the glass is the only see-through part,
/// and the body itself is solid.
#[test]
fn the_vans_glass_is_seen_from_both_sides_and_the_door_windows_go_right_through() {
    let model = van_model();
    let mut shapes = Vec::new();
    for p in model["parts"].as_array().unwrap() {
        van_shapes(p, &mut shapes);
    }
    let see_through = |c: &Value| c["color"].as_str().is_some_and(|s| s.len() == 9);
    let panes: Vec<&(String, &Value)> = shapes.iter().filter(|(_, c)| see_through(c)).collect();
    assert_eq!(
        panes.len(),
        4,
        "the windscreen, the right window and the two rear windows: {:?}",
        panes.iter().map(|(n, _)| n).collect::<Vec<_>>()
    );
    for (part, c) in &panes {
        // closed: every edge of its faces is shared by exactly two faces, so whichever side it is seen from, a face looks that way
        let mut edges = std::collections::HashMap::new();
        for poly in c["polys"].as_array().unwrap() {
            let v: Vec<u64> = poly["v"]
                .as_array()
                .unwrap()
                .iter()
                .map(|i| i.as_u64().unwrap())
                .collect();
            for k in 0..v.len() {
                let (a, b) = (v[k], v[(k + 1) % v.len()]);
                *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
            }
        }
        assert!(
            edges.values().all(|&n| n == 2),
            "the pane in {part} is a closed solid, seen from both sides"
        );
    }
    for side in ["l", "r"] {
        let leaf = shapes
            .iter()
            .find(|(n, c)| {
                *n == format!("door_{side}_leaf")
                    && c["modifiers"]
                        .as_array()
                        .is_some_and(|m| m.iter().any(|m| m["type"] == "cutout"))
            })
            .expect("the door's panel");
        let cuts = leaf.1["modifiers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["type"] == "cutout")
            .unwrap()["cuts"]
            .as_array()
            .unwrap();
        for view in ["back", "front"] {
            assert!(
                cuts.iter()
                    .any(|c| c["view"] == view && c["remove"] == true),
                "door_{side}'s window is cut through its {view} face"
            );
        }
    }
    // the body is not see-through: only the panes are
    let skin = &shapes.iter().find(|(n, _)| n == "body").unwrap().1;
    assert!(!see_through(skin), "the body's skin is solid");
}

/// "Truck bed doesn't cover the full area. I can see the grass through it." The hold's floor is one solid board from side to side
/// (into the skin) and from the cab's wall to the back's lip, over the rear wells' linings, and the opening behind the rear doors
/// starts at its top (nothing below the floor to look down into).
/// "There's a weird rectangular piece atop the van": no slab sits on the roof; the roof is the skin's own round.
#[test]
fn the_hold_floor_is_one_closed_board_and_the_roof_has_no_slab() {
    let model = van_model();
    let body = &model["parts"][0];
    let mut shapes = Vec::new();
    van_shapes(body, &mut shapes);
    let body_shapes: Vec<&Value> = shapes
        .iter()
        .filter(|(n, _)| n == "body")
        .map(|(_, c)| *c)
        .collect();
    let bounds = |c: &Value| {
        let pts = mesh_points(c);
        let mut lo = [f64::MAX; 3];
        let mut hi = [f64::MIN; 3];
        for p in &pts {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        (lo, hi, pts.len())
    };
    let floor = body_shapes.iter().map(|c| bounds(c)).find(|(lo, hi, n)| {
        *n == 8 && hi[1] - lo[1] < 0.05 && lo[0] <= -0.64 && hi[0] >= 0.64 && hi[2] - lo[2] > 1.2
    });
    let (lo, hi, _) = floor.expect("a solid floor board across the hold");
    assert!(
        lo[2] <= -1.33 && hi[2] >= -0.03,
        "the floor runs from the back's lip to the cab's wall: z {} to {}",
        lo[2],
        hi[2]
    );
    let top = hi[1];
    assert!(
        (0.66..0.7).contains(&top) && lo[1] > 0.65,
        "the floor's top {top}, its underside {} over the rear wells' linings (0.65)",
        lo[1]
    );
    // the opening behind the doors starts at the floor's top
    let skin = body_shapes[0];
    let cuts = skin["modifiers"][0]["cuts"].as_array().unwrap();
    let opening = cuts
        .iter()
        .find(|c| c["view"] == "back" && c["remove"] == true)
        .expect("the opening behind the rear doors");
    let sill = opening["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p[1].as_f64().unwrap() / 16.0)
        .fold(f64::MAX, f64::min);
    assert!(
        (sill - top).abs() < 0.015,
        "the opening's sill {sill} is level with the floor {top}"
    );
    // no slab on the roof: nothing but the skin reaches above the cab's and the hold's linings
    let skin_top = bounds(skin).1[1];
    for c in &body_shapes[1..] {
        let (lo, _, n) = bounds(c);
        assert!(
            n == 0 || lo[1] < 1.55,
            "a shape sits on the roof (from {} m up)",
            lo[1]
        );
    }
    assert!(
        (1.6..=1.64).contains(&skin_top),
        "the roof is the body's own, {skin_top} m high"
    );
}

/// The lever (the owner's sixth play: "a real automatic with PRNDL gear selection"; on the buttons: A towards L, X towards P; then
/// "We can remove the brake requirement honestly"). Getting in, it is in P; A steps P, R, N, D with no pedal, X steps back, each
/// at once with its clunk; D to L and back at speed; the one guard: never into P, nor into R, while going forwards faster than about
/// 1 m/s (refused with a soft click and "Stop to shift"); getting out leaves it in P; the next time in, P again.
#[test]
fn the_lever_starts_in_p_moves_at_once_and_only_refuses_p_or_r_on_the_move() {
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "wait": 10, "lua": "GEAR0 = nova.named('van').gear" }, { "press": "confirm" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "GEAR0"), "P", "in P on getting in");
    assert_eq!(
        lua(&g, "nova.named('van').gear"),
        "R",
        "A moves it with no pedal"
    );
    assert!(!logged(&r).iter().any(|l| l.starts_with("shift refused")));
    assert!(
        r.json["sounds"].to_string().contains("gear_shift"),
        "a clunk"
    );
    assert_eq!(r.drawn_count("ui_text", Some("to shift")), 0);
    let mut seen = Vec::new();
    for _ in 0..2 {
        play(
            &mut g,
            r#"{ "steps": [ { "press": "confirm" }, { "wait": 3 } ] }"#,
        );
        seen.push(lua(&g, "nova.named('van').gear"));
    }
    assert_eq!(seen, ["N", "D"]);
    // X steps back up towards P, then A down again
    play(
        &mut g,
        r#"{ "steps": [ { "press": "interact" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "N");
    play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "D");
    // rolling at speed: D to L and back with no brake
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["go"], "frames": 200 }, { "hold": ["go"], "press": "confirm", "frames": 6 },
        { "hold": ["go"], "frames": 4, "lua": "IN_L = nova.named('van').gear .. ' ' .. nova.named('van').speed" },
        { "press": "interact" }, { "wait": 4 } ] }"#,
    );
    let in_l = lua(&g, "IN_L");
    assert!(in_l.starts_with("L "), "D to L on the move: {in_l}");
    assert!(
        in_l.split(' ').nth(1).unwrap().parse::<f64>().unwrap() > 3.0,
        "at speed: {in_l}"
    );
    assert_eq!(
        lua(&g, "nova.named('van').gear"),
        "D",
        "and back to D, no brake"
    );
    assert!(!logged(&r).iter().any(|l| l.starts_with("shift refused")));
    // rolling forwards: D to N goes at once, but N to R is refused ("Stop to shift"), and so is P
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["go"], "frames": 60 }, { "lua": "local v = nova.named('van'); ROLLING = v.speed; TO_N = v:shift(-1); TO_R = v:shift(-1); v.gear = 'R'; TO_P = v:shift(-1); v.gear = 'D'" }, { "wait": 2 } ] }"#,
    );
    assert!(num(&g, "ROLLING") > 1.5);
    assert_eq!(lua(&g, "tostring(TO_N)"), "true");
    assert_eq!(lua(&g, "tostring(TO_R)"), "false");
    assert_eq!(lua(&g, "tostring(TO_P)"), "false");
    assert!(
        logged(&r)
            .iter()
            .any(|l| l == "shift refused: N to R, rolling")
    );
    assert_eq!(lua(&g, "nova.named('van').hint"), "stop");
    assert_eq!(r.drawn_count("ui_text", Some("Stop to shift")), 1);
    // stopped, Y gets out: it is left in P; in again, P
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "until": "nova.named('van'):stopped()", "max": 400 }, { "press": "van" }, { "wait": 10 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    assert_eq!(lua(&g, "nova.named('van').gear"), "P");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local v = nova.named('van'); v.gear = 'D'; local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "P", "in P each time");
}

/// What each gear does, measured on the van's own step (Van:drive) on the flat at Post Road and on a slope: P holds (R2 does
/// nothing); R backs up on R2 (to about 3 m/s); L2 is only the brake (held in D from a standstill, the van never moves backwards);
/// N gives no drive, and lets the van roll down a slope that P holds; L tops out at 55 to 62 % of D's top speed and, the pedal let
/// up, slows the van faster than D does (engine braking).
#[test]
fn p_holds_r_reverses_on_r2_l2_only_brakes_n_rolls_and_l_is_lower_and_brakes_on_the_engine() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local dt = 1 / 60; \
         local function run(gear, go, brake, n) v:teleport(4.5, -150, 0); v.driven = true; v.gear = gear; \
           local least = 0; for i = 1, n do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = go, brake, 0, 0; v:drive(dt); v.x, v.z, v.heading = 4.5, -150, 0; least = math.min(least, v.speed) end; return v.speed, least end; \
         local p = run('P', 1, 0, 300); local r = run('R', 1, 0, 900); local _, d_least = run('D', 0, 1, 300); \
         local n = run('N', 1, 0, 300); local d_top = run('D', 1, 0, 2400); local l_top = run('L', 1, 0, 2400); \
         local function slow(gear) v:teleport(4.5, -150, 0); v.driven = true; v.gear = gear; \
           v.velx, v.velz, v.speed = 0, 6, 6; local t = 0; while v.speed > 3 and t < 30 do v.ctl.go, v.ctl.brake = 0, 0; v:drive(dt); v.x, v.z, v.heading = 4.5, -150, 0; t = t + dt end; return t end; \
         return string.format('%.3f %.3f %.3f %.3f %.3f %.3f %.3f %.3f', p, r, d_least, n, d_top, l_top, slow('D'), slow('L')) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    let (p, r, d_least, n, d_top, l_top, slow_d, slow_l) =
        (v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    assert!(p.abs() < 1e-6, "P: R2 does not move it ({out})");
    assert!(
        (-3.1..=-2.3).contains(&r),
        "R: R2 backs it up to about 3 m/s ({out})"
    );
    assert!(
        d_least > -1e-6,
        "L2 is only the brake: never backwards ({out})"
    );
    assert!(
        n.abs() < 0.05,
        "N: no drive (the road's own gentle fall aside) ({out})"
    );
    assert!(
        (9.8..=11.2).contains(&d_top),
        "D tops out as before ({out})"
    );
    let share = l_top / d_top;
    assert!(
        (0.55..=0.62).contains(&share),
        "L tops out at {share:.2} of D ({out})"
    );
    assert!(
        slow_l < slow_d * 0.75,
        "L brakes on the engine: 6 to 3 m/s in {slow_l:.2} s, D in {slow_d:.2} s"
    );
    // on a slope (found on the map: steep enough, a lane clear for a few metres downhill), N rolls and P holds
    let out = lua(
        &g,
        "(function() local w = require('lib.world'); local v = nova.named('van'); local dt = 1 / 60; \
         local spot; for x = -199.3, 200, 4 do for z = -198.6, 200, 4 do if not spot then local gx, gz = nova.terrain_slope(x, z); local s = math.sqrt(gx * gx + gz * gz); \
           if s > 0.08 and s < 0.25 and not w.on_bridge(x, z) and (w.surface(x, z) == 'road' or w.surface(x, z) == 'gravel') then local ok = true; \
             for d = 0.5, 4, 0.5 do local ax, az = nova.terrain_slope(x - gx / s * d, z - gz / s * d); if (ax * gx + az * gz) / s < 0.06 then ok = false end end; \
             for d = -1.5, 9, 0.5 do local px, pz = x - gx / s * d, z - gz / s * d; local _, _, st = w.move(px, pz, -gx / s * 0.1, -gz / s * 0.1, 0.75); \
               if st or w.blocked(px, pz, 1.0) or nova.scenery.push(px, pz, 1.0) then ok = false end end; \
             if ok then spot = { x, z, math.atan(-gx, -gz), s } end end end end end; \
         if not spot then return 'none' end; \
         local function roll(gear) v:teleport(spot[1], spot[2], spot[3]); v.driven = true; v.gear = gear; for i = 1, 180 do v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, 0, 0, 0; v:drive(dt) end; \
           return math.sqrt((v.x - spot[1]) ^ 2 + (v.z - spot[2]) ^ 2) end; \
         return string.format('%.3f %.3f %.3f', roll('N'), roll('P'), spot[4]) end)()",
    );
    assert_ne!(out, "none", "a sloping stretch of lane to test on");
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!(v[0] > 0.5, "N: it rolls down the slope ({out})");
    assert!(v[1] < 0.02, "P: the slope does not move it ({out})");
}

/// "We also need to add a non-annoying reverse sound when the van is in R." In R the beeper sounds about every 1.2 s, well under
/// the horn; in the other gears it is never heard; it stops the moment the lever leaves R.
#[test]
fn the_reversing_beeper_sounds_only_in_r() {
    let mut g = game();
    let beeps = |r: &Report| logged(r).iter().filter(|l| *l == "reverse beep").count();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "wait": 200 }, { "hold": ["brake"], "press": "confirm", "frames": 8 } ] }"#,
    );
    assert_eq!(beeps(&r), 0, "none in P");
    assert_eq!(lua(&g, "nova.named('van').gear"), "R");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["go"], "frames": 240 }, { "hold": ["brake"], "frames": 60 } ] }"#,
    );
    let n = beeps(&r);
    assert!((3..=5).contains(&n), "about every 1.2 s in R: {n} in 5 s");
    // (the run's sounds: { frame, text = "sound reverse_beep at volume 0.22" })
    let vol = r.json["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| s["text"].as_str())
        .find_map(|s| s.split("sound reverse_beep at volume ").nth(1))
        .and_then(|v| v.trim().parse::<f64>().ok())
        .expect("the beeper is played");
    assert!(vol <= 0.3, "quiet: played at {vol} (the horn at 0.7)");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "until": "math.abs(nova.named('van').speed) < 0.2", "max": 200 }, { "hold": ["brake"], "press": "confirm", "frames": 8 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "N");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "wait": 300 }, { "hold": ["brake"], "press": "confirm", "frames": 8 }, { "hold": ["go"], "frames": 300 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "D");
    assert_eq!(beeps(&r), 0, "none in N or D");
}

/// The van's cluster (the owner: "We should move the PRNDL to the right along with an analog speedometer"): bottom right, the dial
/// in the corner with the minimap's frame and the lever's panel just left of it, both standing on the same foot line as the minimap;
/// the prompts above it, clear of it; inside the screen at 1280x720 and 1920x1080; the gear it is in highlighted; the handbrake lamp
/// lit only while B is held; hidden on foot. The horn is on L3 (X and A are the lever's now).
#[test]
fn the_gear_display_sits_beside_the_minimap_follows_the_lever_and_lights_with_the_handbrake() {
    for size in ["1280x720", "1920x1080"] {
        let mut g = game();
        let r = play(
            &mut g,
            &format!(
                r#"{{ "size": "{size}", "start_scene": "valley", "steps": [ {{ "wait": 10 }} ] }}"#
            ),
        );
        assert_eq!(r.drawn_count("ui_text", Some("km/h")), 0, "hidden on foot");
        let r = play(
            &mut g,
            r#"{ "steps": [ { "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }, { "wait": 20 } ] }"#,
        );
        assert_eq!(
            r.drawn_count("ui_text", Some("km/h")),
            1,
            "{size}: shown driving"
        );
        assert_eq!(
            r.drawn_count("ui_text", Some("(P)")),
            1,
            "the handbrake lamp"
        );
        assert_ui_from_the_kit(&r, "the van's cluster");
        let g_ = |k: &str| num(&g, &format!("require('lib.gear_hud').last.{k}"));
        let (x, y, w, h) = (g_("x"), g_("y"), g_("w"), g_("h"));
        let (cx, cy, rim, top) = (g_("cx"), g_("cy"), g_("rim"), g_("top"));
        let (vw, vh) = (num(&g, "(nova.view('exact'))"), 540.0);
        let mm = num(&g, "require('lib.ui').MINIMAP.r");
        let foot = vh - 24.0 - mm - 4.0 + mm + 8.0;
        assert!(
            (vw - (cx + rim) - 20.0).abs() < 1.0 && (cy + rim - foot).abs() < 1.0,
            "{size}: the dial in the bottom right corner, on the minimap's foot line"
        );
        // one instrument (the owner: "merge them ... Not just two separate shapes"): the gears in a row inside the dial's foot, the
        // lamp inside it too, no button glyphs on it
        assert!(
            (x - (cx - rim)).abs() < 1e-6
                && (w - 2.0 * rim).abs() < 1e-6
                && (y + h - foot).abs() < 1.0,
            "{size}: the instrument is the dial"
        );
        let inside = lua(
            &g,
            "(function() local L = require('lib.gear_hud').last; local ok = true; for _, p in pairs(L.letters) do \
             if math.sqrt((p[1] - L.cx) ^ 2 + (p[2] - L.cy) ^ 2) > L.r - 8 or p[2] < L.cy then ok = false end end; \
             if math.sqrt((L.lamp[1] - L.cx) ^ 2 + (L.lamp[2] - L.cy) ^ 2) > L.r - 8 then ok = false end; return tostring(ok) end)()",
        );
        assert_eq!(
            inside, "true",
            "{size}: the gears and the lamp inside the dial, the gears below the hub"
        );
        let glyphs = r
            .drawn("ui_sprite", Some("round"))
            .into_iter()
            .filter(|s| {
                s["x"].as_f64().unwrap_or(0.0) > cx - rim && s["y"].as_f64().unwrap_or(0.0) > top
            })
            .count();
        assert_eq!(glyphs, 0, "{size}: no button glyphs on the instrument");
        assert!(x > vw / 2.0, "{size}: on the right");
        for t in r.drawn("ui_text", Some("Get out")) {
            let bottom = t["y"].as_f64().unwrap() + t["h"].as_f64().unwrap();
            assert!(
                bottom < top,
                "{size}: the prompts stand above the cluster ({bottom} over {top})"
            );
        }
        assert_eq!(r.drawn_count("ui_text", Some("Get out")), 1);
        assert_eq!(lua(&g, "require('lib.gear_hud').shown"), "P");
        assert_eq!(lua(&g, "tostring(require('lib.gear_hud').lit)"), "false");
        play(
            &mut g,
            r#"{ "steps": [ { "hold": ["handbrake"], "frames": 10 } ] }"#,
        );
        assert_eq!(
            lua(&g, "tostring(require('lib.gear_hud').lit)"),
            "true",
            "B held: lit"
        );
        play(&mut g, r#"{ "steps": [ { "wait": 5 } ] }"#);
        assert_eq!(
            lua(&g, "tostring(require('lib.gear_hud').lit)"),
            "false",
            "let go: off"
        );
        play(
            &mut g,
            r#"{ "steps": [ { "hold": ["brake"], "press": "confirm", "frames": 8 }, { "wait": 2 } ] }"#,
        );
        assert_eq!(lua(&g, "require('lib.gear_hud').shown"), "R");
    }
    // the horn: L3 sounds it, X and A do not
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "wait": 5 }, { "press": "interact" }, { "wait": 5 }, { "press": "confirm" }, { "wait": 5 }, { "press": "horn" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(logged(&r).iter().filter(|l| *l == "horn").count(), 1);
}

// ---------------------------------------------------------------------------------------------------- the owner's sixth play, the
// buildings' one look, the signposts' angles, the bridge's far half, the paper map's small print and the bass layer
// ("Let's fix the building generator to keep a consistent look. I want it to be a little more rounded."; the rough spots).

/// A model document of the game, read from its file.
fn model_doc(kind: &str) -> Value {
    let root = game_dir();
    serde_json::from_str(
        &std::fs::read_to_string(root.join(format!("models/{kind}.model.json"))).unwrap(),
    )
    .unwrap()
}

/// Every cube of a model (its parts and their children), in the order written.
fn all_cubes(model: &Value) -> Vec<&Value> {
    fn walk<'a>(p: &'a Value, out: &mut Vec<&'a Value>) {
        for c in p["cubes"].as_array().into_iter().flatten() {
            out.push(c);
        }
        for ch in p["children"].as_array().into_iter().flatten() {
            walk(ch, out);
        }
    }
    let mut out = Vec::new();
    for p in model["parts"].as_array().unwrap() {
        walk(p, &mut out);
    }
    out
}

/// A cube's box in metres: its lowest and highest corner (a mesh from its points, a box from its corner and size; turns ignored).
fn cube_box(c: &Value, scale: f64) -> ([f64; 3], [f64; 3]) {
    let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
    let mut take = |p: [f64; 3]| {
        for i in 0..3 {
            lo[i] = lo[i].min(p[i] * scale);
            hi[i] = hi[i].max(p[i] * scale);
        }
    };
    let triple = |v: &Value| {
        [
            v[0].as_f64().unwrap(),
            v[1].as_f64().unwrap(),
            v[2].as_f64().unwrap(),
        ]
    };
    if c["shape"] == "mesh" {
        for v in c["verts"].as_array().unwrap() {
            take(triple(v));
        }
    } else {
        let (f, s) = (triple(&c["from"]), triple(&c["size"]));
        take(f);
        take([f[0] + s[0], f[1] + s[1], f[2] + s[2]]);
    }
    (lo, hi)
}

/// The hue of a "#rrggbb" in degrees and its saturation (HSV).
fn hue_sat(hex: &str) -> (f64, f64) {
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap();
    let (r, g, b) = (
        ((n >> 16) & 255) as f64 / 255.0,
        ((n >> 8) & 255) as f64 / 255.0,
        (n & 255) as f64 / 255.0,
    );
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let d = mx - mn;
    let h = if d == 0.0 {
        0.0
    } else if mx == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if mx == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (h, if mx == 0.0 { 0.0 } else { d / mx })
}

const HOUSES: [&str; 3] = ["post_office", "cabin_hazel", "cabin_pip"];
const BUILDINGS: [&str; 10] = [
    "post_office",
    "cabin_hazel",
    "cabin_pip",
    "workshop",
    "bridge",
    "barrier",
    "fence",
    "gate_post",
    "mast",
    "old_bridge",
];

/// The owner's sixth play: "keep a consistent look ... a little more rounded". tools/models.mjs HOUSE holds the one construction
/// language, and this checks what it makes: every box edge of every building is rounded by the one radius (16 cm, or 0.4 of the thin
/// side where that is less), the three houses have the same window (1.1 x 0.95 m glass), the same door frame (1.38 x 2.29 m, 12 cm
/// deep), a ridge cap of one radius (15 cm), a stone plinth on the ground, and every colour of every building is the palette's (a
/// colour of the palette's hue: the shades of one).
#[test]
fn the_buildings_share_one_house_style_rounded_and_in_the_palette() {
    let root = game_dir();
    // the palette (tools/palette.mjs): every "#rrggbb" in its PAL
    let pal_src = std::fs::read_to_string(root.join("tools/palette.mjs")).unwrap();
    let palette: Vec<String> = pal_src
        .split('#')
        .skip(1)
        .map(|s| format!("#{}", &s[..6]))
        .filter(|s| s[1..].chars().all(|c| c.is_ascii_hexdigit()))
        .collect();
    assert!(palette.len() >= 28, "the palette: {}", palette.len());
    for kind in BUILDINGS {
        let m = model_doc(kind);
        let scale = m["scale"].as_f64().unwrap();
        for c in all_cubes(&m) {
            // every edge radius: at most 16 cm
            for md in c["modifiers"].as_array().into_iter().flatten() {
                let w = md["width"].as_f64().unwrap() * scale;
                assert!(
                    w <= 0.161,
                    "{kind}: a bevel of {w:.3} m (the house edge is 0.16 m)"
                );
            }
            // every colour: the hue of a palette colour (the shades of it)
            let hex = c["color"].as_str().unwrap();
            let (h, s) = hue_sat(hex);
            let near = palette.iter().any(|p| {
                let (ph, ps) = hue_sat(p);
                // (greys and whites carry the palette's warm hue too: compare hues where there is a colour at all)
                let dh = ((h - ph + 540.0).rem_euclid(360.0) - 180.0).abs();
                (s < 0.05 && ps < 0.12) || (dh <= 8.0 && (s - ps).abs() <= 0.35)
            });
            assert!(
                near,
                "{kind}: {hex} is not a palette colour or a shade of one"
            );
        }
    }
    for kind in HOUSES {
        let m = model_doc(kind);
        let scale = m["scale"].as_f64().unwrap();
        let cubes = all_cubes(&m);
        let sized = |hex: &str, want: [f64; 3], tol: f64| -> usize {
            cubes
                .iter()
                .filter(|c| c["color"] == hex)
                .filter(|c| {
                    let (lo, hi) = cube_box(c, scale);
                    (0..3).all(|i| (hi[i] - lo[i] - want[i]).abs() < tol)
                })
                .count()
        };
        // the wall's own corner: the house edge, exactly
        let widest = cubes
            .iter()
            .flat_map(|c| c["modifiers"].as_array().into_iter().flatten())
            .map(|md| md["width"].as_f64().unwrap() * scale)
            .fold(0.0, f64::max);
        assert!(
            (widest - 0.16).abs() < 0.002,
            "{kind}: the house edge is {widest:.3} m"
        );
        // windows: glass 1.1 x 0.95 m
        let windows =
            sized("#5a7d8f", [1.1, 0.95, 0.04], 0.012) + sized("#ffe0a0", [1.1, 0.95, 0.04], 0.012);
        let want = if kind == "post_office" || kind == "cabin_hazel" {
            2
        } else {
            1
        };
        assert_eq!(windows, want, "{kind}: windows of the house size");
        // the door frame, cream, in the wall: 1.38 x 2.29 m, 12 cm deep
        assert_eq!(
            sized("#f3e6c8", [1.38, 2.29, 0.12], 0.012),
            1,
            "{kind}: its door frame"
        );
        // the ridge cap: a smooth cylinder 30 cm across along the ridge
        assert!(
            cubes.iter().any(|c| c["shape"] == "cylinder"
                && ((c["size"][0].as_f64().unwrap() * scale) - 0.30).abs() < 0.004),
            "{kind}: a ridge cap"
        );
        // the stone plinth: dark stone on the ground
        assert!(
            cubes
                .iter()
                .any(|c| c["color"] == "#8c8478" && cube_box(c, scale).0[1].abs() < 0.01),
            "{kind}: a stone plinth on the ground"
        );
    }
}

/// "Kettle Creek's signpost from the south: the Post Road boards are seen edge-on." A board that points along its road is edge-on from
/// that road. Every board of every signpost, from every road that comes to the post, 25 m out along it, over the road's middle, is
/// seen at 30 degrees or more of its face (its length against the sight line to its middle: the sine at least 0.45; the arms are
/// swung off their roads, layout.mjs SIGNS `turn`, 40 degrees at most).
#[test]
fn every_signpost_board_is_seen_at_a_readable_angle_from_each_approach() {
    let root = game_dir();
    let scene: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("scenes/valley.scene.json")).unwrap(),
    )
    .unwrap();
    let objects = scene["objects"].as_array().unwrap();
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
    let (mut seen, mut worst) = (0, 1.0f64);
    for sign in objects.iter().filter(|o| o["kind"] == "signpost") {
        let (sx, sz) = (sign["x"].as_f64().unwrap(), sign["z"].as_f64().unwrap());
        for road in &roads {
            let (best, bd) = road
                .iter()
                .enumerate()
                .map(|(i, p)| (i, ((p.0 - sx).powi(2) + (p.1 - sz).powi(2)).sqrt()))
                .fold((0, f64::MAX), |m, v| if v.1 < m.1 { v } else { m });
            if bd > 30.0 {
                continue;
            }
            for dir in [1i64, -1] {
                // the first point of the road, going out, that is 25 m from the post
                let mut i = best as i64;
                let mut cam = None;
                while (0..road.len() as i64).contains(&(i + dir)) {
                    let (a, b) = (road[i as usize], road[(i + dir) as usize]);
                    let (da, db) = (
                        ((a.0 - sx).powi(2) + (a.1 - sz).powi(2)).sqrt(),
                        ((b.0 - sx).powi(2) + (b.1 - sz).powi(2)).sqrt(),
                    );
                    if da <= 25.0 && db >= 25.0 {
                        let t = (25.0 - da) / (db - da);
                        cam = Some((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
                        break;
                    }
                    i += dir;
                }
                let Some(cam) = cam else { continue };
                for arm in sign["props"]["arms"].as_array().unwrap() {
                    let ry = arm["ry"].as_f64().unwrap();
                    let (ax, az) = (ry.cos(), -ry.sin());
                    let (rx, rz) = (sx + ax * 1.8 - cam.0, sz + az * 1.8 - cam.1);
                    let f = (ax * rz - az * rx).abs() / rx.hypot(rz);
                    worst = worst.min(f);
                    assert!(
                        f >= 0.45,
                        "{}: the {} board is seen at {:.0} degrees from the road 25 m out at {:.0}, {:.0}",
                        sign["name"].as_str().unwrap(),
                        arm["text"].as_str().unwrap(),
                        f.asin().to_degrees(),
                        cam.0,
                        cam.1
                    );
                    seen += 1;
                }
            }
        }
    }
    assert_eq!(seen, 18, "boards checked: 3 arms from 6 approaches");
    assert!(worst < 1.0);
}

/// "Distant forest partly hides the far half of the old bridge from the BRIDGE OUT end." From the barrier to the far ruin runs a
/// corridor, 5 m either side at the barrier widening to 16 m at the ruin and 6 m past it (tools/scene.mjs BRIDGE_VIEW), and no
/// forest mass stands in it: each mass is a capsule along its own x (the model's, scaled and turned as placed, its puffs reaching
/// 1.4 times its blocking radius).
#[test]
fn no_forest_mass_hides_the_old_bridges_far_half_from_the_barrier() {
    let root = game_dir();
    let scene: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("scenes/valley.scene.json")).unwrap(),
    )
    .unwrap();
    let objects = scene["objects"].as_array().unwrap();
    let find = |name: &str| {
        objects
            .iter()
            .find(|o| o["name"] == name)
            .unwrap_or_else(|| panic!("no {name}"))
    };
    let (barrier, far) = (find("barrier"), find("old_bridge_far"));
    let from = (
        barrier["x"].as_f64().unwrap(),
        barrier["z"].as_f64().unwrap(),
    );
    let to = (far["x"].as_f64().unwrap(), far["z"].as_f64().unwrap());
    let len = (to.0 - from.0).hypot(to.1 - from.1);
    assert!(len > 40.0 && len < 70.0, "the view's length: {len}");
    let d = ((to.0 - from.0) / len, (to.1 - from.1) / len);
    let seg = |a: (f64, f64), b: (f64, f64), p: (f64, f64)| {
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let t =
            (((p.0 - a.0) * dx + (p.1 - a.1) * dz) / (dx * dx + dz * dz).max(1e-9)).clamp(0.0, 1.0);
        ((p.0 - a.0 - dx * t).powi(2) + (p.1 - a.1 - dz * t).powi(2)).sqrt()
    };
    let mut masses = 0;
    for o in objects
        .iter()
        .filter(|o| o["kind"].as_str().is_some_and(|k| k.starts_with("forest_")))
    {
        masses += 1;
        let m = model_doc(o["kind"].as_str().unwrap());
        let scale = m["scale"].as_f64().unwrap();
        let cap = &m["capsules"][0];
        let sx = o["props"]["sx"].as_f64().unwrap_or(1.0);
        let ry = o["props"]["ry"].as_f64().unwrap_or(0.0);
        let (c, s) = (ry.cos(), ry.sin());
        let at = |lx: f64| {
            (
                o["x"].as_f64().unwrap() + lx * scale * sx * c,
                o["z"].as_f64().unwrap() - lx * scale * sx * s,
            )
        };
        let (a, b) = (
            at(cap["ax"].as_f64().unwrap()),
            at(cap["bx"].as_f64().unwrap()),
        );
        let r = cap["r"].as_f64().unwrap() * scale * sx * 1.4;
        let mut m_ = 0.0;
        while m_ <= len + 6.0 {
            let q = (from.0 + d.0 * m_, from.1 + d.1 * m_);
            let width = 5.0 + 11.0 * (m_ / len).min(1.0);
            assert!(
                seg(a, b, q) >= r + width - 0.5,
                "a {} at {:.0}, {:.0} stands in the view from the barrier to the far ruin ({:.1} m from the line at {m_:.0} m)",
                o["kind"].as_str().unwrap(),
                o["x"].as_f64().unwrap(),
                o["z"].as_f64().unwrap(),
                seg(a, b, q) - r
            );
            m_ += 2.0;
        }
    }
    assert!(masses > 30, "forest masses: {masses}");
}

/// The paper map's smallest words (the owner's sixth play: 13 px on the Retroid's 720p screen): tools/map.mjs asks Nova's map_make for
/// text_min 16 on both pictures (a word under it is grown to it, or left out, never shrunk: studio/mcp/makers/townmap.test.ts measures
/// every word's size), and the two pictures are the sizes the game shows (650 px for 720p, 976 for 1080p).
#[test]
fn the_paper_map_has_no_word_under_16_px_at_720p() {
    let root = game_dir();
    let src = std::fs::read_to_string(root.join("tools/map.mjs")).unwrap();
    let min: u32 = src
        .split("TEXT_MIN = ")
        .nth(1)
        .and_then(|s| s.split(';').next())
        .and_then(|s| s.trim().parse().ok())
        .expect("TEXT_MIN in tools/map.mjs");
    assert!(min >= 16, "the smallest word: {min} px");
    assert!(
        src.contains("text_min: TEXT_MIN"),
        "both maps are made with the minimum"
    );
    for (file, h) in [
        ("sprites/ui/map_720.png", 650u32),
        ("sprites/ui/map.png", 976u32),
    ] {
        let png = std::fs::read(root.join(file)).unwrap();
        let img = nova_runtime::assets::decode_png(&png).expect("a PNG");
        assert_eq!(img.height as u32, h, "{file}'s height");
    }
}

/// The bass layer on a small speaker (the owner's sixth play, the Retroid): the stem's low voice has its fundamental cut (a parametric
/// EQ dip at 60 Hz) and its second voice plays the same line an octave up. The sound report (tools/music.mjs, docs/sound-for-agents.md)
/// measured the bass stem before: 36 % of its energy under 80 Hz and 77 % under 200 Hz (6.1 dB quieter through a small speaker); after:
/// 4 % and 44 % (2.6 dB). Nobody could listen: these are measurements of the render.
#[test]
fn the_bass_layer_is_voiced_for_a_small_speaker_and_the_stems_stay_in_step() {
    let root = game_dir();
    let song: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("music/fernhollow.song.json")).unwrap(),
    )
    .unwrap();
    let tracks = song["tracks"].as_array().unwrap();
    let track = |name: &str| {
        tracks
            .iter()
            .find(|t| t["name"] == name)
            .unwrap_or_else(|| panic!("no track {name}"))
    };
    let (low, up) = (track("bass"), track("bass upper"));
    let (ln, un) = (
        low["notes"].as_array().unwrap(),
        up["notes"].as_array().unwrap(),
    );
    assert!(
        ln.len() > 100 && ln.len() == un.len(),
        "bass notes {} / upper {}",
        ln.len(),
        un.len()
    );
    for (a, b) in ln.iter().zip(un) {
        assert_eq!(a["step"], b["step"]);
        assert_eq!(
            a["pitch"].as_i64().unwrap() + 12,
            b["pitch"].as_i64().unwrap(),
            "the upper voice is the line an octave up"
        );
    }
    let eq = low["fx"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["type"] == "parametric")
        .expect("the low voice's EQ");
    assert!(
        eq["params"]["f1"].as_f64().unwrap() <= 80.0
            && eq["params"]["g1"].as_f64().unwrap() <= -6.0,
        "the fundamental is cut: {eq}"
    );
    // every stem the game plays together is there (the sound report measured all five at 206.48 s, in step: tools/music.mjs)
    let sizes: Vec<(String, u64)> = ["piano", "bass", "brushes", "pad", "celesta"]
        .iter()
        .map(|s| {
            let f = root.join(format!("music/fernhollow_{s}.ogg"));
            (
                s.to_string(),
                std::fs::metadata(&f)
                    .unwrap_or_else(|_| panic!("{f:?}"))
                    .len(),
            )
        })
        .collect();
    assert!(sizes.iter().all(|(_, n)| *n > 100_000), "stems: {sizes:?}");
}

// ---- the owner's sixth play (2026-11-23): the cast's bodies, the postmaster's outfit, the faces, slopes and steps ----------------
// "Let's remove the messenger bag ... by default let's have the character wear pants not a skirt. Can we also attach the arms and legs
// to the characters. They still look like separate pieces." "The character's outfit looks like a police officer with the blue outfit
// and the badge." The cast is made by tools/cast.mjs (character3d_make); these read the model files it wrote and play the game.

/// A cast member's model file: (its parts by name, with each part's origin in its parent and its shapes' points in metres in the part's
/// own space, and its first shape's colour; the metres a model unit is).
struct CastPart {
    origin: [f64; 3],
    parent: String,
    points: Vec<[f64; 3]>,
    color: String,
}

fn cast_model(name: &str) -> std::collections::HashMap<String, CastPart> {
    let file = game_dir().join(format!("models/{name}.model.json"));
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let k = doc["scale"].as_f64().unwrap();
    let mut out = std::collections::HashMap::new();
    fn visit(
        parts: &Value,
        parent: &str,
        k: f64,
        out: &mut std::collections::HashMap<String, CastPart>,
    ) {
        for p in parts.as_array().unwrap() {
            let o = &p["origin"];
            let name = p["name"].as_str().unwrap().to_string();
            let cubes = p["cubes"].as_array().unwrap();
            let points = cubes
                .first()
                .and_then(|c| c["verts"].as_array())
                .map(|v| {
                    v.iter()
                        .map(|q| {
                            let f = |i: usize| q[i].as_f64().unwrap() * k;
                            [f(0), f(1), f(2)]
                        })
                        .collect()
                })
                .unwrap_or_default();
            let color = cubes
                .first()
                .map(|c| c["color"].as_str().unwrap().to_string())
                .unwrap_or_default();
            let f = |i: usize| o[i].as_f64().unwrap() * k;
            out.insert(
                name.clone(),
                CastPart {
                    origin: [f(0), f(1), f(2)],
                    parent: parent.to_string(),
                    points,
                    color,
                },
            );
            visit(&p["children"], &name, k, out);
        }
    }
    visit(&doc["parts"], "", k, &mut out);
    out
}

/// No bag; trousers for everyone, by default (the hips' own shapes narrow to a crotch between the legs, no skirt flares out over
/// them, and the legs are the colour of the seat of the trousers); and the postmaster dressed as a village postie, not a policeman: a
/// warm-coloured knitted cardigan rather than a navy uniform, a soft bucket hat rather than a peaked cap, an envelope patch, no badge.
#[test]
fn the_cast_wears_trousers_and_the_postmaster_no_bag_and_no_uniform() {
    for who in ["postmaster", "hazel", "pip"] {
        let m = cast_model(who);
        assert!(!m.contains_key("bag"), "{who}: no bag");
        let hips = &m["hips"];
        let leg = &m["leg_l"];
        // (below the legs' tops, the seat of the trousers: never wider than 13 cm from the middle; a skirt was 19 cm)
        let below = leg.origin[1] - 0.03;
        let widest = hips
            .points
            .iter()
            .filter(|p| p[1] < below)
            .map(|p| p[0].abs())
            .fold(0.0, f64::max);
        assert!(
            widest > 0.03 && widest < 0.13,
            "{who}: the hips narrow to a crotch below the legs' tops (widest {widest:.3} m)"
        );
        // (no other shape of the hips reaches down over the legs)
        assert_eq!(
            leg.color, hips.color,
            "{who}: the legs are the trousers' colour"
        );
    }
    let pm = cast_model("postmaster");
    let jacket = &pm["spine"].color;
    let rgb = |h: &str| {
        let v = u32::from_str_radix(&h[1..], 16).unwrap();
        ((v >> 16) as f64, ((v >> 8) & 255) as f64, (v & 255) as f64)
    };
    let (r, _, b) = rgb(jacket);
    assert!(
        r > b + 80.0,
        "the postmaster's jacket is a warm colour, not a uniform's navy: {jacket}"
    );
    assert_ne!(
        jacket, &pm["leg_l"].color,
        "a jacket over trousers of another colour"
    );
    let recipe = std::fs::read_to_string(game_dir().join("tools/cast.mjs")).unwrap();
    let line = recipe
        .lines()
        .find(|l| l.contains("name: \"postmaster\""))
        .unwrap();
    for gone in ["satchel", "peaked", "#2f5fa6"] {
        assert!(
            !line.contains(gone),
            "the postmaster's recipe has no {gone}"
        );
    }
    for wanted in [
        "cardigan",
        "bucket",
        "hat_pin: \"envelope\"",
        "emblem: \"envelope\"",
    ] {
        assert!(line.contains(wanted), "the postmaster wears {wanted}");
    }
    // the game no longer hangs a bag on a spring
    let pm_lua = std::fs::read_to_string(game_dir().join("entities/postmaster.lua")).unwrap();
    assert!(!pm_lua.contains("part = \"bag\""), "no bag's spring");
}

/// The arms and legs are part of one soft body: the top of each is a ball round its own pivot (so whichever way the limb turns, the
/// ball stays where it is), sunk into the body (the torso round a shoulder, the seat of the trousers round a hip), and the sleeve or
/// the trouser leg runs on out of that ball. Then in every clip (idle, walk, run with the arms out, trot, carry, talk, work, sit,
/// wave) and every pose the gait draws while walking, running, trotting with a parcel and sitting in the van, each limb's pivot stays
/// where it is on the body: no limb is ever moved off it, only turned (and a leg made a little longer or shorter from its top), so
/// nothing opens between a limb and the body.
#[test]
fn arms_and_legs_stay_attached_to_the_body_in_every_pose() {
    for who in ["postmaster", "hazel", "pip"] {
        let m = cast_model(who);
        for limb in ["arm_l", "arm_r", "leg_l", "leg_r"] {
            let p = &m[limb];
            // the ball: every point of the limb's shape above its pivot is the same distance from it
            let top: Vec<f64> = p
                .points
                .iter()
                .filter(|q| q[1] > 0.002)
                .map(|q| (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]).sqrt())
                .collect();
            assert!(top.len() > 20, "{who} {limb}: a round top");
            let r = top.iter().cloned().fold(0.0, f64::max);
            let lo = top.iter().cloned().fold(f64::MAX, f64::min);
            assert!(
                r > 0.045,
                "{who} {limb}: a ball as wide as the limb ({r:.3} m)"
            );
            // (its points above the pivot lie on the ball, rounded to the ring where it meets the tube)
            let rim = p
                .points
                .iter()
                .filter(|q| q[1] > 0.002)
                .filter(|q| ((q[0] * q[0] + q[1] * q[1] + q[2] * q[2]).sqrt() - r).abs() > 0.004)
                .count();
            assert_eq!(
                rim, 0,
                "{who} {limb}: its top is a ball about its pivot ({lo:.3} to {r:.3} m)"
            );
            // sunk into the body: the body's surface at the pivot's height, out to the side the limb is on
            let body = &m[&p.parent];
            let side = p.origin[0].signum();
            // (straight between the rings of the body's outline just below and just above the pivot, on its side)
            let outline: Vec<[f64; 2]> = body
                .points
                .iter()
                .filter(|q| q[2].abs() < 0.01 && q[0] * side > 0.0)
                .map(|q| [q[1], q[0].abs()])
                .collect();
            let near = |below: bool| {
                outline
                    .iter()
                    .filter(|q| {
                        (q[1] > 0.0)
                            && if below {
                                q[0] <= p.origin[1]
                            } else {
                                q[0] > p.origin[1]
                            }
                    })
                    .min_by(|a, b| {
                        (a[0] - p.origin[1])
                            .abs()
                            .partial_cmp(&(b[0] - p.origin[1]).abs())
                            .unwrap()
                    })
                    .copied()
            };
            let surface = match (near(true), near(false)) {
                (Some(a), Some(b)) => a[1] + (b[1] - a[1]) * (p.origin[1] - a[0]) / (b[0] - a[0]),
                _ => 0.0,
            };
            let inner = p.origin[0].abs() - r;
            assert!(
                surface > 0.05 && inner < surface - 0.015,
                "{who} {limb}: the ball reaches at least 1.5 cm into the body ({:.3} m into it at the pivot, the body {surface:.3} m out)",
                surface - inner
            );
        }
    }
    // the pivots never move on the body, in any clip or the gait's poses
    let mut g = game();
    play(&mut g, ON_THE_ROAD);
    let check = r#"(function(name, pose, rest)
        local pairs_ = { { 'arm_l', 'spine' }, { 'arm_l', 'head' }, { 'arm_r', 'spine' }, { 'arm_r', 'head' },
          { 'leg_l', 'hips' }, { 'leg_l', 'spine' }, { 'leg_r', 'hips' }, { 'leg_r', 'spine' } }
        local worst = 0
        for _, q in ipairs(pairs_) do
          local a, b, ra, rb = pose[q[1]], pose[q[2]], rest[q[1]], rest[q[2]]
          local d = math.sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2 + (a.z - b.z) ^ 2)
          local d0 = math.sqrt((ra.x - rb.x) ^ 2 + (ra.y - rb.y) ^ 2 + (ra.z - rb.z) ^ 2)
          worst = math.max(worst, math.abs(d - d0))
        end
        return worst end)"#
        .replace('\n', " ");
    assert_eq!(
        lua(
            &g,
            &format!("(function() LIMBS = {check}; return 'ok' end)()")
        ),
        "ok"
    );
    for who in ["postmaster", "hazel", "pip"] {
        let worst = num(
            &g,
            &format!(
                "(function() local rest = nova.model_pose('{who}', {{}}); local worst, n = 0, 0; \
                 for _, c in ipairs({{ 'idle', 'walk', 'run', 'trot', 'carry', 'talk', 'work', 'sit', 'wave' }}) do \
                   for i = 0, 11 do n = n + 1; worst = math.max(worst, LIMBS('{who}', nova.model_pose('{who}', {{ clip = c, time = i * 0.09 }}), rest)) end end; \
                 return n >= 100 and worst or 99 end)()"
            ),
        );
        assert!(
            worst < 0.001,
            "{who}: a limb's pivot moved on the body in a clip by {worst} m"
        );
    }
    // the gait's poses: walking, running (B held: the arms out), trotting with a parcel, and sitting at the wheel
    assert_eq!(
        lua(
            &g,
            "(function() GW = { worst = 0, n = 0, moved = false, scale = { 9, 0 } }; local rest = nova.model_pose('postmaster', {}); \
             function GW_STEP() local p = nova.named('postmaster'); local layers = p.anim:layers(); \
               for _, l in ipairs(p.walker:extra(p.carry_w and p.carry_w > 0.01 and p.carry_layer or nil)) do layers[#layers + 1] = l end; \
               local parts = p.seated and {} or p.walker:parts({}); \
               for _, k in ipairs({ 'arm_l', 'arm_r', 'leg_l', 'leg_r' }) do local q = parts[k]; \
                 if q and (q.x or q.y or q.z) then GW.moved = true end; \
                 if q and q.scale then GW.scale[1] = math.min(GW.scale[1], q.scale); GW.scale[2] = math.max(GW.scale[2], q.scale) end end; \
               GW.n = GW.n + 1; GW.worst = math.max(GW.worst, LIMBS('postmaster', nova.model_pose('postmaster', { layers = layers, parts = parts }), rest)) end; \
             return 'ok' end)()"
        ),
        "ok"
    );
    play(
        &mut g,
        r#"{ "each_frame": "GW_STEP()", "steps": [
            { "hold": ["move_y=-0.6"], "frames": 50 },
            { "hold": ["move_y=-1"], "frames": 50 },
            { "hold": ["move_y=-1", "run"], "frames": 70 },
            { "hold": ["move_x=1", "run"], "frames": 40 },
            { "wait": 30, "lua": "require('lib.state').carrying = 'hazel'" },
            { "hold": ["move_y=-1", "run"], "frames": 70 },
            { "wait": 30, "lua": "require('lib.state').carrying = nil; local v = nova.named('van'); v:teleport(6, -100, 0); nova.scene_now().mode = 'van'; v.driven = true; nova.named('postmaster').seated = true" },
            { "wait": 40 }
        ] }"#,
    );
    let n = num(&g, "GW.n");
    let worst = num(&g, "GW.worst");
    assert!(n > 350.0, "frames measured: {n}");
    assert!(
        worst < 0.001,
        "the gait moved a limb's pivot on the body by {worst} m"
    );
    assert_eq!(
        lua(&g, "tostring(GW.moved)"),
        "false",
        "the gait only turns and stretches the limbs"
    );
    let (lo, hi) = (num(&g, "GW.scale[1]"), num(&g, "GW.scale[2]"));
    assert!(
        lo >= 0.83 && hi <= 1.13,
        "a leg is stretched or squashed only a little from its top: {lo} to {hi}"
    );
}

/// The sole of each foot, toe to heel, against the ground under each point of it, every frame: what pokes into the ground (a toe
/// into the riser of the next step up the porch, a heel into the one behind going down). `SP.tags[tag]` is the most (metres).
const SOLE_PROBE: &str = r#"
SP = { tags = {}, tag = "", info = {} }
local SOLE = { ankle = 0.044, forward = 0.025, half = 0.082, round = 0.034 }
function SP_STEP(name)
  local p = nova.named(name)
  local W = require("lib.world")
  local layers = p.anim:layers()
  for _, l in ipairs(p.walker:extra(p.carry_w and p.carry_w > 0.01 and p.carry_layer or nil)) do layers[#layers + 1] = l end
  local pose = nova.model_pose(p.model or name, { layers = layers, parts = p.walker:parts({}) })
  local feet = p.walker:feet()
  local c, s = math.cos(p.face), math.sin(p.face)
  local most = SP.tags[SP.tag] or 0
  for i, fname in ipairs({ "foot_l", "foot_r" }) do
    local f = pose[fname]
    local ax, az, ay = p.x + f.x * c + f.z * s, p.z - f.x * s + f.z * c, (p.y or 0) + f.y
    local ca, sa = math.cos(feet[i].pitch), math.sin(feet[i].pitch)
    for j = 0, 32 do
      local t = math.pi + math.pi * j / 32
      local z, y = SOLE.forward + SOLE.half * math.cos(t), -(SOLE.ankle - SOLE.round) + SOLE.round * math.sin(t)
      local zz, yy = z * ca + y * sa, -z * sa + y * ca
      local wx, wz = ax + zz * math.sin(feet[i].yaw), az + zz * math.cos(feet[i].yaw)
      local g = W.height(wx, wz) - nova.terrain_height(p.x, p.z)
      if g - (ay + yy) > most then
        most = g - (ay + yy)
        local L = p.walker.legs[i]
        SP.info[SP.tag] = string.format("foot %d %s (%s), %.3f m along the sole, the ankle %.3f up over ground %.3f, the body %.2f up at %.2f m/s; the gait's ankle %.3f up, the leg scaled %.3f", i, feet[i].planted and "down" or "in the air", tostring(feet[i].pivot), zz, ay, W.height(ax, az) - nova.terrain_height(p.x, p.z), p.y or 0, p.speed or 0, L.ay or 0, L.scale or 0)
      end
    end
  end
  SP.tags[SP.tag] = most
end
"#;

/// Up and down the post office's porch steps, at a walk and at a run: no toe pokes into the riser of the step above and no heel into
/// the one behind (the gait lands each sole wholly on one tread, and a foot swinging up a step clears the riser with its toe, not
/// only its ankle). On the steepest open hillside near the road the cast is drawn upright, lifted as one by the ground under it (the
/// renderer's lift point by point sheared the body with the slope), the feet standing on the hillside where the gait puts them; so
/// are Hazel and Pip.
#[test]
fn no_toe_goes_into_a_step_and_the_cast_stands_upright_on_a_hillside() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    let probe: Vec<&str> = SOLE_PROBE
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect();
    assert_eq!(
        lua(
            &g,
            &format!("(function() {} return 'ok' end)()", probe.join(" "))
        ),
        "ok"
    );
    let porch = |g: &mut Game, tag: &str, pace: f64| {
        play(
            g,
            r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.x, p.z = d.x + fx * 6, d.z + fz * 6; p.face = math.atan(-fx, -fz); p.walk_to, p.walk_path = nil, nil" }, { "wait": 20 } ] }"#,
        );
        play(
            g,
            &format!(
                r#"{{ "each_frame": "SP_STEP('postmaster')", "steps": [ {{ "lua": "SP.tag = '{tag} up'; local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.walk_path = {{ {{ d.x + fx * 1.4, d.z + fz * 1.4 }} }}; p.walk_pace = {pace}" }}, {{ "wait": 240 }},
                   {{ "lua": "SP.tag = '{tag} down'; local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.walk_path = {{ {{ d.x + fx * 6, d.z + fz * 6 }} }}; p.walk_pace = {pace}" }}, {{ "wait": 240 }} ] }}"#
            ),
        )
    };
    porch(&mut g, "walk", 1.6);
    porch(&mut g, "run", 2.8);
    for tag in ["walk up", "walk down", "run up", "run down"] {
        let poke = num(&g, &format!("SP.tags['{tag}'] or -1"));
        assert!(
            (0.0..0.012).contains(&poke.max(0.0)) && poke > -1.0,
            "{tag} the porch steps: a sole went {poke} m into a step ({})",
            lua(&g, &format!("SP.info['{tag}']"))
        );
    }
    // the steepest open grass within 40 m of the road south of the post office: drawn upright, the feet on the hillside
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
    let (ux, uz) = (-gz / s, gx / s);
    play(
        &mut g,
        &format!(
            r#"{{ "steps": [ {{ "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = {}, {}, math.atan({ux}, {uz}); p.walk_to, p.walk_path = nil, nil" }}, {{ "wait": 20 }},
               {{ "lua": "SP.tag = 'hillside'; nova.named('postmaster').walk_path = {{ {{ {}, {} }} }}" }} ] }}"#,
            x - ux * 2.5,
            z - uz * 2.5,
            x + ux * 2.5,
            z + uz * 2.5
        ),
    );
    play(
        &mut g,
        r#"{ "each_frame": "SP_STEP('postmaster')", "steps": [ { "wait": 60 } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(nova.named('postmaster').draw_opts.lift)"),
        "origin",
        "drawn upright on the hillside"
    );
    let hill = num(&g, "SP.tags['hillside'] or -1");
    assert!(
        hill > -1.0 && hill < 0.03,
        "on a {s:.2} hillside a sole goes {hill} m into the ground"
    );
    for who in ["hazel", "pip"] {
        assert_eq!(
            lua(&g, &format!("tostring(nova.named('{who}').draw_opts.lift)")),
            "origin",
            "{who} is drawn upright too"
        );
    }
}

// ---- the sixth play's note 5: painted grass, trees and creek (docs/games/mountain-post.md, "What the sixth play changed") ----

/// Every tree, bush and forest mass of the valley is painted (a tree's leaves as foliage, a forest mass as canopy: model.rs
/// PAINT_STEP in each vertex's emissive), with its trunk left plain, and none costs more triangles than its budget (the valley draws
/// about 440 trees and 66 masses).
#[test]
fn the_valleys_trees_are_painted_and_within_their_triangles() {
    use nova_runtime::model::{PAINT_STEP, import_glb};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/mountain-post/models");
    for (kind, paint, budget, leafy) in [
        ("pine", 1.0, 450, 0.8),
        ("pine2", 1.0, 600, 0.8),
        ("pine3", 1.0, 450, 0.8),
        ("pine_far", 1.0, 200, 0.7),
        ("larch", 1.0, 520, 0.8),
        ("larch_small", 1.0, 520, 0.8),
        ("larch_far", 1.0, 200, 0.7),
        ("birch", 1.0, 750, 0.75),
        ("bush", 1.0, 450, 1.0),
        ("bush2", 1.0, 450, 1.0),
        ("forest_long", 2.0, 600, 1.0),
        ("forest_tall", 2.0, 500, 1.0),
        ("forest_round", 2.0, 500, 1.0),
    ] {
        let mesh =
            import_glb(&std::fs::read(root.join(format!("{kind}.glb"))).unwrap()).expect("imports");
        assert!(mesh.notes.is_empty(), "{kind}: {:?}", mesh.notes);
        let tris = mesh.indices.len() / 3;
        assert!(
            tris <= budget,
            "{kind}: {tris} triangles, over its budget of {budget}"
        );
        let painted = mesh
            .vertices
            .iter()
            .filter(|v| (v.emissive - paint * PAINT_STEP).abs() < 0.5)
            .count();
        let share = painted as f64 / mesh.vertices.len() as f64;
        assert!(
            share >= leafy - 1e-9,
            "{kind}: {:.0}% of its points are painted as kind {paint}",
            share * 100.0
        );
        // (nothing glows: every point is plain, or painted with no glow on top)
        assert!(
            mesh.vertices
                .iter()
                .all(|v| v.emissive == 0.0 || (v.emissive - paint * PAINT_STEP).abs() < 0.5),
            "{kind}"
        );
    }
}

/// The creek is painted running water between banks of finer painted ground, which take the place of the valley's 4 m squares along
/// the water, and its waterline runs smoothly: the heightmap's 2 m cells used to cut the channel's sides into steps that drew a
/// toothed waterline.
#[test]
fn the_creek_runs_between_smooth_painted_banks() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "route": [ { "wait": 5 } ] }"#,
    );
    // both waters (the creek and the river in the gorge) built their surface and their banks
    assert_eq!(
        num(
            &g,
            "(function() local n = 0; for _, w in ipairs(nova.all('water')) do if w.mesh and w.bank and #w.waterline > 20 then n = n + 1 end end; return n end)()"
        ),
        2.0
    );
    // the creek's waterline: two crossings a row (one each side, outside most of the water's half width), and from one row to the
    // next (about 3 m on) it bends gently: no row stands out from the line through its neighbours by more than 20 cm (on the plain
    // heightmap, the old banks, as much as 37 cm)
    let creek = "(function() for _, w in ipairs(nova.all('water')) do if w.key == 'creek' then return w end end end)()";
    let rows = num(&g, &format!("#{creek}.waterline"));
    assert!(rows > 150.0, "the creek's bank has {rows} rows");
    let two = num(
        &g,
        &format!(
            "(function() local n = 0; for _, l in ipairs({creek}.waterline) do if #l == 2 and l[1] < -1.5 and l[2] > 1.5 then n = n + 1 end end; return n end)()"
        ),
    );
    assert!(
        two > rows * 0.9,
        "{two} of {rows} rows cross the waterline once each side"
    );
    let worst = num(
        &g,
        &format!(
            "(function() local L, worst = {creek}.waterline, 0; for r = 2, #L - 1 do local a, b, c = L[r - 1], L[r], L[r + 1]; \
             if #a == 2 and #b == 2 and #c == 2 then for s = 1, 2 do worst = math.max(worst, math.abs(a[s] - 2 * b[s] + c[s]) / 2) end end end; \
             return worst end)()"
        ),
    );
    assert!(
        worst < 0.2,
        "the waterline wiggles by up to {worst:.2} m from row to row"
    );
}

// ---- the post office room: the package counter, the picture frame, the belt window, the old computer (the owner, 2026-11-23) ----------

/// Where the aisle in front of a tile of the package counter is (tile 1 is the leftmost; they are 0.6 m apart).
fn aisle_in_front_of_tile(g: &Game, i: usize) -> (f64, f64) {
    (
        num(g, &format!("nova.named('tile_{i}').x")),
        num(g, &format!("nova.named('tile_{i}').z")) + 0.85,
    )
}

/// The package counter has ten square tiles in a row along the back wall, 0.6 m apart, and the day's two parcels lie one to a tile
/// on the first two from the left (the rest empty); each parcel sits at its tile's middle.
#[test]
fn the_package_counter_holds_one_parcel_to_a_tile() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "route": [ { "wait": 10 } ] }"#,
    );
    assert_eq!(num(&g, "#nova.all('tile')"), 10.0);
    for i in 1..=10 {
        assert!(
            (num(&g, &format!("nova.named('tile_{i}').x")) - (-3.0 + 0.6 * (i as f64 - 1.0))).abs()
                < 1e-6,
            "tile {i} is 0.6 m from the last"
        );
        assert!(
            (num(&g, &format!("nova.named('tile_{i}').z")) - num(&g, "nova.named('tile_1').z"))
                .abs()
                < 1e-6,
            "the tiles are in one row"
        );
    }
    // the first parcels on the first two tiles, nothing else on a tile
    assert_eq!(
        lua(
            &g,
            "(function() local t = require('lib.state').settle(); local s = {}; for i = 1, 10 do s[#s + 1] = tostring(t[i]) end; return table.concat(s, ',') end)()"
        ),
        "hazel,pip,nil,nil,nil,nil,nil,nil,nil,nil"
    );
    // each parcel at its tile's middle
    for (who, tile) in [("hazel", 1), ("pip", 2)] {
        for axis in ["x", "z"] {
            assert!(
                (num(&g, &format!("nova.named('parcel_{who}').{axis}"))
                    - num(&g, &format!("nova.named('tile_{tile}').{axis}")))
                .abs()
                    < 1e-6,
                "{who} lies at the middle of tile {tile}"
            );
        }
    }
    // and the old shelf (by the right-hand wall) is gone: nothing of the parcels is drawn there
    assert_eq!(
        num(
            &g,
            "(function() local n = 0; for _, d in ipairs(nova.testing.drawn('model', 'parcel_')) do if d.x > 3.0 then n = n + 1 end end; return n end)()"
        ),
        0.0
    );
}

/// Taking a parcel empties its tile (the model leaves it) and the other stays put; putting it back fills the first free tile; every
/// tile and the Mayor's letter can be reached on foot.
#[test]
fn taking_a_parcel_empties_its_tile_and_putting_it_back_fills_the_first_free_one() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit'); S = require('lib.state')", "route": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('hazel')" }, { "until": "not T.walking()", "max": 600 },
        { "wait": 5, "lua": "OFFER = nova.scene_now():action()" },
        { "press": "interact" }, { "wait": 30 }, { "press": "interact" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "OFFER"), "take");
    assert_eq!(lua(&g, "S.carrying"), "hazel");
    let tiles = "(function() local t = S.settle(); return tostring(t[1]) .. ',' .. tostring(t[2]) .. ',' .. tostring(t[3]) end)()";
    assert_eq!(
        lua(&g, tiles),
        "nil,pip,nil",
        "tile 1 is empty, Pip's parcel stayed"
    );
    assert_eq!(
        num(
            &g,
            "(function() local n = 0; local t = nova.named('tile_1'); for _, d in ipairs(nova.testing.drawn('model', 'parcel_hazel')) do if math.abs(d.x - t.x) < 0.2 and math.abs(d.z - t.z) < 0.2 and d.y < 1.0 then n = n + 1 end end; return n end)()"
        ),
        0.0,
        "no parcel model is on the emptied tile"
    );
    // put it back from another place along the counter: it goes to the first free tile, which is tile 1 again
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "nova.named('postmaster').walk_to = { nova.named('tile_5').x, nova.named('tile_5').z + 0.85 }" }, { "until": "not T.walking()", "max": 600 },
        { "wait": 5, "lua": "OFFER = nova.scene_now():action()" }, { "press": "interact" }, { "wait": 20 } ] }"#,
    );
    assert_eq!(lua(&g, "OFFER"), "put_back");
    assert_eq!(lua(&g, "tostring(S.carrying)"), "nil");
    assert_eq!(lua(&g, tiles), "hazel,pip,nil");
    // every tile can be reached (the postmaster stands in front of it, in reach), and the letter can be read
    for i in 1..=10 {
        let (x, z) = aisle_in_front_of_tile(&g, i);
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "nova.named('postmaster').walk_to = {{ {x}, {z} }}" }}, {{ "until": "not T.walking()", "max": 900 }}, {{ "wait": 3, "lua": "REACHED = (function() local p = nova.named('postmaster'); return math.sqrt((p.x - ({x})) ^ 2 + (p.z - ({z})) ^ 2) end)()" }} ] }}"#
            ),
        );
        assert!(
            num(&g, "REACHED") < 0.35,
            "tile {i} is reachable: {}",
            num(&g, "REACHED")
        );
    }
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "nova.named('postmaster').walk_path = { { -2.4, -1.46 }, { -2.4, 0.35 }, { 1.0, 0.35 } }" }, { "until": "not T.walking()", "max": 900 },
        { "wait": 10 }, { "lua": "OFFER = tostring(nova.scene_now():action()); POS = nova.named('postmaster').x .. ' ' .. nova.named('postmaster').z .. ' ctl ' .. tostring(nova.named('postmaster').control)" } ] }"#,
    );
    assert_eq!(
        lua(&g, "OFFER"),
        "read",
        "the Mayor's letter on the desk mat can be read (at {})",
        lua(&g, "POS")
    );
}

/// The picture frame's number is the parcels not yet delivered (in the room, in the arms or in the van): 2, then 1, then 0, and two
/// figures from ten on.
#[test]
fn the_picture_frame_counts_the_parcels_still_to_deliver() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "S = require('lib.state')", "route": [ { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().tally"), "2");
    // one in the arms and one in the van are still to deliver
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.carrying = 'hazel'; S.on_shelf.hazel = false; S.van_load = { 'pip' }; S.on_shelf.pip = false" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().tally"), "2");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.delivered.hazel = true; S.carrying = nil" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().tally"), "1");
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.delivered.pip = true; S.van_load = {}" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().tally"), "0");
    // a backlog of twelve shows both figures
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "S.WAITING = { 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l' }; S.delivered = {}" }, { "wait": 3 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().tally"), "12");
}

/// The old computer on the front counter is only scenery for now: standing at it offers nothing, and X there does nothing.
#[test]
fn the_old_computer_has_no_prompt() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "route": [
        { "wait": 10, "lua": "local c = nova.named('old_computer'); nova.named('postmaster').walk_to = { c.x, c.z + 1.0 }" }, { "until": "not T.walking()", "max": 600 },
        { "wait": 5, "lua": "OFFER = tostring(nova.scene_now():action()); HINT = #nova.scene_now().hint" },
        { "press": "interact" }, { "wait": 20, "lua": "CARD = tostring(require('lib.cards').active())" } ] }"#,
    );
    assert_eq!(lua(&g, "OFFER"), "nil");
    assert_eq!(
        num(&g, "HINT"),
        1.0,
        "only the map's hint (Select) is shown"
    );
    assert_eq!(lua(&g, "CARD"), "false");
    assert_eq!(
        lua(&g, "tostring(require('lib.state').letter_read)"),
        "false"
    );
}

/// Through a whole slice playthrough the number in the picture frame is the number of parcels not yet handed over, every frame the
/// room is shown: 2 at the start, 1 after the first delivery (back in the room), 0 after the second.
#[test]
#[ignore = "long: about 17 s; scripts/test.sh all (or one mountain_post) runs it"]
fn the_picture_frame_shows_the_parcels_still_to_deliver_through_the_whole_slice() {
    let mut g = game();
    let mut plan: Value = serde_json::from_str(&slice_route(false)).unwrap();
    let setup = plan["lua"].as_str().unwrap().to_string();
    plan["lua"] = Value::String(format!("{setup}; SEEN = {{}}; S = require('lib.state')"));
    plan["lua_each_frame"] = Value::String(
        "local sc = nova.scene_now(); if sc and sc.tally and nova.current_scene() == 'office' then local k = sc.tally .. '/' .. S.remaining(); SEEN[k] = (SEEN[k] or 0) + 1 end".into(),
    );
    let r = testing::play(&mut g, &plan.to_string()).expect("the route plays");
    assert!(r.errors().is_empty(), "errors: {:?}", r.errors());
    assert_eq!(
        lua(&g, "tostring(S.delivered.hazel and S.delivered.pip)"),
        "true"
    );
    let seen = lua(
        &g,
        "(function() local k = {}; for key, n in pairs(SEEN) do k[#k + 1] = key .. '=' .. n end; table.sort(k); return table.concat(k, ' ') end)()",
    );
    // (every frame the room was shown, the number drawn was the number still to deliver; a frame or two when it was entered may lag)
    let mut shown = std::collections::BTreeMap::new();
    for kv in seen.split(' ') {
        let (k, n) = kv.split_once('=').unwrap();
        let (drawn, want) = k.split_once('/').unwrap();
        let n: u32 = n.parse().unwrap();
        if drawn != want {
            assert!(
                n <= 2,
                "the frame showed {drawn}, {want} to deliver: {seen}"
            );
        } else {
            shown.insert(drawn.to_string(), n);
        }
    }
    for n in ["2", "1", "0"] {
        assert!(
            shown.get(n).copied().unwrap_or(0) > 10,
            "the frame showed {n} for a while: {seen}"
        );
    }
}

/// "We don't need the camera dodge when the player is behind the van or other characters." The van or a resident stands on the
/// line from the camera to the postmaster, and the camera does not move: the eye is where it was, nothing is lifted or swung.
#[test]
fn the_camera_does_not_move_for_the_van_or_a_resident_between() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "CAM = require('lib.camera'); W = require('lib.world')",
        "steps": [ { "wait": 5 }, { "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 150, 36, 0; p.walk_to = nil; p.walk_path = nil; CAM.reset(0); nova.named('van'):teleport(300, 300, 0)" },
        { "wait": 80 }, { "lua": "local e = CAM.state.eye; E0 = { e[1], e[2], e[3] }; LIFT0 = CAM.state.lift" },
        { "lua": "local p = nova.named('postmaster'); local e = CAM.state.eye; local dx, dz = e[1] - p.x, e[3] - p.z; local l = math.sqrt(dx * dx + dz * dz); local h = nova.named('hazel'); h.x, h.z = p.x + dx / l * 3, p.z + dz / l * 3; h.mode = 'work'; h.work_at = { h.x, h.z }; h.home = { h.x, h.z }; local v = nova.named('van'); v:teleport(p.x + dx / l * 4.5, p.z + dz / l * 4.5, 0)" },
        { "wait": 90 }, { "lua": "local p = nova.named('postmaster'); local e = CAM.state.eye; local v = nova.named('van'); local g = W.height(p.x, p.z); VAN_IN = CAM.van_between(v, e[1], e[2], e[3], p.x, g + 0.85, p.z) and 1 or 0; EYE_MOVED = math.abs(e[1] - E0[1]) + math.abs(e[2] - E0[2]) + math.abs(e[3] - E0[3]); LIFT_MOVED = math.abs(CAM.state.lift - LIFT0)" } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(CAM.state.dodge_p)"),
        "nil",
        "no dodge state any more"
    );
    assert!(
        num(&g, "EYE_MOVED") < 0.02,
        "the eye stayed where it was: moved {} m",
        num(&g, "EYE_MOVED")
    );
    assert!(num(&g, "LIFT_MOVED") < 0.02, "nothing was lifted");
}

/// "We need to add creep for D R and L." With the pedals up, on the flat (the van's own step at Post Road): D creeps at 1.2 to 1.5
/// m/s, L a little slower (but with more pull), R about 1 m/s backwards; P and N never creep. It builds in over a second or so with
/// no jump in the acceleration. Any brake overcomes it: held from a standstill the van stays exactly still (no shudder), and let go
/// it creeps off; the handbrake overcomes it too.
#[test]
fn d_l_and_r_creep_at_idle_p_and_n_do_not_and_the_brake_holds_it_still() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local v = nova.named('van'); local dt = 1 / 60; \
         local function run(gear, brake, hb, n, fresh) if fresh ~= false then v:teleport(4.5, -150, 0); v.creep_k = 0 end; v.driven = true; v.gear = gear; \
           local most, prev_a, jump, first_a, t1 = 0, nil, 0, nil, nil; \
           for i = 1, n do local v0 = v.speed; v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, brake, 0, hb; v:drive(dt); v.x, v.z, v.heading = 4.5, -150, 0; \
             local a = (v.speed - v0) / dt; if prev_a and i > 2 then jump = math.max(jump, math.abs(a - prev_a)) end; prev_a = a; first_a = first_a or a; \
             most = math.max(most, math.abs(v.speed)); if not t1 and math.abs(v.speed) >= 1.0 then t1 = i * dt end end; \
           return v.speed, most, jump, first_a, t1 or -1 end; \
         local d, _, d_jump, d_first, d_t1 = run('D', 0, 0, 600); local l = run('L', 0, 0, 600); local r = run('R', 0, 0, 600); \
         local p = run('P', 0, 0, 600); local n = run('N', 0, 0, 600); \
         local _, held = run('D', 0.4, 0, 300); local _, held_light = run('D', 0.05, 0, 300); local _, hb = run('D', 0, 1, 300); \
         run('D', 0.4, 0, 60); local off = run('D', 0, 0, 180, false); \
         return string.format('%.3f %.3f %.3f %.4f %.4f %.4f %.4f %.4f %.4f %.3f %.3f %.3f %.3f', d, l, r, p, n, held, held_light, hb, d_jump, d_first, d_t1, off, v.TUNE.creep_pull.L / v.TUNE.creep_pull.D) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    let (d, l, r, p, n) = (v[0], v[1], v[2], v[3], v[4]);
    assert!((1.2..=1.5).contains(&d), "D creeps at {d} m/s ({out})");
    assert!(
        (0.9..d).contains(&l) && v[12] > 1.5,
        "L creeps a little slower, with more pull ({out})"
    );
    assert!((-1.15..=-0.85).contains(&r), "R creeps backwards ({out})");
    assert!(
        p.abs() < 1e-6 && n.abs() < 0.05,
        "P and N do not creep ({out})"
    );
    assert!(
        v[5] < 1e-6 && v[6] < 1e-6,
        "the brake, hard or light, holds it exactly still from a standstill ({out})"
    );
    assert!(v[7] < 1e-6, "the handbrake overcomes it ({out})");
    // (the first step from the teleport also meets the road's own gentle fall, about 0.17 m/s^2 here: the creep's own share of
    // it is its pull times one step's easing, about 0.04)
    assert!(
        v[8] < 0.12 && v[9].abs() < 0.25,
        "it builds with no jump in the acceleration: largest change {} m/s^2 a step, first step {} m/s^2 ({out})",
        v[8],
        v[9]
    );
    assert!(
        (0.8..=3.0).contains(&v[10]),
        "1 m/s after {} s: over a second or so ({out})",
        v[10]
    );
    assert!(v[11] > 0.6, "let go of the brake, it creeps off ({out})");
}

/// Creeping in D, the van cannot be got out of (it is moving); stopped on the brake, or in P, it can, and getting out parks it.
/// The autopilot stops on the brake and parks at the end of a drive.
#[test]
fn a_creeping_van_is_not_stopped_until_braked_or_in_p() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "nova.named('van'):teleport(4.5, -150, 0); local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "press": "confirm" }, { "wait": 3 }, { "press": "confirm" }, { "wait": 3 }, { "press": "confirm" }, { "wait": 150 }, { "press": "van" }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "D");
    assert!(num(&g, "nova.named('van').speed") > 1.0, "creeping in D");
    assert_eq!(
        lua(&g, "nova.scene_now().mode"),
        "van",
        "no getting out of a creeping van"
    );
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "frames": 90 }, { "hold": ["brake"], "frames": 1, "lua": "SPEED = nova.named('van').speed" } ] }"#,
    );
    assert!(num(&g, "SPEED").abs() < 1e-6, "held still on the brake");
    assert_eq!(r.drawn_count("ui_text", Some("Get out")), 1, "the prompt");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "press": "van", "frames": 6 }, { "wait": 5 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    assert_eq!(lua(&g, "nova.named('van').gear"), "P", "left in P");
}

/// The speedometer's needle follows the speed in km/h, eased (no step of more than a little from one frame to the next), reads 0
/// standing, and backing up it shows the speed it backs at.
#[test]
fn the_speedometer_needle_follows_the_speed_smoothly() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "nova.named('van'):teleport(4.5, -150, 0); local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" },
        { "wait": 20 } ] }"#,
    );
    assert!(num(&g, "require('lib.gear_hud').kmh") < 0.01, "0 standing");
    let r = play(
        &mut g,
        r#"{ "steps": [ { "press": "confirm" }, { "wait": 2 }, { "press": "confirm" }, { "wait": 2 }, { "press": "confirm" },
        { "hold": ["go"], "frames": 360, "record": "string.format('%.3f', require('lib.gear_hud').kmh)" } ] }"#,
    );
    let (kmh, speed) = (
        num(&g, "require('lib.gear_hud').kmh"),
        num(&g, "nova.named('van').speed"),
    );
    assert!(
        (kmh - speed * 3.6).abs() < 1.0,
        "the needle at {kmh} km/h, the van at {} km/h",
        speed * 3.6
    );
    let rec = r.record("string.format('%.3f', require('lib.gear_hud').kmh)");
    let vals: Vec<f64> = rec.iter().map(|(_, _, v)| v.parse().unwrap()).collect();
    let step = vals
        .windows(2)
        .map(|p| (p[1] - p[0]).abs())
        .fold(0.0, f64::max);
    assert!(step < 0.6, "eased: at most {step} km/h a frame");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["brake"], "until": "math.abs(nova.named('van').speed) < 0.05", "max": 400 }, { "press": "interact" }, { "wait": 2 }, { "press": "interact" },
        { "hold": ["go"], "frames": 200 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('van').gear"), "R");
    let (kmh, speed) = (
        num(&g, "require('lib.gear_hud').kmh"),
        num(&g, "nova.named('van').speed"),
    );
    assert!(
        speed < -1.0 && (kmh + speed * 3.6).abs() < 0.8,
        "backing up, the needle at {kmh} for {speed} m/s"
    );
}

/// "the game should pause on focus loss": when the window loses the focus (the Steam overlay, another app), the valley and the
/// post office open the pause menu and the world stands, as Start does; a card already open stays as it is.
#[test]
fn losing_the_focus_pauses_the_game() {
    for scene in ["valley", "office"] {
        let mut g = game();
        play(
            &mut g,
            &format!(r#"{{ "start_scene": "{scene}", "steps": [ {{ "wait": 30 }} ] }}"#),
        );
        assert_eq!(lua(&g, "tostring(require('lib.cards').active())"), "false");
        g.set_focused(false);
        play(&mut g, r#"{ "steps": [ { "wait": 2 } ] }"#);
        assert_eq!(
            lua(&g, "tostring(require('lib.cards').active())"),
            "true",
            "{scene}: the pause menu opens when the focus goes"
        );
        let probe =
            "(function() return table.concat({ nova.time(), nova.scene_now().t }, ',') end)()";
        let before = lua(&g, probe);
        play(&mut g, r#"{ "steps": [ { "wait": 30 } ] }"#);
        assert_eq!(lua(&g, probe), before, "{scene}: the world stands");
        // coming back does not close it by itself; losing it again does not open a second card
        g.set_focused(true);
        play(&mut g, r#"{ "steps": [ { "wait": 2 } ] }"#);
        assert_eq!(lua(&g, "tostring(require('lib.cards').active())"), "true");
    }
}

/// The instrument reads cleanly (the coordinator's list of the cluster's weak points): standing, the needle rests on its peg, clear
/// of the "0", of every number and of the gears' row; the handbrake lamp keeps clear of the numbers; the ticks are bold and dark.
#[test]
fn the_instruments_needle_rests_clear_of_the_numbers_and_the_lamp_does_not_crowd_them() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "local s = nova.scene_now(); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.DOOR); s:get_in()" }, { "wait": 30 } ] }"#,
    );
    let out = lua(
        &g,
        "(function() local H = require('lib.gear_hud'); local L, D = H.last, H.DIAL; local a = H.angle; \
         local function off_needle(px, py) local dx, dy = math.sin(a), -math.cos(a); local t = math.max(0, math.min(L.r - 9, (px - L.cx) * dx + (py - L.cy) * dy)); \
           return math.sqrt((px - L.cx - dx * t) ^ 2 + (py - L.cy - dy * t) ^ 2) end; \
         local near_num, near_gear, lamp = 1e9, 1e9, 1e9; \
         for k = 0, D.top, 10 do local ka = D.from + (D.to - D.from) * k / D.top; local nx, ny = L.cx + math.sin(ka) * (D.r - 25), L.cy - math.cos(ka) * (D.r - 25); \
           near_num = math.min(near_num, off_needle(nx, ny)); lamp = math.min(lamp, math.sqrt((nx - L.lamp[1]) ^ 2 + (ny - L.lamp[2]) ^ 2)) end; \
         for _, p in pairs(L.letters) do near_gear = math.min(near_gear, off_needle(p[1], p[2])) end; \
         return string.format('%.4f %.4f %.2f %.2f %.2f %.2f', a, D.rest, near_num, near_gear, lamp, math.deg(D.from - D.rest)) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    assert!((v[0] - v[1]).abs() < 1e-6, "standing, on the peg ({out})");
    assert!(v[5] >= 15.0, "the peg is well below the 0 ({out})");
    assert!(
        v[2] > 12.0,
        "the resting needle clear of every number ({out})"
    );
    assert!(v[3] > 10.0, "and of the gears ({out})");
    // (centre to centre: the lamp is 18 units tall and a number about 13, so 20 leaves a clear gap; the "0" and "40" are far off)
    assert!(v[4] > 20.0, "the lamp clear of the numbers ({out})");
    let src = std::fs::read_to_string(game_dir().join("lib/gear_hud.lua")).unwrap();
    assert!(
        src.contains("local TICK = { 52, 44, 40, 255 }"),
        "the ticks are a dark, opaque ink"
    );
}

/// "I also think the circle cutout comes on too aggressively. It should only be present when the camera is really blocked by some
/// item." In the open meadow nothing is cut, and nothing is cut for what is not scenery that can hide someone: Hazel, the van, grass,
/// ferns. (`camera.state.cut` is how much of the small see-through hole is on: 0 off, 1 whole.)
#[test]
fn the_see_through_circle_is_off_in_the_open_and_for_people_and_the_van() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "CAM = require('lib.camera'); W = require('lib.world'); OCC = require('lib.occluders'); MAXCUT = 0",
        "each_frame": "MAXCUT = math.max(MAXCUT, CAM.state.cut or 0)",
        "steps": [ { "wait": 5 }, { "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 150, 36, 0; p.walk_to = nil; p.walk_path = nil; CAM.reset(0); nova.named('van'):teleport(300, 300, 0)" },
        { "wait": 80 }, { "lua": "MAXCUT = 0" }, { "wait": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(CAM.state.hidden)"), "false");
    assert_eq!(num(&g, "MAXCUT"), 0.0, "no circle in the open");
    // Hazel, then the van, stand on the line from the eye to the postmaster
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local p = nova.named('postmaster'); local e = CAM.state.eye; local dx, dz = e[1] - p.x, e[3] - p.z; local l = math.sqrt(dx * dx + dz * dz); local h = nova.named('hazel'); h.x, h.z = p.x + dx / l * 3, p.z + dz / l * 3; h.mode = 'work'; h.work_at = { h.x, h.z }; h.home = { h.x, h.z }; local v = nova.named('van'); v:teleport(p.x + dx / l * 4.5, p.z + dz / l * 4.5, 0)" },
        { "wait": 90 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(CAM.state.hidden)"), "false");
    assert_eq!(
        num(&g, "MAXCUT"),
        0.0,
        "no circle for a resident or the van in the way"
    );
}

/// A tree's crown or a roof that really covers the postmaster cuts a small hole, fading in over about 0.2 s and, once the line is clear,
/// holding a moment and fading out over about 0.3 s; the hole is about the postmaster's size, not a big circle.
#[test]
fn the_see_through_circle_comes_on_under_a_crown_and_a_roof_and_fades_off() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "CAM = require('lib.camera'); W = require('lib.world'); OCC = require('lib.occluders'); PUT = function(x, z) local p = nova.named('postmaster'); p.x, p.z, p.face = x, z, 0; p.walk_to = nil; p.walk_path = nil; nova.named('van'):teleport(x + 300, z + 300, 0); CAM.reset(0) end",
        "steps": [ { "wait": 5 }, { "lua": "PUT(-19.72, -222)" }, { "wait": 70 } ] }"#,
    );
    assert_eq!(num(&g, "CAM.state.cut"), 0.0, "clear of the tree");
    // under a big pine's crown (the camera behind and above looks through it)
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "PUT(-19.72, -230.3)" }, { "wait": 6 }, { "lua": "EARLY = CAM.state.cut" }, { "wait": 60 }, { "lua": "HIDDEN = CAM.state.hidden and 1 or 0; FULL = CAM.state.cut" } ] }"#,
    );
    let early = num(&g, "EARLY");
    assert!(
        early > 0.0 && early < 1.0,
        "the circle fades in, not a jump: {early}"
    );
    assert_eq!(num(&g, "HIDDEN"), 1.0, "the crown hides the postmaster");
    assert!(
        num(&g, "FULL") > 0.99,
        "and the circle is whole: {}",
        num(&g, "FULL")
    );
    // out from under it: held for a moment, then gone
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "PUT(-19.72, -222)" }, { "wait": 5 }, { "lua": "HELD = CAM.state.cut" }, { "wait": 60 }, { "lua": "GONE = CAM.state.cut; HID2 = CAM.state.hidden and 1 or 0" } ] }"#,
    );
    assert!(num(&g, "HELD") > 0.0, "a moment's hold, not a flicker off");
    assert_eq!(num(&g, "HID2"), 0.0);
    assert_eq!(num(&g, "GONE"), 0.0, "and gone once clear");
    // behind a cabin's roof
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "local c, s = math.cos(-2.29), math.sin(-2.29); PUT(162 + 5.0 * c + 1.0 * s, 54 - 5.0 * s + 1.0 * c)" }, { "wait": 80 }, { "lua": "ROOF = CAM.state.cut" } ] }"#,
    );
    assert!(
        num(&g, "ROOF") > 0.99,
        "a roof between: {}",
        num(&g, "ROOF")
    );
    // the hole is small: about the postmaster's size
    assert!(
        num(&g, "CAM.CUT.up") > 0.0
            && num(&g, "(CAM.state.see and CAM.state.see.radius) or 0") <= 1.0,
        "a small hole"
    );
}

/// The occluders are the scenery's real shapes: a line through a pine's crown is blocked, one beside it or over it is not, and grass
/// and the like are not in the data at all.
#[test]
fn the_occluders_block_a_line_through_a_crown_and_not_one_beside_it() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "OCC = require('lib.occluders'); W = require('lib.world')", "steps": [ { "wait": 3 } ] }"#,
    );
    // the pine at (-19.72, -230.61), 2.11 times its size: a line from 6 m south at 3 m up to a point 1 m above the ground behind it
    let line = |dx: f64| {
        let g0 = "W.height(-19.72, -230.61)";
        format!(
            "tostring(OCC.blocked(-19.72 + {dx}, {g0} + 3, -237, -19.72 + {dx}, {g0} + 1, -224))"
        )
    };
    assert_eq!(lua(&g, &line(0.0)), "true");
    assert_eq!(lua(&g, &line(9.0)), "false");
    assert_eq!(
        lua(
            &g,
            "tostring(OCC.blocked(-19.72, W.height(-19.72, -230.61) + 30, -237, -19.72, W.height(-19.72, -230.61) + 30, -224))"
        ),
        "false"
    );
}

/// The post office's front counter leaves a wide walk round both ends (the owner: "You can fix the weak points"; the right-hand gap was
/// 0.85 m and straight-line walks stuck there): at least 1.3 m clear of the postmaster's body on each side, and a walk in straight lines
/// from the door through the middle of either gap to the aisle in front of every tile of the package counter arrives.
#[test]
fn the_front_counter_has_wide_walks_round_both_ends_and_every_tile_is_reachable() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [ { "wait": 5 } ] }"#,
    );
    // the gaps, from the room's walls and the counter's collision box
    let gap_l = num(
        &g,
        "(function() local b; for _, x in ipairs(nova.model_shapes('office_room').boxes) do if math.abs(x.z + 0.6) < 0.01 then b = x end end; return (b.x - b.hw) + 3.45 end)()",
    );
    let gap_r = num(
        &g,
        "(function() local b; for _, x in ipairs(nova.model_shapes('office_room').boxes) do if math.abs(x.z + 0.6) < 0.01 then b = x end end; return 3.45 - (b.x + b.hw) end)()",
    );
    for (side, gap) in [("left", gap_l), ("right", gap_r)] {
        assert!(
            gap - 2.0 * 0.26 >= 1.3,
            "the {side} walk: {gap} m wide, {} m clear of the postmaster",
            gap - 0.52
        );
    }
    let mut stuck = vec![];
    for (name, side) in [("left", -2.42), ("right", 2.52)] {
        for i in 1..=10 {
            let tx = -3.0 + (i as f64 - 1.0) * 0.6;
            let plan = format!(
                r#"{{ "steps": [ {{ "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 0.9, 1.8, 3.14; p.speed = 0; p.walk_path = {{ {{ {side}, 0.3 }}, {{ {side}, -0.6 }}, {{ {tx}, -1.44 }} }}; p.walk_to = nil" }},
                {{ "until": "not T.walking()", "max": 900 }}, {{ "wait": 10 }} ] }}"#
            );
            play(&mut g, &plan);
            let off = num(
                &g,
                &format!(
                    "(function() local p = nova.named('postmaster'); return math.sqrt((p.x - {tx})^2 + (p.z + 1.44)^2) end)()"
                ),
            );
            if off > 0.3 {
                stuck.push(format!("{name} side, tile {i}: {off:.2} m short"));
            }
        }
    }
    assert!(stuck.is_empty(), "walks that did not arrive: {stuck:?}");
}

/// Scenery close to the camera fades out whole, whatever the circle does (the owner: a crown beside the camera filled the picture with
/// green): outdoors every frame asks `nova.see_through` for a near fade, wholly gone within 2 m of the eye and all there beyond 4 m (the
/// shader's side is tested in `see_through_gpu.rs`), on in the open too and never in the room; and an eye that would sit in a tree's crown
/// is drawn in toward the postmaster.
#[test]
fn scenery_within_2_m_of_the_eye_fades_out_whole_and_the_boom_comes_in_from_a_crown() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "CAM = require('lib.camera'); OCC = require('lib.occluders'); LAST = nil; local orig = nova.see_through; nova.see_through = function(o) LAST = o and { near = o.near, near_from = o.near_from, near_amount = o.near_amount, amount = o.amount } or nil; return orig(o) end; PUT = function(x, z) local p = nova.named('postmaster'); p.x, p.z, p.face = x, z, 0; p.walk_to = nil; p.walk_path = nil; nova.named('van'):teleport(x + 300, z + 300, 0); CAM.reset(0) end",
        "steps": [ { "wait": 5 }, { "lua": "PUT(150, 36)" }, { "wait": 80 } ] }"#,
    );
    assert_eq!(
        lua(&g, "tostring(LAST ~= nil)"),
        "true",
        "the near fade is asked for in the open"
    );
    assert_eq!(num(&g, "LAST.near"), 4.0);
    assert_eq!(num(&g, "LAST.near_from"), 2.0, "wholly gone within 2 m");
    assert_eq!(num(&g, "LAST.near_amount"), 1.0);
    assert_eq!(num(&g, "LAST.amount"), 0.0, "and the circle is off");
    assert_eq!(
        num(&g, "CAM.state.pull"),
        1.0,
        "the boom is whole in the open"
    );
    // under a big pine's crown the eye comes in
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "PUT(-19.72, -229.2)" }, { "wait": 120 }, { "lua": "local e = CAM.state.eye; INSIDE = OCC.inside(e[1], e[2], e[3]) and 1 or 0" } ] }"#,
    );
    let (pull, inside) = (num(&g, "CAM.state.pull"), num(&g, "INSIDE"));
    assert!(pull < 1.0 && pull >= 0.55, "the boom came in: {pull}");
    let _ = inside;
    // the room: nothing
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "nova.goto_scene('office')" }, { "wait": 30 } ] }"#,
    );
    assert_eq!(lua(&g, "tostring(LAST)"), "nil", "no near fade indoors");
}

// ---- the owner after the sixth play's cast (2026-11-23): "I like the yellow outfit. Make the hat much bigger though. Fix the
// weakpoints" -------------------------------------------------------------------------------------------------------------------

/// The postmaster's bucket hat is a big soft one (its brim well past the head, its crown down over the head to just above the brows
/// and up over the top), the fox's ears come up through holes in it (taller than the crown), and the game's springs swing them no
/// further than the holes are cut for (character3d_make cuts each a little wider than the ear and the swing of its spring;
/// studio/mcp/makers/makers3d.test.ts checks every ear triangle against the hat's at those swings).
#[test]
fn the_postmasters_bucket_hat_is_big_and_the_ears_come_through_it() {
    let m = cast_model("postmaster");
    let file = game_dir().join("models/postmaster.model.json");
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let k = doc["scale"].as_f64().unwrap();
    fn find<'a>(ps: &'a Value, name: &str) -> Option<&'a Value> {
        for p in ps.as_array().unwrap() {
            if p["name"] == name {
                return Some(p);
            }
            if let Some(f) = find(&p["children"], name) {
                return Some(f);
            }
        }
        None
    }
    let head = find(&doc["parts"], "head").unwrap();
    let hat = head["cubes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["color"] == "#b5503f")
        .expect("the hat");
    let pts: Vec<[f64; 3]> = hat["verts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let f = |i: usize| v[i].as_f64().unwrap() * k;
            [f(0), f(1), f(2)]
        })
        .collect();
    let shell = &m["head"].points;
    let head_w = shell.iter().map(|p| p[0].abs()).fold(0.0, f64::max);
    let head_top = shell.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
    let head_low = shell
        .iter()
        .filter(|p| p[0].abs() > 0.15)
        .map(|p| p[1])
        .fold(f64::MAX, f64::min);
    let hat_w = pts.iter().map(|p| p[0].abs()).fold(0.0, f64::max);
    // (over the face: the front of the hat, its brim tipped up there, comes down to just over the brows; behind it droops lower)
    let hat_low = pts
        .iter()
        .filter(|p| p[2] > 0.1 && p[0].abs() < 0.12)
        .map(|p| p[1])
        .fold(f64::MAX, f64::min);
    let hat_top = pts.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
    assert!(
        hat_w > head_w * 1.25,
        "the brim reaches well past the head: {hat_w:.3} against {head_w:.3}"
    );
    let middle = (head_top + head_low) / 2.0;
    assert!(
        hat_low < middle + (head_top - middle) * 0.65 && hat_low > middle,
        "the hat comes down over the head to above its middle (the brows): {hat_low:.3} (the head {head_low:.3} to {head_top:.3})"
    );
    assert!(
        hat_top > head_top + 0.02,
        "a soft crown over the top: {hat_top:.3} over {head_top:.3}"
    );
    for ear in ["ear_l", "ear_r"] {
        let e = &m[ear];
        let tip = e.points.iter().map(|p| p[1]).fold(f64::MIN, f64::max) + e.origin[1];
        assert!(
            tip > hat_top,
            "{ear} stands up through its hole, over the crown: {tip:.3} against {hat_top:.3}"
        );
    }
    let pm_lua = std::fs::read_to_string(game_dir().join("entities/postmaster.lua")).unwrap();
    let mut springs = 0;
    for line in pm_lua.lines().filter(|l| l.contains("part = \"ear_")) {
        let max: f64 = line
            .split("max = ")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        springs += 1;
        assert!(
            max <= 0.32,
            "an ear's spring swings it {max} rad, past what its hole allows: {line}"
        );
    }
    assert_eq!(springs, 2, "both ears hang on springs");
    // at the wheel the hat and the ears' tips are in the cab, under its lining (1.48 m: tools/van.mjs)
    let ear_top = ["ear_l", "ear_r"]
        .iter()
        .map(|e| m[*e].points.iter().map(|p| p[1]).fold(f64::MIN, f64::max) + m[*e].origin[1])
        .fold(f64::MIN, f64::max);
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 3 } ] }"#,
    );
    let head_y = num(
        &g,
        "(function() local P = nova.named('postmaster'); local sit = nova.model_pose('postmaster', { clip = 'sit', time = 0 }); return P.SEAT[2] + sit.head.y end)()",
    );
    let top = head_y + hat_top.max(ear_top);
    assert!(
        (1.2..1.48).contains(&top),
        "seated, the hat's crown and the ears reach {top:.3} m: in the cab, under the lining"
    );
}

/// The painted clothes and faces keep clean edges at every distance: every block of paint in the model's picture is set 8 texels
/// into a cell of 16 (the game's smaller copies average up to 16 texels at a time: a dark brow beside the white cheeks' block came
/// out grey), and every see-through texel beside paint carries a colour close to that paint (edge padding: the GPU's blend between
/// texels does not weigh them by cover).
#[test]
fn the_painted_edges_stay_clean_in_the_casts_pictures() {
    for who in ["postmaster", "hazel", "pip"] {
        let png = std::fs::read(game_dir().join(format!("models/{who}.texture.png"))).unwrap();
        let img = nova_runtime::assets::decode_png(&png).unwrap();
        let (w, h) = (img.width as i64, img.height as i64);
        let px = |x: i64, y: i64| {
            let i = ((y * w + x) * 4) as usize;
            [
                img.rgba[i],
                img.rgba[i + 1],
                img.rgba[i + 2],
                img.rgba[i + 3],
            ]
        };
        let (mut edges, mut bad) = (0, 0);
        for y in 0..h {
            for x in 0..w {
                let p = px(x, y);
                if p[3] != 0 {
                    continue;
                }
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w || ny >= h {
                        continue;
                    }
                    let q = px(nx, ny);
                    if q[3] < 200 {
                        continue;
                    }
                    edges += 1;
                    let d = (0..3)
                        .map(|i| (p[i] as i32 - q[i] as i32).abs())
                        .max()
                        .unwrap();
                    if d > 90 {
                        bad += 1;
                    }
                }
            }
        }
        assert!(edges > 100, "{who}: painted edges found ({edges})");
        assert!(
            (bad as f64) < edges as f64 * 0.02,
            "{who}: {bad} of {edges} see-through texels beside paint carry a colour far from it"
        );
        let doc: Value = serde_json::from_str(
            &std::fs::read_to_string(game_dir().join(format!("models/{who}.model.json"))).unwrap(),
        )
        .unwrap();
        fn walk(ps: &Value, out: &mut Vec<(i64, i64)>) {
            for p in ps.as_array().unwrap() {
                for c in p["cubes"].as_array().unwrap() {
                    if let Some(at) = c["texture"]["at"].as_array() {
                        out.push((at[0].as_i64().unwrap(), at[1].as_i64().unwrap()));
                    }
                }
                walk(&p["children"], out);
            }
        }
        let mut blocks = Vec::new();
        walk(&doc["parts"], &mut blocks);
        blocks.sort();
        blocks.dedup();
        assert!(blocks.len() > 5, "{who}: painted blocks ({})", blocks.len());
        for &(x, y) in &blocks {
            assert!(
                x % 16 == 8 && y % 16 == 8,
                "{who}: a block at {x}, {y} is not set 8 texels into a 16-texel cell (the gutter round it)"
            );
        }
    }
}

/// Up and down the porch steps the body climbs: the hips follow a smooth line through the steps (no more than 1.2 cm in a frame, no
/// jolt in how fast they rise), and the walk slows a little on them. On the steepest hillside, walked across it and up it, each
/// standing foot lies along the slope (tipped and rolled with it), so no point of a sole goes more than a centimetre into the ground,
/// and the body stays upright.
#[test]
fn the_porch_steps_are_climbed_smoothly_and_feet_lie_on_the_hillside() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5 } ] }"#,
    );
    let probe: Vec<&str> = SOLE_PROBE
        .lines()
        .filter(|l| !l.trim_start().starts_with("--"))
        .collect();
    assert_eq!(
        lua(
            &g,
            &format!("(function() {} return 'ok' end)()", probe.join(" "))
        ),
        "ok"
    );
    assert_eq!(
        lua(
            &g,
            "(function() HP = { ys = {}, all = {}, flat = {}, slow = 0 }; function HP_STEP() local p = nova.named('postmaster'); \
               local pose = nova.model_pose('postmaster', { layers = p.anim:layers(), parts = p.walker:parts({}) }); \
               local y = (p.y or 0) + pose.hips.y; HP.all[#HP.all + 1] = y; if p.on_stairs then HP.slow = HP.slow + 1; HP.ys[#HP.ys + 1] = y elseif p.speed > 1 then HP.flat[#HP.flat + 1] = y end end; return 'ok' end)()"
        ),
        "ok"
    );
    for (dir, from, there, sg) in [("up", 6.0, 1.4, -1.0), ("down", 1.4, 6.0, 1.0)] {
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.x, p.z = d.x + fx * {from}, d.z + fz * {from}; p.face = math.atan({sg} * fx, {sg} * fz); p.walk_to, p.walk_path = nil, nil" }}, {{ "wait": 20 }} ] }}"#
            ),
        );
        play(
            &mut g,
            &format!(
                r#"{{ "each_frame": "HP_STEP()", "steps": [ {{ "lua": "HP.ys = {{}}; HP.all = {{}}; HP.flat = {{}}; HP.slow = 0; local p = nova.named('postmaster'); local d = nova.named('office_door'); local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0); p.walk_path = {{ {{ d.x + fx * {there}, d.z + fz * {there} }} }}; p.walk_pace = 1.6" }}, {{ "wait": 240 }} ] }}"#
            ),
        );
        let series = |name: &str| -> Vec<f64> {
            lua(&g, &format!("table.concat(HP.{name}, ' ')"))
                .split(' ')
                .filter(|s| !s.is_empty())
                .map(|s| s.parse().unwrap())
                .collect()
        };
        // (the most the hips move in a frame, and the most that changes from one frame to the next)
        let measure = |ys: &[f64]| {
            let step = ys
                .windows(2)
                .map(|w| (w[1] - w[0]).abs())
                .fold(0.0, f64::max);
            let jerk = ys
                .windows(3)
                .map(|w| (w[2] - 2.0 * w[1] + w[0]).abs())
                .fold(0.0, f64::max);
            (step, jerk)
        };
        let (all, stairs, flat) = (series("all"), series("ys"), series("flat"));
        let climb = (all[all.len() - 1] - all[0]).abs();
        let (step, jerk) = measure(&stairs);
        let (flat_step, flat_jerk) = measure(&flat);
        println!(
            "porch {dir}: climb {climb:.3}; on the steps most a frame {step:.4}, jolt {jerk:.4}; walking on the flat {flat_step:.4}, {flat_jerk:.4}"
        );
        assert!(
            climb > 0.3,
            "{dir}: the hips went {dir} the steps ({climb:.2} m)"
        );
        // (near the walk's own bob on the flat, the dip as each foot lands, 1.6 cm a frame at most and 1.8 cm a frame of change:
        // on the steps 2.6 cm at most, where the hips jumped 7.8 cm in a frame onto each step before they glided)
        assert!(flat.len() > 20, "{dir}: walked on the flat too");
        assert!(
            step < 0.03,
            "{dir}: the hips moved {step:.3} m in one frame on the steps (a hop; {flat_step:.3} on the flat)"
        );
        assert!(
            jerk < 0.035,
            "{dir}: how fast the hips rise changed by {jerk:.4} m a frame in one frame on the steps (a jolt; {flat_jerk:.4} on the flat)"
        );
        assert!(num(&g, "HP.slow") > 20.0, "{dir}: it knew it was on steps");
    }
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
    for (name, ux, uz) in [("across", -gz / s, gx / s), ("up", gx / s, gz / s)] {
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = {}, {}, math.atan({ux}, {uz}); p.walk_to, p.walk_path = nil, nil" }}, {{ "wait": 20 }},
                   {{ "lua": "SP.tag = 'hill {name}'; TILTS = 0; local p = nova.named('postmaster'); p.walk_path = {{ {{ {}, {} }} }}; p.walk_pace = 1.6" }} ] }}"#,
                x - ux * 2.5,
                z - uz * 2.5,
                x + ux * 2.5,
                z + uz * 2.5
            ),
        );
        play(
            &mut g,
            r#"{ "each_frame": "SP_STEP('postmaster'); for _, f in ipairs(nova.named('postmaster').walker:feet()) do if f.planted and math.abs(f.roll or 0) + math.abs(f.pitch or 0) > 0.08 then TILTS = TILTS + 1 end end", "steps": [ { "wait": 120 } ] }"#,
        );
        let poke = num(&g, &format!("SP.tags['hill {name}'] or -1"));
        println!("hillside {s:.2} {name}: {poke:.4}");
        assert!(
            poke > -1.0 && poke < 0.01,
            "on the {s:.2} hillside, {name}: a sole went {poke:.3} m into the ground ({})",
            lua(&g, &format!("SP.info['hill {name}']"))
        );
        assert!(
            num(&g, "TILTS") > 20.0,
            "{name}: the standing feet tip with the slope"
        );
        assert_eq!(
            lua(&g, "tostring(nova.named('postmaster').draw_opts.lift)"),
            "origin",
            "the body upright"
        );
    }
}
