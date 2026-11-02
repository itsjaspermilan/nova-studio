//! Compiles the salvaged C11 audio core into the runtime. The sources stay in
//! `audio/` (built and tested there with CMake); this just links the same files.

fn main() {
    let audio = std::path::Path::new("../../audio");
    let sources = [
        "audio.c",
        "production.c",
        "wav.c",
        "transport.c",
        "demo_score.c",
    ];
    let mut build = cc::Build::new();
    build
        .include(audio)
        .std("c11")
        .warnings(true)
        .extra_warnings(true);
    for source in sources {
        build.file(audio.join(source));
        println!("cargo:rerun-if-changed={}", audio.join(source).display());
    }
    for header in [
        "audio.h",
        "production.h",
        "production_internal.h",
        "transport.h",
        "wav_internal.h",
        "demo_score.h",
    ] {
        println!("cargo:rerun-if-changed={}", audio.join(header).display());
    }
    build.compile("nova_audio_core");
    println!("cargo:rerun-if-changed=build.rs");
}
