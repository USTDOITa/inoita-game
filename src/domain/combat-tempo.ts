/** 攻速只调整普攻结束帧；出手帧和每帧时长不变。属性负数按原版读值夹到零。 */
export function attackCycleFrames(baseFrames:number,attackSpeedRate:number,strikeFrame:number):number {
  const adjusted=baseFrames+Math.trunc(baseFrames*(1000-Math.max(0,attackSpeedRate))/1000);
  return Math.max(adjusted,strikeFrame+1);
}
