#pragma once
#include "Model.h"
#include "Native.h"
#include <array>
#include <juce_audio_utils/juce_audio_utils.h>
#include <vector>

namespace neuropolis {
using namespace juce;
constexpr int readoutHeader = 24, trackBase = 768, automationLanes = 32;
constexpr int trackFields = static_cast<int>(trackKeys.size());
constexpr int trackStride = trackFields + 16 * static_cast<int>(stepKeys.size());
inline int trackDivisionWire(double division) {
    if (std::abs(division - 0.5) < 1.0e-9)
        return 65;
    if (std::abs(division - 0.25) < 1.0e-9)
        return 66;
    return roundToInt(division);
}
inline double trackDivisionValue(int wire) {
    return wire == 65 ? 0.5 : wire == 66 ? 0.25 : static_cast<double>(wire);
}
inline int integer(const var &o, const char *key) { return static_cast<int>(o[key]); }
inline var clone(const var &o) { return JSON::parse(JSON::toString(o, true)); }
inline var object(std::initializer_list<std::pair<Identifier, var>> properties) {
    auto *result = new DynamicObject();
    for (const auto &[key, value] : properties)
        result->setProperty(key, value);
    return result;
}
inline var readPath(var root, const String &path) {
    for (const auto &key : StringArray::fromTokens(path, ".", "")) {
        if (const auto *array = root.getArray()) {
            const int index = key.getIntValue();
            if (!isPositiveAndBelow(index, array->size()))
                return {};
            root = array->getReference(index);
        } else
            root = root[Identifier(key)];
    }
    return root;
}
inline bool writePath(var root, const String &path, const var &value) {
    auto keys = StringArray::fromTokens(path, ".", "");
    if (keys.isEmpty())
        return false;
    const auto key = keys[keys.size() - 1];
    keys.remove(keys.size() - 1);
    for (const auto &part : keys) {
        if (const auto *array = root.getArray()) {
            const int index = part.getIntValue();
            if (!isPositiveAndBelow(index, array->size()))
                return false;
            root = array->getReference(index);
        } else
            root = root[Identifier(part)];
    }
    if (auto *obj = root.getDynamicObject()) {
        obj->setProperty(key, value);
        return true;
    }
    return false;
}
struct Binding {
    String path;
    uint32_t kind = 0, index = 0, stage = 0, field = 0;
    int offset = -1, low = 0, high = 1;
    bool isClockDivision() const { return kind == 0 && field == 3; }
    int engineValue(double value) const {
        return isClockDivision() ? trackDivisionWire(value) : roundToInt(value);
    }
    double modelValue(int value) const {
        return isClockDivision() ? trackDivisionValue(value) : static_cast<double>(value);
    }
    int denormalize(float value) const {
        if (isClockDivision()) {
            const int index = roundToInt(jlimit(0.0f, 1.0f, value) * 65.0f);
            return index == 0 ? 66 : index == 1 ? 65 : index - 1;
        }
        return roundToInt(static_cast<double>(low) +
                          jlimit(0.0f, 1.0f, value) * static_cast<double>(high - low));
    }
    float normalize(double model) const {
        const int value = engineValue(model);
        if (isClockDivision()) {
            const int index = value == 66 ? 0 : value == 65 ? 1 : value + 1;
            return jlimit(0.0f, 1.0f, static_cast<float>(index) / 65.0f);
        }
        return jlimit(0.0f, 1.0f, static_cast<float>(value - low) / static_cast<float>(jmax(1, high - low)));
    }
    float normalizeWire(int value) const { return normalize(modelValue(value)); }
};
template <size_t N> int keyIndex(const String &key, const std::array<const char *, N> &keys) {
    for (size_t i = 0; i < N; ++i)
        if (key == keys[i])
            return static_cast<int>(i);
    return -1;
}
inline Binding bindingFor(const String &path, int tracks) {
    Binding b;
    b.path = path;
    const auto p = StringArray::fromTokens(path, ".", "");
    auto assign = [&](uint32_t kind, int index, int stage, int field, int offset, std::array<int, 2> range) {
        b.kind = kind;
        b.index = static_cast<uint32_t>(index);
        b.stage = static_cast<uint32_t>(stage);
        b.field = static_cast<uint32_t>(field);
        b.offset = offset;
        b.low = range[0];
        b.high = range[1];
    };
    if (p.size() == 3 || p.size() == 5) {
        const int i = p[1].getIntValue();
        if (p[0] == "tracks" && isPositiveAndBelow(i, tracks)) {
            if (p.size() == 3) {
                const int f = keyIndex(p[2], trackKeys);
                if (f >= 0)
                    assign(0, i, 0, f, trackBase + i * trackStride + f, trackRanges[static_cast<size_t>(f)]);
            } else if (p[2] == "steps") {
                const int n = p[3].getIntValue(), f = keyIndex(p[4], stepKeys);
                if (isPositiveAndBelow(n, 16) && f >= 0)
                    assign(1, i, n, f, trackBase + i * trackStride + trackFields + n * 15 + f,
                           stepRanges[static_cast<size_t>(f)]);
            }
        } else if (p[0] == "mods" && isPositiveAndBelow(i, 8)) {
            if (p.size() == 3) {
                const int f = keyIndex(p[2], modKeys);
                if (f >= 0)
                    assign(2, i, 0, f, 64 + i * 60 + f,
                           f == 8 ? std::array<int, 2>{0, jmax(2, tracks)}
                                  : modRanges[static_cast<size_t>(f)]);
            } else if (p[2] == "steps") {
                const int n = p[3].getIntValue(),
                          f = keyIndex(p[4], std::array<const char *, 3>{"value", "ramp", "gate"});
                if (isPositiveAndBelow(n, 16) && f >= 0)
                    assign(3, i, n, f, 64 + i * 60 + 12 + n * 3 + f,
                           f == 0 ? std::array<int, 2>{-5000, 5000} : std::array<int, 2>{0, 1});
            }
        } else if ((p[0] == "controls" || p[0] == "aux") && p.size() == 3 &&
                   isPositiveAndBelow(i, p[0] == "controls" ? 2 : 3)) {
            const int n = p[0] == "controls" ? 0 : 1,
                      f = keyIndex(p[2],
                                   std::array<const char *, 4>{"destination", "target", "value", "amount"});
            if (f >= 0) {
                const std::array<std::array<int, 2>, 4> ranges = {
                    {{0, 39}, {0, jmax(2, tracks)}, {-5000, 5000}, {-100, 100}}};
                assign(4, i, n, f, 544 + (i + n * 2) * 4 + f, ranges[static_cast<size_t>(f)]);
            }
        } else if (p[0] == "outputs" && p.size() == 3 && isPositiveAndBelow(i, 2)) {
            if (p[2] == "kind")
                assign(20, i, 0, 0, 564 + i * 2, {0, 18});
            if (p[2] == "source")
                assign(21, i, 0, 0, 565 + i * 2, {0, jmax(7, tracks - 1)});
        } else if (p[0] == "userScales" && p.size() == 3 && isPositiveAndBelow(i, 100)) {
            if (p[2] == "mask")
                assign(18, i, 0, 0, 568 + i * 2, {0, 4095});
            if (p[2] == "root")
                assign(19, i, 0, 0, 569 + i * 2, {0, 11});
        }
    }
    if (path == "totalPulses")
        assign(6, 0, 0, 1, 1, {0, 1024});
    const std::array<const char *, 12> globals = {"",
                                                  "totalPulses",
                                                  "settings.outputDivision",
                                                  "settings.outputOffset",
                                                  "mx.mode",
                                                  "mx.source",
                                                  "mx.bank",
                                                  "mx.channel",
                                                  "",
                                                  "loopy.pulses",
                                                  "loopy.target",
                                                  "mx.message"};
    const std::array<std::array<int, 2>, 12> ranges = {{{0, 0},
                                                        {0, 1024},
                                                        {1, 256},
                                                        {0, 255},
                                                        {0, 8},
                                                        {0, jmax(7, tracks - 1)},
                                                        {0, 1},
                                                        {0, 16},
                                                        {0, 0},
                                                        {0, 64},
                                                        {0, jmax(2, tracks)},
                                                        {0, 1}}};
    for (size_t f = 1; f < globals.size(); ++f)
        if (String(globals[f]).isNotEmpty() && path == globals[f])
            assign(6, 0, 0, static_cast<int>(f), static_cast<int>(f), ranges[f]);
    const std::array<const char *, 6> settings = {"loadMode",   "queuePulses", "pitchLoad",
                                                  "switchLoad", "ctrlLoad",    "auxLoad"};
    for (size_t f = 0; f < settings.size(); ++f)
        if (path == "settings." + String(settings[f]))
            assign(13, 0, 0, static_cast<int>(f), 16 + static_cast<int>(f),
                   {0, std::array<int, 6>{2, 4096, 2, 1, 3, 1}[f]});
    return b;
}
inline std::vector<Binding> configBindings(int tracks) {
    std::vector<Binding> out;
    auto add = [&](const String &path) {
        auto b = bindingFor(path, tracks);
        if (b.offset >= 0)
            out.push_back(b);
    };
    for (int i = 0; i < tracks; ++i) {
        const auto base = "tracks." + String(i) + ".";
        for (const auto *key : trackKeys)
            add(base + key);
        for (int n = 0; n < 16; ++n)
            for (const auto *key : stepKeys)
                add(base + "steps." + String(n) + "." + key);
    }
    for (int i = 0; i < 8; ++i) {
        const auto base = "mods." + String(i) + ".";
        for (const auto *key : modKeys)
            add(base + key);
        for (int n = 0; n < 16; ++n)
            for (const auto *key : {"value", "ramp", "gate"})
                add(base + "steps." + String(n) + "." + key);
    }
    for (const auto *name : {"controls", "aux"})
        for (int i = 0; i < (String(name) == "controls" ? 2 : 3); ++i)
            for (const auto *key : {"destination", "target", "value", "amount"})
                add(String(name) + "." + String(i) + "." + key);
    for (int i = 0; i < 2; ++i)
        for (const auto *key : {"kind", "source"})
            add("outputs." + String(i) + "." + key);
    for (int i = 0; i < 100; ++i)
        for (const auto *key : {"mask", "root"})
            add("userScales." + String(i) + "." + key);
    for (const auto *path :
         {"totalPulses", "settings.outputDivision", "settings.outputOffset", "mx.mode", "mx.source",
          "mx.bank", "mx.channel", "mx.message", "loopy.pulses", "loopy.target", "settings.loadMode",
          "settings.queuePulses", "settings.pitchLoad", "settings.switchLoad", "settings.ctrlLoad",
          "settings.auxLoad"})
        add(path);
    return out;
}
} // namespace neuropolis
