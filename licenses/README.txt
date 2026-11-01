Nova uses raylib 5.5 (zlib), Lua 5.4.8 (MIT), and raylib's bundled native
dependencies (their original embedded notices accompany compiled builds).
Gradle 8.11.1's wrapper is Apache-2.0. Android native_app_glue is Apache-2.0.
GLAD's Android loader is (WTFPL OR CC0-1.0) AND Apache-2.0; choose CC0-1.0.

The build copies licenses, original single-header dependency sources containing
embedded notices, GLFW's license and controller mapping notices alongside the
desktop executable, and into Android assets. Keep that directory when distributing.
Sources fetched by CMake remain unaltered except for the documented, narrowly
scoped raylib Android destruction-loop patch in cmake/RaylibAndroid.cmake.

No external artwork, game assets, Blender code, or GameStudio code is included.
Project code is newly authored. No project-code license has been selected yet;
the product owner should choose one before publishing this foundation.
