const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--disable-extensions-except=' + path.resolve('extension'), '--load-extension=' + path.resolve('extension')]
  });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/founderbusinesstech/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const result = await page.evaluate(() => {
    const profileData = { authorName: '', avatar: '', followersCount: '' };

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const content = ogTitle.getAttribute('content');
      const nameMatch = content.match(/^(.+?)\s*\(/);
      if (nameMatch) profileData.authorName = nameMatch[1].trim();
    }

    const headerSection = document.querySelector('header section');
    if (headerSection) {
      const profileImg = headerSection.querySelector('img');
      if (profileImg) profileData.avatar = profileImg.src;
    }

    const statItems = document.querySelectorAll('header section ul li');
    for (const li of statItems) {
      const text = li.textContent.trim().toLowerCase();
      if (text.includes('follower')) {
        profileData.followersCount = li.textContent.trim();
        break;
      }
    }

    const reels = [];
    const reelLinks = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
    for (const link of reelLinks) {
      const href = link.getAttribute('href');
      const m = href.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
      if (!m) continue;
      if (reels.some(r => r.shortcode === m[2])) continue;
      let thumbnail = '', title = 'Instagram Reel';
      const img = link.querySelector('img');
      if (img) {
        thumbnail = img.src;
        const alt = img.getAttribute('alt');
        if (alt && alt.length > 5) title = alt.length > 100 ? alt.substring(0, 100) + '...' : alt;
      }
      reels.push({ shortcode: m[2], thumbnail, title, viewCount: '0', url: 'https://www.instagram.com' + href });
    }
    return { profileData, reels };
  });

  console.log('=== PROFILE ===');
  console.log('Name:', result.profileData.authorName);
  console.log('Followers:', result.profileData.followersCount);
  console.log('Avatar:', result.profileData.avatar ? 'YES' : 'NO');
  console.log('\n=== REELS (' + result.reels.length + ') ===');
  result.reels.forEach((r, i) => {
    console.log(`${i+1}. [${r.shortcode}] "${r.title.substring(0, 60)}..." thumb:${r.thumbnail ? 'yes' : 'no'}`);
  });

  // Send to backend
  const axios = require('axios');
  const resp = await axios.post('http://localhost:3000/api/instagram/save-scraped-data', {
    handle: 'founderbusinesstech',
    profileData: result.profileData,
    reels: result.reels,
    cookies: ''
  });
  console.log('\nBackend:', JSON.stringify(resp.data));

  await browser.close();
})();
