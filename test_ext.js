const puppeteer=require('puppeteer'); 
const path=require('path'); 
async function test(){
  try{
    console.log('launching'); 
    const browser=await puppeteer.launch({
      headless:false, 
      args:['--disable-extensions-except=' + path.resolve('extension'), '--load-extension=' + path.resolve('extension')]
    }); 
    const page=await browser.newPage(); 
    page.on('console', msg => console.log('PAGE LOG:', msg.text())); 
    await page.goto('http://localhost:3000'); 
    await page.evaluate(()=>{ 
      window.addEventListener('ClipperTrackerSyncIGResult', (e)=>console.log('Result:', JSON.stringify(e.detail))); 
      window.dispatchEvent(new CustomEvent('ClipperTrackerSyncIG', {detail:{handle:'founderbusinesstech'}})); 
    }); 
    await new Promise(r=>setTimeout(r, 5000)); 
    await browser.close();
  }catch(e){
    console.log(e);
  }
} 
test();
