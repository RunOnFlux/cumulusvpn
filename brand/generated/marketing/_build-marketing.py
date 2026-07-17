#!/usr/bin/env python3
# Generates self-contained HTML store frames + banners for CumulusVPN marketing.
# Reuses the exact design tokens from design/mockups.html (dark theme, forced).
import os

BUILD = "/private/tmp/claude-501/-Users-tadeaskmenta-repos-fluxvpn/41cb30a5-09b3-4e75-b2c1-1caaf3192065/scratchpad/frames"
os.makedirs(BUILD, exist_ok=True)

# ---- shared brand + phone CSS (dark, forced) ----
BASE_CSS = r"""
:root{
  --ink:#0C1420; --cyan:#0FB9AE; --cyan-glow:#34E4DA; --amber:#F5B23D; --amber-2:#F5B23D;
  --green:#34D399;
  --phone-sky-1:#10203a; --phone-sky-2:#1d3a63; --phone-sky-3:#2f6f9e;
  --mono: ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{ -webkit-font-smoothing:antialiased; font-family:var(--sans); }
.mono{font-family:var(--mono);}

/* ---- store frame shell ---- */
.frame{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  background:linear-gradient(157deg,#0B1424 0%,#0C2230 52%,#0A2E30 100%);}
.frame .glow{position:absolute;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle, rgba(52,228,218,.30), rgba(15,185,174,.10) 45%, transparent 68%);
  filter:blur(8px);}
.cap{position:relative;z-index:2;text-align:center;color:#EAF1F8;}
.cap .lock{display:inline-flex;align-items:center;gap:var(--lgap);justify-content:center;}
.cap .lock .mk{width:var(--mksz);height:var(--mksz);}
.cap .lock .wm{font-weight:700;letter-spacing:-.02em;color:#EAF1F8;}
.cap .lock .wm b{color:var(--cyan-glow);font-weight:700;}
.cap h1{font-weight:800;letter-spacing:-.03em;line-height:1.02;text-wrap:balance;}
.cap h1 .em{color:var(--cyan-glow);}
.cap h1 .am{color:var(--amber-2);}
.cap .kick{font-family:var(--mono);text-transform:uppercase;color:var(--cyan-glow);font-weight:600;}
.stage{position:relative;z-index:2;}

/* ---- phone (from mockups.html, dark) ---- */
.phone{border-radius:40px;padding:12px;background:linear-gradient(160deg,#202b38,#0c1119);
  box-shadow:0 30px 70px -24px rgba(4,10,20,.6),0 0 0 1px rgba(255,255,255,.05) inset;width:300px;}
.phone .screen{border-radius:30px;overflow:hidden;background:var(--phone-sky-1);position:relative;
  aspect-ratio:300/640;display:flex;flex-direction:column;}
.notch{position:absolute;top:9px;left:50%;transform:translateX(-50%);width:92px;height:20px;
  background:#05080d;border-radius:12px;z-index:5;}
.stbar{display:flex;justify-content:space-between;align-items:center;padding:12px 20px 0;
  font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.82);z-index:4;}
.stbar .rt{display:inline-flex;align-items:center;gap:6px;}
.sig{display:inline-flex;align-items:flex-end;gap:1.5px;height:10px;}
.sig i{width:2.5px;background:rgba(255,255,255,.82);border-radius:1px;}
.sig i:nth-child(1){height:4px;} .sig i:nth-child(2){height:6px;}
.sig i:nth-child(3){height:8px;} .sig i:nth-child(4){height:10px;}
.batt{width:18px;height:9px;border:1px solid rgba(255,255,255,.7);border-radius:2px;position:relative;padding:1px;}
.batt::after{content:"";position:absolute;right:-3px;top:2.5px;width:2px;height:3px;background:rgba(255,255,255,.7);border-radius:0 1px 1px 0;}
.batt i{display:block;height:100%;width:100%;background:rgba(255,255,255,.82);border-radius:1px;}

.app{flex:1;display:flex;flex-direction:column;padding:16px 18px 20px;color:#EAF3FA;
  background:linear-gradient(180deg,var(--phone-sky-1),var(--phone-sky-2) 58%,var(--phone-sky-3));}
.app.disc{background:linear-gradient(180deg,#0d1622,#16202e 60%,#202c3c);}
.app-top{display:flex;align-items:center;justify-content:space-between;margin-top:8px;}
.app-title{font-weight:700;letter-spacing:-.01em;font-size:15px;display:flex;gap:8px;align-items:center;}
.tier-pill{font-family:var(--mono);font-size:10.5px;padding:4px 9px;border-radius:20px;font-weight:600;}
.tier-pill.free{background:rgba(255,255,255,.12);color:#cfe0ee;}
.tier-pill.prem{background:var(--amber-2);color:#3a2606;}

.orb-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;}
.orb{width:168px;height:168px;border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative;}
.orb .ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.14);}
.orb.on{background:radial-gradient(circle at 50% 42%, rgba(52,228,218,.55), transparent 68%);}
.orb.on .ring{border-color:var(--cyan-glow);box-shadow:0 0 40px -4px var(--cyan-glow),0 0 0 8px rgba(52,228,218,.08);}
.orb .core{width:120px;height:120px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;}
.orb.on .core{background:rgba(9,20,26,.5);border:1px solid rgba(52,228,218,.4);}
.orb.off .core{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);}
.orb .pw{width:26px;height:26px;}
.orb .state{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;}
.orb.on .state{color:var(--cyan-glow);} .orb.off .state{color:#9fb2c4;}
.conn-loc{text-align:center;}
.conn-loc .flag{font-size:30px;line-height:1;}
.conn-loc .c{font-size:21px;font-weight:700;letter-spacing:-.01em;margin-top:4px;}
.conn-loc .ip{font-family:var(--mono);font-size:11.5px;color:rgba(203,224,238,.7);margin-top:3px;}
.stat-row{display:flex;gap:10px;margin-top:4px;}
.stat{flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px 12px;}
.stat .k{font-size:10px;color:rgba(203,224,238,.65);text-transform:uppercase;letter-spacing:.06em;}
.stat .v{font-family:var(--mono);font-size:15px;font-weight:600;margin-top:3px;}
.stat .v .u{font-size:10px;color:rgba(203,224,238,.6);}
.loc-btn{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;margin-top:14px;}
.loc-btn .flag{font-size:22px;}
.loc-btn .meta{flex:1;}
.loc-btn .meta .t{font-weight:600;font-size:14px;}
.loc-btn .meta .s{font-family:var(--mono);font-size:10.5px;color:rgba(203,224,238,.65);}
.loc-btn .chev{color:rgba(203,224,238,.6);}
.big-connect{margin-top:14px;text-align:center;background:var(--cyan);color:#05201E;font-weight:700;
  border-radius:14px;padding:15px;font-size:15px;letter-spacing:-.01em;}
.big-disc{margin-top:14px;text-align:center;background:rgba(255,255,255,.1);color:#EAF3FA;font-weight:600;
  border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:13px;font-size:14px;}

.searchbar{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 13px;font-family:var(--mono);
  font-size:12px;color:rgba(203,224,238,.55);margin-top:12px;}
.searchbar svg{width:13px;height:13px;flex-shrink:0;}
.clist{margin-top:10px;display:flex;flex-direction:column;gap:6px;overflow:hidden;}
.crow{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:11px;}
.crow.sel{background:rgba(52,228,218,.14);border:1px solid rgba(52,228,218,.35);}
.crow:not(.sel){background:rgba(255,255,255,.04);}
.crow .flag{font-size:20px;}
.crow .nm{flex:1;font-size:14px;font-weight:600;}
.crow .nm .sub{font-family:var(--mono);font-size:10px;color:rgba(203,224,238,.55);font-weight:400;}
.ping{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;}
.dot{width:7px;height:7px;border-radius:50%;}
.dot.g{background:var(--green);} .dot.y{background:var(--amber-2);} .dot.r{background:#ef6a5a;}

.pay{flex:1;display:flex;flex-direction:column;padding:18px;color:#EAF3FA;
  background:linear-gradient(180deg,#141a24,#1c2636 70%,#24344a);}
.pay h3{font-size:19px;letter-spacing:-.02em;}
.pay .sub{font-size:12.5px;color:rgba(203,224,238,.7);margin-top:4px;}
.amount{text-align:center;margin:8px 0;}
.amount .big{font-family:var(--mono);font-size:40px;font-weight:700;letter-spacing:-.03em;color:var(--amber-2);}
.amount .usd{font-size:12px;color:rgba(203,224,238,.6);}
.qr{width:116px;height:116px;margin:6px auto;border-radius:12px;
  background:repeating-conic-gradient(#0b0f16 0 25%,#e9f2fb 0 50%) 0 0/15px 15px;border:5px solid #e9f2fb;}
.field{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 11px;margin-top:8px;}
.field .lab{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:rgba(203,224,238,.55);}
.field .val{font-family:var(--mono);font-size:11.5px;margin-top:3px;word-break:break-all;display:flex;justify-content:space-between;gap:8px;}
.field .val .cp{color:var(--cyan-glow);flex-shrink:0;}
.pay-note{font-size:10.5px;color:rgba(203,224,238,.55);margin-top:10px;text-align:center;line-height:1.45;}

/* ---- multi-hop screen ---- */
.mh{flex:1;display:flex;flex-direction:column;padding:16px 18px 20px;color:#EAF3FA;
  background:linear-gradient(180deg,#0d1622,#141f30 60%,#182742);}
.seg{display:flex;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:3px;margin-top:14px;}
.seg .s{flex:1;text-align:center;font-size:12px;font-weight:600;padding:8px 0;border-radius:9px;color:rgba(203,224,238,.7);}
.seg .s.on{background:var(--cyan);color:#05201E;}
.route{margin-top:16px;display:flex;flex-direction:column;gap:0;position:relative;}
.hop{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:12px 14px;position:relative;z-index:2;}
.hop .flag{font-size:22px;}
.hop .m{flex:1;}
.hop .m .t{font-weight:700;font-size:14px;}
.hop .m .s{font-family:var(--mono);font-size:10.5px;color:rgba(203,224,238,.6);}
.hop .tag{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;
  padding:4px 8px;border-radius:20px;font-weight:600;}
.hop .tag.entry{background:rgba(52,228,218,.16);color:var(--cyan-glow);}
.hop .tag.exit{background:rgba(245,178,61,.16);color:var(--amber-2);}
.link{height:26px;margin:-1px 0 -1px 27px;border-left:2px dashed rgba(52,228,218,.5);position:relative;z-index:1;}
.link .lbl{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-family:var(--mono);
  font-size:9.5px;color:rgba(203,224,238,.6);white-space:nowrap;}
.mh-note{display:flex;gap:9px;background:rgba(52,228,218,.07);border:1px solid rgba(52,228,218,.2);
  border-radius:12px;padding:11px 13px;margin-top:14px;}
.mh-note .ico{color:var(--cyan-glow);flex-shrink:0;font-size:14px;line-height:1.3;}
.mh-note .tx{font-size:11px;color:rgba(203,224,238,.82);line-height:1.45;}
.mh-stat{display:flex;gap:10px;margin-top:12px;}
"""

