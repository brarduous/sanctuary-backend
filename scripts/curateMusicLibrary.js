const { google } = require('googleapis');
const supabase = require('../config/supabase');
const openai = require('../config/openai');
require('dotenv').config();

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Master list of activities to validate AI tags against
const VALID_ACTIVITIES = [
    "Gym", "Running", "Walk", "Commute", "Focus", 
    "Meditation", "Sleep", "Morning", "Evening"
];

async function curateLibrary() {
    console.log('🎧 Starting Master Curation...');

    // 1. Fetch all Options (Focus, Improvement, Activities)
    const { data: optionsData } = await supabase
        .from('app_options')
        .select('name, options')
        .in('name', ['focus_areas', 'improvement_areas', 'activities']);

    const focusOptions = optionsData.find(o => o.name === 'focus_areas')?.options || [];
    const improveOptions = optionsData.find(o => o.name === 'improvement_areas')?.options || [];
    const activityOptions = optionsData.find(o => o.name === 'activities')?.options || [];

    // Combine them into a single "Curation Queue"
    // Format: { type: 'focus', tag: 'Prayer Life' }
    let queue = [
        ...focusOptions.map(o => ({ type: 'focus_areas', tag: o.title })),
        ...improveOptions.map(o => ({ type: 'improvement_areas', tag: o.title })),
        ...activityOptions.map(o => ({ type: 'activities', tag: o.title }))
    ];

    console.log(`📋 Processing ${queue.length} tags...`);

    // Process sequentially to respect rate limits
    for (const item of queue) {
        await processTag(item);
        // Small delay to be nice to APIs
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('✨ Curation Complete!');
}

async function processTag(item) {
    console.log(`\n🔍 Curating for [${item.type}]: "${item.tag}"`);

    try {
        // 2. Ask AI for Songs + Cross-Tagging
        // We ask AI to provide the YouTube query AND best-fit activities/tags
        const prompt = `
            I need 3 excellent Christian/Worship songs for the category: "${item.tag}" (${item.type}).
            
            For EACH song, generate:
            1. "query": A YouTube search string (add 'Lyrics', 'Audio', or 'Instrumental' to find music-only versions).
            2. "activities": Pick 1-3 activities from this list that fit the song's vibe: ${VALID_ACTIVITIES.join(', ')}.
            3. "vibes": A few keywords describing the sound (e.g. "Upbeat", "Soaking").

            RETURN JSON ONLY:
            {
              "songs": [
                { "query": "...", "activities": ["Gym", "Running"], "vibes": ["High Energy"] }
              ]
            }
        `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: prompt }],
            response_format: { type: "json_object" }
        });

        const { songs } = JSON.parse(completion.choices[0].message.content);

        // 3. Search YouTube & Save
        for (const song of songs) {
            const ytRes = await youtube.search.list({
                part: 'snippet',
                q: song.query,
                type: 'video',
                videoCategoryId: '10', // Music
                maxResults: 1
            });

            const video = ytRes.data.items[0];
            
            if (video) {
                const videoId = video.id.videoId;

                // Prepare Tags
                // We merge the CURRENT tag (item.tag) into the appropriate array
                let activities = song.activities;
                let focus = [];
                let improvement = [];

                if (item.type === 'activities') {
                    if (!activities.includes(item.tag)) activities.push(item.tag);
                } else if (item.type === 'focus_areas') {
                    focus.push(item.tag);
                } else if (item.type === 'improvement_areas') {
                    improvement.push(item.tag);
                }

                // 4. UPSERT Logic (The Magic Step)
                // If song exists, we append new tags using Postgres array concatenation
                // Since Supabase JS client doesn't do "append" easily in one generic call, 
                // we will use a stored procedure OR a read-modify-write pattern.
                // Read-modify-write is safer for scripts:
                
                const { data: existing } = await supabase
                    .from('curated_tracks')
                    .select('*')
                    .eq('video_id', videoId)
                    .single();

                let finalActivities = [...new Set([...(existing?.activities || []), ...activities])];
                let finalFocus = [...new Set([...(existing?.focus_areas || []), ...focus])];
                let finalImprovement = [...new Set([...(existing?.improvement_areas || []), ...improvement])];

                const { error } = await supabase.from('curated_tracks').upsert({
                    video_id: videoId,
                    title: video.snippet.title,
                    artist: video.snippet.channelTitle,
                    thumbnail_url: video.snippet.thumbnails.high.url,
                    activities: finalActivities,
                    focus_areas: finalFocus,
                    improvement_areas: finalImprovement,
                    is_active: true
                }, { onConflict: 'video_id' });

                if (error) console.error(`   ❌ DB Error: ${error.message}`);
                else console.log(`   ✅ Saved: "${video.snippet.title}" [Acts: ${finalActivities.length}]`);
            }
        }

    } catch (err) {
        console.error(`   ❌ Error processing ${item.tag}:`, err.message);
    }
}

curateLibrary();