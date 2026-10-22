interface ActionDispatchPort {
  isStealthed():boolean;
  work():void;
  removeStealth():void;
  afterStealthBreak?():void;
  sound?():void;
}

export function runActionDispatch(breaksStealth:boolean,port:ActionDispatchPort):void {
  const enteredStealthed=breaksStealth&&port.isStealthed();
  port.work();
  if(enteredStealthed){
    port.removeStealth();
    port.afterStealthBreak?.();
  }
  port.sound?.();
}
