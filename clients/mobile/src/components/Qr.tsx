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

// A half-module bleed added to every dark run's width/height. Adjacent modules
// then overlap by ~0.5px so no hairline white seam survives RN's independent
// per-view pixel rounding (the cause of the "white stripes"). Harmless to
// scanning — the overlap only ever grows dark into a neighbouring cell edge.
const BLEED = 0.5;

export function Qr({ value, size = 190 }: Props): React.JSX.Element {
  const { runs, cell, dim } = useMemo(() => {
    const qr = qrcode(0, 'M'); // auto version, medium error correction
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const total = count + QUIET_MODULES * 2;
    // Integer module size — fractional cells round inconsistently between rows
    // and leave gaps. The grid renders at `cellSize * total` (≤ size), centred
    // by the caller. Clamp to ≥2px so small screens still scan.
    const cellSize = Math.max(2, Math.floor(size / total));
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
    return { runs: out, cell: cellSize, dim: cellSize * total };
  }, [value, size]);

  return (
    <View
      style={{ width: dim, height: dim, backgroundColor: '#fff', borderRadius: 12 }}
      accessibilityLabel="Payment QR code"
    >
      {runs.map((run, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: run.x,
            top: run.y,
            width: run.w + BLEED,
            height: cell + BLEED,
            backgroundColor: '#000',
          }}
        />
      ))}
    </View>
  );
}
