# 06 — Legal & abuse (read before building anything)

This is the area that kills dVPNs, not technology. Mysterium's residential node runners were
**raided by German police** (2024–25) over traffic that transited their exits; Mullvad — a
best-in-class operator — dropped port forwarding in 2023 because abuse got their IPs blacklisted;
Hetzner/OVH/AWS escalate against exit-like traffic fast. Flux nodes sit in exactly those
datacenters and in homes. We are asking node operators to carry VPN exit traffic **without
knowing it** unless we design otherwise. That is the central issue.

## Position we should take (recommendation)

1. **Placement: open specs on any static-IP Flux node (decided 2026-10-12 — datacenter-only is
   NOT required).**
   - The fleet is registered as the OPEN v8 variant with `staticip: true` and no `datacenter` flag
     (deploy/countries.yaml): instances can land on any Flux node with a static IP, not only on
     KYC'd ArcaneOS datacenter nodes. The original plan here (enterprise + `datacenter: true`) was
     never deployable — the encrypted path's `encrypt.mjs` is a stub — and the owner decided it is
     not needed: datacenter-only would empty the countries that have no such nodes.
   - In practice most of the fleet still lands in datacenters, because static IPs are mostly a
     datacenter trait: 22 of 27 countries demand `staticip`. The 5 that can't — mx, za, my, hk,
     ae (0 static nodes, per countries.yaml) — run on any node, possibly residential. Static IP
     does not guarantee a datacenter, so public copy says neither.
   - Consequence for copy: never claim "datacenter nodes", "KYC-verified operators" or
     "enterprise apps" anywhere public (site, privacy policy, store text, README). The accurate
     line is "independent Flux node operators", and the Terms (cumulusvpn.com/terms §2) say we
     don't own or access those machines.
   - The Mysterium risk (an exit on a private node-runner's machine drawing complaints) is
     therefore carried by the mitigations below rather than by placement. Still worth asking the
     Flux team for an operator-level "no VPN-exit apps" opt-out honored at spawn time.
2. **Run the abuse desk ourselves.** Reverse-DNS is not ours to set on Flux nodes, but we can:
   port-80 notice page on the gateway ("this IP is a VPN egress of CumulusVPN (RunOnFlux), abuse@…, we hold no
   user data"), published abuse contact, response SLAs and templates, and a public transparency
   page. Goal: complaints route to us, not the node operator's hosting provider.
3. **Technical mitigations from day one** (Tor's playbook, in the gateway):
   - Outbound 25/465/587 blocked always (spam is complaint #1; Flux already bans inbound 25).
   - Launch with a conservative exit-port allowlist; widen as the abuse desk proves quiet.
   - Per-peer new-connection rate ceilings (kills scanners and reflection abuse).
   - Free tier's 100 KB/s is itself a strong abuse damper; consider free-tier port list stricter
     than paid.
4. **No logs, minimal state, and mean it.** Memory-only peer tables, no traffic or connection
   logging anywhere in the code, documented in source and website. This is both the product
   promise and the correct legal posture (nothing to produce). US DMCA 512(a) conduit and EU DSA
   Art. 4 mere-conduit arguments both strengthen when we're a passive pipe with no records.
5. **Entity & jurisdiction:** put the service (payment address ownership, app-spec ownership,
   abuse desk) under a dedicated entity in a VPN-friendly jurisdiction; legal review before
   mainnet launch — specifically on the novel question "liability of container hosts who did not
   choose the workload." No precedent exists for the Flux model; get a written opinion.
6. **Honest threat-model page:** we protect against local-network snooping, geo-blocks, ISP
   logging; node operators can see encrypted flow metadata; we are not Tor. Marketing must not
   oversell — Mullvad's credibility is the model.

## Residual risks we accept knowingly

| Risk | Notes |
|---|---|
| A node operator gets an abuse letter despite mitigations | Abuse desk + notice page + fast IP-level kill (we can stop selecting a node / redeploy) — and the opt-in work above. |
| CSAM/serious-crime transit | Port filtering doesn't stop it; no-logs means we can't identify users (by design). Cooperate on IP/timestamp facts we do have (none beyond "this was our exit"). Same posture as Mullvad/Tor; document it. |
| Payment address = us = pressure point | Multisig + entity structure; worst case the network keeps running on existing specs while payment address rotates via spec update. |
| Store bans (VPN + crypto adjacency) | Compliant flows per 05; web/.conf path is uncensorable fallback. |
