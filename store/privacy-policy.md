# CumulusVPN Privacy Policy

**Last updated: 16 July 2026**
**Effective date: 16 July 2026**

CumulusVPN is a decentralized VPN service. This policy explains, in plain language, exactly
what we do and do not collect. It is short because the service is built to collect almost
nothing. If a claim here is ever wrong, that is a bug we will fix — the architecture is
described publicly at https://cumulusvpn.com and in our source code.

Contact for privacy questions and data requests: **info@cumulusvpn.com**
Abuse reports: **info@cumulusvpn.com**

---

## 1. Summary (the whole policy in one screen)

- **No account. No email. No password. No phone number.** You never give us your identity.
- **No activity logs.** We do not record the websites you visit, your DNS queries, your
  traffic contents, your bandwidth history, or connection timestamps to any persistent store.
- **Your identity is a cryptographic key**, generated on your own device. We never see your
  private key. We only ever see a public key, which is a random-looking string with no link
  to you.
- **Gateways keep peer state in RAM only.** When a server restarts, that state is gone. There
  is no traffic database to seize, subpoena, or leak.
- **Payments are optional and made in FLUX cryptocurrency on a public blockchain.** We do not
  operate the blockchain, do not take card details, and never learn your name from a payment.
- **No trackers, no advertising SDKs, no analytics that identify you.** The apps contain no
  third-party advertising or behavioural-tracking code.
- **We are not a data business.** We have no user data to sell, and we do not sell data.

---

## 2. Who we are

