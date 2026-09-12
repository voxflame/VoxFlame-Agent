// Deliberately ignores cancellation in connect so tests exercise late-resource cleanup.
export const controls={join:null,profile:null,profileCalls:0}
export const RoomEvent={TrackSubscribed:'sub',TrackUnsubscribed:'unsub',DataReceived:'data',Disconnected:'disconnected'}
export const Track={Kind:{Audio:'audio'}}
export class Room {
  static instances=[]
  constructor(){this.events=new Map();this.disconnects=0;this.joinStarted=false;this.localParticipant={publishData:async()=>{}};Room.instances.push(this)}
  on(event,fn){this.events.set(event,fn);return this}
  emit(event,...args){this.events.get(event)?.(...args)}
  async prepareConnection(){}
  async connect(){this.joinStarted=true;await controls.join}
  async disconnect(){this.disconnects++;this.emit('disconnected');if(this.rejectDisconnect)throw new Error('test teardown failure');await this.teardown}
}
export async function syncRtcSessionProfile(){controls.profileCalls++;await controls.profile}
export function reset(){Room.instances=[];controls.join=null;controls.profile=null;controls.profileCalls=0}
