/* =========================================================================
OV BLOCKFILL — v49 owner pass: "fill empty blocks fully".
Fills the NE-downtown construction block (836..1064 x -1124..-896, the one
hosting the worktrucks NORTHGATE TOWER SITE crew and the ov-vertical2 tower)
with full construction dressing — perimeter hoarding, tower crane, scaffold
frames, material yards, portacabins, spoil — and fills the two neighbouring
empty blocks with mid-rise city buildings and painted lots.
Runs LAST of all districts, so every placement is validated at build time
against the live collider list AND the road net: nothing is placed on a
carriageway, inside the tower, or over the crew site. All geometry goes
through b.box/b.quad, so it merges into the existing district meshes —
zero extra draw calls, zero new materials.
========================================================================= */
(function(){
'use strict';
if(!window.NeonDistricts)return;
var CONC=0x4b5261,CONCD=0x343a45,STEEL=0x8a93a2,AMBER=0xffb347,HOARD=0x3f6a8a,
    SPOIL=0x6a5f47,WOOD=0x8a6d4a,PALLET=0x9aa4b4,TWR1=0x2c3242,TWR2=0x232a38,
    GLOW=0x9fd9ff,LOT=0x2e333f;
function build(b){
  var stats={pads:0,hoard:0};
  function H(x,z){try{return b.terrain.heightAt(x,z);}catch(e){return 0;}}
  function roadOK(x,z,half){
    var n=null;try{n=b.roads&&b.roads.nearest?b.roads.nearest(x,z):null;}catch(e){return false;}
    if(!n||!isFinite(n.d))return true;
    return n.d>(n.width||34)*0.5+half+3;
  }
  function harvest(R){
    var out=[],L=b.colliderList||[],i,c;
    for(i=0;i<L.length;i++){c=L[i];if(!c)continue;
      if(c.x+c.w/2<R.x0-4||c.x-c.w/2>R.x1+4||c.z+c.d/2<R.z0-4||c.z-c.d/2>R.z1+4)continue;
      if((c.baseY===undefined?0:c.baseY)>6)continue;
      out.push(c);}
    return out;
  }
  function clear(local,x,z,half){
    for(var i=0;i<local.length;i++){var c=local[i];
      if(Math.abs(c.x-x)<c.w/2+half&&Math.abs(c.z-z)<c.d/2+half)return false;}
    return true;
  }
  // ---- construction pad variants -----------------------------------------
  function frameTower(x,z,y){
    var i,dx,dz;
    for(i=0;i<4;i++){dx=(i&1?9:-9);dz=(i&2?9:-9);
      b.box({x:x+dx,z:z+dz,y:y,w:1.3,h:13,d:1.3,color:CONC});}
    b.box({x:x,z:z,y:y+5.6,w:21,h:.8,d:21,color:CONCD,noCollide:true});
    b.box({x:x,z:z,y:y+12.2,w:21,h:.8,d:21,color:CONCD,noCollide:true});
    b.box({x:x,z:z+9,y:y+13.2,w:21,h:.5,d:.5,color:AMBER,emissive:true,noCollide:true});
    b.box({x:x-9,z:z,y:y,w:.5,h:6.6,d:.5,color:STEEL,noCollide:true});
  }
  function craneAt(x,z,y,rot){
    b.box({x:x,z:z,y:y,w:5.5,h:2,d:5.5,color:CONCD});
    b.box({x:x,z:z,y:y+2,w:2.1,h:26,d:2.1,color:STEEL});
    b.box({x:x,z:z,y:y+27.4,w:2.6,h:2.2,d:2.6,color:HOARD,noCollide:true});
    b.box({x:x,z:z,y:y+28,w:24,h:1.1,d:1.5,color:STEEL,rot:rot,noCollide:true});
    b.box({x:x+Math.cos(rot)*11.5,z:z-Math.sin(rot)*11.5,y:y+27.4,w:.6,h:.6,d:.6,color:AMBER,emissive:true,noCollide:true});
    b.box({x:x-Math.cos(rot)*7,z:z+Math.sin(rot)*7,y:y+27,w:3.4,h:2.6,d:2.2,color:CONCD,rot:rot,noCollide:true});
  }
  function matYard(x,z,y){
    b.box({x:x-6,z:z-4,y:y,w:6.4,h:1.5,d:2.6,color:WOOD});
    b.box({x:x-6,z:z-1,y:y,w:6.4,h:1.1,d:2.6,color:WOOD});
    b.box({x:x+4,z:z-3,y:y,w:2.3,h:2.3,d:2.3,color:PALLET});
    b.box({x:x+7,z:z-3,y:y,w:2.3,h:1.6,d:2.3,color:PALLET});
    b.box({x:x+2,z:z+6,y:y,w:8,h:2.6,d:3.2,color:SPOIL});
    b.box({x:x-7,z:z+6,y:y,w:4.5,h:1.8,d:3,color:SPOIL});
  }
  function cabinRow(x,z,y){
    b.box({x:x-4,z:z,y:y,w:10,h:3.5,d:4.5,color:HOARD});
    b.box({x:x-4,z:z-2.05,y:y+1.7,w:8.5,h:.9,d:.25,color:GLOW,emissive:true,noCollide:true});
    b.box({x:x+5.5,z:z,y:y,w:4.5,h:3.1,d:4.5,color:CONCD});
    b.box({x:x-8.5,z:z+3.4,y:y,w:1.6,h:.4,d:2.2,color:STEEL,noCollide:true});
  }
  function scaffold(x,z,y){
    var i;
    for(i=0;i<3;i++){
      b.box({x:x-8+i*8,z:z-5,y:y,w:.5,h:9,d:.5,color:STEEL});
      b.box({x:x-8+i*8,z:z+5,y:y,w:.5,h:9,d:.5,color:STEEL});}
    b.box({x:x,z:z,y:y+4.2,w:18,h:.4,d:11,color:WOOD,noCollide:true});
    b.box({x:x,z:z,y:y+8.6,w:18,h:.4,d:11,color:WOOD,noCollide:true});
    b.box({x:x,z:z-5.2,y:y+2,w:18,h:5,d:.15,color:AMBER,noCollide:true});
  }
  // ---- city filler variants ----------------------------------------------
  function cityTower(x,z,y,i){
    var hgt=22+(i%4)*7,k;
    b.box({x:x,z:z,y:y,w:24,h:5,d:24,color:TWR1});
    b.box({x:x,z:z,y:y+5,w:19,h:hgt,d:19,color:TWR2});
    for(k=0;k<3;k++)
      b.box({x:x,z:z,y:y+9+k*Math.max(4,(hgt-6)/3),w:19.5,h:.6,d:19.5,color:GLOW,emissive:true,noCollide:true});
    b.box({x:x,z:z,y:y+5+hgt,w:20.5,h:1,d:20.5,color:TWR1,noCollide:true});
    b.box({x:x+6,z:z+6,y:y+6+hgt,w:3,h:2.2,d:3,color:TWR1,noCollide:true});
  }
  function pocketLot(x,z,y){
    b.quad([x-12,y+.07,z-12],[x+12,y+.07,z-12],[x+12,y+.07,z+12],[x-12,y+.07,z+12],LOT);
    b.box({x:x-11,z:z-11,y:y,w:.7,h:5,d:.7,color:STEEL});
    b.box({x:x-11,z:z-11,y:y+5,w:1.6,h:.4,d:.9,color:AMBER,emissive:true,noCollide:true});
    b.box({x:x+11,z:z+11,y:y,w:.7,h:5,d:.7,color:STEEL});
    b.box({x:x+11,z:z+11,y:y+5,w:1.6,h:.4,d:.9,color:AMBER,emissive:true,noCollide:true});
  }
  var BLOCKS=[
    {x0:836,z0:-1124,x1:1064,z1:-896,kind:'site'},
    {x0:836,z0:-844,x1:1064,z1:-616,kind:'city'},
    {x0:556,z0:-1124,x1:784,z1:-896,kind:'city'}
  ];
  for(var bi=0;bi<BLOCKS.length;bi++){
    var R=BLOCKS[bi],local=harvest(R),idx=0;
    // hoarding fence ring for the construction block
    if(R.kind==='site'){
      for(var e=0;e<4;e++){
        var horiz=(e<2),fixed=horiz?(e?R.z1-8:R.z0+8):(e===2?R.x0+8:R.x1-8);
        for(var s=(horiz?R.x0:R.z0)+16;s<(horiz?R.x1:R.z1)-16;s+=20){
          var hx=horiz?s:fixed,hz=horiz?fixed:s;
          if(Math.abs(s-((horiz?R.x0+R.x1:R.z0+R.z1)/2))<12)continue; // gate
          if(!clear(local,hx,hz,3)||!roadOK(hx,hz,9))continue;
          b.box({x:hx,z:hz,y:H(hx,hz),w:horiz?18:.4,h:2.7,d:horiz?.4:18,color:HOARD});
          b.box({x:hx,z:hz,y:H(hx,hz)+2.7,w:horiz?18:.25,h:.25,d:horiz?.25:18,color:AMBER,emissive:true,noCollide:true});
          stats.hoard++;
        }
      }
    }
    for(var gx=R.x0+22;gx<=R.x1-22;gx+=30){
      for(var gz=R.z0+22;gz<=R.z1-22;gz+=30){
        var half=13;
        if(!clear(local,gx,gz,half+2))continue;
        if(!roadOK(gx,gz,half))continue;
        var y=H(gx,gz);
        if(R.kind==='site'){
          switch(idx%5){
            case 0:frameTower(gx,gz,y);break;
            case 1:matYard(gx,gz,y);break;
            case 2:craneAt(gx,gz,y,(idx*1.9)%6.28);break;
            case 3:cabinRow(gx,gz,y);break;
            default:scaffold(gx,gz,y);}
        }else{
          if(idx%3===2)pocketLot(gx,gz,y);else cityTower(gx,gz,y,idx+bi*2);
        }
        // reserve the pad so later pads keep spacing
        local.push({x:gx,z:gz,w:half*2,d:half*2});
        idx++;stats.pads++;
      }
    }
  }
  console.log('[ov-blockfill] built: '+stats.pads+' pads, '+stats.hoard+' hoarding runs');
}
window.NeonDistricts.push({id:'ov-blockfill',name:'BLOCK FILL',build:build});
})();