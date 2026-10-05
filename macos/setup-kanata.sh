#!/bin/bash
set -euo pipefail

# Pin the pair: Kanata 1.12 uses the protocol-5 DriverKit daemon, not v8.
# Use the upstream binary without the optional shell-command execution feature.
kanata_version=1.12.0
driver_version=6.2.0
driver_sha256=9e8c46239f0748161241e42444857901224e5c82f5b58a1731df4c70bf0736a8
script_dir=$(cd "$(dirname "$0")" && pwd)
mode=${1:-install}
case "${mode}" in
prepare | install) ;;
*)
	echo "Usage: $0 [prepare|install]" >&2
	exit 2
	;;
esac
platform=$(uname -s)
if [[ ${platform} != Darwin ]]; then
	echo 'Kanata setup is only supported on macOS.' >&2
	exit 1
fi
case "$(uname -m)" in
arm64)
	arch=arm64
	kanata_sha256=839769d189911b5881e11550eaa2039705213fb725865d088f5a2e3a6c10de32
	;;
x86_64)
	arch=x64
	kanata_sha256=bdb8b2f7ae2a648336a2561c7c6c00a736cd76e012035df651114b304c5ffb01
	;;
*)
	echo 'Unsupported CPU architecture.' >&2
	exit 1
	;;
esac

cache="${XDG_CACHE_HOME:-${HOME}/.cache}/dotfiles/kanata/${kanata_version}-${driver_version}"
mkdir -p "${cache}"
download() {
	local url=$1 target=$2 checksum=$3
	if [[ -f ${target} ]] && echo "${checksum}  ${target}" | shasum -a 256 -c - >/dev/null 2>&1; then
		return
	fi
	curl --fail --location --silent --show-error "${url}" -o "${target}.download"
	echo "${checksum}  ${target}.download" | shasum -a 256 -c -
	mv "${target}.download" "${target}"
}
download "https://github.com/jtroo/kanata/releases/download/v${kanata_version}/macos-binaries-${arch}.zip" \
	"${cache}/kanata-${arch}.zip" "${kanata_sha256}"
download "https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases/download/v${driver_version}/Karabiner-DriverKit-VirtualHIDDevice-${driver_version}.pkg" \
	"${cache}/driver.pkg" "${driver_sha256}"
unzip -oq "${cache}/kanata-${arch}.zip" "kanata_macos_${arch}" -d "${cache}"
binary="${cache}/kanata_macos_${arch}"
chmod 755 "${binary}"
"${binary}" --check --cfg "${script_dir}/kanata/kanata.kbd"
plutil -lint "${script_dir}/kanata/"*.plist
pkgutil --check-signature "${cache}/driver.pkg"
if [[ ${mode} == prepare ]]; then
	echo "Verified installation files in ${cache}"
	exit 0
fi

# Save the previous user settings once. Config remains root-owned at runtime.
backup="${HOME}/Library/Application Support/dotfiles/kanata-backup"
mkdir -p "${backup}"
if [[ ! -f ${backup}/global-host.plist ]]; then
	defaults -currentHost export NSGlobalDomain "${backup}/global-host.plist"
	defaults export NSGlobalDomain "${backup}/global.plist"
	if [[ -d ${HOME}/.config/karabiner ]]; then
		cp -R "${HOME}/.config/karabiner" "${backup}/karabiner"
	fi
fi

sudo -v
# Retire the previous remapper before installing the compatible standalone driver.
uninstaller='/Library/Application Support/org.pqrs/Karabiner-Elements/uninstall.sh'
if [[ -f ${uninstaller} ]]; then
	for label in org.pqrs.service.daemon.Karabiner-Core-Service org.pqrs.service.daemon.Karabiner-VirtualHIDDevice-Daemon; do
		if sudo launchctl print "system/${label}" >/dev/null 2>&1; then
			sudo launchctl bootout "system/${label}"
		fi
	done
	sudo bash "${uninstaller}"
fi
driver_installed=$(pkgutil --pkg-info org.pqrs.Karabiner-DriverKit-VirtualHIDDevice 2>/dev/null | sed -n 's/^version: //p' || true)
driver_manager='/Applications/.Karabiner-VirtualHIDDevice-Manager.app/Contents/MacOS/Karabiner-VirtualHIDDevice-Manager'
if [[ ${driver_installed} != "${driver_version}" || ! -x ${driver_manager} ]]; then
	sudo installer -pkg "${cache}/driver.pkg" -target /
fi
sudo "${driver_manager}" activate

sudo install -d -m 755 /usr/local/bin /etc/kanata
if ! cmp -s "${binary}" /usr/local/bin/kanata; then
	sudo install -o root -g wheel -m 755 "${binary}" /usr/local/bin/kanata
fi
sudo install -o root -g wheel -m 644 "${script_dir}/kanata/kanata.kbd" /etc/kanata/kanata.kbd
for label in org.pqrs.Karabiner-VirtualHIDDevice-Daemon dev.kanata.kanata; do
	plist="/Library/LaunchDaemons/${label}.plist"
	if sudo launchctl print "system/${label}" >/dev/null 2>&1; then
		sudo launchctl bootout "system/${label}"
	fi
	sudo install -o root -g wheel -m 644 "${script_dir}/kanata/${label}.plist" "${plist}"
	sudo launchctl enable "system/${label}"
	sudo launchctl bootstrap system "${plist}"
done

# Remove the old per-device modifier map; Kanata now owns those transformations.
key=com.apple.keyboard.modifiermapping.0-0-0
if defaults -currentHost read NSGlobalDomain "${key}" >/dev/null 2>&1; then
	defaults -currentHost delete NSGlobalDomain "${key}"
fi
defaults write NSGlobalDomain TISRomanSwitchState -int 0

# App Shortcuts preserve other custom menu shortcuts. Fn maps to Command.
for domain in com.google.Chrome com.google.Chrome.beta; do
	defaults write "${domain}" NSUserKeyEquivalents -dict-add \
		'Show Full History' '@h' 'Hide Google Chrome' '@^h'
done

echo 'Allow /usr/local/bin/kanata in System Settings > Privacy & Security > Input Monitoring.'
echo 'Allow the Karabiner driver in General > Login Items & Extensions > Driver Extensions.'
echo 'Then run: sudo launchctl kickstart -k system/dev.kanata.kanata'
echo "Previous settings are backed up in ${backup}"
