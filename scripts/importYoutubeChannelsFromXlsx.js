require('dotenv').config();

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const supabase = require('../config/supabase');

const YT_KEY = process.env.YOUTUBE_API_KEY;

const CANDIDATE_ID_KEYS = [
  'channel_id',
  'channel id',
  'youtube_id',
  'youtube id',
  'id',
  'channel',
  'youtube channel',
  'channel url',
  'url',
  'link',
  'handle',
  'youtube handle'
];

const CANDIDATE_NAME_KEYS = [
  'channel_name',
  'channel name',
  'name',
  'speaker',
  'speaker name',
  'preacher',
  'preacher name',
  'title'
];

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase();
}

function findField(row, candidates) {
  const entries = Object.entries(row || {});
  for (const [k, v] of entries) {
    if (candidates.includes(normalizeKey(k)) && String(v || '').trim()) {
      return String(v).trim();
    }
  }
  return null;
}

function extractChannelIdOrHandle(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return { type: 'unknown', value: null };
  }

  if (/^UC[\w-]{20,}$/.test(value)) {
    return { type: 'channelId', value };
  }

  if (value.startsWith('@')) {
    return { type: 'handle', value: value.replace(/^@/, '') };
  }

  const channelIdMatch = value.match(/youtube\.com\/channel\/([\w-]+)/i);
  if (channelIdMatch) {
    return { type: 'channelId', value: channelIdMatch[1] };
  }

  const handleMatch = value.match(/youtube\.com\/@([^/?]+)/i);
  if (handleMatch) {
    return { type: 'handle', value: handleMatch[1] };
  }

  // Treat any remaining non-empty string as a name search (e.g. "Joel Osteen", "Bethel Church")
  if (value.length >= 2) {
    return { type: 'search', value };
  }

  return { type: 'unknown', value };
}

async function youtubeGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const message = data?.error?.message || `YouTube API request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function getChannelById(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${YT_KEY}`;
  const data = await youtubeGet(url);
  return data.items?.[0] || null;
}

async function getChannelByHandle(handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}&key=${YT_KEY}`;
  const data = await youtubeGet(url);
  return data.items?.[0] || null;
}

async function searchChannel(query) {
  // Append Christian context so generic names (e.g. "Joel Osteen") resolve to the right channel
  const contextualQuery = `${query} Christian pastor church preacher`;
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(contextualQuery)}&key=${YT_KEY}`;
  const searchData = await youtubeGet(searchUrl);

  const first = searchData.items?.[0];
  const channelId = first?.snippet?.channelId;
  if (!channelId) return null;

  return getChannelById(channelId);
}

async function resolveChannel(raw) {
  const parsed = extractChannelIdOrHandle(raw);

  if (parsed.type === 'channelId') {
    const channel = await getChannelById(parsed.value);
    return {
      channel,
      resolutionType: 'channelId',
      sourceValue: parsed.value
    };
  }

  if (parsed.type === 'handle') {
    const channel = await getChannelByHandle(parsed.value);
    if (channel) {
      return {
        channel,
        resolutionType: 'handle',
        sourceValue: parsed.value
      };
    }

    const searched = await searchChannel(`@${parsed.value}`);
    return {
      channel: searched,
      resolutionType: 'handle-search-fallback',
      sourceValue: parsed.value
    };
  }

  if (parsed.type === 'search') {
    const channel = await searchChannel(parsed.value);
    return {
      channel,
      resolutionType: 'search',
      sourceValue: parsed.value
    };
  }

  return {
    channel: null,
    resolutionType: 'unresolved',
    sourceValue: parsed.value
  };
}

function toInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function buildRowPayload(channelItem, fallbackName = null, sourceHandle = null) {
  return {
    channel_id: channelItem?.id,
    channel_name: channelItem?.snippet?.title || fallbackName || null,
    handle: sourceHandle ? `@${sourceHandle}` : null,
    subscriber_count: toInt(channelItem?.statistics?.subscriberCount),
    view_count: toInt(channelItem?.statistics?.viewCount),
    video_count: toInt(channelItem?.statistics?.videoCount),
    is_active: true
  };
}

async function run() {
  if (!YT_KEY) {
    throw new Error('Missing YOUTUBE_API_KEY in environment');
  }

  const fileArg = process.argv[2];
  if (!fileArg) {
    throw new Error('Usage: node scripts/importYoutubeChannelsFromXlsx.js <path-to-xlsx>');
  }

  const absolutePath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(process.cwd(), fileArg);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  console.log(`Reading workbook: ${absolutePath}`);
  const workbook = xlsx.readFile(absolutePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Workbook has no sheets');
  }

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) {
    throw new Error('Sheet has no rows');
  }

  let imported = 0;
  let skipped = 0;
  let unresolved = 0;

  for (const [idx, row] of rows.entries()) {
    const rawIdentifier = findField(row, CANDIDATE_ID_KEYS);
    const fallbackName = findField(row, CANDIDATE_NAME_KEYS);

    const source = rawIdentifier || fallbackName;
    if (!source) {
      skipped += 1;
      continue;
    }

    // Small delay to stay well under YouTube Data API quota (10k units/day)
    if (idx > 0) await new Promise(r => setTimeout(r, 300));

    try {
      const { channel, resolutionType, sourceValue } = await resolveChannel(source);

      if (!channel?.id) {
        unresolved += 1;
        console.warn(`[Row ${idx + 2}] Could not resolve: ${source}`);
        continue;
      }

      const payload = buildRowPayload(
        channel,
        fallbackName,
        resolutionType.startsWith('handle') ? sourceValue : null
      );

      let { error } = await supabase
        .from('youtube_channels')
        .upsert(payload, { onConflict: 'channel_id' });

      if (error) {
        const minimalPayload = {
          channel_id: payload.channel_id,
          channel_name: payload.channel_name,
          is_active: true
        };

        const fallback = await supabase
          .from('youtube_channels')
          .upsert(minimalPayload, { onConflict: 'channel_id' });

        if (fallback.error) {
          throw fallback.error;
        }

        error = null;
      }

      imported += 1;
      console.log(
        `[Row ${idx + 2}] Imported ${payload.channel_name} (${payload.channel_id}) via ${resolutionType}`
      );
    } catch (err) {
      skipped += 1;
      console.warn(`[Row ${idx + 2}] Skipped ${source}: ${err.message}`);
    }
  }

  console.log('\nDone.');
  console.log(`Imported: ${imported}`);
  console.log(`Unresolved handles/values: ${unresolved}`);
  console.log(`Skipped errors/blank rows: ${skipped}`);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Import failed:', err.message);
      process.exit(1);
    });
}

module.exports = run;
