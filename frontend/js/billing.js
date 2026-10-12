import { state } from './state.js';
import { requestJson } from './api.js';
import { el, escapeHtml, money } from './ui.js';
import { notify } from './feedback.js';

const admin = () => state.currentUser?.role==='admin';
const context = () => ['admin','business'].includes(state.currentUser?.role)&&state.token ?
  JSON.stringify([state.currentUser.id,state.token,state.currentUser.role]) : null;
const prefix = () => admin()?'admin':'business';
const path = () => admin()?'/admin/billing':'/business/billing';
const receiptDate = value => new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'});
const stats = rows => rows.map(([label,value])=>'<div class="stat-card"><div class="stat-label">'+label+
  '</div><div class="stat-value">'+money(value)+'</div></div>').join('');

export function resetBilling() {
  state.billingRequest++;state.billingDetailRequest++;state.billingContext=null;
  state.billingData=null;state.billingInvoice=null;state.billingSaving=false;
  for(const p of ['admin','business']) {
    for(const id of ['billing-summary','billing-invoices','invoice-lines','invoice-payments','invoice-summary'])if(el(p+'-'+id))el(p+'-'+id).innerHTML='';
    if(el(p+'-invoice-detail'))el(p+'-invoice-detail').hidden=true;
    if(el(p+'-billing-status'))el(p+'-billing-status').textContent='';
    if(el(p+'-billing-month'))el(p+'-billing-month').value='';
    for(const id of ['invoice-heading','invoice-period','billing-instructions'])if(el(p+'-'+id))el(p+'-'+id).textContent='';
  }
  if(el('billing-payment-form'))el('billing-payment-form').reset();
}

export async function loadBilling() {
  const session=context(), p=prefix();
  if(!session||!el(p+'-billing-invoices'))return;
  if(session!==state.billingContext){resetBilling();state.billingContext=session;}
  const request=++state.billingRequest;
  el(p+'-billing-status').textContent='Loading billing records...';
  el(p+'-billing-invoices').setAttribute('aria-busy','true');
  try {
    const month=el(p+'-billing-month').value;
    const data=await requestJson((admin()?'/admin/revenue':'/business/billing')+(month?'?month='+encodeURIComponent(month):''),{cache:'no-store'});
    if(session!==context()||request!==state.billingRequest)return;
    state.billingData=data;
    if(!admin())el('business-billing-instructions').textContent=data.payment_instructions||'';
    const s=data.summary;
    el(p+'-billing-summary').innerHTML=stats(admin() ? [
      ['Completed food sales',s.gross_sales],['Commission earned',s.commission_total],
      ['Money received',s.real_received],['Outstanding fees',s.outstanding],['Demo receipts · not income',s.demo_received]
    ] : [['Completed food sales',s.gross_sales],['Commission charged',s.commission_total],
      ['After commission',s.restaurant_net],['Fees paid',s.real_received],['Fees outstanding',s.outstanding]]);
    el(p+'-billing-invoices').innerHTML=data.invoices.length?data.invoices.map(i=>
      '<tr><td><strong>'+escapeHtml(i.invoice_number)+'</strong><small>'+escapeHtml(i.period_start.slice(0,7))+
      (i.period_open?' · Current month, accruing':' · Closed month')+'</small></td>'+
      (admin()?'<td>'+escapeHtml(i.business_name)+'</td>':'')+'<td>'+money(i.commission_total)+'</td><td>'+money(i.real_received)+
      '</td><td>'+money(i.outstanding)+'</td><td><span class="badge '+(i.payment_status==='paid'?'active':'neutral')+'">'+
      escapeHtml(i.payment_status)+'</span></td><td><button class="btn-sec" data-click="openBillingInvoice" data-arg0="'+i.id+'">View statement</button></td></tr>').join(''):
      '<tr><td colspan="7">No completed sales for this billing period.</td></tr>';
    el(p+'-billing-status').textContent=(data.commission_rate_bps/100)+'% of completed order totals, including previous sales. Demo receipts do not settle fees or count as money received.';
  } catch(error) {
    if(session!==context()||request!==state.billingRequest)return;
    state.billingData=null;el(p+'-billing-summary').innerHTML='';el(p+'-billing-invoices').innerHTML='';
    el(p+'-billing-status').textContent='Could not load billing: '+error.message;
  } finally {if(session===context()&&request===state.billingRequest)el(p+'-billing-invoices').setAttribute('aria-busy','false');}
}

