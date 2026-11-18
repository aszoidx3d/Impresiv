const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1080, height: 1920 });
  await p.goto('file://' + process.cwd() + '/reel.html');
  const r = new PuppeteerScreenRecorder(p, {
    fps: 30,
    videoFrame: { width: 1080, height: 1920 },
    videoCodec: 'libx264',
    videoCrf: 23,
    aspectRatio: '9:16'
  });
  await r.start('reel.mp4');
  await new Promise(t => setTimeout(t, 12500));
  await r.stop();
  await b.close();
})();
