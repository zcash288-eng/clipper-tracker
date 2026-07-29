const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Mutex } = require('async-mutex');

const dbMutex = new Mutex();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Ensure DB directory and file exist
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Global DB helper functions
function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const defaultDb = {
        trackedChannels: [],
        schedulerList: [],
        matchupsList: [],
        settings: {
          neglectThreshold: 24,
          audioEnabled: true,
          browserNotifEnabled: true,
          igSessionId: ""
        },
        history: {}
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2));
      return defaultDb;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error reading database JSON file:", e.message);
    return { trackedChannels: [], schedulerList: [], matchupsList: [], settings: { neglectThreshold: 24, audioEnabled: true, browserNotifEnabled: true, igSessionId: "" }, history: {} };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Error writing database JSON file:", e.message, "Data preview:", JSON.stringify(data).substring(0, 500));
    return false;
  }
}

app.use(helmet());
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to convert views strings to integer
function parseViewsText(viewsText) {
  if (!viewsText) return 0;
  if (viewsText.toString().length > 50) return 0; // L-21
  const cleanStr = viewsText.toString().toLowerCase().replace(/views/g, '').replace(/,/g, '').trim();
  if (cleanStr.includes('b')) {
    return Math.round(parseFloat(cleanStr.replace('b', '')) * 1000000000);
  }
  if (cleanStr.includes('m')) {
    return Math.round(parseFloat(cleanStr.replace('m', '')) * 1000000);
  }
  if (cleanStr.includes('k')) {
    return Math.round(parseFloat(cleanStr.replace('k', '')) * 1000);
  }
  return parseInt(cleanStr, 10) || 0;
}

// Log history logs to capture view progression
function logVideoHistory(db, platform, handle, videoId, currentViews) {
  if (!db.history) db.history = {};
  const key = `${platform}_${handle}_${videoId}`;
  if (!db.history[key]) db.history[key] = [];
  
  const today = new Date().toLocaleDateString('en-CA');
  const historyList = db.history[key];
  const viewsNum = parseViewsText(currentViews);
  
  const todayIndex = historyList.findIndex(h => h.date === today);
  if (todayIndex !== -1) {
    historyList[todayIndex].views = viewsNum;
  } else {
    historyList.push({ date: today, views: viewsNum });
  }
  
  // Limit to last 30 snapshot days
  if (historyList.length > 30) historyList.shift();
}

// Helper to extract channel ID from YouTube channel page HTML
async function getChannelIdFromHandle(handle) {
  const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
  const url = `https://www.youtube.com/${cleanHandle}`;
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });
  const html = response.data;
  
  const metaMatch = html.match(/<meta itemprop="channelId" content="([^"]+)">/);
  if (metaMatch) return metaMatch[1];
  
  const ytDataMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/);
  if (ytDataMatch) {
    try {
      const data = JSON.parse(ytDataMatch[1]);
      const externalId = data.metadata?.channelMetadataRenderer?.externalId;
      if (externalId) return externalId;
    } catch (e) {}
  }
  
  throw new Error("Could not resolve channel ID. Check the handle spelling.");
}

// Fetch YouTube RSS feed
async function getRssVideos(channelId) {
  const entries = [];
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await axios.get(url, { timeout: 10000 });
    const xml = response.data;
    
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    
    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const idMatch = entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      let titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
      const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/);
      const updatedMatch = entryXml.match(/<updated>([^<]+)<\/updated>/);
      
      if (idMatch && titleMatch) {
        let title = titleMatch[1];
        if (title.startsWith('<![CDATA[')) {
          title = title.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
        }
        entries.push({
          videoId: idMatch[1],
          title: title,
          published: publishedMatch ? publishedMatch[1] : null,
          updated: updatedMatch ? updatedMatch[1] : null
        });
      }
    }
  } catch (e) {
    console.error(`Error fetching RSS feed for ${channelId}:`, e.message);
  }
  return entries;
}

// Extract videos and Shorts from ytInitialData inside HTML
function extractVideosFromYtData(html) {
  const ytDataMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/);
  if (!ytDataMatch) return [];
  
  const videos = [];
  try {
    const data = JSON.parse(ytDataMatch[1]);
    
    let iterations = 0;
    function findVideos(obj, depth = 0) {
      if (iterations++ > 100000) return;
      if (!obj || typeof obj !== 'object') return;
      if (depth > 20) return;
      
      if (obj.videoRenderer) {
        const vr = obj.videoRenderer;
        const videoId = vr.videoId;
        const title = vr.title?.runs?.[0]?.text || vr.title?.accessibility?.accessibilityData?.label;
        const viewCount = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText;
        const publishedText = vr.publishedTimeText?.simpleText;
        const thumbnail = vr.thumbnail?.thumbnails?.[0]?.url;
        
        videos.push({
          videoId,
          title,
          views: viewCount,
          publishedText,
          thumbnail,
          isShort: false
        });
      }
      
      if (obj.reelItemRenderer) {
        const rir = obj.reelItemRenderer;
        const videoId = rir.videoId;
        const title = rir.headline?.simpleText;
        const viewCount = rir.viewCountText?.simpleText;
        const thumbnail = rir.thumbnail?.thumbnails?.[0]?.url;
        
        videos.push({
          videoId,
          title,
          views: viewCount,
          publishedText: null,
          thumbnail,
          isShort: true
        });
      }
      
      if (obj.shortsLockupViewModel) {
        const slv = obj.shortsLockupViewModel;
        const videoId = slv.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
        const title = slv.overlayMetadata?.primaryText?.content;
        const viewCount = slv.overlayMetadata?.secondaryText?.content;
        
        // Handle nested thumbnail structure in viewModel
        let thumbnail = null;
        if (slv.thumbnailViewModel?.thumbnailViewModel?.image?.sources) {
          thumbnail = slv.thumbnailViewModel.thumbnailViewModel.image.sources[0]?.url;
        }
        
        if (videoId) {
          videos.push({
            videoId,
            title,
            views: viewCount || '0 views',
            publishedText: null,
            thumbnail,
            isShort: true
          });
        }
      }
      
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
          findVideos(obj[key], depth + 1);
        }
      }
    }
    
    findVideos(data);
  } catch (e) {
    console.error("Error parsing ytInitialData:", e.message);
  }
  return videos;
}

