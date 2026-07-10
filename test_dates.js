const db = require('./data/db.json');
const axios = require('axios');
async function test() {
    try {
        const query = `query {
            posts(first: 5, input: {
                organizationId: "${db.settings.bufferOrgId}",
                filter: { status: [sent] }
            }) {
                edges {
                    node {
                        id
                        text
                        sentAt
                        createdAt
                        dueAt
                        updatedAt
                    }
                }
            }
        }`;
        const res = await axios.post('https://api.buffer.com', { query }, {
            headers: { 'Authorization': 'Bearer ' + db.settings.bufferToken }
        });
        console.log(JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error(e.message);
    }
}
test();
