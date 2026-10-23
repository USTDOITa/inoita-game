import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { validateContent } from './validate-content.mjs';
import { BUILD_META_FILENAME, computeVersions } from './build-version.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw new Error('构建命令无需参数');
const publicDir=path.join(root,'public');
validateContent(publicDir);
const versions=computeVersions(publicDir);
process.env.STORY_ASSET_VERSION=versions.assetVersion;
process.env.STORY_CONTENT_VERSION=versions.contentVersion;
const staging=await fs.mkdtemp(path.join(root,'.build-'));
const dist=path.join(root,'dist'),previous=path.join(staging,'previous'),output=path.join(staging,'output');
let moved=false;
try{
 await build({root,configFile:path.join(root,'vite.config.ts'),build:{outDir:output}});
 const outputVersions=computeVersions(output);
 if(outputVersions.assetVersion!==versions.assetVersion||outputVersions.contentVersion!==versions.contentVersion)
  throw new Error('构建期间 public/assets 或 public/content 发生变化，请重新构建');
 await fs.writeFile(path.join(output,BUILD_META_FILENAME),JSON.stringify({
   schema:1,builtAt:new Date().toISOString(),...versions,
 })+'\n');
 validateContent(output);
 try{await fs.rename(dist,previous);moved=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 try{await fs.rename(output,dist);}catch(error){if(moved)await fs.rename(previous,dist);throw error;}
 console.log(`Standalone build: story-game/dist/ (assets ${versions.assetVersion}, content ${versions.contentVersion})`);
}finally{await fs.rm(staging,{recursive:true,force:true});}
