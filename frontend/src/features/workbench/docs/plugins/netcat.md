---
id: netcat
description: Check whether ports on a host accept a connection, or connect to a port, send a payload and capture the reply, the way nc does
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-19"
    changelog:
      - "Check mode: reports the state of each port, as `nc -vz` does, over TCP or UDP"
      - "Talk mode: connects, sends Nothing, Text or File, and captures the reply"
      - "Ports: Single, or Range with a Port range such as 22, 80, 8000-8010"
      - "Pass when for a Range: One succeeds or All succeed"
      - "UDP: a check sends the single byte X, as `nc -u -z` does; silence is reported as open or filtered"
      - "Four port states, each with a reason: open, closed, timed out, and open or filtered"
      - "Advanced options for Talk: CRLF line endings, Close after sending and Max reply size (bytes)"
      - "SSH tunnels: Check or Talk on a tunnel's local port reaches the far port through the tunnel; UDP to a tunnel's local port fails the block"
      - "Remotable: inside a Remote Execution body the block runs on the remote host"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
---

The Netcat plugin works like `nc`. It checks whether ports on a host accept a connection, or it connects to a port, sends a payload and captures what the port sends back. It runs on the WAVE server, on a remote host inside a Remote Execution body, and through the run's SSH tunnels. It has no listen mode and no TLS.

**Use Cases:**
- Check that a service's port is open before a test talks to it
- Check a list of ports on one host, and pass when one of them succeeds or only when all of them do
- Read the banner a server sends on connect, such as the `SSH-2.0-` line of an SSH server
- Send a request line or a file to a port and check the reply
- Check a port that is reachable only through an SSH tunnel, at the far end of that tunnel
- Check a port from a remote host, inside a Remote Execution body

**Behavior:**
- Check is nc's `-z`. Over TCP it connects and sends nothing. Over UDP it sends one datagram holding the single byte `X`, as `nc -u -z` does, and waits up to Timeout for a reply or a refusal
- Talk connects, sends the payload and captures the reply. Over TCP it reads the reply while it sends, as nc does. Send Nothing sends no payload and reads what the server sends on connect. Over UDP, Send offers Text and File only, because a UDP port answers only a datagram it was sent
- Each port ends in one of four states, and Results gives the state and a reason for every port:
  - `open`: something on the port answered. Over TCP the connection was made, over UDP a reply came back, and through an SSH tunnel the far port accepted the channel. The reason is empty
  - `closed`: the attempt ended in an error before Timeout ran out. Usually the port refused it, with a TCP reset, an ICMP port unreachable message, or the SSH server refusing the tunnel channel. Another network error, such as `No route to host`, also reports `closed`. The reason is the system's or the SSH server's own words, such as `Connection refused`
  - `timed out`: over TCP or through an SSH tunnel, no answer came back within Timeout, neither an acceptance nor a refusal. The reason reads `No answer within {n} seconds`
  - `open or filtered`: UDP only. No reply and no refusal came back within Timeout. UDP has no handshake, so the sender cannot tell whether a service got the datagram and chose not to answer, or a firewall dropped it on the way. The reason reads `No reply within {n} seconds`. The state is the one nmap calls `open|filtered`, and the port counts as a pass
