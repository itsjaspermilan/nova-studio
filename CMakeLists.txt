cmake_minimum_required(VERSION 3.22)
project(NovaStudio VERSION 0.1.0 LANGUAGES C)

set(NOVA_WORLD_RESOLUTION "960x540" CACHE STRING "World GPU resolution (HUD uses the native framebuffer)")
set_property(CACHE NOVA_WORLD_RESOLUTION PROPERTY STRINGS "960x540" "1280x720" "1920x1080")
if(NOT NOVA_WORLD_RESOLUTION MATCHES "^(960x540|1280x720|1920x1080)$")
    message(FATAL_ERROR "NOVA_WORLD_RESOLUTION must be 960x540, 1280x720 or 1920x1080")
endif()
string(REPLACE "x" ";" NOVA_WORLD_DIMENSIONS "${NOVA_WORLD_RESOLUTION}")
list(GET NOVA_WORLD_DIMENSIONS 0 NOVA_WORLD_WIDTH)
list(GET NOVA_WORLD_DIMENSIONS 1 NOVA_WORLD_HEIGHT)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

include(FetchContent)
if(POLICY CMP0135)
    cmake_policy(SET CMP0135 NEW)
endif()
FetchContent_Declare(lua
    URL https://www.lua.org/ftp/lua-5.4.8.tar.gz
    URL_HASH SHA256=4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae)
FetchContent_MakeAvailable(lua)
file(GLOB LUA_SOURCES CONFIGURE_DEPENDS "${lua_SOURCE_DIR}/src/*.c")
list(REMOVE_ITEM LUA_SOURCES "${lua_SOURCE_DIR}/src/lua.c" "${lua_SOURCE_DIR}/src/luac.c")
add_library(nova_lua STATIC ${LUA_SOURCES})
target_include_directories(nova_lua PUBLIC "${lua_SOURCE_DIR}/src")
target_compile_definitions(nova_lua PRIVATE LUA_USE_POSIX)
target_link_libraries(nova_lua PUBLIC m)

add_library(nova_core STATIC engine/nova.c engine/project.c)
target_include_directories(nova_core PUBLIC engine)
target_link_libraries(nova_core PUBLIC nova_lua)
target_compile_options(nova_core PRIVATE -Wall -Wextra -Wpedantic -Werror)

set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WITH_PIC ON CACHE BOOL "" FORCE)
if(ANDROID)
    set(PLATFORM Android CACHE STRING "" FORCE)
else()
    set(PLATFORM Desktop CACHE STRING "" FORCE)
endif()
FetchContent_Declare(raylib
    URL https://github.com/raysan5/raylib/archive/refs/tags/5.5.tar.gz
    URL_HASH SHA256=aea98ecf5bc5c5e0b789a76de0083a21a70457050ea4cc2aec7566935f5e258e)
FetchContent_MakeAvailable(raylib)
include(cmake/DependencyNotices.cmake)
if(ANDROID)
    include(cmake/RaylibAndroid.cmake)
endif()

add_library(nova_saves STATIC runtime/saves.c)
target_include_directories(nova_saves PUBLIC runtime)
target_link_libraries(nova_saves PUBLIC nova_core)
target_compile_options(nova_saves PRIVATE -Wall -Wextra -Wpedantic -Werror)
add_library(nova_assets STATIC runtime/assets.c)
target_include_directories(nova_assets PUBLIC runtime PRIVATE "${raylib_SOURCE_DIR}/src/external")
target_link_libraries(nova_assets PUBLIC nova_saves raylib)
target_compile_options(nova_assets PRIVATE -Wall -Wextra -Wpedantic -Werror)
if(ANDROID)
    target_include_directories(nova_assets SYSTEM PRIVATE "${ANDROID_NDK}/sources/android/native_app_glue")
endif()

add_library(nova_presentation STATIC runtime/presentation.c)
target_link_libraries(nova_presentation PUBLIC nova_assets)
target_compile_definitions(nova_presentation PRIVATE
    NOVA_DEFAULT_WORLD_WIDTH=${NOVA_WORLD_WIDTH} NOVA_DEFAULT_WORLD_HEIGHT=${NOVA_WORLD_HEIGHT})
target_compile_options(nova_presentation PRIVATE -Wall -Wextra -Wpedantic -Werror)

