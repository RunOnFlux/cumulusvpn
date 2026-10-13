import { shouldShowTransferNotice, type TransferNoticeInput } from './transferNotice';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const base: TransferNoticeInput = {
  enabled: true,
  tier: 'premium',
  paidUntil: '2026-11-13T12:00:00Z',
  seen: false,
  now: NOW,
};

describe('shouldShowTransferNotice', () => {
  it('shows once the flag is on, to a device with premium time left', () => {
    expect(shouldShowTransferNotice(base)).toBe(true);
  });

  it('stays hidden while the flag is off (the default)', () => {
    expect(shouldShowTransferNotice({ ...base, enabled: false })).toBe(false);
  });

  it('is only for devices with something to lose', () => {
    expect(shouldShowTransferNotice({ ...base, tier: 'free', paidUntil: null })).toBe(false);
    expect(shouldShowTransferNotice({ ...base, paidUntil: '2026-10-01T00:00:00Z' })).toBe(false);
  });

  it('shows to premium with an unknown or unparseable expiry (the tier is the truth)', () => {
    expect(shouldShowTransferNotice({ ...base, paidUntil: null })).toBe(true);
    expect(shouldShowTransferNotice({ ...base, paidUntil: 'soon' })).toBe(true);
  });

  it('never shows again once seen, and not before that is known', () => {
    expect(shouldShowTransferNotice({ ...base, seen: true })).toBe(false);
    expect(shouldShowTransferNotice({ ...base, seen: null })).toBe(false);
  });
});
