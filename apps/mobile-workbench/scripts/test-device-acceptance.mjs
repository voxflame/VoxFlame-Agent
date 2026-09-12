import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const app = new URL('../',import.meta.url)
const example=JSON.parse(readFileSync(new URL('device-acceptance.example.json',app),'utf8'))
const dir=mkdtempSync(path.join(tmpdir(),'device-gate-'))
const valid=()=>({...example,platform:'android',device_model:'fixture',os_version:'fixture',app_version:'fixture',build_number:'fixture',tested_at:'2026-09-11',tester_id:'fixture',flows:example.flows.map(flow=>({...flow,status:'pass',evidence:'synthetic validator fixture; NOT device acceptance'}))})
const run=value=>{const p=path.join(dir,'result.json');writeFileSync(p,JSON.stringify(value));return spawnSync(process.execPath,[new URL('scripts/validate-device-acceptance.mjs',app).pathname,p],{encoding:'utf8'}).status}
try {
 assert.equal(run(valid()),0)
 assert.notEqual(run(example),0)
 const missing=valid();missing.flows=missing.flows.filter(f=>f.id!=='rtc_cancel_and_quick_reconnect');assert.notEqual(run(missing),0)
 const conditional=valid();conditional.flows[0].status='conditional';conditional.flows[0].issue='open';assert.notEqual(run(conditional),0)
 const empty=valid();empty.flows[0].evidence='';assert.notEqual(run(empty),0)
 const fail=valid();fail.flows[0].status='fail';assert.notEqual(run(fail),0)
 console.log('device acceptance gate: 6 synthetic cases passed; no device results produced')
} finally { rmSync(dir,{recursive:true,force:true}) }
