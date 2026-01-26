const supabase = require('../config/supabase');
const openai = require('../config/openai');
const YT_KEY = process.env.YOUTUBE_API_KEY;

async function curateVideos() {
  console.log('🚀 Starting Video Curation...');

  // 1. Fetch Master Focus/Improvement Areas from app_options
  const { data: optionsData } = await supabase
    .from('app_options')
    .select('name, options')
    .in('name', ['focus_areas', 'improvement_areas']);

  const masterFocus = optionsData?.find(o => o.name === 'focus_areas')?.options || [];
  const masterImprovement = optionsData?.find(o => o.name === 'improvement_areas')?.options || [];

  // 2. Fetch Channels to scan
  const { data: channels } = await supabase.from('youtube_channels').select('*');

  for (const channel of channels) {
    console.log(`Scanning channel: ${channel.channel_name}`);

    try {
      // 3. Get the "Uploads" Playlist ID
      const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.channel_id}&key=${YT_KEY}`
      );
      const channelData = await channelRes.json();
      const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

      // 4. Fetch the recent videos from that playlist
      const playlistRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=100&key=${YT_KEY}`
      );
      const playlistData = await playlistRes.json();

      for (const item of playlistData.items) {
        const videoId = item.contentDetails.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const title = item.snippet.title;

        // 5. Check if video already exists in database
        const { data: existingVideo, error: checkError } = await supabase
          .from('recommended_videos')
          .select('video_id')
          .eq('video_url', videoUrl)
          .single();

        if (existingVideo) {
          console.log(`⏭️  Skipping existing video: ${title}`);
          continue;
        }

        if (checkError && checkError.code !== 'PGRST116') {
          console.error(`Error checking if video exists:`, checkError);
        }

        // 6. Get Metadata & Captions/Transcript logic from your youtube.ts
        const videoDetailsRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YT_KEY}`
        );
        const videoDetails = await videoDetailsRes.json();
        //console.log('Video Details fetched for:', title, item);
        //console.log("Content Details: ", videoDetails.items[0].contentDetails);
        
        // We will use the description and tags as a proxy for analysis if captions are unavailable.
        const textForAnalysis = `Title: ${title}\nDescription: ${item.snippet.description}`;
        
        //console.log(`Analyzing video: ${title}`, 'text for analysis:', textForAnalysis);

        // 7. AI Analysis against master options
        const analysis = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "system",
            content: `Analyze this sermon content. 
            Match it to these Focus Areas: ${masterFocus.join(', ')}
            And these Improvement Areas: ${masterImprovement.join(', ')}
            Return ONLY JSON: { "matched_focus": [], "matched_improvement": [] }`
          }, {
            role: "user",
            content: textForAnalysis
          }],
          response_format: { type: "json_object" }
        });

        const result = JSON.parse(analysis.choices[0].message.content);

        // 8. Save if there's a match
        if (result.matched_focus.length > 0 || result.matched_improvement.length > 0) {
          await supabase.from('recommended_videos').upsert({
            video_id: videoId,
            video_url: videoUrl,
            title: title,
            thumbnail_url: item.snippet.thumbnails.high.url,
            focus_areas: result.matched_focus,
            improvement_areas: result.matched_improvement
          });
          console.log(`✅ Saved Recommendation: ${title}`);
        }
      }
    } catch (err) {
      console.error(`Error processing channel ${channel.channel_name}:`, err.message);
    }
  }
}

curateVideos();