cmake_minimum_required(VERSION 3.22)
set(CMAKE_OSX_DEPLOYMENT_TARGET 11.0 CACHE STRING "Minimum macOS")
project(Neuropolis VERSION 0.2.1 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
add_subdirectory(../tools/plugin-sdk/JUCE juce)
juce_add_plugin(Neuropolis
    COMPANY_NAME "Neuropolis" BUNDLE_ID "studio.neuropolis.midi"
    PLUGIN_MANUFACTURER_CODE Npol PLUGIN_CODE Nplx
    FORMATS AU VST3 PRODUCT_NAME "neuropolis"
    IS_SYNTH FALSE IS_MIDI_EFFECT TRUE NEEDS_MIDI_INPUT TRUE NEEDS_MIDI_OUTPUT TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE COPY_PLUGIN_AFTER_BUILD FALSE)
file(GLOB WEB_RESOURCES CONFIGURE_DEPENDS ../web/dist/*.js)
list(APPEND WEB_RESOURCES ../web/dist/index.html ../web/dist/style.css ../web/dist/catalog.json ../web/dist/engine.wasm generated/initial.json)
juce_add_binary_data(NeuropolisAssets SOURCES ${WEB_RESOURCES})
target_sources(Neuropolis PRIVATE Source/Plugin.cpp)
target_include_directories(Neuropolis PRIVATE generated)
target_compile_definitions(Neuropolis PUBLIC JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
add_library(NeuropolisRust STATIC IMPORTED)
set_target_properties(NeuropolisRust PROPERTIES IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../target/release/libneuropolis_plugin.a")
target_link_libraries(Neuropolis PRIVATE NeuropolisAssets NeuropolisRust
    juce::juce_audio_utils juce::juce_gui_extra
    "-framework Security" "-framework SystemConfiguration"
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

juce_add_gui_app(NeuropolisCheck PRODUCT_NAME "Neuropolis Check" BUNDLE_ID "studio.neuropolis.check")
target_sources(NeuropolisCheck PRIVATE Source/CheckHost.cpp)
target_include_directories(NeuropolisCheck PRIVATE generated)
target_compile_definitions(NeuropolisCheck PRIVATE JUCE_PLUGINHOST_AU=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(NeuropolisCheck PRIVATE juce::juce_audio_utils juce::juce_gui_extra PUBLIC juce::juce_recommended_config_flags)
target_compile_definitions(NeuropolisCheck PRIVATE NEUROPOLIS_CHECK_LOG="${CMAKE_CURRENT_SOURCE_DIR}/../analysis/plugin-host.log")
