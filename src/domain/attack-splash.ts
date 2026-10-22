import {attackDistance,targetDistance,targetScore} from './basic-attack.ts';
import type {Combatant} from './combat.ts';
import type {Point} from './navigation.ts';

const hostileVisible=(source:Combatant,target:Combatant)=>source.team!==target.team&&!target.states?.includes('stealthed');

/** Existing/gaze targets are checked for reach; only a missing target starts a scored search. */
export function selectAttackSplashCenter(source:Combatant,candidates:readonly Combatant[],
  rangeUnits:number,selection:{currentTargetId?:string;gazeTargetId?:string;retainCurrentTarget?:boolean}={}):{
    center:Point;targetId?:string;consumedGaze:boolean;
  } {
  const current=candidates.find(target=>target.id===selection.currentTargetId);
  const consumedGaze=!!selection.gazeTargetId&&!(selection.retainCurrentTarget&&current);
  let target=consumedGaze?candidates.find(value=>value.id===selection.gazeTargetId):current;
  if(!target&&!consumedGaze&&!current){
    let score=0;
    const origin={x:Math.trunc(source.position.x),y:Math.trunc(source.position.y)};
    for(const candidate of candidates.slice(0,100)){
      if(!hostileVisible(source,candidate))continue;
      const position={x:Math.trunc(candidate.position.x),y:Math.trunc(candidate.position.y)};
      const value=targetScore(origin,position,source.facing??'south',rangeUnits*8);
      if(value>score){target=candidate;score=value;}
    }
  }
  if(target&&attackDistance(source.position,source.bounds,target.position,target.bounds)<=rangeUnits)
    return {center:target.position,targetId:target.id,consumedGaze};
  return {center:source.position,consumedGaze};
}

/** 按角色池顺序收集敌方脚点范围，免伤目标仍占用名额。 */
export function attackSplashTargets(source:Combatant,center:Point,candidates:readonly Combatant[],rangeUnits:number):Combatant[] {
  const selected:Combatant[]=[];
  for(const candidate of candidates.slice(0,100)){
    if(!hostileVisible(source,candidate)||Math.floor(targetDistance(center,candidate.position)/8)>rangeUnits)continue;
    selected.push(candidate);
    if(selected.length===16)break;
  }
  return selected;
}
