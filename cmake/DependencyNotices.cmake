set(NOVA_LICENSE_DIRECTORY "${CMAKE_BINARY_DIR}/dependency-notices" CACHE PATH "Packaged dependency notices")
file(GLOB NOVA_LICENSE_SOURCES CONFIGURE_DEPENDS "${PROJECT_SOURCE_DIR}/licenses/*")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${NOVA_LICENSE_SOURCES})
file(MAKE_DIRECTORY "${NOVA_LICENSE_DIRECTORY}")
file(COPY "${PROJECT_SOURCE_DIR}/licenses/" DESTINATION "${NOVA_LICENSE_DIRECTORY}")
file(COPY "${raylib_SOURCE_DIR}/LICENSE" DESTINATION "${NOVA_LICENSE_DIRECTORY}/raylib")
file(COPY "${raylib_SOURCE_DIR}/src/external/glfw/LICENSE.md"
    DESTINATION "${NOVA_LICENSE_DIRECTORY}/glfw")
# Keep embedded upstream notices verbatim, including notices inside single-header libraries.
file(GLOB NOVA_EMBEDDED_NOTICES "${raylib_SOURCE_DIR}/src/external/*.h" "${raylib_SOURCE_DIR}/src/external/*.c")
file(COPY ${NOVA_EMBEDDED_NOTICES} DESTINATION "${NOVA_LICENSE_DIRECTORY}/raylib-embedded")
file(COPY "${raylib_SOURCE_DIR}/src/external/glfw/src/mappings.h"
    DESTINATION "${NOVA_LICENSE_DIRECTORY}/glfw")
if(ANDROID)
    file(COPY "${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c"
        "${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.h"
        DESTINATION "${NOVA_LICENSE_DIRECTORY}/android-native-app-glue")
endif()
