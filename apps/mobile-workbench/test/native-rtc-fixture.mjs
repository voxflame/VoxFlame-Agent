// Deterministic hook host + native substitutes. Tests execute production hook bodies,
// not React scheduling, OS permissions, AudioSession, WebRTC or device acoustics.
let host
const same = (a,b) => a?.length === b?.length && a.every((v,i)=>Object.is(v,b[i]))
export function hookHost(render) {
  const h={slots:[],index:0,effects:[],render,rendered:null}
  h.run=()=>{host=h;h.index=0;h.rendered=h.render();host=null;for(const effect of h.effects.splice(0))effect();return h.rendered}
  h.unmount=()=>{for(const slot of h.slots)slot?.cleanup?.()}
  h.run();return h
}
export function useRef(value){const i=host.index++;return host.slots[i]??= {current:value}}
export function useState(value){const h=host,i=h.index++;h.slots[i]??={value:typeof value==='function'?value():value};return [h.slots[i].value,v=>{h.slots[i].value=typeof v==='function'?v(h.slots[i].value):v}]}
export function useMemo(fn,deps){const i=host.index++;if(!host.slots[i]||!same(host.slots[i].deps,deps))host.slots[i]={deps,value:fn()};return host.slots[i].value}
export const useCallback=(fn,deps)=>useMemo(()=>fn,deps)
export function useLayoutEffect(fn,deps){const h=host,i=h.index++;if(!h.slots[i]||!same(h.slots[i].deps,deps)){const old=h.slots[i];h.slots[i]={deps};h.effects.push(()=>{old?.cleanup?.();h.slots[i].cleanup=fn()})}}
export const Platform={OS:'android',Version:31}
export const PermissionsAndroid={PERMISSIONS:{BLUETOOTH_CONNECT:'bt'},check:async()=>{await controls.permission;return true},request:async()=>{}}
export const controls={permission:null,audioStart:null,audioStop:null,join:null,mic:null,starts:0,stops:0}
export const AudioSession={async startAudioSession(){controls.starts++;await controls.audioStart},async stopAudioSession(){controls.stops++;await controls.audioStop}}
export const ConnectionState={Connected:'connected',Connecting:'connecting',Reconnecting:'reconnecting',SignalReconnecting:'signalReconnecting'}
export const RoomEvent={ConnectionStateChanged:'state',Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected',DataReceived:'data'}
export class Room {
 static instances=[]
 constructor(){this.events=new Map();this.join=controls.join;this.mic=controls.mic;this.disconnects=0;this.packets=[];this.localParticipant={setMicrophoneEnabled:async enabled=>{if(enabled)await this.mic},publishData:async bytes=>{this.packets.push(JSON.parse(new TextDecoder().decode(bytes)));await this.publish}};Room.instances.push(this)}
 on(e,fn){this.events.set(e,fn);return this}
 emit(e,...args){this.events.get(e)?.(...args)}
 async connect(){this.joinStarted=true;await this.join}
 async disconnect(){this.disconnects++;this.emit('disconnected');await this.teardown}
}
export function reset(){Object.assign(controls,{permission:null,audioStart:null,audioStop:null,join:null,mic:null,starts:0,stops:0});Room.instances=[]}
