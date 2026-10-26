//! System DNS while the tunnel is up: point the OS resolver at the tunnel's
//! resolver, keep it there across network changes, and put back exactly what
//! was there before.
//!
//! Routing alone does not stop DNS leaking. The routes send *packets* into the
//! tunnel, but the OS keeps asking the resolver it already had (the router, the
//! ISP), so every lookup names the site you are about to visit to the local
//! network. The gateway hands out a resolver in its enroll reply (`dns`, e.g.
//! `1.1.1.1`), or the user picks a provider in Settings → DNS (two addresses,
//! e.g. `9.9.9.9, 149.112.112.112`, which the gateway answers and forwards to
//! that provider); the `.conf` carries them as `DNS =`; this module makes the
//! system use them — every one of them — and only them. Nothing here assumes
//! a particular provider: every OS mechanism below takes the whole list.
//!
//! **One interface for every host.** [`DnsSession::start`] applies,
//! [`DnsSession::reassert`] keeps it applied (called from the repair loop),
//! [`DnsSession::restore`] undoes it, and [`recover_stale`] cleans up after a
//! host that died without restoring. `TunnelManager` is the only caller, in
//! whichever host runs it: the helper daemon (all three OSes) or the elevated
//! in-process app.
//! Applying never fails the connect: a tunnel whose DNS could not be set is
//! still a working tunnel, so the failure becomes [`DnsSession::warning`],
//! which the status carries to the UI instead of pretending all is well.
//!
//! **macOS — the SystemConfiguration dynamic store, through `scutil`.** The
//! resolver configuration (`scutil --dns`) is built by configd's IPMonitor from
//! the *primary* service's DNS entity, merged from its `State:` (DHCP) and
//! `Setup:` (the user's manual servers) keys — and `Setup:` server addresses win
//! over `State:`. So we override `ServerAddresses` in every
//! `State:/Network/Service/<id>/DNS` and `Setup:/Network/Service/<id>/DNS` key
//! in the dynamic store (never the on-disk preferences), and create a `State:`
//! DNS entity for the primary service if it has none. It is the approach
//! wireguard-go clients without a NetworkExtension take (Mullvad's macOS
//! daemon overrides every service's DNS entity in the dynamic store the same
//! way). The alternatives were checked against configd's source and rejected:
//!   * publishing our own `State:/Network/Service/<ours>/DNS` with
//!     `SupplementalMatchDomains = [""]` only adds a *second* default resolver;
//!     IPMonitor pins index 0 to the primary service's, so the ISP's still wins;
//!   * `OverridePrimary` on our own service makes it primary for DNS *and*
//!     moves the system default route onto the utun, which breaks the
//!     endpoint-bypass gateway discovery the roam repair depends on
//!     (`route -n get default` would answer with the tunnel);
//!   * writing `State:/Network/Global/DNS` changes nothing: it is IPMonitor's
//!     output, not an input to the resolver configuration.
//!
//! Each original is copied, byte for byte, by scutil itself (`get` + `set`) to
//! `State:/Network/CumulusVPN/Backup/<State|Setup>/<id>` before it is
//! overridden, and every override carries a `CumulusVPNOverride` marker (the
//! server list) so we can tell our value from one its owner republished. Rules:
//!   * an unmarked key is an original: back it up, then override it — including
//!     a key DHCP or the preferences monitor re-published after we took it
//!     over (a roam, a lease renewal, the user hitting Apply), which is how the
//!     repair loop re-asserts;
//!   * restoring puts a backup back only if the key still carries our marker; if
//!     its owner has replaced it since, theirs is newer truth and stays.
//!
//! The backups live in the dynamic store, not on disk, so they survive the
//! helper dying (launchd restarts it and [`recover_stale`] puts everything
//! back) but never a reboot (the store is rebuilt from scratch, nothing
//! stale). And a stale override is not a broken machine: every resolver the
//! apps offer is a public anycast address, reachable directly once the tunnel
//! is gone.
//!
//! **Linux — systemd-resolved, else resolvconf.** When resolved is the system
//! resolver (`/etc/resolv.conf` is its stub): `resolvectl dns <if> <ip>`,
//! `resolvectl domain <if> '~.'` (route every name to this link) and
//! `resolvectl default-route <if> true`. Per-link config vanishes with the link,
//! so a crash cannot strand it. Otherwise `resolvconf -a <if> -m 0 -x`, the
//! way `wg-quick` does it (exclusive: only our servers). Neither present: the
//! session reports it — nothing is silently left leaking.
//!
//! **Windows — the adapter plus WFP filters, all native.** The wintun adapter
//! gets the DNS servers, interface metric 1 (the DNS client prefers lower
//! metrics) and an empty connection suffix (`SetInterfaceDnsSettings`,
//! `SetIpInterfaceEntry`). Windows' smart multi-homed name resolution still
//! sends the same query out *every* adapter in parallel, so our own WFP
//! sublayer blocks 53/853 (UDP+TCP) except to the tunnel resolvers through the
//! tunnel adapter (`win::plan::dns_plan`). A block in any sublayer beats every
//! permit, so a LAN-allow stays subject to it. Restore removes that sublayer.
//! The adapter's own settings die with the adapter.
//!
//! **Split tunneling.** Tunnel DNS for everything, bypassed prefixes included:
//! the desktop has no per-domain or per-app exclusions yet (docs/17 phases 3
//! and 4), so `excludedDns: 'system'` has nothing to act on and the private
//! default holds. When split routing is active every resolver gets a host
//! route through the tunnel (`pinned_servers`), so neither an exclusion that
//! happens to cover one nor include mode (whose default route stays physical)
//! can send it out in the clear. Domain rules, when they ship, will sit in
//! front of this as a local resolver (docs/17 §6) and must keep this session's
//! servers as their upstream.
//!
//! **IPv6.** The tunnel is IPv4-only (the gateway assigns no v6 address), so a
//! v6 resolver on the physical link must not be usable: macOS replaces the v6
//! server addresses along with the v4 ones (same `ServerAddresses` array),
//! resolved stops routing names to the physical link, resolvconf is exclusive,
//! and the Windows rules cover the whole v6 space. The kill switch drops DNS of
//! either family that is not the tunnel resolver through the tunnel.

use std::net::IpAddr;
#[cfg(unix)]
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::routing;

/// How long to wait before retrying an apply that failed outright. Retrying on
/// every 1.5s repair tick would spawn PowerShell / resolvectl in a loop.
const RETRY_EVERY: Duration = Duration::from_secs(15);

/// Minimum spacing between two re-assert checks. `status()` runs from both the
/// repair loop and the UI poll, and each macOS check is an `scutil` spawn.
const RECHECK_EVERY: Duration = Duration::from_secs(1);

/// The resolver(s) named by a `.conf` `DNS =` line, in order: comma-separated,
/// spaces around entries and empty entries ignored, duplicates dropped. A line
/// that is not all addresses is refused before this runs
/// (`validate::dns_servers`, from `WgConfig::parse`); anything else that slips
/// through (wg-quick allows search domains there) is still skipped rather than
/// passed on. The result is typed, so nothing reaches rule text or a script
/// unvalidated.
pub fn parse_servers(dns: &str) -> Vec<IpAddr> {
    let mut out = Vec::new();
    for token in dns.split(',') {
        if let Ok(ip) = token.trim().parse::<IpAddr>() {
            if !out.contains(&ip) {
                out.push(ip);
            }
        }
    }
    out
}

/// What a session installs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsTarget {
    /// Real kernel name of the device that carries the default route: the only
    /// device for single-hop, the inner (exit) device for multi-hop.
    pub interface: String,
    /// The tunnel resolvers, from the `.conf`.
    pub servers: Vec<IpAddr>,
    /// WireGuard endpoint address(es). Never pinned into the tunnel (that would
    /// loop the tunnel's own packets) and never caught by the DNS block rules.
    pub endpoint_ips: Vec<IpAddr>,
    /// Pin each resolver with a host route through `interface`. Needed only
    /// when split routing is active — the full tunnel's split-default already
    /// covers it.
    pub pin_route: bool,
    /// Whether the kill switch is engaged, for the wording of the warning.
    pub kill_switch: bool,
}

