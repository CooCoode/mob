#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** kind: "partial" | "final" | "error" | "silence" */
typedef void (*mob_voice_event_fn)(const char *kind, const char *text, double confidence, void *ctx);

/** 1 if Speech + mic APIs are available on this Mac. */
int mob_voice_supported(void);

/**
 * Start streaming recognition. Emits partial/final/silence/error via cb.
 * Returns 0 on success, non-zero on failure (err filled when provided).
 */
int mob_voice_start(mob_voice_event_fn cb, void *ctx, char *err, size_t err_len);

/** Stop recognition and release the audio engine. Safe to call when idle. */
void mob_voice_stop(void);

#ifdef __cplusplus
}
#endif
