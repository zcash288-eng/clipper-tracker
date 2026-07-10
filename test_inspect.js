const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch({ headless: false });
  const p = await b.newPage();
  await p.goto('https://www.instagram.com/founderbusinesstech/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const r = await p.evaluate(() => {
    const meta = document.querySelector('meta[name="description"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');

    // Check follower links
    const followerLinks = document.querySelectorAll('a[href*="followers"]');
    let followerInfo = [];
    for (const fl of followerLinks) {
      followerInfo.push({
        title: fl.getAttribute('title'),
        text: fl.textContent.trim().substring(0, 100),
        spanText: fl.querySelector('span')?.textContent?.trim(),
        spanTitle: fl.querySelector('span')?.getAttribute('title')
      });
    }

    // Check header stats (ul li elements)
    const stats = document.querySelectorAll('header section ul li');
    let statTexts = [];
    for (const s of stats) {
      statTexts.push(s.textContent.trim());
    }

    // Check first reel link structure
    const firstReel = document.querySelector('a[href*="/reel/"]');
    let reelDetails = null;
    if (firstReel) {
      // Get all child elements
      const allSpans = firstReel.querySelectorAll('span');
      const spanTexts = [];
      for (const sp of allSpans) {
        spanTexts.push(sp.textContent.trim());
      }
      
      // Check for SVG (play icon)
      const svgs = firstReel.querySelectorAll('svg');
      
      // Check for aria-labels
      const allEls = firstReel.querySelectorAll('*');
      const ariaLabels = [];
      for (const el of allEls) {
        const al = el.getAttribute('aria-label');
        if (al) ariaLabels.push(al);
      }

      reelDetails = {
        spanTexts,
        svgCount: svgs.length,
        ariaLabels,
        innerHTML: firstReel.innerHTML.substring(0, 800)
      };
    }

    return {
      metaDesc: meta?.getAttribute('content'),
      ogDesc: ogDesc?.getAttribute('content'),
      followerInfo,
      statTexts,
      reelDetails
    };
  });

  console.log('=== META ===');
  console.log('meta desc:', r.metaDesc);
  console.log('og desc:', r.ogDesc);
  console.log('\n=== FOLLOWERS ===');
  console.log('follower links:', JSON.stringify(r.followerInfo, null, 2));
  console.log('stat texts:', r.statTexts);
  console.log('\n=== REEL STRUCTURE ===');
  console.log('reel details:', JSON.stringify(r.reelDetails, null, 2));

  await b.close();
})();