# small inline SVGs
POWER = '<svg class="pw" viewBox="0 0 24 24" fill="none"><path d="M12 3v9" stroke="{c}" stroke-width="2.2" stroke-linecap="round"/><path d="M6.5 7a7 7 0 1 0 11 0" stroke="{c}" stroke-width="2.2" stroke-linecap="round"/></svg>'
MAG = '<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="rgba(203,224,238,.55)" stroke-width="2"/><path d="M20 20l-4.5-4.5" stroke="rgba(203,224,238,.55)" stroke-width="2" stroke-linecap="round"/></svg>'
MARK = '<svg class="mk" viewBox="0 0 32 32" fill="none"><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" fill="#34E4DA" opacity=".18"/><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" stroke="#34E4DA" stroke-width="1.7"/><path d="M14 15l-2.5 4h3l-1 4 4.5-6h-3l1.5-2.6z" fill="#34E4DA"/></svg>'

STBAR = ('<div class="stbar"><span>9:41</span><span class="rt">'
         '<span class="sig"><i></i><i></i><i></i><i></i></span>'
         '<span>5G</span><span class="batt"><i></i></span></span></div>')

def screen_connected():
    return f'''<div class="app">
  <div class="app-top"><div class="app-title">CumulusVPN</div><span class="tier-pill prem">PREMIUM</span></div>
  <div class="orb-wrap">
    <div class="orb on"><div class="ring"></div><div class="core">{POWER.format(c="var(--cyan-glow)")}<span class="state">Connected</span></div></div>
    <div class="conn-loc"><div class="flag">🇩🇪</div><div class="c">Germany</div><div class="ip">exit 185.244.x.x · Frankfurt</div></div>
    <div class="stat-row">
      <div class="stat"><div class="k">Down</div><div class="v">48.2<span class="u"> Mbps</span></div></div>
      <div class="stat"><div class="k">Up</div><div class="v">21.7<span class="u"> Mbps</span></div></div>
      <div class="stat"><div class="k">Ping</div><div class="v">12<span class="u"> ms</span></div></div>
    </div>
  </div>
  <div class="big-disc">Disconnect</div>
</div>'''