/// DNS applied for one tunnel session. Hold it for the session's lifetime and
/// call [`DnsSession::restore`] when the session ends.
pub struct DnsSession {
    target: DnsTarget,
    applied: Option<sys::Applied>,
    warning: Option<String>,
    /// A resolver host route that could not be installed. Kept apart from
    /// `warning` because a re-assert that finds the system DNS fine must not
    /// clear it.
    route_warning: Option<String>,
    last_attempt: Instant,
}

impl DnsSession {
    /// Apply `target`. Never fails: a failure is recorded as [`Self::warning`]
    /// and retried by [`Self::reassert`].
    pub fn start(target: DnsTarget) -> Self {
        let mut session = DnsSession {
            target,
            applied: None,
            warning: None,
            route_warning: None,
            last_attempt: Instant::now(),
        };
        session.pin_routes();
        session.attempt();
        session
    }

    /// User-facing description of what is wrong with DNS right now, or `None`
    /// when lookups go only to the tunnel resolver.
    pub fn warning(&self) -> Option<String> {
        match (&self.warning, &self.route_warning) {
            (Some(w), _) => Some(w.clone()),
            (None, Some(r)) => Some(warning_text(r, self.target.kill_switch)),
            (None, None) => None,
        }
    }

    /// Keep DNS applied. Called from every `status()` while the tunnel is up:
    /// re-takes keys the OS republished after a roam (macOS), and retries an
    /// apply that failed (every platform), each at a bounded rate.
    pub fn reassert(&mut self) {
        if self.target.servers.is_empty() {
            return;
        }
        match &self.applied {
            None => {
                if self.last_attempt.elapsed() >= RETRY_EVERY {
                    self.attempt();
                }
            }
            Some(applied) => {
                if self.last_attempt.elapsed() < RECHECK_EVERY {
                    return;
                }
                self.last_attempt = Instant::now();
                match sys::reassert(applied, &self.target) {
                    Ok(()) => self.warning = None,
                    Err(reason) => {
                        eprintln!("cumulusvpn: DNS re-assert failed: {reason}");
                        self.warning = Some(warning_text(&reason, self.target.kill_switch));
                    }
                }
            }
        }
    }

    /// Put the system DNS back the way it was. Best-effort and idempotent; also
    /// cleans up after an apply that failed half-way.
    pub fn restore(self) {
        sys::restore(self.applied.as_ref(), &self.target);
    }

    fn attempt(&mut self) {
        self.last_attempt = Instant::now();
        if self.target.servers.is_empty() {
            self.warning = Some(warning_text(
                "the tunnel configuration names no DNS server",
                self.target.kill_switch,
            ));
            return;
        }
        if !is_safe_iface(&self.target.interface) {
            self.warning = Some(warning_text(
                "unexpected tunnel interface name",
                self.target.kill_switch,
            ));
            return;
        }
        match sys::apply(&self.target) {
            Ok(applied) => {
                self.applied = Some(applied);
                self.warning = None;
            }
            Err(reason) => {
                eprintln!("cumulusvpn: DNS could not be applied: {reason}");
                self.warning = Some(warning_text(&reason, self.target.kill_switch));
            }
        }
    }

    /// Host routes `<resolver>/32 → tunnel` for [`pinned_servers`]. These are
    /// interface-scoped and die with the device, so restore has nothing to undo.
    fn pin_routes(&mut self) {
        for server in pinned_servers(&self.target) {
            if let Err(e) = routing::add_host_route(&server.to_string(), &self.target.interface) {
                eprintln!("cumulusvpn: could not pin DNS server {server} to the tunnel: {e}");
                self.route_warning = Some(format!(
                    "the route sending DNS server {server} through the tunnel could not be added"
                ));
            }
        }
    }
}

/// The resolvers that get a host route through the tunnel: every configured
/// one, when split routing is active (docs/16 N10 — an excluded prefix that
/// happens to contain a resolver must not take its lookups out of the tunnel).
/// IPv4 only, since the tunnel carries no IPv6; never a WireGuard endpoint,
/// which would loop the tunnel's own packets into itself.
fn pinned_servers(target: &DnsTarget) -> Vec<IpAddr> {
    if !target.pin_route {
        return Vec::new();
    }
    target
        .servers
        .iter()
        .copied()
        .filter(|s| s.is_ipv4() && !target.endpoint_ips.contains(s))
        .collect()
}

/// Undo DNS left behind by a host that died without restoring it. Run once when
/// a daemon or the in-process app starts, before any session exists:
/// `logical_interfaces` are the names the tunnel asks for (`cvpn0`,
/// `cvpn-exit`). Best-effort; does nothing when nothing is stale.
pub fn recover_stale(logical_interfaces: &[&str]) {
    sys::recover_stale(logical_interfaces);
}

/// The warning shown in the UI. Two wordings, because what the user should do
/// differs: with the kill switch on, nothing leaks but some names may not
/// resolve; without it, lookups may be going out in the clear.
fn warning_text(reason: &str, kill_switch: bool) -> String {
    let reason: String = reason.chars().take(160).collect();
    if kill_switch {
        format!(
            "DNS could not be pointed at the VPN ({reason}). The kill switch is blocking \
             every other DNS server, so some sites may not load."
        )
    } else {
        format!(
            "DNS could not be pointed at the VPN ({reason}). Name lookups may leak outside \
             the tunnel — turn on the kill switch to block them."
        )
    }
}

/// An interface name reaches scripts and rule text, so it must carry only name
/// characters — same defense-in-depth as `killswitch::is_safe_iface`.
fn is_safe_iface(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Run `program`, feeding `stdin` if given, and return its stdout. A spawn
/// failure or non-zero exit is an `Err` carrying a one-line reason (the first
/// line of stderr) for the log and the UI warning. macOS and Linux only:
/// Windows sets DNS through the IP Helper API.
#[cfg(unix)]
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
fn run_capture(program: &str, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
    use std::io::Write;

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    let started = std::time::Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{program} could not be started: {e}"))?;
    if let Some(input) = stdin {
        // Inputs here are a few hundred bytes, far below a pipe buffer, so
        // writing before reading cannot deadlock. Dropping the handle is EOF.
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(input.as_bytes())
                .map_err(|e| format!("{program}: {e}"))?;
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("{program}: {e}"))?;
    let short: String = args.join(" ").chars().take(120).collect();
    eprintln!(
        "cumulusvpn-tunnel: dns: `{program} {short}` {} in {} ms",
        out.status,
        started.elapsed().as_millis()
    );
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    match stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
        Some(line) => Err(format!("{program}: {line}")),
        None => Err(format!("{program} failed ({})", out.status)),
    }
}

// ---- macOS: the SystemConfiguration dynamic store ---------------------------

