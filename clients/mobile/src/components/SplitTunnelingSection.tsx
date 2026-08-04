/**
 * Split tunneling editor (docs/17-split-tunneling.md §8): global mode, LAN
 * bypass, and IP/CIDR rules. Lives inline in Settings — mobile has no nested
 * navigation, and the surface is small (domain rules are deferred; Android app
 * rules are Phase 2 and get their own picker then; iOS can never do per-app).
 *
 * Premium-only (§7.6): rules can be authored on any tier; activating a
 * non-off mode needs premium. Enforcement is re-checked at connect time in
 * `useVpn.splitForSession` — this UI's job is honesty, not enforcement. The
 * policy itself is device-local and never leaves the phone.
 */
import { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { EMPTY_POLICY, normalizeSplitRule } from '@cumulusvpn/core';
import type { SplitMode, SplitPolicy, SplitRule, Tier } from '@cumulusvpn/core';
import { CumulusTunnel, type InstalledApp } from '../native/CumulusTunnel';
import { loadSplitPolicy, saveSplitPolicy } from '../state/storage';
import { Toggle } from './Toggle';
import { color, font, radius, space } from '../theme/tokens';

const MODES: readonly (readonly [SplitMode, string])[] = [
  ['off', 'Off'],
  ['exclude', 'Exclude listed'],
  ['include', 'Only these'],
];

interface Props {
  readonly tier: Tier;
  readonly killSwitch: boolean;
  /** True while a session exists — changes then apply on the next connect. */
  readonly locked: boolean;
}

export function SplitTunnelingSection({ tier, killSwitch, locked }: Props): React.JSX.Element {
  const [policy, setPolicy] = useState<SplitPolicy>(EMPTY_POLICY);
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const premium = tier === 'premium';

  useEffect(() => {
    let alive = true;
    void loadSplitPolicy().then((p) => {
      if (alive) {
        setPolicy(p);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = (next: SplitPolicy): void => {
    setPolicy(next);
    void saveSplitPolicy(next);
  };

  const onAdd = (): void => {
    const value = draft.trim();
    if (value === '') {
      return;
    }
    try {
      const rule = normalizeSplitRule({ kind: 'cidr', value });
      if (!policy.rules.some((r) => r.kind === 'cidr' && r.value === rule.value)) {
        update({ ...policy, rules: [...policy.rules, rule] });
      }
      setDraft('');
      setInputError(null);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : 'Not a valid IP or CIDR range.');
    }
  };

  const cidrRules = policy.rules.filter((r) => r.kind === 'cidr');
  const appRules = policy.rules.filter((r) => r.kind === 'app' && r.platform === 'android');
  const active = policy.mode !== 'off' || policy.lanBypass;
  const [pickerOpen, setPickerOpen] = useState(false);
  // iOS kill switch (`includeAllNetworks`) disregards route carve-outs
  // (docs/17 §4.5) — with both on, the kill switch wins at connect time.
  const iosConflict = Platform.OS === 'ios' && killSwitch && active;

  return (
    <View style={styles.card}>
      <View style={styles.modes} accessibilityRole="radiogroup">
        {MODES.map(([mode, label]) => (
          <Pressable
            key={mode}
            style={[styles.mode, policy.mode === mode && styles.modeOn]}
            disabled={!premium && mode !== 'off'}
            onPress={() => update({ ...policy, mode })}
            accessibilityRole="radio"
            accessibilityState={{ selected: policy.mode === mode }}
          >
            <Text
              style={[
                styles.modeText,
                policy.mode === mode && styles.modeTextOn,
                !premium && mode !== 'off' && styles.modeTextDisabled,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {!premium && (
        <Text style={styles.note}>
          Split tunneling is a Premium feature — upgrade to route only the traffic you choose.
        </Text>
      )}

      {policy.mode !== 'off' && (
        <Text style={styles.warn}>
          {policy.mode === 'exclude'
            ? 'Excluded traffic leaves this device unprotected and shows your real IP address.'
            : 'Only the listed destinations are protected — everything else shows your real IP address.'}
        </Text>
      )}
      {iosConflict && (
        <Text style={styles.warn}>
          The kill switch routes all traffic through the VPN, so these rules are not applied while
          it is on. Turn the kill switch off to use split tunneling.
        </Text>
      )}

      <View style={styles.lanRow}>
        <Text style={styles.lanLabel}>Allow local network access (printers, NAS, casting)</Text>
        <Toggle
          value={policy.lanBypass}
          disabled={!premium}
          onValueChange={(v) => update({ ...policy, lanBypass: v })}
        />
      </View>

      {policy.mode !== 'off' && Platform.OS === 'ios' && (
        /* docs/17 D4: per-app rules on iOS are impossible for consumer apps —
           say so plainly rather than omit the section (users arrive from
           Android expecting it; an honest sentence converts better). */
        <Text style={styles.note}>
          Per-app rules aren’t available on iPhone and iPad — Apple restricts per-app VPN routing to
          devices managed by an organisation. IP rules below work normally.
        </Text>
      )}
      {policy.mode !== 'off' && Platform.OS === 'android' && (
        <>
          {appRules.map((r) => (
            <View key={r.value} style={styles.ruleRow}>
              <Text style={styles.ruleLabel} numberOfLines={1}>
                {r.label ?? r.value}
              </Text>
              <Pressable
                onPress={() =>
                  update({
                    ...policy,
                    rules: policy.rules.filter((x) => !(x.kind === 'app' && x.value === r.value)),
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove app rule ${r.label ?? r.value}`}
                hitSlop={8}
              >
                <Text style={styles.remove}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[styles.addAppBtn, !premium && styles.addBtnDisabled]}
            disabled={!premium}
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.addBtnText}>
              {policy.mode === 'exclude' ? 'Exclude an app…' : 'Add an app…'}
            </Text>
          </Pressable>
          <AppPicker
            visible={pickerOpen}
            onClose={() => setPickerOpen(false)}
            existing={appRules}
            onPick={(app) => {
              setPickerOpen(false);
              try {
                const rule = normalizeSplitRule({
                  kind: 'app',
                  value: app.packageName,
                  label: app.label,
                  platform: 'android',
                });
                if (!policy.rules.some((r) => r.kind === 'app' && r.value === rule.value)) {
                  update({ ...policy, rules: [...policy.rules, rule] });
                }
              } catch {
                // normalizeSplitRule rejects our own identity — nothing to add.
              }
            }}
            onInstalled={(apps) => {
              // Self-heal (docs/17 §4.1): prune rules for apps that are gone.
              // Only launcher apps can be added here, so the launcher list is
              // an authoritative universe for picker-created rules.
              const installed = new Set(apps.map((a) => a.packageName));
              const pruned = policy.rules.filter(
                (r) => r.kind !== 'app' || r.platform !== 'android' || installed.has(r.value),
              );
              if (pruned.length !== policy.rules.length) {
                update({ ...policy, rules: pruned });
              }
            }}
          />
        </>
      )}

      {policy.mode !== 'off' && (
        <>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                setInputError(null);
              }}
              onSubmitEditing={onAdd}
              placeholder="e.g. 192.168.0.0/16 or 203.0.113.7"
              placeholderTextColor={color.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              accessibilityLabel="IP address or CIDR range"
            />
            <Pressable
              style={[styles.addBtn, !draft.trim() && styles.addBtnDisabled]}
              disabled={!draft.trim()}
              onPress={onAdd}
              accessibilityRole="button"
            >
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
          {inputError !== null && <Text style={styles.error}>{inputError}</Text>}
          {cidrRules.length === 0 ? (
            <Text style={styles.note}>No IP rules yet — add a range above.</Text>
          ) : (
            cidrRules.map((r) => (
              <View key={r.value} style={styles.ruleRow}>
                <Text style={styles.ruleText}>{r.value}</Text>
                <Pressable
                  onPress={() =>
                    update({ ...policy, rules: policy.rules.filter((x) => x.value !== r.value) })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove rule ${r.value}`}
                  hitSlop={8}
                >
                  <Text style={styles.remove}>×</Text>
                </Pressable>
              </View>
            ))
          )}
        </>
      )}

      {active && (
        <Text style={styles.note}>
          {locked ? 'Rules apply the next time you connect.' : 'Rules apply when you connect.'}
        </Text>
      )}
    </View>
  );
}

/**
 * Searchable launcher-app picker (docs/17 §8): fed by the native
 * `listInstalledApps` (Android `<queries>`-scoped — no QUERY_ALL_PACKAGES).
 * Apps already in the rule list are shown dimmed rather than hidden, so the
 * user can see why a tap does nothing.
 */
function AppPicker({
  visible,
  existing,
  onPick,
  onClose,
  onInstalled,
}: {
  readonly visible: boolean;
  readonly existing: readonly SplitRule[];
  readonly onPick: (app: InstalledApp) => void;
  readonly onClose: () => void;
  readonly onInstalled: (apps: readonly InstalledApp[]) => void;
}): React.JSX.Element {
  const [apps, setApps] = useState<readonly InstalledApp[]>([]);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let alive = true;
    const list = CumulusTunnel.listInstalledApps;
    if (!list) {
      setFailed(true); // older native build without the method
      return;
    }
    list
      .call(CumulusTunnel)
      .then((result) => {
        if (alive) {
          setApps(result);
          setFailed(false);
          onInstalled(result);
        }
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
    // onInstalled intentionally omitted from the deps: it closes over the
    // CURRENT policy and is only meant to run once per open, on the freshly
    // loaded list.
  }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? apps.filter(
        (a) => a.label.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
      )
    : apps;
  const chosen = new Set(existing.map((r) => r.value));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={pickerStyles.root}>
        <View style={pickerStyles.header}>
          <Text style={pickerStyles.title}>Choose an app</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={pickerStyles.done}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          style={pickerStyles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps"
          placeholderTextColor={color.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {failed ? (
          <Text style={pickerStyles.empty}>Could not load the app list.</Text>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(a) => a.packageName}
            renderItem={({ item }) => {
              const already = chosen.has(item.packageName);
              return (
                <Pressable
                  style={[pickerStyles.row, already && pickerStyles.rowChosen]}
                  disabled={already}
                  onPress={() => onPick(item)}
                  accessibilityRole="button"
                >
                  <Text style={pickerStyles.label} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={pickerStyles.pkg} numberOfLines={1}>
                    {item.packageName}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={pickerStyles.empty}>
                {apps.length === 0 ? 'Loading apps…' : 'No apps match your search.'}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sky1, paddingHorizontal: space.xl, paddingTop: space.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  title: { color: color.ink, fontWeight: '700', fontSize: 17 },
  done: { color: color.cyan, fontWeight: '600', fontSize: 15 },
  search: {
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    color: color.ink,
    fontSize: 14,
    marginBottom: space.sm,
  },
  row: {
    paddingVertical: 10,
    borderBottomColor: color.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowChosen: { opacity: 0.4 },
  label: { color: color.ink, fontSize: 15 },
  pkg: { color: color.inkFaint, fontFamily: font.mono, fontSize: 11, marginTop: 1 },
  empty: { color: color.inkFaint, fontSize: 13, textAlign: 'center', marginTop: space.xl },
});

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
  modes: { flexDirection: 'row', gap: space.xs },
  mode: {
    flex: 1,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modeOn: { borderColor: color.amber },
  modeText: { color: color.inkDim, fontSize: 12.5, fontWeight: '600' },
  modeTextOn: { color: color.ink },
  modeTextDisabled: { opacity: 0.45 },
  warn: { color: color.amber, fontSize: 12, lineHeight: 17 },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17 },
  lanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  lanLabel: { color: color.inkDim, fontSize: 13, flex: 1 },
  addRow: { flexDirection: 'row', gap: space.xs },
  input: {
    flex: 1,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    color: color.ink,
    fontFamily: font.mono,
    fontSize: 13,
  },
  addBtn: {
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.45 },
  addBtnText: { color: color.ink, fontSize: 13, fontWeight: '600' },
  addAppBtn: {
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 9,
    alignItems: 'center',
  },
  ruleLabel: { color: color.inkDim, fontSize: 13, flex: 1 },
  error: { color: color.amber, fontSize: 12 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  ruleText: { color: color.inkDim, fontFamily: font.mono, fontSize: 13 },
  remove: { color: color.inkFaint, fontSize: 18, paddingHorizontal: 4 },
});
