import { resolve } from 'node:path';
import { build } from 'vite';
/** Build the existing checkout launcher without any provider I/O or credentials. */
export async function buildRehearsalClient(): Promise<string> {
  const entry = resolve(import.meta.dirname, 'refund-rehearsal-entry.js');
  const source = `import {launchCheckout} from ${JSON.stringify(resolve(import.meta.dirname, '../../../../apps/web/src/features/billing/checkout.ts'))};
const selected=()=>document.getElementById('scenario').value;const message=document.getElementById('message');
let operatorKey='';document.getElementById('authenticate').onclick=()=>{operatorKey=document.getElementById('operator').value;document.getElementById('operator').value='';message.textContent='Operator key loaded for this tab only.';};
async function action(path){const r=await fetch(path+'?case='+selected(),{method:'POST',headers:{'x-rehearsal-key':operatorKey}});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
for(const [id,path] of [['buy','/checkout'],['upgrade','/upgrade'],['refund','/refund'],['finish','/finish']])document.getElementById(id).onclick=async()=>{try{const v=await action(path);if(id==='buy')await launchCheckout(v);message.textContent='Request accepted; provider evidence is shown below.';}catch(e){message.textContent=e.message;}};
setInterval(async()=>{if(!operatorKey)return;try{const r=await fetch('/state?case='+selected(),{headers:{'x-rehearsal-key':operatorKey}});document.getElementById('state').textContent=JSON.stringify(await r.json(),null,2);}catch{}},5000);`;
  const output = await build({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../../apps/web'),
    logLevel: 'silent',
    plugins: [
      {
        name: 'isolated-rehearsal-entry',
        resolveId(id) {
          if (id === entry) return '\0' + entry;
        },
        load(id) {
          if (id === '\0' + entry) return source;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'] },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const bundles = Array.isArray(output) ? output : [output];
  if (bundles.length !== 1 || !('output' in bundles[0]!))
    throw new Error('One browser bundle required');
  const chunks = bundles[0]!.output.filter((c) => c.type === 'chunk');
  if (chunks.length !== 1) throw new Error('Exactly one browser chunk required');
  const chunk = chunks[0];
  if (!chunk || chunk.type !== 'chunk') throw new Error('Browser bundle missing');
  return chunk.code;
}
