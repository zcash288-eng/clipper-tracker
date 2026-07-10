const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igChannel = db.trackedChannels.find(c => c.platform === 'instagram');
const html = igChannel.subscriberCount;

console.log("Searching for keywords...");

// Let's check if 'shortcode' exists in HTML
const hasShortcode = html.includes('shortcode');
console.log("Contains 'shortcode'?:", hasShortcode);

// Let's check if 'reels' or 'video' or titles exist in HTML
const hasVideoViewCount = html.includes('video_view_count');
console.log("Contains 'video_view_count'?:", hasVideoViewCount);

const hasPlayCount = html.includes('play_count');
console.log("Contains 'play_count'?:", hasPlayCount);

const hasMedia = html.includes('media');
console.log("Contains 'media'?:", html.includes('media'));

// Let's print out all matches of any string matching a reel link like instagram.com/p/ or instagram.com/reel/
const reelLinks = [];
const linkRegex = /\/(p|reel)\/([a-zA-Z0-9_-]+)/g;
let match;
while ((match = linkRegex.exec(html)) !== null && reelLinks.length < 20) {
    reelLinks.push(match[0]);
}
console.log("Found links in HTML:", [...new Set(reelLinks)]);

// Let's find occurrences of JSON-like structures that might contain node data.
// Search for text around any shortcodes we found in links
if (reelLinks.length > 0) {
    const code = reelLinks[0].split('/')[2];
    console.log(`Searching context around shortcode: ${code}...`);
    const idx = html.indexOf(code);
    if (idx !== -1) {
        console.log("Context snippet:");
        console.log(html.slice(Math.max(0, idx - 300), Math.min(html.length, idx + 500)));
    }
}
