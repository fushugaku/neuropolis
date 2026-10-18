#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
if [ "${1:-}" = --skip-build ]; then
    shift
else
    sh scripts/build_plugin.sh
fi
if [ "$#" -gt 1 ]; then
    printf 'Usage: sh scripts/package_plugin.sh [--skip-build] [output-directory]\n' >&2
    exit 2
fi
package_output=${1:-"$project_root/dist"}
mkdir -p "$package_output"
package_output=$(CDPATH= cd -- "$package_output" && pwd)
package_work=$(mktemp -d "${TMPDIR:-/tmp}/neuropolis-pkg.XXXXXX")
trap 'rm -rf "$package_work"' EXIT HUP INT TERM
mkdir -p "$package_work/packages" "$package_work/resources"
plugin_build="$project_root/plugin/build/Neuropolis_artefacts/Release"
package_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plugin_build/AU/neuropolis.component/Contents/Info.plist")
package_arch=$(lipo -archs "$plugin_build/AU/neuropolis.component/Contents/MacOS/neuropolis")
package_min_os=$(vtool -show-build "$plugin_build/AU/neuropolis.component/Contents/MacOS/neuropolis" | awk '/minos / {print $2; exit}')
case "$package_arch" in
    arm64) package_platform='Apple Silicon' ;;
    x86_64) package_platform='Intel' ;;
    *) printf 'Expected one native architecture, got: %s\n' "$package_arch" >&2; exit 1 ;;
esac
test -n "$package_min_os"
for plugin_format in AU VST3; do
    if [ "$plugin_format" = AU ]; then
        plugin_extension=component
        plugin_folder=Components
        package_id=studio.neuropolis.pkg.au
    else
        plugin_extension=vst3
        plugin_folder=VST3
        package_id=studio.neuropolis.pkg.vst3
    fi
    plugin_source="$plugin_build/$plugin_format/neuropolis.$plugin_extension"
    test "$package_version" = "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plugin_source/Contents/Info.plist")"
    test "$package_arch" = "$(lipo -archs "$plugin_source/Contents/MacOS/neuropolis")"
    test "$package_min_os" = "$(vtool -show-build "$plugin_source/Contents/MacOS/neuropolis" | awk '/minos / {print $2; exit}')"
    package_root="$package_work/$plugin_format"
    mkdir -p "$package_root"
    ditto --norsrc --noextattr "$plugin_source" "$package_root/neuropolis.$plugin_extension"
    plugin_resources="$package_root/neuropolis.$plugin_extension/Contents/Resources"
    mkdir -p "$plugin_resources"
    cp LICENSE THIRD_PARTY_NOTICES.md "$plugin_resources/"
    cp -R licenses "$plugin_resources/"
    if [ -n "${NEUROPOLIS_APPLICATION_SIGN_IDENTITY:-}" ]; then
        codesign --force --sign "$NEUROPOLIS_APPLICATION_SIGN_IDENTITY" --options runtime --timestamp "$package_root/neuropolis.$plugin_extension"
    else
        codesign --force --sign - "$package_root/neuropolis.$plugin_extension"
    fi
    codesign --verify --deep --strict "$package_root/neuropolis.$plugin_extension"
    python3 - "$package_work/$plugin_format.plist" "neuropolis.$plugin_extension" <<'PY'
import plistlib
import sys
with open(sys.argv[1], 'wb') as output:
    plistlib.dump([{
        'RootRelativeBundlePath': sys.argv[2],
        'BundleIsRelocatable': False,
        'BundleIsVersionChecked': True,
        'BundleHasStrictIdentifier': True,
        'BundleOverwriteAction': 'upgrade',
    }], output)
PY
    pkgbuild --root "$package_root" --component-plist "$package_work/$plugin_format.plist" \
        --identifier "$package_id" --version "$package_version" --ownership recommended \
        --install-location "/Library/Audio/Plug-Ins/$plugin_folder" \
        "$package_work/packages/neuropolis-$plugin_format.pkg"
done
python3 - "$package_work" "$package_version" "$package_arch" "$package_min_os" "$package_platform" <<'PY'
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

work = Path(sys.argv[1])
version, arch, min_os, platform = sys.argv[2:]
root = ET.Element('installer-gui-script', minSpecVersion='2')
ET.SubElement(root, 'title').text = f'neuropolis {version}'
ET.SubElement(root, 'product', id='studio.neuropolis.installer', version=version)
ET.SubElement(root, 'options', customize='always', hostArchitectures=arch,
              **{'require-scripts': 'false'})
ET.SubElement(root, 'domains', enable_anywhere='false',
              enable_currentUserHome='true', enable_localSystem='false')
check = ET.SubElement(root, 'volume-check')
ET.SubElement(ET.SubElement(check, 'allowed-os-versions'), 'os-version', min=min_os)
ET.SubElement(root, 'welcome', file='welcome.html', **{'mime-type': 'text/html'})
ET.SubElement(root, 'conclusion', file='conclusion.html', **{'mime-type': 'text/html'})
outline = ET.SubElement(root, 'choices-outline')
for choice_id, title, description, package_id, filename in [
    ('au', 'Audio Unit · Logic Pro', 'AU MIDI FX для Logic Pro. Установка в ~/Library/Audio/Plug-Ins/Components.',
     'studio.neuropolis.pkg.au', 'neuropolis-AU.pkg'),
    ('vst3', 'VST3', 'Для DAW с поддержкой VST3 MIDI-выхода. Установка в ~/Library/Audio/Plug-Ins/VST3.',
     'studio.neuropolis.pkg.vst3', 'neuropolis-VST3.pkg'),
]:
    ET.SubElement(outline, 'line', choice=choice_id)
    choice = ET.SubElement(root, 'choice', id=choice_id, title=title,
                           description=description, start_selected='true')
    ET.SubElement(choice, 'pkg-ref', id=package_id)
    ET.SubElement(root, 'pkg-ref', id=package_id, version=version,
                  onConclusion='None').text = filename
ET.indent(root)
ET.ElementTree(root).write(work / 'Distribution.xml', encoding='utf-8', xml_declaration=True)
for filename in ['welcome.html', 'conclusion.html']:
    html = (Path('plugin/installer') / filename).read_text()
    html = html.replace('@VERSION@', version).replace('@PLATFORM@', platform).replace('@MIN_OS@', min_os)
    (work / 'resources' / filename).write_text(html)
PY
package_file="$package_output/neuropolis-$package_version-macos-$package_arch.pkg"
set -- --distribution "$package_work/Distribution.xml" --package-path "$package_work/packages" --resources "$package_work/resources"
if [ -n "${NEUROPOLIS_INSTALLER_SIGN_IDENTITY:-}" ]; then
    set -- "$@" --sign "$NEUROPOLIS_INSTALLER_SIGN_IDENTITY" --timestamp
fi
productbuild "$@" "$package_file"
(cd "$package_output" && shasum -a 256 "$(basename "$package_file")") > "$package_file.sha256"
printf 'Installer: %s\n' "$package_file"
