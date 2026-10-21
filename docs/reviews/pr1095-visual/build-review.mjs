import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? './downloaded-evidence');
const out = resolve(process.argv[3] ?? './pr1095-before-after');
const scenarios = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(here, 'catalog-diff.json'), 'utf8'));
const files = JSON.parse(readFileSync(join(here, 'file-coverage.json'), 'utf8'));
const refs = {
  before: 'c1653a29e3e01cb489b68610bb9b2daa48404d04',
  rejected: '00c2d24215b458c71b3bbf564b82ea88332de76c',
  after: 'a7464ac4820bd00df215622bb972e7d2ec5120d5',
};
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const records = new Map();
const images = {};
mkdirSync(out, { recursive: true });
for (const path of walk(input).filter((path) => /^manifest-.+\.json$/.test(basename(path)))) {
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (refs[record.sourceLabel] !== record.sourceSha)
    throw new Error(`Unexpected source identity: ${path}`);
  if (record.errors.length) throw new Error(`Capture errors: ${path}: ${record.errors.join('; ')}`);
  if (!record.checkpoints.some((point) => point.stage === 'final'))
    throw new Error(`Missing final checkpoint: ${path}`);
  const key = `${record.caseId}:${record.width}:${record.sourceLabel}`;
  if (records.has(key)) throw new Error(`Duplicate capture: ${key}`);
  const assetDir = join(out, 'captures', record.sourceLabel);
  mkdirSync(assetDir, { recursive: true });
  for (const point of record.checkpoints) {
    const original = join(dirname(path), point.image);
    if (!existsSync(original)) throw new Error(`Missing screenshot: ${original}`);
    const imageKey = `${record.sourceLabel}/${point.image}`;
    images[imageKey] = `data:image/png;base64,${readFileSync(original).toString('base64')}`;
    cpSync(original, join(assetDir, point.image));
    point.imageKey = imageKey;
  }
  cpSync(path, join(assetDir, basename(path)));
  records.set(key, record);
}
const expected = scenarios.reduce(
  (count, scenario) => count + (scenario.widths ?? [1280]).length,
  0,
);
for (const sourceLabel of Object.keys(refs)) {
  const found = [...records.values()].filter((record) => record.sourceLabel === sourceLabel).length;
  if (found !== expected)
    throw new Error(`${sourceLabel}: expected ${expected} cases/viewports, found ${found}`);
}
const cases = scenarios.map((scenario) => ({
  ...scenario,
  captures: (scenario.widths ?? [1280]).map((width) => ({
    width,
    sources: Object.fromEntries(
      Object.keys(refs).map((sourceLabel) => {
        const key = `${scenario.id}:${width}:${sourceLabel}`;
        if (!records.has(key)) throw new Error(`Missing scenario capture ${key}`);
        return [sourceLabel, records.get(key)];
      }),
    ),
  })),
}));
const data = {
  refs,
  cases,
  catalog,
  files,
  images,
  expected,
  screenshotCount: Object.keys(images).length,
  builtAt: new Date().toISOString(),
  limitations: [
    'These screenshots render real production components, copy and CSS from each pinned source commit, with the same synthetic fixture data, locale and fixed clock. They are component evidence, not signed-in Vercel or Gmail screenshots.',
    'All provider/API requests are blocked. Confirmation callbacks, if used, are local synthetic callbacks. No Gmail, unsubscribe delivery, billing or database mutation is exercised.',
    'Triage parent-screen behavior such as when archived reach is exposed and which request is dispatched is covered by the existing screen/store integration regressions and source review. A supplied ActionSheet prop is not proof of the parent screen supplying it.',
    'The after source is the actual PR head. The PR merges cleanly with the pinned main baseline, preserving #1076/#1077. This pack does not merge, queue or deploy either branch.',
  ],
};
writeFileSync(
  join(out, 'coverage.json'),
  JSON.stringify({ ...data, images: undefined }, null, 2) + '\n',
);
const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR 1095 — before and after review</title>
<style>
:root{font-family:system-ui,sans-serif;color:#172b2a;background:#f2f5f3;font-size:15px}*{box-sizing:border-box}body{margin:0}a{color:#126d59}button,input,select{font:inherit}header{padding:28px 5vw;background:#143e36;color:white}header h1{font-size:30px;margin:0 0 10px}header p{max-width:980px;line-height:1.5}header a{color:#a9ecdb}.metrics{display:flex;gap:20px;flex-wrap:wrap;font-size:14px}.toolbar{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #d8e2dc;padding:12px 5vw;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.toolbar label{display:flex;gap:6px;align-items:center}.toolbar input,.toolbar select{max-width:100%;padding:8px;border:1px solid #a8bdb2;border-radius:6px}.toolbar input{width:220px}main{max-width:1500px;margin:auto;padding:20px 3vw 60px}.intro,.card,.appendix{background:white;border:1px solid #d9e4dd;border-radius:12px;padding:20px;margin-bottom:22px}.intro p{line-height:1.5}.card{scroll-margin-top:100px}.card h2{font-size:22px;margin:4px 0 12px}.case-top{display:flex;gap:15px;justify-content:space-between;align-items:flex-start}.eyebrow{font-size:12px;color:#506b61;text-transform:uppercase;letter-spacing:.06em}.check{padding:12px 14px;background:#eef7f1;border-left:3px solid #42977d;line-height:1.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:15px}.shot{min-width:0;background:#f6f8f6;border:1px solid #dfe6e0;border-radius:8px;padding:12px}.shot h3{font-size:15px;margin:0 0 4px}.sha{font-size:12px;font-family:ui-monospace,monospace;color:#64776c}.shot img{display:block;max-width:100%;max-height:720px;width:auto;height:auto;margin:12px auto 0;cursor:zoom-in;border:1px solid #d7e1da}.capture-options{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:13px}.capture-options select{padding:6px}.badge{font-size:12px;padding:3px 8px;border-radius:20px;background:#edf2ef;color:#466559}.rejected{background:#fff0d6;color:#735209}.caption{font-size:12px;color:#586e63;line-height:1.5}details{margin-top:15px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5;background:#f6f8f6;padding:12px;border-radius:6px}.text-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #dde7e0;overflow-wrap:anywhere}.reviewed{opacity:.72}.reviewed h2:after{content:' ✓';color:#168060}.empty{padding:25px}dialog{max-width:96vw;max-height:96vh;border:0;border-radius:12px;padding:14px;background:#f3f5f3}dialog::backdrop{background:#000a}dialog img{max-width:90vw;max-height:84vh;display:block;object-fit:contain}dialog button{margin-bottom:8px}footer{font-size:13px;color:#5d7367;padding:20px 0}.actions{line-height:1.6;font-size:13px}.actions code{font-size:12px}.file{font-family:ui-monospace,monospace}.count{margin-left:auto;font-size:13px;color:#49665a}@media(max-width:760px){.pair,.text-pair{grid-template-columns:1fr}.toolbar{position:static}.card{padding:14px}header h1{font-size:25px}.count{margin-left:0}main{padding:12px}.shot img{max-height:none}}@media print{header,.toolbar,.intro,.appendix,footer,.capture-options,details,.check-reviewed{display:none}.card{break-before:page;border:0;padding:0}.pair{grid-template-columns:1fr 1fr}.shot img{max-height:70vh}.card h2{font-size:18px}.check{font-size:11px}}
</style>
<header><div class="eyebrow" style="color:#b8d4c9">DeclutrMail · PR #1095</div><h1>Before and after, one change at a time</h1><p>Compare current main with the reviewed PR. The alternative “Rejected candidate” view shows the regressions repaired during review. Use the same case, viewport and checkpoint on both sides, then mark the case reviewed.</p><div class="metrics"><span><strong id="case-total"></strong> scenarios</span><span><strong id="width-total"></strong> cases/viewports per source</span><span><strong id="image-total"></strong> screenshot checkpoints</span><a href="https://github.com/CT2689-Tech/DeclutrMail/pull/1095">PR and exact-head validation</a></div></header>
<nav class="toolbar"><label>Compare <select id="compare"><option value="before">Current main → reviewed PR</option><option value="rejected">Rejected candidate → reviewed PR</option></select></label><label>Group <select id="group"><option value="">All changes</option></select></label><input id="search" placeholder="Find a change…" aria-label="Find a change"><label><input id="unreviewed" type="checkbox" style="width:auto">Unreviewed only</label><button id="export">Export checklist</button><span class="count" id="count"></span></nav>
<main><section class="intro"><strong>How to use this pack</strong><p>1. Read “What to check”. 2. Compare both screenshots; click either to enlarge. 3. Use checkpoint controls for choice changes, refreshes, Details, Cancel and Tab. 4. Expand text/accessibility evidence for differences a screenshot cannot show.</p><p><strong>Preserved contracts:</strong> Archive/Later start at Any age; Delete starts at 180 days; Later keeps seven days. Archived mail requires explicit opt-in. Home still states the sender and count. Later does not promise simultaneous delivery. Screener remains an inline preview with normal Tab navigation.</p><details><summary>Source identity and evidence limits</summary><div id="limits"></div><pre id="refs"></pre></details></section><div id="cases"></div><section class="appendix"><h2>Complete change coverage</h2><p>The catalog has 63 added string leaves, seven modified leaves and four removed unused aria strings. Most additions move existing text into the catalog; an added key does not mean the UI text was previously absent.</p><details><summary>Every catalog change</summary><table><thead><tr><th>Key</th><th>Change</th><th>Before catalog</th><th>After catalog</th></tr></thead><tbody id="catalog"></tbody></table></details><details><summary>Every integrated PR file and related review cases</summary><table><thead><tr><th>File</th><th>Type</th><th>Cases</th></tr></thead><tbody id="files"></tbody></table></details></section><footer>Read-only synthetic component evidence. #1095 remains open and unqueued. #972 and #1074 remain on hold. Authentication and real Gmail/provider execution are outside this capture pack.</footer></main>
<dialog id="zoom"><button id="close-zoom">Close enlarged screenshot</button><img id="zoom-image" alt="Enlarged screenshot"></dialog>
<script>const D=${serialized};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);let reviewed={};try{reviewed=JSON.parse(localStorage.getItem('pr1095-review-a7464ac4')||'{}')}catch{}
const labels={before:'Before · current main',rejected:'Before · rejected candidate',after:'After · reviewed PR'};
const state={};
$('case-total').textContent=D.cases.length;$('width-total').textContent=D.expected;$('image-total').textContent=D.screenshotCount;
$('refs').textContent=JSON.stringify(D.refs,null,2);$('limits').innerHTML=D.limitations.map(v=>'<p>'+esc(v)+'</p>').join('');
for(const group of [...new Set(D.cases.map(c=>c.group))])$('group').add(new Option(group,group));
$('catalog').innerHTML=D.catalog.map(r=>'<tr><td class="file">'+esc(r.key)+'</td><td>'+esc(r.kind)+'</td><td>'+esc(r.before_catalog??'—')+'</td><td>'+esc(r.after_catalog??'—')+'</td></tr>').join('');
$('files').innerHTML=D.files.map(r=>'<tr><td class="file">'+esc(r.file)+'</td><td>'+esc(r.classification)+'<br><small>'+esc(r.coverageMode)+'</small></td><td>'+r.scenarios.map(esc).join(', ')+'</td></tr>').join('');
function point(record,stage){return record.checkpoints.find(p=>p.stage===stage)||record.checkpoints.at(-1)}
function render(){const comparison=$('compare').value;const q=$('search').value.toLowerCase();const group=$('group').value;const visible=D.cases.filter(c=>(!group||c.group===group)&&(!q||[c.id,c.title,c.check,c.group,c.captures[0].sources.after.checkpoints.at(-1).text].join(' ').toLowerCase().includes(q))&&(!$('unreviewed').checked||!reviewed[c.id]));$('count').textContent=Object.keys(reviewed).filter(k=>reviewed[k]).length+' / '+D.cases.length+' reviewed · '+visible.length+' shown';$('cases').innerHTML=visible.map(c=>{const s=state[c.id]||{};const capture=c.captures.find(v=>v.width===s.width)||c.captures[0];const left=capture.sources[comparison],right=capture.sources.after;const stages=[...new Set([...left.checkpoints,...right.checkpoints].map(p=>p.stage))];const stage=stages.includes(s.stage)?s.stage:'final';const lp=point(left,stage),rp=point(right,stage);const shot=(record,p,label)=>'<div class="shot"><h3>'+esc(labels[label])+'</h3><div class="sha">'+esc(record.sourceSha.slice(0,12))+' · '+capture.width+' × '+record.height+'</div><img loading="lazy" alt="'+esc(labels[label]+' — '+c.title+' — '+p.stage)+'" data-image="'+esc(p.imageKey)+'" src="'+D.images[p.imageKey]+'"><p class="caption">Checkpoint: '+esc(p.stage)+' · '+esc(p.result)+'</p></div>';return '<article class="card '+(reviewed[c.id]?'reviewed':'')+'" id="'+esc(c.id)+'"><div class="case-top"><div><span class="eyebrow">'+esc(c.group)+'</span><h2>'+esc(c.title)+'</h2></div><label class="check-reviewed"><input type="checkbox" data-reviewed="'+esc(c.id)+'" '+(reviewed[c.id]?'checked':'')+'> Reviewed</label></div><p class="check"><strong>What to check:</strong> '+esc(c.check)+'</p><div class="capture-options"><label>Viewport <select data-width="'+esc(c.id)+'">'+c.captures.map(v=>'<option value="'+v.width+'" '+(v.width===capture.width?'selected':'')+'>'+v.width+'px</option>').join('')+'</select></label><label>Checkpoint <select data-stage="'+esc(c.id)+'">'+stages.map(v=>'<option '+(v===stage?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label><span class="badge '+(comparison==='rejected'?'rejected':'')+'">'+esc(c.id)+'</span></div><div class="pair">'+shot(left,lp,comparison)+shot(right,rp,'after')+'</div>'+(c.actions?.length?'<p class="actions"><strong>Steps:</strong> '+c.actions.map(a=>esc(a.type+' '+(a.name||a.namePattern||a.key||a.value||a.selector||''))).join(' → ')+'</p>':'')+'<details><summary>Text, accessible controls and focus evidence</summary><div class="text-pair"><div><h3>'+esc(labels[comparison])+'</h3><pre>'+esc(lp.text)+'</pre><pre>'+esc(JSON.stringify({activeElement:lp.activeElement,selectedRadios:lp.selectedRadios,controls:lp.controls},null,2))+'</pre></div><div><h3>After · reviewed PR</h3><pre>'+esc(rp.text)+'</pre><pre>'+esc(JSON.stringify({activeElement:rp.activeElement,selectedRadios:rp.selectedRadios,controls:rp.controls},null,2))+'</pre></div></div></details></article>'}).join('')||'<p class="empty">No cases match these filters.</p>';}
for(const id of ['compare','group','unreviewed'])$(id).addEventListener('change',render);$('search').addEventListener('input',render);
$('cases').addEventListener('change',event=>{const e=event.target;if(e.dataset.reviewed){reviewed[e.dataset.reviewed]=e.checked;try{localStorage.setItem('pr1095-review-a7464ac4',JSON.stringify(reviewed))}catch{}render()}else if(e.dataset.width){state[e.dataset.width]={...(state[e.dataset.width]||{}),width:Number(e.value)};render()}else if(e.dataset.stage){state[e.dataset.stage]={...(state[e.dataset.stage]||{}),stage:e.value};render()}});
$('cases').addEventListener('click',event=>{const key=event.target.dataset.image;if(!key)return;$('zoom-image').src=D.images[key];$('zoom').showModal()});$('close-zoom').onclick=()=>$('zoom').close();
$('export').onclick=()=>{const rows=['case,title,reviewed',...D.cases.map(c=>[c.id,c.title,Boolean(reviewed[c.id])].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(','))];const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\\n')],{type:'text/csv'}));a.download='pr1095-review-checklist.csv';a.click();URL.revokeObjectURL(a.href)};render();
</script></html>`;
writeFileSync(join(out, 'review.html'), html);
writeFileSync(
  join(out, 'README.md'),
  `# PR #1095 before/after review\n\nOpen review.html for the complete, self-contained screenshot comparison.\n\n- Before: current main ${refs.before}\n- After: reviewed PR ${refs.after}\n- Rejected view: ${refs.rejected}\n- ${scenarios.length} scenarios; ${expected} cases/viewports per source; ${data.screenshotCount} screenshot checkpoints.\n\n${data.limitations.map((item) => '- ' + item).join('\n')}\n`,
);
console.log(
  JSON.stringify({
    out,
    scenarios: scenarios.length,
    casesPerSource: expected,
    screenshots: data.screenshotCount,
    bytes: Buffer.byteLength(html),
  }),
);
