const required=['SUPABASE_URL','SUPABASE_ANON_KEY'];
const optional=['VERCEL_TOKEN','SUPABASE_ACCESS_TOKEN','OPENAI_API_KEY','VISION_PROVIDER','VISION_MODEL','AI_FEATURES_APPROVED','AI_ALLOWED_USER_EMAILS','OCR_ENABLED'];
const endpoints=['https://api.github.com','https://api.vercel.com','https://api.supabase.com'];
let failed=false;
console.log('Khayrat cloud deployment preflight (credential values are never printed)');
for(const name of required){const present=Boolean(process.env[name]);console.log(`${present?'PASS':'FAIL'} ${name}: ${present?'present':'missing'}`);if(!present)failed=true;}
for(const name of optional)console.log(`${process.env[name]?'PASS':'INFO'} ${name}: ${process.env[name]?'present':'not configured'}`);
for(const url of endpoints){try{const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(10000)});console.log(`PASS network ${url}: HTTP ${response.status}`);}catch(error){console.log(`FAIL network ${url}: ${error.cause?.message||error.message}`);failed=true;}}
if(failed){console.error('Preflight blocked. Complete interactive account authorization and/or allow outbound cloud API access, then rerun.');process.exitCode=1;}else console.log('Preflight passed; cloud deployment APIs are reachable.');
