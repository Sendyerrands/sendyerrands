import { Alert, Platform } from 'react-native';

/**
 * Ask a yes/no question, on web as well as native.
 *
 * `Alert.alert` cannot carry this on its own: react-native-web ships it as
 * `static alert() {}` — a literal no-op. Built on Alert alone, the dialog would
 * simply never appear in the browser and the promise would never settle, so the
 * action behind it would hang forever. `window.confirm` is synchronous and
 * reliable there, so each platform gets the one that actually draws something.
 *
 * Resolves `false` on anything unexpected — a dismissed dialog, a blocked
 * `confirm` in a sandboxed frame. The caller is always asking permission for
 * something destructive, so silence must mean "no", never "go ahead".
 */
export function confirmAsync(
  title: string,
  message: string,
  confirmLabel = 'Continue'
): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    } catch {
      return Promise.resolve(false);
    }
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      // Tapping outside on Android dismisses without touching either button.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
