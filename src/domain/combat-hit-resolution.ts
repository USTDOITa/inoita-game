/** One synchronous hit and its nested reactions share a final health check. */
export class CombatHitResolution {
  private depth=0;
  private readonly finalizers=new Map<string,()=>void>();

  run<T>(resolve:()=>T):T {
    this.depth++;
    try{return resolve();}
    finally{
      this.depth--;
      if(this.depth===0){
        const finalizers=[...this.finalizers.values()];
        this.finalizers.clear();
        for(const finalize of finalizers)finalize();
      }
    }
  }

  /** The callback checks current HP before beginning the normal defeat lifecycle. */
  deferDefeat(id:string,finalizeIfStillZero:()=>void):void {
    if(this.depth===0){finalizeIfStillZero();return;}
    this.finalizers.set(id,finalizeIfStillZero);
  }

  isAwaitingDefeat(id:string):boolean {
    return this.depth>0&&this.finalizers.has(id);
  }
}
