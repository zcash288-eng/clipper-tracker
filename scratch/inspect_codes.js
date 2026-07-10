const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const igChannel = db.trackedChannels.find(c => c.platform === 'instagram');
const html = igChannel.subscriberCount;

console.log("Searching for \"code\" in HTML...");
let idx = 0;
let occurrence = 0;
// We look for \"code\":\" or "code":"
while ((idx = html.indexOf('"code"', idx)) !== -1 && occurrence < 10) {
    occurrence++;
    console.log(`\n--- Occurrence ${occurrence} at index ${idx} ---`);
    console.log(html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 200)));
    idx += '"code"'.length;
}

idx = 0;
let occurrenceEscaped = 0;
while ((idx = html.indexOf('\\"code\\"', idx)) !== -1 && occurrenceEscaped < 10) {
    occurrenceEscaped++;
    console.log(`\n--- Escaped Occurrence ${occurrenceEscaped} at index ${idx} ---`);
    console.log(html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 200)));
    idx += '\\"code\\"'.length;
}

console.log(`Totals: literal = ${occurrence}, escaped = ${occurrenceEscaped}`);