def screen_free():
    return f'''<div class="app disc">
  <div class="app-top"><div class="app-title">CumulusVPN</div><span class="tier-pill free">FREE · 100 KB/s</span></div>
  <div class="orb-wrap">
    <div class="orb off"><div class="ring"></div><div class="core">{POWER.format(c="#9fb2c4")}<span class="state">Tap to connect</span></div></div>
    <div class="conn-loc"><div class="c" style="font-size:16px;color:#c3d3e2">Not connected</div></div>
  </div>
  <div class="loc-btn"><span class="flag">🇳🇱</span><div class="meta"><div class="t">Netherlands</div><div class="s">Amsterdam · 18 ms · fast</div></div><span class="chev">›</span></div>
  <div class="big-connect">Connect</div>
</div>'''

def screen_multihop():
    return f'''<div class="mh">
  <div class="app-top"><div class="app-title">Privacy route</div><span class="tier-pill prem">PREMIUM</span></div>
  <div class="seg"><div class="s">Fast</div><div class="s on">Multi-hop</div></div>
  <div class="route">
    <div class="hop"><span class="flag">🇸🇪</span><div class="m"><div class="t">Sweden · Stockholm</div><div class="s">entry 45.87.x.x · sees your IP</div></div><span class="tag entry">Entry</span></div>
    <div class="link"><span class="lbl">double-encrypted · 51820/udp</span></div>
    <div class="hop"><span class="flag">🇨🇭</span><div class="m"><div class="t">Switzerland · Zürich</div><div class="s">exit 185.19.x.x · sees the site</div></div><span class="tag exit">Exit</span></div>
  </div>
  <div class="mh-note"><span class="ico">🔒</span><div class="tx">Cross-jurisdiction. No single server ever sees both who you are and where you go — one $0.99 covers both hops.</div></div>
  <div class="mh-stat">
    <div class="stat"><div class="k">Route</div><div class="v" style="font-size:12px">Max privacy</div></div>
    <div class="stat"><div class="k">Ping</div><div class="v">37<span class="u"> ms</span></div></div>
    <div class="stat"><div class="k">Hops</div><div class="v">2</div></div>
  </div>
</div>'''

