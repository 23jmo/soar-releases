import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repository = '23jmo/soar-releases';

function shorten(text, limit) {
  if (text.length <= limit) return text;
  // Do not leave half an emoji at the truncation boundary.
  return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

export function buildAnnouncement(release, mentionEveryone = true) {
  if (release.draft || !release.published_at) {
    throw new Error('Only published releases can be announced.');
  }
  if (!release.assets?.length) {
    throw new Error('The published release has no downloadable assets.');
  }
  const url = new URL(release.html_url);
  if (url.origin !== 'https://github.com' ||
      !url.pathname.startsWith(`/${repository}/releases/tag/`)) {
    throw new Error('Release URL must point to the SOAR binary feed.');
  }
  const notes = release.body?.trim() || 'See the release page for details.';
  const suffix = `\n\n[Download and full release notes](${url.href})`;
  return {
    username: 'SOAR Releases',
    content: `${mentionEveryone ? '@everyone ' : ''}SOAR ${release.tag_name} is available.`,
    allowed_mentions: { parse: mentionEveryone ? ['everyone'] : [] },
    embeds: [{
      title: shorten(release.name || `SOAR ${release.tag_name}`, 256),
      url: url.href,
      description: shorten(notes, 4096 - suffix.length) + suffix,
      color: 0x83b8de,
      footer: { text: release.prerelease ? 'SOAR Beta · Prerelease' : 'SOAR Beta · Release' },
      timestamp: release.published_at,
    }],
  };
}

async function githubRelease(tag, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error(`GitHub release lookup failed (HTTP ${response.status}).`);
  return response.json();
}

export async function sendAnnouncement(webhook, payload, channelId, request = fetch) {
  const url = new URL(webhook);
  if (url.origin !== 'https://discord.com' ||
      !/^\/api(?:\/v10)?\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) {
    throw new Error('Expected a Discord incoming webhook URL.');
  }
  // Confirm destination before posting. Never log the token-bearing URL.
  const metadata = await request(url, { signal: AbortSignal.timeout(30000) });
  if (!metadata.ok) throw new Error(`Discord webhook lookup failed (HTTP ${metadata.status}).`);
  if ((await metadata.json()).channel_id !== channelId) {
    throw new Error('Discord webhook is not connected to SOAR announcements.');
  }
  url.searchParams.set('wait', 'true');
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  // Do not retry an ambiguous response: it could send a second @everyone ping.
  if (!response.ok) throw new Error(`Discord announcement failed (HTTP ${response.status}).`);
  const message = await response.json();
  if (message.channel_id !== channelId || !message.id) {
    throw new Error('Discord did not confirm the announcement destination.');
  }
  if (payload.allowed_mentions.parse.includes('everyone') && !message.mention_everyone) {
    throw new Error('Discord posted the announcement but did not confirm the everyone mention.');
  }
  return `https://discord.com/channels/1556040117603541013/${channelId}/${message.id}`;
}

async function main() {
  const { RELEASE_TAG, GH_TOKEN, DISCORD_RELEASE_WEBHOOK_URL,
    DISCORD_CHANNEL_ID, MENTION_EVERYONE, DRY_RUN, GITHUB_STEP_SUMMARY } = process.env;
  if (!RELEASE_TAG || !GH_TOKEN) throw new Error('Release tag and GitHub token are required.');
  const release = await githubRelease(RELEASE_TAG, GH_TOKEN);
  const payload = buildAnnouncement(release, MENTION_EVERYONE === 'true');
  if (DRY_RUN === 'true') {
    console.log(JSON.stringify(payload, null, 2));
    if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY,
      `Validated ${RELEASE_TAG}; dry run, no Discord message sent.\n`);
    return;
  }
  if (!DISCORD_RELEASE_WEBHOOK_URL || !DISCORD_CHANNEL_ID) {
    throw new Error('Discord release webhook and announcements channel must be configured.');
  }
  const messageUrl = await sendAnnouncement(DISCORD_RELEASE_WEBHOOK_URL, payload, DISCORD_CHANNEL_ID);
  console.log(`Published ${RELEASE_TAG}: ${messageUrl}`);
  if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY,
    `Posted [${RELEASE_TAG} release notes](${messageUrl}) to SOAR announcements.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Network errors can contain request URLs. Report a safe failure, not the webhook secret.
    console.error('Release announcement failed. Check the release and Discord webhook configuration. No automatic retry was attempted.');
    process.exitCode = 1;
  });
}
