// Single-process protection for the private administrator sign-in endpoint.
// Keys expire automatically. No account is permanently locked by an attacker.
function createAdminLoginLimit({now=Date.now,windowMs=15*60*1000,maxAttempts=5,maxIpAttempts=30,maxKeys=10000}={}) {
  const attempts=new Map();
  const keys=req=>['ip:'+req.ip,'account:'+req.ip+':'+
    (typeof req.body?.email==='string'?req.body.email.trim().toLowerCase().slice(0,255):'invalid')];
  const middleware=(req,res,next)=>{
    const time=now();
    for(const [key,value] of attempts)if(value.until<=time)attempts.delete(key);
    const requestKeys=keys(req),limits=[maxIpAttempts,maxAttempts];
    const blocked=requestKeys.map((key,i)=>attempts.get(key)?.count>=limits[i]?attempts.get(key).until:0);
    const capacity=attempts.size+requestKeys.filter(key=>!attempts.has(key)).length>maxKeys;
    if(blocked.some(Boolean)||capacity) {
      const seconds=Math.max(1,Math.ceil(((Math.max(...blocked)||time+windowMs)-time)/1000));
      res.set('Retry-After',String(seconds));
      return res.status(429).json({message:'Too many sign-in attempts. Please try again later.',retry_after:seconds});
    }
    // Count before asynchronous password checking, including concurrent requests.
    for(const key of requestKeys) {
      const value=attempts.get(key)||{count:0,until:time+windowMs};
      value.count++;attempts.set(key,value);
    }
    next();
  };
  return {middleware,success:req=>attempts.delete(keys(req)[1])};
}
module.exports={createAdminLoginLimit};
