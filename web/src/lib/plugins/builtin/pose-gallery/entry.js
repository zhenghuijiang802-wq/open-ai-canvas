import {createCatalog, groups, select} from './core.js';

let gallerySequence=0;

// This mount function is used by the Yingce source adapter and the local preview.
// It does not assume an undocumented sandbox RPC or access host cookies.
export function mountGallery(root, {catalog=createCatalog(), onImport, importLabel='导入当前素材库', importSuccessText='已加入当前素材库，可从画布素材选择器使用', licenseText='CC0 1.0 公有领域协议（免署名，完全支持商业使用）。'} = {}) {
  const abort=new AbortController(); let rows=[], page=0, filtered=[], active=null, opener=null, busy=false, selectedSystem='';
  const panelId=`pose-gallery-results-${++gallerySequence}`;
  const size=30;
  root.classList.add('pose-gallery');
  root.innerHTML=`<header><div><span class="pg-kicker">POSE REFERENCE / 姿势参考</span><h1>找到动作的表达</h1><p>中文检索 · 多角度查看 · 选取原图</p></div><button type="button" class="pg-reload">重新加载</button></header>
  <div class="pg-system-tabs" role="tablist" aria-label="姿势分组"></div><p class="pg-license"></p><div class="pg-filters"><label>搜索姿势<input type="search" placeholder="动作、编号、分类或视角"></label><label>动作分类<select class="pg-category"><option value="">全部分类</option></select></label><label>视角<select class="pg-angle"><option value="">全部视角</option></select></label><button class="pg-reset" type="button">重置</button></div>
  <div class="pg-bar"><p class="pg-count" aria-live="polite"></p><label><input type="checkbox" class="pg-grouped" checked> 按姿势分组</label></div><p class="pg-status" role="status"></p><div class="pg-grid"></div><nav aria-label="图库分页"><button class="pg-prev">上一页</button><span class="pg-page"></span><button class="pg-next">下一页</button></nav>
  <dialog><div class="pg-modal"><button class="pg-close" aria-label="关闭预览">关闭 ×</button><img class="pg-large" alt=""><div class="pg-detail"><h2></h2><p class="pg-meta"></p><div class="pg-angles" aria-label="姿势视角"></div><p class="pg-modal-status" role="status"></p><div class="pg-actions"><button class="pg-import">导入当前素材库</button><button class="pg-copy">复制姿势描述</button><a class="pg-original" target="_blank" rel="noopener noreferrer">打开原图 ↗</a></div><p class="pg-attribution"></p></div></div></dialog>`;
  const $=s=>root.querySelector(s), status=$('.pg-status'), grid=$('.pg-grid'), dialog=$('dialog');
  grid.id=panelId; grid.setAttribute('role','tabpanel');
  const listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
  $('.pg-import').textContent=importLabel;
  $('.pg-license').textContent=licenseText; $('.pg-attribution').textContent='来源：wquguru/shisei · 协议：CC0 1.0 公有领域（完全支持商用）。'+licenseText;
  if(!onImport) { $('.pg-import').disabled=true; $('.pg-import').textContent='在影策中可导入'; }
  const message=e=>e instanceof Error?e.message:String(e);
  const image=(row,large=false)=>{const img=document.createElement('img'); img.src=large?row.fileUrl:row.thumbnailUrl; img.alt=row.title+' · '+row.angle; img.loading='lazy'; img.referrerPolicy='no-referrer'; return img;};
  function syncSystemTabs() {
    for(const tab of root.querySelectorAll('.pg-system-tab')) {
      const selected=tab.dataset.system===selectedSystem;
      tab.setAttribute('aria-selected',String(selected)); tab.tabIndex=selected?0:-1;
      if(selected) grid.setAttribute('aria-labelledby',tab.id);
    }
  }
  function renderSystemTabs() {
    const systems=[...new Set(rows.map(row=>row.system))];
    if(!systems.includes(selectedSystem)) selectedSystem='';
    const tabs=$('.pg-system-tabs'); tabs.replaceChildren();
    for(const [index,system] of ['',...systems].entries()) {
      const members=system?rows.filter(row=>row.system===system):rows;
      const tab=document.createElement('button'),name=document.createElement('span'),count=document.createElement('small');
      tab.type='button'; tab.className='pg-system-tab'; tab.id=`${panelId}-tab-${index}`; tab.dataset.system=system;
      tab.setAttribute('role','tab'); tab.setAttribute('aria-controls',panelId);
      name.textContent=system||'全部'; count.textContent=`${members.length.toLocaleString('zh-CN')} 张 · ${groups(members).length} 组`;
      tab.append(name,count); tab.onclick=()=>{selectedSystem=system;page=0;render();}; tabs.append(tab);
    }
    syncSystemTabs();
  }
  function show(row,button) {
    active=row; if(button) opener=button;
    const img=$('.pg-large'); img.src=row.fileUrl; img.alt=row.title+' · '+row.angle; img.referrerPolicy='no-referrer';
    $('.pg-detail h2').textContent=row.title; $('.pg-meta').textContent=[row.system,row.category,row.code,row.angle].join(' / ');
    $('.pg-original').href=row.fileUrl; $('.pg-modal-status').textContent='';
    const angles=$('.pg-angles'); angles.replaceChildren();
    for(const r of rows.filter(x=>x.group===row.group)) {const b=document.createElement('button'); b.type='button'; b.textContent=r.angle; b.setAttribute('aria-pressed',String(r.id===row.id)); b.onclick=()=>show(r); angles.append(b);}
    if(!dialog.open) dialog.showModal();
  }
  function render() {
    syncSystemTabs();
    const found=select(rows,{keyword:$('input[type=search]').value,system:selectedSystem,category:$('.pg-category').value,angle:$('.pg-angle').value,limit:5000});
    filtered=$('.pg-grouped').checked?groups(found.rows):found.rows.map(r=>[r]);
    const pages=Math.max(1,Math.ceil(filtered.length/size)); page=Math.min(page,pages-1);
    $('.pg-count').textContent=`${filtered.length} ${$('.pg-grouped').checked?'组姿势':'张参考图'} · ${found.total} 张图片`;
    $('.pg-page').textContent=`${page+1} / ${pages}`; $('.pg-prev').disabled=page===0; $('.pg-next').disabled=page>=pages-1;
    grid.replaceChildren();
    if(!filtered.length) {status.textContent='没有匹配的姿势，试试其他关键词或重置筛选。';return;}
    status.textContent='';
    for(const set of filtered.slice(page*size,(page+1)*size)) {
      const row=set[0],card=document.createElement('article'),b=document.createElement('button'),title=document.createElement('h2'),meta=document.createElement('p'),angles=document.createElement('div');
      card.className='pg-card'; b.className='pg-cover'; b.type='button'; b.setAttribute('aria-label','预览 '+row.title); b.append(image(row)); b.onclick=()=>show(row,b);
      title.textContent=row.title; meta.textContent=row.code+' · '+row.category; angles.className='pg-card-angles';
      for(const r of set) {const a=document.createElement('button'); a.type='button';a.textContent=r.angle;a.onclick=()=>show(r,a); angles.append(a);}
      card.append(b,title,meta,angles);grid.append(card);
    }
  }
  async function load() {
    status.textContent='正在读取姿势索引…'; $('.pg-reload').disabled=true;
    try {rows=await catalog.load(abort.signal); if(abort.signal.aborted)return;
      renderSystemTabs();
      for(const [selector,key] of [['.pg-category','category'],['.pg-angle','angle']]) { const sel=$(selector); const previous=sel.value; while(sel.options.length>1)sel.remove(1); for(const v of [...new Set(rows.map(r=>r[key]))])sel.add(new Option(v,v));sel.value=previous;}
      render();
    } catch(e) {if(!abort.signal.aborted)status.textContent='加载失败：'+message(e)+'。可点击重新加载。';}
    finally {if(!abort.signal.aborted)$('.pg-reload').disabled=false;}
  }
  for(const el of root.querySelectorAll('.pg-filters input,.pg-filters select,.pg-grouped'))listen(el,el.tagName==='INPUT'&&el.type==='search'?'input':'change',()=>{page=0;render();});
  listen($('.pg-reset'),'click',()=>{for(const el of root.querySelectorAll('.pg-filters input,.pg-filters select'))el.value='';selectedSystem='';page=0;render();});
  listen($('.pg-system-tabs'),'keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    if(!(event.target instanceof Element))return;
    const tabs=[...root.querySelectorAll('.pg-system-tab')],at=tabs.indexOf(event.target.closest('[role=tab]'));
    if(at<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(at+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
    tabs[next].focus({preventScroll:true}); tabs[next].click();
  });
  listen($('.pg-prev'),'click',()=>{page--;render();grid.scrollIntoView({block:'start'});});listen($('.pg-next'),'click',()=>{page++;render();grid.scrollIntoView({block:'start'});});
  listen($('.pg-reload'),'click',load);listen($('.pg-close'),'click',()=>dialog.close());listen(dialog,'close',()=>opener?.focus());
  listen(dialog,'keydown',e=>{if(!active||!['ArrowLeft','ArrowRight'].includes(e.key))return; const variants=rows.filter(r=>r.group===active.group);const at=variants.findIndex(r=>r.id===active.id);e.preventDefault();show(variants[(at+(e.key==='ArrowRight'?1:variants.length-1))%variants.length]);});
  listen($('.pg-copy'),'click',async()=>{try{await navigator.clipboard.writeText([active.title,active.angle,active.category,active.id].join(' · '));$('.pg-modal-status').textContent='姿势描述已复制';}catch{$('.pg-modal-status').textContent='复制失败，可从上方选中文字手动复制';}});
  listen($('.pg-import'),'click',async()=>{if(!active||busy||!onImport)return;const row=active;busy=true;$('.pg-import').disabled=true;$('.pg-modal-status').textContent='正在下载并导入原图…';try{await onImport(row,abort.signal);if(!abort.signal.aborted)$('.pg-modal-status').textContent=importSuccessText;}catch(e){if(!abort.signal.aborted)$('.pg-modal-status').textContent='导入失败：'+message(e);}finally{busy=false;if(!abort.signal.aborted)$('.pg-import').disabled=false;}});
  listen($('.pg-large'),'error',()=>{$('.pg-modal-status').textContent='原图加载失败，请检查图库地址或网络。';});
  void load();
  return ()=>{abort.abort();dialog.close();root.replaceChildren();root.classList.remove('pose-gallery');};
}
