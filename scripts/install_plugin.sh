#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
if [ ! -d plugin/build/Neuropolis_artefacts/Release/AU/neuropolis.component ]; then sh scripts/build_plugin.sh; fi
plugin_destination="$HOME/Library/Audio/Plug-Ins"
mkdir -p "$plugin_destination/Components" "$plugin_destination/VST3"
for plugin_format in AU VST3; do
    if [ "$plugin_format" = AU ]; then plugin_extension=component; plugin_folder=Components; else plugin_extension=vst3; plugin_folder=VST3; fi
    ditto "plugin/build/Neuropolis_artefacts/Release/$plugin_format/neuropolis.$plugin_extension" "$plugin_destination/$plugin_folder/neuropolis.$plugin_extension"
    codesign --force --deep --sign - "$plugin_destination/$plugin_folder/neuropolis.$plugin_extension"
done
printf 'Installed neuropolis AU + VST3. Reopen the DAW to refresh its plug-in list.\nLogic: MIDI FX → Audio Units → Neuropolis → neuropolis.\n'
