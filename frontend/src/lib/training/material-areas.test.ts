import assert from 'node:assert/strict'
import test from 'node:test'

import { TRAINING_MATERIAL_AREAS } from './material-areas'

test('material library exposes the verified full-text reading collection', () => {
  assert.equal(TRAINING_MATERIAL_AREAS.length, 9)
  assert.deepEqual(
    TRAINING_MATERIAL_AREAS.map((area) => area.title),
    [
      '日常与出行',
      '看病与求助',
      '人群与角色',
      '设备与数字',
      '短句朗读',
      '会议与协作',
      '车载与导航',
      '系统易漏听',
      '完整文章',
    ],
  )
  assert.deepEqual(TRAINING_MATERIAL_AREAS.at(-1), {
    id: 'complete-reading',
    title: '完整文章',
    count: 81,
    countUnit: '篇',
    href: '/contribute/readings',
  })
})