def screen_payment():
    return '''<div class="pay">
  <h3>Upgrade to full speed</h3>
  <div class="sub">Send FLUX with the exact message below. Every gateway unlocks your key within ~1 minute — no account needed.</div>
  <div class="amount"><div class="big">4.5 FLUX</div><div class="usd">≈ $0.99 · 30 days</div></div>
  <div class="qr"></div>
  <div class="field"><div class="lab">Pay to address</div><div class="val"><span>t1cUmuLus…9xVQ2f</span><span class="cp">Copy</span></div></div>
  <div class="field"><div class="lab">Message (required)</div><div class="val"><span>CVPN1:3QJmnh8vzBqoQpuTGD</span><span class="cp">Copy</span></div></div>
  <div class="pay-note">Opens in Zelcore / SSP Wallet. Payment is verified on the Flux blockchain — we never see who you are.</div>
</div>'''

def picker():
    return f'''<div class="app">
  <div class="app-top"><div class="app-title">Choose location</div><span class="tier-pill prem">PREMIUM</span></div>
  <div class="searchbar">{MAG}<span>Search 30 countries…</span></div>
  <div class="clist">
    <div class="crow sel"><span class="flag">🇩🇪</span><div class="nm">Germany <span class="sub">5 nodes · Frankfurt</span></div><div class="ping"><span class="dot g"></span>12 ms</div></div>
    <div class="crow"><span class="flag">🇳🇱</span><div class="nm">Netherlands <span class="sub">5 nodes · Amsterdam</span></div><div class="ping"><span class="dot g"></span>18 ms</div></div>
    <div class="crow"><span class="flag">🇬🇧</span><div class="nm">United Kingdom <span class="sub">4 nodes · London</span></div><div class="ping"><span class="dot g"></span>24 ms</div></div>
    <div class="crow"><span class="flag">🇺🇸</span><div class="nm">United States <span class="sub">6 nodes · 3 cities</span></div><div class="ping"><span class="dot y"></span>96 ms</div></div>
    <div class="crow"><span class="flag">🇯🇵</span><div class="nm">Japan <span class="sub">4 nodes · Tokyo</span></div><div class="ping"><span class="dot y"></span>142 ms</div></div>
    <div class="crow"><span class="flag">🇧🇷</span><div class="nm">Brazil <span class="sub">3 nodes · São Paulo</span></div><div class="ping"><span class="dot r"></span>210 ms</div></div>
    <div class="crow"><span class="flag">🇦🇺</span><div class="nm">Australia <span class="sub">3 nodes · Sydney</span></div><div class="ping"><span class="dot r"></span>288 ms</div></div>
  </div>
</div>'''

