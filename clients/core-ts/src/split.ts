/**
 * Split tunneling for `@cumulusvpn/core` (docs/17-split-tunneling.md).
 *
 * One canonical rule model — inclusion/exclusion by application, domain and
 * IP/CIDR — compiled here into primitives each platform backend can enforce
 * (routes, app identity lists, domain matchers). Backends must never interpret
 * a {@link SplitPolicy} themselves; they consume a {@link CompiledSplit}.
 *
 * The whole feature is client-side route/filter policy: no gateway or API
 * change, and rules never leave the device (they are a precise fingerprint of
 * what a user runs — see §3.4 of the design doc).
 *
 * This module is pure math and validation. Enforcement (routing tables, kill
 * switch holes, VpnService builders) lives in the platform clients.
 */

/** Global direction of the policy. */
export type SplitMode = 'off' | 'exclude' | 'include';

/** What a rule matches on. */
export type SplitRuleKind = 'app' | 'domain' | 'cidr';

/**
 * Which platform an `app` rule's value is meaningful on. App identity is not
 * portable (a package name means nothing on Windows), so app rules carry the
 * platform they were authored on and are ignored everywhere else.
 */
export type SplitPlatform = 'android' | 'ios' | 'macos' | 'windows' | 'linux';

export interface SplitRule {
  readonly kind: SplitRuleKind;
  /** Package name / absolute exe path / bundle id / hostname / CIDR. Normalized. */
  readonly value: string;
  /** Human label for the UI ("Google Chrome"). Never used for matching. */
  readonly label?: string;
  /** Required for `kind: 'app'`, absent otherwise. */
  readonly platform?: SplitPlatform;
  /** User can disable a rule without deleting it. Defaults true. */
  readonly enabled?: boolean;
}

export interface SplitPolicy {
  /** Schema version. Bump on any breaking change; migrate on load. */
  readonly version: 1;
  readonly mode: SplitMode;
  readonly rules: readonly SplitRule[];
  /** Canned RFC1918/link-local/ULA/multicast bypass. Independent of `mode`. */
  readonly lanBypass: boolean;
  /**
   * Where excluded traffic resolves names. `'tunnel'` keeps every lookup
   * private but means an excluded destination is still *revealed by* its DNS
   * query going to the gateway; `'system'` sends those lookups to the local
   * resolver, which leaks them to the network but is what most users expect.
   */
  readonly excludedDns: 'tunnel' | 'system';
}

/** The do-nothing policy: full tunnel, no rules. Also the fail-closed fallback. */
export const EMPTY_POLICY: SplitPolicy = {
  version: 1,
  mode: 'off',
  rules: [],
  lanBypass: false,
  excludedDns: 'tunnel',
};

/** A domain rule reduced to what the resolver engine matches on. */
export interface DomainMatcher {
  /** Bare hostname, or the suffix for a `*.` rule (without the `*.`). */
  readonly suffix: string;
  /** True when the rule was `*.example.com` (matches subdomains, not the apex). */
  readonly wildcard: boolean;
}

/**
 * A {@link SplitPolicy} reduced to primitives each OS understands. Produced
 * only by {@link compileSplitPolicy}; consumed by the platform backends.
 *
 * Route semantics: `tunnelRoutes` are destination prefixes that MUST enter the
 * tunnel; `bypassRoutes` MUST egress on the physical interface. In `exclude`
 * mode (and `off` + LAN bypass) the policy is expressed as `bypassRoutes` when
 * the platform can subtract routes natively, or as the pre-computed complement
 * in `tunnelRoutes` when it cannot. In `include` mode `tunnelRoutes` is the
 * inclusion list itself (LAN prefixes already subtracted when `lanBypass` is
 * on) and `bypassRoutes` is always empty — the default is already "direct".
 * With app rules and no CIDR rules in `include` mode, `tunnelRoutes` is empty
 * and backends with app support route the default into the tun for the
 * included apps only.
 */
export interface CompiledSplit {
  /** Destination prefixes that MUST be routed into the tunnel. */
  readonly tunnelRoutes: readonly string[];
  /** Destination prefixes that MUST bypass the tunnel (physical egress). */
  readonly bypassRoutes: readonly string[];
  /** App identities for this platform, in the direction implied by `mode`. */
  readonly appsIncluded: readonly string[];
  readonly appsExcluded: readonly string[];
  /** Domain matchers for the resolver engine, already lowercased. */
  readonly domainsIncluded: readonly DomainMatcher[];
  readonly domainsExcluded: readonly DomainMatcher[];
  /** True when the policy has no effect — backends can take the fast path. */
  readonly isNoop: boolean;
}

