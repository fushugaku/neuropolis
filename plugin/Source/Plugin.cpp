#include "BinaryData.h"
#include "Native.h"
#include "Session.h"
#include <atomic>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <limits>
#include <memory>

using namespace juce;
using namespace neuropolis;
namespace {
struct Prepared {
    NativeEngine *engine = nullptr;
    const void *readouts = nullptr;
    int tracks = 0, capacity = 0;
    const void *configuration = nullptr;
    std::vector<Binding> bindings;
    std::array<Binding, automationLanes> lanes;
    uint64_t serial = 0;
    std::vector<uint32_t> removedTracks;
    bool reset = false;
    ~Prepared() {
        if (engine)
            np_destroy(engine);
    }
};
int value(const var &o, const char *key) { return static_cast<int>(o[key]); }
std::unique_ptr<Prepared> preparePatch(const var &p, bool reset) {
    const auto *tracks = p["tracks"].getArray();
    if (tracks == nullptr || tracks->isEmpty() || static_cast<int>(p["version"]) != 2)
        return {};
    auto result = std::make_unique<Prepared>();
    result->tracks = tracks->size();
    result->reset = reset;
    result->engine = np_create(static_cast<uint32_t>(result->tracks));
    bool valid = true;
    auto set = [&](uint32_t kind, int i, int n, int field, int v) {
        valid = np_set(result->engine, kind, static_cast<uint32_t>(i), static_cast<uint32_t>(n),
                       static_cast<uint32_t>(field), v) &&
                valid;
    };
    for (int i = 0; i < tracks->size(); ++i) {
        const auto &t = tracks->getReference(i);
        for (size_t f = 0; f < trackKeys.size(); ++f) {
            const auto raw = t[Identifier(trackKeys[f])];
            const int configured =
                raw.isVoid() && String(trackKeys[f]) == "accumulatorStages" ? 16 : static_cast<int>(raw);
            set(0, i, 0, static_cast<int>(f),
                f == 3 ? trackDivisionWire(static_cast<double>(raw)) : configured);
        }
        const auto *steps = t["steps"].getArray();
        if (!steps || steps->size() != 16)
            return {};
        for (int n = 0; n < 16; ++n)
            for (size_t f = 0; f < stepKeys.size(); ++f)
                set(1, i, n, static_cast<int>(f), value(steps->getReference(n), stepKeys[f]));
    }
    const auto *mods = p["mods"].getArray();
    if (!mods || mods->size() != 8)
        return {};
    for (int i = 0; i < 8; ++i) {
        const auto &m = mods->getReference(i);
        for (size_t f = 0; f < modKeys.size(); ++f)
            set(2, i, 0, static_cast<int>(f), value(m, modKeys[f]));
        const auto *steps = m["steps"].getArray();
        if (!steps || steps->size() != 16)
            return {};
        for (int n = 0; n < 16; ++n) {
            const auto &s = steps->getReference(n);
            set(3, i, n, 0, value(s, "value"));
            set(3, i, n, 1, value(s, "ramp"));
            set(3, i, n, 2, value(s, "gate"));
        }
    }
    const auto *scales = p["userScales"].getArray();
    if (!scales || scales->size() != 100)
        return {};
    for (int i = 0; i < 100; ++i) {
        const auto &s = scales->getReference(i);
        set(5, i + 49, 0, value(s, "root"), value(s, "mask"));
    }
    const char *routes[] = {"controls", "aux"};
    const char *routeKeys[] = {"destination", "target", "value", "amount"};
    for (int kind = 0; kind < 2; ++kind) {
        const auto *rs = p[routes[kind]].getArray();
        if (!rs || rs->size() != (kind == 0 ? 2 : 3))
            return {};
        for (int i = 0; i < rs->size(); ++i)
            for (int f = 0; f < 4; ++f)
                set(4, i, kind, f, value(rs->getReference(i), routeKeys[f]));
    }
    set(6, 0, 0, 0, static_cast<int>(static_cast<double>(p["tempo"]) * 1000.0));
    set(6, 0, 0, 1, value(p, "totalPulses"));
    set(6, 0, 0, 2, value(p["settings"], "outputDivision"));
    set(6, 0, 0, 3, value(p["settings"], "outputOffset"));
    set(6, 0, 0, 8, 1);
    set(6, 0, 0, 9, value(p["loopy"], "pulses"));
    set(6, 0, 0, 10, value(p["loopy"], "target"));
    const char *mx[] = {"mode", "source", "bank", "channel"};
    for (int f = 0; f < 4; ++f)
        set(6, 0, 0, f + 4, value(p["mx"], mx[f]));
    const auto *outputs = p["outputs"].getArray();
    if (!outputs || outputs->size() != 2)
        return {};
    for (int i = 0; i < 2; ++i)
        set(7, i, 0, value(outputs->getReference(i), "kind"), value(outputs->getReference(i), "source"));
    if (!valid)
        return {};
    set(6, 0, 0, 11, value(p["mx"], "message"));
    const char *settings[] = {"loadMode", "queuePulses", "pitchLoad", "switchLoad", "ctrlLoad", "auxLoad"};
    for (int f = 0; f < 6; ++f)
        set(13, 0, 0, f, value(p["settings"], settings[f]));
    if (!valid)
        return {};
    return result;
}
std::unique_ptr<Prepared> prepare(const var &session, bool reset) {
    auto result = preparePatch(session["patch"], reset);
    if (!result)
        return {};
    result->capacity = result->tracks;
    if (const auto *presets = session["presets"].getArray())
        for (int i = 0; i < jmin(64, presets->size()); ++i) {
            const auto &preset = presets->getReference(i);
            if (preset.isVoid())
                continue;
            auto bank = preparePatch(preset, false);
            if (!bank)
                return {};
            result->capacity = jmax(result->capacity, bank->tracks);
            np_preset(result->engine, static_cast<uint32_t>(i), bank->engine);
            bank->engine = nullptr;
        }
    if (const auto *chain = session["chain"].getArray())
        for (int i = 0; i < jmin(32, chain->size()); ++i) {
            const auto &link = chain->getReference(i);
            np_link(result->engine, static_cast<uint32_t>(value(link, "preset")),
                    static_cast<uint32_t>(value(link, "repeat")), static_cast<uint32_t>(value(link, "mute")));
            if (const auto *muted = link["mutedTracks"].getArray())
                for (const auto &track : *muted)
                    np_link_mute(result->engine, static_cast<uint32_t>(i),
                                 static_cast<uint32_t>(static_cast<int>(track)));
        }
    np_project(result->engine, value(session, "currentPreset"),
               static_cast<bool>(session["plugin"]["chainEnabled"]));
    np_seal(result->engine);
    result->readouts = np_readout_buffer(result->engine);
    result->configuration = np_config_buffer(result->engine);
    result->bindings = configBindings(result->capacity);
    if (const auto *lanes = session["plugin"]["automation"].getArray())
        for (int i = 0; i < jmin(automationLanes, lanes->size()); ++i)
            result->lanes[static_cast<size_t>(i)] =
                bindingFor(lanes->getReference(i).toString(), result->capacity);
    static std::atomic<uint64_t> next{0};
    result->serial = ++next;
    return result;
}
class HostParameter final : public AudioProcessorParameterWithID {
  public:
    HostParameter(const String &id, const String &title, int steps = 0)
        : AudioProcessorParameterWithID(ParameterID{id, 1}, title), discrete(steps) {}
    float getValue() const override { return normalized.load(std::memory_order_relaxed); }
    void setValue(float next) override {
        if (!std::isfinite(next))
            return;
        if (std::abs(normalized.exchange(jlimit(0.0f, 1.0f, next)) - jlimit(0.0f, 1.0f, next)) >
            std::numeric_limits<float>::epsilon())
            sequence.fetch_add(1, std::memory_order_release);
    }
    void fromModel(float next) { normalized.store(jlimit(0.0f, 1.0f, next)); }
    float getDefaultValue() const override { return 0.0f; }
    int getNumSteps() const override {
        return discrete > 0 ? discrete : AudioProcessor::getDefaultNumParameterSteps();
    }
    bool isDiscrete() const override { return discrete > 0; }
    bool isBoolean() const override { return discrete == 2; }
    String getText(float v, int maximum) const override {
        return String(v * static_cast<float>(discrete > 0 ? discrete - 1 : 100), discrete > 0 ? 0 : 1)
            .substring(0, maximum);
    }
    float getValueForText(const String &text) const override {
        return jlimit(0.0f, 1.0f,
                      text.getFloatValue() / static_cast<float>(discrete > 0 ? discrete - 1 : 100));
    }
    std::atomic<uint64_t> sequence{0};