CumulusVPN ("we", "us") is a VPN service operated by the CumulusVPN team, built on the Flux
decentralized cloud network (https://runonflux.io). VPN exit servers ("gateways") run as
containerized apps on Flux datacenter nodes operated by independent, KYC-verified datacenter
operators. We publish the service; the underlying compute is decentralized.

For the purposes of the EU/UK General Data Protection Regulation (GDPR), to the very limited
extent any of the information below is "personal data", the CumulusVPN operating entity is the
data controller. The lawful basis we rely on is our legitimate interest (Article 6(1)(f)) in
providing a functioning, abuse-resistant VPN, and — for payments — performance of the service
you request (Article 6(1)(b)). Because the service is designed to be anonymous, in most cases
we hold no data that can be linked to you at all.

---

## 3. What we do NOT collect

We want to be explicit, because most VPNs bury this. CumulusVPN does **not** collect, log, or
store any of the following:

- Your name, email address, phone number, or any account credentials — there are no accounts.
- Your originating IP address in any persistent log.
- The websites, domains, or services you connect to.
- Your DNS queries (DNS is resolved for you through the tunnel and not recorded).
- The contents, timing, or size of your traffic, in any persistent database.
- A bandwidth history, session history, or connection-timestamp history tied to you.
- Device advertising identifiers (IDFA / GAID) — we do not request or use them.
- Location data from your device (GPS, precise or coarse). The country you connect *through* is
  your choice of server, not a reading of your device location.
- Contacts, photos, files, microphone, camera, or any device sensor.

We do not use third-party advertising networks, and we do not use analytics products that
build a profile of you (such as ad-tech SDKs). The apps ship without behavioural trackers.

---

## 4. What is technically involved (and why it isn't a profile of you)

A VPN cannot function without some data passing through it in real time. Here is all of it,
and why none of it becomes a record about you.

### 4.1 Your public key (pseudonymous identifier)
Your device generates a WireGuard key pair locally on first launch. The **private key never
leaves your device** — not even to us. Only the **public key** is sent to a gateway so it can
route your encrypted tunnel. A public key is a 32-byte random-looking value. It is not tied to
your name, email, or hardware, and you can regenerate it at any time. It is a pseudonym, not an
identity.

### 4.2 In-memory peer state on the gateway
While you are connected, the gateway holds — **in volatile memory (RAM) only** — the minimum
needed to route packets: your public key, the temporary internal tunnel IP assigned to it
(e.g. 10.8.x.y), and a byte counter used to enforce your speed tier. This state is **never
written to disk**, is not shipped to any central server, and is **erased when the gateway
process restarts** or you disconnect. There is no historical log built from it.

### 4.3 Your real IP address, transiently
To carry your traffic, the gateway necessarily sees the IP address your connection arrives
from, in the moment, at the network layer — this is how any internet server works. CumulusVPN
does **not** log this address to any persistent store, and does not associate it with your
browsing. When your session ends, it is not retained.

### 4.4 DNS
DNS look-ups are resolved on your behalf through the encrypted tunnel so your local network and
ISP cannot see them. We do not keep DNS query logs.

### 4.5 What gateway operators can and cannot see
Gateways are run on Flux datacenter nodes. Like any VPN exit, an operator observing their own
server can see encrypted flow metadata in real time (that a peer is sending traffic), but not a
persistent log we create, and not the tunnel contents. For users who do not want any single
server to see both their IP and their destination, CumulusVPN offers an **optional multi-hop
mode**: your traffic is routed through two gateways so that no single server sees both who you
are and where you are going. Multi-hop is off by default and is described honestly in the app.

---

## 5. Payments (only if you upgrade to premium)

CumulusVPN has a free tier that requires **no payment and no identifying information**.

If you choose to upgrade to premium (higher speed), you pay in **FLUX cryptocurrency** on the
Flux public blockchain. Important points:

- **Payment happens on the web or desktop, not inside the mobile apps.** The mobile apps do not
  contain a purchase screen; they only display your current tier.
- You send FLUX from **your own wallet** to our published payment address, including a short
  memo derived from your public key so the network can credit the right key. We do **not**
  collect card numbers, billing addresses, or names.
- **Blockchain transactions are public by nature.** Anyone, including us, can see on the public
  ledger that a payment of a certain amount was made to our address with a given memo. That
  ledger is operated by the Flux blockchain, not by us. We do not link that transaction to your
  real-world identity, and the memo is derived one-way from your public key — it does not reveal
  your key or your traffic. Please understand that publishing a transaction to a public
  blockchain is inherently public; treat your wallet's privacy accordingly.
- Entitlement (whether a key is premium and until when) is computed deterministically from the
  public blockchain and keyed only to the public key. We store no separate customer billing
  record with your name in it, because we do not have your name.

If you later use an in-app fiat payment option offered through Apple's App Store or Google Play
(should we add one), that transaction is processed by Apple or Google under their own privacy
policies; we receive only the confirmation needed to grant premium, not your payment card data.

---

## 6. Support and voluntary contact

If you email us (for support or an abuse report), we receive whatever you put in that email —
for example your email address and the text of your message. We use it only to answer you and
keep it no longer than needed to resolve the matter. You are not required to identify yourself
to use the service; contacting support is voluntary.

Optional, opt-in crash reports: if — and only if — you explicitly enable crash reporting, a
crash report containing technical diagnostic information (such as the app version, device model,
OS version, and a stack trace) may be sent to help us fix bugs. This is **off by default**,
contains no browsing activity, and can be turned off at any time.

---

## 7. Cookies and the website

The CumulusVPN website (cumulusvpn.com) is a static site used for downloads, documentation, the
payment page, and hosting our signed server directory. It does not use advertising cookies or
third-party behavioural trackers. Any cookies used are strictly functional (for example
remembering light/dark theme).

---

## 8. Data sharing and disclosure

We do not sell, rent, or trade personal data — we have essentially none to sell.

Because we keep no activity logs and no user identities, **we have nothing to hand over** in
response to a data request about a user's browsing. If we receive a legally valid law-
enforcement or court request, we can only provide the information we actually hold, which does
not include user identities, browsing history, DNS queries, or traffic contents, because those
records do not exist. Where lawful and appropriate, we intend to publish a transparency report
describing requests received.

We do not transfer user profiles to advertisers, data brokers, or analytics vendors, because we
do not build user profiles.

---

## 9. International transfers

CumulusVPN is a global network of gateways. When you connect, your traffic egresses from the
country of the server **you choose**. Because we do not collect personal data into a central
database, there is no cross-border transfer of a personal-data store to safeguard. The choice of
exit country is yours and is made fresh each session.

---

## 10. Your rights (GDPR / UK GDPR / CCPA and similar)

Depending on where you live, you may have rights to access, correct, delete, or port your
personal data, to object to or restrict processing, and (in California) to know what is
collected and to not be discriminated against for exercising these rights. Because the service
is anonymous:

- **Access / portability:** We generally hold no personal data linked to you to provide. If you
  emailed support, you can ask for a copy of that correspondence.
- **Deletion:** There is nothing tied to your identity for us to delete from gateways; peer
  state is already ephemeral RAM-only and clears on disconnect/restart. You can delete your key
  on your device at any time, which fully severs the pseudonymous link.
- **Do-not-sell / do-not-share:** We do not sell or share personal data, so there is nothing to
  opt out of.

To exercise any right, email **info@cumulusvpn.com**. We may be unable to identify you in our
(nonexistent) records precisely because the service is anonymous — that is the design, not an
evasion. You also have the right to lodge a complaint with your local data protection authority.

---

## 11. Children

CumulusVPN is not directed to children under 13 (or the minimum age of digital consent in your
country). We do not knowingly collect personal data from children. Because we collect no
identifying data from anyone, we cannot determine a user's age; the service is intended for
general audiences and is not marketed to children.

---

## 12. Security

Traffic is encrypted end-to-end between your device and the gateway using the WireGuard®
protocol (modern, audited cryptography). Your private key never leaves your device. Server-side
peer state is kept in memory only. Our client apps verify the authenticity of the server
directory and gateway responses using digital signatures to resist tampering.

---

## 13. Changes to this policy

If we change this policy, we will update the "Last updated" date above and post the new version
at https://cumulusvpn.com/privacy. Material changes will be highlighted. Because we keep no
mailing list, the website is the authoritative source for the current policy.

---

## 14. Contact

- Privacy and data requests: **info@cumulusvpn.com**
- Abuse / network complaints: **info@cumulusvpn.com**
- Website: **https://cumulusvpn.com**

WireGuard is a registered trademark of Jason A. Donenfeld. CumulusVPN is an independent project
and is not endorsed by or affiliated with the WireGuard project.
