const axios = require('axios');
async function test() {
  try {
    const url = 'https://www.instagram.com/roamtech.en/';
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 5000
    });
    const html = res.data;
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    console.log('Avatar:', ogImageMatch ? ogImageMatch[1] : null);
    if (descMatch) {
        const followers = descMatch[1].match(/^([\d,.]+[KMB]?)\s+Followers/i);
        console.log('Followers:', followers ? followers[1] : null);
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
}
test();