SCREENS = {
  "connected": screen_connected(),
  "free": screen_free(),
  "multihop": screen_multihop(),
  "payment": screen_payment(),
}

def phone(screen_html):
    return f'<div class="phone"><div class="screen"><div class="notch"></div>{STBAR}{screen_html}</div></div>'

# caption headline may include highlighted spans
def frame_html(w, h, kicker, headline, screen_key, zoom, glow_style, extra_css=""):
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
.frame{{width:{w}px;height:{h}px;}}
.glow{{{glow_style}}}
{extra_css}
</style></head><body>
<div class="frame">
  <div class="glow"></div>
  <div class="cap">
    <div class="lock">{MARK}<span class="wm">Cumulus<b>VPN</b></span></div>
    <div class="kick">{kicker}</div>
    <h1>{headline}</h1>
  </div>
  <div class="stage"><div class="phone-zoom">{phone(SCREENS[screen_key])}</div></div>
</div>
</body></html>'''

# ---- iOS 6.7" : 1290 x 2796 ----
IOS = (1290, 2796)
# ---- Android phone : 1080 x 1920 ----
AND = (1080, 1920)

FRAMES = [
  ("connected", "Secure in one tap", 'One tap.<br><span class="em">No account.</span>'),
  ("free",      "Genuinely free",    'Free forever<br>at <span class="em">100 KB/s.</span>'),
  ("multihop",  "Ultimate privacy",  'Multi-hop for<br><span class="em">ultimate privacy.</span>'),
  ("payment",   "Pay on-chain",      'Pay <span class="am">$0.99</span><br>in FLUX.'),
]

def build_set(prefix, size, zoom, cap_pad, mksz, wmsz, kicksz, h1sz, lgap, glow):
    w, h = size
    for key, kicker, headline in FRAMES:
        extra = f'''
