//! Every project in `examples/` loads and runs a few seconds without a single problem (errors or warnings), the same check
//! the studio's Problems panel and `nova check` make. A new example is covered by adding its folder.

use std::path::PathBuf;

use nova_runtime::export::check_project;

#[test]
fn every_example_project_runs_cleanly() {
    let examples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples");
    let mut folders: Vec<PathBuf> = std::fs::read_dir(&examples)
        .expect("the examples folder exists")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("nova.json").exists())
        .collect();
    folders.sort();
    assert!(folders.len() >= 5, "the examples are there: {folders:?}");
    for folder in folders {
        let report = check_project(&folder, 180);
        assert!(
            report.problems.is_empty(),
            "{}: {:?}",
            folder.display(),
            report
                .problems
                .iter()
                .map(|p| &p.message)
                .collect::<Vec<_>>()
        );
        assert_eq!(report.frames_run, 180, "{}", folder.display());
    }
}
