const indexes=new WeakMap<readonly object[],Map<string,object>>();

/** 保留数组的枚举顺序，按身份查询走索引。名单增删后由持有者刷新索引。 */
export function combatActor<T extends object>(actors:readonly T[],id:string,key:(actor:T)=>string):T|undefined {
  let index=indexes.get(actors);
  if(!index){index=new Map(actors.map(actor=>[key(actor),actor]));indexes.set(actors,index);}
  return index.get(id) as T|undefined;
}
export function refreshCombatActors(actors:readonly object[]):void {indexes.delete(actors);}
