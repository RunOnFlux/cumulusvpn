#!/usr/bin/env python3
"""Synthesized promo track for the CumulusVPN iOS video.

40 s ambient-electronic cue at 88 BPM: dreamy maj9 pads, a plucked eighth-note
arpeggio that densifies as the video moves through the feature scenes, sub
bass + soft four-on-the-floor kick under the feature section, then drums drop
out for the brand outro and the final chord rings into a fade. 100% generated
here -> no licensing concerns.
"""

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
DUR = 40.0
BPM = 88.0
BEAT = 60.0 / BPM          # 0.6818 s
BAR = 4 * BEAT             # 2.7273 s
N = int(DUR * SR)
T = np.arange(N) / SR

rng = np.random.default_rng(7)


def semi(n):
    """Frequency of the note n semitones from A4."""
    return 440.0 * 2 ** (n / 12.0)


# Chords as semitone offsets from A4 (voiced around C3-D4).
CMAJ9 = [-21, -17, -14, -10, -7]    # C3 E3 G3 B3 D4
AM9   = [-24, -21, -17, -14, -10]   # A2 C3 E3 G3 B3
FMAJ9 = [-28, -24, -21, -17, -14]   # F2 A2 C3 E3 G3
G69   = [-26, -22, -19, -17, -12]   # G2 B2 D3 E3 A3
PROG = [CMAJ9, AM9, FMAJ9, G69]
BASS_ROOT = {0: -33, 1: -36, 2: -40, 3: -38}  # C2 A1 F1 G1

# Bar schedule: bars 0-11 cycle the progression; final Cmaj9 holds to the end.
CHORD_BARS = [(b * BAR, BAR, PROG[b % 4], b % 4) for b in range(12)]
CHORD_BARS.append((12 * BAR, DUR - 12 * BAR, CMAJ9, 0))

KICK_START_BAR, KICK_END = 4, 32.4
HAT_START_BAR = 6

out_len = N + SR  # headroom for releases/reverb tail


def add(buf, start_s, seg):
    i = int(start_s * SR)
    j = min(i + len(seg), len(buf))
    if j > i:
        buf[i:j] += seg[: j - i]


def saw_partials(freq, n, detune_cents=0.0):
    """Band-limited saw via additive synthesis."""
    f = freq * 2 ** (detune_cents / 1200.0)
    t = np.arange(n) / SR
    out = np.zeros(n)
    h = 1
    while h * f < 5000 and h <= 24:
        out += np.sin(2 * np.pi * h * f * t) / h
        h += 1
    return out


# ---------------------------------------------------------------- pads
pad = np.zeros(out_len)
for start, hold, chord, _ in CHORD_BARS:
    rel = 2.2
    n = int((hold + rel) * SR)
    t = np.arange(n) / SR
    env = np.minimum(t / 1.3, 1.0) ** 2                     # slow attack
    env *= np.clip((hold + rel - t) / rel, 0.0, 1.0) ** 1.5  # release taper
    seg = np.zeros(n)
    for tone in chord:
        f = semi(tone)
        seg += saw_partials(f, n, -4.5) + saw_partials(f, n, +4.5)
    add(pad, start, seg * env * (0.055 / len(chord)))

b, a = signal.butter(2, 1500 / (SR / 2), "low")
pad = signal.lfilter(b, a, pad)

# ---------------------------------------------------------------- bass
bass = np.zeros(out_len)
for start, hold, chord, idx in CHORD_BARS:
    f = semi(BASS_ROOT[idx])
    n = int(hold * SR)
    t = np.arange(n) / SR
    env = np.minimum(t / 0.25, 1.0) * np.clip((hold - t) / 0.4, 0.0, 1.0)
    seg = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)
    add(bass, start, seg * env * 0.16)