.cap{{padding:{cap_pad};}}
.cap .lock{{--mksz:{mksz}px;--lgap:{lgap}px;margin-bottom:{int(mksz*0.7)}px;}}
.cap .lock .wm{{font-size:{wmsz}px;}}
.cap .kick{{font-size:{kicksz}px;letter-spacing:.16em;margin-bottom:{int(h1sz*0.28)}px;}}
.cap h1{{font-size:{h1sz}px;}}
.stage{{flex:1;display:flex;align-items:center;justify-content:center;padding-bottom:{int(h*0.02)}px;}}
.phone-zoom{{zoom:{zoom};}}
'''
        html = frame_html(w, h, kicker, headline, key, zoom, glow, extra)
        fn = f"{BUILD}/{prefix}-{key}.html"
        with open(fn, "w") as f:
            f.write(html)
        print(fn)

# iOS: big canvas
build_set("ios", IOS, zoom=2.42, cap_pad="150px 90px 40px", mksz=64, wmsz=52,
          kicksz=30, h1sz=104, lgap=18,
          glow="width:1000px;height:1000px;right:-260px;top:-320px;")
# Android
build_set("and", AND, zoom=1.86, cap_pad="96px 64px 26px", mksz=46, wmsz=37,
          kicksz=21, h1sz=72, lgap=13,
          glow="width:760px;height:760px;right:-210px;top:-250px;")

# ---- Feature graphic (Play) 1024x500 ----
def feature():
    html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
.fg{{width:1024px;height:500px;position:relative;overflow:hidden;display:flex;align-items:center;
  background:linear-gradient(112deg,#0B1424 0%,#0C2230 50%,#0A2E30 100%);padding:0 78px;}}
.fg .glow{{position:absolute;width:760px;height:760px;right:-230px;top:-220px;border-radius:50%;
  background:radial-gradient(circle,rgba(52,228,218,.30),rgba(15,185,174,.10) 45%,transparent 68%);filter:blur(6px);}}
.fg .l{{position:relative;z-index:2;max-width:600px;}}
.fg .lock{{display:flex;align-items:center;gap:16px;}}
.fg .lock svg{{width:60px;height:60px;}}
.fg .lock .wm{{font-family:var(--sans);font-weight:800;font-size:48px;letter-spacing:-.03em;color:#EAF1F8;}}
.fg .lock .wm b{{color:var(--cyan-glow);}}
.fg h2{{font-family:var(--sans);font-weight:800;font-size:44px;line-height:1.05;letter-spacing:-.03em;
  color:#EAF1F8;margin:26px 0 0;text-wrap:balance;}}
.fg h2 .em{{color:var(--cyan-glow);}}
.fg .sub{{font-family:var(--mono);font-size:17px;color:#A6B6C6;margin-top:20px;letter-spacing:.02em;}}
.fg .sub b{{color:var(--amber-2);font-weight:600;}}
.fg .chips{{display:flex;gap:12px;margin-top:26px;}}
.fg .chip{{font-family:var(--mono);font-size:14px;color:#cfe0ee;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:8px 16px;}}
.fg .r{{position:relative;z-index:2;margin-left:auto;}}
.fg .r .big{{width:230px;height:230px;}}
</style></head><body>
<div class="fg">
  <div class="glow"></div>
  <div class="l">
    <div class="lock">{MARK.replace('class="mk"','')}<span class="wm">Cumulus<b>VPN</b></span></div>
    <h2>Private internet.<br><span class="em">No account, no logs.</span></h2>
    <div class="sub">Decentralized VPN on Flux · full speed <b>$0.99/mo</b> in FLUX</div>
    <div class="chips"><span class="chip">One-tap connect</span><span class="chip">30+ countries</span><span class="chip">Free forever</span></div>
  </div>
  <div class="r"><svg class="big" viewBox="0 0 32 32" fill="none"><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" fill="#34E4DA" opacity=".14"/><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" stroke="#34E4DA" stroke-width="1.5"/><path d="M14 15l-2.5 4h3l-1 4 4.5-6h-3l1.5-2.6z" fill="#34E4DA"/></svg></div>
</div>
</body></html>'''
    fn = f"{BUILD}/feature-graphic.html"
    open(fn,"w").write(html); print(fn)

