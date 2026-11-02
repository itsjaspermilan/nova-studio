if(NOT NOVA_LLDB OR NOT NOVA_TEST_EXECUTABLE)
    message(FATAL_ERROR "The native Qt test requires an LLDB path and test executable.")
endif()
if(NOT DEFINED NOVA_TEST_TIMEOUT)
    set(NOVA_TEST_TIMEOUT 50)
endif()

execute_process(
    COMMAND "${NOVA_LLDB}" --batch
        -o run -k "thread backtrace all" -k "process kill"
        -- "${NOVA_TEST_EXECUTABLE}" ${NOVA_TEST_ARGUMENTS}
    RESULT_VARIABLE debugger_result
    OUTPUT_VARIABLE test_output
    ERROR_VARIABLE test_error
    TIMEOUT "${NOVA_TEST_TIMEOUT}")
message("${test_output}${test_error}")

# LLDB can exit successfully even when its debuggee fails or crashes.
if(NOT debugger_result STREQUAL "0" OR
        NOT test_output MATCHES "Process [0-9]+ exited with status = 0 \\(0x0+\\)")
    message(FATAL_ERROR "The native Qt test did not exit successfully under LLDB.")
endif()
