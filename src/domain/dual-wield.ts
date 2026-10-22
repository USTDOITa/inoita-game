/** Equipment contributes to the offhand chance only for the two dual-wield classes. */
export function baseOffhandAttackChance(classId:string,offhandKind:string,armorKind:string):number {
  if(classId!=='assassin'&&classId!=='warrior')return 0;
  const weapon=offhandKind==='dagger'?140:offhandKind==='longsword'?100:offhandKind==='axe'||offhandKind==='mace'?90:0;
  return weapon+(armorKind==='leather'?50:0);
}

/** Eligible attacks draw before reading the current chance, even when that chance is zero. */
export function chooseDualWield(classId:string,hasOffhandWeapon:boolean,ports:{random:()=>number;chance:()=>number}):boolean {
  if((classId!=='assassin'&&classId!=='warrior')||!hasOffhandWeapon)return false;
  const roll=Math.floor(ports.random()*999)+1;
  return roll<Math.max(0,ports.chance());
}

/** The offhand replaces the main weapon contribution and halves the remaining raw attack. */
export function offhandPhysicalAttack(physicalAttack:number,mainHandPower:number,offhandPower:number):number {
  return Math.floor((physicalAttack-mainHandPower)/2)+offhandPower;
}
