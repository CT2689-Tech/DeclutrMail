// node render.cjs  — renders every mock HTML to ../<name>.png and prints layout checks.
const { chromium } = require('/workspace/tools/pw/node_modules/playwright-core');
const path = require('path'),
  fs = require('fs');
const SRC = __dirname,
  OUT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  const only = process.argv.slice(2);
  const files = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith('.html') && (!only.length || only.includes(f)))
    .sort();
  for (const f of files) {
    const m = f.match(/(\d+)x(\d+)/);
    const [w, h] = m ? [+m[1], +m[2]] : f.startsWith('mobile') ? [390, 844] : [1280, 800];
    const p = await b.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: f.startsWith('share') ? 1 : 2,
    });
    await p.goto('file://' + path.join(SRC, f), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const info = await p.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return {
          top: Math.round(b.top),
          bottom: Math.round(b.bottom),
          left: Math.round(b.left),
          right: Math.round(b.right),
          h: Math.round(b.height),
        };
      };
      const fonts = {
        fraunces300: document.fonts.check('300 64px Fraunces'),
        geist: document.fonts.check('500 14px Geist'),
        mono: document.fonts.check('400 11px "Geist Mono"'),
      };
      const overflow = [];
      document.querySelectorAll('body *').forEach((e) => {
        if (e.closest('svg')) return;
        if (
          e.scrollWidth > e.clientWidth + 1 &&
          getComputedStyle(e).overflow !== 'hidden' &&
          e.clientWidth > 0
        )
          overflow.push(e.tagName + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
      });
      const cta = document.querySelector('#cta');
      const ctaWrap = cta
        ? cta.scrollWidth > cta.clientWidth || cta.getBoundingClientRect().height > 45
        : null;
      const tab = r('#tabbar');
      return {
        cta: r('#cta'),
        ctaClipped: ctaWrap,
        report: r('#report'),
        headline: r('#headline'),
        tabbarTop: tab && tab.top,
        safe: r('#safe'),
        fonts,
        overflow,
      };
    });
    await p.screenshot({ path: path.join(OUT, f.replace('.html', '.png')) });
    console.log(f, JSON.stringify(info));
    await p.close();
  }
  await b.close();
})();
