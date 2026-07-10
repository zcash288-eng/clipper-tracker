const fs = require('fs');
const db = require('./data/db.json');
const axios = require('axios');
async function fixIgAvatars() {
    const q = `query { channels(input: { organizationId: "${db.settings.bufferOrgId}" }) { id service name avatar } }`;
    const r = await axios.post('https://api.buffer.com', { query: q }, { headers: { 'Authorization': 'Bearer ' + db.settings.bufferToken } });
    const channels = r.data.data.channels;
    let changed = false;
    db.trackedChannels.forEach(c => {
        if (c.platform === 'instagram') {
            const match = channels.find(ch => ch.service === 'instagram' && ch.name === c.handle);
            if (match && match.avatar && c.avatar !== match.avatar) {
                c.avatar = match.avatar;
                console.log('Updated avatar for', c.handle);
                changed = true;
            }
        }
    });
    if (changed) {
        fs.writeFileSync('./data/db.json', JSON.stringify(db, null, 2));
        console.log('db.json saved.');
    } else {
        console.log('No avatars needed updating.');
    }
}
fixIgAvatars();
