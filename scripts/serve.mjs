import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join,normalize} from 'node:path';

const root=normalize(join(process.cwd(),'dist')),types={'.css':'text/css','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),candidate=normalize(join(root,pathname==='/'||pathname==='/view'?'index.html':pathname));
 if(!candidate.startsWith(root)){response.writeHead(403).end();return;}
 try{const info=await stat(candidate),file=info.isDirectory()?join(candidate,'index.html'):candidate;response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});createReadStream(file).pipe(response);}catch{response.writeHead(404).end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Khayrat test server: http://127.0.0.1:4173'));
