cmake_minimum_required(VERSION 3.22)
project(NovaAudio LANGUAGES C)

# Standalone build of the C11 audio core and its device-free tests. The Rust
# runtime will compile these same sources through the `cc` crate (see TODO M6);
# this file keeps the original test suite runnable until then.

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()
find_package(Threads REQUIRED)
set(NOVA_WARNINGS -Wall -Wextra -Wpedantic -Werror)

add_library(nova_audio STATIC audio.c production.c wav.c transport.c demo_score.c)
target_include_directories(nova_audio PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(nova_audio PUBLIC m)
target_compile_options(nova_audio PRIVATE ${NOVA_WARNINGS})

add_library(nova_audio_stream STATIC stream.c)
target_include_directories(nova_audio_stream PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(nova_audio_stream PUBLIC nova_audio Threads::Threads)
target_compile_options(nova_audio_stream PRIVATE ${NOVA_WARNINGS})

add_executable(nova_audio_render render_demo.c)
target_link_libraries(nova_audio_render PRIVATE nova_audio)
target_compile_options(nova_audio_render PRIVATE ${NOVA_WARNINGS})

include(CTest)
if(BUILD_TESTING)
    function(nova_audio_test name source)
        add_executable(${name} tests/${source})
        target_compile_options(${name} PRIVATE ${NOVA_WARNINGS})
        target_compile_definitions(${name} PRIVATE NOVA_TEST_DIRECTORY="${CMAKE_BINARY_DIR}")
    endfunction()

    nova_audio_test(nova_audio_tests audio_test.c)
    target_link_libraries(nova_audio_tests PRIVATE nova_audio)
    add_test(NAME nova_audio_dsp COMMAND nova_audio_tests)

    nova_audio_test(nova_audio_production_tests audio_production_test.c)
    target_link_libraries(nova_audio_production_tests PRIVATE nova_audio)
    add_test(NAME nova_audio_production COMMAND nova_audio_production_tests)
    set_tests_properties(nova_audio_production PROPERTIES TIMEOUT 60)

    nova_audio_test(nova_audio_transport_tests audio_transport_test.c)
    target_link_libraries(nova_audio_transport_tests PRIVATE nova_audio Threads::Threads)
    add_test(NAME nova_audio_transport COMMAND nova_audio_transport_tests)
    set_tests_properties(nova_audio_transport PROPERTIES TIMEOUT 30)

    nova_audio_test(nova_audio_stream_tests audio_stream_test.c)
    target_link_libraries(nova_audio_stream_tests PRIVATE nova_audio_stream)
    add_test(NAME nova_audio_disk_stream COMMAND nova_audio_stream_tests)
    set_tests_properties(nova_audio_disk_stream PROPERTIES TIMEOUT 60)

    # These two compile the sources under test directly so allocation, file and
    # thread calls can be replaced with failing versions.
    nova_audio_test(nova_audio_stream_failure_tests audio_stream_failure_test.c)
    target_sources(nova_audio_stream_failure_tests PRIVATE stream.c)
    target_include_directories(nova_audio_stream_failure_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(nova_audio_stream_failure_tests PRIVATE nova_audio Threads::Threads)
    target_compile_definitions(nova_audio_stream_failure_tests PRIVATE
        calloc=nova_stream_test_calloc free=nova_stream_test_free
        open=nova_stream_test_open close=nova_stream_test_close
        pread=nova_stream_test_pread fstat=nova_stream_test_fstat
        pthread_create=nova_stream_test_pthread_create pthread_join=nova_stream_test_pthread_join
        snprintf=nova_stream_test_snprintf nova_wav_decode=nova_stream_test_decode)
    add_test(NAME nova_audio_disk_failures COMMAND nova_audio_stream_failure_tests)
    set_tests_properties(nova_audio_disk_failures PROPERTIES TIMEOUT 60)

    nova_audio_test(nova_audio_allocation_tests audio_allocation_test.c)
    target_sources(nova_audio_allocation_tests PRIVATE audio.c production.c wav.c transport.c)
    target_include_directories(nova_audio_allocation_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(nova_audio_allocation_tests PRIVATE m)
    target_compile_definitions(nova_audio_allocation_tests PRIVATE
        malloc=nova_audio_test_malloc calloc=nova_audio_test_calloc
        free=nova_audio_test_free snprintf=nova_audio_test_snprintf)
    add_test(NAME nova_audio_allocations COMMAND nova_audio_allocation_tests)

    add_test(NAME nova_audio_render_cli COMMAND ${CMAKE_COMMAND}
        "-DNOVA_RENDER=$<TARGET_FILE:nova_audio_render>"
        "-DNOVA_TEST_DIRECTORY=${CMAKE_BINARY_DIR}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/audio_render_test.cmake")
endif()
