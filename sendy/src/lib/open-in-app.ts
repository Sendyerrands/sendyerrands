import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

import { colors } from '@/lib/theme';

/**
 * Opens a URL without leaving the app.
 *
 * On a phone this is the platform's in-app browser — Chrome Custom Tabs on
 * Android, SFSafariViewController on iOS. It slides up over the app with a
 * close button and returns exactly where the person was, rather than handing
 * them to another app and hoping they find their way back.
 *
 * Chosen over react-native-webview deliberately. A WebView would be a screen
 * inside the app wearing the app's own header, which is worse here, not better:
 * it is a native module the app does not currently carry, and for someone
 * reading a privacy policy the visible address bar is the reassuring part —
 * proof the page is really on the domain it claims. expo-web-browser is already
 * a dependency, so this needs no new build.
 */
export async function openInApp(url: string) {
  if (!url) return;

  /*
   * Web gets its own path, because expo-web-browser's web build is broken in
   * a way that is invisible from here. It calls window.open with popup
   * dimensions — which browsers block far more readily than a plain tab — then
   * ignores the return value and reports OPENED whether or not anything
   * opened. So a blocked popup produced no error, no fallback, and no tab, and
   * the button was reported as doing nothing. Which it was.
   *
   * A plain new tab from a click handler is what browsers are designed to
   * allow. That is what Linking.openURL does on react-native-web.
   */
  if (Platform.OS === 'web') {
    try {
      await Linking.openURL(url);
    } catch (cause) {
      console.warn(`[openInApp] could not open ${url}:`, cause);
    }
    return;
  }

  try {
    await WebBrowser.openBrowserAsync(url, {
      // The sheet wears the brand rather than arriving as a white slab.
      toolbarColor: colors.white,
      controlsColor: colors.pink[600],
      // Android: the close button reads as going back to Sendy, not forward.
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
      // The enum, not the string — the string literal is not assignable, and
      // silently widening it with `as` would hide a real API change later.
      ...(Platform.OS === 'ios'
        ? { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }
        : {}),
    });
  } catch (cause) {
    // Falls back to the system browser: a policy that opens in Chrome beats
    // one that does not open. But say so, rather than fail twice in silence.
    console.warn(`[openInApp] in-app browser failed for ${url}, falling back:`, cause);
    await Linking.openURL(url).catch((e) => console.warn('[openInApp] fallback failed:', e));
  }
}
