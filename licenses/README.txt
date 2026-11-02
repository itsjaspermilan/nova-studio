Nova uses raylib 5.5 (zlib), Lua 5.4.8 (MIT), and raylib's bundled native
dependencies (their original embedded notices accompany compiled builds).
Gradle 8.11.1's wrapper is Apache-2.0. Android native_app_glue is Apache-2.0.
GLAD's Android loader is (WTFPL OR CC0-1.0) AND Apache-2.0; choose CC0-1.0.

The build copies licenses, original single-header dependency sources containing
embedded notices, GLFW's license and controller mapping notices alongside the
desktop executable, and into Android assets. Keep that directory when distributing.
Sources fetched by CMake remain unaltered except for the documented, narrowly
scoped raylib Android destruction-loop patch in cmake/RaylibAndroid.cmake and
the fingerprint-checked audio lifecycle/allocation/evidence hooks in
cmake/RaylibAudio.cmake. The latter preserves the shared native device, joins
callbacks before mutex destruction, cleans partial initialization/stream failures,
and observes configuration/callbacks/notifications without a second backend.
Archive hashes and original notices are unchanged; see docs/audio-core.md.

No third-party artwork/game assets, Blender code, or GameStudio code is included.
The original badge.png and gem.glb fixtures in examples/assets/assets are CC0;
their provenance is examples/assets/NOTICE.txt and their reproducible source is
scripts/generate-sample-assets.py. Raylib's bundled cgltf is reused for GLB parsing;
its embedded notice is preserved with the other raylib headers.
Nova-authored source and documentation are MIT licensed; see the packaged LICENSE
(Copyright (c) 2026 Nova Studio contributors). This does not relicense vendored
dependencies or the separately CC0 sample artwork. Preserve their notices.

The optional desktop nova_sprite component uses installed Qt 6 Core, Gui and
Widgets, with QtTest for verification (minimum 6.5; checked with Homebrew qtbase
6.12.0_2). These modules offer LGPLv3/GPLv3/commercial licensing; see
https://doc.qt.io/qt-6/licensing.html. No Qt modules are linked into Android or
the existing native runtime. The current component links shared host Qt and is
not a Qt application distribution. Deployment of the integrated Qt host must
include its applicable Qt/third-party notices and LGPL compliance materials;
the existing runtime notice collector does not package them automatically.
See docs/sprite-component.md for the component and integration boundary.