// Get combined YouTube channel data
async function getYouTubeChannelData(handle, existingVideos = []) {
  const channelId = await getChannelIdFromHandle(handle);
  const rssVideos = await getRssVideos(channelId);
  const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
  
  let shortsHtml = '';
  try {
    const shortsRes = await axios.get(`https://www.youtube.com/${cleanHandle}/shorts`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });
    shortsHtml = shortsRes.data;
  } catch (e) {
    console.error("Error fetching Shorts tab:", e.message);
  }
  
  let videosHtml = '';
  try {
    const videosRes = await axios.get(`https://www.youtube.com/${cleanHandle}/videos`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });
    videosHtml = videosRes.data;
  } catch (e) {
    console.error("Error fetching Videos tab:", e.message);
  }
  
  const parsedVideos = [
    ...extractVideosFromYtData(shortsHtml),
    ...extractVideosFromYtData(videosHtml)
  ];
  
  const videoMap = {};
  parsedVideos.forEach(v => {
    videoMap[v.videoId] = v;
  });
  
  let avatar = null;
  let authorName = handle;
  let subscriberCount = 'N/A';
  
  const targetHtml = videosHtml || shortsHtml;
  if (targetHtml) {
    const ytDataMatch = targetHtml.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/);
    if (ytDataMatch) {
        try {
            const data = JSON.parse(ytDataMatch[1]);
            const header = data.header?.c4TabbedHeaderRenderer;
            const pageHeader = data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;

            if (header) {
                avatar = header.avatar?.thumbnails?.[0]?.url;
                authorName = header.title;
                subscriberCount = header.subscriberCountText?.simpleText || header.subscriberCountText?.runs?.[0]?.text;
            } else if (pageHeader) {
                avatar = pageHeader.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url;
                authorName = pageHeader.title?.dynamicTextViewModel?.text?.content || handle;
                
                let subStr = 'N/A';
                if (pageHeader.metadata?.contentMetadataViewModel?.metadataRows) {
                    const rows = pageHeader.metadata.contentMetadataViewModel.metadataRows;
                    for (const row of rows) {
                        for (const part of row.metadataParts || []) {
                            if (part.text?.content?.toLowerCase().includes('subscriber')) {
                                subStr = part.text.content;
                            }
                        }
                    }
                }
                subscriberCount = subStr;
            }
        } catch (e) { console.error("YT parse error:", e.message); }
    }
  }
  
  const mergedVideos = rssVideos.map(rss => {
    const pageInfo = videoMap[rss.videoId];
    const isShort = pageInfo ? pageInfo.isShort : false;
    return {
      videoId: rss.videoId,
      title: rss.title,
      publishedAt: rss.published,
      views: pageInfo ? pageInfo.views : '0 views',
      thumbnail: pageInfo ? pageInfo.thumbnail : `https://i.ytimg.com/vi/${rss.videoId}/hqdefault.jpg`,
      url: isShort ? `https://www.youtube.com/shorts/${rss.videoId}` : `https://www.youtube.com/watch?v=${rss.videoId}`
    };
  });
  
    if (parsedVideos.length === 0 && rssVideos.length === 0) {
      return { success: false, error: 'Could not parse YouTube data. Format may have changed.' };
    }

    // 1. Ensure all existing videos are preserved in our new list if not already there from RSS
    existingVideos.forEach(ev => {
        const exists = mergedVideos.some(v => v.videoId === ev.videoId);
        if (!exists) {
            mergedVideos.push(ev);
        }
    });

    // 2. Update existing videos with new stats from HTML, or add entirely new ones
    Object.keys(videoMap).forEach(id => {
        const pageInfo = videoMap[id];
        const existingIdx = mergedVideos.findIndex(v => v.videoId === id);
        
        if (existingIdx !== -1) {
             // Update views and thumbnail of existing video
             mergedVideos[existingIdx].views = pageInfo.views || mergedVideos[existingIdx].views;
             if (pageInfo.thumbnail) mergedVideos[existingIdx].thumbnail = pageInfo.thumbnail;
        } else {
             // Add brand new video found in HTML
             mergedVideos.push({
                 videoId: id,
                 title: pageInfo.title,
                 publishedAt: null,
                 views: pageInfo.views,
                 thumbnail: pageInfo.thumbnail,
                 url: pageInfo.isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`
             });
        }
    });
  
  return {
    success: true,
    channelId,
    handle,
    authorName,
    avatar,
    subscriberCount,
    videos: mergedVideos
  };
}

// Scrape Instagram metrics from pasted source code HTML
function parseInstagramHtml(html, handle) {
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
      const startIdx = scriptContent.indexOf('{');
      const endIdx = scriptContent.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = scriptContent.slice(startIdx, endIdx + 1);
        try {
          const data = JSON.parse(jsonStr);
          
          let iterations = 0;
          function findData(obj, depth = 0) {
            if (iterations++ > 100000) return false;
            if (depth > 20) return false;
            if (!obj || typeof obj !== 'object') return false;
            
            if (obj.profile_pic_url) profilePic = obj.profile_pic_url_hd || obj.profile_pic_url;
            if (obj.full_name) authorName = obj.full_name;
            if (obj.edge_followed_by && typeof obj.edge_followed_by.count === 'number') {
              followerCount = `${obj.edge_followed_by.count.toLocaleString('en-US')} followers`;
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
                    views: node.video_view_count ? `${node.video_view_count.toLocaleString('en-US')} views` : (node.play_count ? `${node.play_count.toLocaleString('en-US')} views` : '0 views'),
                    thumbnail: node.thumbnail_src || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop&q=60',
                    url: `https://instagram.com/reel/${node.shortcode}`
                  });
                }
              });
            }
            
            if (followerCount !== 'N/A' && profilePic && videos.length > 0) return true;

            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                    if (findData(obj[key], depth + 1)) return true;
                }
            }
            return false;
          }
          
          findData(data);
          jsonParsed = true;
          break;
        } catch (e) {
          // Continue to next block if parse fails
        }
      }
    }
  }
  
  // 2. Meta Fallbacks if JSON parsing failed or incomplete
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