# ---- Hero / GitHub social 1280x640 ----
def hero():
    html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
.hero{{width:1280px;height:640px;position:relative;overflow:hidden;display:flex;flex-direction:column;
  justify-content:center;align-items:center;text-align:center;
  background:linear-gradient(150deg,#0B1424 0%,#0C2230 52%,#0A2E30 100%);}}
.hero .glow{{position:absolute;width:900px;height:900px;left:50%;top:-360px;transform:translateX(-50%);
  border-radius:50%;background:radial-gradient(circle,rgba(52,228,218,.26),rgba(15,185,174,.08) 46%,transparent 66%);filter:blur(8px);}}
.hero .lock{{position:relative;z-index:2;display:flex;align-items:center;gap:20px;}}
.hero .lock svg{{width:82px;height:82px;}}
.hero .lock .wm{{font-family:var(--sans);font-weight:800;font-size:66px;letter-spacing:-.035em;color:#EAF1F8;}}
.hero .lock .wm b{{color:var(--cyan-glow);}}
.hero h2{{position:relative;z-index:2;font-family:var(--sans);font-weight:700;font-size:34px;
  letter-spacing:-.02em;color:#EAF1F8;margin:28px 0 0;text-wrap:balance;}}
.hero h2 .em{{color:var(--cyan-glow);}}
.hero .sub{{position:relative;z-index:2;font-family:var(--mono);font-size:18px;color:#8CA0B4;
  margin-top:18px;letter-spacing:.14em;text-transform:uppercase;}}
.hero .chips{{position:relative;z-index:2;display:flex;gap:14px;margin-top:34px;}}
.hero .chip{{font-family:var(--mono);font-size:15px;color:#cfe0ee;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:9px 18px;}}
.hero .chip b{{color:var(--amber-2);font-weight:600;}}
</style></head><body>
<div class="hero">
  <div class="glow"></div>
  <div class="lock"><svg viewBox="0 0 32 32" fill="none"><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" fill="#34E4DA" opacity=".14"/><path d="M9 21h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 8.5 12 4.5 4.5 0 0 0 9 21Z" stroke="#34E4DA" stroke-width="1.5"/><path d="M14 15l-2.5 4h3l-1 4 4.5-6h-3l1.5-2.6z" fill="#34E4DA"/></svg><span class="wm">Cumulus<b>VPN</b></span></div>
  <h2>Private internet, <span class="em">no account, no logs.</span></h2>
  <div class="sub">Decentralized VPN · Powered by Flux</div>
  <div class="chips"><span class="chip">One tap. No account.</span><span class="chip">Free forever at 100 KB/s</span><span class="chip">Full speed <b>$0.99</b> in FLUX</span></div>
</div>
</body></html>'''
    fn = f"{BUILD}/hero-banner.html"
    open(fn,"w").write(html); print(fn)

feature()
hero()
print("DONE")
