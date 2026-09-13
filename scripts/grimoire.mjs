import {ID,clone,esc,own,reference,cleanTags} from './core.mjs';
import {profiles,saveProfile,deleteProfile,exportProfiles,importProfiles,shortcut} from './profiles.mjs';
import {pageLinks,openPage} from './references.mjs';
import {download,confirm} from './ui.mjs';
import {CastingWindow,openCharacterSheet} from './application.mjs';
import {activeProfile} from './effects.mjs';
import {catalogue,filterItems,sortItems,facets,bookmarksFor,bookmarkFor,bookmarkMatches,RULE_LABELS,plainText} from './grimoire-model.mjs';

const App=CastingWindow;
const button=(action,label,attrs='')=>`<button type="button" data-grimoire="${action}" ${attrs}>${label}</button>`;
const option=(v,l,selected)=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(l)}</option>`;
const choose=(field,label,choices,selected)=>`<label><span>${label}</span><select data-browse="${field}">${choices.map(([v,l])=>option(v,l,selected)).join('')}</select></label>`;
const textBlock=text=>`<div class="gca-book-text">${esc(text)}</div>`;
const numberLabel=n=>n==null||!Number.isFinite(n)?'—':n;
const viewDefaults=()=>({query:'',college:'',class:'',rules:'',tag:'',sort:'name',favourites:false});

async function metadataDialog(profile) {
  const content=document.createElement('div');
  content.innerHTML=`<div class="gca-book-dialog"><label>Build name<input name="name" value="${esc(profile.name)}" maxlength="120" required></label><label>Tags<input name="tags" value="${esc((profile.tags||[]).join(', '))}" maxlength="500" placeholder="Healing, combat, utility"></label><p>Separate tags with commas.  These labels are saved with the build.</p></div>`;
  const result=await foundry.applications.api.DialogV2.wait({window:{title:'Build name & tags'},position:{width:480},content,rejectClose:false,
    buttons:[{action:'save',label:'Save',default:true,callback:(_event,b,d)=>new FormData(b.form||d.form||d.element.querySelector('form'))},
      {action:'cancel',label:'Cancel',callback:()=>null}]});
  return result instanceof FormData?{name:String(result.get('name')||'').trim(),tags:cleanTags(result.get('tags'))}:null;
}

export class Grimoire extends App {
  static DEFAULT_OPTIONS={id:'gga-casting-grimoire',tag:'section',classes:['gca-window','gca-grimoire-window'],
    window:{title:'Grimoire',icon:'fa-solid fa-book-open',resizable:true},position:{width:1180,height:800}};
  constructor(actor,actions) {
    const raw=clone(game.user.getFlag(ID,'grimoirePreferences')||{}),position=raw.position||{};
    super({position:{width:Math.max(560,Math.min(position.width||1180,window.innerWidth-30)),height:Math.max(440,Math.min(position.height||800,window.innerHeight-50))}});
    this.actor=actor;this.actions=actions;this.selected=null;this.busy=false;this.status='Select an entry to explore it.';
    this.prefs={tab:['spells','skills','builds'].includes(raw.tab)?raw.tab:'spells',layout:raw.layout==='list'?'list':'cards',
      views:Object.fromEntries(['spells','skills','builds'].map(t=>[t,{...viewDefaults(),...raw.views?.[t]}]))};
    this._saveQueue=Promise.resolve();
  }
  get filters(){return {...this.prefs.views[this.prefs.tab],tab:this.prefs.tab};}
  items(){return catalogue(this.actor,bookmarksFor(this.actor));}
  async persist() {
    const prefs=clone(this.prefs);prefs.position={width:this.position.width,height:this.position.height};
    this._saveQueue=this._saveQueue.catch(()=>{}).then(()=>game.user.setFlag(ID,'grimoirePreferences',prefs));return this._saveQueue;
  }
  async close(options) {clearTimeout(this._refreshTimer);await this.persist();return super.close(options);}
  async selectActor(actor) {if(this.busy)throw new Error('Finish the current build operation before changing character.');own(actor);this.actor=actor;this.selected=null;this.status='Select an entry to explore it.';await this.renderQuiet();}
  refreshActor(actor) {
    if(actor?.uuid!==this.actor.uuid)return;
    clearTimeout(this._refreshTimer);this._refreshTimer=setTimeout(()=>{if(this.rendered&&!this.busy)this.renderQuiet();},100);
  }
  error(error) {this.status=error.message;ui.notifications.error(error.message);console.error(ID,error);if(this.rendered)this.renderQuiet();}
  card(item) {
    const profile=item.type==='profile',colour=profile?'build':item.colleges[0]?.toLowerCase().replace(/[^a-z]/g,'')||'other';
    return `<article class="gca-book-card ${item.id===this.selected?'is-selected':''}" data-school="${esc(colour)}">
      ${button('favourite',item.favourite?'★':'☆',`class="gca-book-star" data-id="${esc(item.id)}" aria-label="${item.favourite?'Remove':'Add'} ${esc(item.name)} ${item.favourite?'from':'to'} favourites" aria-pressed="${item.favourite}"`)}
      ${button('select',`<span class="gca-book-card-kind">${esc(profile?RULE_LABELS[item.kind]||item.kind:item.colleges.join(' · ')||'Skill / power')}</span><strong>${esc(item.name)}</strong>
        <span class="gca-book-card-class">${esc(profile?item.profile.ability?.name||'Casting ability not selected':item.fullClass||'Skill')}</span>
        <span class="gca-book-card-stats"><span><small>${profile?'BASE ENERGY':'COST'}</small><b>${esc(item.cost)}</b></span><span><small>SKILL</small><b>${numberLabel(item.level)}</b></span>${!profile?`<span><small>CAST</small><b>${esc(item.castTime)}</b></span>`:''}</span>
        <span class="gca-book-card-bottom">${profile?item.tags.slice(0,3).map(t=>`<span class="gca-book-tag">${esc(t)}</span>`).join(''):''}${item.issues.length?'<span class="gca-book-review">Review setup</span>':''}</span>`,
        `class="gca-book-select" data-id="${esc(item.id)}" aria-pressed="${item.id===this.selected}"`)}${item.pageRef?`<div class="gca-book-card-refs">${pageLinks(item.pageRef)}</div>`:''}
    </article>`;
  }
  details(item) {
    if(!item)return `<div class="gca-book-no-selection"><span aria-hidden="true">◇</span><h3>Your next spell starts here</h3><p>Select a card or row to see its details and prepare a casting setup.</p></div>`;
    const p=item.profile,details=p?[['Skill',numberLabel(item.level)],['Base energy',item.cost],['Type',item.fullClass],
      ...(item.colleges.length?[['College',item.colleges.join(', ')]]:[]),...(item.castTime!=='—'?[['Casting time',item.castTime]]:[]),...(item.duration!=='—'?[['Duration',item.duration]]:[])]:
      [['Skill',numberLabel(item.level)],['Class',item.fullClass||'—'],['College',item.colleges.join(', ')||'—'],['Cost',item.cost],['Maintenance',item.maintain],['Casting time',item.castTime],['Duration',item.duration]];
    const active=p?activeProfile(p):null,effect=active?.effectType==='heal-hp'?'HP healing':active?.effectType==='restore-fp'?'FP recovery':'None';
    const parsed=p?.parsed&&typeof p.parsed==='object'?p.parsed:null;
    return `<header class="gca-book-detail-top"><div class="gca-kicker">${esc(p?'SAVED BUILD':item.kind==='spell'?'SPELL':'SKILL / POWER')}</div><h2>${esc(item.name)}</h2><p>${esc(p?RULE_LABELS[p.rules]||p.rules:item.colleges.join(' · ')||'Character skill')}</p>
      <div class="gca-book-detail-actions">${button('prepare',p?'Open casting setup':'Prepare cast','class="gca-primary"')}${button('favourite',item.favourite?'★ Favourited':'☆ Favourite',`data-id="${esc(item.id)}" aria-pressed="${item.favourite}"`)}</div></header>
      <div class="gca-book-detail-scroll"><section class="gca-book-detail-section"><h3>At a glance</h3><dl>${details.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><div class="gca-book-refs">${pageLinks(item.pageRef)}</div></section>
      ${p?`<section class="gca-book-detail-section"><h3>Casting setup</h3><dl><div><dt>Activation</dt><dd>${esc(p.ability?.name||'Choose ability')}</dd></div><div><dt>Linked attack</dt><dd>${esc(active.attack?.name||'None')}</dd></div><div><dt>Damage</dt><dd>${esc(active.damageFormula||(active.attack?'From linked attack':'None'))}</dd></div><div><dt>Recovery</dt><dd>${esc(effect)}${active.effectType!=='none'?` · ${esc(active.effectAmount)}`:''}</dd></div></dl>
        <div class="gca-book-resources">${(p.rows||[]).map(r=>`<span>${esc(r.name||'Choose resource')} · ${r.amount==='auto'?'remainder':esc(r.amount)}${r.mode==='tally'?' · tally':''}</span>`).join('')}</div>
        ${item.issues.length?`<ul class="gca-book-issues">${item.issues.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}
        <div class="gca-book-tags">${item.tags.map(t=>button('tag',esc(t),`data-value="${esc(t)}" class="gca-book-tag"`)).join('')||'<span class="gca-muted">No tags yet</span>'}</div>
        <div class="gca-book-tools">${button('metadata','Name & tags')}${button('duplicate','Duplicate')}${button('shortcut','Hotbar shortcut')}${button('export','Export')}${button('delete','Delete','class="gca-book-delete"')}</div></section>`:''}
      ${item.notes?`<section class="gca-book-detail-section"><h3>${p?'Your notes':'Sheet notes'}</h3>${textBlock(item.notes)}</section>`:''}
      ${parsed?`<section class="gca-book-detail-section"><h3>Parsed build</h3><dl>${[['Detected energy',parsed.energy??'Not found'],['Spell effects',plainText(parsed.spellEffects)||'—'],['Inherent modifiers',plainText(parsed.inherentModifiers)||'—'],['Greater effects',Array.isArray(parsed.greaterEffects)?parsed.greaterEffects.length:0],['Multiplier',parsed.multiplier==null?'—':`×${parsed.multiplier}`]].map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="gca-hint">The saved casting setup above includes any changes made after parsing.</p></section>`:''}
      ${p?.parserText?`<section class="gca-book-detail-section"><h3>Original build text</h3>${textBlock(p.parserText)}</section>`:''}
      ${!p&&item.setups.length?`<section class="gca-book-detail-section"><h3>Saved casting setups</h3><div class="gca-book-setups">${item.setups.map(s=>button('open-profile',`${esc(s.name)} <span>${s.baseCost} energy</span>`,`data-profile-id="${esc(s.id)}"`)).join('')}</div></section>`:''}
      ${!p&&!item.notes?'<section class="gca-book-detail-section"><p class="gca-hint">Open the PDF reference for the full spell description.</p></section>':''}</div>`;
  }
  async _renderHTML() {
    const root=document.createElement('div');root.className='gca-root gca-book-root';
    const all=this.items(),filters=this.filters,visible=sortItems(filterItems(all,filters),filters.sort),facet=facets(all,this.prefs.tab);
    if(!visible.some(i=>i.id===this.selected))this.selected=visible[0]?.id||null;
    const selected=visible.find(i=>i.id===this.selected),builds=this.prefs.tab==='builds';
    const counts={spells:all.filter(i=>i.type==='ability'&&i.kind==='spell').length,skills:all.filter(i=>i.type==='ability'&&i.kind==='skill').length,builds:all.filter(i=>i.type==='profile').length};
    const actors=[...new Map([this.actor,...Array.from(game.actors||[]).filter(a=>a.testUserPermission(game.user,'OWNER'))].map(a=>[a.uuid,a])).values()];
    root.innerHTML=`<header class="gca-book-header"><div><div class="gca-kicker">GURPS 4e · ${esc(this.actor.name)}</div><h1>Grimoire</h1><p>Spells, powers, and the builds you return to.</p></div><div class="gca-book-header-tools"><label class="gca-sr" for="gca-book-actor">Character</label><select id="gca-book-actor" data-book-actor>${actors.map(a=>option(a.uuid,a.name,this.actor.uuid)).join('')}</select>${button('casting','Casting assistant')}${button('new-build','+ New RPM build','class="gca-primary"')}</div></header>
      <div class="gca-book-navigation"><nav class="gca-tabs" aria-label="Grimoire sections">${[['spells','Spells'],['skills','Skills & powers'],['builds','Saved builds']].map(([t,label])=>button('tab',`${label} <span>${counts[t]}</span>`,`data-tab="${t}" aria-pressed="${this.prefs.tab===t}"`)).join('')}</nav><div class="gca-book-view-tools">${button('favourites',filters.favourites?'★ Favourites':'☆ Favourites',`aria-pressed="${filters.favourites}"`)}<div class="gca-book-layout" aria-label="View">${button('layout','Cards',`data-layout="cards" aria-pressed="${this.prefs.layout==='cards'}"`)}${button('layout','List',`data-layout="list" aria-pressed="${this.prefs.layout==='list'}"`)}</div></div></div>
      <div class="gca-book-filters"><label class="gca-book-search"><span class="gca-sr">Search Grimoire</span><input type="search" data-browse="query" placeholder="${builds?'Search builds, tags, notes, or original text…':'Search name, college, class, or sheet notes…'}" value="${esc(filters.query)}"></label>
        ${builds?choose('rules','Type',[['','All types'],...Object.entries(RULE_LABELS)],filters.rules):choose('college','College',[['','All colleges'],...facet.colleges.map(c=>[c,c])],filters.college)}
        ${builds?choose('tag','Tag',[['','All tags'],...facet.tags.map(t=>[t,t])],filters.tag):choose('class','Class',[['','All classes'],...facet.classes.map(c=>[c,c])],filters.class)}
        ${choose('sort','Sort',[['name','Name A–Z'],['name-desc','Name Z–A'],['skill','Highest skill'],['cost',builds?'Lowest base energy':'Lowest listed cost'],...(!builds?[['college','College']]:[['recent','Recently saved']])],filters.sort)}${button('clear','Clear','title="Clear this view’s filters"')}</div>
      <div class="gca-book-body"><section class="gca-book-browser" aria-label="Entries"><div class="gca-book-count"><span>${visible.length} of ${counts[this.prefs.tab]} ${builds?'saved builds':this.prefs.tab==='skills'?'skills':'spells'}${filters.favourites?' · favourites':''}</span>${builds?`<div>${button('import','Import')}${button('export-view','Export shown',visible.length?'':'disabled')}</div>`:''}</div>
        <div class="gca-book-results ${this.prefs.layout==='list'?'is-list':'is-cards'}" aria-label="Grimoire entries">${visible.length?visible.map(i=>this.card(i)).join(''):`<div class="gca-book-empty"><span aria-hidden="true">◇</span><h2>${counts[this.prefs.tab]?'No matches':'Nothing here yet'}</h2><p>${counts[this.prefs.tab]?'Clear the filters or try another search.':builds?'Save a casting profile or start a new RPM build.':'Entries from this character’s sheet appear here.'}</p>${button(counts[this.prefs.tab]?'clear':builds?'new-build':'sheet',counts[this.prefs.tab]?'Clear filters':builds?'New RPM build':'Open character sheet')}</div>`}</div></section>
        <aside class="gca-book-detail" aria-label="Selected entry">${this.details(selected)}</aside></div>
      <footer class="gca-book-footer"><span role="status">${esc(this.status)}</span><span>Prepare here.  Resolve in the casting assistant.</span></footer><input type="file" data-book-import accept="application/json,.json" hidden>`;
    if(this.busy)root.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    return root;
  }
  _replaceHTML(root,content) {
    const doc=content.ownerDocument,active=content.contains(doc.activeElement)?doc.activeElement:null,field=active?.dataset.browse,start=active?.selectionStart,end=active?.selectionEnd;
    const focusAction=active?.dataset.grimoire,focusData={...active?.dataset};
    const scroll=content.querySelector('.gca-book-results')?.scrollTop||0;
    const detailScroll=this._renderedSelection===this.selected?content.querySelector('.gca-book-detail-scroll')?.scrollTop||0:0;
    content.replaceChildren(root);root.querySelector('.gca-book-results').scrollTop=scroll;
    const detail=root.querySelector('.gca-book-detail-scroll');if(detail)detail.scrollTop=detailScroll;
    if(field){const el=root.querySelector(`[data-browse="${field}"]`);el?.focus();if(el?.type==='search'&&start!=null)el.setSelectionRange(start,end);}
    else if(focusAction){const el=[...root.querySelectorAll('[data-grimoire]')].find(e=>e.dataset.grimoire===focusAction&&['id','tab','layout','value'].every(k=>e.dataset[k]===focusData[k]));el?.focus({preventScroll:true});}
    this._renderedSelection=this.selected;
    root.addEventListener('click',event=>this.click(event).catch(e=>this.error(e)));
    root.addEventListener('input',event=>{if(event.target.dataset.browse==='query')this.change(event).catch(e=>this.error(e));});
    root.addEventListener('change',event=>{if(event.target.tagName==='SELECT'||event.target.hasAttribute('data-book-import'))this.change(event).catch(e=>this.error(e));});
  }
  async change(event) {
    if(this.busy)return;const el=event.target;
    if(el.dataset.browse){this.prefs.views[this.prefs.tab][el.dataset.browse]=el.value;await this.renderQuiet();await this.persist();return;}
    if(el.hasAttribute('data-book-actor')){const actor=await fromUuid(el.value);await this.selectActor(actor);return;}
    if(el.hasAttribute('data-book-import')&&el.files[0]) {
      if(el.files[0].size>3000000)throw new Error('Choose a profile export smaller than 3 MB.');
      await this.work(async()=>{const imported=await importProfiles(this.actor,await el.files[0].text());this.prefs.tab='builds';this.prefs.views.builds=viewDefaults();
        this.selected=imported[0]?`profile:${imported[0].id}`:null;this.status=`Imported ${imported.length} builds.  Review their casting references before use.`;});
    }
  }
  async work(task) {if(this.busy)return;this.busy=true;await this.renderQuiet();try{await task();}finally{this.busy=false;if(this.rendered)await this.renderQuiet();}}
  async click(event) {
    const el=event.target.closest('[data-grimoire],[data-page-ref]');if(!el||this.busy)return;event.preventDefault();
    if(el.dataset.pageRef){event.stopPropagation();await openPage(el.dataset.pageRef);return;}
    const all=this.items(),item=all.find(i=>i.id===(el.dataset.id||this.selected)),action=el.dataset.grimoire;
    const currentProfile=()=>{const p=profiles(this.actor).find(p=>p.id===item?.profile?.id);if(!p)throw new Error('This build is no longer saved.');return p;};
    switch(action) {
      case 'select':this.selected=el.dataset.id;this.status='Use Prepare cast to open a casting setup.';break;
      case 'tab':this.prefs.tab=el.dataset.tab;this.selected=null;break;
      case 'layout':this.prefs.layout=el.dataset.layout;break;
      case 'clear':this.prefs.views[this.prefs.tab]=viewDefaults();break;
      case 'favourites':this.prefs.views[this.prefs.tab].favourites=!this.filters.favourites;break;
      case 'tag':this.prefs.views.builds.tag=el.dataset.value;break;
      case 'favourite': {
        if(!item)return;const allMarks=clone(game.user.getFlag(ID,'grimoireFavourites')||[]);
        const index=allMarks.findIndex(m=>m.actorUuid===this.actor.uuid&&bookmarkMatches(m,item,all));
        if(index>=0)allMarks.splice(index,1);else allMarks.push({actorUuid:this.actor.uuid,...bookmarkFor(item)});
        await this.work(()=>game.user.setFlag(ID,'grimoireFavourites',allMarks));break;
      }
      case 'casting':event.stopPropagation();await this.actions.open(this.actor.uuid);return;
      case 'prepare':event.stopPropagation();if(!item)return;await (item.type==='profile'?this.actions.open(this.actor.uuid,item.profile.id):this.actions.openAbility(this.actor.uuid,reference(item.entry)));return;
      case 'open-profile':await this.actions.open(this.actor.uuid,el.dataset.profileId);return;
      case 'new-build':event.stopPropagation();await this.actions.newBuild(this.actor.uuid);return;
      case 'sheet':event.stopPropagation();await openCharacterSheet(this.actor);return;
      case 'metadata':await this.work(async()=>{const before=currentProfile(),values=await metadataDialog(before);if(!values)return;await saveProfile(this.actor,{...currentProfile(),...values});this.status='Build name and tags saved.';});break;
      case 'duplicate':await this.work(async()=>{const p=currentProfile(),copy=await saveProfile(this.actor,{...p,name:`${p.name.slice(0,113)} (copy)`},{copy:true});this.selected=`profile:${copy.id}`;this.prefs.views.builds=viewDefaults();this.status='Build duplicated.  Use Name & tags to rename it.';});break;
      case 'delete':await this.work(async()=>{const p=currentProfile();if(!await confirm('Delete saved build',`<p>Delete <strong>${esc(p.name)}</strong> from ${esc(this.actor.name)}?</p>`))return;await deleteProfile(this.actor,p.id);this.selected=null;this.status='Saved build deleted.';});break;
      case 'shortcut':await shortcut(this.actor,currentProfile());return;
      case 'export':download(exportProfiles(this.actor,[currentProfile()]),'grimoire-build.json');return;
      case 'export-view':{const visible=sortItems(filterItems(all,this.filters),this.filters.sort).filter(i=>i.type==='profile');if(!visible.length)return;download(exportProfiles(this.actor,visible.map(i=>i.profile)),'grimoire-builds.json');return;}
      case 'import':this.element.querySelector('[data-book-import]').click();return;
    }
    await this.renderQuiet();await this.persist();
  }
}
