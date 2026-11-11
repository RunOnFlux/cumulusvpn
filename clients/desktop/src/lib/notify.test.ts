import { describe, expect, it } from 'vitest';
import { noticeFor } from './notify';

const ctx = { place: '🇩🇪 Germany · Frankfurt', killSwitch: true };

describe('noticeFor', () => {
  it('announces a connect, a drop and a recovery', () => {
    expect(noticeFor('connecting', 'connected', ctx)?.title).toBe('CumulusVPN connected');
    expect(noticeFor('connecting', 'connected', ctx)?.body).toContain('Germany · Frankfurt');
    expect(noticeFor('connected', 'error', ctx)?.body).toContain('Kill switch is blocking');
    expect(noticeFor('connected', 'error', { ...ctx, killSwitch: false })?.body).toContain(
      'not protected',
    );
    expect(noticeFor('error', 'connected', ctx)?.title).toBe('CumulusVPN reconnected');
  });

  it('stays quiet for what the user did, and for a reattach at launch', () => {
    expect(noticeFor('connected', 'idle', ctx)).toBeNull();
    expect(noticeFor('idle', 'connecting', ctx)).toBeNull();
    expect(noticeFor('loading', 'connected', ctx)).toBeNull();
    expect(noticeFor('connecting', 'error', ctx)).toBeNull();
    expect(noticeFor('connected', 'connected', ctx)).toBeNull();
  });
});
