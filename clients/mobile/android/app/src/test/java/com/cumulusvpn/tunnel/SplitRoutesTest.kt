package com.cumulusvpn.tunnel

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Validates the Kotlin split-tunneling route arithmetic against the shared
 * cross-language vector file (docs/17-split-tunneling.md §5):
 * `clients/core-ts/src/__fixtures__/split-routes.json`, whose ground truth is
 * core-ts `complementRoutes`. A port that disagrees with the vectors is a
 * build failure, not a bug report — divergence means a silently leaking route
 * on one platform only.
 *
 * The Kotlin side does not reimplement `complementRoutes`; it consumes the
 * pre-computed complement from the config's AllowedIPs and only subtracts the
 * gateway host ([CumulusMultihopVpnService.subtractHost]). The vectors still
 * pin it exactly:
 *  - `subtractHost([0.0.0.0/0], ip)` must equal the vector for excluding
 *    `ip/32` (the anchored-in-a-prefix generalization collapses to the full
 *    complement when the prefix is the default route), and
 *  - subtracting the gateway from an already-split route list must equal the
 *    TS complement of (user prefixes ∪ gateway/32).
 */
class SplitRoutesTest {

    private val fixture: JSONObject by lazy {
        // Test CWD is the app module; the fixture lives in the shared core-ts
        // package. Walk up until the repo-relative path resolves so the test
        // also works when Gradle runs from the repo root.
        var dir: File? = File(System.getProperty("user.dir")!!)
        while (dir != null) {
            val f = File(dir, "clients/core-ts/src/__fixtures__/split-routes.json")
            if (f.isFile) return@lazy JSONObject(f.readText())
            dir = dir.parentFile
        }
        throw AssertionError("split-routes.json fixture not found above ${System.getProperty("user.dir")}")
    }

    private fun vector(name: String): Pair<List<String>, List<String>> {
        val vectors = fixture.getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            if (v.getString("name") == name) {
                val excluded = v.getJSONArray("excluded").let { a -> (0 until a.length()).map { a.getString(it) } }
                val expected = v.getJSONArray("expected").let { a -> (0 until a.length()).map { a.getString(it) } }
                return excluded to expected
            }
        }
        throw AssertionError("vector not found: $name")
    }

    private fun asStrings(routes: List<Pair<String, Int>>): Set<String> =
        routes.map { (net, prefix) -> "$net/$prefix" }.toSet()

    /** Only the v4 entries of a vector — the Kotlin arithmetic is v4-only (v6
     *  route lists pass through [CumulusMultihopVpnService.parseRoutes6Csv]). */
    private fun v4(entries: List<String>): Set<String> =
        entries.filterNot { it.contains(":") }.toSet()

    @Test
    fun routesExcludingMatchesTheSingleHostVector() {
        val (excluded, expected) = vector("single-host")
        assertEquals(listOf("1.2.3.4/32"), excluded)
        assertEquals(v4(expected), asStrings(CumulusMultihopVpnService.routesExcluding("1.2.3.4")))
    }

    @Test
    fun subtractHostFromTheDefaultRouteCollapsesToTheFullComplement() {
        val (_, expected) = vector("single-host")
        val out = CumulusMultihopVpnService.subtractHost(listOf("0.0.0.0" to 0), "1.2.3.4")
        assertEquals(v4(expected), asStrings(out))
        assertEquals(32, out.size)
    }

    @Test
    fun subtractHostAgreesWithTsOnAnAlreadySplitList() {
        // TS side: complement of 10/8 (the user's exclude rule) is the route
        // list a config carries; the gateway lives at 203.0.113.7. Subtracting
        // it must equal TS's complement of {10/8, 203.0.113.7/32}.
        val (_, complementOf10) = vector("nested-prefixes") // == complement of 10.0.0.0/8
        val routes = CumulusMultihopVpnService.parseRoutesCsv(v4(complementOf10).joinToString(","))
        val out = asStrings(CumulusMultihopVpnService.subtractHost(routes, "203.0.113.7"))

        // Independent expectation: complement({10/8}) minus the host equals
        // complement({10/8}) with the one containing prefix replaced by its
        // sibling chain. Verify the three defining properties instead of
        // duplicating TS output: the host is gone, 10/8 stays excluded, and
        // the covered address count is exact (2^32 - 2^24 - 1).
        assertTrue(out.none { contains(it, "203.0.113.7") })
        assertTrue(out.none { contains(it, "10.1.2.3") })
        val covered = out.sumOf { 1L shl (32 - it.substringAfter('/').toInt()) }
        assertEquals((1L shl 32) - (1L shl 24) - 1L, covered)
    }

    @Test
    fun untouchedPrefixesPassThroughUnchanged() {
        val routes = listOf("198.51.100.0" to 24, "192.0.2.0" to 24)
        val out = CumulusMultihopVpnService.subtractHost(routes, "203.0.113.7")
        assertEquals(asStrings(routes), asStrings(out))
    }

    @Test
    fun parseRoutesCsvSplitsFamiliesAndDropsGarbage() {
        val csv = "0.0.0.0/5, 8.0.0.0/7, fe80::/10, nonsense, 1.2.3.4"
        assertEquals(
            setOf("0.0.0.0/5", "8.0.0.0/7", "1.2.3.4/32"),
            asStrings(CumulusMultihopVpnService.parseRoutesCsv(csv)),
        )
        assertEquals(
            setOf("fe80::/10"),
            CumulusMultihopVpnService.parseRoutes6Csv(csv)
                .map { (net, p) -> "$net/$p" }.toSet(),
        )
    }

    /** True when `ip` falls inside the CIDR `net/prefix` (v4 only). */
    private fun contains(cidr: String, ip: String): Boolean {
        val net = cidr.substringBefore('/')
        val prefix = cidr.substringAfter('/').toInt()
        val hostBits = 32 - prefix
        val mask = if (hostBits >= 32) 0L else (0xFFFFFFFFL shl hostBits) and 0xFFFFFFFFL
        return (toLong(ip) and mask) == (toLong(net) and mask)
    }

    private fun toLong(ip: String): Long =
        ip.split('.').fold(0L) { acc, o -> (acc shl 8) or o.toLong() }
}
