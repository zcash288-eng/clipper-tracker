const fs = require('fs');
const db = require('./data/db.json');
const axios = require('axios');

async function fixDb() {
    try {
        let fixed = 0;
        for (const channel of db.trackedChannels) {
            for (const v of channel.videos) {
                if (!v.publishedAt && v.url && v.url.includes('youtube.com')) {
                    console.log('Fetching date for', v.url);
                    try {
                        const res = await axios.get(v.url, {
                            headers: { 'User-Agent': 'Mozilla/5.0' },
                            timeout: 5000
                        });
                        const match = res.data.match(/"uploadDate":"(.*?)"/);
                        if (match) {
                            v.publishedAt = new Date(match[1]).toISOString();
                            console.log('Fixed:', v.title, '->', v.publishedAt);
                            fixed++;
                        } else {
                            // try datePublished
                            const match2 = res.data.match(/<meta itemprop="datePublished" content="(.*?)"/);
                            if (match2) {
                                v.publishedAt = new Date(match2[1]).toISOString();
                                console.log('Fixed:', v.title, '->', v.publishedAt);
                                fixed++;
                            } else {
                                console.log('Could not find date for', v.url);
                            }
                        }
                    } catch(e) {
                        console.error('Error fetching', v.url, e.message);
                    }
                    // wait a bit to avoid rate limiting
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }
        
        if (fixed > 0) {
            fs.writeFileSync('./data/db.json', JSON.stringify(db, null, 2));
            console.log(`Done! Fixed ${fixed} missing dates.`);
        } else {
            console.log('No missing YouTube dates found.');
        }
    } catch(e) {
        console.error(e.message);
    }
}
fixDb();
