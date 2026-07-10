const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('https://youtube.com/shorts/EhnP9tcY3QE', { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const match = res.data.match(/"uploadDate":"(.*?)"/);
        console.log('uploadDate:', match ? match[1] : 'not found');
        const match2 = res.data.match(/datePublished/);
        console.log('datePublished exists:', !!match2);
    } catch(e) {
        console.error(e.message);
    }
}
test();
