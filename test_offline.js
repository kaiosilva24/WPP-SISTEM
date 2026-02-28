const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://echo.websocket.org', { waitUntil: 'networkidle2' });

    console.log('Page loaded. Creating websocket...');
    await page.evaluate(() => {
        window.ws = new WebSocket('wss://echo.websocket.org');
        window.ws.onopen = () => console.log('WS OPEN');
        window.ws.onclose = () => console.log('WS CLOSE');
        window.ws.onerror = (e) => console.log('WS ERROR');
    });

    await new Promise(r => setTimeout(r, 2000));

    console.log('Setting offline mode...');
    await page.setOfflineMode(true);

    await new Promise(r => setTimeout(r, 2000));

    console.log('Setting online mode...');
    await page.setOfflineMode(false);

    await new Promise(r => setTimeout(r, 2000));
    console.log('Test complete');

    await browser.close();
})();
