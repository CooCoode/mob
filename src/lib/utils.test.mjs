import test from "node:test";
import assert from "node:assert/strict";
import { relayUrl } from "./utils.ts";

test("derives the VNC relay from the mobd URL", () => {
  assert.equal(relayUrl("http://192.168.50.86:8080"), "ws://192.168.50.86:8080/vnc");
  assert.equal(relayUrl(" https://office.example/ "), "wss://office.example/vnc");
  assert.equal(relayUrl("HTTP://host:8080//"), "ws://host:8080/vnc");
  assert.equal(relayUrl(""), "");
});
