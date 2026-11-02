execute_process(
    COMMAND "${CMAKE_COMMAND}"
        "-DNOVA_LLDB=${NOVA_LLDB}" "-DNOVA_TEST_EXECUTABLE=${NOVA_TEST_EXECUTABLE}"
        "-DNOVA_TEST_ARGUMENTS=nova_missing_test_function" -DNOVA_TEST_TIMEOUT=15
        -P "${CMAKE_CURRENT_LIST_DIR}/qt_native_test.cmake"
    RESULT_VARIABLE runner_result
    OUTPUT_VARIABLE runner_output
    ERROR_VARIABLE runner_error
    TIMEOUT 25)
set(evidence "${runner_output}${runner_error}")
if(runner_result STREQUAL "0" OR
        NOT evidence MATCHES "Process [0-9]+ exited with status = 1 \\(0x0*1\\)" OR
        NOT evidence MATCHES "The native Qt test did not exit successfully under LLDB")
    message(FATAL_ERROR "The runner failed to reject a real nonzero debuggee exit:\n${evidence}")
endif()
