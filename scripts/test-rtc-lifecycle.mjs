// Actual Web orchestration/transport with delayed HTTP and SDK substitutes; no network/providers.
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

const fixtureUrl = new URL('../frontend/test/rtc-sdk-fixture.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'livekit-client' || specifier === './session-profile') return { shortCircuit: true, url: fixtureUrl }
    return next(specifier, context)
  },
})
const { Room, controls, reset } = await import(fixtureUrl)
const { startRtcRuntimeConnection, disconnectRtcRuntime } = await import('../frontend/src/lib/realtime-audio/session-runtime.ts')
const { createInitialRtcAgentState } = await import('../frontend/src/lib/realtime-audio/session-state.ts')
const { waitForSessionRetry } = await import('../frontend/src/lib/realtime-audio/session-lifecycle.ts')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const until = async predicate => { for (let i=0;i<200;i++) { if (predicate()) return; await tick() } throw new Error('test condition timed out') }
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject} }
function session(id='one') {
  return {
    requestId:id, channelName:id, executionBackend:'livekit', joinTokenTtlSeconds:120,
    transport:{provider:'livekit',serverUrl:'wss://rtc.example.test',roomName:id,participantIdentity:id,participantName:'Test',participantToken:id,participantMetadata:'{}',participantAttributes:{},agentDispatch:null},
    intent:{surface:'communication_workspace',mode:'communication',sessionStrategy:'heavy_realtime',requestedCapabilities:[],grantedCapabilities:[],scene:null,deviceContext:{}},
    readiness:{canStart:true,requestedStrategy:'heavy_realtime',resolvedStrategy:'heavy_realtime',recommendedStrategy:'heavy_realtime',microphoneRequired:false,blockers:[],warnings:[],summary:{status:'ready',label:'',detail:'',nextAction:'',blockerSummary:null,warningSummary:null}},
  }
}
function harness() {
  let state=createInitialRtcAgentState(), cleanups=0, messages=0
  const refs={clientRef:{current:null},rtmClientRef:{current:null},micTrackRef:{current:null},sessionRef:{current:null},connectPromiseRef:{current:null},connectionAbortRef:{current:null},inboundRtmChunksRef:{current:new Map()},latestUserTranscriptRef:{current:{text:'',clientCaptureId:null}},onDecodedEnvelopeRef:{current:null}}
  const setState=update=>{state=typeof update==='function'?update(state):update}
  const cleanupMicrophoneResources=()=>{cleanups++}
  return {refs,get state(){return state},get cleanups(){return cleanups},get messages(){return messages},
    start:()=>startRtcRuntimeConnection({refs,userId:'user',accessToken:'token',memoryOwnerId:null,mode:'communication',connectionNotice:null,setState,cleanupMicrophoneResources,
      handleRtmMessage:event=>{messages++;refs.onDecodedEnvelopeRef.current?.(JSON.parse(new TextDecoder().decode(event.message)))}}),
    stop:()=>disconnectRtcRuntime({refs,setState,cleanupMicrophoneResources})}
}
function ack(room,id) {room.emit('data',new TextEncoder().encode(JSON.stringify({type:'session_init_ack',metadata:{request_id:id}})))}
async function connected(h,id='one') {
  globalThis.fetch=async()=>new Response(JSON.stringify(session(id)))
  const start=h.start()
  await until(()=>h.refs.clientRef.current?.room)
  const room=h.refs.clientRef.current.room; ack(room,id); await start; return room
}
const originalFetch=globalThis.fetch
test.after(()=>{globalThis.fetch=originalFetch})
test.beforeEach(()=>reset())

