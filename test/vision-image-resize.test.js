import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {prepareVisionImage,storedImage,visionImage,VISION_IMAGE_LIMIT,VISION_IMAGE_MAX_EDGE,VISION_IMAGE_TARGET,VISION_SCHEMA} from '../server/vision-service.js';
import {GROQ_MODEL} from '../server/vision-provider.js';

const result={scene:'材料堆放',visibleFacts:['可见模板'],activities:[],equipment:[],materials:['模板'],structures:[],stage:'无法判断',inferences:[],limitations:['需人工确认'],summary:'可见堆放模板',confidence:.5,crossValidation:{status:'insufficient-evidence',reason:'不能确定具体工序'}};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const groqCompletion=()=>response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{total_tokens:10}});
const geminiCompletion=()=>response({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}],usageMetadata:{totalTokenCount:10}});
const env={VISION_PROVIDER:'groq',GROQ_API_KEY:'test-groq-key',GROQ_FREE_TIER_CONFIRMED:'true',VISION_MODEL:GROQ_MODEL,GEMINI_API_KEY:'test-gemini-key',GEMINI_FREE_TIER_CONFIRMED:'true',GEMINI_BILLING_DISABLED_CONFIRMED:'true',GEMINI_NONCONFIDENTIAL_USE_CONFIRMED:'true'};
let largeImage;
async function oversizedPng(){return largeImage||(largeImage=sharp({create:{width:3000,height:3000,channels:3,background:{r:35,g:120,b:80}}}).png({compressionLevel:0}).toBuffer());}

test('an image over 8 MB is temporarily resized below 4 MB without changing its source bytes',async()=>{
 const original=await oversizedPng(),copy=Buffer.from(original),prepared=await prepareVisionImage(original,'image/png'),metadata=await sharp(prepared.buffer).metadata();
 assert.ok(original.length>VISION_IMAGE_LIMIT);assert.equal(prepared.compressed,true);assert.equal(prepared.mime,'image/jpeg');assert.ok(prepared.buffer.length<VISION_IMAGE_TARGET);assert.ok(Math.max(metadata.width,metadata.height)<=VISION_IMAGE_MAX_EDGE);assert.deepEqual(original,copy);
});

test('stored image keeps its evidence association and only sends the temporary compressed copy onward',async()=>{
 const original=await oversizedPng(),evidence={imageId:'large',objectPath:'khayrat/batch/evidence/large.png',sourceExcerpt:'绑定日报原文'},auth={base:'https://db.example',headers:{Authorization:'Bearer user'}};
 const stored=await storedImage('large',auth,{env:{SUPABASE_STORAGE_BUCKET:'private'},fetchImpl:async url=>url.includes('/rest/')?response([{payload:evidence}]):new Response(original,{headers:{'Content-Type':'image/png','Content-Length':String(original.length)}})}),bytes=Buffer.from(stored.dataUrl.split(',')[1],'base64');
 assert.deepEqual(stored.evidence,evidence);assert.equal(stored.context,'绑定日报原文');assert.match(stored.dataUrl,/^data:image\/jpeg;base64,/);assert.ok(bytes.length<VISION_IMAGE_TARGET);
});

test('the compressed large image is accepted by Groq and by the configured free Gemini fallback',async()=>{
 const prepared=await prepareVisionImage(await oversizedPng(),'image/png'),dataUrl=`data:${prepared.mime};base64,${prepared.buffer.toString('base64')}`;
 let groqBody;const groq=await visionImage(dataUrl,'日报原文',VISION_SCHEMA,{env:{...env,GEMINI_API_KEY:''},fetchImpl:async(url,options)=>{assert.match(url,/api\.groq\.com/);groqBody=JSON.parse(options.body);return groqCompletion();}});
 assert.equal(groq.provider,'Groq');assert.equal(groqBody.messages[1].content[1].image_url.url,dataUrl);
 const urls=[],fallback=await visionImage(dataUrl,'日报原文',VISION_SCHEMA,{env,fetchImpl:async(url,options)=>{urls.push(url);if(url.includes('api.groq.com'))return response({error:{code:'rate_limit_exceeded'}},429);const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.data,dataUrl.split(',')[1]);return geminiCompletion();}});
 assert.equal(urls.length,2);assert.match(urls[1],/generativelanguage\.googleapis\.com/);assert.equal(fallback.provider,'Google Gemini');assert.equal(fallback.fallback,true);
});

test('compression failure is explicit and does not retry indefinitely',async()=>{
 let calls=0;await assert.rejects(()=>prepareVisionImage(Buffer.alloc(VISION_IMAGE_LIMIT+1),'image/png',{sharpImpl:()=>{calls++;throw new Error('decode failed');}}),error=>error.status===422&&/图片临时压缩失败/.test(error.message));assert.equal(calls,1);
});
