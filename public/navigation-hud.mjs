import {TrailMap} from './hotel/trail-map.mjs';

// A shared view of the player's own pose, never another player's location.
export class NavigationHUD {
  constructor({map = false, scene = 'chase', label = '', walls = [], door = null} = {}) {
    this.orientation = document.createElement('div');
    this.orientation.className = 'orientation'; this.orientation.id = 'orientation';
    this.orientation.hidden = true; this.orientation.setAttribute('role','img');
    this.orientation.innerHTML = '<div class="compass" aria-hidden="true"><span class="north">N</span><span class="east">E</span><span class="south">S</span><span class="west">W</span><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="29" fill="none" stroke="currentColor" stroke-width=".6"/><g id="compass-arrow"><path d="M50 28 L59 61 L50 56 L41 61 Z" fill="currentColor"/></g></svg></div><p id="facing"></p><p id="floor-label"></p>';
    this.arrow = this.orientation.querySelector('#compass-arrow'); this.facing = this.orientation.querySelector('#facing');
    this.orientation.querySelector('#floor-label').textContent = label;
    const host=document.querySelector('main')||document.body;
    host.append(this.orientation);
    if(map) {
      if(scene==='chase'){this.budget=document.createElement('p');this.budget.id='search-budget';this.budget.hidden=true;this.orientation.append(this.budget);}
      this.mapHost = document.createElement('aside'); this.mapHost.className = 'trail-map'; this.mapHost.id = 'trail-map'; this.mapHost.hidden = true;
      this.mapHost.setAttribute('aria-label','完整场地地图');
      this.mapHost.innerHTML = `<header><span>MAP</span><span>${scene==='tutorial'?'初次穿行':'追逐'}</span></header><canvas id="trail-canvas" width="880" height="734" aria-label="完整场地与自己所在位置，隐藏声源和对手"></canvas>`;
      host.append(this.mapHost);
      this.trail = new TrailMap(this.mapHost.querySelector('canvas'),{scene,walls,door,bounds:{width:8,height:8,north:8}});
    }
    this.roundKey = null; this.lastMapFrame = 0;
  }
  update({player,active=false,paused=false,roundKey,attemptsRemaining,doorOpen=false} = {}) {
    this.orientation.hidden = !active;
    if(this.mapHost)this.mapHost.hidden = !active;
    if(!active||!player)return;
    if(this.budget){this.budget.hidden=!Number.isFinite(attemptsRemaining);this.budget.textContent=`剩余尝试 ${attemptsRemaining} / 5`;}
    const degrees=((player.heading*180/Math.PI)%360+360)%360;
    const direction=['北','东北','东','东南','南','西南','西','西北'][Math.round(degrees/45)%8];
    this.arrow.style.transform=`rotate(${degrees}deg)`;
    const text=`${direction} · ${String(Math.round(degrees)%360).padStart(3,'0')}°`;
    if(this.facing.textContent!==text){this.facing.textContent=text;this.orientation.setAttribute('aria-label',text);}
    if(this.trail){
      if(roundKey!==this.roundKey){this.roundKey=roundKey;this.trail.reset();this.lastMapFrame=0;}
      const now=performance.now();
      if(now-this.lastMapFrame>=50){
        this.trail.update({player:{...player,floor:0},doors:{main:doorOpen?1:0},paused,elapsed:now/1000});this.lastMapFrame=now;
        this.mapHost.dataset.revealed=String(this.trail.getStats().markerVisible);
      }
    }
  }
}
