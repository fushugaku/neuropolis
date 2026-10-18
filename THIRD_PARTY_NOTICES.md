# Third-party notices

Neuropolis is distributed under the GNU Affero General Public License, version 3
only (AGPL-3.0-only). Copyright © 2026 Neuropolis contributors.

## JUCE

The native AU/VST3 wrapper uses JUCE from commit
`a74b024c188339fdfe07b73088e6f6961ff66709` (8.0.16-security).
Neuropolis uses JUCE under its open-source AGPLv3 option.

- Source: https://github.com/juce-framework/JUCE/tree/a74b024c188339fdfe07b73088e6f6961ff66709
- License: [licenses/JUCE-LICENSE.md](licenses/JUCE-LICENSE.md)
- Build script: `scripts/build_plugin.sh`

JUCE contains additional third-party components. Their original license and
copyright notices are retained in the JUCE source included in the release source
archive. Copies of the standalone license files for native plugin dependencies
are also provided in `licenses/` and in the installed plugin bundles.

The release source archive includes the complete pinned JUCE source at
`tools/plugin-sdk/JUCE/`, together with Neuropolis sources and build scripts.
No proprietary SDK, Apple signing key, or vendor firmware is required to build
Neuropolis. Apple system frameworks and macOS development tools are supplied by
Apple separately.

## Intellijel Metropolix reference

The project began with research into musical behavior of Metropolix 1.6.5.0.
Metropolix and Intellijel names belong to their respective owners. Neuropolis is
an independent project and is not affiliated with or endorsed by Intellijel.

The original firmware and decompiled firmware listings are not distributed in
this repository or in Neuropolis release packages. The optional research scripts
refer to pinned upstream sources; downloaded reference material retains its own
licensing and is excluded from version control.

See `docs/PORTING.md` and the fixture provenance in
`crates/metropolix-core/tests/fixtures/provenance.json` for the scope of behavioral
comparisons. Musical test input/output traces do not contain firmware code.