export async function openBillingInvoice(id) {
  const session=context(),p=prefix(),request=++state.billingDetailRequest;
  if(!session||!el(p+'-invoice-detail'))return;
  state.billingInvoice=null;el(p+'-invoice-detail').hidden=true;
  el(p+'-billing-status').textContent='Loading statement...';
  try {
    const data=await requestJson(path()+'/invoices/'+id,{cache:'no-store'});
    if(session!==context()||request!==state.billingDetailRequest)return;
    state.billingInvoice=data;
    const i=data.invoice;
    el(p+'-invoice-heading').textContent=i.invoice_number+' · '+i.business_name;
    el(p+'-invoice-period').textContent=i.period_start.slice(0,7)+' · '+(i.period_open?'Interim statement; more completed orders may add fees.':'Monthly invoice.');
    el(p+'-invoice-summary').innerHTML=stats([['Commission',i.commission_total],['Actual receipts',i.real_received],['Outstanding',i.outstanding]]);
    el(p+'-invoice-lines').innerHTML=data.entries.map(e=>'<tr><td>#'+e.order_id+'</td><td>'+escapeHtml(e.item_title)+
      '</td><td>'+escapeHtml(receiptDate(e.completed_at))+'</td><td>'+money(e.gross_amount)+'</td><td>'+e.rate_bps/100+'%</td><td>'+money(e.fee_amount)+'</td></tr>').join('');
    el(p+'-invoice-payments').innerHTML=data.payments.length?data.payments.map(payment=>
      '<article class="billing-receipt"><div><strong>'+money(payment.amount)+' · '+(payment.kind==='demo'?'DEMO · not income':'Recorded receipt')+
      (payment.voided_at?' · VOIDED':'')+'</strong><p>'+escapeHtml(payment.method)+' · '+escapeHtml(payment.reference)+
      '</p><small>'+escapeHtml(receiptDate(payment.received_at))+' BST · Recorded by '+escapeHtml(payment.recorded_by_name)+
      '</small><p>'+escapeHtml(payment.note)+(payment.voided_at?' · Reason: '+escapeHtml(payment.void_reason):'')+'</p></div>'+
      (admin()&&!payment.voided_at?'<form class="billing-void-form" data-submit="voidBillingPayment" data-arg0="'+payment.id+'"><label for="billing-void-'+payment.id+'">Correction reason</label><input id="billing-void-'+payment.id+'" maxlength="500" required><button class="btn-sec danger-action" type="submit">Void receipt</button></form>':'')+'</article>').join(''):'<p>No payment receipts recorded.</p>';
    el(p+'-invoice-detail').hidden=false;
    el(p+'-billing-status').textContent='Statement loaded. All dates use Bangladesh time.';
    if(admin()) {
      el('billing-payment-form').reset();
      el('billing-payment-date').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'});
      el('billing-payment-submit').disabled=false;el('billing-payment-feedback').textContent='';
    }
  } catch(error) {if(session===context()&&request===state.billingDetailRequest)el(p+'-billing-status').textContent=error.message;}
}

export async function recordBillingPayment(event) {
  event.preventDefault();
  if(state.billingSaving||!admin()||!state.billingInvoice)return;
  const session=context(),id=state.billingInvoice.invoice.id;
  const dateValue=el('billing-payment-date').value;
  // Date inputs represent Bangladesh days, not the browser's timezone.
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'});
  const received=dateValue===today?new Date().toISOString():dateValue+'T12:00:00+06:00';
  const payload={amount:el('billing-payment-amount').value,kind:el('billing-payment-kind').value,
    method:el('billing-payment-method').value,reference:el('billing-payment-reference').value,
    note:el('billing-payment-note').value,received_at:received,verified:el('billing-payment-verified').checked};
  state.billingSaving=true;el('billing-payment-submit').disabled=true;
  try {
    await requestJson('/admin/billing/invoices/'+id+'/payments',{method:'POST',body:JSON.stringify(payload)});
    if(session!==context())return;
    await loadBilling();await openBillingInvoice(id);notify(payload.kind==='demo'?'Demo receipt recorded. Actual income is unchanged.':'Verified receipt recorded.');
  } catch(error) {if(session===context())el('billing-payment-feedback').textContent=error.message;}
  finally {if(session===context()){state.billingSaving=false;el('billing-payment-submit').disabled=false;}}
}

export async function voidBillingPayment(event,node) {
  event.preventDefault();if(!admin()||state.billingSaving||!state.billingInvoice)return;
  const session=context(),id=state.billingInvoice.invoice.id,paymentId=Number(node.dataset.arg0);
  state.billingSaving=true;
  try {
    await requestJson('/admin/billing/payments/'+paymentId+'/void',{method:'POST',body:JSON.stringify({reason:el('billing-void-'+paymentId).value})});
    if(session!==context())return;
    await loadBilling();await openBillingInvoice(id);notify('Receipt voided; its audit record is retained.');
  } catch(error){if(session===context())notify(error.message,'error');}
  finally {if(session===context())state.billingSaving=false;}
}

export function downloadBillingInvoice() {
  if(!state.billingInvoice||state.billingContext!==context())return;
  const i=state.billingInvoice.invoice;
  const url=URL.createObjectURL(new Blob(['\uFEFF'+billingInvoiceCsv(state.billingInvoice)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=i.invoice_number+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function billingInvoiceCsv({invoice:i,entries,payments}) {
  const cell=value=>'"'+String(value??'').replace(/^(\s*[=+@-]|[\t\r\n])/,"'$&").replaceAll('"','""')+'"';
  const rows=[['PlateUp',i.invoice_number,i.business_name,i.period_start.slice(0,7)],
    ['Statement',i.period_open?'Interim / accruing':'Monthly invoice'],
    ['Commission total',i.commission_total],['Actual receipts',i.real_received],['Outstanding',i.outstanding],
    ['Demo receipts (not income)',i.demo_received],[],['Order','Item','Completed at','Sale total','Rate %','Commission'],
    ...entries.map(e=>[e.order_id,e.item_title,e.completed_at,e.gross_amount,e.rate_bps/100,e.fee_amount]),[],
    ['Receipt','Type','Method','Reference','Amount','Received at','Voided at','Void reason'],
    ...payments.map(p=>[p.id,p.kind,p.method,p.reference,p.amount,p.received_at,p.voided_at,p.void_reason])];
  return rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
