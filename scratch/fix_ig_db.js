const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
if (!fs.existsSync(dbPath)) {
    console.error("db.json not found!");
    process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igIndex = db.trackedChannels.findIndex(c => c.platform === 'instagram' && c.handle.toLowerCase() === 'founderbusinesstech');

if (igIndex === -1) {
    console.error("No Instagram channel found in db!");
    process.exit(1);
}

const html = db.trackedChannels[igIndex].subscriberCount;
if (!html.startsWith('<!DOCTYPE html>')) {
    console.log("Database does not contain raw HTML in subscriberCount. Already clean!");
    process.exit(0);
}

console.log("HTML length stored in DB:", html.length);

// Robust Parse logic
function parseInstagramHtml(html, handle) {
  let profilePic = null;
  let followerCount = 'N/A';
  let authorName = handle;
  const videos = [];
  
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let jsonParsed = false;
  
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1].trim();
    if (scriptContent.includes('edge_owner_to_timeline_media') || scriptContent.includes('profile_pic_url') || scriptContent.includes('edge_followed_by')) {
      const startIdx = scriptContent.indexOf('{');
      const endIdx = scriptContent.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = scriptContent.slice(startIdx, endIdx + 1);
        try {
          const data = JSON.parse(jsonStr);
          
          function findData(obj) {
            if (!obj || typeof obj !== 'object') return;
            
            if (obj.profile_pic_url) profilePic = obj.profile_pic_url_hd || obj.profile_pic_url;
            if (obj.full_name) authorName = obj.full_name;
            if (obj.edge_followed_by && typeof obj.edge_followed_by.count === 'number') {
              followerCount = `${obj.edge_followed_by.count.toLocaleString()} followers`;
            }
            if (obj.edge_owner_to_timeline_media && obj.edge_owner_to_timeline_media.edges) {
              const edges = obj.edge_owner_to_timeline_media.edges;
              edges.forEach(edge => {
                const node = edge.node;
                if (node && node.shortcode) {
                  videos.push({
                    videoId: node.shortcode,
                    title: node.edge_media_to_caption?.edges?.[0]?.node?.text || "Instagram Post",
                    publishedAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : new Date().toISOString(),
                    views: node.video_view_count ? `${node.video_view_count.toLocaleString()} views` : (node.play_count ? `${node.play_count.toLocaleString()} views` : '0 views'),
                    thumbnail: node.thumbnail_src || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop&q=60',
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
          break;
        } catch (e) {}
      }
    }
  }
  
  if (!jsonParsed || followerCount === 'N/A' || !profilePic) {
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
      
      const namePartMatch = descMatch[1].match(/-\s*([^-]+?)\s*\(@/);
      if (namePartMatch) {
        authorName = namePartMatch[1].trim();
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

const parsed = parseInstagramHtml(html, 'founderbusinesstech');

console.log("Parsed profile successfully:");
console.log("- Followers:", parsed.subscriberCount);
console.log("- Author Name:", parsed.authorName);
console.log("- Avatar:", parsed.avatar.slice(0, 80) + "...");
console.log("- Reels count:", parsed.videos.length);

db.trackedChannels[igIndex] = {
    platform: 'instagram',
    handle: 'founderbusinesstech',
    authorName: parsed.authorName || 'founderbusinesstech',
    avatar: parsed.avatar,
    subscriberCount: parsed.subscriberCount,
    videos: parsed.videos,
    lastSyncTime: new Date().toISOString()
};

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log("Database successfully cleaned and rewritten!");
