const axios = require('axios');
const token = 'W4TxAuytFBue7ZowCrboF5RtbAbE3LdTTZrWjKBX55w';
async function test() {
  try {
    const res = await axios.post('https://api.buffer.com', { query: '{ account { organizations { id } } }' }, { headers: { Authorization: 'Bearer ' + token } });
    const orgId = res.data.data.account.organizations[0].id;
    const chanRes = await axios.post('https://api.buffer.com', { query: '{ channels(input: { organizationId: "' + orgId + '" }) { id service name } }' }, { headers: { Authorization: 'Bearer ' + token } });
    const channels = chanRes.data.data.channels;
    const igChan = channels.find(c => c.service === 'instagram');
    const postQ = 'query { posts(first: 5, input: { organizationId: "' + orgId + '", filter: { status: [sent], channelIds: ["' + igChan.id + '"] } }) { edges { node { id text metrics { name value } } } } }';
    const postRes = await axios.post('https://api.buffer.com', { query: postQ }, { headers: { Authorization: 'Bearer ' + token } });
    console.log(JSON.stringify(postRes.data.data.posts.edges, null, 2));
  } catch(e) {}
}
test();
