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

/// The stick's two gaits: a gentle tilt is the waddling walk; a full push is the run, the arms held out like wings, about twice
/// the walk and far slower than the van; with a parcel the full push is a brisk trot with the arms round the parcel.
#[test]
fn a_gentle_tilt_walks_a_full_push_runs_and_a_parcel_makes_it_a_trot() {
    let mut g = game();
    let clip = "(nova.named('postmaster').anim:time())";
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [
        { "wait": 5, "lua": "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -125, 0; require('lib.camera').reset(0)" },
        { "wait": 30 },
        { "hold": ["move_y=-0.45"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "walk");
    let walk = num(&g, "nova.named('postmaster').speed");
    assert!((0.5..=1.0).contains(&walk), "a gentle tilt walks: {walk}");
    assert_eq!(lua(&g, clip), "walk");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "run");
    let run = num(&g, "nova.named('postmaster').speed");
    assert!(
        run > 1.75 && run < 2.2,
        "a full push runs at about twice the walk's top (1.0): {run}"
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
    // with a parcel the full push is the trot, the carry over the arms (the trot itself leaves the arms alone)
    play(
        &mut g,
        r#"{ "steps": [ { "lua": "require('lib.state').carrying = 'hazel'" }, { "hold": ["move_y=-1"], "frames": 60 } ] }"#,
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
    // and the van is far quicker than either (its top on the flat is about 16 m/s)
    assert!(run * 5.0 < 16.0);
}

#[test]
fn the_whole_slice_plays_start_to_finish_hazel_first() {
    plays_the_whole_slice(false);
}

#[test]
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
        { "wait": 20 }, { "walk_to": [0.9, 0.35], "max": 300 }, { "press": "act" }, { "wait": 30 } ],
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
        { "press": "act" }, { "wait": 30 } ] }"#,
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

/// One parcel at a time: carrying one, A at the other's place on the shelf does not take it (it puts back the one carried).
#[test]
fn one_parcel_at_a_time() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('hazel')" }, { "until": "not T.walking()", "max": 400 },
        { "press": "act" }, { "wait": 30 }, { "press": "act" }, { "wait": 20 },
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
        r#"{ "steps": [ { "press": "act" }, { "wait": 20 } ] }"#,
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
        { "press": "act" }, { "wait": 120 } ] }"#,
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
        { "press": "act" }, { "wait": 30 }, { "press": "act" }, { "wait": 10 }, { "press": "act" }, { "wait": 30 },
        { "press": "act" }, { "wait": 30 }, { "press": "act" }, { "wait": 10 }, { "press": "act" }, { "wait": 30 },
        { "press": "act" }, { "wait": 30 } ] }"#,
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

