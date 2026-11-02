if(NOT NOVA_MESH_LINK_LIBRARIES STREQUAL "Qt6::Core" OR
   NOT NOVA_MESH_INTERFACE_LINK_LIBRARIES STREQUAL "Qt6::Core")
    message(FATAL_ERROR
        "nova_mesh must link only Qt6::Core. Consumers must select the decoder "
        "and raylib host; even a PRIVATE static-library dependency leaks that host.\n"
        "LINK_LIBRARIES: ${NOVA_MESH_LINK_LIBRARIES}\n"
        "INTERFACE_LINK_LIBRARIES: ${NOVA_MESH_INTERFACE_LINK_LIBRARIES}")
endif()
