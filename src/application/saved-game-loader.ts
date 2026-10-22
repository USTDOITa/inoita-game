import type { SaveSlotRef } from '../domain/save-game.ts';

export interface SavedGameLoadPort<T> {
  prepare(slot:SaveSlotRef,signal:AbortSignal):Promise<T>;
  isCurrent():boolean;
  stopCurrent():Promise<void>;
  install(candidate:T,lifetime:AbortController):void;
}

function prepareUntilCancelled<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',abort);
    const abort=()=>{cleanup();reject(signal.reason);};
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    work.then(candidate=>{cleanup();if(signal.aborted)reject(signal.reason);else resolve(candidate);},error=>{cleanup();reject(error);});
  });
}

/** 先准备候选会话，旧场景清理完成后才安装。菜单取消信号只持有准备阶段。 */
export class SavedGameLoader {
  private request?:AbortController;
  get busy():boolean{return !!this.request;}
  cancel():void{this.request?.abort();this.request=undefined;}
  async load<T>(slot:SaveSlotRef,port:SavedGameLoadPort<T>,signal?:AbortSignal):Promise<void> {
    signal?.throwIfAborted();
    if(this.busy)throw new Error('正在读取存档，请稍候。');
    const request=new AbortController();this.request=request;
    const abort=()=>request.abort(signal?.reason);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const candidate=await prepareUntilCancelled(port.prepare(slot,request.signal),request.signal);
      request.signal.throwIfAborted();
      if(!port.isCurrent())throw new DOMException('读档入口已关闭','AbortError');
      signal?.removeEventListener('abort',abort);
      await port.stopCurrent();
      request.signal.throwIfAborted();
      port.install(candidate,request);
    }catch(error){if(request.signal.aborted)request.signal.throwIfAborted();request.abort(error);throw error;}
    finally{signal?.removeEventListener('abort',abort);if(this.request===request)this.request=undefined;}
  }
}
