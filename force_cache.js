const fs = require('fs');
const dbPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\data\\db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const idx = db.trackedChannels.findIndex(c => c.platform === 'youtube' && c.handle.toLowerCase() === 'founderbusinesstech');
if (idx !== -1) {
  if (!db.trackedChannels[idx].avatar.includes('?v=')) {
    db.trackedChannels[idx].avatar = db.trackedChannels[idx].avatar + '?v=1';
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log('Appended ?v=1 to bypass cache');
  } else {
    console.log('Already has ?v=1');
  }
}
