#ifndef ProductVersion
  #error ProductVersion must be provided
#endif
#ifndef ProjectRoot
  #error ProjectRoot must be provided
#endif

[Setup]
AppId={{F5DBA834-373F-4B7D-B613-34E6723D8B14}
AppName=neuropolis
AppVersion={#ProductVersion}
AppPublisher=Neuropolis
AppPublisherURL=https://github.com/fushugaku/neuropolis
AppSupportURL=https://github.com/fushugaku/neuropolis/issues
AppUpdatesURL=https://github.com/fushugaku/neuropolis/releases
DefaultDirName={autopf}\Neuropolis
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
PrivilegesRequired=admin
OutputDir={#ProjectRoot}\dist
OutputBaseFilename=neuropolis-{#ProductVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=neuropolis VST3
CloseApplications=no
RestartApplications=no
SetupLogging=yes
UninstallFilesDir={app}

[Languages]
Name: english; MessagesFile: compiler:Default.isl

[Files]
Source: "{#ProjectRoot}\dist\windows-payload\neuropolis.vst3\*"; DestDir: "{commoncf64}\VST3\neuropolis.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "{#ProjectRoot}\tools\plugin-sdk\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Code]
function HasRuntimeVersion(RootKey: Integer): Boolean;
var
  RuntimeVersion: String;
begin
  Result := RegQueryStringValue(RootKey,
    'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', RuntimeVersion) and (RuntimeVersion <> '') and (RuntimeVersion <> '0.0.0.0');
end;

function WebView2Installed: Boolean;
begin
  Result := HasRuntimeVersion(HKLM32) or HasRuntimeVersion(HKCU);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if not WebView2Installed then begin
    WizardForm.StatusLabel.Caption := 'Installing Microsoft Edge WebView2 Runtime. Internet access is required.';
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'),
      '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := 'Microsoft Edge WebView2 Runtime could not be installed. Install it from https://developer.microsoft.com/microsoft-edge/webview2 and run setup again.'
    else if not WebView2Installed then
      Result := 'Microsoft Edge WebView2 Runtime is required by the editor. Install it from https://developer.microsoft.com/microsoft-edge/webview2 and run setup again.';
  end;
end;