  private:
    std::atomic<float> normalized{0};
    int discrete = 0;
};
} // namespace
class NeuropolisEditor;
class NeuropolisProcessor final : public AudioProcessor, private Timer {
  public:
    NeuropolisProcessor() : AudioProcessor(BusesProperties()) {
        auto add = [&](int i, const String &id, const String &title, int steps = 0) {
            auto *p = new HostParameter(id, title, steps);
            parameters[static_cast<size_t>(i)] = p;
            addParameter(p);
        };
        add(0, "reset_after", "Reset after", 1025);
        add(1, "preset", "Preset", 65);
        add(2, "chain", "Chain", 2);
        for (int i = 0; i < automationLanes; ++i)
            add(i + 3, "automation_" + String(i + 1).paddedLeft('0', 2),
                "Automation " + String(i + 1).paddedLeft('0', 2));
        session = JSON::parse(String::fromUTF8(BinaryData::initial_json, BinaryData::initial_jsonSize));
        ensurePluginState(session);
        auto prepared = prepare(session, true);
        jassert(prepared != nullptr);
        syncParameters(*prepared);
        current.store(prepared.release());
        startTimerHz(30);
    }
    ~NeuropolisProcessor() override {
        stopTimer();
        delete pending.exchange(nullptr);
        delete current.exchange(nullptr);
        collect();
    }
    const String getName() const override { return "neuropolis"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return true; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const String getProgramName(int) override { return {}; }
    void changeProgramName(int, const String &) override {}
    void prepareToPlay(double rate, int) override { sampleRate = rate; }
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout &layout) const override {
        return layout.inputBuses.isEmpty() && layout.outputBuses.isEmpty();
    }
    struct Command {
        uint32_t kind, index, stage, field;
        int32_t value;
    };
    void command(const var &event) {
        if (commandFifo.getFreeSpace() == 0)
            return;
        int a, b, c, d;
        commandFifo.prepareToWrite(1, a, b, c, d);
        commands[static_cast<size_t>(a)] = {
            static_cast<uint32_t>(value(event, "kind")), static_cast<uint32_t>(value(event, "index")),
            static_cast<uint32_t>(value(event, "stage")), static_cast<uint32_t>(value(event, "field")),
            value(event, "value")};
        commandFifo.finishedWrite(1);
    }
    void gesture(const var &event) {
        const ScopedLock lock(stateLock);
        auto *active = pending.load();
        if (!active)
            active = current.load();
        if (!active)
            return;
        const auto path = event["path"].toString(), phase = event["phase"].toString();
        for (size_t i = 0; i < parameters.size(); ++i) {
            const auto b = i == 0   ? bindingFor("totalPulses", active->capacity)
                           : i >= 3 ? active->lanes[i - 3]
                                    : Binding{};
            if (b.offset < 0 || b.path != path)
                continue;
            auto &parameter = *parameters[i];
            if (phase == "begin" && !gestures[i]) {
                parameter.beginChangeGesture();
                gestures[i] = true;
            }
            if (phase == "value") {
                const bool oneShot = !gestures[i];
                if (oneShot)
                    parameter.beginChangeGesture();
                parameter.setValueNotifyingHost(b.normalize(static_cast<double>(event["value"])));
                if (oneShot)
                    parameter.endChangeGesture();
            }
            if (phase == "end" && gestures[i]) {
                parameter.endChangeGesture();
                gestures[i] = false;
            }
        }
    }
    void endGestures() {
        for (size_t i = 0; i < parameters.size(); ++i)
            if (gestures[i]) {
                parameters[i]->endChangeGesture();
                gestures[i] = false;
            }
    }
    void processBlock(AudioBuffer<float> &audio, MidiBuffer &midi) override {
        ScopedNoDenormals noDenormals;
        audio.clear();
        auto *active = current.load(std::memory_order_acquire);
        if (retired.getFreeSpace() > 0)
            if (auto *next = pending.exchange(nullptr, std::memory_order_acq_rel)) {
                if (active) {
                    for (auto index : next->removedTracks)
                        np_delete_track(active->engine, index, &midi, emit);
                    np_adopt(next->engine, active->engine, next->reset, &midi, emit);
                }
                current.store(next, std::memory_order_release);
                if (active) {
                    int a, b, c, d;
                    retired.prepareToWrite(1, a, b, c, d);
                    retiredStates[static_cast<size_t>(a)] = active;
                    retired.finishedWrite(1);
                }
                active = next;
            }
        if (active) {
            for (size_t i = 0; i < parameters.size(); ++i) {
                auto &p = *parameters[i];
                const auto revision = p.sequence.load(std::memory_order_acquire);
                if (revision == applied[i].load())
                    continue;
                const auto v = p.getValue();
                if (i == 0)
                    np_set(active->engine, 6, 0, 0, 1, roundToInt(v * 1024.0f));
                else if (i == 1) {
                    const int slot = roundToInt(v * 64.0f) - 1;
                    if (slot >= 0)
                        np_command(active->engine, 15, 0, 0, 0, slot, &midi, emit);
                } else if (i == 2)
                    np_command(active->engine, 16, 0, 0, 0, v >= 0.5f ? 1 : 0, &midi, emit);
                else {
                    const auto &b = active->lanes[i - 3];
                    if (b.offset >= 0)
                        np_set(active->engine, b.kind, b.index, b.stage, b.field, b.denormalize(v));
                }
                applied[i].store(revision);
            }
            int a, b, c, d;
            commandFifo.prepareToRead(commandFifo.getNumReady(), a, b, c, d);
            auto apply = [&](int start, int count) {
                for (int n = 0; n < count; ++n) {
                    const auto &cmd = commands[static_cast<size_t>(start + n)];
                    np_command(active->engine, cmd.kind, cmd.index, cmd.stage, cmd.field, cmd.value, &midi,
                               emit);
                }
            };
            apply(a, b);
            apply(c, d);
            commandFifo.finishedRead(b + d);
        }
        double bpm = 120.0, beat = std::numeric_limits<double>::quiet_NaN();
        bool playing = false;
        if (auto *head = getPlayHead())
            if (auto position = head->getPosition()) {
                bpm = position->getBpm().orFallback(120.0);
                playing = position->getIsPlaying();
                if (auto ppq = position->getPpqPosition())
                    beat = *ppq;
            }
        if (active)
            np_process(active->engine, static_cast<uint32_t>(audio.getNumSamples()), sampleRate, bpm, beat,
                       playing, &midi, emit);
    }
    void getStateInformation(MemoryBlock &dest) override {
        const ScopedLock lock(stateLock);
        mirror();
        auto json = JSON::toString(session, true);
        dest.replaceAll(json.toRawUTF8(), json.getNumBytesAsUTF8());
    }
    void setStateInformation(const void *data, int size) override {
        if (size <= 0)
            return;
        if (update(JSON::parse(String::fromUTF8(static_cast<const char *>(data), size)), true))
            stateVersion.fetch_add(1);
    }
    bool hasEditor() const override { return true; }
    AudioProcessorEditor *createEditor() override;
    String state() {
        const ScopedLock lock(stateLock);
        mirror();
        return JSON::toString(session, true);
    }
    bool update(var next, bool reset, const var &removed = {}) {
        ensurePluginState(next);
        auto prepared = prepare(next, reset);
        if (!prepared)
            return false;
        if (const auto *indices = removed.getArray())
            for (const auto &index : *indices)
                prepared->removedTracks.push_back(static_cast<uint32_t>(static_cast<int>(index)));
        {
            const ScopedLock lock(stateLock);
            session = next;
            syncParameters(*prepared);
            auto *replaced = pending.exchange(nullptr, std::memory_order_acq_rel);
            if (replaced) {
                prepared->removedTracks.insert(prepared->removedTracks.begin(),
                                               replaced->removedTracks.begin(),
                                               replaced->removedTracks.end());
                delete replaced;
            }
            pending.store(prepared.release(), std::memory_order_release);
        }
        updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
        return true;
    }
    var frame() {
        const ScopedLock lock(stateLock);
        mirror();
        auto *active = current.load(std::memory_order_acquire);
        if (!active)
            return {};
        auto read = [&](int i) { return np_read(active->readouts, static_cast<uint32_t>(i)); };
        const int count = read(8);
        Array<var> tracks, mods, outputs;
        for (int i = 0; i < jmin(count, active->capacity); ++i) {
            const int base = readoutHeader + i * 10;
            tracks.add(object({{"stage", read(base)},
                               {"note", read(base + 1)},
                               {"cents", read(base + 2)},
                               {"cv", read(base + 3)},
                               {"velocity", read(base + 4)},
                               {"gate", read(base + 5) != 0},
                               {"accumulator", read(base + 6)},
                               {"loopy", read(base + 7) != 0}}));
        }
        for (int i = 0; i < 8; ++i) {
            int base = readoutHeader + active->capacity * 10 + i * 2;
            mods.add(object({{"stage", read(base)}, {"value", read(base + 1)}}));
        }
        outputs.add(read(1));
        outputs.add(read(2));
        auto edits = changes;
        changes.clear();
        return object({{"bpm", read(0) / 1000.0},
                       {"playing", read(6) != 0},
                       {"cycleTicks", read(7)},
                       {"ticks", read(15)},
                       {"tracks", tracks},
                       {"mods", mods},
                       {"outputs", outputs},
                       {"mx", read(3)},
                       {"clock", read(4) != 0},
                       {"chainEnabled", read(10) != 0},
                       {"chainIndex", read(11)},
                       {"chainRepeat", read(12)},
                       {"queued", read(13)},
                       {"currentPreset", read(9)},
                       {"changes", edits}});
    }
    std::atomic<unsigned> stateVersion{0};

