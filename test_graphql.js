const axios = require('axios');
const token = 'W4TxAuytFBue7ZowCrboF5RtbAbE3LdTTZrWjKBX55w';
const orgQuery = 'query { account { organizations { id } } }';
axios.post('https://api.buffer.com/1/graphql', {query: orgQuery}, {headers: {Authorization: 'Bearer ' + token}})
  .then(orgRes => {
    const orgId = orgRes.data.data.account.organizations[0].id;
    const channelQuery = 'query { channels(input: { organizationId: "' + orgId + '" }) { id service name avatarUrl } }';
    return axios.post('https://api.buffer.com/1/graphql', {query: channelQuery}, {headers: {Authorization: 'Bearer ' + token}});
  })
  .then(res => console.log(JSON.stringify(res.data, null, 2)))
  .catch(e => console.error(e.response ? e.response.data : e.message));
