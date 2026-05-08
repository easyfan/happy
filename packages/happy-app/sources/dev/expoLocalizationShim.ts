// Shim for expo-localization when running tests under vitest/Node.js.
// Returns a single English locale so that t() resolves to 'en' translations.
export const getLocales = () => [{ languageCode: 'en', languageScriptCode: null, languageRegionCode: null, textDirection: 'ltr' as const, digitGroupingSeparator: ',', decimalSeparator: '.', measurementSystem: 'metric' as const, currencyCode: null, currencySymbol: null, regionCode: null, temperatureUnit: 'celsius' as const }];
export const getCalendars = () => [{ calendar: 'gregorian', uses24hourClock: false, firstWeekday: 1, timeZone: 'UTC' }];
