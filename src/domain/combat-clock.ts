import {LOGIC_FRAME_MS} from './battle.ts';

export interface CombatClockState {frame:number;remainderMs:number}

/** 所有战斗角色在一次逻辑步内读取同一帧号。 */
export class CombatClock {
  private frame=0;
  private remainderMs=0;

  get currentFrame():number {return this.frame;}
  get fractionalMs():number {return this.remainderMs;}

  advance(deltaMs:number,step:(frame:number)=>unknown):void {
    if(!Number.isFinite(deltaMs)||deltaMs<=0)return;
    let pendingMs=deltaMs;
    while(pendingMs>=LOGIC_FRAME_MS-this.remainderMs){
      pendingMs-=LOGIC_FRAME_MS-this.remainderMs;
      this.remainderMs=0;
      this.frame++;
      if(step(this.frame)===false)return;
    }
    this.remainderMs+=pendingMs;
  }

  captureState():CombatClockState {return {frame:this.frame,remainderMs:this.remainderMs};}
  restoreState(state:CombatClockState):void {
    if(!Number.isSafeInteger(state.frame)||state.frame<0||!Number.isFinite(state.remainderMs)||state.remainderMs<0||state.remainderMs>=LOGIC_FRAME_MS)
      throw new Error('战斗时钟状态无效');
    this.frame=state.frame;this.remainderMs=state.remainderMs;
  }
}
