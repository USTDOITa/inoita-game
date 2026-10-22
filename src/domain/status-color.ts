export interface StatusColor { red:number;green:number;blue:number }

/** 原版按 screen 运算叠加 RGB；每个逻辑帧循环到下一项。 */
export function statusColorMatrix(colors:readonly StatusColor[],logicalFrame:number,hitFlash=false,blackBackdrop=false):number[] {
  const color=colors[Math.max(0,logicalFrame)%colors.length]!;
  // add 与 screen 都以黑色为混合单位元（原版逐帧滤镜里加黑/滤色黑都等于原画面）。
  // 颜色矩阵必须保持 0 → 0，否则整块黑色背景会被抬成灰白色，受击闪白时表现为方形白块。
  // 普通层与正片叠底层没有这个单位元背景，继续用 screen + gamma 的原版语义。
  if(blackBackdrop){
    const gain=hitFlash?1.5:1;
    return [gain*(1+color.red/255),0,0,0,0,
            0,gain*(1+color.green/255),0,0,0,
            0,0,gain*(1+color.blue/255),0,0,
            0,0,0,1,0];
  }
  const matrix=[1-color.red/255,0,0,0,color.red,
          0,1-color.green/255,0,0,color.green,
          0,0,1-color.blue/255,0,color.blue,
          0,0,0,1,0];
  // GRP_SetGamma(50): c + ((256-c)*128 >> 8), followed by buff coloring.
  if(hitFlash)for(const [scale,offset] of [[0,4],[6,9],[12,14]]){
    matrix[offset]+=128*matrix[scale];matrix[scale]*=.5;
  }
  return matrix;
}