test('cancel pending HTTP settles immediately; late response cannot replace new room', async()=>{
  const h=harness(), response=deferred()
  let signal
  globalThis.fetch=async(_url,init)=>{signal=init.signal;return response.promise}
  const old=h.start(); const rejected=assert.rejects(old,/rtc_connection_cancelled/)
  await until(()=>signal)
  await h.stop(); await rejected; assert.equal(signal.aborted,true)
  const room=await connected(h,'new'); const before=h.cleanups
  response.resolve(new Response(JSON.stringify(session('old'))));await tick()
  assert.equal(h.refs.clientRef.current.room,room);assert.equal(h.cleanups,before);assert.equal(h.state.isConnected,true)
  await h.stop()
})
test('cancel pending SDK join; late success closes old room without clearing new microphone',async()=>{
  const h=harness(), joining=deferred()
  controls.join=joining.promise;globalThis.fetch=async()=>new Response(JSON.stringify(session()))
  const old=h.start();const rejected=assert.rejects(old,/rtc_connection_cancelled/)
  await until(()=>Room.instances.length===1 && Room.instances[0].joinStarted)
  const oldRoom=Room.instances[0];await h.stop();await rejected
  controls.join=null;const current=await connected(h,'new')
  const microphone={close(){throw new Error('old task touched new microphone')}};h.refs.micTrackRef.current=microphone
  joining.resolve();await tick();await tick()
  assert.ok(oldRoom.disconnects>=1);assert.equal(h.refs.clientRef.current.room,current);assert.equal(h.refs.micTrackRef.current,microphone)
  h.refs.micTrackRef.current=null;await h.stop()
})
test('cancel ACK wait rejects promptly and old data/events cannot alter next session',async()=>{
  const h=harness();globalThis.fetch=async()=>new Response(JSON.stringify(session()))
  const old=h.start();const rejected=assert.rejects(old,/rtc_connection_cancelled/)
  await until(()=>h.refs.clientRef.current);const oldRoom=h.refs.clientRef.current.room
  await h.stop();await rejected;await connected(h,'new')
  const messages=h.messages;ack(oldRoom,'one');oldRoom.emit('disconnected');await tick()
  assert.equal(h.messages,messages);assert.equal(h.state.isConnected,true);assert.equal(h.state.error,null);await h.stop()
})
test('cancel profile wait; late rejection is observed and does not affect next connection',async()=>{
  const h=harness(), profile=deferred();controls.profile=profile.promise
  globalThis.fetch=async()=>new Response(JSON.stringify(session()))
  const old=h.start();const rejected=assert.rejects(old,/rtc_connection_cancelled/)
  await until(()=>h.refs.clientRef.current);ack(h.refs.clientRef.current.room,'one');await until(()=>controls.profileCalls===1)
  await h.stop();await rejected;controls.profile=null;await connected(h,'new')
  profile.reject(new Error('late profile failure'));await tick()
  assert.equal(h.state.isConnected,true);assert.equal(h.state.error,null);await h.stop()
})
test('rejected old SDK teardown does not overwrite next state or block cancellation',async()=>{
  const h=harness();const room=await connected(h);room.rejectDisconnect=true
  await assert.rejects(h.stop(),/test teardown failure/)
  assert.equal(h.state.isConnected,false);assert.equal(h.refs.clientRef.current,null)
  await connected(h,'new');assert.equal(h.state.error,null);await h.stop()
})
test('retry wait is cancellable without waiting for its timer',async()=>{
  const controller=new AbortController();const retry=waitForSessionRetry(60000,controller.signal)
  controller.abort();await assert.rejects(retry,/rtc_connection_cancelled/)
})

test('cancelled room cannot attach or play a late audio track',async()=>{
  const h=harness();const room=await connected(h)
  await h.stop()
  let attachments=0
  room.emit('sub',{kind:'audio',attach(){attachments++;return []}},{trackSid:'old-audio'})
  assert.equal(attachments,0)
})

test('stalled old teardown cannot hold a cancelled connection or mutate its successor',async()=>{
  const h=harness(), teardown=deferred()
  globalThis.fetch=async()=>new Response(JSON.stringify(session()))
  const old=h.start();const rejected=assert.rejects(old,/rtc_connection_cancelled/)
  await until(()=>h.refs.clientRef.current)
  h.refs.clientRef.current.room.teardown=teardown.promise
  const stop=h.stop()
  let cancelled=false;void rejected.then(()=>{cancelled=true})
  await until(()=>cancelled)
  const current=await connected(h,'new')
  teardown.resolve();await stop;await rejected
  assert.equal(h.refs.clientRef.current.room,current)
  assert.equal(h.state.isConnected,true)
  await h.stop()
})
