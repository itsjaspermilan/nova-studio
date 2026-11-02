//! The studio's autocomplete reads `studio/src/lib/nova-api.json`. This test keeps that file and the
//! real Lua API in step: everything documented exists, and everything public is documented.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::rc::Rc;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::vfs::{MemVfs, Vfs};
use serde_json::Value;

fn documented() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../studio/src/lib/nova-api.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).expect("nova-api.json is valid JSON")
}

/// Walks `nova` and `nova.Entity` inside a real Lua environment and returns what exists.
fn actual() -> (BTreeSet<String>, BTreeSet<String>) {
    let walker = r#"
local function walk(prefix, t, depth)
  local names = {}
  for k, v in pairs(t) do names[#names + 1] = k end
  table.sort(names)
  for _, k in ipairs(names) do
    local v = t[k]
    local full = prefix .. "." .. k
    if type(v) == "function" then nova.log("F " .. full)
    elseif type(v) == "table" and depth < 1 and not full:find("^nova%.raw") and full ~= "nova.world" and full ~= "nova.Entity" and full ~= "nova.Picture" and full ~= "nova.Text" and full ~= "nova.ease" then
      nova.log("T " .. full)
      walk(full, v, depth + 1)
    elseif type(v) == "table" then nova.log("T " .. full) end
  end
end
walk("nova", nova, 0)
for k, v in pairs(nova.Entity) do
  if type(v) == "function" and type(k) == "string" and k:sub(1, 2) ~= "__" then nova.log("M " .. k) end
end
"#;
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", walker.as_bytes().to_vec()),
    ]));
    let mut game = Game::load(vfs).expect("loads");
    game.upload(&mut NullUploader::default());
    assert!(game.error.is_none(), "{:?}", game.error);
    let (mut api, mut methods) = (BTreeSet::new(), BTreeSet::new());
    for line in game.take_log() {
        let (kind, name) = line.split_once(' ').expect("kind and name");
        match kind {
            "F" | "T" => {
                api.insert(name.to_string());
            }
            "M" => {
                methods.insert(name.to_string());
            }
            _ => unreachable!(),
        }
    }
    (api, methods)
}

#[test]
fn every_documented_name_exists_and_every_public_name_is_documented() {
    let docs = documented();
    let doc_api: BTreeSet<String> = docs
        .iter()
        .filter(|e| e["kind"] != "method")
        .map(|e| e["name"].as_str().expect("name").to_string())
        .collect();
    let doc_methods: BTreeSet<String> = docs
        .iter()
        .filter(|e| e["kind"] == "method")
        .map(|e| e["name"].as_str().expect("name").to_string())
        .collect();
    let (actual_api, actual_methods) = actual();

    // Names that are part of the framework's surface but are data or internals, not documented calls.
    let internal = [
        "nova.Entity",
        "nova.Picture",
        "nova.Text",
        "nova.Emitter",
        "nova.ease",
        "nova.world",
        "nova.raw",
    ];
    let undocumented: Vec<_> = actual_api
        .iter()
        .filter(|n| {
            !doc_api.contains(*n)
                && !internal.contains(&n.as_str())
                && !n.starts_with("nova.Emitter.")
        })
        .collect();
    assert!(
        undocumented.is_empty(),
        "public Lua API missing from studio/src/lib/nova-api.json: {undocumented:?}"
    );

    // `nova.Entity`, `nova.Picture`, `nova.Text` and `nova.ease` are listed as namespaces; the rest must be real.
    let missing: Vec<_> = doc_api
        .iter()
        .filter(|n| !actual_api.contains(*n) && !internal.contains(&n.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "documented but not in the Lua API: {missing:?}"
    );

    let undocumented_methods: Vec<_> = actual_methods
        .iter()
        .filter(|m| !doc_methods.contains(*m))
        .collect();
    assert!(
        undocumented_methods.is_empty(),
        "entity methods missing from nova-api.json: {undocumented_methods:?}"
    );
    let missing_methods: Vec<_> = doc_methods
        .iter()
        .filter(|m| !actual_methods.contains(*m))
        .collect();
    assert!(
        missing_methods.is_empty(),
        "documented entity methods that do not exist: {missing_methods:?}"
    );
}

#[test]
fn every_entry_has_a_signature_a_doc_line_and_a_group() {
    for e in documented() {
        let name = e["name"].as_str().expect("name");
        for field in ["kind", "signature", "doc", "group"] {
            assert!(
                e[field].as_str().is_some_and(|s| !s.is_empty()),
                "{name}: missing {field}"
            );
        }
        assert!(
            ["function", "namespace", "method"].contains(&e["kind"].as_str().unwrap()),
            "{name}: bad kind"
        );
        if e["kind"] == "function" {
            assert!(
                e["signature"].as_str().unwrap().starts_with(name),
                "{name}: the signature starts with the name"
            );
        }
    }
}
