# Live desktop over WebRTC: desktop app plan

Status: **draft**, branch `feat/webrtc-stream`. Design and protocol: [mobd desktop streaming](https://github.com/xrdavies/mobd/blob/feat/webrtc-stream/docs/desktop-streaming.md).

## Why

The live view uses svnc over mobd's `/vnc` relay and receives the office Mac's full 4K framebuffer.
mobd now streams H.264 at the size the client shows, over WebRTC (Pion) with a WebSocket fallback.
VNC is removed; mobd and the apps are released together.

## What changes here

| Area | Today | After |
| --- | --- | --- |
| Live view | `src/lib/vnc.ts` + `@xrdavies/svnc`, `/vnc?ticket=` | `src/lib/stream.ts`: `RTCPeerConnection` in the webview, `<video>`; signaling via `fetch` with the Bearer header |
| Control | svnc input | data channels `input` / `pointer` / `control` (mobd design, "Data channels") |
| Fallback | none | `/stream/ws` with the single-use `wsTicket`, decoded with WebCodecs `VideoDecoder` into a canvas |
| Snapshot | fixed 1280 px every 30 s | panel width × devicePixelRatio, quality ≈ 65, every 3–5 s while the panel is open, `ETag` |
| Settings | Desktop sign-in (macOS user + password in Keychain) | removed; per-machine **Live view quality: Auto / High / Low** |
| Store | v4 | v5 drops `vncUsername`, deletes `<id>.vncPassword` from the Keychain, adds `liveQuality` |

Files mainly touched: `src/lib/vnc.ts` (replaced), `src/components/preview/PreviewPanel.tsx`,
`src/App.tsx`, `src/components/settings/SettingsDialog.tsx`, `src/store/app.ts`, `src/store/migrate.ts`,
`src/api/client.ts`, `package.json` (drop `@xrdavies/svnc`).

## Steps

| Step | Content | Verified by |
| --- | --- | --- |
| D1 | **Done.** Snapshot at panel width × devicePixelRatio (rounded up to 64 px), quality 65, every 4 s while visible, `If-None-Match` so an unchanged screen costs a 304 | `view.test.mjs`; panel in the running app |
| D2 | **Done.** `src/lib/stream.ts`: view-only WebRTC live view sized to the panel (reconnects at the new size on full screen), `stats`/`ended` from `control`, "Update mobd" for old builds; mobd without `stream` keeps VNC until D6. **Checkpoint passed:** H.264 plays in WKWebView | `stream.test.mjs`; office Mac, see below |
| D3 | **Done.** `src/lib/liveInput.ts` + `stream.ts`: `input` (reliable) and `pointer` (unreliable, one move per frame) channels; buttons, drags, wheel, keys by `code`, composed text; points normalized inside the letterbox; held keys/buttons released on View, window blur and Command up (macOS sends no key-up for keys pressed with Command); keys in control mode never reach the app's shortcuts (Esc goes to the Mac, as before); Take control reconnects at full-screen size, then takes control | `liveInput.test.mjs`; office Mac, see below |
| D4 | **Done.** Per-machine **Live view quality** (Auto / High / Low), switched from the live view's header (gauge menu; icon only in the panel, named in full screen) or Settings → Machines, both applying at once; stored as `liveQuality` (unset = auto); changing it reconnects an open view, keeping control. Readout from `getStats()` once a second: received kB/s, decoded fps, size, transport and network (LAN / Tailscale / Internet / relay); full in full screen, kB/s with a tooltip in the panel | `stream.test.mjs`; office Mac, see below |
| D5 | WebSocket fallback, raced against WebRTC (keep WebRTC if connected within ~3 s) | Funnel address |
| D6 | Remove svnc, ticket code, Desktop sign-in; store v5 migration | `npm test`, typecheck |
| D7 | Tests: signaling, message encoding, transport choice, migration | `make test` |

Starts after mobd M7. Merges with the other repos at release.

### D2 checkpoint (2026-10-18)

The app's `stream.ts`, bundled into a page in a bare WKWebView (the engine Tauri uses on macOS) on the
Mac Studio, against the office Mac's mobd (`433c68a`). Decoded pixels were read back from the
`<video>` through a canvas every second.

| Path | First picture | Picture | Bitrate |
| --- | --- | --- | --- |
| LAN | 0.24–0.41 s | 1280×720, live pixels every second | 2.3 → 3.8 Mbps |
| Tailscale address | 1.0 s | same | 1.2–1.5 Mbps |

`getVideoPlaybackQuality()` reports 0 frames for a WebRTC stream in WebKit; use pixels, not it, to
check playback. That mobd build ends the stream on a locked screen (`ended` arrives and the app
shows the reason); newer builds keep streaming.

### D3 check (2026-10-18)

Same WKWebView setup as D2. Synthetic pointer and key events on the `<video>`; mobd's `cursor`
reports on `control` show where the office Mac's pointer went.

| Step | Office Mac pointer |
| --- | --- |
| Move while in View | unchanged (input ignored) |
| Control, move to (0.25, 0.25) then (0.75, 0.6) | (0.25, 0.25), then (0.75, 0.6) |
| Back to View, move | unchanged |

Shift down/up reached mobd without an `error`, and the app's window key handler saw neither.

Then, with the office Mac unlocked, on a scratch TextEdit document of 300 numbered lines (read back
with AppleScript and screenshots, closed without saving):

| Input | Result |
| --- | --- |
| Click right of a line | caret at the end of line 37 |
| Keys `Shift`+`KeyH`, `KeyI`, `Space`, then composed text "café ✓" | line 37 became `line 37Hi café ✓` |
| Double-click a word, then Shift+letters | `line` on line 29 selected and replaced: `WORD 29` |
| Wheel, 8 × 100 px | view moved from line 18 to line 79 (~800 pt) |

No `error` came back from mobd. These were synthetic DOM events; real trackpad and keyboard events in
the Tauri app, and Command shortcuts the app menu may take first, are still to try by hand.


### D4 check (2026-10-18)

Same WKWebView setup, office mobd `d3cc432`.

| Quality | mobd session | Readout |
| --- | --- | --- |
| Low | 960×540 at 600 kbps → 1280×720, capped at 1000 kbps | `1280×720 · … · WebRTC · LAN` |
| High | 1920×1080 at 3000 kbps → 5.5–6 Mbps | `1920×1080 · … · WebRTC · LAN` |
| Auto | 1280×720 at 1200 kbps, ramping | `1280×720 · … · WebRTC · LAN` |

WebKit leaves candidate addresses out of `getStats()`; the selected remote candidate's protocol and
port are matched against the `a=candidate` lines of mobd's answer instead. Signaling to the Tailscale
address still reads LAN: ICE prefers the shared LAN, as in M6. kB/s and fps were near zero because the
screen was idle (frames only on change). The throttled-link check is still to do.

