include_guard(GLOBAL)

function(nova_add_qt_native_test name target timeout)
    if(APPLE)
        find_program(NOVA_LLDB NAMES lldb HINTS "/usr/bin" REQUIRED)
        math(EXPR debugger_timeout "${timeout} - 10")
        add_test(NAME "${name}" COMMAND "${CMAKE_COMMAND}"
            "-DNOVA_LLDB=${NOVA_LLDB}" "-DNOVA_TEST_EXECUTABLE=$<TARGET_FILE:${target}>"
            "-DNOVA_TEST_TIMEOUT=${debugger_timeout}"
            "-DNOVA_TEST_ARGUMENTS=${ARGN}"
            -P "${PROJECT_SOURCE_DIR}/tests/qt_native_test.cmake")
    else()
        add_test(NAME "${name}" COMMAND "${target}" ${ARGN})
    endif()
    set_tests_properties("${name}" PROPERTIES TIMEOUT "${timeout}" RUN_SERIAL TRUE)
endfunction()
