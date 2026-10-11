// node render.cjs [file.html ...] — renders mocks to ../<name>.png and prints layout checks.
const { chromium } = require('/workspace/tools/pw/node_modules/playwright-core');
const path = require('path'), fs = require('fs');
const SRC = __dirname, OUT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const only = process.argv.slice(2);
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.html') && (!only.length || only.includes(f))).sort();
  for (const f of files) {
    const mobile = f.includes('mobile');
    const [w, h] = mobile ? [390, 844] : [1440, 900];
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1 });
    await p.goto('file://' + path.join(SRC, f), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const info = await p.evaluate(() => {
      const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      const fonts = ['300 64px Fraunces', '400 32px Fraunces', '600 14px Geist', '400 11px "Geist Mono"'].every(s => document.fonts.check(s));
      const overflow = [];
      document.querySelectorAll('body *').forEach(e => { if (e.closest('svg')) return; if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && getComputedStyle(e).overflow !== 'hidden') overflow.push((e.className || e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth); });
      // content cut off by the main scroll area / page bottom (desktop)
      const main = document.querySelector('.p-scroll, .s-main');
      const tab = document.querySelector('#tabbar');
      const prim = document.querySelector('[data-primary]');
      return { fonts, primary: box(prim), tabbarTop: tab ? Math.round(tab.getBoundingClientRect().top) : null, overflow };
    });
    await p.screenshot({ path: path.join(OUT, f.replace('.html', '.png')) });
    const fold = info.tabbarTop && info.primary ? (info.primary.bottom <= info.tabbarTop ? 'ABOVE' : 'BELOW') : '';
    console.log(f.padEnd(44), 'fonts', info.fonts, 'primary', JSON.stringify(info.primary), fold, info.overflow.length ? JSON.stringify(info.overflow) : '');
    await p.close();
  }
  await b.close();
})();
