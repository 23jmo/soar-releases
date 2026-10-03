import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAnnouncement, sendAnnouncement } from './announce-discord.mjs';

const release = {
  tag_name: 'v0.1.8', name: 'SOAR 0.1.8 — Workspace layout', draft: false,
  prerelease: false, published_at: '2026-10-02T06:21:08Z',
  html_url: 'https://github.com/23jmo/soar-releases/releases/tag/v0.1.8',
  body: '**Workspace**\n- Better footage browsing.', assets: [{ name: 'SOAR.dmg' }],
};

test('announces the real notes and allows only an everyone mention', () => {
  const payload = buildAnnouncement(release);
  assert.equal(payload.content, '@everyone SOAR v0.1.8 is available.');
  assert.deepEqual(payload.allowed_mentions, { parse: ['everyone'] });
  assert.ok(payload.embeds[0].description.startsWith(release.body));
  assert.ok(payload.embeds[0].description.includes(release.html_url));
});

test('manual delivery can disable all mentions', () => {
  const payload = buildAnnouncement(release, false);
  assert.ok(!payload.content.includes('@everyone'));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('long Unicode notes fit Discord limits and retain the download link', () => {
  const payload = buildAnnouncement({ ...release, name: 'x'.repeat(300), body: '🪽'.repeat(4000) });
  assert.equal(payload.embeds[0].title.length, 256);
  assert.ok(payload.embeds[0].description.length <= 4096);
  assert.ok(payload.embeds[0].description.endsWith(`](${release.html_url})`));
  assert.ok(!/[\uD800-\uDBFF]…/.test(payload.embeds[0].description));
});

test('drafts, empty releases and other repositories cannot be announced', () => {
  assert.throws(() => buildAnnouncement({ ...release, draft: true }));
  assert.throws(() => buildAnnouncement({ ...release, published_at: null }));
  assert.throws(() => buildAnnouncement({ ...release, assets: [] }));
  assert.throws(() => buildAnnouncement({ ...release, html_url: 'https://github.com/other/repo/releases/tag/v1' }));
});

test('a webhook in a different channel is rejected before posting', async () => {
  let calls = 0;
  await assert.rejects(sendAnnouncement('https://discord.com/api/webhooks/123/test',
    buildAnnouncement(release), '456', async () => {
      calls++;
      return Response.json({ channel_id: 'wrong' });
    }), /not connected/);
  assert.equal(calls, 1);
});

test('delivery waits for a confirmed Discord message and everyone mention', async () => {
  const calls = [];
  const link = await sendAnnouncement('https://discord.com/api/webhooks/123/test',
    buildAnnouncement(release), '456', async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(options.method === 'POST'
        ? { channel_id: '456', id: '789', mention_everyone: true }
        : { channel_id: '456' });
    });
  assert.ok(link.endsWith('/456/789'));
  assert.ok(calls[1].url.endsWith('?wait=true'));
  assert.equal(JSON.parse(calls[1].options.body).content, '@everyone SOAR v0.1.8 is available.');
});

test('failed posts are not retried and never expose the webhook credential', async () => {
  let posts = 0;
  await assert.rejects(sendAnnouncement('https://discord.com/api/webhooks/123/test',
    buildAnnouncement(release), '456', async (_url, options) => {
      if (options.method !== 'POST') return Response.json({ channel_id: '456' });
      posts++;
      return new Response('', { status: 500 });
    }), error => error.message === 'Discord announcement failed (HTTP 500).');
  assert.equal(posts, 1);
});
