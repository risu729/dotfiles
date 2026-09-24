#!/bin/sh
# Modern macOS exposes these settings through native services rather than the
# legacy com.apple.BezelServices dAuto/kDim defaults. Use the system JXA bridge
# so bootstrap needs neither a compiled helper nor Accessibility permission.
# Private API signatures:
# https://github.com/alin23/Lunar/blob/main/Lunar/DDC/Lunar-Bridging-Header.h
# https://github.com/rakalex/mac-brightnessctl/blob/main/KeyboardBrightnessClient.h
exec /usr/bin/osascript -l JavaScript <<'JXA'
ObjC.import('AppKit');
ObjC.bindFunction('dlopen', ['void *', ['char *', 'int']]);
$.dlopen('/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices', 1);
ObjC.bindFunction('DisplayServicesHasAmbientLightCompensation', ['bool', ['uint32']]);
ObjC.bindFunction('DisplayServicesEnableAmbientLightCompensation', ['int', ['uint32', 'bool']]);
ObjC.bindFunction('DisplayServicesAmbientLightCompensationEnabled', ['int', ['uint32', 'bool *']]);

var screens = $.NSScreen.screens;
for (var index = 0; index < screens.count; index++) {
    var display = ObjC.unwrap(screens.objectAtIndex(index).deviceDescription.objectForKey('NSScreenNumber'));
    if (!$.DisplayServicesHasAmbientLightCompensation(display)) {
        continue;
    }
    if ($.DisplayServicesEnableAmbientLightCompensation(display, false) !== 0) {
        throw new Error('Failed to disable automatic brightness for display ' + display);
    }
    var enabled = Ref();
    if ($.DisplayServicesAmbientLightCompensationEnabled(display, enabled) !== 0 || enabled[0]) {
        throw new Error('Automatic brightness is still enabled or unreadable for display ' + display);
    }
    console.log('Disabled automatic brightness for display ' + display);
}

$.dlopen('/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness', 1);
var client = $.NSClassFromString('KeyboardBrightnessClient').alloc.init;
var keyboards = ObjC.deepUnwrap(client.copyKeyboardBacklightIDs) || [];
for (var index = 0; index < keyboards.length; index++) {
    var keyboard = keyboards[index];
    if (!client.isAmbientFeatureAvailableOnKeyboard(keyboard)) {
        continue;
    }
    if (!client.enableAutoBrightnessForKeyboard(false, keyboard)) {
        throw new Error('Failed to disable automatic backlight brightness for keyboard ' + keyboard);
    }
    if (client.isAutoBrightnessEnabledForKeyboard(keyboard)) {
        throw new Error('Automatic backlight brightness is still enabled for keyboard ' + keyboard);
    }
    console.log('Disabled automatic backlight brightness for keyboard ' + keyboard);
}
JXA
