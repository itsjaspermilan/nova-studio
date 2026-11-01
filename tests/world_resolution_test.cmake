execute_process(COMMAND "${CMAKE_COMMAND}" -S "${NOVA_ROOT}"
    -B "${NOVA_TEST_DIRECTORY}/invalid-world-resolution" -DNOVA_WORLD_RESOLUTION=640x360
    RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE error)
if(result EQUAL 0 OR NOT error MATCHES "NOVA_WORLD_RESOLUTION must be")
    message(FATAL_ERROR "Invalid world resolution was not explicitly rejected: ${output}\n${error}")
endif()
