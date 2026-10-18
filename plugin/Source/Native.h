#pragma once
#include <cstdint>
struct NativeEngine;
using MidiEmit = void (*)(void *, uint32_t, uint8_t, uint8_t, uint8_t);
extern "C" {
NativeEngine *np_create(uint32_t);
void np_destroy(NativeEngine *);
bool np_set(NativeEngine *, uint32_t, uint32_t, uint32_t, uint32_t, int32_t);
void np_seal(NativeEngine *);
void np_preset(NativeEngine *, uint32_t, NativeEngine *);
void np_link(NativeEngine *, uint32_t, uint32_t, uint32_t);
void np_link_mute(NativeEngine *, uint32_t, uint32_t);
void np_project(NativeEngine *, int32_t, bool);
const void *np_config_buffer(const NativeEngine *);
void np_adopt(NativeEngine *, NativeEngine *, bool, void *, MidiEmit);
void np_delete_track(NativeEngine *, uint32_t, void *, MidiEmit);
void np_process(NativeEngine *, uint32_t, double, double, double, bool, void *, MidiEmit);
void np_command(NativeEngine *, uint32_t, uint32_t, uint32_t, uint32_t, int32_t, void *, MidiEmit);
const void *np_readout_buffer(const NativeEngine *);
int32_t np_read(const void *, uint32_t);
}
