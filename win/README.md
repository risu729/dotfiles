# Windows Applications

Run these commands in **native Windows PowerShell 5.1 or PowerShell 7**, from a
checkout of this repository (a WSL UNC checkout also works). The full installer
requires Windows 11 24H2 / build 26100 or newer and elevation. Package
operations may prompt for elevation; use the same Windows account that owns the
apps. WSL's Linux mise cannot run the WinGet bootstrap manager.

```powershell
# Install native mise if missing, then install missing applications.
.\win\packages.ps1 -Action Apply -BootstrapMise

# Read-only status and preview (require winget.exe and native mise.exe on PATH).
.\win\packages.ps1 -Action Status
.\win\packages.ps1 -Action Apply -DryRun

# Explicit managed update: preview, then update the four eligible apps.
.\win\packages.ps1 -Action Upgrade -DryRun
.\win\packages.ps1 -Action Upgrade
```

`packages.ps1` loads only [`mise.toml`](mise.toml), suppresses hooks and config
environment directives, and restores its process configuration after success or
failure. It does not execute the Unix root bootstrap, install development tools,
or modify the user's mise configuration. Native mise must be at least 2026.9.3
(the first WinGet release). This minimum is separate from the Unix/development
minimum. No root or Unix mise version bump is needed.

The full Windows installer invokes `Apply -BootstrapMise` after WSL setup and
still configures the PowerToys backup path, persists WSLENV, and removes desktop
shortcuts. Standalone package commands do not remove shortcuts.

## Installation and Updating Are Separate

Every declaration is unpinned (`latest`). During **Apply**, any version that
WinGet recognizes as installed satisfies it, including a newer version installed
by the app itself. It installs missing apps only. This is installed-state
recognition, not brew-cask's bundle adoption; WinGet has no `adopt` option in
mise. An unregistered/portable app that WinGet cannot identify is not adopted:
inspect status before applying to avoid a second installation.

During **Upgrade**, the wrapper selects the `managed` environment, so only these
four packages are eligible: CrystalDiskInfo Aoi, GIMP Nightly, Inkscape, and
Microsoft Edit. The other 18 declarations require the `apps` environment, which
only Apply/Status select. Caller `MISE_ENV` and global/system declarations
cannot add them back. Missing apps are skipped by Upgrade. There is no `--all`,
version pin, force, downgrade, or upgrade-unknown flag. Review the preview
before updating; WinGet/installer failures stop the command and are not
suppressed.

Do not substitute an unrestricted `mise bootstrap packages upgrade` with the
`apps` environment, or `winget upgrade --all`: these bypass this policy. No
WinGet pins are created, so other package managers remain outside this policy.
`mise upgrade` updates development tools, not these apps. mise's packages
`apply --update` refreshes source metadata when installing missing packages; it
is **not** an app-upgrade command. Upgrade refreshes metadata itself.

mise itself is bootstrapped separately with exact `jdx.mise`, `--source winget`
and `--no-upgrade`. Neither Apply nor Upgrade updates it. If the existing native
mise is too old, update it deliberately using its original installation method.
For a WinGet installation:

```powershell
winget upgrade --id jdx.mise --exact --source winget
```

## Update Ownership by Application

Checked against vendor documentation and the WinGet manifests on 2026-09-26.
"Excluded" means our managed Upgrade never invokes an upgrade for that app,
**even if its automatic updater is disabled**. Review its settings after
install; exclusion alone does not enable an updater. Optional or externally
controlled updaters are conservatively excluded too.

- **Google.Chrome.Beta** (Excluded):
  [Google updater][s1]; relaunch to
  finish.

