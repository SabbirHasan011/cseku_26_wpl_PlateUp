const fs=require('node:fs');
const path=require('node:path');
const {writeCsv,validateRows}=require('../server/training-format');
const {PROFILES,generateItemHistory,generateIntervals,INTERVAL_COLUMNS}=require('../server/synthetic-sales');
function main() {
  const args=process.argv.slice(2),options={seed:20261005,days:180,start:'2025-10-01'};
  let output='data/generated/sales-scenarios';
  for(let i=0;i<args.length;i+=2) {
    const [key,value]=[args[i],args[i+1]];
    if(value===undefined||!['--seed','--days','--start','--output'].includes(key))throw new Error('Use --seed, --days, --start, or --output followed by a value.');
    if(key==='--output')output=value;else options[key.slice(2)]=key==='--start'?value:Number(value);
  }
  const daily=PROFILES.map(profile=>({profile,rows:generateItemHistory(profile,options)}));
  const intervals=PROFILES.flatMap(profile=>generateIntervals(profile,options));
  for(const item of daily)if(validateRows(item.rows).errors.length)throw new Error('Choose historical dates with ended offer windows.');
  if(intervals.some(row=>Date.parse(row.interval_end)>Date.now()))throw new Error('Interval offers must have ended.');
  const directory=path.resolve(output);
  if(fs.existsSync(directory))throw new Error('Output directory already exists. Choose a new --output directory.');
  fs.mkdirSync(directory,{recursive:true});
  const summary=[];
  for(const {profile,rows} of daily) {
    const filename=profile.slug+'-daily.csv';
    fs.writeFileSync(path.join(directory,filename),writeCsv(rows),{flag:'wx'});
    summary.push({file:filename,title:profile.title,rows:rows.length,zero_sales_days:rows.filter(r=>!r.collected_quantity).length,
      sold_out_days:rows.filter(r=>!r.remaining_quantity).length,mean_collected:rows.reduce((s,r)=>s+r.collected_quantity,0)/rows.length});
  }
  fs.writeFileSync(path.join(directory,'experimental-intervals.csv'),writeCsv(intervals,INTERVAL_COLUMNS),{flag:'wx'});
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({generator:'sales-scenarios-v1',...options,
    data_source:'synthetic',daily:summary,interval_rows:intervals.length,profiles:PROFILES},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output:directory,daily:summary,interval_rows:intervals.length},null,2));
}
if(require.main===module)try{main();}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={main};
