const https = require('https');

const query = `
query {
    account {
    id
    organizations {
        id
        name
    }
    }
}
`;

const axios = require('axios');
const token = 'eKD3EP_nzrL4AyRXBGI2tMcz7nnGelQwND_xefw1yu0';

async function test() {
    try {
        const orgRes = await axios.post('https://api.buffer.com', { query }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const orgId = orgRes.data.data.account.organizations[0].id;
        
        const channelQuery = `
            query {
            channels(input: { organizationId: "${orgId}" }) {
                id
                service
                name
            }
            }
        `;
        const channelRes = await axios.post('https://api.buffer.com', { query: channelQuery }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log(JSON.stringify(channelRes.data, null, 2));
    } catch(e) {
        console.error(e);
    }
}
test();

const data = JSON.stringify({ query });

const options = {
  hostname: 'api.buffer.com',
  port: 443,
  path: '/',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer eKD3EP_nzrL4AyRXBGI2tMcz7nnGelQwND_xefw1yu0',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, res => {
  let resData = '';
  res.on('data', d => resData += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', JSON.stringify(JSON.parse(resData), null, 2));
  });
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
