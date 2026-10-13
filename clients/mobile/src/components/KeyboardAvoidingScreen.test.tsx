/**
 * The Android keyboard fix (KeyboardAvoidingScreen), driven through React
 * Native's real KeyboardAvoidingView: a layout like the one App.tsx gives it
 * (inside the full-window SafeAreaView, so its frame starts below the status
 * bar), then the keyboard events Android sends. What matters is the bottom
 * padding: it must equal the part of the screen the keyboard covers, so the
 * screen inside ends exactly at the keyboard's top.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAvoidingScreen } from './KeyboardAvoidingScreen';

// A 915-dp-tall edge-to-edge window: 48 dp status bar, 24 dp gesture nav bar.
const WINDOW_H = 915;
const TOP = 48;
const NAV = 24;
const FRAME = { x: 0, y: TOP, width: 412, height: WINDOW_H - TOP - NAV };

function setOS(os: 'android' | 'ios'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <KeyboardAvoidingScreen style={{ flex: 1 }}>
        <Text>screen</Text>
      </KeyboardAvoidingScreen>,
    );
  });
  return tree;
}

/** The KeyboardAvoidingView's own View (the one carrying the padding). */
function outerView(tree: ReactTestRenderer) {
  const kav = tree.root.findByType(KeyboardAvoidingView);
  return kav.findAllByType(View)[0]!;
}

async function layout(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    await outerView(tree).props.onLayout({ persist() {}, nativeEvent: { layout: FRAME } });
  });
}

async function keyboard(event: 'keyboardDidShow' | 'keyboardDidHide', imeHeight: number) {
  // What ReactRootView sends: screenY = the keyboard's top, height = IME minus nav bar.
  await act(async () => {
    DeviceEventEmitter.emit(event, {
      duration: 0,
      easing: 'keyboard',
      endCoordinates: {
        screenX: 0,
        screenY: WINDOW_H - imeHeight,
        width: 412,
        height: Math.max(imeHeight - NAV, 0),
      },
    });
  });
}

const paddingBottom = (tree: ReactTestRenderer): number | undefined =>
  StyleSheet.flatten(outerView(tree).props.style)?.paddingBottom as number | undefined;

const originalOS = Platform.OS;
afterEach(() => setOS(originalOS as 'android' | 'ios'));

describe('<KeyboardAvoidingScreen /> on Android', () => {
  beforeEach(() => setOS('android'));

  it('pads the screen by exactly what the keyboard covers', async () => {
    const tree = render();
    await layout(tree);
    expect(paddingBottom(tree) ?? 0).toBe(0);

    await keyboard('keyboardDidShow', 336);
    // The keyboard covers the nav bar too; only the part above it matters.
    expect(paddingBottom(tree)).toBe(336 - NAV);
    // So the screen inside now ends at the keyboard's top.
    expect(FRAME.y + FRAME.height - (paddingBottom(tree) ?? 0)).toBe(WINDOW_H - 336);

    await keyboard('keyboardDidHide', 0);
    expect(paddingBottom(tree) ?? 0).toBe(0);
    act(() => tree.unmount());
  });

  it('follows a keyboard that changes height while open (e.g. the emoji panel)', async () => {
    const tree = render();
    await layout(tree);
    await keyboard('keyboardDidShow', 300);
    await keyboard('keyboardDidShow', 420);
    expect(paddingBottom(tree)).toBe(420 - NAV);
    act(() => tree.unmount());
  });
});

describe('<KeyboardAvoidingScreen /> on iOS', () => {
  beforeEach(() => setOS('ios'));

  it('leaves the layout alone (the scroll views inset themselves there)', async () => {
    const tree = render();
    await layout(tree);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillShow', {
        duration: 250,
        easing: 'keyboard',
        endCoordinates: { screenX: 0, screenY: WINDOW_H - 336, width: 412, height: 336 },
      });
    });
    expect(paddingBottom(tree) ?? 0).toBe(0);
    act(() => tree.unmount());
  });
});