  private:
    static void ensurePluginState(var root) {
        if (!root.getDynamicObject())
            return;
        if (!root["plugin"].getDynamicObject())
            root.getDynamicObject()->setProperty(
                "plugin", object({{"chainEnabled", false}, {"automation", Array<var>{}}}));
        auto state = root["plugin"];
        if (!state["automation"].isArray())
            state.getDynamicObject()->setProperty("automation", Array<var>{});
        const auto upgradePatch = [](var patch) {
            if (const auto *tracks = patch["tracks"].getArray())
                for (const auto &track : *tracks)
                    if (auto *data = track.getDynamicObject())
                        if (!data->hasProperty("accumulatorStages"))
                            data->setProperty("accumulatorStages", 16);
        };
        upgradePatch(root["patch"]);
        if (const auto *presets = root["presets"].getArray())
            for (const auto &patch : *presets)
                upgradePatch(patch);
    }
    void syncParameters(const Prepared &active) {
        if (parameters[0]->sequence.load() == applied[0].load())
            parameters[0]->fromModel(static_cast<float>(value(session["patch"], "totalPulses")) / 1024.0f);
        if (parameters[1]->sequence.load() == applied[1].load())
            parameters[1]->fromModel(static_cast<float>(value(session, "currentPreset") + 1) / 64.0f);
        if (parameters[2]->sequence.load() == applied[2].load())
            parameters[2]->fromModel(static_cast<bool>(session["plugin"]["chainEnabled"]) ? 1.0f : 0.0f);
        for (size_t i = 0; i < active.lanes.size(); ++i) {
            const auto &b = active.lanes[i];
            if (parameters[i + 3]->sequence.load() == applied[i + 3].load())
                parameters[i + 3]->fromModel(
                    b.offset >= 0 ? b.normalize(static_cast<double>(readPath(session["patch"], b.path)))
                                  : 0.0f);
        }
    }
    void mirror() {
        auto *active = current.load(std::memory_order_acquire);
        if (!active || pending.load() != nullptr)
            return;
        auto read = [&](int i) { return np_read(active->configuration, static_cast<uint32_t>(i)); };
        const bool chain = np_read(active->readouts, 10) != 0;
        session["plugin"].getDynamicObject()->setProperty("chainEnabled", chain);
        if (parameters[2]->sequence.load() == applied[2].load())
            parameters[2]->fromModel(chain ? 1.0f : 0.0f);
        const int revision = read(0);
        if ((revision & 1) != 0 || (seenSerial == active->serial && seenRevision == revision))
            return;
        std::vector<int> snapshot(static_cast<size_t>(trackBase + active->capacity * trackStride + 4));
        for (size_t i = 0; i < snapshot.size(); ++i)
            snapshot[i] = read(static_cast<int>(i));
        if (read(0) != revision)
            return;
        seenSerial = active->serial;
        seenRevision = revision;
        const int count = snapshot[1], slot = snapshot[2], recall = snapshot[3];
        const bool recalled = recall != seenRecall || value(session, "currentPreset") != slot;
        seenRecall = recall;
        if (recalled && isPositiveAndBelow(slot, 64)) {
            if (const auto *presets = session["presets"].getArray())
                if (isPositiveAndBelow(slot, presets->size()) && !presets->getReference(slot).isVoid()) {
                    auto patch = clone(presets->getReference(slot));
                    const auto previous = session["patch"];
                    patch.getDynamicObject()->setProperty("settings", clone(previous["settings"]));
                    patch.getDynamicObject()->setProperty("userScales", clone(previous["userScales"]));
                    patch.getDynamicObject()->setProperty("tempo", previous["tempo"]);
                    session.getDynamicObject()->setProperty("patch", patch);
                }
        }
        session.getDynamicObject()->setProperty("currentPreset", slot);
        const auto patch = session["patch"];
        for (const auto &binding : active->bindings) {
            if (binding.kind <= 1 && static_cast<int>(binding.index) >= count)
                continue;
            const auto old = readPath(patch, binding.path);
            if (old.isVoid())
                continue;
            const int next = snapshot[static_cast<size_t>(binding.offset + 4)];
            if (binding.engineValue(static_cast<double>(old)) == next)
                continue;
            const var typed = binding.isClockDivision() ? var(binding.modelValue(next))
                              : old.isBool()            ? var(next != 0)
                                                        : var(next);
            if (writePath(patch, binding.path, typed))
                changes.add(object({{"path", binding.path}, {"value", typed}}));
        }
        // Reflect native changes in host readouts without recording another gesture.
        for (size_t i = 0; i < parameters.size(); ++i)
            if (parameters[i]->sequence.load() == applied[i].load()) {
                if (i == 0)
                    parameters[i]->fromModel(static_cast<float>(snapshot[5]) / 1024.0f);
                else if (i == 1)
                    parameters[i]->fromModel(static_cast<float>(slot + 1) / 64.0f);
                else if (i >= 3) {
                    const auto &b = active->lanes[i - 3];
                    if (b.offset >= 0)
                        parameters[i]->fromModel(
                            b.normalizeWire(snapshot[static_cast<size_t>(b.offset + 4)]));
                }
            }
        if (recalled) {
            changes.clear();
            stateVersion.fetch_add(1);
        }
    }
    static void emit(void *context, uint32_t offset, uint8_t status, uint8_t a, uint8_t b) {
        uint8_t bytes[] = {status, a, b};
        static_cast<MidiBuffer *>(context)->addEvent(bytes, 3, static_cast<int>(offset));
    }
    void collect() {
        int a, b, c, d;
        retired.prepareToRead(retired.getNumReady(), a, b, c, d);
        for (int i = 0; i < b; ++i)
            delete retiredStates[static_cast<size_t>(a + i)];
        for (int i = 0; i < d; ++i)
            delete retiredStates[static_cast<size_t>(c + i)];
        retired.finishedRead(b + d);
    }
    void timerCallback() override {
        const ScopedLock lock(stateLock);
        mirror();
        collect();
    }
    CriticalSection stateLock;
    var session;
    Array<var> changes;
    std::atomic<Prepared *> pending{nullptr}, current{nullptr};
    std::array<HostParameter *, automationLanes + 3> parameters{};
    std::array<std::atomic<uint64_t>, automationLanes + 3> applied{};
    std::array<bool, automationLanes + 3> gestures{};
    uint64_t seenSerial = 0;
    int seenRevision = -1, seenRecall = 0;
    AbstractFifo commandFifo{512};
    std::array<Command, 512> commands{};
    AbstractFifo retired{64};
    std::array<Prepared *, 64> retiredStates{};
    double sampleRate = 44100.0;
};
class PluginBrowser final : public WebBrowserComponent {
  public:
    using WebBrowserComponent::WebBrowserComponent;
    bool pageAboutToLoad(const String &url) override {
        return url.startsWith(getResourceProviderRoot()) || url == "about:blank";
    }
};
class NeuropolisEditor final : public AudioProcessorEditor, private Timer {
  public:
    explicit NeuropolisEditor(NeuropolisProcessor &p)
        : AudioProcessorEditor(p), unit(p), browser(options()), version(p.stateVersion.load()) {
        setResizable(true, true);
        setResizeLimits(390, 540, 1760, 1400);
        setSize(1200, 820);
        addAndMakeVisible(browser);
        browser.goToURL(WebBrowserComponent::getResourceProviderRoot());
        startTimerHz(30);
    }
    ~NeuropolisEditor() override {
        stopTimer();
        unit.endGestures();
    }
    void resized() override { browser.setBounds(getLocalBounds()); }

