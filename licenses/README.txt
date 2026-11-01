Nova uses raylib 5.5 (zlib), Lua 5.4.8 (MIT), and raylib's bundled native
dependencies (their original embedded notices accompany compiled builds).
Gradle 8.11.1's wrapper is Apache-2.0. Android native_app_glue is Apache-2.0.
GLAD's Android loader is (WTFPL OR CC0-1.0) AND Apache-2.0; choose CC0-1.0.

The build copies licenses, original single-header dependency sources containing
embedded notices, GLFW's license and controller mapping notices alongside the
desktop executable, and into Android assets. Keep that directory when distributing.
Sources fetched by CMake remain unaltered except for the documented, narrowly
scoped raylib Android destruction-loop patch in cmake/RaylibAndroid.cmake.

No third-party artwork/game assets, Blender code, or GameStudio code is included.
The original badge.png and gem.glb fixtures in examples/assets/assets are CC0;
their provenance is examples/assets/NOTICE.txt and their reproducible source is
scripts/generate-sample-assets.py. Raylib's bundled cgltf is reused for GLB parsing;
its embedded notice is preserved with the other raylib headers.
Nova-authored source and documentation are MIT licensed; see the packaged LICENSE
(Copyright (c) 2026 Nova Studio contributors). This does not relicense vendored
dependencies or the separately CC0 sample artwork. Preserve their notices.