- A port succeeds when its state is `open` or `open or filtered`. Single passes when its one port succeeds. Range passes under Pass when: One succeeds, nc's own rule, when any port succeeds; All succeed only when every port succeeds
- Port range takes ports and ranges separated by commas, for example `22, 80, 8000-8010`. Each port lies between 1 and 65535, and a range is two ports joined by a hyphen with no spaces inside, the lower port first. A range runs in ascending order, the entries keep the order they are written in, and a port named twice is used once, at its first position. The rows of Results follow this order
- The ports of a Range are dialed at the same time, at most 64 at once. In Talk each port gets a connection of its own and the same payload
- The Host is resolved once, within Timeout. Over TCP the resolved addresses are tried in order until one connects, and the port reports the last attempt's state and reason; over UDP the first address is used. A Host that does not resolve fails the block with `Could not resolve host: {host}`
- Timeout is nc's `-w`, in seconds. It bounds resolving the Host and each connection attempt: a TCP connect, a UDP wait for a reply or a refusal, and the opening of an SSH tunnel channel. In Talk over TCP it also bounds each wait for the server to take the next part of the payload; when a part is not taken in time, the send stops there
- Text is sent as UTF-8. Over TCP an empty Text sends nothing. Over UDP the payload goes as one datagram, so an empty Text sends one empty datagram, and a payload over 65507 bytes fails the block with `Payload is too large for one UDP datagram: {n} bytes (at most 65507)`
- File takes a `testdata://` or `artifact://` file, picked with Browse or typed in, or an absolute or relative path. A `testdata://` or `artifact://` file is read on WAVE and sent along; a plain path is read where the block runs. A relative path starts at the home folder of the user the WAVE server runs as on WAVE, and at the SSH user's home folder on a remote host
- A missing payload file, a missing `testdata://` or `artifact://` target, or a path that is not a file fails the block with `Payload file not found: {path}`, naming the value as written. A file that cannot be read fails it with `Could not read the payload file: {error}`, ending in the system's own text for the error
- A reply ends when the server closes its side over TCP, once the server has been silent for Timeout seconds after the send is over, or when it reaches Max reply size (bytes). At that size reading stops, the rest is not read, and a WARN line says `Reply from port {port} stopped at {n} bytes`. Over UDP the reply datagrams are joined in the order they arrive
- A reply becomes text as UTF-8. Bytes that are not valid UTF-8 appear as the replacement character U+FFFD
- CRLF line endings sends every line ending in the payload as carriage return plus line feed, whatever the payload's source. Close after sending shuts down the sending side once the payload is sent, so a server that waits for the end of its input answers at once. It is TCP only; with Send Nothing it shuts the sending side right after connecting
- On the WAVE server, when Host is `127.0.0.1` or `localhost` and a port is the Local Port of one of this run's open SSH tunnels, Netcat does not test the local listener. It opens a channel to the tunnel's far host and port through the tunnel's own SSH connection, so the state is the far port's real state, and in Talk the payload and the reply travel through that channel. The run console shows `SSH tunnel detected on local port {p}: testing {far_host}:{far_port} from {ssh_host}` for each such port
- SSH tunnels carry TCP only, so UDP to a tunnel's Local Port fails the block with `SSH tunnel detected on local port {p}: SSH tunnels carry TCP only, so UDP cannot go through one` before any port is dialed, and Results stays empty
- Inside a Remote Execution body the block runs on the remote host, so the ports are dialed from there. Validation still runs on WAVE before the request leaves. Browse is not offered, and no tunnel lookup happens, because `127.0.0.1` there is the remote host itself
- Only the settings the sheet shows are checked and used. For example, Send left at Nothing with Protocol UDP is ignored while Mode is Check; in Talk the block refuses it with `Parameter 'send' cannot be 'nothing' when protocol is 'udp'`
- When the pass rule fails, a Single port fails the block with `Port {port} on {host} is closed: {reason}` or `Port {port} on {host} timed out after {n} seconds`. A Range fails it with `No port on {host} succeeded ({count} checked)` under One succeeds, or `{k} of {count} ports on {host} did not succeed: {list}` under All succeed, where the list names the first 10 such ports with their states, followed by ` (+{m} more)` when there are more
- On error decides what a failure while the block runs does: Fail the block, or Record and continue, which sets Success to false, fills Error and Reason, and lets the test go on. A pass rule failure still fills Results and Reply with what was measured
- The run console shows a start line such as `Checking db.example.com port 5432 over TCP` or `Talking to 3 ports on db.example.com over UDP`, then the result of each port, at DEBUG for a Range, and for a Range a count of the states. Payload and reply bytes are never written to the console
- Stop ends the block at once, whatever it is doing: resolving the Host, connecting, sending, reading a reply or opening an SSH tunnel channel

**Parameters:**
- **Host**: Host name or IP address to connect to (required)
- **Ports**: Single or Range (default: Single)
- **Port**: The port, 1 to 65535 (required while Single)
- **Port range**: Ports and ranges separated by commas, for example `22, 80, 8000-8010` (required while Range)
- **Pass when**: One succeeds or All succeed (default: One succeeds) (Range)
- **Protocol**: TCP or UDP (default: TCP)
- **Mode**: Check or Talk (default: Check)
- **Send**: Nothing, Text or File over TCP; Text or File over UDP (default: Text) (Talk)
- **Text**: The payload, sent as UTF-8; it may be empty (Talk, Send Text)
- **File**: The payload file: `testdata://`, `artifact://` or an absolute or relative path, with Browse (required while Talk sends a file)
- **Timeout**: Seconds allowed for resolving the Host and for each connection attempt, and in Talk the silence that ends a reply (default: 10)
- **CRLF line endings**: Send every line ending in the payload as carriage return plus line feed, nc's `-C` (default: off) (Talk)
- **Close after sending**: Shut down the sending side once the payload is sent, nc's `-N` (default: off) (Talk over TCP)
- **Max reply size (bytes)**: Reading a port's reply stops at this many bytes (default: 16777216) (Talk)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Success**: True when the ports passed the pass rule; false when the block failed and On error is Record and continue
- **Results**: One row per port, in Port range order: `port`, `protocol` (`tcp` or `udp`), `state`, `reason` and `time_ms`, plus `reply` in Talk. `time_ms` runs from the start of the connection attempt to the verdict in Check, and to the moment reading stops in Talk
- **Reply**: What the port sent back, as text (Single, Talk)
- **Error**: The failure message (Record and continue only)
- **Reason**: Unresolved, StartFailed, Tunnel, Closed, Timeout, NoneSucceeded or NotAllSucceeded; empty when the block passed (Record and continue only)
