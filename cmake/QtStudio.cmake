# Only Qt Base modules: LGPL-3.0-only / GPL / commercial, dynamically linked.
# The editor's raylib backend hosts the same C renderer in a Qt-owned GL context.
set(NOVA_RAYLIB_COMMON
    "${raylib_SOURCE_DIR}/src/rmodels.c" "${raylib_SOURCE_DIR}/src/rshapes.c"
    "${raylib_SOURCE_DIR}/src/rtext.c" "${raylib_SOURCE_DIR}/src/rtextures.c"
    "${raylib_SOURCE_DIR}/src/raudio.c" "${raylib_SOURCE_DIR}/src/utils.c")
add_library(nova_qt_raylib STATIC authoring/qt/raylib_host.c ${NOVA_RAYLIB_COMMON})
target_include_directories(nova_qt_raylib PUBLIC "${raylib_SOURCE_DIR}/src")
target_compile_definitions(nova_qt_raylib PRIVATE GRAPHICS_API_OPENGL_33 SUPPORT_CUSTOM_FRAME_CONTROL)
if(APPLE)
    target_link_libraries(nova_qt_raylib PUBLIC "-framework OpenGL" "-framework CoreAudio"
        "-framework AudioToolbox" "-framework CoreFoundation")
elseif(UNIX)
    target_link_libraries(nova_qt_raylib PUBLIC m dl pthread)
endif()

# Compile the identical runtime/import/presentation sources, without linking GLFW
# (two rcore implementations in one process would violate context ownership).
add_library(nova_qt_runtime STATIC runtime/assets.c runtime/presentation.c authoring/document.c)
target_include_directories(nova_qt_runtime PUBLIC runtime authoring
    PRIVATE "${raylib_SOURCE_DIR}/src/external")
target_link_libraries(nova_qt_runtime PUBLIC nova_saves nova_qt_raylib)
target_compile_definitions(nova_qt_runtime PRIVATE
    NOVA_DEFAULT_WORLD_WIDTH=${NOVA_WORLD_WIDTH} NOVA_DEFAULT_WORLD_HEIGHT=${NOVA_WORLD_HEIGHT})
target_compile_options(nova_qt_runtime PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_library(nova_qt_ui STATIC authoring/qt/native_viewport.cpp authoring/qt/native_viewport.h
    authoring/qt/project_document.cpp authoring/qt/project_document.h
    authoring/qt/code_editor.cpp authoring/qt/code_editor.h
    authoring/qt/studio_window.cpp authoring/qt/studio_window.h
    authoring/qt/studio_style.cpp authoring/qt/studio_style.h)
set_target_properties(nova_qt_ui PROPERTIES AUTOMOC ON)
target_include_directories(nova_qt_ui PUBLIC authoring/qt)
target_link_libraries(nova_qt_ui PUBLIC nova_qt_runtime Qt6::Core Qt6::Gui Qt6::Widgets Qt6::OpenGLWidgets)
target_compile_options(nova_qt_ui PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_executable(nova_studio_app MACOSX_BUNDLE authoring/qt/main.cpp)
target_link_libraries(nova_studio_app PRIVATE nova_qt_ui)
target_compile_options(nova_studio_app PRIVATE -Wall -Wextra -Wpedantic -Werror)
if(APPLE)
    set_target_properties(nova_studio_app PROPERTIES OUTPUT_NAME "Nova Studio"
        MACOSX_BUNDLE_BUNDLE_NAME "Nova Studio" MACOSX_BUNDLE_GUI_IDENTIFIER "studio.nova.authoring"
        MACOSX_BUNDLE_BUNDLE_VERSION "0.2.0" MACOSX_BUNDLE_SHORT_VERSION_STRING "0.2.0")
    set(NOVA_QT_RESOURCES "$<TARGET_BUNDLE_DIR:nova_studio_app>/Contents/Resources")
else()
    set(NOVA_QT_RESOURCES "$<TARGET_FILE_DIR:nova_studio_app>")
endif()
add_custom_target(nova_qt_app_assets ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${PROJECT_SOURCE_DIR}/examples" "${NOVA_QT_RESOURCES}/examples"
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${NOVA_LICENSE_DIRECTORY}" "${NOVA_QT_RESOURCES}/licenses"
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${PROJECT_SOURCE_DIR}/authoring/qt/licenses" "${NOVA_QT_RESOURCES}/licenses/qt-base"
    COMMAND ${CMAKE_COMMAND} -E copy "${PROJECT_SOURCE_DIR}/authoring/qt/NOTICE.txt" "${NOVA_QT_RESOURCES}/licenses/qt-base/NOTICE.txt")
add_dependencies(nova_studio_app nova_qt_app_assets)

if(BUILD_TESTING)
    find_package(Qt6 6.5 REQUIRED COMPONENTS Test)
    add_executable(nova_qt_document_tests tests/qt_document_test.cpp)
    set_target_properties(nova_qt_document_tests PROPERTIES AUTOMOC ON)
    target_link_libraries(nova_qt_document_tests PRIVATE nova_qt_ui Qt6::Test)
    target_compile_definitions(nova_qt_document_tests PRIVATE
        NOVA_EXAMPLES="${PROJECT_SOURCE_DIR}/examples"
        NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
    add_test(NAME nova_qt_documents COMMAND nova_qt_document_tests)
    add_executable(nova_qt_bridge_tests tests/qt_bridge_test.cpp)
    set_target_properties(nova_qt_bridge_tests PROPERTIES AUTOMOC ON)
    target_link_libraries(nova_qt_bridge_tests PRIVATE nova_qt_ui Qt6::Test)
    target_compile_definitions(nova_qt_bridge_tests PRIVATE
        NOVA_EXAMPLES="${PROJECT_SOURCE_DIR}/examples"
        NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
    if(NOVA_GPU_TESTS)
        add_test(NAME nova_qt_native_bridge COMMAND nova_qt_bridge_tests)
        set_tests_properties(nova_qt_native_bridge PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE)
    endif()
    add_executable(nova_qt_workspace_tests tests/qt_workspace_test.cpp)
    set_target_properties(nova_qt_workspace_tests PROPERTIES AUTOMOC ON)
    target_link_libraries(nova_qt_workspace_tests PRIVATE nova_qt_ui Qt6::Test)
    target_compile_definitions(nova_qt_workspace_tests PRIVATE
        NOVA_EXAMPLES="${PROJECT_SOURCE_DIR}/examples"
        NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
    if(NOVA_GPU_TESTS)
        add_test(NAME nova_qt_workspace COMMAND nova_qt_workspace_tests)
        set_tests_properties(nova_qt_workspace PROPERTIES TIMEOUT 90 RUN_SERIAL TRUE)
    endif()
endif()
