# Instant notifications without a live connection (postponed)

Status: **planned, postponed**. Not implemented in mobd or the apps; recorded so the decision can be picked up later.

## What we have today

The phones learn about agent questions and finished tasks from mobd's event stream (`GET /events`):

- **Android:** a foreground service (`WatchService`) keeps the stream open, so notifications are instant as long as the system does not kill the service. It shows a permanent low-priority "Background connection" notification.
- **iOS:** no long-lived connections in the background. A `BGAppRefreshTask` polls `GET /sessions` and diffs states; iOS decides when it runs (minutes to hours, less when the app is rarely used).
- Both can **answer from the notification** (approve/deny, pick an option, type a reply); that is local and needs no push service.

"Instant without a live connection" needs mobd to *push* to the phone through the platform's push service, because only the OS keeps a socket open while the app is suspended.

## Options

| Option | Android | iOS | Cost | Server work (xrdavies/mobd) |
| --- | --- | --- | --- | --- |
| **A. APNs + FCM direct** | FCM (Firebase Cloud Messaging) | APNs | FCM free. **APNs needs a paid Apple Developer Program membership (USD 99/year)**: push entitlements are not available to free personal teams. | Device-token registration endpoint; APNs client (token auth with `.p8` key) and FCM HTTP v1 client (service account); send on question/finished. |
| **B. ntfy / UnifiedPush** | Free. Self-hosted ntfy on the LAN or ntfy.sh, delivered via the ntfy app (UnifiedPush distributor) or embedded connector. Works without Google services. | Our own app still needs APNs to be woken → **same USD 99/year**. ntfy's iOS relay only helps the *ntfy app*, not ours. | Free on Android (self-hosted or ntfy.sh free tier). | Per-device topic registration; POST to the ntfy topic on question/finished. |
| **C. Relay through a hosted push gateway** (e.g. OneSignal, Pusher Beams) | FCM underneath | APNs underneath | Free tiers exist, **but iOS still needs the paid Apple account** for the APNs key; adds a third party that sees notification content. | Call the gateway's REST API. |
| **D. Improve polling only** | WorkManager periodic check (min 15 min) as a fallback when the foreground service is off | Keep `BGAppRefreshTask`; optionally a "Background fetch" hint | Free | None |

Notes:

- Every iOS path to *instant* delivery for our app goes through APNs, so it depends on the paid Apple Developer membership. There is no free route on iOS.
- Android already has near-instant delivery through the foreground service; push would mainly remove the permanent notification and survive aggressive battery savers.
- Push payloads leave the LAN (Apple/Google/ntfy.sh see them unless self-hosted ntfy on Android). Send only IDs plus a short title, and let the app fetch details from mobd; or encrypt the payload with a per-device key.
- mobd has no public address. All options above are outbound from mobd, so it only needs internet egress, not inbound access.

## Recommendation when we pick this up

1. **Android:** UnifiedPush (option B) with a self-hosted ntfy next to mobd — free and no Google dependency; keep the foreground service as a fallback.
2. **iOS:** APNs direct (option A) once a paid Apple Developer account exists; until then keep background refresh.
3. mobd: one `POST /devices` endpoint (`platform`, `token` or UnifiedPush endpoint URL, machine-scoped), stored in state, and a notifier that fires on the same transitions the apps use today (`waiting` turns true; turn succeeds or fails). Payload carries `machine`, `session`, `question` IDs so "answer from the notification" works unchanged.
