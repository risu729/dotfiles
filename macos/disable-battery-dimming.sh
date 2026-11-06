#!/bin/bash
set -euo pipefail

# Disabling automatic brightness does not stop macOS from dimming the display
# on battery; that is the separate "Slightly dim the display on battery" option.
# Only Macs with a battery report the setting, and sudo is needed only to change it.
settings=$(pmset -g custom)
lessbright=$(awk '
	/^Battery Power:$/ { battery = 1; next }
	/^[^ ].*:$/ { battery = 0 }
	battery && $1 == "lessbright" { print $2 }
' <<<"${settings}")
if [[ -n ${lessbright} && ${lessbright} != 0 ]]; then
	sudo pmset -b lessbright 0
	echo "Disabled display dimming on battery"
fi
