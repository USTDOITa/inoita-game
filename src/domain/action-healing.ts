/** 普通治疗读取施法者治疗倍率；零倍率保持基础量，正倍率乘后向零取整。 */
export function actionHealing(amount:number,healingPowerRate:number):number {
  const rate=Math.max(0,healingPowerRate);
  return rate>0?Math.trunc(amount*rate/1000):amount;
}
