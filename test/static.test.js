const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=require('../server/index');

test('Express serves the shell, every view/module and CSS while keeping server/configuration files private',async()=>{
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
  try {
    const root=await fetch(base+'/');
    assert.equal(root.status,200);
    const shell=await root.text();
    assert.match(shell,/type="module" src="\/frontend\/js\/app.js"/);
    assert.doesNotMatch(shell,/id="(?:customer|business|login)"/);
    const legacy=await fetch(base+'/UI_PlateUp.html',{redirect:'manual'});
    assert.equal(legacy.status,302);assert.equal(legacy.headers.get('location'),'/');
    for(const file of fs.readdirSync(path.join(__dirname,'../frontend'),{recursive:true}).filter(name=>/\.(html|css|js)$/.test(name))) {
      const response=await fetch(base+'/frontend/'+file.replaceAll(path.sep,'/'));
      assert.equal(response.status,200,file);
      const type=file.endsWith('.js')?/javascript/:file.endsWith('.css')?/text\/css/:/text\/html/;
      assert.match(response.headers.get('content-type'),type,file);
      const source=await response.text();
      if(file.endsWith('.js'))for(const match of source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)) {
        assert.equal(fs.existsSync(path.resolve(__dirname,'../frontend',path.dirname(file),match[1])),true,match[1]);
      }
      if(file.endsWith('.html')&&file!=='index.html') {
        assert.doesNotMatch(source,/<(?:html|head|body|script)\b/i,file);
        assert.doesNotMatch(source,/\bon(?:click|submit|change|input|keydown|keyup)=/i,file);
      }
    }
    for(const url of ['/server/index.js','/.env','/frontend/.env','/frontend/../server/db.js','/frontend/%2e%2e%2fserver%2fdb.js','/server/migrate.sql']) {
      assert.equal((await fetch(base+url)).status,404,url);
    }
    assert.equal((await fetch(base+'/api/not-a-real-route')).status,404);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
