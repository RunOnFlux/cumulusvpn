/**
 * Which connection changes deserve a system notification — the desktop
 * counterpart of the ongoing VPN notification on Android.
 *
 * Only changes the user did not just cause themselves: a tunnel coming up
 * after a connect (the window may be hidden by then), dropping on its own, and
 * coming back. A user Disconnect is silent, and so is reattaching to a session
 * at launch.
 */
import type { Phase } from '../hooks/useConnection.js';

export interface Notice {
  readonly title: string;
  readonly body: string;
}

export interface NoticeContext {
  /** e.g. "🇩🇪 Germany · Frankfurt"; empty when unknown. */
  readonly place: string;
  readonly killSwitch: boolean;
}

export function noticeFor(prev: Phase, next: Phase, ctx: NoticeContext): Notice | null {
  if (prev === next) {
    return null;
  }
  const where = ctx.place ? ` — ${ctx.place}` : '';
  if (next === 'connected' && prev === 'connecting') {
    return { title: 'CumulusVPN connected', body: `Your traffic is protected${where}.` };
  }
  if (next === 'connected' && prev === 'error') {
    return { title: 'CumulusVPN reconnected', body: `Protected again${where}.` };
  }
  if (next === 'error' && prev === 'connected') {
    return {
      title: 'CumulusVPN connection lost',
      body: ctx.killSwitch
        ? 'Kill switch is blocking traffic while CumulusVPN reconnects.'
        : 'Reconnecting… Your traffic is not protected until it is back.',
    };
  }
  return null;
}