/**
 * The canned LAN-bypass prefix set behind the `lanBypass` flag: RFC1918,
 * link-local, ULA, multicast and broadcast. Lets printers, NAS, casting and
 * local dev survive an otherwise full tunnel.
 */
export const LAN_BYPASS_CIDRS: readonly string[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '224.0.0.0/4',
  '255.255.255.255/32',
  'fe80::/10',
  'fc00::/7',
  'ff00::/8',
];

// ---------------------------------------------------------------------------
// IP / CIDR arithmetic. One representation (bigint) for both families so the
// interval math below is written once.
// ---------------------------------------------------------------------------

type Family = 4 | 6;

interface Cidr {
  readonly family: Family;
  /** Network address with host bits zeroed. */
  readonly net: bigint;
  readonly prefix: number;
}

function familyBits(family: Family): number {
  return family === 4 ? 32 : 128;
}

/** Strict dotted-quad parse; rejects out-of-range octets and octal-ambiguous
 *  leading zeros. Returns null (not throw) so callers can compose messages. */
function parseIpv4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    out = (out << 8n) | BigInt(octet);
  }
  return out;
}

/** RFC 4291 textual parse including `::` compression and an embedded IPv4 tail. */
function parseIpv6(s: string): bigint | null {
  if (!s.includes(':')) {
    return null;
  }
  const halves = s.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parseGroups = (part: string): bigint[] | null => {
    if (part === '') {
      return [];
    }
    const groups: bigint[] = [];
    for (const [i, g] of part.split(':').entries()) {
      if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
        groups.push(BigInt(`0x${g}`));
      } else if (g.includes('.') && i === part.split(':').length - 1) {
        // Embedded IPv4 tail ("::ffff:1.2.3.4") becomes two groups.
        const v4 = parseIpv4(g);
        if (v4 === null) {
          return null;
        }
        groups.push(v4 >> 16n, v4 & 0xffffn);
      } else {
        return null;
      }
    }
    return groups;
  };
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (head === null || tail === null) {
    return null;
  }
  const groupCount = head.length + tail.length;
  if (halves.length === 2 ? groupCount > 7 : groupCount !== 8) {
    return null;
  }
  const groups = [...head, ...Array<bigint>(8 - groupCount).fill(0n), ...tail];
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

/** Parse an address or CIDR string into canonical form (host bits masked off),
 *  or null when it isn't one. `192.168.1.5/16` canonicalizes to `192.168.0.0/16`. */
function parseCidr(value: string): Cidr | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  const addrPart = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixPart = slash === -1 ? null : trimmed.slice(slash + 1);

  const v4 = parseIpv4(addrPart);
  const family: Family | null = v4 !== null ? 4 : parseIpv6(addrPart) !== null ? 6 : null;
  if (family === null) {
    return null;
  }
  const addr = family === 4 ? v4! : parseIpv6(addrPart)!;
  const bits = familyBits(family);

  let prefix = bits;
  if (prefixPart !== null) {
    if (!/^\d{1,3}$/.test(prefixPart)) {
      return null;
    }
    prefix = Number(prefixPart);
    if (prefix > bits) {
      return null;
    }
  }
  const hostBits = BigInt(bits - prefix);
  const net = (addr >> hostBits) << hostBits;
  return { family, net, prefix };
}

function formatIpv4(v: bigint): string {
  return [(v >> 24n) & 0xffn, (v >> 16n) & 0xffn, (v >> 8n) & 0xffn, v & 0xffn].join('.');
}

/** RFC 5952 canonical text: lowercase hex, longest zero run (≥2) as `::`. */
function formatIpv6(v: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  }
  // Find the longest run of zero groups (length ≥ 2), leftmost on a tie.
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) {
      j++;
    }
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) {
    return hex.join(':');
  }
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

function formatCidr(c: Cidr): string {
  const addr = c.family === 4 ? formatIpv4(c.net) : formatIpv6(c.net);
  return `${addr}/${c.prefix}`;
}

/** Inclusive address interval; the uniform currency of the route math. */
interface Interval {
  readonly start: bigint;
  readonly end: bigint;
}

