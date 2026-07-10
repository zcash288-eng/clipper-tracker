const db = require('./data/db.json');
const axios = require('axios');
async function test() {
    const q = `query { channels(input: { organizationId: "${db.settings.bufferOrgId}" }) { id service name avatar } }`;
    const r = await axios.post('https://api.buffer.com', { query: q }, { headers: { 'Authorization': 'Bearer ' + db.settings.bufferToken } });
    console.log(JSON.stringify(r.data, null, 2));
}
test();