if(ANDROID)
    add_library(nova_runtime SHARED runtime/main.c)
    option(NOVA_STANDALONE "Start the packaged game without the sample launcher" OFF)
    if(NOVA_STANDALONE)
        target_compile_definitions(nova_runtime PRIVATE NOVA_STANDALONE)
    endif()
    # NativeActivity loads this by name; retain native_app_glue from the static archive.
    target_link_options(nova_runtime PRIVATE "LINKER:-u,ANativeActivity_onCreate")
    set(NOVA_APP nova_runtime)
else()
    add_executable(nova_studio runtime/main.c)
    add_library(nova_authoring STATIC authoring/document.c)
    target_include_directories(nova_authoring PUBLIC authoring)
    target_link_libraries(nova_authoring PUBLIC nova_assets)
    target_compile_options(nova_authoring PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_library(nova_model STATIC authoring/model.c)
    target_include_directories(nova_model PUBLIC authoring)
    target_link_libraries(nova_model PUBLIC nova_assets)
    target_compile_options(nova_model PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_library(nova_game STATIC authoring/game.c)
    target_link_libraries(nova_game PUBLIC nova_authoring nova_model)
    target_compile_options(nova_game PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_library(nova_model_view STATIC authoring/model_view.c)
    target_link_libraries(nova_model_view PUBLIC nova_model nova_authoring nova_presentation)
    target_compile_options(nova_model_view PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_library(nova_ui_style STATIC authoring/style.c)
    target_include_directories(nova_ui_style PUBLIC authoring)
    target_link_libraries(nova_ui_style PUBLIC nova_assets)
    if(APPLE)
        target_link_libraries(nova_ui_style PRIVATE "-framework CoreText" "-framework CoreGraphics" "-framework CoreFoundation")
    endif()
    target_compile_options(nova_ui_style PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_library(nova_game_ui STATIC authoring/game_ui.c)
    target_link_libraries(nova_game_ui PUBLIC nova_game nova_model_view nova_ui_style)
    target_compile_options(nova_game_ui PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_executable(nova_editor authoring/editor.c authoring/widgets.c authoring/model_ui.c)
    target_link_libraries(nova_editor PRIVATE nova_authoring nova_presentation nova_model_view nova_ui_style nova_game_ui)
    target_compile_options(nova_editor PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_executable(nova_export_validate runtime/export_validate.c)
    target_link_libraries(nova_export_validate PRIVATE nova_assets)
    target_compile_options(nova_export_validate PRIVATE -Wall -Wextra -Wpedantic -Werror)
    set(NOVA_APP nova_studio)
    add_custom_target(nova_desktop_assets ALL
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_CURRENT_SOURCE_DIR}/examples" "$<TARGET_FILE_DIR:nova_studio>/examples"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${NOVA_LICENSE_DIRECTORY}" "$<TARGET_FILE_DIR:nova_studio>/licenses")
    add_dependencies(nova_studio nova_desktop_assets)
    add_dependencies(nova_editor nova_desktop_assets)
    include(CTest)
    if(BUILD_TESTING)
        add_executable(nova_game_tests tests/game_test.c)
        target_link_libraries(nova_game_tests PRIVATE nova_game)
        target_compile_options(nova_game_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_game_authoring COMMAND nova_game_tests)
        add_executable(nova_game_failure_tests tests/game_failure_test.c authoring/game.c)
        target_link_libraries(nova_game_failure_tests PRIVATE nova_authoring nova_model)
        target_compile_definitions(nova_game_failure_tests PRIVATE nova_document_save=nova_game_test_save)
        target_compile_options(nova_game_failure_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_game_save_failures COMMAND nova_game_failure_tests)
        add_executable(nova_document_tests tests/document_test.c)
        target_link_libraries(nova_document_tests PRIVATE nova_authoring)
        target_compile_definitions(nova_document_tests PRIVATE NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
        target_compile_options(nova_document_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_documents COMMAND nova_document_tests)
        add_executable(nova_model_tests tests/model_test.c)
        target_link_libraries(nova_model_tests PRIVATE nova_model nova_authoring nova_presentation)
        target_compile_definitions(nova_model_tests PRIVATE NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
        target_compile_options(nova_model_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_model COMMAND nova_model_tests)
        add_executable(nova_widget_tests tests/widgets_test.c authoring/widgets.c)
        target_link_libraries(nova_widget_tests PRIVATE nova_authoring nova_ui_style)
        target_compile_definitions(nova_widget_tests PRIVATE NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
        target_compile_options(nova_widget_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_text_editing COMMAND nova_widget_tests)
        add_test(NAME nova_editor_cli_invalid COMMAND nova_editor --invalid-option)
        set_tests_properties(nova_editor_cli_invalid PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_editor_cli_unbounded_capture COMMAND nova_editor --capture native.png)
        set_tests_properties(nova_editor_cli_unbounded_capture PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_editor_cli_modeller_without_project COMMAND nova_editor --modeller)
        set_tests_properties(nova_editor_cli_modeller_without_project PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_export_preflight COMMAND nova_export_validate
            "${CMAKE_CURRENT_SOURCE_DIR}/examples/assets/nova.project")
        find_program(NOVA_PYTHON_EXECUTABLE python3 PATHS /usr/bin NO_DEFAULT_PATH)
        if(NOVA_PYTHON_EXECUTABLE)
            add_test(NAME nova_export_tooling COMMAND "${NOVA_PYTHON_EXECUTABLE}" -B
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/export_test.py")
            set_tests_properties(nova_export_tooling PROPERTIES
                ENVIRONMENT "NOVA_EXPORT_VALIDATOR=$<TARGET_FILE:nova_export_validate>")
        endif()
        add_executable(nova_tests tests/core_test.c)
        target_link_libraries(nova_tests PRIVATE nova_core)
        target_compile_definitions(nova_tests PRIVATE NOVA_EXAMPLES="${CMAKE_CURRENT_SOURCE_DIR}/examples")
        target_compile_options(nova_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_core COMMAND nova_tests)
        add_executable(nova_project_tests tests/project_test.c)
        target_link_libraries(nova_project_tests PRIVATE nova_core)
        target_compile_options(nova_project_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_project COMMAND nova_project_tests)
        add_executable(nova_asset_tests tests/assets_test.c)
        target_link_libraries(nova_asset_tests PRIVATE nova_assets)
        target_compile_definitions(nova_asset_tests PRIVATE
            NOVA_EXAMPLES="${CMAKE_CURRENT_SOURCE_DIR}/examples"
            NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
        target_compile_options(nova_asset_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_assets COMMAND nova_asset_tests)
        add_executable(nova_service_tests tests/services_test.c)
        target_link_libraries(nova_service_tests PRIVATE nova_assets)
        target_compile_definitions(nova_service_tests PRIVATE
            NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}"
            NOVA_EXAMPLES="${CMAKE_CURRENT_SOURCE_DIR}/examples")
        target_compile_options(nova_service_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_services COMMAND nova_service_tests)
        option(NOVA_AUDIO_TESTS "Run native audio lifetime tests (requires an audio device)" OFF)
        if(NOVA_AUDIO_TESTS)
            add_test(NAME nova_audio_lifetime COMMAND nova_service_tests --audio)
            set_tests_properties(nova_audio_lifetime PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
        endif()
        add_executable(nova_presentation_tests tests/presentation_test.c)
        target_link_libraries(nova_presentation_tests PRIVATE nova_presentation)
        target_compile_definitions(nova_presentation_tests PRIVATE
            NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
        target_compile_options(nova_presentation_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_presentation COMMAND nova_presentation_tests)
        add_test(NAME nova_cmake_world_resolution COMMAND ${CMAKE_COMMAND}
            "-DNOVA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}"
            "-DNOVA_TEST_DIRECTORY=${CMAKE_BINARY_DIR}"
            -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/world_resolution_test.cmake")
        foreach(value "640x360" "1280X720" "1920x1080junk" "")
            string(MAKE_C_IDENTIFIER "nova_cli_world_${value}" test_name)
            add_test(NAME ${test_name} COMMAND nova_studio --world-resolution "${value}")
            set_tests_properties(${test_name} PROPERTIES WILL_FAIL TRUE)
        endforeach()
        add_test(NAME nova_cli_native_unbounded COMMAND nova_studio --capture-native native.png)
        add_test(NAME nova_cli_capture_same_path COMMAND nova_studio
            --frames 1 --capture same.png --capture-native same.png)
        set_tests_properties(nova_cli_native_unbounded nova_cli_capture_same_path PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_cli_invalid COMMAND nova_studio --invalid-option)
        set_tests_properties(nova_cli_invalid PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_cli_conflicting_project COMMAND nova_studio --scene main.lua --project nova.project)
        set_tests_properties(nova_cli_conflicting_project PROPERTIES WILL_FAIL TRUE)
        add_test(NAME nova_android_lifecycle_patch COMMAND ${CMAKE_COMMAND}
            "-DNOVA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}"
            "-DNOVA_RAYLIB_SOURCE=${raylib_SOURCE_DIR}"
            "-DNOVA_PATCH_TEST_DIRECTORY=${CMAKE_BINARY_DIR}/patch-test"
            -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/android_patch_test.cmake")
        option(NOVA_GPU_TESTS "Run native GPU smoke tests (requires a desktop session)" OFF)
        if(NOVA_GPU_TESTS)
            add_executable(nova_game_ui_tests tests/game_ui_test.c authoring/game_ui.c authoring/widgets.c authoring/model_ui.c)
            target_link_libraries(nova_game_ui_tests PRIVATE nova_game nova_model_view nova_ui_style)
            target_compile_definitions(nova_game_ui_tests PRIVATE
                NOVA_GAME_TEST_DIRECTORY="${CMAKE_BINARY_DIR}"
                GetMousePosition=nova_game_test_mouse IsMouseButtonPressed=nova_game_test_press
                IsMouseButtonReleased=nova_game_test_release IsKeyPressed=nova_game_test_key
                IsKeyPressedRepeat=nova_game_test_key IsKeyDown=nova_game_test_down
                GetCharPressed=nova_game_test_char GetMouseWheelMove=nova_game_test_wheel
                IsWindowFocused=nova_game_test_focus)
            target_compile_options(nova_game_ui_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_dependencies(nova_game_ui_tests nova_editor nova_studio)
            add_test(NAME nova_gpu_objects_rooms COMMAND nova_game_ui_tests
                "$<TARGET_FILE:nova_editor>" "$<TARGET_FILE:nova_studio>")
            set_tests_properties(nova_gpu_objects_rooms PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE)
            add_executable(nova_ui_style_tests tests/ui_style_test.c)
            target_link_libraries(nova_ui_style_tests PRIVATE nova_ui_style nova_presentation)
            target_compile_definitions(nova_ui_style_tests PRIVATE NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
            target_compile_options(nova_ui_style_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_test(NAME nova_gpu_ui_typography COMMAND nova_ui_style_tests)
            set_tests_properties(nova_gpu_ui_typography PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_test(NAME nova_gpu_model COMMAND nova_model_tests --gpu)
            set_tests_properties(nova_gpu_model PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_test(NAME nova_gpu_editor_authoring COMMAND nova_editor --smoke
                --frames 90 --capture "${CMAKE_BINARY_DIR}/editor-authored.png")
            set_tests_properties(nova_gpu_editor_authoring PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE
                PASS_REGULAR_EXPRESSION "NOVA_EDITOR_SMOKE.*native-pixels=ok")
            add_executable(nova_model_ui_tests tests/model_ui_test.c authoring/model_ui.c authoring/widgets.c)
            target_link_libraries(nova_model_ui_tests PRIVATE nova_model_view nova_ui_style)
            target_compile_definitions(nova_model_ui_tests PRIVATE
                NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}"
                GetMousePosition=nova_model_test_mouse IsMouseButtonPressed=nova_model_test_click
                IsKeyPressed=nova_model_test_key IsKeyPressedRepeat=nova_model_test_repeat
                IsKeyDown=nova_model_test_down GetCharPressed=nova_model_test_char
                GetMouseWheelMove=nova_model_test_wheel)
            target_compile_options(nova_model_ui_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_test(NAME nova_gpu_modeller_ui COMMAND nova_model_ui_tests "$<TARGET_FILE:nova_editor>")
            set_tests_properties(nova_gpu_modeller_ui PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_test(NAME nova_gpu_editor COMMAND nova_editor
                --project "${CMAKE_CURRENT_SOURCE_DIR}/examples/assets/nova.project"
                --frames 60 --capture "${CMAKE_BINARY_DIR}/editor.png")
            set_tests_properties(nova_gpu_editor PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE
                PASS_REGULAR_EXPRESSION "NOVA_EDITOR frames=60 preview=running.*declarations=2.*status=ok")
            add_executable(nova_presentation_failure_tests tests/presentation_failure_test.c runtime/presentation.c)
            target_link_libraries(nova_presentation_failure_tests PRIVATE nova_assets)
            target_compile_definitions(nova_presentation_failure_tests PRIVATE
                NOVA_DEFAULT_WORLD_WIDTH=${NOVA_WORLD_WIDTH} NOVA_DEFAULT_WORLD_HEIGHT=${NOVA_WORLD_HEIGHT}
                LoadRenderTexture=nova_test_load_render_texture
                UnloadRenderTexture=nova_test_unload_render_texture)
            target_compile_options(nova_presentation_failure_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_test(NAME nova_gpu_presentation_allocation COMMAND nova_presentation_failure_tests)
            set_tests_properties(nova_gpu_presentation_allocation PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_test(NAME nova_gpu_presentation COMMAND nova_presentation_tests --gpu)
            set_tests_properties(nova_gpu_presentation PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_executable(nova_render_tests tests/render_test.c)
            target_link_libraries(nova_render_tests PRIVATE raylib)
            target_compile_options(nova_render_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_test(NAME nova_gpu_presentation_cli COMMAND ${CMAKE_COMMAND}
                "-DNOVA_RUNTIME=$<TARGET_FILE:nova_studio>" "-DNOVA_RENDER_CHECK=$<TARGET_FILE:nova_render_tests>"
                "-DNOVA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}" "-DNOVA_TEST_DIRECTORY=${CMAKE_BINARY_DIR}"
                -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/presentation_cli_test.cmake")
            set_tests_properties(nova_gpu_presentation_cli PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            add_test(NAME nova_gpu_2d COMMAND nova_studio
                --scene "${CMAKE_CURRENT_SOURCE_DIR}/examples/2d/main.lua"
                --frames 120 --capture "${CMAKE_BINARY_DIR}/2d.png")
            add_test(NAME nova_gpu_mixed COMMAND nova_studio
                --smoke --frames 120 --capture "${CMAKE_BINARY_DIR}/mixed.png")
            set_tests_properties(nova_gpu_2d nova_gpu_mixed PROPERTIES
                TIMEOUT 30 RUN_SERIAL TRUE PASS_REGULAR_EXPRESSION "NOVA_RUN frames=120.*status=ok")
            foreach(fixture 2d mixed)
                set_tests_properties(nova_gpu_${fixture} PROPERTIES FIXTURES_SETUP nova_${fixture}_capture)
                add_test(NAME nova_gpu_${fixture}_pixels COMMAND nova_render_tests
                    "${CMAKE_BINARY_DIR}/${fixture}.png" "${fixture}")
                set_tests_properties(nova_gpu_${fixture}_pixels PROPERTIES FIXTURES_REQUIRED nova_${fixture}_capture)
            endforeach()
            add_test(NAME nova_gpu_project COMMAND nova_studio
                --project "${CMAKE_CURRENT_SOURCE_DIR}/examples/assets/nova.project"
                --frames 120 --capture "${CMAKE_BINARY_DIR}/assets.png")
            set_tests_properties(nova_gpu_project PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE
                PASS_REGULAR_EXPRESSION "NOVA_RUN frames=120.*status=ok" FIXTURES_SETUP nova_asset_capture)
            add_test(NAME nova_gpu_project_pixels COMMAND nova_render_tests "${CMAKE_BINARY_DIR}/assets.png")
            set_tests_properties(nova_gpu_project_pixels PROPERTIES FIXTURES_REQUIRED nova_asset_capture)
            add_test(NAME nova_gpu_asset_lifetime COMMAND nova_asset_tests --gpu)
            set_tests_properties(nova_gpu_asset_lifetime PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE)
            foreach(fixture sprites static)
                add_test(NAME nova_gpu_${fixture} COMMAND nova_studio
                    --project "${CMAKE_CURRENT_SOURCE_DIR}/examples/${fixture}/nova.project"
                    --frames 120 --capture "${CMAKE_BINARY_DIR}/${fixture}.png")
                set_tests_properties(nova_gpu_${fixture} PROPERTIES TIMEOUT 30 RUN_SERIAL TRUE
                    PASS_REGULAR_EXPRESSION "NOVA_RUN frames=120.*status=ok"
                    FIXTURES_SETUP nova_${fixture}_capture)
                add_test(NAME nova_gpu_${fixture}_pixels COMMAND nova_render_tests
                    "${CMAKE_BINARY_DIR}/${fixture}.png" "${fixture}")
                set_tests_properties(nova_gpu_${fixture}_pixels PROPERTIES
                    FIXTURES_REQUIRED nova_${fixture}_capture)
            endforeach()
        endif()
    endif()
endif()
target_link_libraries(${NOVA_APP} PRIVATE nova_presentation)
target_compile_options(${NOVA_APP} PRIVATE -Wall -Wextra -Wpedantic -Werror)