function cidrToInterval(c: Cidr): Interval {
  const size = 1n << BigInt(familyBits(c.family) - c.prefix);
  return { start: c.net, end: c.net + size - 1n };
}

/** Coalesce sorted-or-not intervals: overlapping AND adjacent runs merge, so
 *  the result is disjoint with gaps of at least one address between entries. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
  );
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end + 1n) {
      if (iv.end > last.end) {
        out[out.length - 1] = { start: last.start, end: iv.end };
      }
    } else {
      out.push(iv);
    }
  }
  return out;
}

/** `a \ b` for merged-disjoint `b`. Both inputs must be within one family. */
function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of a) {
    let cursor = iv.start;
    for (const cut of b) {
      if (cut.end < cursor || cut.start > iv.end) {
        continue;
      }
      if (cut.start > cursor) {
        out.push({ start: cursor, end: cut.start - 1n });
      }
      cursor = cut.end + 1n;
      if (cursor > iv.end) {
        break;
      }
    }
    if (cursor <= iv.end) {
      out.push({ start: cursor, end: iv.end });
    }
  }
  return out;
}

/**
 * Greedy interval → minimal CIDR cover: at each step emit the largest
 * power-of-two block that is aligned at `start` and fits in the remainder.
 * Minimal for a single interval, hence minimal overall for disjoint,
 * non-adjacent intervals (which is what {@link mergeIntervals} guarantees).
 */
function intervalToCidrs(iv: Interval, family: Family): Cidr[] {
  const bits = familyBits(family);
  const out: Cidr[] = [];
  let start = iv.start;
  while (start <= iv.end) {
    // Alignment cap: lowest set bit of `start` (whole space when start is 0).
    let size = start === 0n ? 1n << BigInt(bits) : start & -start;
    const span = iv.end - start + 1n;
    while (size > span) {
      size >>= 1n;
    }
    const prefix = bits - (size.toString(2).length - 1);
    out.push({ family, net: start, prefix });
    start += size;
  }
  return out;
}

/** Parse many CIDR strings, keep one family, and reduce to merged intervals.
 *  Throws on garbage — an unparseable prefix here is a programming error. */
function toMergedIntervals(cidrs: readonly string[], family: Family): Interval[] {
  const parsed: Interval[] = [];
  for (const value of cidrs) {
    const cidr = parseCidr(value);
    if (cidr === null) {
      throw new Error(`split: not a valid IP or CIDR: "${value}"`);
    }
    if (cidr.family === family) {
      parsed.push(cidrToInterval(cidr));
    }
  }
  return mergeIntervals(parsed);
}

function intervalsToStrings(intervals: readonly Interval[], family: Family): string[] {
  return intervals.flatMap((iv) => intervalToCidrs(iv, family)).map(formatCidr);
}

/**
 * Every prefix covering `0.0.0.0/0` (and/or `::/0`) minus `excluded`, as a
 * minimal set. Deterministic and sorted (numeric ascending, v4 before v6), so
 * generated configs are byte-stable across runs.
 *
 * This is the canonical implementation of the complement-CIDR algorithm; the
 * Kotlin/Swift/Rust copies are ports validated against
 * `__fixtures__/split-routes.json`. A port that disagrees with the vectors is
 * a build failure — divergence means a silently leaking route on one platform.
 *
 * Entries in `excluded` whose family is not requested are ignored. Excluding
 * the whole space yields `[]`; an empty `excluded` yields the default route(s).
 *
 * @throws {Error} If any entry in `excluded` is not a valid IP/CIDR.
 */
