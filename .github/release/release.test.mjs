import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseURL, checkPromotion, prepareDistribution, publish, sha256, updaterConfig } from './release.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mob-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const assets = join(root, 'assets'), output = join(root, 'output');
  mkdirSync(assets);
  for (const name of ['mob_1.2.3_darwin_arm64.dmg', 'mob_1.2.3_darwin_arm64.app.tar.gz', 'mob_1.2.3_darwin_arm64.app.tar.gz.sig', 'mobd_1.2.3_darwin_arm64.tar.gz']) {
    writeFileSync(join(assets, name), `fixture ${name}`);
  }
  const manifests = prepareDistribution(assets, output, { version: '1.2.3', base: 'https://download.example.com', team: 'A123456789', date: '2026-10-14T00:00:00Z', notes: 'New release' });
  return { output, manifests };
}

test('release config uses the public R2 updater and rejects unsafe origins', () => {
  const config = updaterConfig('1.2.3', 'https://download.example.com/', ' public key\n');
  assert.deepEqual(config.plugins.updater, { pubkey: 'public key', endpoints: ['https://download.example.com/mob/latest.json'] });
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  for (const base of ['http://download.example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x', "https://bad'host.example.com", 'https://pub-123.r2.dev']) {
    assert.throws(() => baseURL(base));
  }
  assert.throws(() => updaterConfig('01.2.3', 'https://example.com', 'key'));
  assert.throws(() => updaterConfig('1.2.3', 'https://example.com', ''));
});

test('manifests agree with payloads, contain signature contents and pin the installer identity', t => {
  const { output, manifests } = fixture(t);
  const platform = manifests.mob.platforms['darwin-aarch64'];
  assert.match(platform.url, /\/mob\/v1.2.3\/mob_1.2.3_darwin_arm64.app.tar.gz$/);
  assert.equal(platform.sha256, sha256(readFileSync(join(output, 'mob/v1.2.3/mob_1.2.3_darwin_arm64.app.tar.gz'))));
  assert.equal(platform.signature, 'fixture mob_1.2.3_darwin_arm64.app.tar.gz.sig');
  assert.match(manifests.mob.download.url, /\.dmg$/);
  assert.match(manifests.mobd.download.url, /\/mobd\/v1.2.3\//);
  const installer = readFileSync(join(output, 'mobd/v1.2.3/install.sh'), 'utf8');
  assert.ok(installer.includes("download_base='https://download.example.com'"));
  assert.ok(installer.includes("apple_team='A123456789'"));
  assert.ok(!installer.includes('@DOWNLOAD_BASE_URL@'));
});

function remote(events, overrides = {}) {
  return {
    async readJSON() { return null; }, async digest() { return null; },
    async upload(key, path, immutable) { events.push({ type: 'upload', key, immutable }); },
    async verify(key) { events.push({ type: 'verify', key }); },
    ...overrides,
  };
}

test('all downloads are verified before either stable pointer is published', async t => {
  const { output, manifests } = fixture(t), events = [];
  await publish(output, manifests, remote(events));
  const firstMutable = events.findIndex(e => e.type === 'upload' && !e.immutable);
  assert.ok(events.slice(0, firstMutable).some(e => e.type === 'verify'));
  assert.ok(events.slice(firstMutable).every(e => e.type === 'upload' && !e.immutable));
  assert.deepEqual(events.filter(e => e.key.endsWith('/latest.json')).map(e => e.key), ['mob/latest.json', 'mobd/latest.json']);
});

test('failed public download verification never updates stable', async t => {
  const { output, manifests } = fixture(t), events = [];
  await assert.rejects(publish(output, manifests, remote(events, { async verify() { throw Error('Public checksum mismatch'); } })), /checksum/);
  assert.ok(events.every(e => e.immutable));
});

test('changed versioned objects and backwards promotions fail before any upload', async t => {
  const { output, manifests } = fixture(t), events = [];
  await assert.rejects(publish(output, manifests, remote(events, { async digest() { return 'different'; } })), /overwrite/);
  assert.equal(events.length, 0);
  assert.throws(() => checkPromotion({ version: '1.10.0' }, { version: '1.2.3' }), /backwards/);
  assert.doesNotThrow(() => checkPromotion({ version: '1.2.3' }, { version: '1.10.0' }));
  assert.throws(() => checkPromotion({ version: '1.2.3', notes: 'a' }, { version: '1.2.3', notes: 'b' }), /different metadata/);
});

test('retries preserve matching versioned files and finish promotion', async t => {
  const { output, manifests } = fixture(t), events = [];
  await publish(output, manifests, remote(events, {
    async digest(key) { return sha256(readFileSync(join(output, key))); },
    async readJSON(key) { return key.endsWith('/latest.json') ? manifests[key.split('/')[0]] : []; },
  }));
  assert.equal(events.filter(e => e.type === 'upload' && e.immutable).length, 0);
  assert.equal(events.filter(e => e.key.endsWith('/latest.json')).length, 2);
});
