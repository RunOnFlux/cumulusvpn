/**
 * Component smoke test for the tier pill.
 *
 * `TierPill` is a pure presentational chip whose text flips on the tier, so it
 * makes a good, dependency-light target for verifying the RN render pipeline
 * (babel-preset + react-test-renderer) actually works end to end.
 */
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { TierPill } from './TierPill';

/** Collect the text content rendered anywhere in the tree. */
function textOf(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .flatMap((node) => node.findAll((n) => typeof n.children[0] === 'string'))
    .map((n) => n.children.join(''))
    .join(' ');
}

describe('<TierPill />', () => {
  it('renders the free tier label with its bandwidth cap', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<TierPill tier="free" />);
    });
    expect(textOf(tree)).toContain('FREE');
    expect(textOf(tree)).toContain('100 KB/s');
    act(() => tree.unmount());
  });

  it('renders the premium label for premium', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<TierPill tier="premium" />);
    });
    expect(textOf(tree)).toContain('PREMIUM');
    act(() => tree.unmount());
  });
});