export function complementRoutes(
  excluded: readonly string[],
  family: 'v4' | 'v6' | 'both',
): readonly string[] {
  const families: Family[] = family === 'both' ? [4, 6] : family === 'v4' ? [4] : [6];
  const out: string[] = [];
  for (const fam of families) {
    const bits = familyBits(fam);
    const full: Interval = { start: 0n, end: (1n << BigInt(bits)) - 1n };
    const holes = toMergedIntervals(excluded, fam);
    out.push(...intervalsToStrings(subtractIntervals([full], holes), fam));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule normalization and validation. Enforced at rule-CREATION time so a bad
// rule is rejected in the UI, not discovered at compile time.
// ---------------------------------------------------------------------------

/** Optional context for {@link normalizeSplitRule} validation. */
export interface SplitRuleContext {
  /**
   * Gateway endpoint IPs of the active/known route (entry and exit for
   * multi-hop). A CIDR rule containing one is rejected — it would either kill
   * the tunnel or create a routing loop, depending on direction.
   */
  readonly endpointIps?: readonly string[];
}

/** Punycode (RFC 3492) encode of one non-ASCII label, without the `xn--` prefix. */
function punycodeEncode(label: string): string {
  const base = 36;
  const tmin = 1;
  const tmax = 26;
  const skew = 38;
  const damp = 700;
  const digit = (d: number): string =>
    String.fromCharCode(d < 26 ? d + 0x61 /* a-z */ : d - 26 + 0x30 /* 0-9 */);
  const adapt = (delta: number, numPoints: number, firstTime: boolean): number => {
    let d = firstTime ? Math.floor(delta / damp) : delta >> 1;
    d += Math.floor(d / numPoints);
    let k = 0;
    while (d > ((base - tmin) * tmax) >> 1) {
      d = Math.floor(d / (base - tmin));
      k += base;
    }
    return k + Math.floor(((base - tmin + 1) * d) / (d + skew));
  };

  const cps = [...label].map((c) => c.codePointAt(0)!);
  let n = 128;
  let delta = 0;
  let bias = 72;
  const basic = cps.filter((c) => c < 0x80);
  let output = basic.map((c) => String.fromCharCode(c)).join('');
  let handled = basic.length;
  if (handled > 0) {
    output += '-';
  }
  const firstNonBasicAt = basic.length;
  while (handled < cps.length) {
    let m = Infinity;
    for (const c of cps) {
      if (c >= n && c < m) {
        m = c;
      }
    }
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of cps) {
      if (c < n) {
        delta++;
      }
      if (c === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
          if (q < t) {
            break;
          }
          output += digit(t + ((q - t) % (base - t)));
          q = Math.floor((q - t) / (base - t));
        }
        output += digit(q);
        bias = adapt(delta, handled + 1, handled === firstNonBasicAt);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

/** True when the string parses as a bare IPv4/IPv6 address (no prefix). */
function isIpLiteral(s: string): boolean {
  return parseIpv4(s) !== null || parseIpv6(s) !== null;
}

function normalizeDomainValue(raw: string): string {
  let v = raw.trim().toLowerCase().normalize('NFC');
  while (v.endsWith('.')) {
    v = v.slice(0, -1);
  }
  const wildcard = v.startsWith('*.');
  if (wildcard) {
    v = v.slice(2);
  }
  if (v === '' || v.includes('*')) {
    throw new Error(`split: not a valid domain: "${raw}"`);
  }
  if (isIpLiteral(v)) {
    throw new Error(`split: "${raw}" is an IP address — add it as an IP rule instead`);
  }
  const labels = v.split('.').map((label) => {
    const ascii = /^[\x20-\x7e]*$/.test(label) ? label : `xn--${punycodeEncode(label)}`;
    if (!/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(ascii) || ascii.length > 63) {
      throw new Error(`split: not a valid domain: "${raw}"`);
    }
    return ascii;
  });
  if (labels.length < 2) {
    throw new Error(`split: "${raw}" is a bare TLD — add a full hostname like "example.com"`);
  }
  const joined = labels.join('.');
  if (joined.length > 253) {
    throw new Error(`split: domain too long: "${raw}"`);
  }
  return wildcard ? `*.${joined}` : joined;
}

function normalizeCidrValue(raw: string, ctx: SplitRuleContext): string {
  const cidr = parseCidr(raw);
  if (cidr === null) {
    throw new Error(`split: not a valid IP or CIDR: "${raw}"`);
  }
  if (cidr.prefix === 0) {
    throw new Error(
      `split: "${raw}" covers the whole internet — use the split-tunneling mode switch instead`,
    );
  }
  const iv = cidrToInterval(cidr);
  for (const endpoint of ctx.endpointIps ?? []) {
    const ep = parseCidr(endpoint);
    if (ep !== null && ep.family === cidr.family && ep.net >= iv.start && ep.net <= iv.end) {
      throw new Error(
        `split: "${raw}" contains the VPN gateway address (${endpoint}) — that rule would break the tunnel itself`,
      );
    }
  }
  return formatCidr(cidr);
}

function normalizeAppValue(raw: string, platform: SplitPlatform | undefined): string {
  const v = raw.trim();
  if (v === '') {
    throw new Error('split: app rule needs an application identity');
  }
  if (platform === undefined) {
    throw new Error('split: app rule needs the platform it was authored on');
  }
  // Excluding CumulusVPN from its own tunnel is meaningless and confusing —
  // the control plane is already outside the tun by construction.
  if (v.toLowerCase().includes('cumulusvpn')) {
    throw new Error('split: CumulusVPN itself cannot be a split-tunneling rule');
  }
  return v;
}

const SPLIT_PLATFORMS: readonly SplitPlatform[] = ['android', 'ios', 'macos', 'windows', 'linux'];
const SPLIT_MODES: readonly SplitMode[] = ['off', 'exclude', 'include'];

/**
 * Validate and canonicalize one rule, or throw an `Error` whose message is
 * suitable for showing in the UI. This is the single gate through which every
 * rule must pass before entering a {@link SplitPolicy}:
 *
 * - `cidr`: parsed and canonicalized (`192.168.1.5/16` → `192.168.0.0/16`);
 *   `/0` rejected (that is the mode switch, not a rule); any prefix containing
 *   an IP in `ctx.endpointIps` rejected.
 * - `domain`: lowercased, trailing dot stripped, IDNA/punycode-encoded; bare
 *   TLDs and IP literals rejected; `*.x.y` marks a wildcard rule.
 * - `app`: trimmed; requires `platform`; our own identity rejected.
 */
export function normalizeSplitRule(rule: SplitRule, ctx: SplitRuleContext = {}): SplitRule {
  if (!['app', 'domain', 'cidr'].includes(rule.kind)) {
    throw new Error(`split: unknown rule kind "${String(rule.kind)}"`);
  }
  if (typeof rule.value !== 'string') {
    throw new Error('split: rule value must be a string');
  }
  if (
    rule.kind === 'app' &&
    rule.platform !== undefined &&
    !SPLIT_PLATFORMS.includes(rule.platform)
  ) {
    throw new Error(`split: unknown platform "${String(rule.platform)}"`);
  }
  const value =
    rule.kind === 'cidr'
      ? normalizeCidrValue(rule.value, ctx)
      : rule.kind === 'domain'
        ? normalizeDomainValue(rule.value)
        : normalizeAppValue(rule.value, rule.platform);
  return {
    kind: rule.kind,
    value,
    ...(rule.label !== undefined ? { label: rule.label } : {}),
    ...(rule.kind === 'app' ? { platform: rule.platform } : {}),
    enabled: rule.enabled !== false,
  };
}

// ---------------------------------------------------------------------------
// The compiler.
// ---------------------------------------------------------------------------

/** Compile-time context: the enforcing platform and its route capabilities. */
export interface CompileSplitContext {
  readonly platform: SplitPlatform;
  /**
   * Whether the platform can express "route everything except X" natively
   * (Android 13+, iOS, desktop route tables). When false (Android < 13, a
   * stock WireGuard `.conf`), bypass prefixes are pre-computed into
   * `tunnelRoutes` as the complement of the bypass set.
   */
  readonly supportsExcludeRoute: boolean;
  /**
   * Gateway endpoint IPs of the CURRENT session. Re-validated on every
   * compile because discovery failover changes the endpoint (§7.4): a CIDR
   * rule that now contains an endpoint is silently dropped — failing toward
   * MORE traffic in the tunnel, never toward a broken tunnel or a stale
   * bypass. (Rule creation already rejects these against the endpoints known
   * at authoring time; this guards reconnects.)
   */
  readonly endpointIps?: readonly string[];
}

function containsAnyEndpoint(value: string, endpointIps: readonly string[]): boolean {
  const cidr = parseCidr(value);
  if (cidr === null) {
    return false;
  }
  const iv = cidrToInterval(cidr);
  return endpointIps.some((endpoint) => {
    const ep = parseCidr(endpoint);
    return ep !== null && ep.family === cidr.family && ep.net >= iv.start && ep.net <= iv.end;
  });
}

/** Merge + canonicalize a CIDR string list across both families, sorted v4-first. */
function mergedCidrStrings(cidrs: readonly string[]): string[] {
  return ([4, 6] as const).flatMap((fam) => intervalsToStrings(toMergedIntervals(cidrs, fam), fam));
}

/** Per-family subtraction `a \ b` over CIDR strings, minimal + sorted output. */
function subtractCidrStrings(a: readonly string[], b: readonly string[]): string[] {
  return ([4, 6] as const).flatMap((fam) =>
    intervalsToStrings(
      subtractIntervals(toMergedIntervals(a, fam), toMergedIntervals(b, fam)),
      fam,
    ),
  );
}

function toMatchers(values: readonly string[]): DomainMatcher[] {
  return values
    .map((v) =>
      v.startsWith('*.') ? { suffix: v.slice(2), wildcard: true } : { suffix: v, wildcard: false },
    )
    .sort((a, b) => (a.suffix < b.suffix ? -1 : a.suffix > b.suffix ? 1 : 0));
}

const NOOP_SPLIT: CompiledSplit = {
  tunnelRoutes: [],
  bypassRoutes: [],
  appsIncluded: [],
  appsExcluded: [],
  domainsIncluded: [],
  domainsExcluded: [],
  isNoop: true,
};

/**
 * Reduce a {@link SplitPolicy} to the {@link CompiledSplit} primitives for one
 * platform. Pure and deterministic: same policy + context → byte-identical
 * output, so generated configs are stable across runs (validation gate V1).
 *
 * The compiled output is SESSION state — recompile on every (re)connect with
 * the fresh `endpointIps`; never cache it across a reconnect (§7.4).
 */
export function compileSplitPolicy(policy: SplitPolicy, ctx: CompileSplitContext): CompiledSplit {
  if (policy.mode === 'off' && !policy.lanBypass) {
    return NOOP_SPLIT;
  }

  const active = policy.rules.filter((r) => r.enabled !== false);
  const endpointIps = ctx.endpointIps ?? [];
  const cidrs = active
    .filter((r) => r.kind === 'cidr')
    .map((r) => r.value)
    .filter((v) => !containsAnyEndpoint(v, endpointIps));
  const apps = [
    ...new Set(
      active.filter((r) => r.kind === 'app' && r.platform === ctx.platform).map((r) => r.value),
    ),
  ].sort();
  const domains = [...new Set(active.filter((r) => r.kind === 'domain').map((r) => r.value))];

  if (policy.mode === 'include') {
    const included = policy.lanBypass
      ? subtractCidrStrings(cidrs, LAN_BYPASS_CIDRS)
      : mergedCidrStrings(cidrs);
    return {
      tunnelRoutes: included,
      bypassRoutes: [],
      appsIncluded: apps,
      appsExcluded: [],
      domainsIncluded: toMatchers(domains),
      domainsExcluded: [],
      isNoop: false,
    };
  }

  // 'exclude', and 'off' + lanBypass (which is just an empty exclude list).
  const ruleCidrs = policy.mode === 'exclude' ? cidrs : [];
  const bypass = mergedCidrStrings([...ruleCidrs, ...(policy.lanBypass ? LAN_BYPASS_CIDRS : [])]);
  const modeApps = policy.mode === 'exclude' ? apps : [];
  const modeDomains = policy.mode === 'exclude' ? domains : [];
  return {
    tunnelRoutes: ctx.supportsExcludeRoute ? [] : complementRoutes(bypass, 'both'),
    bypassRoutes: ctx.supportsExcludeRoute ? bypass : [],
    appsIncluded: [],
    appsExcluded: modeApps,
    domainsIncluded: [],
    domainsExcluded: toMatchers(modeDomains),
    isNoop: false,
  };
}

// ---------------------------------------------------------------------------
// Defensive load.
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted value (from disk) into a {@link SplitPolicy}.
 *
 * Fail-closed contract (§3.4): anything absent, corrupt, from a future schema
 * version, or containing even one invalid rule collapses to
 * {@link EMPTY_POLICY} — full tunnel — never to a partially-applied policy.
 */
export function sanitizeSplitPolicy(value: unknown): SplitPolicy {
  if (typeof value !== 'object' || value === null) {
    return EMPTY_POLICY;
  }
  const p = value as Record<string, unknown>;
  if (
    p.version !== 1 ||
    !SPLIT_MODES.includes(p.mode as SplitMode) ||
    typeof p.lanBypass !== 'boolean' ||
    (p.excludedDns !== 'tunnel' && p.excludedDns !== 'system') ||
    !Array.isArray(p.rules)
  ) {
    return EMPTY_POLICY;
  }
  try {
    const rules = (p.rules as unknown[]).map((r) => normalizeSplitRule(r as SplitRule));
    return {
      version: 1,
      mode: p.mode as SplitMode,
      rules,
      lanBypass: p.lanBypass,
      excludedDns: p.excludedDns,
    };
  } catch {
    return EMPTY_POLICY;
  }
}
