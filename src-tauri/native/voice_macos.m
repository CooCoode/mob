#import "voice_macos.h"
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>
#import <Foundation/Foundation.h>
#import <math.h>
#include <stdio.h>

static mob_voice_event_fn g_cb = NULL;
static void *g_ctx = NULL;
static SFSpeechRecognizer *g_recognizer = nil;
static SFSpeechAudioBufferRecognitionRequest *g_request = nil;
static SFSpeechRecognitionTask *g_task = nil;
static AVAudioEngine *g_engine = nil;
static dispatch_source_t g_silence_timer = nil;
static NSTimeInterval g_last_voice_at = 0;
static const NSTimeInterval kSilenceSeconds = 1.1;
static const float kVoiceRmsThreshold = 0.012f;

static void emit(const char *kind, NSString *text, double confidence) {
  if (!g_cb) return;
  const char *c = text ? [text UTF8String] : "";
  g_cb(kind, c ? c : "", confidence, g_ctx);
}

static void cancel_silence_timer(void) {
  if (g_silence_timer) {
    dispatch_source_cancel(g_silence_timer);
    g_silence_timer = nil;
  }
}

static void arm_silence_timer(void) {
  cancel_silence_timer();
  dispatch_queue_t q = dispatch_get_main_queue();
  g_silence_timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, q);
  if (!g_silence_timer) return;
  dispatch_source_set_timer(g_silence_timer,
                            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSilenceSeconds * NSEC_PER_SEC)),
                            DISPATCH_TIME_FOREVER, (int64_t)(0.05 * NSEC_PER_SEC));
  dispatch_source_set_event_handler(g_silence_timer, ^{
    cancel_silence_timer();
    NSTimeInterval now = [NSDate date].timeIntervalSince1970;
    if (now - g_last_voice_at >= kSilenceSeconds - 0.05) {
      emit("silence", @"", 0.0);
    }
  });
  dispatch_resume(g_silence_timer);
}

static float rms_from_buffer(AVAudioPCMBuffer *buffer) {
  AVAudioFrameCount frames = buffer.frameLength;
  if (frames == 0 || buffer.format.channelCount == 0) return 0.f;
  float *const *channels = buffer.floatChannelData;
  if (!channels || !channels[0]) return 0.f;
  double sum = 0;
  for (AVAudioFrameCount i = 0; i < frames; i++) {
    float s = channels[0][i];
    sum += (double)s * (double)s;
  }
  return (float)sqrt(sum / (double)frames);
}

static double average_confidence(SFSpeechRecognitionResult *result) {
  NSArray<SFTranscriptionSegment *> *segments = result.bestTranscription.segments;
  if (segments.count == 0) return result.isFinal ? 1.0 : 0.55;
  double sum = 0;
  NSUInteger n = 0;
  for (SFTranscriptionSegment *seg in segments) {
    // Apple documents confidence in 0...1; some builds leave it at -1 when unknown.
    if (seg.confidence >= 0) {
      sum += seg.confidence;
      n++;
    }
  }
  if (n == 0) return result.isFinal ? 1.0 : 0.55;
  return sum / (double)n;
}

static void teardown_engine(void) {
  cancel_silence_timer();
  if (g_engine) {
    [g_engine stop];
    [g_engine.inputNode removeTapOnBus:0];
  }
  if (g_task) {
    [g_task cancel];
  }
  g_task = nil;
  g_request = nil;
  g_engine = nil;
  g_recognizer = nil;
}

int mob_voice_supported(void) {
  if (@available(macOS 10.15, *)) {
    return SFSpeechRecognizer.supportsOnDeviceRecognition || YES;
  }
  return 0;
}

