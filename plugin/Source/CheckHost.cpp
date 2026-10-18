#include "Session.h"
#include <AudioUnit/AudioUnit.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreMIDI/CoreMIDI.h>
#include <cstdio>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>
using namespace neuropolis;
using namespace juce;
class CheckHost final : public JUCEApplication {
  public:
    const String getApplicationName() override { return "Neuropolis Check"; }
    const String getApplicationVersion() override { return "0.2.0"; }
    bool moreThanOneInstanceAllowed() override { return false; }
    class Clock final : public AudioPlayHead {
      public:
        int64_t samples = 0;
        double bpm = 123;
        bool playing = true;
        Optional<PositionInfo> getPosition() const override {
            PositionInfo p;
            p.setBpm(bpm);
            p.setPpqPosition(samples * bpm / (48000.0 * 60.0));
            p.setTimeInSamples(samples);
            p.setIsPlaying(playing);
            p.setTimeSignature(TimeSignature{4, 4});
            return p;
        }
    };
    class Window final : public DocumentWindow, private Timer {
      public:
        Window()
            : DocumentWindow("neuropolis - AU validation host", Colour(0xff151618),
                             DocumentWindow::allButtons) {
            AudioPluginFormatManager formats;
            addDefaultFormatsToManager(formats);
            OwnedArray<PluginDescription> descriptions;
            auto file = File::getSpecialLocation(File::userHomeDirectory)
                            .getChildFile("Library/Audio/Plug-Ins/Components/neuropolis.component");
            for (int i = 0; i < formats.getNumFormats(); ++i)
                formats.getFormat(i)->findAllTypesForFile(descriptions, file.getFullPathName());
            if (descriptions.isEmpty()) {
                std::fprintf(stderr, "No installed AU description\n");
                JUCEApplication::getInstance()->quit();
                return;
            }
            String error;
            plugin = formats.createPluginInstance(*descriptions[0], 48000, 480, error);
            if (!plugin) {
                std::fprintf(stderr, "AU create error: %s\n", error.toRawUTF8());
                JUCEApplication::getInstance()->quit();
                return;
            }
            plugin->setPlayHead(&clock);
            plugin->setRateAndBufferSizeDetails(48000, 480);
            plugin->prepareToPlay(48000, 480);
            if (auto *client = plugin->getAudioUnitClient()) {
                AUMIDIOutputCallbackStruct callback{rawMidi, this};
                rawCallback =
                    AudioUnitSetProperty(client->getAudioUnitHandle(), kAudioUnitProperty_MIDIOutputCallback,
                                         kAudioUnitScope_Global, 0, &callback, sizeof(callback)) == noErr;
            }
            runChecks();
            setUsingNativeTitleBar(true);
            setResizable(true, false);
            setContentOwned(plugin->createEditorAndMakeActive(), true);
            centreWithSize(getWidth(), getHeight());
            setVisible(true);
            startTimer(10);
            MemoryBlock inspected;
            plugin->getStateInformation(inspected);
            File(File(NEUROPOLIS_CHECK_LOG).getParentDirectory().getChildFile("plugin-au-state.plist"))
                .replaceWithData(inspected.getData(), inspected.getSize());
            std::fprintf(stdout, "AU loaded; host BPM 123; rendering 480-frame blocks at 48 kHz\n");
            std::fflush(stdout);
        }
        ~Window() override {
            stopTimer();
            clearContentComponent();
            if (plugin) {
                clock.playing = false;
                auto finalMidi = process(480);
                for (auto event : finalMidi) {
                    auto message = event.getMessage();
                    if (message.isNoteOn())
                        ++ons;
                    if (message.isNoteOff())
                        ++offs;
                }
                MemoryBlock saved, restored;
                plugin->getStateInformation(saved);
                plugin->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
                plugin->getStateInformation(restored);
                std::fprintf(stdout, "Project state round-trip: %s (%zu bytes)\n",
                             saved == restored ? "PASS" : "FAIL", saved.getSize());
                plugin->releaseResources();
            }
            std::fprintf(stdout, "MIDI note-ons=%d note-offs=%d, buffers=%d\n", ons, offs, blocks);
            std::fflush(stdout);
        }
        void closeButtonPressed() override { JUCEApplication::getInstance()->systemRequestedQuit(); }

