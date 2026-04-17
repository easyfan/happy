import './sources/unistyles';

// On Android devices without Google Play Services (common on Chinese ROMs),
// expo-notifications and expo-updates throw at startup. The only lost
// functionality is FCM push notifications, which don't work without Play
// anyway. Suppress silently so the rest of the app is unaffected.
if (typeof (global as any).ErrorUtils !== 'undefined') {
    const errorUtils = (global as any).ErrorUtils;
    const prev = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        if (error?.message?.includes('Google Play')) {
            return;
        }
        prev(error, isFatal);
    });
}

import 'expo-router/entry';