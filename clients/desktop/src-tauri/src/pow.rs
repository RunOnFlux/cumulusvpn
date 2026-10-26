//! The enroll proof-of-work, solved natively.
//!
//! The digest is the one every client and the gateway use (core-ts `powHash`,
//! the gateway's `checkPoW`): `sha256(utf8(publicKeyB64) || utf8(nonce))`, the
//! nonce a decimal counter, at least `bits` leading zero bits. A 20-bit solve
//! is about a million hashes on average; this searches on every core, each
//! thread taking every `threads`-th counter from `start`, and stops all of them
//! at the first valid nonce. The gateway accepts any valid nonce once, so the
//! caller passes a random `start` and repeated solves for one key differ.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Highest difficulty accepted: the gateway's is 20, and every extra bit
/// doubles the expected work.
pub const MAX_BITS: u32 = 32;

/// A solved proof-of-work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowSolution {
    /// The winning counter as a decimal string, as the gateway reads it.
    pub nonce: String,
    /// Hashes computed across all threads.
    pub hashes: u64,
}

/// Solve on every available core.
pub fn solve(public_key: &str, bits: u32, start: u64) -> Result<PowSolution, String> {
    let threads = std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get);
    solve_with(public_key, bits, start, threads as u64)
}

/// Solve with `threads` searchers.
pub fn solve_with(
    public_key: &str,
    bits: u32,
    start: u64,
    threads: u64,
) -> Result<PowSolution, String> {
    if bits > MAX_BITS {
        return Err(format!(
            "proof-of-work difficulty {bits} exceeds {MAX_BITS} bits"
        ));
    }
    let threads = threads.max(1);
    let prefix = Sha256::new().chain_update(public_key.as_bytes());
    let found = AtomicBool::new(false);
    let hashes = AtomicU64::new(0);
    let winner: Mutex<Option<u64>> = Mutex::new(None);
    std::thread::scope(|scope| {
        for t in 0..threads {
            let (prefix, found, hashes, winner) = (&prefix, &found, &hashes, &winner);
            scope.spawn(move || {
                let mut digits = [0u8; 20];
                let mut n = start.wrapping_add(t);
                let mut done = 0u64;
                while !found.load(Ordering::Relaxed) {
                    done += 1;
                    let digest = prefix
                        .clone()
                        .chain_update(decimal(n, &mut digits))
                        .finalize();
                    if has_leading_zero_bits(&digest, bits) {
                        let mut w = winner.lock().expect("pow winner mutex poisoned");
                        if w.is_none() {
                            *w = Some(n);
                        }
                        found.store(true, Ordering::Relaxed);
                        break;
                    }
                    n = n.wrapping_add(threads);
                }
                hashes.fetch_add(done, Ordering::Relaxed);
            });
        }
    });
    let nonce = winner
        .into_inner()
        .expect("pow winner mutex poisoned")
        .expect("a searcher stops only after recording a nonce");
    Ok(PowSolution {
        nonce: nonce.to_string(),
        hashes: hashes.into_inner(),
    })
}

/// `n` in decimal ASCII, written into the end of `buf`.
fn decimal(mut n: u64, buf: &mut [u8; 20]) -> &[u8] {
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            return &buf[i..];
        }
    }
}

/// Whether `digest` begins with at least `bits` zero bits (core-ts
/// `hasLeadingZeroBits`, the gateway's `hasLeadingZeroBits`).
fn has_leading_zero_bits(digest: &[u8], bits: u32) -> bool {
    let full = (bits / 8) as usize;
    if digest[..full].iter().any(|&b| b != 0) {
        return false;
    }
    let rem = bits % 8;
    rem == 0 || digest[full] & (0xffu8 << (8 - rem)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "8c7LtpsHze3b641zl0Qe8+nCrtg5f+yTJCFUalEvbkA=";

    fn digest(key: &str, nonce: &str) -> Vec<u8> {
        Sha256::new()
            .chain_update(key.as_bytes())
            .chain_update(nonce.as_bytes())
            .finalize()
            .to_vec()
    }

    #[test]
    fn the_digest_matches_core_ts_pow_hash() {
        // core-ts: powHash(KEY, '0')
        let hex: String = digest(KEY, "0")
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            hex,
            "10a952cfebacd1ae75dcfa081e8373afed9dffc4c550b8f0c1799cf478e4d7c5"
        );
    }

    #[test]
    fn one_searcher_finds_the_nonce_core_ts_finds() {
        // core-ts: solvePoW(KEY, 16, 0) === '11241'
        let s = solve_with(KEY, 16, 0, 1).unwrap();
        assert_eq!(s.nonce, "11241");
        assert_eq!(s.hashes, 11242);
    }

    #[test]
    fn every_searcher_count_returns_a_valid_nonce() {
        for threads in [1, 2, 3, 8] {
            let s = solve_with(KEY, 18, 123_456_789, threads).unwrap();
            assert!(
                has_leading_zero_bits(&digest(KEY, &s.nonce), 18),
                "{threads}: {s:?}"
            );
            assert!(s.nonce.parse::<u64>().unwrap() >= 123_456_789);
        }
    }

    #[test]
    fn leading_zero_bits_match_the_gateway_rule() {
        assert!(has_leading_zero_bits(&[0, 0, 0x0f, 0xff], 20));
        assert!(!has_leading_zero_bits(&[0, 0, 0x10, 0], 20));
        assert!(!has_leading_zero_bits(&[0, 1, 0, 0], 16));
        assert!(has_leading_zero_bits(&[0, 0, 0xff], 16));
        assert!(has_leading_zero_bits(&[0xff], 0));
    }

    #[test]
    fn decimal_writes_the_counter_as_js_tostring_does() {
        let mut buf = [0u8; 20];
        assert_eq!(decimal(0, &mut buf), b"0");
        assert_eq!(decimal(1_073_741_823, &mut buf), b"1073741823");
        assert_eq!(decimal(u64::MAX, &mut buf), b"18446744073709551615");
    }

    #[test]
    fn an_unbounded_difficulty_is_refused() {
        assert!(solve_with(KEY, MAX_BITS + 1, 0, 1).is_err());
    }
}
