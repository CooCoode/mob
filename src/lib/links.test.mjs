import test from "node:test";
import assert from "node:assert/strict";
import { classifyLink } from "./links.ts";
const log = "/Users/m4003/dev/github/xrdavies/build-results/mob-ios-build-check.log";
test("classifies web, anchors and issue file forms", () => {
  assert.deepEqual(classifyLink("https://developer.apple.com/x"), { kind: "web", url: "https://developer.apple.com/x" });
  assert.deepEqual(classifyLink("#section"), { kind: "anchor", href: "#section" });
  assert.equal(classifyLink(log).path, log);
  assert.equal(classifyLink(`tauri://localhost${log}`).path, log);
  assert.equal(classifyLink(`file://${log}`).path, log);
  assert.equal(classifyLink("tauri://localhost/C:/Users/me/build.log").path, "C:/Users/me/build.log");
  assert.equal(classifyLink("file:///C:/Users/me/build.log").path, "C:/Users/me/build.log");
});
test("decodes paths and strips only a line-column suffix", () => {
  assert.equal(classifyLink("/tmp/a%20b.log:12:4").path, "/tmp/a b.log");
  assert.equal(classifyLink("/tmp/port:8080.log").path, "/tmp/port:8080.log");
});
test("rejects relative, remote and unsafe targets", () => {
  for (const href of ["docs/build.log", "javascript:alert(1)", "tauri://evil/Users/secret", "file://server/share/log"]) {
    assert.equal(classifyLink(href).kind, "unsupported");
  }
});
test("decodes URL paths exactly once, preserving literal percent sequences and Unicode", () => {
  for (const prefix of ["tauri://localhost", "file://"]) {
    assert.equal(classifyLink(`${prefix}/tmp/%E4%B8%AD%E6%96%87%20%2520.log`).path, "/tmp/中文 %20.log");
    assert.equal(classifyLink(`${prefix}/C:/Users/%2520.log`).path, "C:/Users/%20.log");
  }
  assert.equal(classifyLink("/tmp/中文%20日志.log:12:4").display, "/tmp/中文 日志.log:12:4");
  assert.equal(classifyLink("C:\\Users\\me\\build.log").path, "C:\\Users\\me\\build.log");
  assert.equal(classifyLink("https://example.com:8080/log:12").url, "https://example.com:8080/log:12");
});
test("rejects encoded controls, invalid URLs, deceptive local hosts and ambiguous locations", () => {
  for (const href of ["/%2Fserver/log", "file:///%2Fserver/log", "/tmp/a%00.log", "/tmp/a%0A.log", "/tmp/%ZZ", "\n/tmp/file", "//evil/path", "\\\\server\\share", "tauri://localhost:42/tmp/log", "tauri://user@localhost/tmp/log", "tauri://localhost/tmp/log?x=1", "tauri://localhost/tmp/log#x", "https:example.com", "https://user:password@host/file", "http://[bad", "tauri:/tmp/log"]) {
    assert.equal(classifyLink(href).kind, "unsupported", href);
  }
  assert.equal(classifyLink("HTTPS://example.com").kind, "web");
  assert.equal(classifyLink("FILE:///tmp/file").path, "/tmp/file");
});
