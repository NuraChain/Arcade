# Voice at the table

Date: 2026-09-23. Owner request: "live voice on games, an option at create table, settings for
voice on/off and mute - a complete system".

## The shape

Voice is peer to peer. Every seated player at a table whose host turned voice on may join the table's
voice room; each pair of joined players holds one `RTCPeerConnection` carrying Opus audio and nothing
else. A table seats at most eight, so a full mesh is at most seven connections per browser at roughly
32 kbit/s each - well inside a phone's uplink, and no media server to run, scale or trust.

This server only INTRODUCES the players. It relays the WebRTC offer, answer and ICE candidates over
the realtime socket and never carries a byte of audio. Media is encrypted by WebRTC (DTLS-SRTP)
between the two browsers.

What that does not prove, stated rather than implied: the DTLS fingerprints travel inside the SDP
this server relays, so a server that wanted to could put itself in the middle of a call. The chat is
end-to-end because every line is signed by a device the reader verifies; voice introductions are not
signed yet. Signing each fingerprint with the device's ECDSA key - the same key and the same peer
verification the sealing already does - is the next step, and the copy says "encrypted between
players" rather than "end-to-end" until it exists.

## Who can hear whom

The messaging policy decides it, in both directions, for every PAIR - not the room. A block, a
minor's safety rule and somebody's "strangers can't reach me" setting apply to voice exactly as they
apply to a direct message: two players who could not message each other are never introduced, so
they cannot hear each other even while both are in the room. The roster says so ("can't talk with
you") instead of showing a connection that silently never forms. This is the rule that matters most
for a product whose players include minors.

## Server

- `tables.voice boolean`, no default, set at create, beside `tables.chat`.
- Client frames:
  - `{ t: 'voice', table, on, muted }` - join, leave, or change my mute state.
  - `{ t: 'signal', table, to, kind: 'offer' | 'answer' | 'ice', data }` - relay one negotiation
    message to one player in the same room. `data` is capped at 12 KB; every other frame keeps the
    4 KB cap.
- Server frames:
  - `{ t: 'voice', table, peers: [{ who, muted }] }` - the room, sent to everybody in it on change.
  - `{ t: 'signal', table, from, kind, data }`.
- Joining checks, once, in the database: the caller is seated at the table and the table has voice
  on. The room lives in memory in the hub and empties itself when a socket closes; a server restart
  drops every call, and clients rejoin on reconnect.
- A signal is relayed only between two members of the same room who pass the pair policy.
- `GET /api/voice/ice` answers the ICE servers from configuration: `VOICE_STUN_URLS`, and TURN
  through the TURN REST scheme (`VOICE_TURN_URLS` + `VOICE_TURN_SECRET` -> a username that expires
  in an hour and an HMAC credential), so a TURN secret never reaches a browser. With nothing set
  the list is empty: players on one network still connect, players behind two NATs do not, and the
  roster says "couldn't connect".

## Browser

- `services/voice.rtc.ts` is framework-free: one `RTCPeerConnection` per peer, the perfect
  negotiation pattern (the lower handle is polite), trickle ICE, a remote `<audio>` per peer, and an
  `AnalyserNode` per stream for the speaking indicator.
- `stores/voice.store.ts` owns the call for the open table: joined, mic muted, each peer's state
  (connecting, connected, failed, not allowed), speaking and my local volume for them.
- The microphone is asked for when somebody presses Join, never before. Refused or absent, they join
  LISTEN-ONLY: they hear everyone and the mic button says why it is off.
- The table dock gets Join/Leave voice and a mic toggle; the players tab shows who is in voice,
  who is speaking, who is muted, and a per-person mute that is local to this browser. A speaking
  player's plate glows.
- The create form gets a Voice switch (off by default: a host has to choose to open a room people
  can hear each other in). Settings gets a Voice section: start with the mic muted (on by default),
  join voice automatically at tables that have it (off), and the voice volume.

## Testing

- `server/tests/voice.spec.ts`: frame parsing (sizes, kinds, unknown keys), room membership, relay
  only within a room, the pair policy refusing a minor and a stranger.
- `application/tests/voice.spec.ts`: the store against a fake RTC layer - join, listen-only on a
  refused mic, a peer leaving tears its connection down, mute is sent and shown.
- The browser: two real browsers at one table, join, hear the tone of a fake microphone
  (`--use-fake-device-for-media-stream`), mute, leave.
