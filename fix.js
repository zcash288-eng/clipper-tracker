const fs = require('fs');
const axios = require('axios');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'scratch', 'clipper-tracker', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

async function fixDates() {
    let updated = false;
    for (const channel of db.trackedChannels) {
        if (channel.platform === 'youtube') {
            for (const video of channel.videos) {
                if (!video.publishedAt) {
                    try {
                        console.log(`Fixing date for ${video.videoId}...`);
                        const url = `https://www.youtube.com/shorts/${video.videoId}`;
                        const res = await axios.get(url, {
                            headers: { 'User-Agent': 'Mozilla/5.0' },
                            timeout: 5000
                        });
                        const match = res.data.match(/<meta itemprop="datePublished" content="([^"]+)"/);
                        const match2 = res.data.match(/"publishDate":\{"simpleText":"([^"]+)"\}/);
                        if (match) {
                            video.publishedAt = match[1];
                            console.log(`   -> ${match[1]}`);
                            updated = true;
                        } else if (match2) {
                            video.publishedAt = new Date(match2[1]).toISOString();
                            console.log(`   -> ${video.publishedAt}`);
                            updated = true;
                        } else {
                            console.log(`   -> Not found in HTML.`);
                        }
                    } catch (e) {
                        console.error(`   -> Failed to fetch: ${e.message}`);
                    }
                }
            }
        }
    }
    
    if (updated) {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
        console.log('Database repaired successfully.');
    } else {
        console.log('No repairs needed or made.');
    }
}

fixDates();
