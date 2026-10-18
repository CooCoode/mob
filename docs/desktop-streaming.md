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
| D4 | Quality setting; readout of kB/s, fps, resolution, transport | throttled link |
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

Shift down/up reached mobd without an `error`, and the app's window key handler saw neither. Clicks,
typing and scrolling were not sent (the office Mac was at its lock screen); try them in the running
app.
