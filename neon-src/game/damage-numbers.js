
/* ============================================================================
 * FLOATING DAMAGE NUMBERS — pooled screen-space feedback
 * ==========================================================================*/
(function(){
  'use strict';if(!window.GameSystems)return;
  const MAX=56,LIFE=.92,COLORS={normal:'#fff',person:'#fff',critical:'#ff4d5f',vehicle:'#ff9b2b',prop:'#aeb7c2',cash:'#3bff8b',ammo:'#ffd23f'};
  let ctx=null,root=null,pool=[],cursor=0,enabled=true,unsub=null,tmp=null;
  function save(){return GameSystems.api('save');}
  function persist(){const s=save();if(s)s.set('prefs.damageNumbers',enabled);}
  function setEnabled(v){enabled=!!v;persist();if(!enabled)for(const n of pool){n.life=0;n.el.style.display='none';}return enabled;}
  function spawn(d){if((d&&d.kind==='vehicle'||d&&d.kind==='prop')&&d.source!=='weapon')return false;if(!enabled||!d||!(d.amount>0)||!Number.isFinite(d.x)||!Number.isFinite(d.z))return false;const n=pool[cursor++%pool.length];n.x=d.x+(Math.random()-.5)*1.4;n.y=(Number.isFinite(d.y)?d.y:1.8)+Math.random()*.75;n.z=d.z+(Math.random()-.5)*1.4;n.life=n.max=LIFE+Math.random()*.14;n.drift=(Math.random()-.5)*18;n.kind=d.critical?'critical':(d.kind||'normal');n.el.textContent=d.label?String(d.label):String(Math.max(1,Math.round(d.amount)));n.el.style.color=COLORS[n.kind]||COLORS.normal;n.el.style.display='block';n.el.style.opacity='1';return true;}
  GameSystems.register({id:'damageNumbers',order:46,requires:['save'],alwaysUpdate:true,
    init(c){ctx=c;tmp=new c.THREE.Vector3();const style=document.createElement('style');style.id='damageNumbersV14CSS';style.textContent='#damageNumbersV14{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:18}.damageNumberV14{position:absolute;display:none;will-change:transform,opacity;color:#fff;font:950 17px/1 system-ui,sans-serif;-webkit-text-stroke:1px rgba(0,0,0,.72);text-shadow:0 2px 5px #000,0 0 8px currentColor;transform:translate(-50%,-50%)}';document.head.appendChild(style);root=document.createElement('div');root.id='damageNumbersV14';c.dom.ui.appendChild(root);for(let i=0;i<MAX;i++){const el=document.createElement('span');el.className='damageNumberV14';root.appendChild(el);pool.push({el,life:0,max:1,x:0,y:0,z:0,drift:0,kind:'normal'});}const s=save();enabled=s?s.get('prefs.damageNumbers',true)!==false:true;unsub=GameSystems.events.on('damage:dealt',spawn);},
    update(dt){if(!ctx)return;const w=innerWidth,h=innerHeight;for(const n of pool){if(n.life<=0)continue;n.life-=dt;if(n.life<=0){n.el.style.display='none';continue;}n.y+=dt*2.2;tmp.set(n.x,n.y,n.z).project(ctx.camera);if(tmp.z<-1||tmp.z>1||Math.abs(tmp.x)>1.25||Math.abs(tmp.y)>1.25){n.el.style.display='none';continue;}const t=1-n.life/n.max,x=(tmp.x*.5+.5)*w+n.drift*t,y=(-tmp.y*.5+.5)*h-t*42;n.el.style.display='block';n.el.style.opacity=String(Math.min(1,n.life/.28));n.el.style.transform='translate(-50%,-50%) translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) scale('+(1+Math.sin(Math.min(1,t)*Math.PI)*.16).toFixed(2)+')';}},
    api:{show:spawn,setEnabled,get enabled(){return enabled;},toggle(){return setEnabled(!enabled);}},
    dispose(){if(unsub)unsub();if(root&&root.parentNode)root.parentNode.removeChild(root);}
  });
})();
