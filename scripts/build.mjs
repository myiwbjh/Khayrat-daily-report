import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
const files=['index.html','app.js','styles.css','src','viewer.html','viewer.js'];
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of files)await cp(file,`dist/${file}`,{recursive:true});
await mkdir('dist/vendor', {recursive:true});
await build({entryPoints:['node_modules/@supabase/supabase-js/dist/index.mjs'],outfile:'dist/vendor/supabase.mjs',bundle:true,format:'esm',platform:'browser',minify:true});
// Legacy build includes browser compatibility polyfills; worker must use the same build.
for(const file of ['pdf.mjs','pdf.worker.mjs'])await cp(`node_modules/pdfjs-dist/legacy/build/${file}`,`dist/vendor/${file}`);
for(const folder of ['cmaps','standard_fonts','wasm'])await cp(`node_modules/pdfjs-dist/${folder}`,`dist/vendor/${folder}`,{recursive:true});
console.log('Built static application in dist/');


await cp('node_modules/xlsx/xlsx.mjs','dist/vendor/xlsx.mjs');
await cp('node_modules/xlsx/dist/cpexcel.full.mjs','dist/vendor/cpexcel.full.mjs');
