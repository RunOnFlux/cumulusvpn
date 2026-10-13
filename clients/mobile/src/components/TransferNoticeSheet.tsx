/**
 * The one-time "save your recovery key" prompt (flag `transferNotice`,
 * state/useTransferNotice.ts). A small sheet over Connect; either button hides
 * it for good. "Show recovery key" opens Settings at the identity section with
 * the key already revealed (components/IdentitySection.tsx), so the key is only
 * ever shown in one place.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, space } from '../theme/tokens';

interface Props {
  readonly visible: boolean;
  readonly onShowKey: () => void;
  readonly onDismiss: () => void;
}

export function TransferNoticeSheet({ visible, onShowKey, onDismiss }: Props): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Save your recovery key
          </Text>
          <Text style={styles.body}>
            Your Premium belongs to this device’s identity. With its recovery key, you can bring it
            back after reinstalling the app or on a new phone. A password manager is a good place to
            keep it.
          </Text>
          <Pressable
            style={[styles.btn, styles.primary]}
            onPress={onShowKey}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Show recovery key</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onDismiss} accessibilityRole="button">
            <Text style={styles.btnText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xxl,
    backgroundColor: 'rgba(5,12,22,0.6)',
  },
  sheet: {
    backgroundColor: color.sky1,
    borderColor: color.hairlineStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.xl,
    gap: space.md,
  },
  title: { color: color.ink, fontSize: 18, fontWeight: '700' },
  body: { color: color.inkMuted, fontSize: 14, lineHeight: 20 },
  btn: {
    borderColor: color.hairlineStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primary: { backgroundColor: color.cyan, borderColor: color.cyan },
  primaryText: { color: color.sky1, fontSize: 15, fontWeight: '700' },
  btnText: { color: color.ink, fontSize: 15, fontWeight: '600' },
});
