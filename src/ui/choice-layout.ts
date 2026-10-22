/**
 * 剧情/任务选项面板的竖排布局。场景负责量文字高度，这里只算几何：
 * 面板尽量向上长到放得下所有选项，放不下时选项区滚动，按钮高度始终够放下换行后的标签。
 */
export interface ChoiceLayoutInput {
  promptHeight: number;
  descriptionHeight?: number;
  /** 每个选项标签按选项宽度换行后的实际文字高度。 */
  optionTextHeights: readonly number[];
  optionHeight?: number;
  gap?: number;
  bottom?: number;
  topLimit?: number;
  paddingTop?: number;
  paddingBottom?: number;
  descriptionGap?: number;
  descriptionView?: number;
  textPadding?: number;
}

export interface ChoiceLayout {
  top: number;
  panelHeight: number;
  promptY: number;
  descriptionY?: number;
  descriptionView?: number;
  listY: number;
  listViewport: number;
  contentHeight: number;
  options: { y: number; height: number }[];
}

export function layoutChoicePanel(input: ChoiceLayoutInput): ChoiceLayout {
  const optionHeight=input.optionHeight??56,gap=input.gap??8,bottom=input.bottom??620,topLimit=input.topLimit??20,
    paddingTop=input.paddingTop??14,paddingBottom=input.paddingBottom??16,descriptionGap=input.descriptionGap??10,
    descriptionView=input.descriptionView??44,textPadding=input.textPadding??20;
  const heights=input.optionTextHeights.map(height=>Math.max(optionHeight,height+textPadding));
  const contentHeight=heights.reduce((sum,height)=>sum+height,0)+Math.max(0,heights.length-1)*gap;
  const descriptionVisible=input.descriptionHeight!==undefined&&input.descriptionHeight>0;
  const view=descriptionVisible?Math.min(descriptionView,input.descriptionHeight!):0;
  const header=paddingTop+input.promptHeight+(descriptionVisible?view+descriptionGap:0)+16;
  const panelHeight=Math.min(bottom-topLimit,header+contentHeight+paddingBottom),top=bottom-panelHeight;
  const promptY=top+paddingTop;
  let y=promptY+input.promptHeight;
  const descriptionY=descriptionVisible?y+descriptionGap:undefined;
  if(descriptionVisible)y+=descriptionGap+view;
  y+=16;
  const available=top+panelHeight-paddingBottom-y;
  const listViewport=Math.max(optionHeight,Math.min(available,contentHeight));
  let offset=0;
  const options=heights.map(height=>{const value={y:offset,height};offset+=height+gap;return value;});
  return {top,panelHeight,promptY,descriptionY,descriptionView:descriptionVisible?view:undefined,listY:y,listViewport,contentHeight,options};
}
