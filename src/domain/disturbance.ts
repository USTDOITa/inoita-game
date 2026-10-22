import type {PlacedRect} from './rect-distance.ts';
import {rectDistance} from './rect-distance.ts';

export interface DisturbanceActor extends PlacedRect {
  id:string;
  sameCamp:boolean;
  /** 这个对象是防御者自己拥有的召唤物。 */
  ownSummon:boolean;
  effectiveDefense:number;
}

/**
 * 原版扰乱候选：遍历活动同阵营对象（排除自己），先过矩形格距这一关（格距 +2 ≤ 64），
 * 遇到自己拥有的召唤物立刻选它；否则保留有效防御**严格高于**自己且最高者，相等保留先遇到的。
 */
export function disturbanceCandidate(self:DisturbanceActor,actors:readonly DisturbanceActor[],rangeUnits=64):string|undefined {
  let best:DisturbanceActor|undefined;
  for(const actor of actors){
    if(actor.id===self.id||!actor.sameCamp)continue;
    if(rectDistance(self,actor)+2>rangeUnits)continue;
    if(actor.ownSummon)return actor.id;
    if(actor.effectiveDefense<=self.effectiveDefense)continue;
    if(!best||actor.effectiveDefense>best.effectiveDefense)best=actor;
  }
  return best?.id;
}