/// B gets in only beside the van; B gets out only when the van has stopped.
#[test]
fn getting_in_and_out_works_only_where_it_should() {
    let mut g = game();
    // far from the van, B does nothing
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 10, "lua": "local p = nova.named('postmaster'); p.x, p.z = 2, -160" }, { "press": "van" }, { "wait": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "foot");
    // beside its left doorway, B gets in (at once: the engine starts)
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
    // moving, B does not get out
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
        let lines = r.drawn("ui_line", None);
        assert!(!lines.is_empty(), "{where_}: roads on the minimap");
        for l in &lines {
            let (x, y, dx, dy) = (
                l["x"].as_f64().unwrap(),
                l["y"].as_f64().unwrap(),
                l["w"].as_f64().unwrap(),
                l["h"].as_f64().unwrap(),
            );
            assert!(
                inside(x, y) && inside(x + dx, y + dy),
                "{where_}: a line outside the minimap's disc: {l}"
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
                n.contains("minimap_disc") || n.ends_with("ui/you"),
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
        sprites.iter().any(|s| s.ends_with("ui/map")),
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
    // A closes it and the game goes on
    play(
        &mut g,
        r#"{ "steps": [ { "press": "act" }, { "wait": 30 } ] }"#,
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
        r#"{ "steps": [ { "press": "act" }, { "wait": 20 } ] }"#,
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
            { "until": "math.abs(nova.named('van').yaw_rate or 0) > 0.25 and math.abs(nova.named('van').speed) > 7", "max": 1500 },
            { "lua": "nova.named('van').back_want = 1" },
            { "until": "nova.named('van').back_open > 0.8 and math.abs(nova.named('van').roll) > 0.02", "max": 900 } ] }"#,
    );
    // (the body's lean must be real for the check to mean anything)
    let roll = num(&g, "nova.named('van').roll").abs();
    assert!(roll > 0.02, "the van leans in the bend: {roll}");
    assert_eq!(
        lua(
            &g,
            "(function() local p = {} for _, n in ipairs(nova.model_parts('van')) do p[#p + 1] = n end table.sort(p) return table.concat(p, ' ') end)()"
        ),
        "body door_l door_r steering wheel_fl wheel_fr wheel_rl wheel_rr"
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
    assert!((1.0..1.6).contains(&d), "a step out from the door: {d}");
    let away = num(
        &g,
        "(function() local p, d = nova.named('postmaster'), nova.named('office_door'); return math.abs((p.face - (d.ry or 0) + math.pi) % (2 * math.pi) - math.pi) end)()",
    );
    assert!(away < 0.05, "facing away from the door: {away}");
    // and straight back in: the same short fade, standing just inside, free at once
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "until": "nova.current_scene() == 'office'", "max": 120 }, { "wait": 1 } ] }"#,
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
/// is "Load package", and A puts it in the hold at once (the stick never taken).
#[test]
fn the_rear_doors_open_by_themselves_and_a_loads_the_package() {
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
        r#"{ "always": "nova.named('postmaster').control", "steps": [ { "press": "act" }, { "wait": 5 } ] }"#,
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
/// from the shelf); at the open back with empty hands a panel shows them one at a time, L1 and R1 go round, A takes the one shown;
/// with one parcel left the panel shows it without the shoulder buttons.
#[test]
fn the_van_holds_both_parcels_and_the_panel_at_the_back_picks_one() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "lua": "T = require('lib.testkit'); S = require('lib.state'); S.on_shelf.hazel, S.on_shelf.pip = false, false; S.carrying = 'hazel'",
        "steps": [ { "wait": 5, "lua": "T.to_van('back')" }, { "until": "not T.walking()", "max": 900 },
        { "until": "nova.scene_now():actions() == 'load'", "max": 60 }, { "press": "act" }, { "wait": 5, "lua": "S.carrying = 'pip'" },
        { "until": "nova.scene_now():actions() == 'load'", "max": 60 }, { "press": "act" }, { "wait": 5 } ] }"#,
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
        r#"{ "steps": [ { "press": "act" }, { "wait": 3 } ] }"#,
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
        r#"{ "steps": [ { "press": "act" }, { "wait": 3 }, { "press": "next" }, { "wait": 3 }, { "press": "act" }, { "wait": 3 } ] }"#,
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

/// "We can also make the truck have no doors." B gets in only at the LEFT doorway (the driver's side, the van's +x), with the
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

/// "When leaving the van, currently the camera is like clipped inside the van facing the player." From the moment B is pressed,
/// for every frame of the glide and after, the camera's eye is outside the van's body and nothing solid stands between it and the
/// postmaster.
#[test]
fn the_camera_is_outside_the_van_after_getting_out() {
    let mut g = game();
    let inside = "(function() local e, v = require('lib.camera').state.eye, nova.named('van'); local s, c = math.sin(v.heading), math.cos(v.heading); \
        if e[2] > nova.terrain_height(v.x, v.z) + 2.2 then return false end; \
        for _, off in ipairs(v.BODY.offs) do if (e[1] - v.x - s * off)^2 + (e[3] - v.z - c * off)^2 < v.BODY.r^2 then return true end end; return false end)()";
    let clear = "(function() local C, e, p = require('lib.camera'), require('lib.camera').state.eye, nova.named('postmaster'); local tx, ty, tz = p.x, require('lib.world').height(p.x, p.z) + 0.55, p.z; \
        local dx, dy, dz = e[1] - tx, e[2] - ty, e[3] - tz; local l = math.sqrt(dx*dx + dy*dy + dz*dz); return C.clear_to(tx, ty, tz, dx / l, dy / l, dz / l, l) > l - 0.45 end)()";
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
