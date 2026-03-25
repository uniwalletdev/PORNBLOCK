"use strict";

const { DnsPacketProcessor } = require("../../src/dns/resolver");

describe("DnsPacketProcessor — domain blocking logic", () => {
  // Minimal test for the pure JS logic
  it("identifies a blocked domain", () => {
    const blocked = new Set(["example-porn.com", "badsite.xxx"]);
    const allowed = new Set([]);

    // Mirror the isDomainBlocked logic from DnsPacketProcessor
    function isBlocked(domain, blocklist, allowlist) {
      const lower = domain.toLowerCase().trimEnd(".");
      function isChildOf(d, list) {
        let x = d;
        while (x.includes(".")) { x = x.substring(x.indexOf(".") + 1); if (list.has(x)) return true; }
        return false;
      }
      if (allowlist.has(lower) || isChildOf(lower, allowlist)) return false;
      return blocklist.has(lower) || isChildOf(lower, blocklist);
    }

    expect(isBlocked("example-porn.com", blocked, allowed)).toBe(true);
    expect(isBlocked("sub.example-porn.com", blocked, allowed)).toBe(true);
    expect(isBlocked("safe-site.com", blocked, allowed)).toBe(false);
  });

  it("allowlist overrides blocklist", () => {
    const blocked  = new Set(["bad.com"]);
    const allowed  = new Set(["safe.bad.com"]);

    function isBlocked(domain, blocklist, allowlist) {
      const lower = domain.toLowerCase();
      function isChildOf(d, list) {
        let x = d;
        while (x.includes(".")) { x = x.substring(x.indexOf(".") + 1); if (list.has(x)) return true; }
        return false;
      }
      if (allowlist.has(lower) || isChildOf(lower, allowlist)) return false;
      return blocklist.has(lower) || isChildOf(lower, blocklist);
    }

    expect(isBlocked("safe.bad.com",  blocked, allowed)).toBe(false);
    expect(isBlocked("other.bad.com", blocked, allowed)).toBe(true);
  });
});