/// Pure parts (script text, output parsing, planning) are compiled everywhere
/// so the tests run on the Linux CI too; only `sys` touches the store.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos {
    use std::collections::BTreeMap;
    use std::net::IpAddr;

    pub(super) const SCUTIL: &str = "/usr/sbin/scutil";
    /// Marks a DNS dictionary as ours. Its value is the server list, so a
    /// reconnect to a gateway with a different resolver is noticed too.
    pub(super) const MARKER: &str = "CumulusVPNOverride";
    /// Marks a backup of a key that did not exist: restoring it means removing.
    pub(super) const ABSENT: &str = "CumulusVPNAbsent";
    /// Our own namespace in the dynamic store. Deliberately not under
    /// `State:/Network/Service/`, which IPMonitor reads as services.
    pub(super) const BACKUP_PREFIX: &str = "State:/Network/CumulusVPN/Backup/";

    /// One read of everything the plans need: every service's DNS entities,
    /// the primary services, and our backups. One regex, so the output is a
    /// single dictionary keyed by key name — an empty match is just `{}`.
    pub(super) const READ_SCRIPT: &str = "show ^((State|Setup):/Network/Service/[^/]+/DNS|State:/Network/Global/IPv[46]|State:/Network/CumulusVPN/Backup/(State|Setup)/[^/]+)$ pattern\nquit\n";

    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub(super) enum Layer {
        /// `State:` — published by the owner of the service (DHCP, RA, a VPN).
        State,
        /// `Setup:` — the user's configuration (manual DNS servers). Wins over
        /// `State:` for `ServerAddresses`.
        Setup,
    }

    impl Layer {
        fn name(self) -> &'static str {
            match self {
                Layer::State => "State",
                Layer::Setup => "Setup",
            }
        }
        fn parse(s: &str) -> Option<Self> {
            match s {
                "State" => Some(Layer::State),
                "Setup" => Some(Layer::Setup),
                _ => None,
            }
        }
    }

    pub(super) fn dns_key(layer: Layer, id: &str) -> String {
        format!("{}:/Network/Service/{id}/DNS", layer.name())
    }

    pub(super) fn backup_key(layer: Layer, id: &str) -> String {
        format!("{BACKUP_PREFIX}{}/{id}", layer.name())
    }

    /// A service ID is interpolated into scutil script lines, which scutil
    /// splits on whitespace — refuse anything but ID characters (configd's own
    /// IDs are UUIDs). A service with any other ID is left alone.
    pub(super) fn is_safe_service_id(id: &str) -> bool {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
    }

    /// The parts of a dictionary the plans look at: top-level scalars and
    /// arrays of scalars. Nested dictionaries are skipped — the copies are made
    /// by scutil itself (`get` + `set`), so nothing is lost by not modelling them.
    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    pub(super) struct Dict {
        pub(super) scalars: BTreeMap<String, String>,
        pub(super) arrays: BTreeMap<String, Vec<String>>,
    }

    impl Dict {
        pub(super) fn scalar(&self, key: &str) -> Option<&str> {
            self.scalars.get(key).map(String::as_str)
        }
        fn is_empty(&self) -> bool {
            self.scalars.is_empty() && self.arrays.is_empty()
        }
    }

    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    pub(super) struct Snapshot {
        /// Every service DNS entity, by layer and service ID.
        pub(super) dns: BTreeMap<(Layer, String), Dict>,
        /// Our backups, by the layer and service ID they were taken from.
        pub(super) backups: BTreeMap<(Layer, String), Dict>,
        /// The primary IPv4 and IPv6 services (the DNS primary is one of them).
        pub(super) primaries: Vec<String>,
    }

    impl Snapshot {
        fn insert(&mut self, key: &str, dict: Dict) {
            if let Some(rest) = key.strip_prefix(BACKUP_PREFIX) {
                if let Some((layer, id)) = rest.split_once('/') {
                    if let (Some(layer), true) = (Layer::parse(layer), is_safe_service_id(id)) {
                        self.backups.insert((layer, id.to_string()), dict);
                    }
                }
                return;
            }
            if key == "State:/Network/Global/IPv4" || key == "State:/Network/Global/IPv6" {
                if let Some(primary) = dict.scalar("PrimaryService") {
                    if is_safe_service_id(primary) && !self.primaries.iter().any(|p| p == primary) {
                        self.primaries.push(primary.to_string());
                    }
                }
                return;
            }
            for layer in [Layer::State, Layer::Setup] {
                let prefix = format!("{}:/Network/Service/", layer.name());
                if let Some(id) = key
                    .strip_prefix(prefix.as_str())
                    .and_then(|rest| rest.strip_suffix("/DNS"))
                {
                    if is_safe_service_id(id) {
                        self.dns.insert((layer, id.to_string()), dict);
                    }
                    return;
                }
            }
        }

        fn has_dns(&self, id: &str) -> bool {
            self.dns.contains_key(&(Layer::State, id.to_string()))
                || self.dns.contains_key(&(Layer::Setup, id.to_string()))
        }
    }

    /// Parse the output of [`READ_SCRIPT`]: `show <regex> pattern` prints one
    /// dictionary whose keys are store keys, two spaces of indent per level.
    pub(super) fn parse_snapshot(text: &str) -> Snapshot {
        let mut snap = Snapshot::default();
        let mut key: Option<String> = None;
        let mut dict = Dict::default();
        let mut array: Option<(String, Vec<String>)> = None;
        // Depth inside a value we do not model (a nested dictionary, or an
        // array of dictionaries), skipped until its closing brace.
        let mut skip = 0usize;
        for line in text.lines() {
            let trimmed = line.trim();
            if skip > 0 {
                if trimmed.ends_with('{') {
                    skip += 1;
                } else if trimmed == "}" {
                    skip -= 1;
                }
                continue;
            }
            let indent = line.len() - line.trim_start_matches(' ').len();
            match indent {
                2 => {
                    if trimmed == "}" {
                        if let Some(k) = key.take() {
                            snap.insert(&k, std::mem::take(&mut dict));
                        }
                    } else if let Some(k) = trimmed.strip_suffix(" : <dictionary> {") {
                        key = Some(k.to_string());
                        dict = Dict::default();
                        array = None;
                    }
                }
                4 if key.is_some() => {
                    if trimmed == "}" {
                        if let Some((name, items)) = array.take() {
                            dict.arrays.insert(name, items);
                        }
                    } else if let Some((name, value)) = trimmed.split_once(" : ") {
                        if value == "<array> {" {
                            array = Some((name.to_string(), Vec::new()));
                        } else if value.ends_with('{') {
                            skip = 1;
                        } else {
                            dict.scalars.insert(name.to_string(), value.to_string());
                        }
                    }
                }
                6 if array.is_some() => {
                    if let Some((_, value)) = trimmed.split_once(" : ") {
                        if value.ends_with('{') {
                            skip = 1;
                        } else if let Some((_, items)) = array.as_mut() {
                            items.push(value.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        snap
    }

    /// The marker value: the server list, comma-joined (no whitespace, so it is
    /// one scutil token).
    pub(super) fn marker_value(servers: &[IpAddr]) -> String {
        servers
            .iter()
            .map(IpAddr::to_string)
            .collect::<Vec<_>>()
            .join(",")
    }

    /// Lines that turn the *current* scutil dictionary into our override and
    /// write it to `key`.
    fn override_lines(out: &mut String, key: &str, servers: &[IpAddr], marker: &str) {
        let addrs = servers
            .iter()
            .map(IpAddr::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        // A port inherited from the original (a local proxy on 5353, say) would
        // otherwise apply to the tunnel resolver too.
        out.push_str("d.remove ServerPort\n");
        out.push_str(&format!("d.add ServerAddresses * {addrs}\n"));
        out.push_str(&format!("d.add {MARKER} {marker}\n"));
        out.push_str(&format!("set {key}\n"));
    }

    /// The scutil script that makes `servers` the system resolver, given the
    /// store as it is now. Empty when there is nothing to do — the common case
    /// on a re-assert tick.
    pub(super) fn plan_apply(snap: &Snapshot, servers: &[IpAddr]) -> String {
        let marker = marker_value(servers);
        let mut out = String::new();
        for ((layer, id), dict) in &snap.dns {
            let key = dns_key(*layer, id);
            match dict.scalar(MARKER) {
                // Ours, with these servers: nothing to do.
                Some(m) if m == marker => {}
                // Ours, for another resolver (a reconnect to a different
                // gateway): rewrite it, and keep the backup of the original.
                Some(_) => {
                    out.push_str("d.init\n");
                    out.push_str(&format!("get {key}\n"));
                    override_lines(&mut out, &key, servers, &marker);
                }
                // An original — first apply, or its owner republished it after
                // a roam or a renewal. Copy it exactly, then take it over.
                None => {
                    out.push_str("d.init\n");
                    out.push_str(&format!("get {key}\n"));
                    out.push_str(&format!("set {}\n", backup_key(*layer, id)));
                    override_lines(&mut out, &key, servers, &marker);
                }
            }
        }
        // A primary service with no DNS entity at all has no default resolver
        // to override; give it one, and remember to remove it again.
        for id in &snap.primaries {
            if snap.has_dns(id) {
                continue;
            }
            out.push_str("d.init\n");
            out.push_str(&format!("d.add {ABSENT} # 1\n"));
            out.push_str(&format!("set {}\n", backup_key(Layer::State, id)));
            out.push_str("d.init\n");
            override_lines(&mut out, &dns_key(Layer::State, id), servers, &marker);
        }
        if !out.is_empty() {
            out.push_str("quit\n");
        }
        out
    }

    /// The scutil script that puts every backup back, given the store as it is
    /// now. A backup is only restored over a key that still carries our marker:
    /// if the owner has republished the key since, that value is newer than the
    /// backup and stays. Every backup is removed either way.
    pub(super) fn plan_restore(snap: &Snapshot) -> String {
        let mut out = String::new();
        for ((layer, id), backup) in &snap.backups {
            let key = dns_key(*layer, id);
            let ours = snap
                .dns
                .get(&(*layer, id.clone()))
                .is_some_and(|d| d.scalar(MARKER).is_some());
            if ours {
                if backup.scalar(ABSENT).is_some() || backup.is_empty() {
                    out.push_str(&format!("remove {key}\n"));
                } else {
                    out.push_str("d.init\n");
                    out.push_str(&format!("get {}\n", backup_key(*layer, id)));
                    out.push_str(&format!("set {key}\n"));
                }
            }
            out.push_str(&format!("remove {}\n", backup_key(*layer, id)));
        }
        if !out.is_empty() {
            out.push_str("quit\n");
        }
        out
    }

    /// Did an apply take? Every DNS entity must carry our marker for these
    /// servers, and every primary service must have one.
    pub(super) fn verify(snap: &Snapshot, servers: &[IpAddr]) -> Result<(), String> {
        let marker = marker_value(servers);
        let missed = snap
            .dns
            .values()
            .filter(|d| d.scalar(MARKER) != Some(marker.as_str()))
            .count();
        if missed > 0 {
            return Err(format!(
                "{missed} network service DNS setting(s) could not be taken over"
            ));
        }
        if snap.primaries.iter().any(|id| !snap.has_dns(id)) {
            return Err("the primary network service has no DNS setting".into());
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub(super) mod sys {
        use super::super::{run_capture, DnsTarget};
        use super::*;

        /// The state lives in the dynamic store; nothing to remember here.
        #[derive(Debug)]
        pub(in super::super) struct Applied;

        fn scutil(script: &str) -> Result<String, String> {
            run_capture(SCUTIL, &[], Some(script))
        }

        fn read() -> Result<Snapshot, String> {
            Ok(parse_snapshot(&scutil(READ_SCRIPT)?))
        }

        /// Apply, then read back and check it took.
        fn converge(servers: &[IpAddr]) -> Result<bool, String> {
            let plan = plan_apply(&read()?, servers);
            if plan.is_empty() {
                return Ok(false);
            }
            scutil(&plan)?;
            verify(&read()?, servers)?;
            Ok(true)
        }

        pub(in super::super) fn apply(target: &DnsTarget) -> Result<Applied, String> {
            converge(&target.servers)?;
            Ok(Applied)
        }

        pub(in super::super) fn reassert(_: &Applied, target: &DnsTarget) -> Result<(), String> {
            if converge(&target.servers)? {
                eprintln!("cumulusvpn: network settings changed; DNS re-pointed at the tunnel");
            }
            Ok(())
        }

        pub(in super::super) fn restore(_: Option<&Applied>, _: &DnsTarget) {
            put_back();
        }

        pub(in super::super) fn recover_stale(_: &[&str]) {
            put_back();
        }

        fn put_back() {
            let snap = match read() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("cumulusvpn: DNS restore could not read the store: {e}");
                    return;
                }
            };
            let plan = plan_restore(&snap);
            if plan.is_empty() {
                return;
            }
            if let Err(e) = scutil(&plan) {
                eprintln!("cumulusvpn: DNS restore failed: {e}");
            }
        }
    }
}

// ---- Linux: systemd-resolved, else resolvconf ------------------------------

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux {
    use std::net::IpAddr;

    pub(super) const RESOLV_CONF: &str = "/etc/resolv.conf";
    /// Exists only while systemd-resolved runs.
    pub(super) const RESOLVED_RUN_DIR: &str = "/run/systemd/resolve";
    /// Debian's resolvconf orders records by this file.
    pub(super) const INTERFACE_ORDER: &str = "/etc/resolvconf/interface-order";

    /// Is systemd-resolved the resolver programs actually use? Only then does
    /// per-link configuration change anything: resolved can run while
    /// `/etc/resolv.conf` is written by something else. True when it runs and
    /// `/etc/resolv.conf` is its file (a symlink into its run dir) or points
    /// at its stub listener.
    pub(super) fn resolved_is_system_resolver(
        run_dir_present: bool,
        resolv_conf_link: Option<&str>,
        resolv_conf: Option<&str>,
    ) -> bool {
        if !run_dir_present {
            return false;
        }
        if resolv_conf_link.is_some_and(|t| t.contains("systemd/resolve/")) {
            return true;
        }
        resolv_conf.is_some_and(|text| {
            text.lines().any(|line| {
                let mut words = line.split_whitespace();
                words.next() == Some("nameserver")
                    && matches!(words.next(), Some("127.0.0.53") | Some("127.0.0.54"))
            })
        })
    }

    /// `resolvectl` invocations that make `iface` the resolver for every name:
    /// its servers, the `~.` routing domain (route all names to this link), and
    /// default-route. The last needs systemd 240+, so the caller treats it as
    /// best-effort; `~.` alone already wins.
    pub(super) fn resolvectl_apply_argv(iface: &str, servers: &[IpAddr]) -> Vec<Vec<String>> {
        let mut dns = vec!["dns".to_string(), iface.to_string()];
        dns.extend(servers.iter().map(IpAddr::to_string));
        vec![
            dns,
            vec!["domain".into(), iface.into(), "~.".into()],
            vec!["default-route".into(), iface.into(), "true".into()],
        ]
    }

    pub(super) fn resolvectl_revert_argv(iface: &str) -> Vec<String> {
        vec!["revert".into(), iface.into()]
    }

    /// The record-name prefix `wg-quick` uses, so a Debian `resolvconf` orders
    /// our record ahead of the physical interfaces': the first wildcard entry in
    /// `interface-order` (`tun*` → `tun.`). openresolv has no such file → none.
    pub(super) fn resolvconf_iface_prefix(interface_order: Option<&str>) -> String {
        let Some(text) = interface_order else {
            return String::new();
        };
        for line in text.lines() {
            if let Some(stem) = line.trim().strip_suffix('*') {
                if !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                {
                    return format!("{stem}.");
                }
            }
        }
        String::new()
    }

    pub(super) fn resolvconf_record(prefix: &str, iface: &str) -> String {
        format!("{prefix}{iface}")
    }

    /// `-m 0`: highest priority; `-x`: exclusive — only this record's servers
    /// are used while it exists (openresolv). Same flags as `wg-quick`.
    pub(super) fn resolvconf_apply_argv(record: &str) -> Vec<String> {
        vec![
            "-a".into(),
            record.into(),
            "-m".into(),
            "0".into(),
            "-x".into(),
        ]
    }

    pub(super) fn resolvconf_delete_argv(record: &str) -> Vec<String> {
        vec!["-d".into(), record.into(), "-f".into()]
    }

    pub(super) fn resolvconf_input(servers: &[IpAddr]) -> String {
        servers
            .iter()
            .map(|s| format!("nameserver {s}\n"))
            .collect()
    }

    #[cfg(target_os = "linux")]
    pub(super) mod sys {
        use std::fs;
        use std::path::Path;

        use super::super::{run_capture, DnsTarget};
        use super::*;

        #[derive(Debug)]
        pub(in super::super) enum Applied {
            Resolved,
            Resolvconf(String),
        }

        /// Search `PATH`, plus the sbin directories an unprivileged `PATH`
        /// often lacks.
        fn have(program: &str) -> bool {
            let path = std::env::var_os("PATH").unwrap_or_default();
            std::env::split_paths(&path)
                .chain(["/usr/sbin", "/sbin", "/usr/bin", "/bin"].map(Into::into))
                .any(|dir| dir.join(program).is_file())
        }

        fn resolved_in_use() -> bool {
            let link = fs::read_link(RESOLV_CONF)
                .ok()
                .map(|p| p.to_string_lossy().into_owned());
            let text = fs::read_to_string(RESOLV_CONF).ok();
            resolved_is_system_resolver(
                Path::new(RESOLVED_RUN_DIR).is_dir(),
                link.as_deref(),
                text.as_deref(),
            ) && have("resolvectl")
        }

        fn record(iface: &str) -> String {
            let order = fs::read_to_string(INTERFACE_ORDER).ok();
            resolvconf_record(&resolvconf_iface_prefix(order.as_deref()), iface)
        }

        fn resolvectl(args: &[String]) -> Result<String, String> {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            run_capture("resolvectl", &args, None)
        }

        pub(in super::super) fn apply(target: &DnsTarget) -> Result<Applied, String> {
            let iface = target.interface.as_str();
            if resolved_in_use() {
                let steps = resolvectl_apply_argv(iface, &target.servers);
                for (i, step) in steps.iter().enumerate() {
                    match resolvectl(step) {
                        Ok(_) => {}
                        // default-route: systemd < 240 lacks it, and `~.` has
                        // already routed every name to this link.
                        Err(e) if i == steps.len() - 1 => {
                            eprintln!("cumulusvpn: resolvectl default-route skipped: {e}");
                        }
                        Err(e) => {
                            let _ = resolvectl(&resolvectl_revert_argv(iface));
                            return Err(e);
                        }
                    }
                }
                let _ = resolvectl(&["flush-caches".to_string()]);
                return Ok(Applied::Resolved);
            }
            if have("resolvconf") {
                let record = record(iface);
                let argv = resolvconf_apply_argv(&record);
                let args: Vec<&str> = argv.iter().map(String::as_str).collect();
                run_capture(
                    "resolvconf",
                    &args,
                    Some(&resolvconf_input(&target.servers)),
                )?;
                return Ok(Applied::Resolvconf(record));
            }
            Err(
                "neither systemd-resolved nor resolvconf is available to set the system \
                 resolver"
                    .into(),
            )
        }

        /// Per-link and resolvconf state is not rewritten by the OS on a roam;
        /// nothing to re-take.
        pub(in super::super) fn reassert(_: &Applied, _: &DnsTarget) -> Result<(), String> {
            Ok(())
        }

        pub(in super::super) fn restore(applied: Option<&Applied>, target: &DnsTarget) {
            match applied {
                Some(Applied::Resolved) => {
                    let _ = resolvectl(&resolvectl_revert_argv(&target.interface));
                    let _ = resolvectl(&["flush-caches".to_string()]);
                }
                Some(Applied::Resolvconf(record)) => delete_record(record),
                // A failed apply leaves at most per-link resolved state, which
                // dies with the link.
                None => {}
            }
        }

        fn delete_record(record: &str) {
            let argv = resolvconf_delete_argv(record);
            let args: Vec<&str> = argv.iter().map(String::as_str).collect();
            let _ = run_capture("resolvconf", &args, None);
        }

        /// resolved: per-link state died with the link, nothing to do. resolvconf
        /// records outlive the process, so drop ours.
        pub(in super::super) fn recover_stale(logical_interfaces: &[&str]) {
            if resolved_in_use() || !have("resolvconf") {
                return;
            }
            for iface in logical_interfaces {
                delete_record(&record(iface));
            }
        }
    }
}

// ---- Windows: adapter DNS + WFP leak block ---------------------------------

#[cfg(windows)]
mod windows {
    pub(super) mod sys {
        use super::super::DnsTarget;
        use crate::win::{net, plan, wfp};

        #[derive(Debug)]
        pub(in super::super) struct Applied {
            /// The tunnel adapter, to reset if it outlives the session.
            luid: u64,
        }

        /// The leak block first, as the protection that holds whatever the
        /// adapter steps do; then the adapter's servers, suffix and metric 1
        /// (the DNS client prefers lower metrics); then a cache flush, so
        /// every lookup goes to the tunnel resolver.
        pub(in super::super) fn apply(target: &DnsTarget) -> Result<Applied, String> {
            let luid = net::luid_of(&target.interface)?;
            wfp::replace(
                wfp::Sublayer::Dns,
                &plan::dns_plan(&target.servers, &target.endpoint_ips, luid),
            )?;
            net::set_dns_servers(luid, &target.servers)?;
            net::set_ipv4_interface(luid, None, Some(1))?;
            net::flush_dns_cache();
            Ok(Applied { luid })
        }

        /// The adapter keeps its settings across a roam, and the filters name
        /// the tunnel adapter, so both hold as they are.
        pub(in super::super) fn reassert(_: &Applied, _: &DnsTarget) -> Result<(), String> {
            Ok(())
        }

        /// Lift the block and reset the adapter, which is usually already
        /// gone with its sidecar.
        pub(in super::super) fn restore(applied: Option<&Applied>, _: &DnsTarget) {
            if let Err(e) = wfp::clear(wfp::Sublayer::Dns) {
                eprintln!("cumulusvpn: DNS restore failed: {e}");
            }
            if let Some(applied) = applied {
                let _ = net::set_dns_servers(applied.luid, &[]);
            }
            net::flush_dns_cache();
        }

        /// At startup: remove a block a crashed session left, which would stop
        /// every lookup.
        pub(in super::super) fn recover_stale(_: &[&str]) {
            if let Err(e) = wfp::clear(wfp::Sublayer::Dns) {
                eprintln!("cumulusvpn: DNS recovery failed: {e}");
            }
        }
    }
}

// ---- platform dispatch -----------------------------------------------------

#[cfg(target_os = "linux")]
use linux::sys;
#[cfg(target_os = "macos")]
use macos::sys;
#[cfg(windows)]
use windows::sys;

/// No DNS mechanism on this platform: report it rather than pretend.
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod sys {
    use super::DnsTarget;

    #[derive(Debug)]
    pub(super) struct Applied;

    pub(super) fn apply(_: &DnsTarget) -> Result<Applied, String> {
        Err("setting the system resolver is not supported on this platform".into())
    }
    pub(super) fn reassert(_: &Applied, _: &DnsTarget) -> Result<(), String> {
        Ok(())
    }
    pub(super) fn restore(_: Option<&Applied>, _: &DnsTarget) {}
    pub(super) fn recover_stale(_: &[&str]) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test address")
    }

    #[test]
    fn servers_are_parsed_typed_and_deduplicated() {
        assert_eq!(parse_servers("1.1.1.1"), vec![ip("1.1.1.1")]);
        assert_eq!(
            parse_servers(" 1.1.1.1, 1.0.0.1 ,1.1.1.1"),
            vec![ip("1.1.1.1"), ip("1.0.0.1")]
        );
        assert_eq!(
            parse_servers("2606:4700:4700::1111"),
            vec![ip("2606:4700:4700::1111")]
        );
        // wg-quick allows search domains on the DNS line; they are not servers,
        // and nothing that is not an address may reach a script.
        assert_eq!(parse_servers("1.1.1.1, corp.example"), vec![ip("1.1.1.1")]);
        assert!(parse_servers("").is_empty());
        assert!(parse_servers("1.1.1.1; reboot").is_empty());
    }

    /// Settings → DNS sends two addresses per provider, `, `-joined. Every one
    /// must come through, in order, whatever the spacing; empty entries (a
    /// trailing comma) are ignored; junk next to a real address never drops it.
    #[test]
    fn every_server_of_a_provider_list_is_kept() {
        assert_eq!(
            parse_servers("9.9.9.9, 149.112.112.112"),
            vec![ip("9.9.9.9"), ip("149.112.112.112")]
        );
        assert_eq!(
            parse_servers("94.140.14.14,94.140.15.15,"),
            vec![ip("94.140.14.14"), ip("94.140.15.15")]
        );
        assert_eq!(
            parse_servers("  1.1.1.3 ,, 1.0.0.3  "),
            vec![ip("1.1.1.3"), ip("1.0.0.3")]
        );
        assert_eq!(
            parse_servers("9.9.9.9, 1.2.3.4 } accept, 149.112.112.112"),
            vec![ip("9.9.9.9"), ip("149.112.112.112")]
        );
        assert!(parse_servers(" , ,").is_empty());
    }

    fn target(servers: &[&str], endpoints: &[&str], pin_route: bool) -> DnsTarget {
        DnsTarget {
            interface: "cvpn0".into(),
            servers: servers.iter().map(|s| ip(s)).collect(),
            endpoint_ips: endpoints.iter().map(|s| ip(s)).collect(),
            pin_route,
            kill_switch: true,
        }
    }

    /// Split routing (docs/16 N10): an excluded prefix that contains a resolver
    /// must not take that resolver's lookups out of the tunnel — so EVERY
    /// configured resolver is pinned, not just the first.
    #[test]
    fn split_routing_pins_every_resolver_through_the_tunnel() {
        let t = target(&["9.9.9.9", "149.112.112.112"], &["203.0.113.7"], true);
        assert_eq!(
            pinned_servers(&t),
            vec![ip("9.9.9.9"), ip("149.112.112.112")]
        );
        // Never a WireGuard endpoint (that would loop the tunnel into itself),
        // never IPv6 (the tunnel carries none).
        let t = target(
            &["1.1.1.3", "203.0.113.7", "2606:4700:4700::1113", "1.0.0.3"],
            &["203.0.113.7"],
            true,
        );
        assert_eq!(pinned_servers(&t), vec![ip("1.1.1.3"), ip("1.0.0.3")]);
        // Full tunnel: the split-default route already covers every resolver.
        let t = target(&["9.9.9.9", "149.112.112.112"], &[], false);
        assert!(pinned_servers(&t).is_empty());
    }

    /// The interface name reaches PowerShell and resolvectl; anything that
    /// could break out of a quoted argument must be refused.
    #[test]
    fn interface_names_are_validated() {
        assert!(is_safe_iface("cvpn0"));
        assert!(is_safe_iface("cvpn-exit"));
        assert!(is_safe_iface("utun6"));
        assert!(!is_safe_iface(""));
        assert!(!is_safe_iface("cvpn0'; Remove-Item C:\\"));
        assert!(!is_safe_iface("cvpn0 x"));
    }

    #[test]
    fn the_warning_tells_the_user_what_the_kill_switch_changes() {
        let on = warning_text("scutil failed", true);
        assert!(on.contains("scutil failed"));
        assert!(on.contains("kill switch is blocking"), "{on}");
        let off = warning_text("scutil failed", false);
        assert!(off.contains("may leak"), "{off}");
        assert!(off.contains("turn on the kill switch"), "{off}");
        // A runaway reason (a PowerShell stack) is cut, not shown whole.
        assert!(warning_text(&"x".repeat(5000), false).len() < 500);
    }

    /// A session with no server must say so instead of reading as protected —
    /// and must not run anything to find that out.
    #[test]
    fn a_session_without_a_server_reports_it() {
        let s = DnsSession::start(DnsTarget {
            interface: "cvpn0".into(),
            servers: vec![],
            endpoint_ips: vec![],
            pin_route: false,
            kill_switch: false,
        });
        let w = s.warning().expect("a warning");
        assert!(w.contains("no DNS server"), "{w}");
        s.restore_without_side_effects_for_tests();
    }

    impl DnsSession {
        /// Drop a session in a test without running the platform restore, which
        /// would touch this machine's DNS.
        fn restore_without_side_effects_for_tests(self) {
            assert!(self.applied.is_none());
        }
    }

    // ---- macOS --------------------------------------------------------------

    mod macos_store {
        use super::super::macos::*;
        use super::ip;

        const ID: &str = "9133B5BE-A1BA-4E5A-93B9-1A7E0C5D16A2";
        const ID2: &str = "1D0082EB-C825-4728-8E17-3CC4F956D1C7";

        /// Real `scutil` output, captured read-only from a Mac with DHCP DNS on
        /// Wi-Fi and the user's manual servers in Setup: (which win).
        fn fresh() -> String {
            format!(
                "<dictionary> {{\n\
                 \x20 Setup:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 1.1.1.1\n\
                 \x20     1 : 8.8.8.8\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 \x20 State:/Network/Global/IPv4 : <dictionary> {{\n\
                 \x20   PrimaryInterface : en0\n\
                 \x20   PrimaryService : {ID}\n\
                 \x20   Router : 192.168.100.1\n\
                 \x20 }}\n\
                 \x20 State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 192.168.100.1\n\
                 \x20   }}\n\
                 \x20   SearchDomains : <array> {{\n\
                 \x20     0 : lan\n\
                 \x20   }}\n\
                 \x20   DomainName : lan\n\
                 \x20 }}\n\
                 }}\n"
            )
        }

        fn servers() -> Vec<std::net::IpAddr> {
            vec![ip("1.1.1.1")]
        }

        #[test]
        fn the_read_script_is_one_pattern_over_exactly_our_keys() {
            assert_eq!(
                READ_SCRIPT,
                "show ^((State|Setup):/Network/Service/[^/]+/DNS|State:/Network/Global/IPv[46]|State:/Network/CumulusVPN/Backup/(State|Setup)/[^/]+)$ pattern\nquit\n"
            );
            // scutil splits commands on whitespace: the pattern must have none.
            let pattern = READ_SCRIPT.lines().next().unwrap();
            assert_eq!(pattern.split_whitespace().count(), 3, "{pattern}");
        }

        #[test]
        fn scutil_output_is_parsed() {
            let snap = parse_snapshot(&fresh());
            assert_eq!(snap.primaries, vec![ID.to_string()]);
            assert_eq!(snap.dns.len(), 2);
            let state = &snap.dns[&(Layer::State, ID.to_string())];
            assert_eq!(state.arrays["ServerAddresses"], vec!["192.168.100.1"]);
            assert_eq!(state.scalar("DomainName"), Some("lan"));
            let setup = &snap.dns[&(Layer::Setup, ID.to_string())];
            assert_eq!(setup.arrays["ServerAddresses"], vec!["1.1.1.1", "8.8.8.8"]);
            assert!(snap.backups.is_empty());
        }

        #[test]
        fn empty_and_missing_output_parse_to_nothing() {
            assert_eq!(parse_snapshot("<dictionary> {\n}\n"), Snapshot::default());
            assert_eq!(parse_snapshot("  No such key\n"), Snapshot::default());
            assert_eq!(parse_snapshot(""), Snapshot::default());
        }

        /// IPv4 state carries nested dictionaries (AdditionalRoutes); those must
        /// be skipped without derailing the keys after them.
        #[test]
        fn nested_values_are_skipped_cleanly() {
            let text = format!(
                "<dictionary> {{\n\
                 \x20 State:/Network/Global/IPv4 : <dictionary> {{\n\
                 \x20   AdditionalRoutes : <array> {{\n\
                 \x20     0 : <dictionary> {{\n\
                 \x20       DestinationAddress : 192.168.100.64\n\
                 \x20     }}\n\
                 \x20   }}\n\
                 \x20   Nested : <dictionary> {{\n\
                 \x20     Deep : x\n\
                 \x20   }}\n\
                 \x20   PrimaryService : {ID}\n\
                 \x20 }}\n\
                 \x20 State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   CumulusVPNOverride : 1.1.1.1\n\
                 \x20 }}\n\
                 }}\n"
            );
            let snap = parse_snapshot(&text);
            assert_eq!(snap.primaries, vec![ID.to_string()]);
            assert_eq!(
                snap.dns[&(Layer::State, ID.to_string())].scalar(MARKER),
                Some("1.1.1.1")
            );
        }

        /// First connect: each original is copied exactly by scutil (`get` then
        /// `set` to the backup) BEFORE it is overridden, in both layers — the
        /// Setup: (manual) servers win over State:, so overriding State: alone
        /// would change nothing on this very machine.
        #[test]
        fn first_apply_backs_up_then_overrides_both_layers() {
            let plan = plan_apply(&parse_snapshot(&fresh()), &servers());
            let expected = format!(
                "d.init\n\
                 get State:/Network/Service/{ID}/DNS\n\
                 set State:/Network/CumulusVPN/Backup/State/{ID}\n\
                 d.remove ServerPort\n\
                 d.add ServerAddresses * 1.1.1.1\n\
                 d.add CumulusVPNOverride 1.1.1.1\n\
                 set State:/Network/Service/{ID}/DNS\n\
                 d.init\n\
                 get Setup:/Network/Service/{ID}/DNS\n\
                 set State:/Network/CumulusVPN/Backup/Setup/{ID}\n\
                 d.remove ServerPort\n\
                 d.add ServerAddresses * 1.1.1.1\n\
                 d.add CumulusVPNOverride 1.1.1.1\n\
                 set Setup:/Network/Service/{ID}/DNS\n\
                 quit\n"
            );
            assert_eq!(plan, expected);
        }

        /// A two-address provider (Settings → DNS): both go into the one
        /// `ServerAddresses` array of every key, and the marker names both, so
        /// a later re-assert recognises the override as current.
        #[test]
        fn a_two_server_provider_overrides_with_both_addresses() {
            let quad9 = [ip("9.9.9.9"), ip("149.112.112.112")];
            let plan = plan_apply(&parse_snapshot(&fresh()), &quad9);
            assert_eq!(
                plan.matches("d.add ServerAddresses * 9.9.9.9 149.112.112.112\n")
                    .count(),
                2,
                "{plan}"
            );
            assert_eq!(
                plan.matches("d.add CumulusVPNOverride 9.9.9.9,149.112.112.112\n")
                    .count(),
                2,
                "{plan}"
            );
            // What the store looks like once that plan ran: nothing left to do.
            let after = applied().replace("1.1.1.1\n", "9.9.9.9,149.112.112.112\n");
            let snap = parse_snapshot(&after);
            assert!(verify(&snap, &quad9).is_ok());
            assert!(
                verify(&snap, &servers()).is_err(),
                "another list is not ours"
            );
        }

        /// Store state after `first_apply…` ran.
        fn applied() -> String {
            format!(
                "<dictionary> {{\n\
                 \x20 Setup:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   CumulusVPNOverride : 1.1.1.1\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 1.1.1.1\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 \x20 State:/Network/CumulusVPN/Backup/Setup/{ID} : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 1.1.1.1\n\
                 \x20     1 : 8.8.8.8\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 \x20 State:/Network/CumulusVPN/Backup/State/{ID} : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 192.168.100.1\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 \x20 State:/Network/Global/IPv4 : <dictionary> {{\n\
                 \x20   PrimaryService : {ID}\n\
                 \x20 }}\n\
                 \x20 State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   CumulusVPNOverride : 1.1.1.1\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 1.1.1.1\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 }}\n"
            )
        }

        /// The repair loop runs this every tick: when nothing changed it must
        /// cost one read and write nothing.
        #[test]
        fn reasserting_an_intact_override_writes_nothing() {
            let snap = parse_snapshot(&applied());
            assert_eq!(plan_apply(&snap, &servers()), "");
            assert!(verify(&snap, &servers()).is_ok());
        }

        /// Roam / DHCP renewal: the owner republished State: (unmarked again).
        /// The fresh value becomes the backup — it is the newer original — and
        /// is taken over again. Setup: is still ours and is left alone.
        #[test]
        fn a_republished_key_is_backed_up_afresh_and_retaken() {
            let text = applied().replace(
                &format!(
                    "  State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                     \x20   CumulusVPNOverride : 1.1.1.1\n"
                ),
                &format!("  State:/Network/Service/{ID}/DNS : <dictionary> {{\n"),
            );
            let snap = parse_snapshot(&text);
            assert!(verify(&snap, &servers()).is_err(), "must be seen as lost");
            let plan = plan_apply(&snap, &servers());
            assert!(
                plan.contains(&format!(
                    "get State:/Network/Service/{ID}/DNS\nset State:/Network/CumulusVPN/Backup/State/{ID}\n"
                )),
                "{plan}"
            );
            assert!(!plan.contains("Setup:/Network/Service"), "{plan}");
        }

        /// A new network service appearing after a roam (dock → Ethernet) is
        /// taken over too.
        #[test]
        fn a_service_that_appears_later_is_taken_over() {
            let extra = format!(
                "  State:/Network/Service/{ID2}/DNS : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : fe80::1%en7\n\
                 \x20   }}\n\
                 \x20 }}\n}}\n"
            );
            let mut text = applied();
            text.truncate(text.len() - "}\n".len());
            text.push_str(&extra);
            let snap = parse_snapshot(&text);
            let plan = plan_apply(&snap, &servers());
            assert!(
                plan.contains(&format!(
                    "set State:/Network/CumulusVPN/Backup/State/{ID2}\n"
                )),
                "{plan}"
            );
            assert!(
                plan.contains(&format!(
                    "d.add CumulusVPNOverride 1.1.1.1\nset State:/Network/Service/{ID2}/DNS\n"
                )),
                "{plan}"
            );
            // The IPv6 link-local resolver is replaced, not kept alongside.
            assert!(!plan.contains("fe80::1"), "{plan}");
        }

        /// Reconnect to a gateway with another resolver: rewrite our keys, but
        /// the backups (the real originals) must not be overwritten with our
        /// previous override.
        #[test]
        fn a_new_resolver_rewrites_without_touching_backups() {
            let snap = parse_snapshot(&applied());
            let plan = plan_apply(&snap, &[ip("9.9.9.9"), ip("2620:fe::fe")]);
            assert!(!plan.contains("CumulusVPN/Backup"), "{plan}");
            assert!(
                plan.contains("d.add ServerAddresses * 9.9.9.9 2620:fe::fe\n"),
                "{plan}"
            );
            assert!(
                plan.contains("d.add CumulusVPNOverride 9.9.9.9,2620:fe::fe\n"),
                "{plan}"
            );
        }

        /// A primary with no DNS at all (static IP, no servers) gets one, with an
        /// "absent" backup so restore removes it instead of inventing a value.
        #[test]
        fn a_primary_without_dns_gets_one_marked_for_removal() {
            let text = format!(
                "<dictionary> {{\n\
                 \x20 State:/Network/Global/IPv4 : <dictionary> {{\n\
                 \x20   PrimaryService : {ID}\n\
                 \x20 }}\n\
                 }}\n"
            );
            let snap = parse_snapshot(&text);
            assert!(verify(&snap, &servers()).is_err());
            assert_eq!(
                plan_apply(&snap, &servers()),
                format!(
                    "d.init\n\
                     d.add CumulusVPNAbsent # 1\n\
                     set State:/Network/CumulusVPN/Backup/State/{ID}\n\
                     d.init\n\
                     d.remove ServerPort\n\
                     d.add ServerAddresses * 1.1.1.1\n\
                     d.add CumulusVPNOverride 1.1.1.1\n\
                     set State:/Network/Service/{ID}/DNS\n\
                     quit\n"
                )
            );
        }

        /// Restore copies each backup back exactly (scutil `get` + `set`, no
        /// re-typing of values) and removes the backups.
        #[test]
        fn restore_puts_every_original_back_and_clears_backups() {
            let plan = plan_restore(&parse_snapshot(&applied()));
            assert_eq!(
                plan,
                format!(
                    "d.init\n\
                     get State:/Network/CumulusVPN/Backup/State/{ID}\n\
                     set State:/Network/Service/{ID}/DNS\n\
                     remove State:/Network/CumulusVPN/Backup/State/{ID}\n\
                     d.init\n\
                     get State:/Network/CumulusVPN/Backup/Setup/{ID}\n\
                     set Setup:/Network/Service/{ID}/DNS\n\
                     remove State:/Network/CumulusVPN/Backup/Setup/{ID}\n\
                     quit\n"
                )
            );
        }

        /// The owner republished a key after we took it (unmarked now): that
        /// value is newer than our backup and must survive the restore.
        #[test]
        fn restore_never_overwrites_a_value_its_owner_republished() {
            let text = applied().replace(
                &format!(
                    "  State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                     \x20   CumulusVPNOverride : 1.1.1.1\n"
                ),
                &format!("  State:/Network/Service/{ID}/DNS : <dictionary> {{\n"),
            );
            let plan = plan_restore(&parse_snapshot(&text));
            assert!(
                !plan.contains(&format!("set State:/Network/Service/{ID}/DNS")),
                "{plan}"
            );
            assert!(
                plan.contains(&format!(
                    "remove State:/Network/CumulusVPN/Backup/State/{ID}\n"
                )),
                "{plan}"
            );
        }

        #[test]
        fn restore_of_an_absent_original_removes_the_key() {
            let text = format!(
                "<dictionary> {{\n\
                 \x20 State:/Network/CumulusVPN/Backup/State/{ID} : <dictionary> {{\n\
                 \x20   CumulusVPNAbsent : 1\n\
                 \x20 }}\n\
                 \x20 State:/Network/Service/{ID}/DNS : <dictionary> {{\n\
                 \x20   CumulusVPNOverride : 1.1.1.1\n\
                 \x20 }}\n\
                 }}\n"
            );
            assert_eq!(
                plan_restore(&parse_snapshot(&text)),
                format!(
                    "remove State:/Network/Service/{ID}/DNS\n\
                     remove State:/Network/CumulusVPN/Backup/State/{ID}\n\
                     quit\n"
                )
            );
        }

        /// The service went away while connected: drop the backup, do not
        /// resurrect a DNS entity for a service that no longer exists.
        #[test]
        fn restore_for_a_vanished_service_only_drops_the_backup() {
            let text = format!(
                "<dictionary> {{\n\
                 \x20 State:/Network/CumulusVPN/Backup/State/{ID2} : <dictionary> {{\n\
                 \x20   ServerAddresses : <array> {{\n\
                 \x20     0 : 10.0.0.1\n\
                 \x20   }}\n\
                 \x20 }}\n\
                 }}\n"
            );
            assert_eq!(
                plan_restore(&parse_snapshot(&text)),
                format!("remove State:/Network/CumulusVPN/Backup/State/{ID2}\nquit\n")
            );
        }

        /// Nothing of ours in the store (a clean start): recovery writes nothing.
        #[test]
        fn restore_with_nothing_stale_writes_nothing() {
            assert_eq!(plan_restore(&parse_snapshot(&fresh())), "");
        }

        /// Service IDs end up in script lines that scutil splits on whitespace.
        /// An ID that could smuggle a second command is never touched.
        #[test]
        fn unsafe_service_ids_are_ignored() {
            assert!(is_safe_service_id(ID));
            assert!(!is_safe_service_id("x remove State:/Network/Global/IPv4"));
            assert!(!is_safe_service_id(""));
            let text = "<dictionary> {\n\
                        \x20 State:/Network/Service/evil id/DNS : <dictionary> {\n\
                        \x20   ServerAddresses : <array> {\n\
                        \x20     0 : 10.0.0.1\n\
                        \x20   }\n\
                        \x20 }\n\
                        }\n";
            let snap = parse_snapshot(text);
            assert!(snap.dns.is_empty());
            assert_eq!(plan_apply(&snap, &servers()), "");
        }
    }

    // ---- Linux --------------------------------------------------------------

    mod linux_resolvers {
        use super::super::linux::*;
        use super::ip;

        #[test]
        fn resolvectl_routes_every_name_to_the_tunnel_link() {
            let argv = resolvectl_apply_argv("cvpn0", &[ip("1.1.1.1")]);
            assert_eq!(
                argv,
                vec![
                    vec!["dns", "cvpn0", "1.1.1.1"],
                    vec!["domain", "cvpn0", "~."],
                    vec!["default-route", "cvpn0", "true"],
                ]
            );
            assert_eq!(
                resolvectl_revert_argv("cvpn-exit"),
                vec!["revert", "cvpn-exit"]
            );
        }

        #[test]
        fn resolvectl_takes_every_server() {
            let argv = resolvectl_apply_argv("cvpn0", &[ip("1.1.1.1"), ip("2606:4700:4700::1111")]);
            assert_eq!(
                argv[0],
                vec!["dns", "cvpn0", "1.1.1.1", "2606:4700:4700::1111"]
            );
        }

        /// A two-address provider: both servers on the link, both in the
        /// exclusive resolvconf record.
        #[test]
        fn both_servers_of_a_provider_reach_resolved_and_resolvconf() {
            let quad9 = [ip("9.9.9.9"), ip("149.112.112.112")];
            assert_eq!(
                resolvectl_apply_argv("cvpn-exit", &quad9)[0],
                vec!["dns", "cvpn-exit", "9.9.9.9", "149.112.112.112"]
            );
            assert_eq!(
                resolvconf_input(&quad9),
                "nameserver 9.9.9.9\nnameserver 149.112.112.112\n"
            );
        }

        #[test]
        fn resolved_counts_only_when_it_is_the_system_resolver() {
            let stub = "# managed by resolved\nnameserver 127.0.0.53\noptions edns0\n";
            // Stub mode, by symlink and by content.
            assert!(resolved_is_system_resolver(
                true,
                Some("../run/systemd/resolve/stub-resolv.conf"),
                Some(stub)
            ));
            assert!(resolved_is_system_resolver(true, None, Some(stub)));
            assert!(resolved_is_system_resolver(
                true,
                None,
                Some("nameserver 127.0.0.54\n")
            ));
            // Running, but /etc/resolv.conf is someone else's: per-link config
            // would change nothing, so fall back.
            assert!(!resolved_is_system_resolver(
                true,
                None,
                Some("nameserver 192.168.1.1\n")
            ));
            // Not running at all.
            assert!(!resolved_is_system_resolver(false, None, Some(stub)));
            assert!(!resolved_is_system_resolver(true, None, None));
        }

        #[test]
        fn resolvconf_is_exclusive_and_first_like_wg_quick() {
            assert_eq!(
                resolvconf_apply_argv("tun.cvpn0"),
                vec!["-a", "tun.cvpn0", "-m", "0", "-x"]
            );
            assert_eq!(
                resolvconf_delete_argv("tun.cvpn0"),
                vec!["-d", "tun.cvpn0", "-f"]
            );
            assert_eq!(
                resolvconf_input(&[ip("1.1.1.1"), ip("1.0.0.1")]),
                "nameserver 1.1.1.1\nnameserver 1.0.0.1\n"
            );
        }

        /// Debian's resolvconf orders records by interface-order; wg-quick
        /// prefixes with its first wildcard entry so the tunnel sorts first.
        #[test]
        fn resolvconf_prefix_follows_interface_order() {
            let debian = "lo.inet6\nlo.inet\nlo.@(dnsmasq|pdnsd)\nlo.!(pdns|pdns-recursor)\nlo\ntun*\ntap*\nhso*\nem+([0-9])?(_+([0-9]))*\n";
            assert_eq!(resolvconf_iface_prefix(Some(debian)), "tun.");
            assert_eq!(resolvconf_iface_prefix(None), "");
            assert_eq!(resolvconf_iface_prefix(Some("lo\neth0\n")), "");
            assert_eq!(resolvconf_record("tun.", "cvpn0"), "tun.cvpn0");
        }
    }
}
