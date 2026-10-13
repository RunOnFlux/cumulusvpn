/**
 * Keeps focused text fields above the on-screen keyboard on Android.
 *
 * RN 0.87 draws edge-to-edge on Android (`edgeToEdgeEnabled=true` in
 * android/gradle.properties), so `adjustResize` no longer shrinks the window
 * for the keyboard, and the keyboard covers whatever sits low on the screen
 * (the redeem field, the recovery-key and split-tunnel fields in Settings, the
 * bottom of the country list). This pads the screen's bottom by the part the
 * keyboard covers, shrinking the screen inside it: a ScrollView that shrinks
 * scrolls its focused field back into view (Android's ScrollView does that on
 * resize), which is what `adjustResize` used to give us.
 *
 * iOS never resized for the keyboard. Its scroll views use
 * `automaticallyAdjustKeyboardInsets` (inset + scroll to the focused field)
 * instead, so this stays off there rather than adjusting twice.
 *
 * Place it as the direct child of the full-window SafeAreaView (App.tsx).
 * KeyboardAvoidingView measures itself relative to its parent and compares that
 * with the keyboard's top in window coordinates; a parent at the window's top
 * makes the two agree (the safe-area padding is then part of the measured
 * frame), so no `keyboardVerticalOffset` is needed.
 */
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  readonly style?: StyleProp<ViewStyle>;
  readonly children: React.ReactNode;
}

export function KeyboardAvoidingScreen({ style, children }: Props): React.JSX.Element {
  return (
    <KeyboardAvoidingView style={style} behavior="padding" enabled={Platform.OS === 'android'}>
      {children}
    </KeyboardAvoidingView>
  );
}
