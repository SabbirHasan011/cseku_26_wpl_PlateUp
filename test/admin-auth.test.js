const test=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const app=require('../server/index');
const pool=require('../server/db');
const {createAdmin}=require('../tools/create-admin');
const {createAdminLoginLimit}=require('../server/admin-login-limit');

test('admin accounts use only private login, cannot be registered publicly, and failed attempts are limited',async()=>{
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port+'/api',ids=[];
  const marker=Date.now()+'-'+Math.random().toString(36).slice(2),password='AdminTestPassword123!';
  const call=async(path,body)=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,headers:response.headers,body:await response.json()};
  };
  try {
    const admin=await createAdmin({email:'admin-auth-'+marker+'@plateup.test',name:'Private admin',password});ids.push(admin.id);
    const credentials={email:admin.email,password};
    assert.equal((await call('/auth/signup',{...credentials,name:'Untrusted',role:'admin'})).status,400);
    assert.equal((await call('/auth/login',{...credentials,role:'admin'})).status,401);
    const login=await call('/auth/admin/login',{...credentials,role:'customer'});
    assert.equal(login.status,200);assert.equal(login.headers.get('cache-control'),'no-store');
    assert.equal(login.body.user.role,'admin');assert.equal(login.body.user.password_hash,undefined);
    assert.equal(jwt.verify(login.body.token,process.env.JWT_SECRET).role,'admin');
    const generic={message:'Invalid credentials'};
    assert.deepEqual((await call('/auth/admin/login',{...credentials,password:'WrongPassword'})).body,generic);
    assert.deepEqual((await call('/auth/admin/login',{email:'missing-'+marker+'@plateup.test',password})).body,generic);
    assert.equal((await call('/auth/admin/login',{...credentials,password:[]})).status,401);
    for(const role of ['customer','business']) {
      const input={name:'Public user',email:role+'-admin-auth-'+marker+'@plateup.test',password,role};
      const signup=await call('/auth/signup',input);assert.equal(signup.status,201);ids.push(signup.body.user.id);
      assert.equal((await call('/auth/login',input)).status,200);
      assert.deepEqual((await call('/auth/admin/login',input)).body,generic);
    }
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[admin.id]);
    assert.deepEqual((await call('/auth/admin/login',credentials)).body,generic);
    const brute={email:'brute-'+marker+'@plateup.test',password};
    const attempts=await Promise.all(Array.from({length:6},()=>call('/auth/admin/login',brute)));
    assert.equal(attempts.filter(r=>r.status===401).length,5);
    const blocked=attempts.find(r=>r.status===429);assert.ok(blocked);
    assert.ok(Number(blocked.headers.get('retry-after'))>0);assert.equal(blocked.body.token,undefined);
    assert.equal((await call('/auth/admin/signup',credentials)).status,404);
  } finally {
    await pool.query('DELETE FROM businesses WHERE user_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM customers WHERE user_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[ids]);
    await new Promise(resolve=>server.close(resolve));
  }
});

test('admin login limiter expires, resets successful email attempts and caps rotating emails per IP',()=>{
  let time=1000;const limit=createAdminLoginLimit({now:()=>time,windowMs:1000,maxAttempts:2,maxIpAttempts:4});
  const attempt=(email,ip='one')=>{
    const req={ip,body:{email}},result={status:200};
    const res={set:(key,value)=>{result[key]=value;},status:code=>{result.status=code;return res;},json:body=>{result.body=body;return res;}};
    limit.middleware(req,res,()=>{result.allowed=true;});return {req,...result};
  };
  assert.equal(attempt(' Owner@Example.Test ').allowed,true);
  assert.equal(attempt('owner@example.test').allowed,true);
  assert.equal(attempt('OWNER@example.test').status,429);
  assert.equal(attempt('owner@example.test','other').allowed,true);
  limit.success({ip:'one',body:{email:'owner@example.test'}});
  assert.equal(attempt('owner@example.test').allowed,true);
  assert.equal(attempt('rotated@example.test').allowed,true);
  assert.equal(attempt('another@example.test').status,429);
  time=2000;assert.equal(attempt('owner@example.test').allowed,true);
  const bounded=createAdminLoginLimit({now:()=>time,maxKeys:2});
  let allowed=0;const req={ip:'a',body:{email:'a'}},res={set(){},status(){return this;},json(){}};
  bounded.middleware(req,res,()=>allowed++);
  bounded.middleware({ip:'b',body:{email:'b'}},res,()=>allowed++);
  assert.equal(allowed,1,'capacity must not silently remove active counters');
});
