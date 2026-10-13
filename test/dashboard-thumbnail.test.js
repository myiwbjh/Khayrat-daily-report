import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/thumbnail.js';

function response(){
 return {code:200,headers:{},body:null,
  setHeader(key,value){this.headers[key]=value;return this;},
  status(value){this.code=value;return this;},
  json(value){this.body=value;return this;},
  end(){return this;},
  send(value){this.body=value;return this;}
 };
}

test('thumbnail service rejects non-POST and unauthenticated requests',async()=>{
 const badMethod=response();
 await handler({method:'GET',headers:{}},badMethod);
 assert.equal(badMethod.code,405);
 const unauthenticated=response();
 await handler({method:'POST',headers:{},body:{imageId:'abc'}},unauthenticated);
 assert.equal(unauthenticated.code,401);
 assert.match(String(unauthenticated.body?.error),/登录/);
});
