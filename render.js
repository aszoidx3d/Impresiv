const fs = require('fs'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

const FPS = 30, W = 1080, H = 1920;
const LEAD = 0.5, GAP = 0.45, MIN_TOTAL = 31, MAX_TOTAL = 88;
const VOICE = process.env.VOICE || 'en-US-AndrewNeural';
const sh = (c, a) => execFileSync(c, a, { stdio: 'inherit' });

function parseScenes(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let a = JSON.parse(s);
  if (!Array.isArray(a) && a.scenes) a = a.scenes;
  return a.filter(x => x && x.narration).slice(0, 10);
}
function dur(f) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString());
}
function tts(text, out, i) {
  const txt = path.join('work', `s${i}.txt`);
  fs.writeFileSync(txt, text);
  const r = spawnSync('python3', ['-m', 'edge_tts', '--voice', VOICE, '--rate=+4%', '--file', txt, '--write-media', out], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 1000) {
    console.log('edge-tts failed, falling back to espeak-ng for scene', i);
    const wav = out.replace('.mp3', '.wav');
    sh('espeak-ng', ['-v', 'en-us', '-s', '165', '-f', txt, '-w', wav]);
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, out]);
  }
}

(async () => {
  fs.rmSync('work', { recursive: true, force: true });
  fs.rmSync('frames', { recursive: true, force: true });
  fs.mkdirSync('work'); fs.mkdirSync('frames');

  const scenes = parseScenes(process.env.SCENES);
  scenes.push({
    headline: 'Follow for daily tech',
    points: ['Hardware', 'Software', 'AI breakthroughs'],
    icon: 'bolt',
    narration: 'Follow for daily tech news on hardware, software, and A I breakthroughs.'
  });
  const topic = (process.env.TOPIC || 'TECH DAILY').slice(0, 40);

  scenes.forEach((s, i) => {
    s.audio = path.join('work', `v${i}.mp3`);
    tts(s.narration, s.audio, i);
  });

  let t = LEAD;
  scenes.forEach(s => { s.start = t; s.dur = dur(s.audio); t += s.dur + GAP; });
  let total = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, t + 0.8));
  console.log('scenes', scenes.length, 'total seconds', total.toFixed(1));

  // sound effects + music (synthesized, no downloads)
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=0.7:c=pink:r=44100:a=0.6',
    '-af', 'highpass=f=300,lowpass=f=6000,afade=t=in:d=0.3,afade=t=out:st=0.35:d=0.35', 'work/whoosh.wav']);
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=55:duration=0.7:sample_rate=44100',
    '-af', 'afade=t=out:st=0.05:d=0.65,volume=2.2', 'work/hit.wav']);

  const args = ['-y', '-loglevel', 'error'];
  [98, 147, 196].forEach(f => args.push('-f', 'lavfi', '-t', String(total), '-i', `sine=frequency=${f}:sample_rate=44100`));
  args.push('-i', 'work/whoosh.wav', '-i', 'work/hit.wav');
  scenes.forEach(s => args.push('-i', s.audio));
  const N = scenes.length;
  const f = [];
  f.push(`[0:a][1:a][2:a]amix=inputs=3:normalize=0,volume=0.07,tremolo=f=0.25:d=0.5,lowpass=f=900,afade=t=in:d=1,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[music]`);
  f.push(`[3:a]asplit=${N}${scenes.map((_, i) => `[w${i}]`).join('')}`);
  const mix = ['[music]'];
  scenes.forEach((s, i) => {
    const ms = Math.round(s.start * 1000);
    f.push(`[w${i}]adelay=${ms}|${ms},volume=0.5[sx${i}]`);
    f.push(`[${5 + i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=1.5[vo${i}]`);
    mix.push(`[sx${i}]`, `[vo${i}]`);
  });
  f.push(`[4:a]adelay=0|0,volume=0.8[hit]`); mix.push('[hit]');
  f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0,alimiter=limit=0.95,atrim=0:${total.toFixed(2)}[aout]`);
  args.push('-filter_complex', f.join(';'), '-map', '[aout]', '-ar', '44100', 'work/mix.wav');
  sh('ffmpeg', args);

  // frames
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve('template.html'));
  await page.evaluate(d => window.init(d), { scenes: scenes.map(({ headline, points, icon, narration, start, dur }) => ({ headline, points, icon, narration, start, dur })), total, topic });
  const frames = Math.ceil(total * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(x => window.setTime(x), i / FPS);
    await page.screenshot({ path: `frames/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 85 });
  }
  await browser.close();

  sh('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', 'frames/%05d.jpg', '-i', 'work/mix.wav',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', 'reel.mp4']);
  console.log('done reel.mp4');
})().catch(e => { console.error(e); process.exit(1); });
