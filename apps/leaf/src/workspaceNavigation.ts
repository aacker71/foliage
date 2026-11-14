/** Route identities shared by native documents and the React workflow. No UI or backend imports.
 * Home is `/`, the page the launcher opens: the wordmark and the first rail item both return there. */
export function workspaceNavigation(current: string, options: { showPortfolioAction?: boolean } = {}) {
  const primary = [
    { key:"home", label:"Home", href:"/" },
    { key:"work", label:"Work", href:"/leaf/photosynthesis" },
    { key:"review", label:"Review", href:"/review" },
    { key:"portfolio", label:"Portfolio", href:"/leaf" },
    { key:"sources", label:"Sources", href:"/workflow#sources" },
  ];
  const tools = [
    {key:"journey",label:"Scarlet",href:"/leaf/scarlet"},
    {key:"reflection",label:"Reflection",href:"/leaf/reflection"},
    {key:"scarlet",label:"Photosynthesis",href:"/scarlet/workspace"},
    {key:"import",label:"Import",href:"/leaf/import"},
    {key:"policy",label:"Policy",href:"/policy"},
    {key:"publish",label:"Publish",href:"/publish"},
    {key:"garden",label:"Harvest log",href:"/garden"},
  ];
  const selected = current === "overview" ? "home" : current === "leaf" ? "portfolio" : current === "workflow" ? "sources" : current;
  const selectedTool = tools.find(item => item.key === selected);
  const action = current === "portfolio" ? undefined : { label:"Edit portfolio", href:"/leaf/setup" };
  return { home:"/",layout:"rail" as const,plane:"studio" as const,
    links:primary.map(item=>({...item,current:item.key===selected})),
    tools:tools.filter(item=>item.key!==selected).map(item=>({...item,current:false})),
    ...(selectedTool ? { currentTool:selectedTool.label } : {}),
    privacy:"Private workspace",
    ...(options.showPortfolioAction === false || !action ? {} : { action }) };
}
