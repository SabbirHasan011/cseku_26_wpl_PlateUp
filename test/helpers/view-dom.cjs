// A small DOM double for lifecycle tests. Unlike the legacy harness, missing IDs
// return null. Nodes come from the actual HTML partials, not invented placeholders.
function viewDOM() {
  const mounted = [], listeners = new Map(), listenerCounts = new Map();
  function node(tag, attributes = {}) {
    const values = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    const result = {
      tagName: tag.toUpperCase(), id: attributes.id, attributes: Object.entries(attributes).map(([name,value])=>({name,value})),
      dataset: Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase()),value])),
      value: attributes.value || '', textContent: '', hidden: Object.hasOwn(attributes,'hidden'), disabled: false,
      style: {}, isConnected: false, children: [], files: [],
      classList: { add: value=>values.add(value), remove: value=>values.delete(value), contains:value=>values.has(value),
        toggle(value, force) { const add=force ?? !values.has(value); if(add) values.add(value); else values.delete(value); return add; } },
      setAttribute(name,value) { attributes[name]=value; },
      getAttribute(name) { return attributes[name]??null; },
      addEventListener(type,fn) { const key=(result.id||tag)+':'+type; listenerCounts.set(key,(listenerCounts.get(key)||0)+1); listeners.set(key,fn); },
      appendChild(fragment) { result.children.push(...fragment.nodes); mounted.push(...fragment.nodes); fragment.nodes.forEach(n=>n.isConnected=true); },
      focus() { document.activeElement=result; }, reset() {}, contains() { return false; }, getClientRects() { return [{}]; },
      querySelectorAll(selector) { return select(result.children,selector); },
      querySelector(selector) { return result.querySelectorAll(selector)[0] || null; }
    };
    let html='';
    Object.defineProperty(result,'innerHTML',{ get:()=>html, set(value) {
      html=value;
      const previous=new Set(result.children);
      for(let i=mounted.length-1;i>=0;i--) if(previous.has(mounted[i])) mounted.splice(i,1);
      result.children=parse(value);
      if(result.isConnected) mounted.push(...result.children);
    } });
    return result;
  }
  function parse(html) {
    return [...html.matchAll(/<([a-z][\w-]*)\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi)].map(match=>{
      const attributes={};
      for(const attr of match[2].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[attr[1]]=attr[2]??attr[3]??attr[4]??'';
      return node(match[1],attributes);
    });
  }
  function select(nodes,selector) {
    if(selector==='*')return nodes;
    if(selector==='script,html,body')return nodes.filter(n=>['SCRIPT','HTML','BODY'].includes(n.tagName));
    const part=selector.split(' ').at(-1);
    return nodes.filter(n=>part.startsWith('#')?n.id===part.slice(1):part.startsWith('.')?n.classList.contains(part.slice(1)):
      part.startsWith('[data-')?Object.hasOwn(n.dataset,part.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())):n.tagName===part.toUpperCase());
  }
  const document = {
    visibilityState:'visible', activeElement:null,
    getElementById:id=>mounted.find(n=>n.id===id)||null,
    querySelectorAll:selector=>select(mounted,selector),
    querySelector:selector=>select(mounted,selector)[0]||null,
    addEventListener(type,fn) { listeners.set(type,fn);listenerCounts.set(type,(listenerCounts.get(type)||0)+1); },
    createElement(tag) {
      if(tag!=='template')return node(tag);
      return { set innerHTML(html) { const nodes=parse(html);this.content={nodes,firstElementChild:nodes[0],querySelector:selector=>select(nodes,selector)[0]||null,querySelectorAll:selector=>select(nodes,selector)}; } };
    }
  };
  document.body=node('body');
  for(const id of ['app','navbar','dialogs','app-status','app-status-message','app-retry','app-notice','app-notice-message']) {
    const n=node('div',{id});n.isConnected=true;mounted.push(n);
  }
  return {document,listeners,listenerCounts,mounted};
}
module.exports={viewDOM};
