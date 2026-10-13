/**
 * The one-time "save your recovery key" prompt: what it says and that each
 * button reaches its handler (App.tsx marks it seen on either).
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import { TransferNoticeSheet } from './TransferNoticeSheet';

function render(visible: boolean, onShowKey = jest.fn(), onDismiss = jest.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <TransferNoticeSheet visible={visible} onShowKey={onShowKey} onDismiss={onDismiss} />,
    );
  });
  return { tree, onShowKey, onDismiss };
}

/** Press the button labelled `label` (the nearest ancestor with an onPress). */
function press(tree: ReactTestRenderer, label: string): void {
  let node = tree.root.findAllByType(Text).find((t) => t.props.children === label)?.parent;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  if (!node) {
    throw new Error(`no button "${label}"`);
  }
  const onPress = node.props.onPress as () => void;
  act(() => onPress());
}

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));

describe('<TransferNoticeSheet />', () => {
  it('asks for the recovery key, plainly', () => {
    const { tree } = render(true);
    expect(texts(tree)).toEqual(
      expect.arrayContaining(['Save your recovery key', 'Show recovery key', 'Not now']),
    );
    expect(texts(tree).join(' ')).not.toMatch(/transfer|warning|lose/i);
    act(() => tree.unmount());
  });

  it('routes each button, and the Android back button dismisses', () => {
    const { tree, onShowKey, onDismiss } = render(true);
    press(tree, 'Show recovery key');
    expect(onShowKey).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    press(tree, 'Not now');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(onDismiss).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it('is hidden unless visible', () => {
    const { tree } = render(false);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
    act(() => tree.unmount());
  });
});
