import type { SkillCharge } from './battle.ts';
import type { Combatant } from './combat.ts';
import type { Point } from './navigation.ts';
import { attackDistance } from './basic-attack.ts';

const MAX_PATH_SEARCH_STEPS = 101;

export interface ChargePlan { destination: Point; close: boolean }

/** 查找可达的近敌落点。场景提供物理世界的占用查询，规则只处理网格路径。 */
export function planCharge(caster: Combatant, target: Combatant, charge: SkillCharge, canStand: (point: Point) => boolean): ChargePlan | undefined {
  if (attackDistance(caster.position,caster.bounds,target.position,target.bounds)-2 < charge.closeDistanceUnits) {
    return {destination:{...caster.position},close:true};
  }
  const size=charge.gridSizePx;
  const start={x:Math.floor(caster.position.x/size),y:Math.floor(caster.position.y/size)};
  const goal={x:Math.floor(target.position.x/size),y:Math.floor(target.position.y/size)};
  const distance=(p:Point)=>Math.abs(p.x-goal.x)+Math.abs(p.y-goal.y);
  const key=(p:Point)=>`${p.x},${p.y}`;
  const open=[{...start,cost:0}], costs=new Map([[key(start),0]]);
  for(let visited=0;open.length&&visited<MAX_PATH_SEARCH_STEPS;visited++){
    open.sort((a,b)=>(a.cost+distance(a))-(b.cost+distance(b)));
    const current=open.shift()!;
    if(current.cost!==costs.get(key(current)))continue;
    const destination={x:current.x*size,y:current.y*size};
    if(distance(current)<=charge.stoppingDistanceUnits&&canStand(destination))return {destination,close:false};
    for(const [dx,dy] of [[-1,0],[0,-1],[0,1],[1,0]]){
      const next={x:current.x+dx,y:current.y+dy,cost:current.cost+1};
      if(next.cost>=(costs.get(key(next))??Infinity)||!canStand({x:next.x*size,y:next.y*size}))continue;
      costs.set(key(next),next.cost);open.push(next);
    }
  }
  return undefined;
}
