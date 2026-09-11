import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

import { colors } from '@/lib/theme';

/**
 * Opens a URL without leaving the app.
 *
 * Uses the platform's in-app browser — Chrome Custom Tabs on Android,
 * SFSafariViewController on iOS. It slides up over the app with a close button
 * and returns exactly where the person was, rather than handing them to another
 * app and hoping they find their way back.
 *
 * Chosen over react-native-webview deliberately. A WebView would be a screen
 * inside the app wearing the app's own header, which is worse here, not better:
 * it is a native module the app does not currently carry, and for someone
 * reading a privacy policy the visible address bar is the reassuring part —
 * proof the page is really on the domain it claims. expo-web-browser is already
 * a dependency, so this needs no new build.
 *
 * Falls back to the system browser if the in-app one cannot open, because a
 * policy that will not open at all is worse than one that opens in Chrome.
 */
export async function openInApp(url: string) {
  if (!url) return;

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
  } catch {
    await Linking.openURL(url).catch(() => {});
  }
}
