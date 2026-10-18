# Live desktop

The live view shows the office desktop streamed by mobd. Protocol, encoder and server side:
[mobd desktop streaming](https://github.com/xrdavies/mobd/blob/main/docs/desktop-streaming.md).
mobd without the `stream` feature in `/health` shows "Update mobd"; the panel then keeps showing snapshots.

## Files

| File | Role |
| --- | --- |
| `src/lib/stream.ts` | Session: signaling, transport race, state, stats readout, `resize` |
| `src/lib/wsVideo.ts` | WebSocket fallback: H.264 decoded with WebCodecs into a `<canvas>` |
| `src/lib/liveInput.ts` | Pointer, wheel and key events → normalized input messages |
| `src/lib/view.ts` | View size in device pixels, rounded up to 64 px (snapshots and stream) |
| `src/components/preview/PreviewPanel.tsx` | Panel, expanded view, toolbar, click marker, snapshots |

## Session

- One non-trickle `POST /stream` with the WebRTC offer (Bearer header) returns the answer and a single-use `wsTicket`. `DELETE /stream/{id}` ends it.
- WebRTC gets a 5 s head start (`WEBRTC_GRACE`), less if ICE fails. Then the peer connection is closed and the same session continues on `/stream/ws?ticket=…`; mobd keeps the first transport to connect.
- Per machine, `liveWebSocket` remembers that the WebSocket carried the last session. Next time WebRTC gets 1 s (`REMEMBERED_GRACE`), then the WebSocket races beside it. The transport is chosen on the first frame, so a machine back on a UDP-capable network returns to WebRTC. Not zero: TCP opens faster than WebRTC and would win every race.
- The WebSocket path acks every frame and restarts the decoder from the next keyframe after an error.
- The view is requested at its size in device pixels. With mobd's `streamResize`, expanding, collapsing or resizing the window sends `resize` after 150 ms of quiet; older mobd reconnects after 600 ms.

## Control

- Data channels: `input` (reliable), `pointer` (unordered, no retransmits, one move per frame), `control` (`stats`, `ended`, `cursor` from mobd; `resize` to mobd). On the WebSocket, input and control are JSON text.
- Buttons, drags, wheel, keys by `code`, composed text; points normalized inside the letterbox.
- Held keys and buttons are released on View, window blur and Command up (macOS sends no key-up for keys pressed with Command).
- In Control, keys never reach the app's shortcuts (Esc goes to the Mac). ⌘W and ⌘Q stay with the app.
- The panel only watches. The expanded view opens in View and has the only View/Control switch; collapsing returns to View. ⌘⇧C expands, connects if needed and takes control.

## Quality and readout

- Per-machine `liveQuality` (Auto / High / Low; unset = Auto), switched from the view's toolbar or Settings → Machines; changing it reconnects an open view and keeps control.
- `getStats()` once a second: kB/s, fps, size, transport, network (LAN / Tailscale / Internet / relay). WebKit leaves candidate addresses out of `getStats()`, so the selected remote candidate is matched against the `a=candidate` lines of mobd's answer.
- `getVideoPlaybackQuality()` reports 0 frames for WebRTC in WebKit; check playback by reading pixels.

## Snapshots

When the stream is off: `GET /screen` at the panel width × devicePixelRatio (rounded up to 64 px), quality 65, every 4 s while the window is visible, with `If-None-Match` so an unchanged screen costs a 304.

## Open

- Real trackpad and keyboard in the Tauri app, including Command shortcuts the app menu may take first (checked so far with synthetic DOM events in a bare WKWebView).
- A throttled-link check of Auto quality.
- The click marker over live video (geometry is unit-tested, checked against snapshots only).
- Relay paths beyond Tailscale Funnel: mobd's planned TURN relay (`mob-relay`) would need TURN credentials from `POST /stream`.
