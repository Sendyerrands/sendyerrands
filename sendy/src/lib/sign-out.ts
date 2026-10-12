import type { useRouter } from 'expo-router';

/**
 * Sign out, and actually leave.
 *
 * The order matters, and getting it wrong is what produced the "empty logout
 * page". Every staff area — rider, vendor, provider — is wrapped in a gate that
 * renders "Sign in as a rider" the moment `signedIn` goes false. Clearing the
 * session first means that gate fires while its screen is still mounted, so the
 * last thing someone sees on the way out is an empty state telling them to sign
 * in to the thing they just left. Navigating first unmounts the gated tree, and
 * the session is cleared behind it.
 *
 * `/signin` is the destination for everyone, including customers. It is the
 * only screen that does not care whether anybody is signed in, which is what
 * makes navigating to it before clearing the token safe — the splash routes by
 * `signedIn` and would have bounced straight back in, and onboarding is a
 * three-slide pitch nobody wants after deliberately logging out.
 */
export async function signOutAndLeave(
  router: ReturnType<typeof useRouter>,
  signOut: () => Promise<void>
) {
  /*
    Drop any stack above this screen first. Without it a "log out" reached
    through pushed screens leaves those screens behind the new one, and the
    back gesture walks into an authenticated screen with no session — which is
    the other half of "log me out completely".

    Guarded with canDismiss(), not wrapped in try/catch. React Navigation does
    not THROW when nothing can handle the action — it dispatches POP_TO_TOP and
    logs "The action 'POP_TO_TOP' was not handled by any navigator". A catch
    block never runs, so the only thing it achieved was looking like it had
    handled the case while a console error appeared on every sign-out from a
    screen with no stack above it, which is most of them.
  */
  if (router.canDismiss()) router.dismissAll();

  router.replace('/signin');
  await signOut();
}
