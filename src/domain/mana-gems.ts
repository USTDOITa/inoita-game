import type { ManaPickup } from './items.ts';
import type { Point } from './navigation.ts';

interface ManaMember {
  id:string;
  player:Readonly<{health:number;mana:number;maxMana:number}>;
  setMana(value:number):void;
}
export function recoverManaPickup(pickup:ManaPickup,members:readonly ManaMember[],collectorId:string):{amount:number;effects:string[];restored:string[]} {
  const collector=members.find(member=>member.id===collectorId);
  if(!collector||collector.player.health<=0)throw new Error('拾取者不能行动');
  const amount=Math.floor(collector.player.maxMana*pickup.percentOfCollectorMaxMana/100);
  const restored:string[]=[],effects:string[]=[];
  for(const member of members){
    const {health,mana,maxMana}=member.player;
    if(health<=0)continue;
    if(mana<maxMana&&amount>0){member.setMana(Math.min(maxMana,mana+amount));restored.push(member.id);}
    if(restored.length)effects.push(member.id);
  }
  if(!effects.length)effects.push(collectorId);
  return {amount,restored,effects};
}

/** One roll per damaging contact; ongoing conditions and secondary procs do not call this. */
export function rollManaGem(pickup:ManaPickup,damage:number,rule:'skill'|'weapon',weaponKind:string|undefined,
  target:Point,reachable:(point:Point)=>boolean,random= Math.random):{x:number;y:number;direction:number}|undefined {
  if(damage<=0)return;
  const drop=pickup.hitDrop,threshold=rule==='skill'?drop.skillThreshold:drop.weaponThresholds[weaponKind??'']??0;
  if(!threshold)return;
  const roll=(maximum:number)=>Math.floor(Math.max(0,Math.min(1-Number.EPSILON,random()))*maximum);
  if(1+roll(drop.rollMaximum)>=threshold)return;
  const first=roll(drop.directions.length);
  let landing:{x:number;y:number;direction:number}|undefined;
  for(let attempt=0;attempt<drop.directions.length;attempt++){
    const direction=(first+attempt)%drop.directions.length,offset=drop.directions[direction];
    landing={x:target.x+offset.x+roll(drop.jitterPx*2+1)-drop.jitterPx,
      y:target.y+offset.y+roll(drop.jitterPx*2+1)-drop.jitterPx,direction};
    if(reachable(landing))break;
  }
  return landing;
}
