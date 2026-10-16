/**
 * Render test for the DNS choice section: the options in core's order with the
 * default labelled, the exact privacy note, a tap persisting the choice and
 * reporting the change, and the reconnect note only while a session exists.
 */
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DnsSection } from './DnsSection';
import { loadDnsChoice } from '../state/storage';

/** Collect the text content rendered anywhere in the tree. */
function textOf(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .flatMap((node) => node.findAll((n) => typeof n.children[0] === 'string'))
    .map((n) => n.children.join(''))
    .join(' ');
}

/** The radio rows, in render order (the pressable itself, not its host view). */
function radios(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function',
  );
}

async function render(
  locked: boolean,
  onChange: () => void = () => undefined,
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<DnsSection locked={locked} onChange={onChange} />);
  });
  return tree;
}

describe('<DnsSection />', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem('cvpn:dnsChoice');
  });

  it('lists the options, default first and labelled, with the privacy note', async () => {
    const tree = await render(false);
    const rows = radios(tree);
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      'Cloudflare, default. Fast, no filtering',
      'Google Public DNS. No filtering',
      'Quad9. Blocks known malicious sites',
      'DNS4EU. EU-based, blocks malware and phishing',
      'AdGuard DNS. Blocks ads and trackers',
      'Cloudflare for Families. Blocks malware and adult content',
    ]);
    expect(rows.map((r) => r.props.accessibilityState.selected)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(textOf(tree)).toContain(
      "Your DNS lookups go through the VPN to the provider you choose. It sees the VPN server's address, never yours.",
    );
    expect(textOf(tree)).not.toContain('reconnects');
    act(() => tree.unmount());
  });

  it('shows the stored choice and persists a new one', async () => {
    await AsyncStorage.setItem('cvpn:dnsChoice', 'quad9');
    const tree = await render(false);
    expect(radios(tree)[2]!.props.accessibilityState.selected).toBe(true);
    await act(async () => {
      radios(tree)[4]!.props.onPress();
    });
    expect(radios(tree)[4]!.props.accessibilityState.selected).toBe(true);
    await expect(loadDnsChoice()).resolves.toBe('adguard');
    act(() => tree.unmount());
  });

  it('reports a change once it is saved, but not a re-tap of the current choice', async () => {
    const onChange = jest.fn(async () => {
      // The reconnect this triggers must already see the new choice.
      await expect(loadDnsChoice()).resolves.toBe('google');
    });
    const tree = await render(true, onChange);
    await act(async () => {
      radios(tree)[0]!.props.onPress(); // Cloudflare, already selected
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      radios(tree)[1]!.props.onPress();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    await onChange.mock.results[0]!.value;
    act(() => tree.unmount());
  });

  it('says a change reconnects while a session exists', async () => {
    const tree = await render(true);
    expect(textOf(tree)).toContain('Changing it reconnects the VPN.');
    act(() => tree.unmount());
  });
});
