# F-01 IP-Based TLS — Stage 1: Network Verification (Read-Only)

**Status: investigation complete. Nothing was configured, changed, or restarted.**

## Finding, stated plainly up front

**This development machine does not currently have a usable IP address on any real, hospital-facing
network.** The physical Wi-Fi adapter — the only network interface capable of reaching an external
network — is **`Disconnected`**, has no DHCP lease, and its only IPv4 address is a `169.254.x.x`
Automatic Private IP Addressing (APIPA) address, which Windows assigns itself when no DHCP server
responds. There is **no static IP configured anywhere on this host**, and no gateway is currently
reachable from it. I am reporting this exactly as found rather than assuming or inventing a
server IP, per your explicit instruction.

## Exact findings (all commands run, all output real)

### Physical/real network adapter
```
Adapter:               Wi-Fi (Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter)
Status:                Disconnected
MediaConnectionState:  Disconnected
DHCP Enabled:          Yes (but no lease obtained — adapter is down)
IPv4 Address:          169.254.165.37  (APIPA / link-local — NOT a real, routable address)
Default Gateway:       none (no gateway line present for this adapter in the live config)
```
This is the only adapter on this machine that could, in principle, reach a hospital LAN. It is
currently not connected to anything.

### Virtual adapters present (not hospital-network-facing)
```
vEthernet (New Virtual Switch)   172.16.4.255/22   gateway 172.16.4.1   DHCP: No (manually configured)
vEthernet (Default Switch)       172.21.16.1/20    gateway: none        DHCP: No (manually configured)
Local Area Connection* 8/10      169.254.x.x        Microsoft Wi-Fi Direct Virtual Adapters, inactive
```
`vEthernet (New Virtual Switch)` and `vEthernet (Default Switch)` are **Hyper-V/Docker Desktop
virtual switches** used for container/VM networking on this Windows host — they are not a hospital
network segment, and their addresses (`172.16.4.255`, `172.21.16.1`) are **not** candidates for a
PACS server's public-facing static IP. (Note `172.16.4.255` is also, numerically, the broadcast
address for a `/22` network starting at `172.16.4.0` — an unusual value to see as a host's own
assigned address, consistent with this being internal virtual-switch plumbing rather than a real
LAN assignment.)

### Observed live TCP traffic
`netstat` shows two established outbound connections on `172.16.4.255:5736x → :80` to two external IPs
— real internet traffic is flowing through the Hyper-V virtual switch path (this is Docker Desktop's
own NAT/internet-sharing mechanism), **not** evidence of a hospital-network presence.

### Docker/nginx port binding (confirmed, unaffected by any of the above)
`docker compose port nginx 80` → `0.0.0.0:80`. The published port already listens on **all**
interfaces. This means: **whatever real IP this host eventually has on a hospital network, nginx is
already configured to answer on it with zero Docker-side change** — the gap is entirely at the
host-networking layer, not in this project's compose/nginx configuration.

## Answers to Stage 1's specific questions

| Question | Answer |
|---|---|
| Server IP address | **None usable right now.** No real, routable IPv4 address is assigned to any physical adapter on this host. |
| Network interface | The physical Wi-Fi adapter (`Realtek RTL8852BE`) is the only candidate; it is currently disconnected. |
| Subnet and gateway | Not determinable — no active lease, no gateway reachable, from the physical adapter. |
| Static or DHCP | The adapter is DHCP-enabled, but has not obtained a lease (disconnected). No static IP is configured anywhere on this host. |
| Reserved in DHCP vs. manually configured | **Cannot be answered from this machine** — this requires asking whoever administers the hospital's network/DHCP infrastructure, not something inspectable from here. |
| Reachable from hospital client computers | **Cannot be determined** — there is currently no hospital-network connection to test reachability over. |

## What this means for the rest of F-01 IP-TLS work

The brief states the PACS server "is intended to use a static IP" and that this is a planning task —
so the plan in the remaining three documents is written for that **intended** target state, clearly
labeled as not yet verifiable on this machine. I have **not** invented a placeholder IP anywhere in
the certificate plan or nginx design that follow; where a specific IP value would be needed (the
actual IP SAN in the certificate, the exact bind address), those documents say so explicitly and name
it as a value to be supplied once this host (or whichever host will run the production deployment) is
actually connected to the hospital network with its assigned static IP.

**Before certificate generation or any nginx change can proceed for real, the following must happen
(outside this investigation's scope):**
1. This host (or the actual target deployment host, if different) needs to be connected to the
   hospital network.
2. The hospital's network/IT team needs to assign — and ideally DHCP-reserve, even though it will be
   configured statically on the host — the specific static IP this PACS server will use.
3. Reachability from client workstations needs to be confirmed by someone on that network, which
   cannot be verified from this machine in its current state.

I am stopping Stage 1 here with this honest result rather than fabricating a plausible-looking IP
address to keep the later stages moving.
