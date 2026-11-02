option(NOVA_MESH_AUTHORING "Build the desktop editable-mesh document component" OFF)
if(NOVA_MESH_AUTHORING)
    enable_language(CXX)
    find_package(Qt6 6.5 REQUIRED COMPONENTS Core)
    add_library(nova_mesh STATIC
        authoring/mesh/document.cpp
        authoring/mesh/geometry.cpp
        authoring/mesh/glb.cpp
        authoring/mesh/native.cpp
        authoring/mesh/source.cpp
        authoring/mesh/topology.cpp
        authoring/mesh/validation.cpp)
    target_compile_features(nova_mesh PUBLIC cxx_std_17)
    target_include_directories(nova_mesh PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/authoring")
    target_include_directories(nova_mesh SYSTEM PRIVATE "${raylib_SOURCE_DIR}/src/external")
    target_link_libraries(nova_mesh PUBLIC Qt6::Core PRIVATE nova_assets)
    target_compile_options(nova_mesh PRIVATE -Wall -Wextra -Wpedantic -Werror)
    if(BUILD_TESTING)
        add_executable(nova_mesh_tests tests/mesh_test.cpp)
        target_link_libraries(nova_mesh_tests PRIVATE nova_mesh nova_model)
        target_compile_options(nova_mesh_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        foreach(suite document native capacity)
            add_test(NAME nova_mesh_${suite} COMMAND nova_mesh_tests ${suite})
            set_tests_properties(nova_mesh_${suite} PROPERTIES TIMEOUT 180)
        endforeach()
        add_library(nova_mesh_test_assets OBJECT runtime/assets.c)
        target_link_libraries(nova_mesh_test_assets PRIVATE nova_assets)
        target_include_directories(nova_mesh_test_assets SYSTEM PRIVATE "${raylib_SOURCE_DIR}/src/external")
        target_compile_definitions(nova_mesh_test_assets PRIVATE
            MemAlloc=nova_mesh_test_alloc MemFree=nova_mesh_test_free
            LoadImageFromMemory=nova_mesh_test_load_image ImageFormat=nova_mesh_test_image_format
            UnloadImage=nova_mesh_test_unload_image)
        target_compile_options(nova_mesh_test_assets PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_library(nova_mesh_test_native OBJECT authoring/mesh/native.cpp)
        target_link_libraries(nova_mesh_test_native PRIVATE nova_mesh nova_assets)
        target_include_directories(nova_mesh_test_native SYSTEM PRIVATE "${raylib_SOURCE_DIR}/src/external")
        target_compile_definitions(nova_mesh_test_native PRIVATE UnloadImage=nova_mesh_test_unload_image)
        target_compile_options(nova_mesh_test_native PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_executable(nova_mesh_ownership_tests tests/mesh_test.cpp tests/mesh_allocation_hooks.c
            $<TARGET_OBJECTS:nova_mesh_test_assets> $<TARGET_OBJECTS:nova_mesh_test_native>)
        target_link_libraries(nova_mesh_ownership_tests PRIVATE nova_mesh nova_model)
        target_compile_definitions(nova_mesh_ownership_tests PRIVATE NOVA_MESH_ALLOCATION_TEST)
        target_compile_options(nova_mesh_ownership_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME nova_mesh_ownership COMMAND nova_mesh_ownership_tests native)
        set_tests_properties(nova_mesh_ownership PROPERTIES TIMEOUT 180)
    endif()
endif()
