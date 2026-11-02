# Desktop-only component; the Studio shell and Android runtime remain separate.
option(NOVA_QT_SPRITE "Build the embeddable Qt Sprite document and workspace" OFF)
if(NOVA_QT_SPRITE)
    enable_language(CXX)
    find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets)
    add_library(nova_sprite STATIC
        authoring/sprite/document.cpp authoring/sprite/document.hpp
        authoring/sprite/codec.cpp authoring/sprite/codec.hpp
        authoring/sprite/canvas.cpp authoring/sprite/canvas.hpp
        authoring/sprite/icons.cpp authoring/sprite/icons.hpp
        authoring/sprite/preview.cpp authoring/sprite/preview.hpp
        authoring/sprite/workspace.cpp authoring/sprite/workspace.hpp)
    set_target_properties(nova_sprite PROPERTIES AUTOMOC ON)
    target_compile_features(nova_sprite PUBLIC cxx_std_17)
    target_include_directories(nova_sprite PUBLIC authoring)
    target_link_libraries(nova_sprite PUBLIC Qt6::Core Qt6::Gui Qt6::Widgets)
    target_compile_options(nova_sprite PRIVATE -Wall -Wextra -Wpedantic -Werror)

    if(BUILD_TESTING)
        find_package(Qt6 6.5 REQUIRED COMPONENTS Test)
        add_executable(nova_sprite_document_tests tests/sprite_document_test.cpp)
        set_target_properties(nova_sprite_document_tests PROPERTIES AUTOMOC ON)
        target_link_libraries(nova_sprite_document_tests PRIVATE nova_sprite Qt6::Test)
        target_compile_options(nova_sprite_document_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_sprite_document COMMAND nova_sprite_document_tests)
        set_tests_properties(nova_sprite_document PROPERTIES TIMEOUT 60)
        add_executable(nova_sprite_widget_tests tests/sprite_widget_test.cpp)
        set_target_properties(nova_sprite_widget_tests PROPERTIES AUTOMOC ON)
        if(APPLE)
            target_sources(nova_sprite_widget_tests PRIVATE tests/sprite_cocoa_test.mm)
            target_compile_definitions(nova_sprite_widget_tests PRIVATE NOVA_SPRITE_COCOA_TEST)
            target_link_libraries(nova_sprite_widget_tests PRIVATE "-framework Cocoa")
            set_target_properties(nova_sprite_widget_tests PROPERTIES MACOSX_BUNDLE ON
                OBJCXX_STANDARD 17 OBJCXX_STANDARD_REQUIRED ON
                MACOSX_BUNDLE_GUI_IDENTIFIER "dev.nova.sprite-component-tests"
                MACOSX_BUNDLE_BUNDLE_NAME "Nova Sprite component tests")
        endif()
        target_link_libraries(nova_sprite_widget_tests PRIVATE nova_sprite Qt6::Test)
        target_compile_options(nova_sprite_widget_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_sprite_widgets COMMAND nova_sprite_widget_tests)
        set_tests_properties(nova_sprite_widgets PROPERTIES TIMEOUT 120
            ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
        add_executable(nova_sprite_runtime_png_tests tests/sprite_runtime_png_test.cpp)
        set_target_properties(nova_sprite_runtime_png_tests PROPERTIES AUTOMOC ON)
        target_link_libraries(nova_sprite_runtime_png_tests PRIVATE nova_sprite Qt6::Test nova_assets)
        target_compile_options(nova_sprite_runtime_png_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_sprite_runtime_png COMMAND nova_sprite_runtime_png_tests)
        set_tests_properties(nova_sprite_runtime_png PROPERTIES TIMEOUT 30)
        option(NOVA_SPRITE_NATIVE_TESTS "Run Sprite controls on the real desktop and capture the widget" OFF)
        if(NOVA_SPRITE_NATIVE_TESTS)
            add_test(NAME nova_sprite_native COMMAND nova_sprite_widget_tests)
            set_tests_properties(nova_sprite_native PROPERTIES TIMEOUT 180 RUN_SERIAL TRUE
                ENVIRONMENT "NOVA_SPRITE_CAPTURE_DIR=${CMAKE_BINARY_DIR}/sprite-evidence")
            add_test(NAME nova_sprite_native_layout COMMAND nova_sprite_widget_tests authoredRoundTripAndCaptures)
            set_tests_properties(nova_sprite_native_layout PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE
                ENVIRONMENT "NOVA_SPRITE_CAPTURE_DIR=${CMAKE_BINARY_DIR}/sprite-evidence")
        endif()
    endif()
endif()
