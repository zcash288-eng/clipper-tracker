const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('https://www.instagram.com/founderbusinesstech/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const r = await p.evaluate(async () => {
    const reel = document.querySelector('a[href*="/reel/"]');
    if (!reel) return 'No reel found';

    // Hover the reel to force it to render the views!
    const ev = new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true });
    reel.dispatchEvent(ev);

    return new Promise(resolve => {
      setTimeout(() => {
        resolve(reel.innerHTML);
      }, 1000);
    });
  });

  console.log('Reel innerHTML after hover:');
  console.log(r);
  
  await b.close();
})();
