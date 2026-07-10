const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igChannel = db.trackedChannels.find(c => c.platform === 'instagram');
const html = igChannel.subscriberCount;

function robustParseInstagramHtml(html, handle) {
  let profilePic = null;
  let followerCount = 'N/A';
  let authorName = handle;
  const videos = [];
  
  // 1. Try to find JSON scripts
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let jsonParsed = false;
  
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1].trim();
    if (scriptContent.includes('edge_owner_to_timeline_media') || scriptContent.includes('profile_pic_url') || scriptContent.includes('edge_followed_by')) {
      // Extract JSON portion
      const startIdx = scriptContent.indexOf('{');
      const endIdx = scriptContent.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = scriptContent.slice(startIdx, endIdx + 1);
        try {
          const data = JSON.parse(jsonStr);
          console.log("SUCCESSFULLY parsed script JSON!");
          
          // Let's locate user profile data in the parsed JSON recursively
          function findData(obj) {
            if (!obj || typeof obj !== 'object') return;
            
            if (obj.profile_pic_url) profilePic = obj.profile_pic_url_hd || obj.profile_pic_url;
            if (obj.full_name) authorName = obj.full_name;
            if (obj.edge_followed_by && typeof obj.edge_followed_by.count === 'number') {
              followerCount = `${obj.edge_followed_by.count.toLocaleString()} followers`;
            }
            if (obj.edge_owner_to_timeline_media && obj.edge_owner_to_timeline_media.edges) {
              const edges = obj.edge_owner_to_timeline_media.edges;
              console.log(`Found edge_owner_to_timeline_media edges count: ${edges.length}`);
              edges.forEach(edge => {
                const node = edge.node;
                if (node && node.shortcode) {
                  videos.push({
                    videoId: node.shortcode,
                    title: node.edge_media_to_caption?.edges?.[0]?.node?.text || "Instagram Post",
                    publishedAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : new Date().toISOString(),
                    views: node.video_view_count ? `${node.video_view_count.toLocaleString()} views` : '0 views',
                    thumbnail: node.thumbnail_src,
                    url: `https://instagram.com/reel/${node.shortcode}`
                  });
                }
              });
            }
            
            for (const key in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, key)) {
                findData(obj[key]);
              }
            }
          }
          findData(data);
          jsonParsed = true;
          break; // Stop on first successful match
        } catch (e) {
          console.log("JSON parse attempt failed on script block:", e.message);
        }
      }
    }
  }
  
  // 2. Meta Fallbacks if JSON parsing failed
  if (!jsonParsed || followerCount === 'N/A' || !profilePic) {
    console.log("Using meta fallbacks...");
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogImageMatch) {
      profilePic = ogImageMatch[1].replace(/&amp;/g, '&');
    }
    
    const descMatch = html.match(/<meta\s+content="([^"]+)"\s+name="description"/i) || 
                      html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || 
                      html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (descMatch) {
      const followers = descMatch[1].match(/^([\d,.]+[KMB]?)\s+Followers/i);
      if (followers) {
        followerCount = `${followers[1]} followers`;
      }
    }
  }
  
  return {
    success: true,
    handle,
    authorName,
    avatar: profilePic || 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png',
    subscriberCount: followerCount,
    videos
  };
}

const result = robustParseInstagramHtml(html, 'founderbusinesstech');
console.log("Parse Result:", {
  handle: result.handle,
  authorName: result.authorName,
  avatar: result.avatar ? result.avatar.slice(0, 50) + "..." : null,
  subscriberCount: result.subscriberCount,
  videosCount: result.videos.length
});
