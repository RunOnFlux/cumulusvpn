/**
 * Identity backup + recovery key (Settings). The identity is this device's key
 * and premium is paid to it, so this is where a user makes sure deleting the
 * app — or losing the phone — doesn't lose what they paid for
 * (state/identity.ts).
 *
 * Every action that changes WHICH identity the device runs, or deletes a copy
 * of one, asks first and names the codes involved: a paid identity replaced by
 * a stray tap is not recoverable.
 */
import { useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  InvalidRecoveryKeyError,
  paymentCode,
} from '@cumulusvpn/core';
import type { IdentityBackupModel, VpnActions, VpnModel } from '../state/useVpn';
import { Toggle } from './Toggle';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly vpn: VpnModel & VpnActions;
}

/** `2J8Y…AwLD` — enough to tell two identities apart at a glance. */
function short(code: string): string {
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
}

function backupLine(b: IdentityBackupModel): string {
  if (!b.enabled) {
    return 'Off. Deleting the app deletes this identity unless you saved the recovery key.';
  }
  switch (b.where) {
    case 'cloud':
      return 'Backed up with Google, end-to-end encrypted with your screen lock. Reinstalling or setting up a new phone brings it back.';
    case 'device':
      return Platform.OS === 'ios'
        ? 'Kept in this iPhone’s Keychain, so deleting and reinstalling the app brings it back.'
        : 'Kept on this phone through reinstalls while Google backup is on. Set a screen lock to also back it up with Google, end-to-end encrypted.';
    case 'unavailable':
      return 'Not available on this phone (it needs Google Play services). Save your recovery key instead.';
    default:
      return b.other
        ? 'Paused: the backup holds a different identity (below).'
        : 'Couldn’t confirm the backup just now. It retries on the next launch.';
  }
}

function keyError(e: unknown): string {
  if (e instanceof InvalidRecoveryKeyError) {
    if (e.reason === 'checksum') {
      return 'That key has a typo. Check it character by character.';
    }
    if (e.reason === 'version') {
      return 'That key is from a newer CumulusVPN. Update the app, then try again.';
    }
    return 'That doesn’t look like a CumulusVPN recovery key.';
  }
  return e instanceof Error ? e.message : String(e);
}

export function IdentitySection({ vpn }: Props): React.JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const b = vpn.identityBackup;
  const code = vpn.payment?.code ?? null;
  const key = vpn.keypair ? encodeRecoveryKey(vpn.keypair.privateKey) : null;

  const run = async (fn: () => Promise<void>, ok: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(ok);
    } catch (e) {
      setError(keyError(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (enabled: boolean): void => {
    if (enabled) {
      void vpn.setIdentityBackup(true);
      return;
    }
    Alert.alert(
      'Turn off backup?',
      'This deletes the backup. If you then delete the app, this identity — and any premium on it — can’t be brought back unless you saved the recovery key.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => void vpn.setIdentityBackup(false),
        },
      ],
    );
  };

  const onRestore = (): void => {
    let next: string;
    try {
      next = paymentCode(decodeRecoveryKey(input).publicKey);
    } catch (e) {
      setError(keyError(e));
      return;
    }
    if (next === code) {
      setError('That is already this device’s identity.');
      return;
    }
    Alert.alert(
      'Restore this identity?',
      `This device switches to identity ${short(next)} and the VPN disconnects.` +
        (code
          ? ` Premium paid to the current identity (${short(code)}) stays with it — save its recovery key first if it has any.`
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () =>
            void run(async () => {
              await vpn.restoreIdentity(input);
              setInput('');
              setRestoring(false);
              setShowKey(false);
            }, 'Restored. Premium on this identity shows within a minute.'),
        },
      ],
    );
  };

  const onSwitch = (other: string): void => {
    Alert.alert(
      'Switch identity?',
      `This device switches to the backed-up identity ${short(other)} and the VPN disconnects.` +
        (code
          ? ` Save the recovery key of the current one (${short(code)}) first if it has premium.`
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: () =>
            void run(
              () => vpn.switchToBackedUpIdentity(),
              'Switched. Premium on this identity shows within a minute.',
            ),
        },
      ],
    );
  };

  const onKeepCurrent = (other: string): void => {
    Alert.alert(
      'Replace the backup?',
      `The backed-up identity ${short(other)} stops being backed up. Any premium on it is lost unless you have its recovery key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () =>
            void run(() => vpn.replaceBackupWithCurrent(), 'This identity is now the backup.'),
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      {vpn.identityRestored && (
        <Text style={styles.ok}>Welcome back — this identity was restored from the backup.</Text>
      )}
      <View style={styles.toggleRow}>
        <View style={styles.meta}>
          <Text style={styles.title}>Back up identity</Text>
          <Text style={styles.note}>{backupLine(b)}</Text>
        </View>
        <Toggle value={b.enabled} disabled={busy} onValueChange={onToggle} />
      </View>

      {b.enabled && b.other && (
        <View style={styles.alert}>
          <Text style={styles.warn}>
            The backup holds a different identity ({short(b.other.code)})
            {code ? ` than this device (${short(code)})` : ''}. If that’s the one you paid for,
            switch to it.
          </Text>
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.btn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => b.other && onSwitch(b.other.code)}
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>Switch to it</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => b.other && onKeepCurrent(b.other.code)}
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>Keep this one</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable
        style={styles.btn}
        onPress={() => setShowKey((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={showKey ? 'Hide recovery key' : 'Show recovery key'}
      >
        <Text style={styles.btnText}>{showKey ? 'Hide recovery key' : 'Show recovery key'}</Text>
      </Pressable>
      {showKey && key && (
        <>
          <Text style={styles.key} selectable>
            {key}
          </Text>
          <Text style={styles.warn}>
            Anyone with this key gets this device’s identity and its premium. Keep it private — a
            password manager is a good place. It works on a new phone, or after reinstalling.
          </Text>
          <Pressable
            style={styles.btn}
            onPress={() => void Share.share({ message: key })}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Save or share…</Text>
          </Pressable>
        </>
      )}

      <Pressable
        style={styles.btn}
        onPress={() => {
          setRestoring((v) => !v);
          setError(null);
          setDone(null);
        }}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>
          {restoring ? 'Cancel restore' : 'Restore from recovery key'}
        </Text>
      </Pressable>
      {restoring && (
        <View style={styles.restoreRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="CVPN-…"
            placeholderTextColor={color.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            accessibilityLabel="Recovery key"
          />
          <Pressable
            style={[styles.btn, (busy || input.trim() === '') && styles.btnDisabled]}
            disabled={busy || input.trim() === ''}
            onPress={onRestore}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>{busy ? 'Restoring…' : 'Restore'}</Text>
          </Pressable>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {done && <Text style={styles.ok}>{done}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  meta: { flex: 1 },
  title: { color: color.ink, fontSize: 15, fontWeight: '600' },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  warn: { color: color.amber, fontSize: 12, lineHeight: 17 },
  ok: { color: color.green, fontSize: 12, lineHeight: 17 },
  error: { color: color.amber, fontSize: 12 },
  alert: { gap: space.sm },
  btnRow: { flexDirection: 'row', gap: space.xs },
  btn: {
    flexGrow: 1,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: color.ink, fontSize: 13, fontWeight: '600' },
  key: { color: color.ink, fontFamily: font.mono, fontSize: 13, lineHeight: 19 },
  restoreRow: { gap: space.xs },
  input: {
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    color: color.ink,
    fontFamily: font.mono,
    fontSize: 13,
    minHeight: 60,
  },
});
