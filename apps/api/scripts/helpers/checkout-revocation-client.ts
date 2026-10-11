import { resolve } from 'node:path';
import { build } from 'vite';
/** Disjoint fixture launcher: same Paddle.js overlay, transaction OR legacy items. */
export async function buildCheckoutRevocationClient(): Promise<string> {
  const entry = resolve(import.meta.dirname, 'checkout-revocation-entry.js');
  const source = `import {initializePaddle} from '@paddle/paddle-js';
let key='',launched=false,last;
const scenario=document.getElementById('scenario'),message=document.getElementById('message');
const fromLink=new URL(location.href).searchParams.get('case');
if(['cancel','unopened','pay','race','crash','legacy','modified'].includes(fromLink))scenario.value=fromLink;
const selected=()=>scenario.value;
async function request(path,method='POST',body){
 const response=await fetch(path+'?case='+selected(),{method,headers:{'x-rehearsal-key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw new Error('Unconfirmed action');return value;
}
const eventNames=['checkout.loaded','checkout.error','checkout.payment.initiated','checkout.payment.error','checkout.payment.failed','checkout.completed','checkout.closed'];
const errorCodes=['transaction_not_ready_cannot_process_payment','transaction_status_must_be_ready','validation','transaction_checkout_url_domain_is_not_approved','transaction_checkout_not_enabled','transaction_default_checkout_url_not_set','transaction_immutable'];
async function open(session,hosted=false){
 if(launched)throw new Error('Use a fresh document for replay');
 launched=true;last=session;scenario.disabled=true;document.getElementById('open').disabled=true;
 const context={scenario:selected(),mode:hosted?'hosted':'overlay',replay:session.replay===true,requestedTransactionId:session.transactionId??null};
 let raceArmed=context.scenario==='race';
 const paddle=await initializePaddle({token:session.clientToken,environment:'sandbox',eventCallback:event=>{
  if(!eventNames.includes(event.name))return;
  const rawId=event.data?.transaction_id;
  const observedTransactionId=typeof rawId==='string'&&/^txn_[a-z\\d]{26}$/.test(rawId)?rawId:null;
  const code=errorCodes.includes(event.code)?event.code:'unknown';
  const observation=fetch('/observation?case='+context.scenario,{method:'POST',headers:{'x-rehearsal-key':key,'Content-Type':'application/json'},body:JSON.stringify({...context,event:event.name,observedTransactionId,errorCode:code,errorType:event.type==='api_error'?'api_error':'other'})});
  if(raceArmed&&event.name==='checkout.payment.initiated'){
   raceArmed=false;void observation.then(response=>{if(response.ok)return fetch('/race-revoke?case=race',{method:'POST',headers:{'x-rehearsal-key':key}});});
  }
 }});
 if(!paddle)throw new Error('Sandbox overlay unavailable');
 if(hosted)return; // Paddle.js consumes the original hosted _ptxn parameter.
 if(session.transactionId)paddle.Checkout.open({transactionId:session.transactionId});
 else if(session.kind==='legacy')paddle.Checkout.open({items:[{priceId:session.priceId,quantity:1}],customData:session.customData});
 else throw new Error('Transaction checkout has no items fallback');
}
document.getElementById('authenticate').onclick=async()=>{
 key=document.getElementById('operator').value;document.getElementById('operator').value='';
 message.textContent='Operator authenticated for this tab only.';
 if(location.pathname==='/pay'||location.pathname==='/overlay-replay')try{
  const session=await request(location.pathname==='/pay'?'/hosted-open':'/replay-open');
  if(location.pathname==='/pay'&&session.transactionId!==new URL(location.href).searchParams.get('_ptxn'))throw new Error('Mismatched link');
  await open(session,location.pathname==='/pay');
 }catch{message.textContent='Replay unconfirmed; hold retained.';}
};
for(const [id,path] of [['prepare','/prepare'],['open','/open'],['revoke','/revoke'],['recover','/recover'],['finish','/finish'],['abort','/abort']])document.getElementById(id).onclick=async()=>{
 try{const value=await request(path);if(id==='open')await open(value);message.textContent='Request accepted; inspect provider evidence below.';}catch{message.textContent='Action unconfirmed; hold retained.';}
};
document.getElementById('replay').onclick=()=>{if(!last){message.textContent='Open a checkout first.';return;}location.assign('/overlay-replay?case='+selected());};
setInterval(async()=>{if(!key)return;try{document.getElementById('state').textContent=JSON.stringify(await request('/state','GET'),null,2);}catch{message.textContent='Read unavailable; hold retained.';}},3000);`;
  const output = await build({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../../apps/web'),
    logLevel: 'silent',
    plugins: [
      {
        name: 'sandbox-revocation-entry',
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
  if (chunks.length !== 1 || chunks[0]?.type !== 'chunk')
    throw new Error('One browser chunk required');
  return chunks[0].code;
}