  private:
    WebBrowserComponent::Options options() {
        return WebBrowserComponent::Options()
            .withNativeIntegrationEnabled()
            .withKeepPageLoadedWhenBrowserIsHidden()
            .withInitialisationData("neuropolisSession", unit.state())
            .withUserScript("window.__NEUROPOLIS_PLUGIN__ = true;")
            .withResourceProvider([](const String &url) -> std::optional<WebBrowserComponent::Resource> {
                auto name =
                    url.upToFirstOccurrenceOf("?", false, false).fromLastOccurrenceOf("/", false, false);
                if (name.isEmpty())
                    name = "index.html";
                for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
                    if (name == BinaryData::originalFilenames[i]) {
                        int size = 0;
                        const char *data =
                            BinaryData::getNamedResource(BinaryData::namedResourceList[i], size);
                        auto ext = name.fromLastOccurrenceOf(".", false, false);
                        const auto mime = ext == "html"   ? "text/html"
                                          : ext == "js"   ? "text/javascript"
                                          : ext == "css"  ? "text/css"
                                          : ext == "json" ? "application/json"
                                                          : "application/wasm";
                        return WebBrowserComponent::Resource{
                            std::vector<std::byte>(reinterpret_cast<const std::byte *>(data),
                                                   reinterpret_cast<const std::byte *>(data) + size),
                            mime};
                    }
                return std::nullopt;
            })
            .withEventListener("neuropolisState",
                               [this](const var &event) {
                                   unit.update(JSON::parse(event["session"].toString()),
                                               static_cast<bool>(event["reset"]), event["removedTracks"]);
                               })
            .withEventListener("neuropolisGesture", [this](const var &event) { unit.gesture(event); })
            .withEventListener("neuropolisCommand", [this](const var &event) { unit.command(event); })
            .withEventListener("neuropolisFile", [this](const var &event) { file(event); });
    }
    void file(const var &event) {
        MemoryOutputStream decoded;
        if (!Base64::convertFromBase64(decoded, event["data"].toString()))
            return;
        const auto bytes = decoded.getMemoryBlock();
        const auto name = File::createLegalFileName(event["name"].toString());
        chooser = std::make_unique<FileChooser>(
            "Save " + name, File::getSpecialLocation(File::userDocumentsDirectory).getChildFile(name), "*");
        Component::SafePointer<NeuropolisEditor> safe(this);
        chooser->launchAsync(FileBrowserComponent::saveMode | FileBrowserComponent::canSelectFiles |
                                 FileBrowserComponent::warnAboutOverwriting,
                             [safe, bytes](const FileChooser &choice) {
                                 if (!safe)
                                     return;
                                 auto target = choice.getResult();
                                 if (target != File())
                                     target.replaceWithData(bytes.getData(), bytes.getSize());
                             });
    }
    void timerCallback() override {
        const auto current = unit.stateVersion.load();
        if (current != version) {
            version = current;
            browser.emitEventIfBrowserIsVisible("neuropolisRestore", unit.state());
        }
        browser.emitEventIfBrowserIsVisible("neuropolisFrame", unit.frame());
    }
    NeuropolisProcessor &unit;
    PluginBrowser browser;
    unsigned version = 0;
    std::unique_ptr<FileChooser> chooser;
};
AudioProcessorEditor *NeuropolisProcessor::createEditor() { return new NeuropolisEditor(*this); }
AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new NeuropolisProcessor(); }
