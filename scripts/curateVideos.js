const supabase = require('../config/supabase');
const openai = require('../config/openai');
const YT_KEY = process.env.YOUTUBE_API_KEY;

// How many days back should we check for new videos?
const DAYS_TO_LOOK_BACK = 7;
// How many videos to send to OpenAI in a single API call
const BATCH_SIZE = 10; 

async function curateVideos() {
  console.log('🚀 Starting Optimized Video Curation...');

  // 1. Calculate the cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_LOOK_BACK);
  console.log(`📅 Only processing videos published after: ${cutoffDate.toISOString()}`);

  // 2. Fetch Master Focus/Improvement Areas
  const { data: optionsData } = await supabase
    .from('app_options')
    .select('name, options')
    .in('name', ['focus_areas', 'improvement_areas']);

  const masterFocus = optionsData?.find(o => o.name === 'focus_areas')?.options.map(opt => opt.title) || [];
  const masterImprovement = optionsData?.find(o => o.name === 'improvement_areas')?.options.map(opt => opt.title) || [];

  // 3. Fetch Channels
  const { data: channels } = await supabase.from('youtube_channels').select('*');

  for (const channel of channels) {
    console.log(`\n📺 Scanning channel: ${channel.channel_name}`);

    try {
      // Get the "Uploads" Playlist ID
      const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.channel_id}&key=${YT_KEY}`
      );
      const channelData = await channelRes.json();
      const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

      let nextPageToken = '';
      let keepFetching = true;
      let recentVideos = [];

      // 4. Fetch YouTube Videos (Stopping at the 7-day mark)
      while (keepFetching) {
        const playlistRes = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsPlaylistId}&key=${YT_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`
        );
        const playlistData = await playlistRes.json();

        for (const item of playlistData.items) {
          const publishedAt = new Date(item.snippet.publishedAt);
          
          // If the video is older than our cutoff, STOP looking through this channel
          if (publishedAt < cutoffDate) {
            keepFetching = false;
            break; 
          }

          // Push to our processing queue
          recentVideos.push({
            id: item.snippet.resourceId.videoId,
            title: item.snippet.title,
            description: item.snippet.description, // Use description instead of full heavy transcripts if possible
            thumbnail: item.snippet.thumbnails?.high?.url || ''
          });
        }

        nextPageToken = playlistData.nextPageToken;
        if (!nextPageToken) keepFetching = false;
      }

      console.log(`Found ${recentVideos.length} recent videos for ${channel.channel_name}.`);

      // 5. Batch Process with OpenAI
      for (let i = 0; i < recentVideos.length; i += BATCH_SIZE) {
        const batch = recentVideos.slice(i, i + BATCH_SIZE);
        
        // Format the batch for the LLM
        const textForAnalysis = batch.map((v, index) => 
          `[Video ${index + 1}] ID: ${v.id} | Title: ${v.title} | Desc: ${v.description.substring(0, 500)}...` // limit desc length to save tokens
        ).join('\n\n');

        console.log(`🤖 Sending batch of ${batch.length} videos to OpenAI...`);

        const analysis = await openai.chat.completions.create({
          model: "gpt-4o-mini", // <-- MASSIVE COST SAVING: Use mini for classification
          messages: [{
            role: "system",
            content: `You are a categorization assistant. Analyze this batch of sermon videos. 
            Match each video to these Focus Areas: ${masterFocus.join(', ')}
            And these Improvement Areas: ${masterImprovement.join(', ')}
            If a video doesn't fit, leave the arrays empty.
            
            Return ONLY a JSON object exactly in this format: 
            {
              "results": [
                { "video_id": "the_id_provided", "matched_focus": ["area1"], "matched_improvement": [] }
              ]
            }`
          }, {
            role: "user",
            content: textForAnalysis
          }],
          response_format: { type: "json_object" }
        });

        const resultData = JSON.parse(analysis.choices[0].message.content);

        // 6. Save matched videos to Supabase
        for (const result of resultData.results) {
          if (result.matched_focus.length > 0 || result.matched_improvement.length > 0) {
            
            // Find the original video object to get the title/thumbnail back
            const originalVideo = batch.find(v => v.id === result.video_id);
            if (!originalVideo) continue;

            await supabase.from('recommended_videos').upsert({
              video_id: originalVideo.id,
              video_url: `https://www.youtube.com/watch?v=${originalVideo.id}`,
              title: originalVideo.title,
              thumbnail_url: originalVideo.thumbnail,
              focus_areas: result.matched_focus,
              improvement_areas: result.matched_improvement
            });
            console.log(`✅ Saved Recommendation: ${originalVideo.title}`);
          }
        }
      }

    } catch (err) {
      console.error(`❌ Error processing channel ${channel.channel_name}:`, err.message);
    }
  }
  
  console.log('🎉 Video Curation Complete!');
}

// Execute if running directly
if (require.main === module) {
    curateVideos().then(() => process.exit(0));
}

module.exports = curateVideos;