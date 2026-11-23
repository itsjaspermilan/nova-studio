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
    assert!((0.8..=1.3).contains(&walk), "a gentle tilt walks: {walk}");
    assert_eq!(lua(&g, clip), "walk");
    play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=-1"], "frames": 60 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.named('postmaster').gait"), "run");
    let run = num(&g, "nova.named('postmaster').speed");
    assert!(
        run > 2.8 && run < 3.05,
        "a full push runs at about twice the walk's top (1.6): {run}"
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
    // and the van is far quicker than either (the starting van's top on the flat is about 10.5 m/s)
    assert!(run * 3.0 < 10.5);
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
            { "until": "math.abs(nova.named('van').yaw_rate or 0) > 0.2 and math.abs(nova.named('van').speed) > 5", "max": 2500 },
            { "lua": "nova.named('van').back_want = 1" },
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
        "body door_l door_l_leaf door_r door_r_leaf steering wheel_fl wheel_fr wheel_rl wheel_rr"
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
    // and straight back in: the same short fade, standing just inside, free at once (the camera is behind them, looking out from the
    // building: back in is towards it, down on the stick)
    let r = play(
        &mut g,
        r#"{ "steps": [ { "hold": ["move_y=1"], "until": "nova.current_scene() == 'office'", "max": 120 }, { "wait": 1 } ] }"#,
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
                "ui/minimap_disc",
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
        r#"{ "steps": [ { "press": "act" }, { "wait": 20 } ] }"#,
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
                {{ "press": "act" }}, {{ "wait": 90 }} ] }}"#
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
        r#"{ "start_scene": "office", "steps": [ { "wait": 20 }, { "walk_to": [0.9, 0.35], "max": 300 }, { "press": "act" }, { "wait": 30 } ] }"#,
    );
    assert_ui_from_the_kit(&r, "the letter");
    assert!(r.drawn_count("ui_sprite", Some("ui/kit/rule")) >= 1);
    let mut g = game();
    let r = play(
        &mut g,
        r#"{ "start_scene": "office", "lua": "T = require('lib.testkit')", "steps": [
        { "wait": 20, "lua": "nova.named('postmaster').walk_to = T.shelf_spot('pip')" }, { "until": "not T.walking()", "max": 400 },
        { "press": "act" }, { "wait": 30 } ] }"#,
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
        { "press": "act" }, { "wait": 30, "lua": "SHOWN = require('lib.parcels').current().which" }, { "press": "next" }, { "wait": 5 } ] }"#,
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
    for t in tracks {
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
    assert!(root.join(format!("{GAME}/music/fernhollow.ogg")).is_file());
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

/// "The turning is too aggressive and doesn't feel like there's actual weight to it." A flick of the stick moves the wheels no
/// faster than Van.TUNE.steer_speed a second; at speed the stick gives less lock; the body's turning follows the wheels over a
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
         return string.format('%.3f %.5f %.5f %.3f %.3f %.3f %.3f %.3f', fast, math.max(a.steer, b.steer, c.steer), math.max(a.yaw, b.yaw, c.yaw), lock_fast, lock_slow, a.side, T.steer_speed, T.corner) end)()",
    );
    let v: Vec<f64> = out.split(' ').map(|s| s.parse().unwrap()).collect();
    let (fast, steer_step, yaw_step, lock_fast, lock_slow, side, steer_speed, corner) =
        (v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    assert!(fast > 9.5, "at speed: {out}");
    assert!(
        steer_step <= steer_speed / 60.0 + 1e-6,
        "the wheels move at most {steer_speed} of full lock a second: a step of {steer_step} ({out})"
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
            cubes.len() <= 2,
            "door_{side}'s leaf is the panel and a handle: {} shapes",
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
    // under the cab's lining (the roof 1.7 m, its lining 1.57)
    let top = num(
        &g,
        "(function() local P = nova.named('postmaster'); local sit = nova.model_pose('postmaster', { clip = 'sit', time = 0 }); local rest = nova.model_pose('postmaster'); \
         return P.SEAT[2] + sit.head.y + (1.04 - rest.head.y) end)()",
    );
    assert!(
        (1.3..1.57).contains(&top),
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
    for (push, carry, gait, old_cycle) in [
        ("-0.7", false, "walk", 0.373),
        ("-1", false, "run", 0.228),
        ("-1", true, "trot", 0.275),
    ] {
        let lua_carry = if carry { "'hazel'" } else { "nil" };
        play(
            &mut g,
            &format!(
                r#"{{ "steps": [ {{ "lua": "require('lib.state').carrying = {lua_carry}" }}, {{ "hold": ["move_y={push}"], "frames": 90 }} ] }}"#
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
/// at its doorway it is B to get in and nothing on A; a step away, facing her, it is Talk (or Hand over with her parcel); turned
/// away, nothing; Knock only at a front door with the resident indoors.
#[test]
fn at_the_van_the_vans_prompts_win_over_a_resident_near() {
    let mut g = game();
    play(
        &mut g,
        r#"{ "start_scene": "valley", "steps": [ { "wait": 5, "lua": "nova.named('postmaster').x, nova.named('postmaster').z = 150, 36" },
        { "wait": 120 },
        { "lua": "local h, v, s = nova.named('hazel'), nova.named('van'), nova.scene_now(); v:teleport(h.meet[1], h.meet[2] + 3.4, 0); local p = nova.named('postmaster'); p.x, p.z = s:van_point(s.BACK); p.face = math.pi; require('lib.state').carrying = 'pip'" },
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
