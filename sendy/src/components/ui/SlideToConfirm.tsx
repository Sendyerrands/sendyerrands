import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, View } from 'react-native';

import { colors, shadow } from '@/lib/theme';

const TRACK_HEIGHT = 56;
const KNOB = 44;
const PADDING = 6;

/**
 * Slide to confirm — an action deliberately made harder to trigger.
 *
 * This used to be a Pressable that said "Slide to confirm delivery" and fired
 * on tap. The label described a gesture the control did not implement, which is
 * the same defect as a button that does nothing: what it says and what it does
 * are different things, and the one it says is the one people rely on.
 *
 * The friction is the point on this particular action. Confirming delivery
 * closes an order, releases the rider's earning and cannot be undone from the
 * app — it should cost a deliberate movement rather than a thumb landing in the
 * wrong place while someone is holding shopping in the other hand.
 *
 * Built on PanResponder and Animated from React Native core rather than
 * Reanimated or Gesture Handler. Both are installed, but Gesture Handler needs
 * a root provider this app does not mount and Reanimated needs its babel
 * plugin — core works on web and native with neither, and a 44px knob moving
 * along one axis does not need the UI thread.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  disabled = false,
  disabledLabel,
  pending = false,
  pendingLabel = 'Confirming…',
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  /**
   * What the track says while disabled. Without it a dimmed track carrying
   * the normal label reads as a slider that does not work, and gets reported
   * as one — which is exactly what happened. The reason belongs on the control.
   */
  disabledLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  // Read inside the responder without re-creating it on every render.
  const maxRef = useRef(0);
  const lockedRef = useRef(false);
  maxRef.current = Math.max(0, trackWidth - KNOB - PADDING * 2);

  /**
   * The handler, kept fresh.
   *
   * The PanResponder below is built once in a ref, so everything it closes over
   * is frozen at first render — including `onConfirm`. The callers pass an
   * arrow function that reads component state, so the frozen copy kept seeing
   * the state as it was when the control mounted: on the delivery step that
   * meant submitting the delivery code the rider had typed *before* the slider
   * appeared, which is to say an empty one.
   *
   * Reading through a ref that every render updates keeps the responder stable
   * and the handler current.
   */
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  const settle = (to: number, then?: () => void) =>
    Animated.spring(x, {
      toValue: to,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start(then);

  /**
   * Confirm exactly once, however it gets triggered.
   *
   * The knob has to finish travelling before the action fires, or the handler
   * navigates away and unmounts the screen mid-spring — which is what turned
   * the ball's run to the end into a jump. But the action cannot be left
   * depending on an animation callback either: an interrupted spring, or a view
   * that detaches first, drops it and the confirmation is lost silently.
   *
   * So both fire it, and this gate makes the second one a no-op. The animation
   * gets to be decoration again without being load-bearing.
   */
  const firedRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireOnce = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    confirmRef.current();
  };

  // The spring at speed 18 lands in roughly a quarter second; this is the
  // backstop for when its callback never arrives, not the normal path.
  const FIRE_FALLBACK_MS = 450;

  useEffect(
    () => () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    },
    []
  );

  const responder = useRef(
    PanResponder.create({
      /**
       * Claim on touch-down, not only on the first horizontal move.
       *
       * With only onMoveShouldSetPanResponder, Android sometimes never delivers
       * the move events to this view at all — a parent has already taken the
       * touch by the time the knob asks for it — and the drag does nothing.
       * Claiming at start is what makes it reliable there.
       *
       * Safe to do because the knob lives in a sticky bar outside any
       * ScrollView, so there is no vertical scroll to steal from.
       */
      onStartShouldSetPanResponder: () => !lockedRef.current,
      onMoveShouldSetPanResponder: (_e, g) =>
        !lockedRef.current && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        if (lockedRef.current) return;
        x.setValue(Math.min(Math.max(0, g.dx), maxRef.current));
      },
      onPanResponderRelease: (_e, g) => {
        if (lockedRef.current) return;
        const max = maxRef.current;
        const travelled = Math.min(Math.max(0, g.dx), max);

        /**
         * 70%, not 100%. Requiring the knob to touch the very end means the
         * last few pixels decide the outcome, and a rider dragging with a thumb
         * on a wet phone loses the gesture there for no reason. Far enough to be
         * unmistakably deliberate, short enough to be reachable.
         */
        if (max > 0 && travelled >= max * 0.7) {
          lockedRef.current = true;
          firedRef.current = false;
          // The knob runs to the end and fires on arrival; the timer covers the
          // case where that arrival is never reported. fireOnce makes whichever
          // lands second a no-op.
          settle(max, fireOnce);
          fallbackRef.current = setTimeout(fireOnce, FIRE_FALLBACK_MS);
        } else {
          settle(0);
        }
      },
      onPanResponderTerminate: () => settle(0),
    })
  ).current;

  /**
   * A finished or failed action releases the lock and returns the knob, so a
   * failed confirm can be retried rather than leaving a stuck control.
   *
   * In an effect, not during render. Starting an animation while rendering is a
   * side effect, and React Compiler is enabled on this app — a render it
   * chooses to repeat or discard would fire this more than once, or not at all.
   */
  useEffect(() => {
    if (!pending && lockedRef.current) {
      lockedRef.current = false;
      // Re-arm, or a retry after a failed confirm would be swallowed by the
      // once-gate from the previous attempt.
      firedRef.current = false;
      if (fallbackRef.current) {
        clearTimeout(fallbackRef.current);
        fallbackRef.current = null;
      }
      settle(0);
    }
    // settle is stable enough for this: it only closes over `x`, a ref value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const inert = disabled || pending;

  // The label fades out as the knob covers it — the gesture reads as revealing
  // the outcome rather than dragging something across the words.
  const labelOpacity = x.interpolate({
    inputRange: [0, Math.max(1, maxRef.current * 0.6)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[shadow.card, { height: TRACK_HEIGHT, padding: PADDING }]}
      className={`rounded-full justify-center overflow-hidden ${
        inert ? 'bg-pink-600/40' : 'bg-pink-600'
      }`}
      /**
       * Announced as a button and activatable by tap for assistive tech. A
       * screen reader user cannot perform a drag, so refusing the tap outright
       * would lock them out of confirming a delivery entirely — the friction is
       * there to prevent accidents, not to exclude anyone.
       */
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert }}
      onAccessibilityTap={() => {
        if (!inert) onConfirm();
      }}
    >
      <Animated.Text
        style={{ opacity: labelOpacity }}
        className="text-white text-[15px] font-semibold text-center"
      >
        {pending ? pendingLabel : disabled && disabledLabel ? disabledLabel : label}
      </Animated.Text>

      <Animated.View
        {...(inert ? {} : responder.panHandlers)}
        style={{
          transform: [{ translateX: x }],
          position: 'absolute',
          left: PADDING,
          width: KNOB,
          height: KNOB,
        }}
        className="rounded-full bg-white items-center justify-center"
      >
        {pending ? (
          <ActivityIndicator color={colors.pink[600]} />
        ) : (
          <Ionicons name="arrow-forward" size={20} color={colors.pink[600]} />
        )}
      </Animated.View>
    </View>
  );
}
