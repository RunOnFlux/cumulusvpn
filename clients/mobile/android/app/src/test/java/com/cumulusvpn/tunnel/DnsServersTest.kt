package com.cumulusvpn.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The DNS choice reaches the tun as the config's `DNS =` list, which may name
 * two servers ("9.9.9.9, 149.112.112.112"). Pins that both wgnest services
 * apply EVERY server ([CumulusMultihopVpnService.parseDnsServers]), and that a
 * split route list keeps each resolver inside the tunnel
 * ([CumulusMultihopVpnService.withDnsRoutes]).
 */
class DnsServersTest {

    private fun asStrings(routes: List<Pair<String, Int>>): Set<String> =
        routes.map { (net, prefix) -> "$net/$prefix" }.toSet()

    @Test
    fun everyServerOfAListIsKeptInOrder() {
        assertEquals(
            listOf("9.9.9.9", "149.112.112.112"),
            CumulusMultihopVpnService.parseDnsServers("9.9.9.9, 149.112.112.112"),
        )
        assertEquals(
            listOf("94.140.14.14", "94.140.15.15"),
            CumulusMultihopVpnService.parseDnsServers(" 94.140.14.14 ,94.140.15.15 "),
        )
    }

    @Test
    fun aSingleServerIsUnchanged() {
        assertEquals(listOf("1.1.1.1"), CumulusMultihopVpnService.parseDnsServers("1.1.1.1"))
    }

    @Test
    fun searchDomainsGarbageAndRepeatsAreDropped() {
        assertEquals(
            listOf("1.1.1.3", "1.0.0.3"),
            CumulusMultihopVpnService.parseDnsServers("1.1.1.3, corp.example, 1.0.0.3, 1.1.1.3, 999.1.1.1"),
        )
        assertEquals(
            listOf("2620:fe::fe"),
            CumulusMultihopVpnService.parseDnsServers("2620:fe::fe"),
        )
    }

    @Test
    fun nothingUsableFallsBackToTheDefault() {
        for (csv in listOf(null, "", " , ", "example.com")) {
            assertEquals(
                listOf(CumulusMultihopVpnService.DEFAULT_DNS),
                CumulusMultihopVpnService.parseDnsServers(csv),
            )
        }
    }

    @Test
    fun anIncludeListGainsAHostRouteForEachResolver() {
        // "Only these": 10/8 tunnelled, nothing else — Quad9 must still be.
        val out = CumulusMultihopVpnService.withDnsRoutes(
            listOf("10.0.0.0" to 8),
            listOf("9.9.9.9", "149.112.112.112"),
        )
        assertEquals(setOf("10.0.0.0/8", "9.9.9.9/32", "149.112.112.112/32"), asStrings(out))
    }

    @Test
    fun resolversAlreadyCoveredAddNothing() {
        val routes = listOf("0.0.0.0" to 1, "128.0.0.0" to 2)
        val out = CumulusMultihopVpnService.withDnsRoutes(routes, listOf("1.1.1.1", "94.140.14.14"))
        assertEquals(asStrings(routes), asStrings(out))
        assertEquals(routes.size, out.size)
    }

    @Test
    fun anExcludeRuleSpanningTheResolverDoesNotPushItOutOfTheTunnel() {
        // Complement of an "exclude 9.0.0.0/8" rule, as core renders it.
        val routes = CumulusMultihopVpnService.parseRoutesCsv(
            "0.0.0.0/5, 8.0.0.0/8, 10.0.0.0/7, 12.0.0.0/6, 16.0.0.0/4, 32.0.0.0/3, 64.0.0.0/2, 128.0.0.0/1",
        )
        val withDns = CumulusMultihopVpnService.withDnsRoutes(routes, listOf("9.9.9.9", "149.112.112.112"))
        // 149.112.112.112 sits in 128/1 already; only 9.9.9.9 needs a host route.
        assertEquals(asStrings(routes) + "9.9.9.9/32", asStrings(withDns))

        // The gateway pin is subtracted afterwards and must leave the resolver in.
        val tun = asStrings(CumulusMultihopVpnService.subtractHost(withDns, "203.0.113.7"))
        assertTrue("9.9.9.9/32" in tun)
        assertTrue(tun.none { it == "203.0.113.7/32" })
    }

    @Test
    fun nonIpv4ResolversAreLeftToTheV6Routes() {
        val routes = listOf("10.0.0.0" to 8)
        val out = CumulusMultihopVpnService.withDnsRoutes(routes, listOf("2620:fe::fe"))
        assertEquals(asStrings(routes), asStrings(out))
    }
}
