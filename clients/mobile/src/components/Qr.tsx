/**
 * A scannable QR code rendered with plain React Native Views — no native SVG /
 * canvas dependency, so it ships in the JS bundle. The dark modules of each row
 * are merged into horizontal runs (run-length) to keep the view count low.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import qrcode from 'qrcode-generator';

interface Props {
  readonly value: string;
  /** Rendered size in px (the code is square). */
  readonly size?: number;
}

const QUIET_MODULES = 2; // white "quiet zone" border, in modules

export function Qr({ value, size = 190 }: Props): React.JSX.Element {
  const { runs, cell } = useMemo(() => {
    const qr = qrcode(0, 'M'); // auto version, medium error correction
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cellSize = size / (count + QUIET_MODULES * 2);
    const offset = QUIET_MODULES * cellSize;
    const out: { x: number; y: number; w: number }[] = [];
    for (let r = 0; r < count; r += 1) {
      let c = 0;
      while (c < count) {
        if (qr.isDark(r, c)) {
          const start = c;
          while (c < count && qr.isDark(r, c)) {
            c += 1;
          }
          out.push({
            x: offset + start * cellSize,
            y: offset + r * cellSize,
            w: (c - start) * cellSize,
          });
        } else {
          c += 1;
        }
      }
    }
    return { runs: out, cell: cellSize };
  }, [value, size]);

  return (
    <View
      style={{ width: size, height: size, backgroundColor: '#fff', borderRadius: 12 }}
      accessibilityLabel="Payment QR code"
    >
      {runs.map((run, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: run.x,
            top: run.y,
            width: run.w,
            height: cell,
            backgroundColor: '#000',
          }}
        />
      ))}
    </View>
  );
}
