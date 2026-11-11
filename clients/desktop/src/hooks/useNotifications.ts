/**
 * Sends the system notifications chosen by `noticeFor` (lib/notify.ts) while
 * the user has them on (Settings → Notifications, default on).
 */
import { isTauri } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useEffect, useRef } from 'react';
import type { ConnectionModel, Phase } from './useConnection.js';
import { noticeFor } from '../lib/notify.js';

/** Ask once, when needed; macOS remembers the answer. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  try {
    if (await isPermissionGranted()) {
      return true;
    }
    return (await requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function useNotifications(conn: ConnectionModel): void {
  const prevRef = useRef<Phase>(conn.phase);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = conn.phase;
    if (!conn.notifications) {
      return;
    }
    const s = conn.selected;
    const place = s ? [`${s.flag} ${s.name}`, s.city].filter(Boolean).join(' · ') : '';
    const notice = noticeFor(prev, conn.phase, { place, killSwitch: conn.killSwitch });
    if (!notice) {
      return;
    }
    void ensureNotificationPermission().then((ok) => {
      if (ok) {
        sendNotification(notice);
      }
    });
  }, [conn.phase, conn.notifications, conn.selected, conn.killSwitch]);
}
