import type { CombatUnit } from './battle.ts';

/** 阈值为 1000 时必成；其余情况对 1–999 的随机整数做严格小于比较。 */
export function passesChanceThreshold(threshold:number,random:()=>number=Math.random):boolean {
  return threshold===1000||Math.floor(random()*999)+1<threshold;
}
export function resolveActionState(unit:Extract<CombatUnit,{effect:'state'}>,rank:number,random:()=>number=Math.random){
  const values=unit.ranks[Math.min(unit.ranks.length-1,Math.max(0,rank-1))];
  if(!values)return {applies:false,durationMs:0};
  return {applies:passesChanceThreshold(values.chanceThreshold,random),durationMs:values.durationMs};
}
