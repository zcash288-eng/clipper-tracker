const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igChannel = db.trackedChannels.find(c => c.platform === 'instagram');
const html = igChannel.subscriberCount;

console.log("Locating 'shortcode' index...");
let idx = 0;
let occurrence = 0;
while ((idx = html.indexOf('shortcode', idx)) !== -1 && occurrence < 3) {
    occurrence++;
    console.log(`\n--- Occurrence ${occurrence} at index ${idx} ---`);
    console.log(html.slice(Math.max(0, idx - 150), Math.min(html.length, idx + 400)));
    idx += 'shortcode'.length;
}