# ---------------------------------------------------------------- arp plucks
def pluck(freq, dur=0.55, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    w = np.sin(2 * np.pi * freq * t) * np.exp(-t * 7.0)
    w += 0.35 * np.sin(4 * np.pi * freq * t) * np.exp(-t * 13.0)
    return w * vel * 0.11


ARP_ORDER = [0, 2, 4, 3, 1, 3, 4, 2]  # indexes into the 5 chord tones
arpL = np.zeros(out_len)
arpR = np.zeros(out_len)
for start, hold, chord, _ in CHORD_BARS:
    bar_i = int(round(start / BAR))
    if bar_i < 1:
        continue
    steps = range(0, 8)
    if bar_i < 4:
        steps = [0, 3, 6]           # sparse opening motif
    elif bar_i < 6:
        steps = [0, 2, 4, 6]
    nsteps = int(round(hold / (BEAT / 2)))
    for k in steps:
        if k >= nsteps:
            continue
        t0 = start + k * BEAT / 2
        if t0 > 37.0:
            continue
        tone = chord[ARP_ORDER[k % 8] % len(chord)] + 12
        vel = 0.75 + 0.25 * np.sin(k * 1.7 + bar_i)
        seg = pluck(semi(tone), vel=vel)
        pan = 0.5 + 0.38 * (1 if k % 2 else -1)
        add(arpL, t0, seg * np.cos(pan * np.pi / 2))
        add(arpR, t0, seg * np.sin(pan * np.pi / 2))

# ---------------------------------------------------------------- drums
kick = np.zeros(out_len)
kick_times = []
t0 = KICK_START_BAR * BAR
while t0 < KICK_END:
    kick_times.append(t0)
    t0 += BEAT
kn = int(0.4 * SR)
kt = np.arange(kn) / SR
kfreq = 42 + 68 * np.exp(-kt * 28)
kphase = 2 * np.pi * np.cumsum(kfreq) / SR
kseg = np.sin(kphase) * np.exp(-kt * 9) * 0.42
for tk in kick_times:
    add(kick, tk, kseg)

hats = np.zeros(out_len)
hn = int(0.05 * SR)
hb, ha = signal.butter(4, 6500 / (SR / 2), "high")
hseg = signal.lfilter(hb, ha, rng.standard_normal(hn)) * np.exp(-np.arange(hn) / SR * 90) * 0.09
t0 = HAT_START_BAR * BAR + BEAT / 2
while t0 < KICK_END:
    add(hats, t0, hseg)
    t0 += BEAT

# riser into the kick entry
rn = int(2.6 * SR)
renv = (np.arange(rn) / rn) ** 2.5
riser = rng.standard_normal(rn) * renv * 0.055
rb, ra = signal.butter(2, 900 / (SR / 2), "high")
riser = signal.lfilter(rb, ra, riser)
riser_buf = np.zeros(out_len)
add(riser_buf, KICK_START_BAR * BAR - 2.6, riser)

# ---------------------------------------------------------------- ducking
duck = np.zeros(out_len)
dn = int(0.35 * SR)
dseg = np.exp(-np.arange(dn) / SR / 0.13)
for tk in kick_times:
    add(duck, tk, dseg)
duck_env = 1.0 - 0.26 * np.clip(duck, 0, 1)

# ---------------------------------------------------------------- reverb
def schroeder(x, offset=0):
    combs = [1557, 1617, 1491, 1422]
    y = np.zeros_like(x)
    for d in combs:
        d += offset
        a = np.zeros(d + 1); a[0] = 1.0; a[d] = -0.79
        y += signal.lfilter([1.0], a, x)
    y /= len(combs)
    for d, g in ((225, 0.7), (556, 0.68)):
        bb = np.zeros(d + 1); bb[0] = g; bb[d] = 1.0
        aa = np.zeros(d + 1); aa[0] = 1.0; aa[d] = g
        y = signal.lfilter(bb, aa, y)
    return y


# stereo pad via short Haas spread
haas = int(0.014 * SR)
padL = pad.copy()
padR = np.concatenate([np.zeros(haas), pad[:-haas]]) * 0.92 + pad * 0.08

wet_inL = padL * 0.7 + arpL * 0.9 + hats * 0.6
wet_inR = padR * 0.7 + arpR * 0.9 + hats * 0.6
wetL = schroeder(wet_inL)
wetR = schroeder(wet_inR, offset=23)

L = (padL + arpL + hats + bass) * duck_env + wetL * 0.42 + kick + riser_buf
R = (padR + arpR + hats + bass) * duck_env + wetR * 0.42 + kick + riser_buf
# (bass ducks under the kick; kick + riser stay dry and centered)

stereo = np.stack([L[:N], R[:N]], axis=1)

# master fades
fade_in = np.minimum(T / 0.2, 1.0)
fade_out = np.clip((DUR - T) / 2.6, 0.0, 1.0) ** 1.3
stereo *= (fade_in * fade_out)[:, None]

stereo = np.tanh(stereo * 1.15) / np.tanh(1.15)
stereo *= 0.89 / np.max(np.abs(stereo))

wavfile.write("music.wav", SR, (stereo * 32767).astype(np.int16))
print(f"music.wav written: {DUR}s, peak {np.max(np.abs(stereo)):.3f}")
