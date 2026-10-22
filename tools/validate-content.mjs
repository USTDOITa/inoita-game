import {parseCrafting,validateCrafting} from '../src/domain/crafting.ts';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseStatusHud, parseCharacterStats,validateCharacterStats,validateItemSkills,parseItemCatalog,parseWardrobe,validateWardrobe,parseMenuPanels,validateMenuClasses,parseStoryClasses,parseWorld,parseMap,parseBattle,parseCampaign,parseStoryInterface,parseControlSkin,validateStoryItems,validateStoryPortraits,parseShops,validateShops,parseCompanions,validateCompanions} from '../src/application/content-validation.ts';
import {validateContentRelations} from '../src/application/content-relations.ts';
import {validateSpriteSheet} from './validate-spritesheet.ts';
import {parseDrops} from '../src/domain/drops.ts';
import {titleMenuImages} from '../src/application/menu-images.ts';
export function validateContent(root=fileURLToPath(new URL('../public/',import.meta.url))){
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 const world=parseWorld(read('content/world.json')),battle=parseBattle(read('content/battle.json')),campaign=parseCampaign(read('content/campaign.json'));
 const audio=read('content/audio.json');const companions=parseCompanions(read('content/companions.json'));
 const storyInterface=parseStoryInterface(read('content/story-interface.json'));const items=parseItemCatalog(read('content/items.json')),wardrobe=parseWardrobe(read('content/wardrobe.json'));validateStoryItems(campaign,items);validateWardrobe(wardrobe,items,battle);validateItemSkills(items,battle);
 const crafting=parseCrafting(read('content/crafting.json'));validateCrafting(crafting,items);
 const shops=parseShops(read('content/shops.json'));validateShops(shops,items,world);
 const drops=parseDrops(read('content/drops.json'),items,battle.enemies.map(enemy=>enemy.id));
 validateStoryPortraits(world,storyInterface);
 const stats=parseCharacterStats(read('content/character-stats.json'));validateCharacterStats(stats,items,battle);validateCompanions(companions,world,battle,stats,campaign);
 const menu=parseMenuPanels(read('content/menu-panels.json'));validateMenuClasses(menu,battle);
 const maps=new Map();
 const documents=[crafting,companions,parseStatusHud(read('content/status-hud.json')),items,shops,drops,wardrobe,menu,world,battle,campaign,storyInterface,parseStoryClasses(read('content/story-classes.json')),parseControlSkin(read('content/control-skin.json')),audio];
 const ensure=(value,message)=>{if(!value)throw new Error(message);};
 // 地图要各自读一个文件，读进来后连同其它内容一起交给跨文件规则（src/application/content-relations.ts）。
 for(const reference of world.maps){const map=parseMap(read(reference.file));maps.set(map.id,map);documents.push(map);}
 validateContentRelations({world,battle,campaign,items,wardrobe,audio,maps});
 // 以下两项需要文件系统，留在构建侧：资源存在性与图集头。
 const assets=new Set();const visit=value=>{if(typeof value==='string'&&/^(assets|content)\//.test(value))assets.add(value);else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(value).forEach(visit);};documents.forEach(visit);
 for(const file of titleMenuImages)assets.add(file.replace(/^\//,''));
 for(const file of assets)ensure(fs.existsSync(path.join(root,file)),`资源不存在 ${file}`);
 const headers=new Map();
 const checkClips=value=>{
  if(Array.isArray(value))value.forEach(checkClips);
  else if(value&&typeof value==='object'){
   if(value.layers&&value.frameWidth)for(const layer of value.layers){
    if(!headers.has(layer.file)){
     const fd=fs.openSync(path.join(root,layer.file),'r');const header=Buffer.alloc(24);
     try{const length=fs.readSync(fd,header,0,24,0);headers.set(layer.file,header.subarray(0,length));}finally{fs.closeSync(fd);}
    }
    validateSpriteSheet(headers.get(layer.file),value,layer.file);
   }
   Object.values(value).forEach(checkClips);
  }
 };documents.forEach(checkClips);
 return {maps:world.maps.length,assets:assets.size};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(validateContent(process.argv[2]));
