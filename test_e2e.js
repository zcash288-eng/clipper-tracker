const puppeteer = require('puppeteer');
const path = require('path');

async function test() {
  console.log('Launching browser with extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--disable-extensions-except=' + path.resolve('extension'),
      '--load-extension=' + path.resolve('extension'),
      '--no-sandbox'
    ]
  });
  
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE:', msg.text()));
  
  console.log('Navigating to Instagram profile...');
  await page.goto('https://www.instagram.com/founderbusinesstech/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  
  // Run the exact same scraping function from our extension
  console.log('Running full scrape...');
  const result = await page.evaluate(() => {
    // Same as scrapeProfileFromDOM in background.js
    const profileData = { authorName: '', avatar: '', followersCount: '' };
    
    const metaDesc = document.querySelector('meta[property="og:title"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute('content');
      const nameMatch = content.match(/^(.+?)\s*\(/);
      if (nameMatch) profileData.authorName = nameMatch[1].trim();
    }
    
    const headerSection = document.querySelector('header section');
    if (headerSection) {
      const profileImg = headerSection.querySelector('img');
      if (profileImg) profileData.avatar = profileImg.src;
    }
    
    const statLinks = document.querySelectorAll('header section ul li');
    if (statLinks.length >= 2) {
      const followersEl = statLinks[1];
      const followersSpan = followersEl.querySelector('span span') || followersEl.querySelector('span');
      if (followersSpan) profileData.followersCount = followersSpan.textContent.trim() + ' followers';
    }
    
    if (!profileData.followersCount) {
      const allLinks = document.querySelectorAll('a[href*="followers"]');
      for (const link of allLinks) {
        const titleAttr = link.getAttribute('title');
        if (titleAttr) { profileData.followersCount = titleAttr + ' followers'; break; }
        const spanInLink = link.querySelector('span');
        if (spanInLink) { profileData.followersCount = spanInLink.textContent.trim() + ' followers'; break; }
      }
    }
    
    const reels = [];
    const reelLinks = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
    for (const link of reelLinks) {
      const href = link.getAttribute('href');
      const shortcodeMatch = href.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
      if (!shortcodeMatch) continue;
      const shortcode = shortcodeMatch[2];
      if (reels.some(r => r.shortcode === shortcode)) continue;
      let thumbnail = '';
      const img = link.querySelector('img');
      if (img) thumbnail = img.src;
      reels.push({
        shortcode,
        isReel: shortcodeMatch[1] === 'reel',
        thumbnail,
        viewCount: '0',
        url: 'https://www.instagram.com' + href
      });
    }
    
    return { profileData, reels };
  });
  
  console.log(`Scraped: ${result.reels.length} reels`);
  console.log(`Profile: ${result.profileData.authorName}, followers: ${result.profileData.followersCount}`);
  
  // Now send to our backend
  console.log('Sending to backend...');
  const response = await page.evaluate(async (data) => {
    const res = await fetch('http://localhost:3000/api/instagram/save-scraped-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'founderbusinesstech',
        profileData: data.profileData,
        reels: data.reels,
        cookies: document.cookie
      })
    });
    return res.json();
  }, result);
  
  console.log('Backend response:', JSON.stringify(response));
  
  await browser.close();
  console.log('Done!');
}

test().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
