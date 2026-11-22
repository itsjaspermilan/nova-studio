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
    // beside it, B gets in (round to the door, a door's sound, the van rocks)
    let r = play(
        &mut g,
        r#"{ "lua": "T = require('lib.testkit')", "steps": [ { "lua": "T.to_van('door')" }, { "until": "not T.walking()", "max": 900 }, { "press": "van" },
        { "until": "nova.scene_now().mode == 'van'", "max": 300 }, { "wait": 30 } ] }"#,
    );
    assert_eq!(lua(&g, "nova.scene_now().mode"), "van");
    assert_eq!(lua(&g, "nova.named('postmaster').hidden"), "true");
    assert!(
        r.json["sounds"].to_string().contains("van_door"),
        "the door is heard: {}",
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
                {{ "wait": 5, "lua": "local v = nova.named('van'); v:teleport({x}, {z}, {heading}); nova.scene_now().mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').hidden = true" }},
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
        r#"{ "start_scene": "valley", "lua": "require('lib.state').in_van = 'pip'", "steps": [
        { "wait": 5, "lua": "local v = nova.named('van'); v:teleport(6, -100, 0); nova.scene_now().mode = 'van'; v.driven = true; nova.named('postmaster').hidden = true" },
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
