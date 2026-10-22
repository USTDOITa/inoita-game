import {rollChaos,type ChaosTier,type ChaosRule} from './chaos-equipment.ts';
import type {ItemCatalog,ItemReward} from './items.ts';
import type {Session} from './session.ts';

interface CraftingOperation {name:string;costPerLevel:number;materials:ItemReward[];rule:ChaosRule}
export interface CraftingCatalog {operations:Record<ChaosTier,CraftingOperation>}
type CraftingNotice='craft-target'|'craft-incompatible'|'craft-epic'|'craft-needs-chaos'|'craft-max'|'craft-money'|'craft-materials';
export class CraftingError extends Error {
  readonly notice:CraftingNotice;
  constructor(notice:CraftingNotice){super('无法进行合成');this.notice=notice;}
}
export interface CraftingQuote {readonly tier:ChaosTier;readonly target:string;readonly revision:number;readonly cost:number}

export function parseCrafting(value:unknown):CraftingCatalog {
  const fail=()=>{throw new Error('合成目录无效');};
  if(!value||typeof value!=='object')fail();
  const data=value as CraftingCatalog;
  if(!data.operations||Object.keys(data.operations).length!==2)fail();
  const integer=(n:unknown):n is number=>Number.isSafeInteger(n);
  for(const tier of ['chaos','epic-chaos'] as const){
    const op=data.operations[tier];
    if(!op||typeof op.name!=='string'||!op.name.trim()||!integer(op.costPerLevel)||op.costPerLevel<=0||!Array.isArray(op.materials)||op.materials.length!==4)fail();
    if(op.materials.some(m=>!m||typeof m.item!=='string'||!m.item||!integer(m.quantity)||m.quantity<=0)||new Set(op.materials.map(m=>m.item)).size!==4)fail();
    const rule=op.rule;
    if(!rule||!integer(rule.levelDiceDivisor)||rule.levelDiceDivisor<=0||!integer(rule.levelClampDivisor)||rule.levelClampDivisor<=0)fail();
    for(const pair of [rule.valueDelta,rule.valueBounds])if(!Array.isArray(pair)||pair.length!==2||!pair.every(integer)||pair[0]>pair[1])fail();
    if(rule.valueBounds[0]!==0||rule.valueBounds[1]!== (tier==='chaos'?150:200))fail();
  }
  return data;
}
export function validateCrafting(catalog:CraftingCatalog,items:ItemCatalog):void {
  for(const op of Object.values(catalog.operations))for(const material of op.materials)
    if(!items.items[material.item]||items.items[material.item].equipment||items.items[material.item].pickup)throw new Error(`合成材料不存在：${material.item}`);
}

/** 先核对装备、材料和费用，确认时重新核对，再一次性提交给会话。 */
export class EquipmentCrafting {
  readonly session:Session;readonly catalog:CraftingCatalog;
  constructor(session:Session,catalog:CraftingCatalog){this.session=session;this.catalog=catalog;}
  targetProblem(tier:ChaosTier,target?:string):CraftingNotice|undefined {
    const bag=this.session.bag,entry=target?bag.get(target):undefined;
    if(!entry||!bag.entries.some(e=>e.id===target))return 'craft-target';
    const item=bag.catalog.items[entry.item];
    if(!entry.numbers||!item.equipment||!['weapon','armor'].includes(item.priceKind??''))return 'craft-incompatible';
    const chaos=entry.numbers.chaos;
    if(tier==='chaos'){
      if(chaos?.tier==='epic-chaos')return 'craft-epic';
      if((chaos?.valuePercent??100)>=this.catalog.operations.chaos.rule.valueBounds[1])return 'craft-max';
    }else{
      if(!chaos)return 'craft-needs-chaos';
      if(chaos.tier==='epic-chaos'&&chaos.valuePercent>=this.catalog.operations['epic-chaos'].rule.valueBounds[1])return 'craft-max';
    }
    return undefined;
  }
  quote(tier:ChaosTier,target?:string):CraftingQuote {
    const problem=this.targetProblem(tier,target);if(problem)throw new CraftingError(problem);
    const bag=this.session.bag,entry=bag.get(target!)!,op=this.catalog.operations[tier],cost=bag.catalog.items[entry.item].level*op.costPerLevel;
    if(op.materials.some(m=>bag.count(m.item)<m.quantity))throw new CraftingError('craft-materials');
    if(this.session.money<cost)throw new CraftingError('craft-money');
    return {tier,target:target!,revision:bag.revision,cost};
  }
  commit(quote:CraftingQuote,random:()=>number=Math.random):void {
    const bag=this.session.bag;
    if(bag.revision!==quote.revision)throw new CraftingError('craft-target');
    const current=this.quote(quote.tier,quote.target),entry=bag.get(current.target)!,op=this.catalog.operations[current.tier];
    const chaos=rollChaos(bag.catalog.items[entry.item],entry,current.tier,op.rule,random);
    // Random callbacks and other callers may have changed inventory or money since the first query.
    if(bag.revision!==current.revision)throw new CraftingError('craft-target');
    this.quote(current.tier,current.target);
    this.session.transaction(()=>{
      bag.applyChaos(current.target,chaos,current.revision);
      for(const material of op.materials)bag.remove(material.item,material.quantity);
      this.session.spendMoney(current.cost);
    });
  }
}