- **Discord.Discord.Canary** (Excluded): App updater;
  [Discord's updater documentation][s2].

- **Discord.Discord.PTB** (Excluded): Same updater; its
  [manifest][s3]
  also denies WinGet upgrades.

- **Notion.Notion** (Excluded):
  [Automatic desktop updates][s4].

- **Bitwarden.Bitwarden** (Excluded):
  [Installed desktop distributions auto-update][s5];
  portable is different.

- **Zoom.Zoom** (Excluded):
  [EXE auto-updates by default; MSI does not][s6].
  WinGet currently supplies MSI. Enable/review
  [Enterprise Auto Update][s7], or update manually. Existing
  EXE installs must also remain untouched.

- **Microsoft.PowerToys** (Excluded):
  [Built-in update controls][s8];
  verify automatic download/install settings.

- **Microsoft.PowerShell.Preview** (Excluded):
  [Windows/MSIX or Microsoft Update][s9],
  depending on installation; current WinGet preview is MSIX. Verify updates for
  the installed channel.

- **Termius.Termius** (Excluded conservatively):
  [Manifest][s10]
  uses the vendor's `autoupdate.termius.com` feed and `--updated` switch.
  Updater integration inferred from those artifacts; confirm settings on
  Windows.

- **Microsoft.VisualStudioCode.Insiders** (Excluded):
  [Windows integrated updater][s11];
  user setup updates are disabled when running elevated.

- **JetBrains.Toolbox** (Excluded):
  [Toolbox self-update][s12],
  independently of IDE updates.

- **Figma.Figma** (Excluded):
  [Desktop app prompts for updates][s13];
  user may need to accept/restart.

- **Google.GoogleDrive** (Excluded):
  [Google Update][s14]; policy can
  disable it.

- **TheDocumentFoundation.LibreOffice** (Excluded): Windows MAR updater since
  [24.8][s15];
  verify automatic-update settings.

- **GIMP.GIMP.Nightly** (Included):
  [Development builds require downloading/installing][s16];
  no integrated installer updater. The existing Nightly ID is preserved, even
  though its catalog can lag actual nightly builds.

- **Inkscape.Inkscape** (Included):
  [Windows installer distribution][s17]; no
  integrated app updater in this distribution (Store is separate).

- **Cloudflare.Warp** (Excluded conservatively): Consumer/Zero Trust settings
  differ.
  [Cloudflare-managed client updates][s18]
  are available for recent Windows clients. Verify assigned version/updater;
  otherwise update manually.

- **Tailscale.Tailscale** (Excluded):
  [Optional automatic Windows updates][s19];
  tailnet/device policy controls them. Canonical ID casing matters to mise's
  parser.

- **CrystalDewWorld.CrystalDiskInfo.AoiEdition** (Included):
  [Manual replacement/installer][s20],
  not a self-updater.

- **Valve.Steam** (Excluded):
  [Steam client updates download automatically][s21];
  restart may be needed.

- **Logitech.OptionsPlus** (Excluded):
  [Automatic update setting][s22];
  verify enabled.

- **jdx.mise** (Explicit separate update only): Bootstrap prerequisite, outside
  the app declarations.

When adding an app, establish who owns its updates first. Place self-updating or
uncertain distributions behind `env = "apps"`; add an unconditional declaration
only after verifying that managed upgrades are appropriate.

## WinGet Source Selection and Troubleshooting

Unlike the old JSON import, mise 2026.9.14 does **not** pass `--source winget`.
It searches configured sources with `--id --exact`, accepts source agreements
before mutations, and may refresh all sources on Upgrade. These declarations are
catalog IDs for Microsoft's community `winget` source, not Store product IDs.
The supported setup is the default Microsoft sources, without another
non-explicit source publishing the same IDs. This is a deliberate compatibility
limitation, not source pinning. We do not remove, reset, or change source
policy.

Inspect `winget source list` before use. If an enterprise/custom source
duplicates an ID, or you require strict source provenance, do not apply through
mise yet. Use a narrow command for a missing app, retaining the no-upgrade rule:

```powershell
winget install --id Microsoft.Edit --exact --source winget --no-upgrade
```

For a managed update under that constraint, use an explicit ID and source only
for one of the four eligible apps, for example
`winget upgrade --id Microsoft.Edit --exact --source winget`. Do not use
`--all`. Full source selection needs upstream mise support.

Status/dry-run do not accept source agreements, install apps, or refresh
sources. On a fresh account, inspect and accept the configured source agreements
once:

```powershell
winget source list
winget list --id Microsoft.Edit --exact `
  --accept-source-agreements --disable-interactivity
```

"No installed package found" is normal here on a fresh machine. If WinGet itself
cannot access a source, fix that source/network problem before rerunning. If
mise reports "no parseable row", compare the exact ID/casing with `winget list`;
report the output and mise/WinGet versions. Do not force a reinstall to fix a
status-parser error.

If App Installer or mise was just installed, open a new PowerShell session and
check `Get-Command winget.exe,mise.exe` and `mise.exe --version`. The wrapper
also refreshes process PATH when mise is missing. An existing too-old mise on
PATH is not silently replaced. Dry-run requires both executables already
installed.

Operations are incremental, not transactional. On partial failure, repair the
reported problem and rerun Apply; already recognized apps remain untouched.
There is no pruning, uninstall, automatic rollback, or global pin cleanup. A
failed run restores its temporary mise environment settings. Keep verification
logs outside the checkout and delete them when no longer needed.

[s1]: https://support.google.com/chrome/answer/95414
[s2]: https://support.discord.com/hc/en-us/articles/115001670071-How-do-I-fix-a-failed-update-loop
[s3]: https://github.com/microsoft/winget-pkgs/tree/master/manifests/d/Discord/Discord/PTB
[s4]: https://www.notion.com/help/notion-for-desktop
[s5]: https://bitwarden.com/help/desktop-app-feature-support/
[s6]: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063814
[s7]: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058493
[s8]: https://learn.microsoft.com/windows/powertoys/general
[s9]: https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows
[s10]: https://github.com/microsoft/winget-pkgs/tree/master/manifests/t/Termius/Termius
[s11]: https://code.visualstudio.com/docs/setup/windows
[s12]: https://youtrack.jetbrains.com/issue/TBX-12615/Toolbox-App-self-update-flow
[s13]: https://help.figma.com/hc/en-us/articles/5601429983767-Guide-to-the-Figma-desktop-app
[s14]: https://support.google.com/a/answer/7491144
[s15]: https://wiki.documentfoundation.org/ReleaseNotes/24.8#Automatic_updates
[s16]: https://www.gimp.org/downloads/devel/
[s17]: https://inkscape.org/release/
[s18]: https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/update/
[s19]: https://tailscale.com/docs/features/client/update
[s20]: https://crystalmark.info/en/software/crystaldiskinfo/crystaldiskinfo-install/
[s21]: https://steamcommunity.com/app/593110/eventcomments/603020746117092092?l=english
[s22]: https://support.logi.com/hc/en-us/articles/26554436904727-How-do-I-update-Logi-Options
