const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igChannel = db.trackedChannels.find(c => c.platform === 'instagram');
const html = igChannel.subscriberCount;

console.log("Searching for block signals in pasted HTML...");
const keywords = ['login', 'signup', 'challenge', 'checkpoint', 'robot', 'captcha', 'security', 'verify', 'block', 'suspicious'];
keywords.forEach(kw => {
    console.log(`Contains '${kw}'?: ${html.toLowerCase().includes(kw)}`);
});

// Let's print out the title and description tag again to verify what the page claims to be
const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
console.log("Title tag:", titleMatch ? titleMatch[1] : "NONE");