// --- Endpoints ---

// Load DB
app.get('/api/db', async (req, res) => {
  const db = readDb();
  const safeSettings = { ...db.settings };
  delete safeSettings.bufferToken;
  delete safeSettings.igSessionId;
  res.json({ ...db, settings: safeSettings });
});

// Update database components
app.post('/api/db/channels', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ success: false, error: 'Expected array' });
  try {
    await dbMutex.runExclusive(async () => {
      const db = readDb();
      db.trackedChannels = req.body;
      if (!writeDb(db)) throw new Error('Failed to save DB');
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/db/schedules', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ success: false, error: 'Expected array' });
  try {
    await dbMutex.runExclusive(async () => {
      const db = readDb();
      db.schedulerList = req.body;
      if (!writeDb(db)) throw new Error('Failed to save DB');
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/db/schedules/:index', async (req, res) => {
  try {
    await dbMutex.runExclusive(async () => {
      const db = readDb();
      const index = parseInt(req.params.index, 10);
      if (index >= 0 && index < db.schedulerList.length) {
        db.schedulerList.splice(index, 1);
        if (!writeDb(db)) throw new Error('Failed to save DB');
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: 'Index out of bounds' });
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/db/matchups', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ success: false, error: 'Expected array' });
  try {
    await dbMutex.runExclusive(async () => {
      const db = readDb();
      db.matchupsList = req.body;
      if (!writeDb(db)) throw new Error('Failed to save DB');
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/db/settings', async (req, res) => {
  try {
    await dbMutex.runExclusive(async () => {
      const db = readDb();
      const allowedKeys = ['neglectThreshold', 'audioEnabled', 'browserNotifEnabled', 'igSessionId', 'bufferToken'];
      const newSettings = {};
      for (const key of allowedKeys) {
          if (req.body[key] !== undefined) {
              newSettings[key] = req.body[key];
          }
      }
      db.settings = { ...db.settings, ...newSettings };
      if (!writeDb(db)) throw new Error('Failed to save DB');
      res.json(db.settings);
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/db/channels/:platform/:handle/note', async (req, res) => {
    const { platform, handle } = req.params;
    const { note } = req.body;
    try {
        await dbMutex.runExclusive(async () => {
            const db = readDb();
            const idx = db.trackedChannels.findIndex(c => c.platform === platform && c.handle.toLowerCase() === handle.toLowerCase());
            if (idx === -1) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            
            db.trackedChannels[idx].note = note;
            if (!writeDb(db)) return res.status(500).json({ success: false, error: 'Failed to save' });
            res.json({ success: true, note });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/youtube/:handle', async (req, res) => {
  try {
    const handle = req.params.handle;
    if (!/^[a-zA-Z0-9_.-]+$/.test(handle.replace(/^@/, ''))) {
      return res.status(400).json({ success: false, error: "Invalid handle" });
    }
    
    let existingVideos = [];
    // Read once to pass existing videos
    const tempDb = readDb();
    const tempChannel = tempDb.trackedChannels.find(c => c.platform === 'youtube' && c.handle.toLowerCase() === handle.toLowerCase());
    if (tempChannel) existingVideos = tempChannel.videos;

    let data = await getYouTubeChannelData(handle, existingVideos);
    
    // Graceful fallback to existing DB data if YouTube scraper fails (e.g., rate limit or 404)
    if (!data.success && tempChannel) {
        console.warn(`[YouTube Scraper] Failed for @${handle}: ${data.error}. Relying on DB fallback.`);
        data = {
            success: true,
            channelId: tempChannel.channelId || null,
            handle: tempChannel.handle,
            authorName: tempChannel.authorName,
            avatar: tempChannel.avatar,
            subscriberCount: tempChannel.subscriberCount,
            videos: tempChannel.videos
        };
    }

    if (data.success) {
      try {
        await dbMutex.runExclusive(async () => {
          const db = readDb();
          
          const idx = db.trackedChannels.findIndex(c => c.platform === 'youtube' && c.handle.toLowerCase() === handle.toLowerCase());
          
          if (idx !== -1) {
            // Update only specific fields to avoid race condition data loss
            db.trackedChannels[idx].authorName = data.authorName || db.trackedChannels[idx].authorName;
            db.trackedChannels[idx].avatar = data.avatar || db.trackedChannels[idx].avatar;
            db.trackedChannels[idx].subscriberCount = data.subscriberCount || db.trackedChannels[idx].subscriberCount;
            
            // Merge fresh videos carefully
            const existingVideoMap = new Map();
            if (db.trackedChannels[idx].videos) {
              db.trackedChannels[idx].videos.forEach(v => existingVideoMap.set(v.videoId, v));
            }
            
            data.videos.forEach(newV => {
              const oldV = existingVideoMap.get(newV.videoId);
              if (oldV) {
                oldV.views = newV.views || oldV.views;
                oldV.thumbnail = newV.thumbnail || oldV.thumbnail;
                if (!oldV.publishedAt && newV.publishedAt) oldV.publishedAt = newV.publishedAt;
              } else {
                existingVideoMap.set(newV.videoId, newV);
              }
            });
            
            db.trackedChannels[idx].videos = Array.from(existingVideoMap.values());
            db.trackedChannels[idx].lastSyncTime = new Date().toISOString();
          } else {
            db.trackedChannels.push({
              platform: 'youtube',
              handle,
              authorName: data.authorName || handle,
              avatar: data.avatar || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png',
              subscriberCount: data.subscriberCount || 'N/A',
              videos: data.videos || [],
              lastSyncTime: new Date().toISOString()
            });
          }
          
          data.videos.forEach(v => {
            logVideoHistory(db, 'youtube', handle, v.videoId, v.views);
          });
          if (!writeDb(db)) throw new Error('Failed to save DB');
        });
      } catch (err) {
        console.error("YouTube Sync DB Write Error:", err.message);
        return res.status(500).json({ success: false, error: 'Database write failed during sync' });
      }
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Instagram Sync Fallback Endpoint
app.get('/api/instagram/:handle', async (req, res) => {
  const handle = req.params.handle;
  try {
    const db = readDb();
    const idx = db.trackedChannels.findIndex(c => c.platform === 'instagram' && c.handle.toLowerCase() === handle.toLowerCase());
    
    // Default fallback values
    let fallbackData = {
      success: true,
      authorName: handle,
      avatar: 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png',
      subscriberCount: 'N/A',
      videos: [],
      error: 'Data retrieved from local database.'
    };
    
    // Preserve existing DB data
    if (idx !== -1) {
      fallbackData.authorName = db.trackedChannels[idx].authorName || fallbackData.authorName;
      fallbackData.avatar = db.trackedChannels[idx].avatar || fallbackData.avatar;
      fallbackData.subscriberCount = db.trackedChannels[idx].subscriberCount || fallbackData.subscriberCount;
      fallbackData.videos = db.trackedChannels[idx].videos || [];
    }

    // Try lightweight internet scrape JUST for avatar and followers
    try {
      const cookieHeader = db.settings.igSessionId ? { 'Cookie': db.settings.igSessionId } : {};
      const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'x-ig-app-id': '936619743392459',
          'Accept': '*/*',
          ...cookieHeader
        },
        timeout: 5000
      });

      const user = response.data?.data?.user;
      if (user) {
        fallbackData.avatar = user.profile_pic_url || fallbackData.avatar;
        fallbackData.authorName = user.full_name || fallbackData.authorName;
        fallbackData.subscriberCount = user.edge_followed_by?.count ? `${user.edge_followed_by.count.toLocaleString()} followers` : fallbackData.subscriberCount;
        fallbackData.error = null; // Cleared error since scrape succeeded
      }
    } catch (scrapeErr) {
      // Ignore scrape errors (rate limits) and just rely on the fallback data we constructed
      console.warn(`[Instagram Scraper] Light scrape failed for @${handle}: ${scrapeErr.message}. Relying on DB fallback.`);
    }
    
    // Save/Update the channel in DB
    await dbMutex.runExclusive(async () => {
      const freshDb = readDb();
      const freshIdx = freshDb.trackedChannels.findIndex(c => c.platform === 'instagram' && c.handle.toLowerCase() === handle.toLowerCase());
      if (freshIdx !== -1) {
        freshDb.trackedChannels[freshIdx].authorName = fallbackData.authorName;
        freshDb.trackedChannels[freshIdx].avatar = fallbackData.avatar;
        freshDb.trackedChannels[freshIdx].subscriberCount = fallbackData.subscriberCount;
        freshDb.trackedChannels[freshIdx].lastSyncTime = new Date().toISOString();
      } else {
        freshDb.trackedChannels.push({
          platform: 'instagram',
          handle,
          authorName: fallbackData.authorName,
          avatar: fallbackData.avatar,
          subscriberCount: fallbackData.subscriberCount,
          videos: fallbackData.videos,
          lastSyncTime: new Date().toISOString()
        });
      }
      if (!writeDb(freshDb)) throw new Error('Failed to save DB');
    });
    
    res.json(fallbackData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual Instagram HTML Import Parser endpoint
app.post('/api/instagram/parse-html', async (req, res) => {
  const { handle, html } = req.body;
  if (!handle || !html) {
    return res.status(400).json({ success: false, error: 'Missing handle or html body content.' });
  }
  
  try {
    let data;
    if (html.trim().startsWith('{')) {
      // Direct console JSON bypass
      const parsed = JSON.parse(html);
      data = {
          success: true,
          authorName: parsed.authorName,
          avatar: parsed.avatar,
          subscriberCount: parsed.subscriberCount,
          videos: Array.isArray(parsed.videos) ? parsed.videos : []
      };
    } else {
      data = parseInstagramHtml(html, handle);
    }
    
    if (data.success) {
      await dbMutex.runExclusive(async () => {
        const db = readDb();
        
        const idx = db.trackedChannels.findIndex(c => c.platform === 'instagram' && c.handle.toLowerCase() === handle.toLowerCase());
        const channelObj = {
          platform: 'instagram',
          handle,
          authorName: data.authorName || handle,
          avatar: data.avatar || (db.trackedChannels[idx] ? db.trackedChannels[idx].avatar : 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png'),
          subscriberCount: data.subscriberCount || 'N/A',
          videos: data.videos || [],
          lastSyncTime: new Date().toISOString()
        };
        
        if (idx !== -1) {
          db.trackedChannels[idx] = { ...db.trackedChannels[idx], ...channelObj };
        } else {
          db.trackedChannels.push(channelObj);
        }
        
        data.videos.forEach(v => {
          logVideoHistory(db, 'instagram', handle, v.videoId, v.views);
        });
        if (!writeDb(db)) throw new Error('Failed to save DB');
      });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Fetch real metadata from Instagram's public oembed API for each reel
async function enrichInstagramVideos(videos) {
  const BATCH_SIZE = 5;
  const TIMEOUT_MS = 4000;
  
  async function fetchOembed(videoId) {
    try {
      const url = `https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/reel/${videoId}/`;
      const resp = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = resp.data;
      return {
        videoId,
        title: d.title || null,
        thumbnail: d.thumbnail_url || null,
        authorName: d.author_name || null
      };
    } catch (err) {
      // Try /p/ URL instead (some posts are /p/ not /reel/)
      try {
        const url2 = `https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${videoId}/`;
        const resp2 = await axios.get(url2, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const d2 = resp2.data;
        return { videoId, title: d2.title || null, thumbnail: d2.thumbnail_url || null, authorName: d2.author_name || null };
      } catch {
        console.log(`[Oembed] Failed for ${videoId}`);
        return { videoId, title: null, thumbnail: null, authorName: null };
      }
    }
  }
  
  const enriched = {};
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(v => fetchOembed(v.videoId)));
    results.forEach(r => { enriched[r.videoId] = r; });
    console.log(`[Oembed] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(videos.length/BATCH_SIZE)} done`);
  }
  
  return videos.map(v => {
    const oe = enriched[v.videoId] || {};
    return {
      ...v,
      title: (oe.title && oe.title.length > 0) ? oe.title.substring(0, 200) : v.title,
      thumbnail: (oe.thumbnail && oe.thumbnail.length > 10) ? oe.thumbnail : v.thumbnail
    };
  });
}

// BUFFER API INTEGRATION

// 1. Get Available Channels from Buffer
app.post('/api/buffer/channels', async (req, res) => {
  const db = readDb();
  const token = req.body.token || db.settings.bufferToken;
  
  if (!token) {
    return res.status(400).json({ success: false, error: 'Buffer API token is missing.' });
  }

  // Save the token if it's new
  if (req.body.token && db.settings.bufferToken !== req.body.token) {
    await dbMutex.runExclusive(async () => {
      const freshDb = readDb();
      freshDb.settings.bufferToken = req.body.token;
      if (!writeDb(freshDb)) throw new Error('Failed to save DB');
    });
  }

  const query = `
    query {
      account {
        id
        organizations {
          id
          name
        }
      }
    }
  `;

  try {
    const orgRes = await axios.post('https://api.buffer.com', { query }, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    if (orgRes.data.errors) throw new Error(orgRes.data.errors[0].message);
    
    const orgId = orgRes.data.data.account.organizations[0].id;
    const safeOrgId = orgId ? orgId.toString().replace(/[^a-zA-Z0-9_-]/g, '') : '';
    
    const channelQuery = `
      query {
        channels(input: { organizationId: "${safeOrgId}" }) {
          id
          service
          name
          avatar
        }
      }
    `;

    const channelRes = await axios.post('https://api.buffer.com', { query: channelQuery }, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    if (channelRes.data.errors) throw new Error(channelRes.data.errors[0].message);

    res.json({ success: true, channels: channelRes.data.data.channels, organizationId: orgId });
  } catch (e) {
    if (e.response && e.response.status === 401) {
      console.warn("Buffer API Error: Token Expired or Invalid (401)");
      return res.status(401).json({ success: false, error: 'Buffer token expired or invalid. Update in settings.' });
    }
    console.error("Buffer API Error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 2. Sync Selected Channel Posts from Buffer
app.post('/api/buffer/sync', async (req, res) => {
  const db = readDb();
  const { channelId, organizationId, platform, handle, authorName, avatar } = req.body;
  const token = db.settings.bufferToken;

  if (!token || !channelId || !organizationId) {
    return res.status(400).json({ success: false, error: 'Missing required parameters.' });
  }

  // Pre-patch DB to fix any missing avatars immediately, so the UI won't look broken 
  // even if the Buffer API call fails below (e.g. token expired)
  const finalHandle = handle || channelId;
  const finalPlatform = platform || 'instagram';
  await dbMutex.runExclusive(async () => {
    const db = readDb();
    let indexToPatch = db.trackedChannels.findIndex(c => c.handle.toLowerCase() === finalHandle.toLowerCase() && c.platform === finalPlatform);
    if (indexToPatch !== -1) {
      let updated = false;
      const currentAvatar = db.trackedChannels[indexToPatch].avatar;
      if (!currentAvatar || currentAvatar === 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png' || (avatar && avatar !== currentAvatar)) {
        if (avatar) {
          db.trackedChannels[indexToPatch].avatar = avatar;
          updated = true;
        } else if (!currentAvatar) {
          db.trackedChannels[indexToPatch].avatar = 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png';
          updated = true;
        }
      }
      if (!db.trackedChannels[indexToPatch].authorName && authorName) {
        db.trackedChannels[indexToPatch].authorName = authorName;
        updated = true;
      }
      if (updated) {
        if (!writeDb(db)) throw new Error('Failed to save avatar patch');
      }
    }
  });

  const safeOrgId = organizationId ? organizationId.toString().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const safeChannelId = channelId ? channelId.toString().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const query = `
    query {
      posts(
        first: 50,
        input: {
          organizationId: "${safeOrgId}",
          filter: { status: [sent], channelIds: ["${safeChannelId}"] }
        }
      ) {
        edges {
          node {
            id
            text
            sentAt
            createdAt
            dueAt
            updatedAt
            metrics {
              name
              value
            }
            assets {
              thumbnail
              source
            }
          }
        }
      }
    }
  `;

  try {
    const postRes = await axios.post('https://api.buffer.com', { query }, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    
    if (postRes.data.errors) throw new Error(postRes.data.errors[0].message);

    const edges = postRes.data.data.posts.edges;
    
    const videos = edges.map(edge => {
      const node = edge.node;
      // Get Views metric if it exists, else 0
      let viewsNum = 0;
      if (node.metrics) {
        const viewMetric = node.metrics.find(m => m.name.toLowerCase() === 'views' || m.name.toLowerCase() === 'reach');
        if (viewMetric) viewsNum = viewMetric.value;
      }
      const viewStr = viewsNum + ' views';
      
      const videoId = node.id;
      const title = node.text ? node.text.substring(0, 150) + (node.text.length > 150 ? '...' : '') : 'Buffer Post';
      const thumbnail = node.assets && node.assets.length > 0 ? node.assets[0].thumbnail : '';
      const url = node.assets && node.assets.length > 0 ? node.assets[0].source : '';
      return {
        videoId,
        title,
        publishedAt: node.sentAt || node.createdAt || node.dueAt || node.updatedAt,
        views: viewStr,
        thumbnail,
        url
      };
    });

    // Update or Insert into DB
    // finalHandle and finalPlatform already defined above
    
    
    // RE-READ DB inside mutex to avoid race conditions!
    await dbMutex.runExclusive(async () => {
      const freshDb = readDb();
      let index = freshDb.trackedChannels.findIndex(c => c.handle.toLowerCase() === finalHandle.toLowerCase() && c.platform === finalPlatform);
      
      if (index === -1) {
        freshDb.trackedChannels.push({
          platform: finalPlatform,
          handle: finalHandle,
          authorName: authorName || finalHandle,
          avatar: avatar || 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png',
          subscriberCount: 'N/A', // Buffer doesn't always provide followers in basic API easily
          videos,
          lastSyncTime: new Date().toISOString(),
          bufferChannelId: channelId
        });
      } else {
          freshDb.trackedChannels[index].bufferChannelId = channelId;
          if (!freshDb.trackedChannels[index].avatar) {
              freshDb.trackedChannels[index].avatar = avatar || 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png';
          }
          if (!freshDb.trackedChannels[index].authorName && authorName) {
              freshDb.trackedChannels[index].authorName = authorName;
          }
          const existingVideos = freshDb.trackedChannels[index].videos || [];
          const existingIds = new Set(existingVideos.map(v => v.videoId));
          for (const v of videos) {
              if (!existingIds.has(v.videoId)) {
                  existingVideos.push(v);
              } else {
                  const idx = existingVideos.findIndex(ev => ev.videoId === v.videoId);
                  if (idx !== -1) {
                      existingVideos[idx].views = v.views;
                      if (v.thumbnail) existingVideos[idx].thumbnail = v.thumbnail;
                      if (!existingVideos[idx].publishedAt && v.publishedAt) existingVideos[idx].publishedAt = v.publishedAt;
                  }
              }
          }
        freshDb.trackedChannels[index].videos = existingVideos;
        freshDb.trackedChannels[index].lastSyncTime = new Date().toISOString();
        freshDb.trackedChannels[index].bufferChannelId = channelId;
      }

      videos.forEach(v => {
        logVideoHistory(freshDb, finalPlatform, finalHandle, v.videoId, v.views);
      });

      if (!writeDb(freshDb)) throw new Error('Failed to save DB');
    });
    res.json({ success: true, videosCount: videos.length });
  } catch (e) {
    if (e.response && e.response.status === 401) {
      console.warn("Buffer API Error: Token Expired or Invalid (401)");
      return res.status(401).json({ success: false, error: 'Buffer token expired or invalid. Update in settings.' });
    }
    console.error("Buffer API Error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});


const escapeHtml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

app.post('/api/instagram/sync-bookmarklet', async (req, res) => {
  const { handle, html } = req.body;
  const safeHandle = escapeHtml(handle);

  console.log(`[Sync-Bookmarklet] Received sync request for @${handle}`);
  console.log(`[Sync-Bookmarklet] Payload length: ${html ? html.length : 0} characters`);
  
  if (!handle || !html) {
    console.log(`[Sync-Bookmarklet] Validation failed: handle or html missing`);
    return res.send(`
      <html>
      <body style="background:#121212; color:#ff4a4a; font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>❌ Sync Failed</h2>
        <p>Missing handle or payload data.</p>
        <button onclick="window.close()" style="padding:8px 16px; background:#444; border:none; color:#fff; border-radius:4px; cursor:pointer;">Close Tab</button>
      </body>
      </html>
    `);
  }
  
  try {
    let data;
    if (html.trim().startsWith('{')) {
      console.log(`[Sync-Bookmarklet] Payload is JSON format, parsing...`);
      data = JSON.parse(html);
      data.success = true;
    } else {
      console.log(`[Sync-Bookmarklet] Payload is HTML code format, parsing...`);
      data = parseInstagramHtml(html, handle);
    }
    
    console.log(`[Sync-Bookmarklet] Parse results: success=${data.success}, videosCount=${data.videos ? data.videos.length : 0}, authorName=${data.authorName}`);
    
    if (data.success) {
      // Enrich videos with real titles & thumbnails from oembed
      if (data.videos && data.videos.length > 0) {
        console.log(`[Sync-Bookmarklet] Enriching ${data.videos.length} videos via oembed...`);
        data.videos = await enrichInstagramVideos(data.videos);
        console.log(`[Sync-Bookmarklet] Enrichment complete.`);
      }
      
      await dbMutex.runExclusive(async () => {
        const db = readDb();
        const idx = db.trackedChannels.findIndex(c => c.platform === 'instagram' && c.handle.toLowerCase() === handle.toLowerCase());
        
        // Build a map of existing videos for smart merging
        const existingVideos = {};
        if (idx !== -1 && db.trackedChannels[idx].videos) {
          db.trackedChannels[idx].videos.forEach(v => {
            existingVideos[v.videoId] = v;
          });
        }
        
        // Smart merge: prefer richer data from existing or new
        const mergedVideos = (data.videos || []).map(newV => {
          const old = existingVideos[newV.videoId] || {};
          
          // For publishedAt: keep existing real date, or use new if it looks real (not "just now")
          let publishedAt = old.publishedAt || newV.publishedAt;
          // If publishedAt is within 60 seconds of the sync time, it's likely a fallback "now" date
          const syncTime = new Date();
          const pubDate = new Date(publishedAt);
          if (Math.abs(syncTime - pubDate) < 120000 && old.publishedAt && Math.abs(syncTime - new Date(old.publishedAt)) > 120000) {
            publishedAt = old.publishedAt; // keep old date, new one is fake "now"
          }
          
          return {
            videoId: newV.videoId,
            title: (newV.title && newV.title !== 'Instagram Reel') ? newV.title : (old.title || newV.title || 'Instagram Reel'),
            publishedAt: publishedAt,
            views: (newV.views && newV.views !== '0 views') ? newV.views : (old.views || newV.views || '0 views'),
            thumbnail: (newV.thumbnail && newV.thumbnail.length > 10) ? newV.thumbnail : (old.thumbnail || newV.thumbnail || ''),
            url: newV.url || old.url || ''
          };
        });
        
        const channelObj = {
          platform: 'instagram',
          handle,
          authorName: data.authorName || (idx !== -1 ? db.trackedChannels[idx].authorName : handle),
          avatar: data.avatar || (idx !== -1 ? db.trackedChannels[idx].avatar : 'https://cdn-icons-png.flaticon.com/512/1384/1384063.png'),
          subscriberCount: data.subscriberCount || (idx !== -1 ? db.trackedChannels[idx].subscriberCount : 'N/A'),
          videos: mergedVideos,
          lastSyncTime: new Date().toISOString()
        };
        
        if (idx !== -1) {
          db.trackedChannels[idx] = { ...db.trackedChannels[idx], ...channelObj };
        } else {
          db.trackedChannels.push(channelObj);
        }
        
        mergedVideos.forEach(v => {
          logVideoHistory(db, 'instagram', handle, v.videoId, v.views);
        });
        if (!writeDb(db)) throw new Error('Failed to save DB');
      });
      
      console.log(`[Sync-Bookmarklet] Saved ${mergedVideos.length} videos for @${handle}. Sample: title="${mergedVideos[0]?.title}", thumb=${mergedVideos[0]?.thumbnail ? 'YES' : 'NO'}`);
      
      res.send(`
        <html>
        <body style="background:#121212; color:#fff; font-family:sans-serif; text-align:center; padding-top:50px;">
          <h2 style="color:#00ffcc; margin-bottom:5px;">⚡ Sync Succeeded!</h2>
          <p style="margin:5px 0; font-size:14px;">Instagram metrics for @${safeHandle} updated successfully.</p>
          <p style="margin:5px 0; font-size:13px; color:#00ffcc;">${mergedVideos.length} Reels synced with real titles & thumbnails</p>
          <p style="color:#888; font-size:12px;">This tab will close automatically...</p>
          <script>
            setTimeout(() => { window.close(); }, 2000);
          </script>
        </body>
        </html>
      `);
    } else {
      res.send(`
        <html>
        <body style="background:#121212; color:#ff4a4a; font-family:sans-serif; text-align:center; padding-top:50px;">
          <h2>❌ Sync Failed</h2>
          <p>${escapeHtml(data.error) || 'Parsing returned zero posts.'}</p>
          <button onclick="window.close()" style="padding:8px 16px; background:#444; border:none; color:#fff; border-radius:4px; cursor:pointer;">Close Tab</button>
        </body>
        </html>
      `);
    }
  } catch (e) {
    res.send(`
      <html>
      <body style="background:#121212; color:#ff4a4a; font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>❌ Sync Error</h2>
        <p>${escapeHtml(e.message)}</p>
        <button onclick="window.close()" style="padding:8px 16px; background:#444; border:none; color:#fff; border-radius:4px; cursor:pointer;">Close Tab</button>
      </body>
      </html>
    `);
  }
});

// Background Auto-Sync loop (every 30 minutes)
let serverInstance;
setInterval(async () => {
  console.log("Running background auto-sync...");
  const channelsToSync = readDb().trackedChannels.map(c => ({platform: c.platform, handle: c.handle}));
  const currentPort = serverInstance ? serverInstance.address().port : PORT;
  
  for (const channel of channelsToSync) {
    if (channel.platform === 'youtube' || channel.platform === 'instagram') {
      try {
        const stillExists = readDb().trackedChannels.some(c => c.platform === channel.platform && c.handle === channel.handle);
        if (!stillExists) continue;

        console.log(`Auto-syncing ${channel.platform} handle @${channel.handle}...`);
        await axios.get(`http://127.0.0.1:${currentPort}/api/${channel.platform}/${channel.handle}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error("Auto-sync error for", channel.platform, channel.handle, e.message);
      }
    }
  }
  console.log("Background auto-sync pass completed.");
}, 60 * 60 * 1000); 

app.get('/api/proxy-image', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).send('Missing url parameter');
    }
    
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).send('Invalid url protocol');
    }
    try {
      const parsedUrl = new URL(targetUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      const allowedDomains = ['ytimg.com', 'instagram.com', 'fbcdn.net', 'buffer.com', 'unsplash.com', 'flaticon.com'];
      if (!allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
          return res.status(400).send('SSRF not allowed');
      }
    } catch (e) {
      return res.status(400).send('Invalid url format');
    }
    
    const response = await axios.get(targetUrl, {
      responseType: 'stream',
      timeout: 10000,
      maxContentLength: 10 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
        return res.status(400).send('Invalid content type');
    }
    
    // Pass along the content type
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    
    // Handle stream errors
    response.data.on('error', (err) => {
      console.error('Image proxy stream error:', err.message);
      if (!res.headersSent) res.status(500).send('Stream error');
    });

    // Destroy stream if the client disconnects early
    req.on('close', () => {
      response.data.destroy();
    });

    response.data.pipe(res);
  } catch (e) {
    // If the image fails to load, just send a 404
    res.status(404).send('Image not found');
  }
});

serverInstance = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Clipper Tracker server running at http://127.0.0.1:${PORT}`);
});
