#!/usr/bin/env bash
# Keep legacy and package-created sources from duplicating mise's deb822 files.
set -euo pipefail

profile="${1:?Expected bare or personal profile}"
etc_root="${2:-/etc}"
case "${profile}" in
bare | personal) ;;
*) exit 2 ;;
esac

sudo rm -f -- "${etc_root}/apt/sources.list.d/docker.list"
if [[ ${profile} != personal ]]; then
	exit 0
fi
sudo rm -f -- "${etc_root}/apt/sources.list.d/cloudflared.list" \
	"${etc_root}/apt/sources.list.d/google-chrome.sources" \
	"${etc_root}/apt/sources.list.d/google-chrome.list"

# Chrome's postinst recreates its source when this flag is true, its old
# source exists, or a legacy list needs migrating. Leave only mise's source.
# Preserve unrelated defaults, including repo_reenable_on_distupgrade.
sudo install -d -m 0755 "${etc_root}/default"
defaults="${etc_root}/default/google-chrome"
sudo touch "${defaults}"
temporary=$(sudo mktemp "${etc_root}/default/.google-chrome.XXXXXX")
trap 'sudo rm -f -- "${temporary}"' EXIT
sudo awk '!/^[[:space:]]*repo_add_once[[:space:]]*=/' "${defaults}" |
	sudo tee "${temporary}" >/dev/null
printf '%s\n' 'repo_add_once="false"' | sudo tee -a "${temporary}" >/dev/null
sudo chmod 0644 "${temporary}"
sudo mv -f -- "${temporary}" "${defaults}"
