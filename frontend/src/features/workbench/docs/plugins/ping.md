---
id: ping
description: Send ICMP echo requests to one host and report what came back, the way ping does
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-21"
    changelog:
      - "Sends ICMP echo requests to one host and reports what came back, the way `ping` does"
      - "Count, Interval, Packet size and Timeout, each a ping flag at ping's own default"
      - "Pass when: Any reply, All replies, At least N replies or At least X% replies"
      - "Summary and Replies tables: what went out, what came back, and the round-trip times"
      - "Advanced options: IP version, TTL, Don't fragment and Source address"
      - "Needs no root and no sudo: it sends over the operating system's unprivileged ICMP path"
      - "Remotable: inside a Remote Execution body the block runs on the remote host"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
---

The Ping plugin works like `ping`. It sends ICMP echo requests to a host, times the replies and reports what came back. It runs on the WAVE server and on a remote host inside a Remote Execution body.

**Use Cases:**
- Check that a host is reachable before a test talks to it
- Wait for a machine to come back after a restart or a redeploy
- Measure the round-trip time and the packet loss to a host
- Find the largest packet a path will carry, with Don't fragment
- Check reachability from a remote host, inside a Remote Execution body

**Behavior:**
- It pings one host per block, as `ping` takes one destination; a sweep across many hosts is a different tool
- Count requests go out one Interval apart, numbered from 1, each carrying Packet size payload bytes. The wire size adds 28 bytes over IPv4 and 48 over IPv6, which is why the default 56-byte payload shows as 84 bytes on the wire
- Timeout is the real bound on the whole block, resolving the host included, whatever Count and Interval would otherwise take. It runs out with what was measured so far
- It needs no root and no sudo anywhere, on the WAVE server or on a remote host: it sends over the operating system's unprivileged ICMP path, and it never falls back to a TCP connect
- A machine that refuses the unprivileged path fails the block straight away, before any request is sent, and the message names the machine, the WAVE server or the execution host, and the one setting to change on it: `net.ipv4.ping_group_range`
- The Host is resolved once, within Timeout. A host that does not resolve fails the block with `Cannot resolve host '{host}'`
- A request counts as answered only when an echo reply came back. A request a router answered with an ICMP error, and a request nothing answered at all, both count as unanswered
- The `status` column of Replies reads `answered` when a reply came back, `timed out` when nothing did, the ICMP error and the address that sent it when a router answered instead, or the path size found when Don't fragment blocked the packet
- Pass when decides the verdict. Any reply is what `ping` itself treats as success: one answer passes. All replies passes only when every request was answered. At least N replies passes on Minimum replies answers or more. At least X% replies passes when the answered percentage reaches Minimum rate (%)
- Inside a Remote Execution body the block runs on the remote host, so the echo requests leave that host. Validation still runs on WAVE before the request leaves
- There is no SSH tunnel support: a port-forward carries TCP, and ICMP is not TCP, so a tunnel cannot carry an echo request
- On error decides what a failure while the block runs does. Fail the block stops the test; Record and continue sets Success to false, fills Error and Reason, and still reports Summary and Replies with what was measured
- The run console always ends with ping's own summary lines: the statistics header, the packets-transmitted line and the round-trip line. Log Output adds one line per reply as it lands, and a warning for each request that went unanswered
- Stop ends the block at once, whatever it is doing: resolving the host, sending or waiting for a reply

**Parameters:**
- **Host**: Host name or IP address to ping (required)
- **Count**: How many echo requests to send, 1 to 1000, as `ping -c` does (default: 4)
- **Interval (seconds)**: Seconds between requests, at least 0.2, as `ping -i` does (default: 1)
- **Packet size (bytes)**: Payload bytes in each request, 0 to 65507, as `ping -s` does (default: 56)
- **Timeout**: Seconds the whole block may take, resolving the host included; it is the real bound on the run (default: 30)
- **Pass when**: Any reply, All replies, At least N replies or At least X% replies (default: Any reply)
- **Minimum replies**: How many requests must be answered, 1 to Count (default: 1) (At least N replies)
- **Minimum rate (%)**: The percentage of requests that must be answered, 0 to 100 (default: 100) (At least X% replies)
- **Log Output**: Write a line to the run console for each reply as it arrives (default: off)
- **IP version**: Auto, IPv4 or IPv6; IPv4 and IPv6 force the address family, as `ping -4` and `ping -6` do (default: Auto) (Advanced)
- **TTL**: How many hops a request may take, 1 to 255, as `ping -t` does; a router that drops it answers with an ICMP error (default: empty) (Advanced)
- **Don't fragment**: Forbid fragmenting the request, as `ping -M do` does, which turns the block into an MTU probe: a packet too large for the path fails the block and reports the path size it found (default: off) (Advanced)
- **Source address**: The local IP address requests leave from, as `ping -I` does; it takes an address, never an interface name (default: empty) (Advanced)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Success**: True when the replies met the Pass when rule; false when the block failed and On error is Record and continue
- **Summary**: One row of statistics: `sent`, `received`, `loss_percent`, and the minimum, average, maximum and mdev round-trip times in milliseconds. Round-trip mdev is the standard deviation of the round-trip times: how steady the latency was
- **Replies**: One row per request: `seq` the sequence number, `source` the address that answered, `bytes` received, `ttl` the reply's own TTL, `time_ms` the round trip in milliseconds, and `status`
- **Error**: The failure message (Record and continue only)
- **Reason**: Unprivileged, Unresolved, Source, TooLarge, Timeout, NoReply, NotAllReplied, TooFewReplies or RateTooLow; empty when the block passed (Record and continue only)
