const fs=require('node:fs');
const path=require('node:path');
const {generateSynthetic,writeCsv,validateRows}=require('../server/training-format');
try {
  const args=process.argv.slice(2),options={};let output='data/generated/synthetic-offers.csv';
  for(let index=0;index<args.length;index+=2) {
    const key=args[index],value=args[index+1];
    if(value===undefined||!['--seed','--days','--items','--start','--output'].includes(key))throw new Error('Use --seed, --days, --items, --start, or --output, each followed by a value.');
    if(key==='--output')output=value;
    else options[key.slice(2)]=key==='--start'?value:Number(value);
  }
  const rows=generateSynthetic(options);
  if(validateRows(rows).errors.length)throw new Error('Choose historical dates whose offer windows have all ended.');
  const filename=path.resolve(output);
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,writeCsv(rows),{encoding:'utf8',flag:'wx'});
  console.log('Generated '+rows.length+' labelled synthetic rows: '+filename);
}catch(error){console.error(error.code==='EEXIST'?'Output already exists. Choose a different --output file.':error.message);process.exitCode=1;}
