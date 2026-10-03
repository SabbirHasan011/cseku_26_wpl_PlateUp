import { state } from './state.js';
import { requestJson, API_BASE } from './api.js';
import { el, escapeHtml } from './ui.js';

let requestVersion=0,validatedFile=null,syntheticCsv=null,syntheticSession=null,dataSession=null;
const query=()=>'?source='+encodeURIComponent(el('training-source').value||'platform')+
  '&from='+encodeURIComponent(el('training-from').value||'2000-01-01')+
  '&to='+encodeURIComponent(el('training-to').value||'2100-12-31');
function feedback(message){if(el('training-feedback'))el('training-feedback').textContent=message;}
function download(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function loadTrainingData() {
  if(state.currentUser?.role!=='business'||!el('training-rows'))return;
  if(dataSession!==state.token) {
    dataSession=state.token;validatedFile=null;syntheticCsv=null;syntheticSession=null;
    el('training-validate').disabled=false;el('training-generate').disabled=false;
    el('training-import').disabled=true;el('training-save-sample').disabled=true;
    el('training-import-feedback').textContent='';el('training-sample-feedback').textContent='';
  }
  const session=state.token,version=++requestVersion;feedback('Checking offer history and outcomes…');
  try {
    const data=await requestJson('/business/training-data'+query());
    if(session!==state.token||version!==requestVersion)return;
    el('training-summary').textContent=data.summary.total+' records · '+data.summary.eligible+' eligible · '+
      data.summary.flagged+' flagged · '+data.summary.unfinished+' unfinished · '+data.summary.synthetic+' synthetic'+
      (data.diagnostics?' · '+data.diagnostics.unlinked_orders+' orders without daily inventory · '+data.diagnostics.missing_snapshots+' missing snapshots':'');
    el('training-rows').innerHTML=data.rows.map(row=>'<tr><td>'+escapeHtml(row.offer_date)+'</td><td>'+escapeHtml(row.title)+
      '<small>'+escapeHtml(row.item_reference)+'</small></td><td>'+row.initial_quantity+'</td><td>'+row.collected_quantity+
      '</td><td>'+escapeHtml(row.snapshot_quality)+'</td><td>'+(row.training_eligible?'Eligible':row.quality_issues.map(escapeHtml).join(' '))+'</td></tr>').join('');
    feedback(data.summary.total?'Showing up to 100 records. CSV exports include eligible ended offers only.':'No records in this source and date range.');
  }catch(error){if(session===state.token&&version===requestVersion)feedback(error.message);}
}
export async function downloadTrainingFile(kind) {
  const session=state.token;
  try {
    const route=kind==='template'?'/business/training-data/template':kind==='events'?'/business/training-data/events'+query():
      '/business/training-data'+query()+'&format=csv';
    const response=await fetch(API_BASE+route,{headers:{Authorization:'Bearer '+session}});
    if(!response.ok)throw new Error((await response.json()).message||'Download failed.');
    const blob=await response.blob();
    if(session===state.token)download(blob,kind==='template'?'plateup-training-template.csv':kind==='events'?'plateup-offer-events.csv':'plateup-training.csv');
  }catch(error){if(session===state.token)feedback(error.message);}
}
export function resetTrainingImport() {
  validatedFile=null;el('training-import').disabled=true;
  el('training-import-feedback').textContent='Validate the selected CSV before importing.';
}
export async function importTrainingFile(commit=false) {
  const file=el('training-file').files[0],session=state.token;
  if(!file||file.size>1024*1024){el('training-import-feedback').textContent='Choose a UTF-8 CSV file of at most 1 MB.';return;}
  if(commit&&(validatedFile?.file!==file||validatedFile?.session!==session))return;
  el('training-validate').disabled=true;el('training-import').disabled=true;
  try {
    const csv=await file.text();
    if(session!==state.token||el('training-file').files[0]!==file)return;
    const data=await requestJson('/business/training-data/import'+(commit?'':'?dry_run=true'),{
      method:'POST',headers:{'Content-Type':'text/csv'},body:csv
    });
    if(session!==state.token||el('training-file').files[0]!==file)return;
    validatedFile=commit?null:{file,session};
    el('training-import-feedback').textContent=data.message;
    el('training-import').disabled=commit;
    if(commit)await loadTrainingData();
  }catch(error){if(session===state.token){
    validatedFile=null;
    const lines=error.details?.errors?.map(row=>'Row '+row.row+': '+row.issues.join(' '))||
      error.details?.duplicates?.map(row=>'Already saved: '+row.item_reference+' / '+row.offer_date+' / '+row.data_source)||[];
    el('training-import-feedback').textContent=[error.message,...lines].join('\n');
  }}
  finally{if(session===state.token)el('training-validate').disabled=false;}
}
export async function generateTrainingSample() {
  const session=state.token;el('training-generate').disabled=true;el('training-save-sample').disabled=true;
  syntheticCsv=null;syntheticSession=null;
  try {
    const data=await requestJson('/business/training-data/synthetic',{method:'POST',body:JSON.stringify({
      seed:Number(el('training-seed').value),days:Number(el('training-days').value),items:Number(el('training-items').value),start:el('training-start').value
    })});
    if(session!==state.token)return;
    syntheticCsv=data.csv;syntheticSession=session;el('training-save-sample').disabled=false;
    el('training-sample-feedback').textContent=data.count+' synthetic rows generated with seed '+data.seed+'. Downloaded; no live inventory or sales created.';
    download(new Blob([data.csv],{type:'text/csv;charset=utf-8'}),'plateup-synthetic-seed-'+data.seed+'.csv');
  }catch(error){if(session===state.token)el('training-sample-feedback').textContent=error.message;}
  finally{if(session===state.token)el('training-generate').disabled=false;}
}
export async function saveTrainingSample() {
  if(!syntheticCsv||syntheticSession!==state.token)return;
  const session=state.token;el('training-save-sample').disabled=true;
  try {
    const data=await requestJson('/business/training-data/import',{method:'POST',headers:{'Content-Type':'text/csv'},body:syntheticCsv});
    if(session!==state.token)return;
    el('training-sample-feedback').textContent=data.message;
    syntheticCsv=null;el('training-source').value='synthetic';await loadTrainingData();
  }catch(error){if(session===state.token){el('training-sample-feedback').textContent=error.message;el('training-save-sample').disabled=false;}}
}