      private:
        var sessionState() {
            MemoryBlock block;
            plugin->getStateInformation(block);
            auto data = CFDataCreate(kCFAllocatorDefault, static_cast<const UInt8 *>(block.getData()),
                                     static_cast<CFIndex>(block.getSize()));
            auto list = CFPropertyListCreateWithData(kCFAllocatorDefault, data, kCFPropertyListImmutable,
                                                     nullptr, nullptr);
            CFRelease(data);
            var result;
            if (list && CFGetTypeID(list) == CFDictionaryGetTypeID()) {
                auto bytes = static_cast<CFDataRef>(
                    CFDictionaryGetValue(static_cast<CFDictionaryRef>(list), CFSTR("jucePluginState")));
                if (bytes)
                    result =
                        JSON::parse(String::fromUTF8(reinterpret_cast<const char *>(CFDataGetBytePtr(bytes)),
                                                     static_cast<int>(CFDataGetLength(bytes))));
            }
            if (list)
                CFRelease(list);
            return result;
        }
        void restoreSession(const var &session) {
            MemoryBlock block;
            plugin->getStateInformation(block);
            auto data = CFDataCreate(kCFAllocatorDefault, static_cast<const UInt8 *>(block.getData()),
                                     static_cast<CFIndex>(block.getSize()));
            auto list = CFPropertyListCreateWithData(
                kCFAllocatorDefault, data, kCFPropertyListMutableContainersAndLeaves, nullptr, nullptr);
            CFRelease(data);
            const auto json = JSON::toString(session, true);
            auto bytes = CFDataCreate(kCFAllocatorDefault, reinterpret_cast<const UInt8 *>(json.toRawUTF8()),
                                      static_cast<CFIndex>(json.getNumBytesAsUTF8()));
            CFDictionarySetValue(const_cast<CFMutableDictionaryRef>(static_cast<CFDictionaryRef>(list)),
                                 CFSTR("jucePluginState"), bytes);
            CFRelease(bytes);
            auto saved = CFPropertyListCreateData(kCFAllocatorDefault, list, kCFPropertyListBinaryFormat_v1_0,
                                                  0, nullptr);
            CFRelease(list);
            plugin->setStateInformation(CFDataGetBytePtr(saved), static_cast<int>(CFDataGetLength(saved)));
            CFRelease(saved);
            clock.playing = false;
            process(480);
            clock.samples = 0;
        }
        friend class juce::MidiDataConcatenator;
        void handleIncomingMidiMessage(void *, const MidiMessage &message) {
            rawOutput.addEvent(message, roundToInt(message.getTimeStamp()));
        }
        void handlePartialSysexMessage(void *, const uint8 *, int, double) {}
        static OSStatus rawMidi(void *context, const AudioTimeStamp *, UInt32,
                                const MIDIPacketList *packets) {
            auto &self = *static_cast<Window *>(context);
            const auto *packet = &packets->packet[0];
            for (UInt32 i = 0; i < packets->numPackets; ++i) {
                self.midiParser.pushMidiData(packet->data, static_cast<int>(packet->length),
                                             static_cast<double>(packet->timeStamp),
                                             static_cast<void *>(nullptr), self);
                packet = MIDIPacketNext(packet);
            }
            return noErr;
        }
        MidiBuffer process(int frames) {
            rawOutput.clear();
            juce::AudioBuffer<float> audio(2, frames);
            audio.clear();
            MidiBuffer midi;
            plugin->processBlock(audio, midi);
            clock.samples += frames;
            return rawCallback ? rawOutput : midi;
        }
        AudioProcessorParameter *parameter(const String &name) {
            for (auto *p : plugin->getParameters())
                if (p->getName(80) == name)
                    return p;
            return nullptr;
        }
        void runChecks() {
            const auto original = sessionState();
            int failures = 0;
            auto check = [&](const char *title, bool okay) {
                std::fprintf(stdout, "AU CHECK %s: %s\n", title, okay ? "PASS" : "FAIL");
                if (!okay)
                    ++failures;
            };
            check("35 stable host parameters", plugin->getParameters().size() == 35 &&
                                                   parameter("Reset after") && parameter("Automation 32"));
            auto session = clone(original);
            auto patch = session["patch"];
            auto *tracks = patch["tracks"].getArray();
            tracks->resize(1);
            auto track = tracks->getReference(0);
            track.getDynamicObject()->setProperty("division", 1);
            track.getDynamicObject()->setProperty("length", 1);
            track.getDynamicObject()->setProperty("mute", 0);
            track.getDynamicObject()->setProperty("midiChannel", 1);
            for (auto &step : *track["steps"].getArray()) {
                step.getDynamicObject()->setProperty("pitchOverride", 60);
                step.getDynamicObject()->setProperty("pulses", 1);
                step.getDynamicObject()->setProperty("ratchet", 1);
                step.getDynamicObject()->setProperty("gate", 2);
            }
            patch.getDynamicObject()->setProperty("totalPulses", 2);
            auto settings = patch["settings"];
            settings.getDynamicObject()->setProperty("loadMode", 2);
            for (auto &lane : *patch["mods"].getArray())
                lane.getDynamicObject()->setProperty("destination", 0);
            auto *presets = session["presets"].getArray();
            auto first = clone(patch), second = clone(patch);
            first.getDynamicObject()->setProperty("totalPulses", 1);
            second.getDynamicObject()->setProperty("totalPulses", 2);
            for (auto &step : *second["tracks"].getArray()->getReference(0)["steps"].getArray())
                step.getDynamicObject()->setProperty("pitchOverride", 72);
            presets->getReference(0) = first;
            presets->getReference(1) = second;
            session.getDynamicObject()->setProperty("currentPreset", 0);
            session["plugin"].getDynamicObject()->setProperty("automation",
                                                              Array<var>{"tracks.0.steps.0.pitchOverride"});
            restoreSession(session);
            if (auto *lane = parameter("Automation 01"))
                lane->setValueNotifyingHost(85.0f / 128.0f);
            clock.playing = true;
            auto automated = process(480);
            bool heard = false;
            for (auto e : automated)
                heard |= e.getMessage().isNoteOn() && e.getMessage().getNoteNumber() == 84;
            check("host automation affects native MIDI with editor closed", heard);
            auto automatedState = sessionState();
            check("automation saved into project pattern",
                  static_cast<int>(automatedState["patch"]["tracks"]
                                       .getArray()
                                       ->getReference(0)["steps"]
                                       .getArray()
                                       ->getReference(0)["pitchOverride"]) == 84);
            if (auto *reset = parameter("Reset after"))
                reset->setValueNotifyingHost(7.0f / 1024.0f);
            process(480);
            check("global reset automation", static_cast<int>(sessionState()["patch"]["totalPulses"]) == 7);
            clock.playing = false;
            auto released = process(480);
            bool off = false;
            for (auto e : released)
                off |= e.getMessage().isNoteOff();
            check("stop releases generated note", off);
            restoreSession(session);
            clock.playing = true;
            process(480);
            if (auto *preset = parameter("Preset"))
                preset->setValueNotifyingHost(2.0f / 64.0f);
            int firstNew = -1;
            for (int i = 0; i < 30; ++i) {
                const auto start = clock.samples;
                auto midi = process(480);
                for (auto e : midi)
                    if (e.getMessage().isNoteOn() && e.getMessage().getNoteNumber() == 72 && firstNew < 0)
                        firstNew = static_cast<int>(start) + e.samplePosition;
            }
            std::fprintf(stdout, "Queued first-new=%d expected=%d\n", firstNew,
                         roundToInt(48000.0 * 30.0 / clock.bpm));
            check("queued recall exact sample boundary", firstNew == roundToInt(48000.0 * 30.0 / clock.bpm));
            check("native recall updates saved preset",
                  static_cast<int>(sessionState()["currentPreset"]) == 1);
            auto chainSession = clone(session);
            chainSession.getDynamicObject()->setProperty("patch", clone(first));
            chainSession.getDynamicObject()->setProperty(
                "chain", Array<var>{object({{"preset", 0}, {"repeat", 2}, {"mute", 0}}),
                                    object({{"preset", 1}, {"repeat", 1}, {"mute", 0}})});
            chainSession["plugin"].getDynamicObject()->setProperty("chainEnabled", true);
            restoreSession(chainSession);
            clock.playing = true;
            std::vector<int> changes;
            int last = -1;
            for (int i = 0; i < 70; ++i) {
                const auto start = clock.samples;
                auto midi = process(480);
                for (auto e : midi)
                    if (e.getMessage().isNoteOn()) {
                        const int note = e.getMessage().getNoteNumber();
                        if (note != last) {
                            changes.push_back(static_cast<int>(start) + e.samplePosition);
                            last = note;
                        }
                    }
            }
            std::fprintf(stdout, "Chain note changes:");
            for (auto v : changes)
                std::fprintf(stdout, " %d", v);
            std::fprintf(stdout, "\n");
            check("preset chain and repeats run with editor closed",
                  changes.size() >= 3 && changes[0] == 0 &&
                      changes[1] == roundToInt(48000.0 * 30.0 / clock.bpm) &&
                      changes[2] == roundToInt(48000.0 * 60.0 / clock.bpm));
            MemoryBlock saved, restored;
            plugin->getStateInformation(saved);
            plugin->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
            plugin->getStateInformation(restored);
            check("chain and automation mapping state round-trip", saved == restored);
            clock.playing = false;
            process(480);
            for (const double divisor : {0.5, 0.25}) {
                auto fast = clone(session);
                fast["patch"]["tracks"].getArray()->getReference(0).getDynamicObject()->setProperty(
                    "division", divisor);
                fast["plugin"].getDynamicObject()->setProperty("automation", Array<var>{});
                restoreSession(fast);
                clock.playing = true;
                std::vector<int> onsets;
                for (int i = 0; i < 25; ++i) {
                    const auto start = clock.samples;
                    auto midi = process(480);
                    for (auto event : midi)
                        if (event.getMessage().isNoteOn())
                            onsets.push_back(static_cast<int>(start) + event.samplePosition);
                }
                const double period = 48000.0 * 15.0 / clock.bpm * divisor;
                bool timing = onsets.size() > 3;
                for (size_t i = 0; i < onsets.size(); ++i)
                    timing = timing && onsets[i] == roundToInt(static_cast<double>(i) * period);
                check(divisor > 0.3 ? "clock divide 0.5 exact AU MIDI" : "clock divide 0.25 exact AU MIDI",
                      timing);
                const auto state = sessionState();
                const auto savedDivisor =
                    static_cast<double>(state["patch"]["tracks"].getArray()->getReference(0)["division"]);
                check("fractional clock persists in AU state", std::abs(savedDivisor - divisor) < 1.0e-9);
            }
            auto automatedClock = clone(session);
            automatedClock["plugin"].getDynamicObject()->setProperty("automation",
                                                                     Array<var>{"tracks.0.division"});
            restoreSession(automatedClock);
            if (auto *clockParameter = parameter("Automation 01"))
                clockParameter->setValueNotifyingHost(0.0f);
            clock.playing = true;
            std::vector<int> automatedOnsets;
            for (int i = 0; i < 8; ++i) {
                const auto start = clock.samples;
                auto midi = process(480);
                for (auto event : midi)
                    if (event.getMessage().isNoteOn())
                        automatedOnsets.push_back(static_cast<int>(start) + event.samplePosition);
            }
            check("DAW automation selects fractional clock",
                  automatedOnsets.size() >= 3 &&
                      automatedOnsets[1] == roundToInt(48000.0 * 15.0 / clock.bpm * 0.25));
            auto accumSession = clone(session);
            auto accumPatch = accumSession["patch"];
            accumPatch.getDynamicObject()->setProperty("totalPulses", 0);
            accumPatch["userScales"].getArray()->getReference(0).getDynamicObject()->setProperty("mask",
                                                                                                 4095);
            accumSession["plugin"].getDynamicObject()->setProperty("automation", Array<var>{});
            auto *accumTracks = accumPatch["tracks"].getArray();
            accumTracks->add(clone(accumTracks->getReference(0)));
            for (int i = 0; i < 2; ++i) {
                auto t = accumTracks->getReference(i);
                for (const auto &[key, configured] : std::initializer_list<std::pair<const char *, int>>{
                         {"length", 16},
                         {"division", 1},
                         {"scale", 49},
                         {"swing", 50},
                         {"midiChannel", i + 1},
                         {"accumulatorScope", 1},
                         {"accumulatorReset", 3},
                         {"accumulatorStages", i == 0 ? 3 : 5},
                         {"accumulatorLimit", 28},
                         {"accumulatorMode", 0},
                         {"accumulatorPolarity", 0}})
                    t.getDynamicObject()->setProperty(key, configured);
                for (auto &step : *t["steps"].getArray()) {
                    step.getDynamicObject()->setProperty("pulses", i + 2);
                    step.getDynamicObject()->setProperty("gate", 1);
                    step.getDynamicObject()->setProperty("accumulate", 1);
                    step.getDynamicObject()->setProperty("accumulateTrigger", 0);
                    step.getDynamicObject()->setProperty("slide", 0);
                    step.getDynamicObject()->setProperty("probability", 100);
                }
            }
            auto accumulatorNotes = [&]() {
                clock.playing = true;
                std::array<std::vector<int>, 2> notes;
                for (int i = 0; i < 150; ++i)
                    for (auto event : process(480))
                        if (event.getMessage().isNoteOn()) {
                            const int channel = event.getMessage().getChannel() - 1;
                            if (isPositiveAndBelow(channel, 2))
                                notes[static_cast<size_t>(channel)].push_back(
                                    event.getMessage().getNoteNumber());
                        }
                return notes;
            };
            restoreSession(accumSession);
            const auto accumNotes = accumulatorNotes();
            for (size_t i = 0; i < accumNotes.size(); ++i) {
                std::fprintf(stdout, "Accumulator track %zu notes:", i);
                for (auto note : accumNotes[i])
                    std::fprintf(stdout, " %d", note);
                std::fprintf(stdout, "\n");
            }
            check("track accumulators reset after stage count, independent of pulse count",
                  accumNotes[0] == std::vector<int>{60, 61, 62, 60, 61, 62, 60} &&
                      accumNotes[1] == std::vector<int>{60, 61, 62, 63, 64});
            auto accumState = sessionState();
            check("accumulator periods persist in AU project state",
                  static_cast<int>(
                      accumState["patch"]["tracks"].getArray()->getReference(0)["accumulatorStages"]) == 3 &&
                      static_cast<int>(accumState["patch"]["tracks"].getArray()->getReference(
                          1)["accumulatorStages"]) == 5);
            accumSession["plugin"].getDynamicObject()->setProperty("automation",
                                                                   Array<var>{"tracks.0.accumulatorStages"});
            restoreSession(accumSession);
            if (auto *periodParameter = parameter("Automation 01"))
                periodParameter->setValueNotifyingHost(1.0f / 1023.0f);
            const auto automatedAccumNotes = accumulatorNotes();
            std::fprintf(stdout, "Automated accumulator notes:");
            for (auto note : automatedAccumNotes[0])
                std::fprintf(stdout, " %d", note);
            std::fprintf(stdout, "\n");
            check("DAW automation controls accumulator stage period with editor closed",
                  automatedAccumNotes[0] == std::vector<int>{60, 61, 60, 61, 60, 61, 60});
            auto legacySession = clone(session);
            legacySession["patch"]["tracks"].getArray()->getReference(0).getDynamicObject()->removeProperty(
                "accumulatorStages");
            restoreSession(legacySession);
            const auto legacyState = sessionState();
            std::fprintf(stdout, "Legacy accumulator default: %s\n",
                         legacyState["patch"]["tracks"]
                             .getArray()
                             ->getReference(0)["accumulatorStages"]
                             .toString()
                             .toRawUTF8());
            check("old AU sessions receive a compatible accumulator period default",
                  static_cast<int>(
                      legacyState["patch"]["tracks"].getArray()->getReference(0)["accumulatorStages"]) == 16);
            clock.playing = false;
            process(480);
            restoreSession(original);
            clock.playing = true;
            std::fprintf(stdout, "AU native integration: %s (%d failures)\n", failures == 0 ? "PASS" : "FAIL",
                         failures);
            std::fflush(stdout);
        }

        void timerCallback() override {
            if (!plugin)
                return;
            auto midi = process(480);
            ++blocks;
            for (auto event : midi) {
                auto m = event.getMessage();
                if (m.isNoteOn())
                    ++ons;
                if (m.isNoteOff())
                    ++offs;
            }
            if (blocks % 300 == 0) {
                std::fprintf(stdout, "MIDI note-ons=%d note-offs=%d, buffers=%d\n", ons, offs, blocks);
                std::fflush(stdout);
            }
        }
        MidiDataConcatenator midiParser{2048};
        MidiBuffer rawOutput;
        bool rawCallback = false;
        Clock clock;
        std::unique_ptr<AudioPluginInstance> plugin;
        int ons = 0, offs = 0, blocks = 0;
    };
    void initialise(const String &) override {
        std::freopen(NEUROPOLIS_CHECK_LOG, "w", stdout);
        window = std::make_unique<Window>();
    }
    void shutdown() override { window.reset(); }
    void systemRequestedQuit() override { quit(); }

  private:
    std::unique_ptr<Window> window;
};
START_JUCE_APPLICATION(CheckHost)
