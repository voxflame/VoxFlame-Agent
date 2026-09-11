import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
const fixture = new URL('../test/native-rtc-fixture.mjs',import.meta.url).href
registerHooks({resolve(specifier,context,next){if(['react','react-native','@livekit/react-native','livekit-client'].includes(specifier))return {shortCircuit:true,url:fixture};return next(specifier,context)}})
const {hookHost,controls,Room,reset}=await import(fixture)
const {useLiveKitRoomConnection}=await import('../src/realtime/use-livekit-room-connection.ts')
const {useMobileRtcSession}=await import('../src/realtime/use-mobile-rtc-session.ts')
const {createNativeAudioLeases}=await import('../src/realtime/native-audio-lifecycle.ts')
const tick=()=>new Promise(r=>setTimeout(r,0))
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await tick()}throw new Error('condition timed out')}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const fixtureSession=(id='one')=>({requestId:id,channelName:id,executionBackend:'livekit',joinTokenTtlSeconds:120,transport:{provider:'livekit',serverUrl:'wss://rtc.example.test',roomName:id,participantIdentity:id,participantName:'Test',participantToken:'test',participantMetadata:'{}',participantAttributes:{},agentDispatch:null},intent:{surface:'mobile_workbench',mode:'communication',sessionStrategy:'heavy_realtime',requestedCapabilities:[],grantedCapabilities:[],scene:null,deviceContext:{}},readiness:{canStart:true,requestedStrategy:'heavy_realtime',resolvedStrategy:'heavy_realtime',recommendedStrategy:'heavy_realtime',microphoneRequired:false,blockers:[],warnings:[],summary:{status:'ready',label:'',detail:'',nextAction:'',blockerSummary:null,warningSummary:null}}})
const hosts=[]
const roomHost=()=>{let owner='a';const h=hookHost(()=>useLiveKitRoomConnection(owner));hosts.push(h);h.owner=value=>{owner=value;return h.run()};return h}
test.beforeEach(reset)
test.afterEach(async()=>{for(const h of hosts.splice(0))h.unmount();await tick();await tick()})
for(const phase of ['permission','audioStart','join','mic'])test(`cancel pending ${phase}; late completion cannot revive or clear next room`,async()=>{
 const d=deferred();controls[phase]=d.promise;const h=roomHost();const old=h.run().connect(fixtureSession())
 await until(()=>Room.instances.length===1);await tick();await tick()
 const oldRoom=Room.instances[0];const stop=h.run().disconnect();assert.equal(await old,false)
 controls[phase]=null;const next=h.run().connect(fixtureSession('new'));d.resolve();await stop;assert.equal(await next,true)
 oldRoom.emit('data',new TextEncoder().encode(JSON.stringify({type:'transcript',role:'user',is_final:true,text:'old'})))
 oldRoom.emit('reconnected');oldRoom.emit('disconnected');await tick()
 assert.equal(h.run().roomName,'new');assert.equal(h.run().status,'connected');assert.equal(h.run().latestUserTranscript,'')
 await h.run().disconnect()
})
test('two hook owners share AudioSession; releasing idle or old owner cannot stop current owner',async()=>{
 const a=roomHost(),b=roomHost();assert.equal(await a.run().connect(fixtureSession('a')),true);assert.equal(await b.run().connect(fixtureSession('b')),true)
 assert.equal(controls.starts,1);await a.run().disconnect();assert.equal(controls.stops,0);assert.equal(b.run().audioSessionStarted,true)
 await a.run().disconnect();assert.equal(controls.stops,0);await b.run().disconnect();assert.equal(controls.stops,1)
})
test('stalled old room teardown does not clear next refs or stop its audio',async()=>{
 const h=roomHost();await h.run().connect(fixtureSession());const d=deferred();Room.instances[0].teardown=d.promise
 const stop=h.run().disconnect();await h.run().connect(fixtureSession('new'));const stops=controls.stops;d.resolve();await stop
 assert.equal(h.run().roomName,'new');assert.equal(controls.stops,stops);await h.run().disconnect()
})
test('account switch invalidates pending join and transcript cache, unmount releases owner',async()=>{
 const d=deferred();controls.join=d.promise;const h=roomHost();const old=h.run().connect(fixtureSession());await until(()=>Room.instances[0]?.joinStarted)
 h.owner('b');assert.equal(await old,false);d.resolve();await tick();assert.equal(h.run().latestAssistantTranscript,'');assert.equal(h.run().roomName,null)
 controls.join=null;await h.run().connect(fixtureSession('b'));h.unmount();await tick();assert.equal(h.run().audioSessionStarted,false)
})
test('remote disconnect releases audio and clears room metadata',async()=>{
 const h=roomHost();await h.run().connect(fixtureSession());Room.instances[0].emit('disconnected');await tick()
 assert.equal(h.run().roomName,null);assert.equal(h.run().status,'disconnected');assert.equal(controls.stops,1)
})
test('late control failure is not shown on next session',async()=>{
 const h=roomHost();await h.run().connect(fixtureSession());const d=deferred();Room.instances[0].publish=d.promise
 const send=h.run().sendText('test');await h.run().disconnect();await h.run().connect(fixtureSession('new'));d.reject(new Error('late'))
 assert.equal(await send,false);assert.equal(h.run().errorMessage,null);await h.run().disconnect()
})
test('training stop cannot send end_audio to successor after pending publish',async()=>{
 const h=roomHost();await h.run().connect({...fixtureSession(),intent:{...fixtureSession().intent,mode:'training'}})
 const d=deferred();Room.instances[0].publish=d.promise;const stop=h.run().stopTrainingCapture('capture');await tick()
 await h.run().connect(fixtureSession('new'));d.resolve();assert.equal(await stop,false);assert.equal(Room.instances[1].packets.length,0);await h.run().disconnect()
})
test('failed native stop is reconciled before next native start',async()=>{
 const events=[];let fail=true;const leases=createNativeAudioLeases({async startAudioSession(){events.push('start')},async stopAudioSession(){events.push('stop');if(fail){fail=false;throw new Error('native')}}})
 const a=leases.acquire();await a.ready;await assert.rejects(a.release());const b=leases.acquire();await b.ready
 assert.deepEqual(events,['start','stop','stop','start']);await b.release()
})
test('native stop/start calls never overlap during quick reconnect',async()=>{
 const d=deferred(),events=[];const leases=createNativeAudioLeases({async startAudioSession(){events.push('start')},async stopAudioSession(){events.push('stop');await d.promise}})
 const a=leases.acquire();await a.ready;const stop=a.release();await tick();const b=leases.acquire();await tick();assert.deepEqual(events,['start','stop']);d.resolve();await stop;await b.ready;assert.deepEqual(events,['start','stop','start']);await b.release()
})
const originalFetch=globalThis.fetch
test.after(()=>{globalThis.fetch=originalFetch})
test('HTTP auth pending on account switch settles immediately and never sends stale request',async()=>{
 const auth=deferred();let calls=0,owner='a';const tokenProvider={getAccessToken:()=>auth.promise}
 const h=hookHost(()=>useMobileRtcSession({ownerId:owner,apiBaseUrl:'https://api.example.test',enabled:true,tokenProvider}));hosts.push(h)
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(fixtureSession()))}
 const old=h.run().start({surface:'mobile_workbench',mode:'communication',sessionStrategy:'heavy_realtime',requestedCapabilities:[]});owner='b';h.run();assert.equal(await old,null);auth.resolve('token');await tick();assert.equal(calls,0);assert.equal(h.run().status,'idle')
})
test('HTTP ignoring abort cannot restore cleared session or pass isCurrent at handoff',async()=>{
 const d=deferred(),tokenProvider={getAccessToken:async()=> 'token'};const h=hookHost(()=>useMobileRtcSession({ownerId:'a',apiBaseUrl:'https://api.example.test',enabled:true,tokenProvider}));hosts.push(h)
 globalThis.fetch=async()=>d.promise;const old=h.run().start({surface:'mobile_workbench',mode:'communication',sessionStrategy:'heavy_realtime',requestedCapabilities:[]});await tick();h.run().clear();assert.equal(await old,null)
 globalThis.fetch=async()=>new Response(JSON.stringify(fixtureSession('new')));const next=await h.run().start({surface:'mobile_workbench',mode:'communication',sessionStrategy:'heavy_realtime',requestedCapabilities:[]})
 d.resolve(new Response(JSON.stringify(fixtureSession())));await tick();assert.equal(h.run().session.requestId,'new');assert.equal(h.run().isCurrent(next),true);h.run().clear();assert.equal(h.run().isCurrent(next),false)
})

test('old callbacks cannot initiate a connection after account switch or unmount',async()=>{
 const h=roomHost();const oldConnect=h.run().connect;h.owner('b');assert.equal(await oldConnect(fixtureSession()),false);assert.equal(Room.instances.length,0)
 const current=h.run().connect;h.unmount();assert.equal(await current(fixtureSession()),false)
})
test('failed native start remains recoverable and is not reported ready',async()=>{
 const d=deferred();controls.audioStart=d.promise;const h=roomHost();const start=h.run().connect(fixtureSession());await until(()=>controls.starts===1)
 d.reject(new Error('native start failed'));assert.equal(await start,false);await tick();assert.equal(h.run().audioSessionStarted,false);assert.equal(h.run().status,'error')
 controls.audioStart=null;assert.equal(await h.run().connect(fixtureSession('new')),true);await h.run().disconnect()
})
