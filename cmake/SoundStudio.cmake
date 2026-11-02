if(NOVA_QT_SOUND)
    enable_language(CXX)
    find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets)
    add_library(nova_sound STATIC
        authoring/sound/document.cpp authoring/sound/document.hpp
        authoring/sound/codec.cpp
        authoring/sound/render.cpp authoring/sound/render.hpp
        authoring/sound/audition.cpp authoring/sound/audition.hpp
        authoring/sound/waveform.cpp authoring/sound/waveform.hpp
        authoring/sound/icons.cpp authoring/sound/icons.hpp
        authoring/sound/workspace.cpp authoring/sound/workspace.hpp)
    set_target_properties(nova_sound PROPERTIES AUTOMOC ON)
    target_compile_features(nova_sound PUBLIC cxx_std_17)
    target_include_directories(nova_sound PUBLIC authoring)
    target_link_libraries(nova_sound PUBLIC nova_audio Qt6::Core Qt6::Gui Qt6::Widgets)
    target_compile_options(nova_sound PRIVATE -Wall -Wextra -Wpedantic -Werror)

    # Unresolved native symbols belong to the consumer's one selected raylib host.
    add_library(nova_sound_native STATIC authoring/sound/native_host.cpp authoring/sound/native_host.hpp)
    target_link_libraries(nova_sound_native PUBLIC nova_sound nova_audio_native)
    target_compile_options(nova_sound_native PRIVATE -Wall -Wextra -Wpedantic -Werror)

    if(BUILD_TESTING)
        find_package(Qt6 6.5 REQUIRED COMPONENTS Test)
        foreach(suite document audio widget native_host)
            add_executable(nova_sound_${suite}_tests tests/sound_${suite}_test.cpp)
            set_target_properties(nova_sound_${suite}_tests PROPERTIES AUTOMOC ON)
            if(suite STREQUAL "native_host")
                target_link_libraries(nova_sound_${suite}_tests PRIVATE nova_sound_native Qt6::Test)
            else()
                target_link_libraries(nova_sound_${suite}_tests PRIVATE nova_sound Qt6::Test)
            endif()
            target_compile_options(nova_sound_${suite}_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
            add_test(NAME nova_sound_${suite} COMMAND nova_sound_${suite}_tests)
            set_tests_properties(nova_sound_${suite} PROPERTIES TIMEOUT 120)
        endforeach()
        target_compile_definitions(nova_sound_widget_tests PRIVATE
            NOVA_SOUND_CAPTURE_DIR="${CMAKE_BINARY_DIR}/sound-evidence")
        set_tests_properties(nova_sound_widget PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
        add_test(NAME nova_sound_host_linkage COMMAND "${CMAKE_COMMAND}"
            "-DNOVA_SOUND_LINKS=$<TARGET_PROPERTY:nova_sound,LINK_LIBRARIES>"
            "-DNOVA_SOUND_NATIVE_LINKS=$<TARGET_PROPERTY:nova_sound_native,LINK_LIBRARIES>"
            -P "${PROJECT_SOURCE_DIR}/tests/sound_link_test.cmake")
    endif()
endif()
