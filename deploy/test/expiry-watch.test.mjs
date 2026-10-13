import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, daysLeft } from '../scripts/expiry-watch.mjs';

const TIP = 3_000_000;
const DAY = 2880; // blocks per day at 30 s

test('daysLeft converts blocks to days at 30 s blocks', () => {
  assert.equal(daysLeft(TIP + DAY * 3, TIP), 3);
});

test('a healthy, fully placed fleet is conclusive with no alerts', () => {
  const r = assess(
    { cumulusvpnde: { registered: true, expiresAt: TIP + DAY * 30, instances: 12, running: 12 } },
    TIP,
    7,
  );
  assert.deepEqual(r, { alerts: [], notes: [], conclusive: true });
});

test('expiring soon and already expired both alert', () => {
  const r = assess(
    {
      cumulusvpnde: { registered: true, expiresAt: TIP + DAY * 4, instances: 12, running: 12 },
      cumulusvpnus: { registered: true, expiresAt: TIP - DAY, instances: 20, running: 20 },
    },
    TIP,
    7,
  );
  assert.equal(r.alerts.length, 2);
  assert.match(r.alerts[0], /cumulusvpnde: expires in 4\.0 days/);
  assert.match(r.alerts[1], /cumulusvpnus: subscription EXPIRED 1\.0 days ago/);
});

test('zero running instances alerts; partial placement is only a note', () => {
  const r = assess(
    {
      cumulusvpnnl: { registered: true, expiresAt: TIP + DAY * 30, instances: 8, running: 0 },
      cumulusvpnmy: { registered: true, expiresAt: TIP + DAY * 30, instances: 6, running: 2 },
    },
    TIP,
    7,
  );
  assert.deepEqual(r.alerts, ['cumulusvpnnl: 0 of 8 instances running — this country is dark']);
  assert.deepEqual(r.notes, ['cumulusvpnmy: 2 of 6 instances running']);
  assert.equal(r.conclusive, true);
});

test('unregistered apps are notes; unreadable data makes the run inconclusive, never an alert', () => {
  const r = assess(
    {
      cumulusvpnse: { registered: false },
      cumulusvpnfr: null,
      cumulusvpnjp: { registered: true, expiresAt: TIP + DAY * 30, instances: 6, running: null },
    },
    TIP,
    7,
  );
  assert.deepEqual(r.alerts, []);
  assert.equal(r.conclusive, false);
  assert.equal(r.notes.length, 3);
});
