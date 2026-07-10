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
  
  // Navigate to an Instagram profile
  console.log('Navigating to Instagram profile...');
  await page.goto('https://www.instagram.com/founderbusinesstech/', { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Wait for the page to fully load
  await new Promise(r => setTimeout(r, 5000));
  
  // Now run the same DOM scraping function that our extension would run
  console.log('Scraping DOM...');
  const result = await page.evaluate(() => {
    const reels = [];
    
    // Find all reel/post links
    const reelLinks = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
    console.log('Found ' + reelLinks.length + ' reel/post links');
    
    for (const link of reelLinks) {
      const href = link.getAttribute('href');
      const shortcodeMatch = href.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
      if (!shortcodeMatch) continue;
      
      const shortcode = shortcodeMatch[2];
      if (reels.some(r => r.shortcode === shortcode)) continue;
      
      let thumbnail = '';
      const img = link.querySelector('img');
      if (img) thumbnail = img.src;
      
      let viewCount = '0';
      const viewSpans = link.querySelectorAll('span');
      for (const span of viewSpans) {
        const text = span.textContent.trim();
        if (/^[\d,.]+[KMB]?$/i.test(text)) {
          viewCount = text;
          break;
        }
      }
      
      reels.push({
        shortcode,
        isReel: shortcodeMatch[1] === 'reel',
        thumbnail,
        viewCount,
        url: 'https://www.instagram.com' + href
      });
    }
    
    // Profile data
    const metaDesc = document.querySelector('meta[property="og:title"]');
    let authorName = '';
    if (metaDesc) {
      const content = metaDesc.getAttribute('content');
      const nameMatch = content.match(/^(.+?)\s*\(/);
      if (nameMatch) authorName = nameMatch[1].trim();
    }
    
    const profileImg = document.querySelector('header img');
    const avatar = profileImg ? profileImg.src : '';
    
    return {
      reels,
      authorName,
      avatar,
      pageTitle: document.title,
      allAnchorCount: document.querySelectorAll('a').length,
      reelLinksCount: reelLinks.length
    };
  });
  
  console.log('\n=== RESULTS ===');
  console.log('Page title:', result.pageTitle);
  console.log('Author name:', result.authorName);
  console.log('Avatar:', result.avatar ? 'found' : 'not found');
  console.log('Total anchors on page:', result.allAnchorCount);
  console.log('Reel/post links found:', result.reelLinksCount);
  console.log('Unique reels scraped:', result.reels.length);
  
  if (result.reels.length > 0) {
    console.log('\nFirst 3 reels:');
    for (const r of result.reels.slice(0, 3)) {
      console.log(`  - ${r.shortcode} (${r.isReel ? 'reel' : 'post'}) views:${r.viewCount} thumb:${r.thumbnail ? 'yes' : 'no'}`);
    }
  }
  
  await browser.close();
  console.log('\nDone!');
}

test().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