int mob_voice_start(mob_voice_event_fn cb, void *ctx, char *err, size_t err_len) {
  if (!cb) {
    if (err && err_len) snprintf(err, err_len, "missing callback");
    return 1;
  }
  if (g_engine) {
    mob_voice_stop();
  }
  g_cb = cb;
  g_ctx = ctx;
  g_last_voice_at = [NSDate date].timeIntervalSince1970;

  __block int start_status = 0;
  __block NSString *start_error = nil;
  dispatch_semaphore_t auth_sem = dispatch_semaphore_create(0);

  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
      start_status = 2;
      start_error = @"Speech recognition permission denied";
    }
    dispatch_semaphore_signal(auth_sem);
  }];
  dispatch_semaphore_wait(auth_sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15 * NSEC_PER_SEC)));
  if (start_status != 0) {
    if (err && err_len) {
      NSString *msg = start_error ?: @"voice start failed";
      snprintf(err, err_len, "%s", msg.UTF8String);
    }
    g_cb = NULL;
    g_ctx = NULL;
    return start_status;
  }

  void (^setup)(void) = ^{
    g_recognizer = [[SFSpeechRecognizer alloc] init];
    if (!g_recognizer) {
      start_status = 3;
      start_error = @"SFSpeechRecognizer unavailable";
      return;
    }
    g_recognizer.defaultTaskHint = SFSpeechRecognitionTaskHintDictation;

    g_engine = [[AVAudioEngine alloc] init];
    AVAudioInputNode *input = g_engine.inputNode;
    AVAudioFormat *format = [input outputFormatForBus:0];
    if (format.sampleRate <= 0 || format.channelCount == 0) {
      start_status = 4;
      start_error = @"No microphone input format (check mic permission)";
      teardown_engine();
      return;
    }

    g_request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
    g_request.shouldReportPartialResults = YES;

    g_task = [g_recognizer recognitionTaskWithRequest:g_request
                                        resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
      if (error) {
        // Cancellation is expected on stop.
        if (error.code == 216 /* canceled */ || error.code == 301) return;
        NSString *msg = error.localizedDescription ?: @"recognition error";
        emit("error", msg, 0.0);
        return;
      }
      if (!result) return;
      NSString *text = result.bestTranscription.formattedString ?: @"";
      double conf = average_confidence(result);
      g_last_voice_at = [NSDate date].timeIntervalSince1970;
      if (result.isFinal) {
        cancel_silence_timer();
        emit("final", text, conf >= 0 ? conf : 1.0);
      } else {
        emit("partial", text, conf >= 0 ? conf : 0.55);
        arm_silence_timer();
      }
    }];

    [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
      (void)when;
      [g_request appendAudioPCMBuffer:buffer];
      float rms = rms_from_buffer(buffer);
      if (rms >= kVoiceRmsThreshold) {
        g_last_voice_at = [NSDate date].timeIntervalSince1970;
        arm_silence_timer();
      }
    }];

    NSError *engErr = nil;
    [g_engine prepare];
    if (![g_engine startAndReturnError:&engErr]) {
      start_status = 5;
      start_error = engErr.localizedDescription ?: @"AVAudioEngine failed to start";
      teardown_engine();
      return;
    }
    arm_silence_timer();
  };

  // Never dispatch_async + wait: Tauri sync commands may already be on the main thread.
  if ([NSThread isMainThread]) {
    setup();
  } else {
    dispatch_sync(dispatch_get_main_queue(), setup);
  }

  if (start_status != 0) {
    if (err && err_len) {
      NSString *msg = start_error ?: @"voice start failed";
      snprintf(err, err_len, "%s", msg.UTF8String);
    }
    g_cb = NULL;
    g_ctx = NULL;
    return start_status;
  }
  return 0;
}

static void stop_on_main(void) {
  // Drop the callback first so in-flight result handlers cannot use a freed Rust ctx.
  g_cb = NULL;
  g_ctx = NULL;
  if (g_request) {
    [g_request endAudio];
  }
  teardown_engine();
}

void mob_voice_stop(void) {
  if ([NSThread isMainThread]) {
    stop_on_main();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), ^{
    stop_on_main();
  });
}
