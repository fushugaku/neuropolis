#include <juce_audio_utils/juce_audio_utils.h>
#include <array>
#include <cmath>
#include <cstdio>
#include <stdexcept>

using namespace juce;

namespace {
void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
}

class Clock final : public AudioPlayHead {
  public:
    int64_t samples = 0;
    bool playing = true;
    Optional<PositionInfo> getPosition() const override {
        PositionInfo position;
        position.setBpm(120.0);
        position.setTimeInSamples(samples);
        position.setTimeInSeconds(static_cast<double>(samples) / 48000.0);
        position.setPpqPosition(static_cast<double>(samples) / 24000.0);
        position.setTimeSignature(TimeSignature{4, 4});
        position.setIsPlaying(playing);
        return position;
    }
};
} // namespace

int main(int argc, char **argv) {
    ScopedJuceInitialiser_GUI initialise;
    try {
        require(argc == 2, "Pass the VST3 bundle path");
        AudioPluginFormatManager formats;
        formats.addFormat(std::make_unique<VST3PluginFormat>());
        OwnedArray<PluginDescription> descriptions;
        formats.getFormat(0)->findAllTypesForFile(descriptions, File(argv[1]).getFullPathName());
        require(!descriptions.isEmpty(), "VST3 scan did not find neuropolis");
        String error;
        auto plugin = formats.createPluginInstance(*descriptions[0], 48000.0, 512, error);
        if (!plugin)
            throw std::runtime_error("VST3 could not load: " + error.toStdString());
        require(plugin->acceptsMidi() && plugin->producesMidi(), "VST3 MIDI ports are missing");
        AudioProcessorParameter *reset = nullptr;
        int automation = 0;
        bool preset = false, chain = false;
        for (auto *parameter : plugin->getParameters()) {
            const auto name = parameter->getName(80);
            if (name == "Reset after")
                reset = parameter;
            automation += name.startsWith("Automation ") ? 1 : 0;
            preset |= name == "Preset";
            chain |= name == "Chain";
        }
        require(reset != nullptr && automation == 32 && preset && chain,
                "The VST3 host did not expose all sequencer automation parameters");
        Clock clock;
        plugin->setPlayHead(&clock);
        plugin->setRateAndBufferSizeDetails(48000.0, 512);
        plugin->prepareToPlay(48000.0, 512);
        std::array<std::array<int, 128>, 16> held{};
        std::array<int, 16> channels{};
        int notes = 0;
        auto render = [&](int frames, MidiBuffer &midi) {
            AudioBuffer<float> audio(jmax(1, plugin->getTotalNumOutputChannels()), frames);
            audio.clear();
            plugin->processBlock(audio, midi);
            for (const auto event : midi) {
                const auto message = event.getMessage();
                if (message.isNoteOn()) {
                    ++notes;
                    ++channels[static_cast<size_t>(message.getChannel() - 1)];
                    ++held[static_cast<size_t>(message.getChannel() - 1)]
                          [static_cast<size_t>(message.getNoteNumber())];
                } else if (message.isNoteOff()) {
                    auto &count = held[static_cast<size_t>(message.getChannel() - 1)]
                                      [static_cast<size_t>(message.getNoteNumber())];
                    count = jmax(0, count - 1);
                }
                require(event.samplePosition >= 0 && event.samplePosition < frames,
                        "MIDI event fell outside the render block");
            }
            clock.samples += frames;
        };
        for (int i = 0; i < 240; ++i) {
            MidiBuffer midi;
            render(i % 2 == 0 ? 257 : 511, midi);
        }
        require(notes > 8 && channels[0] > 0 && channels[1] > 0,
                "Default tracks did not generate MIDI on separate channels");

        MidiBuffer passthrough;
        passthrough.addEvent(MidiMessage::noteOn(5, 64, static_cast<uint8>(91)), 37);
        passthrough.addEvent(MidiMessage::noteOff(5, 64), 229);
        render(512, passthrough);
        bool on = false, off = false;
        for (const auto event : passthrough) {
            const auto message = event.getMessage();
            if (message.getChannel() == 5 && message.getNoteNumber() == 64) {
                on |= message.isNoteOn() && event.samplePosition == 37;
                off |= message.isNoteOff() && event.samplePosition == 229;
            }
        }
        require(on && off, "Incoming MIDI sample positions were not preserved");

        clock.playing = false;
        MidiBuffer stopped;
        render(512, stopped);
        for (const auto event : stopped)
            require(!event.getMessage().isNoteOn(), "Stopped transport generated a new note");
        for (const auto &channel : held)
            for (int count : channel)
                require(count == 0, "Stopping left generated notes held");

        reset->setValueNotifyingHost(32.0f / 1024.0f);
        MidiBuffer changed;
        render(512, changed);
        MemoryBlock saved;
        plugin->getStateInformation(saved);
        require(saved.getSize() > 100, "VST3 project state is empty");
        reset->setValueNotifyingHost(0.0f);
        render(512, changed);
        plugin->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
        require(std::abs(reset->getValue() - 32.0f / 1024.0f) < 0.001f,
                "VST3 state did not restore host automation");
        plugin->releaseResources();
        plugin->setPlayHead(nullptr);
        std::printf("PASS: VST3 load, %d MIDI notes, channels, sample offsets, stop and state\n", notes);
        return 0;
    } catch (const std::exception &error) {
        std::fprintf(stderr, "FAIL: %s\n", error.what());
        return 1;
    }
}
