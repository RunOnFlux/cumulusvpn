/**
 * Release versions are plain `major.minor.patch` (tauri.conf.json `version`).
 * True when `candidate` is a later release than `current`. Anything that does
 * not parse is never "newer", so a malformed feed can't nag anyone.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return (a[i] ?? 0) > (b[i] ?? 0);
    }
  }
  return false;
}
