import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

test('upload hook compiles and passes retry options outside the JSON body', () => {
  const source = readFileSync(new URL('./useVoiceUpload.ts', import.meta.url), 'utf8')
  const result = ts.transpileModule(source, {
    fileName: 'useVoiceUpload.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual(result.diagnostics, [], 'upload hook must have valid syntax')

  const file = ts.createSourceFile('useVoiceUpload.ts', source, ts.ScriptTarget.Latest, true)
  let uploadCalls = 0
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file)
      if (callee === 'JSON.stringify') {
        assert.equal(node.arguments.length, 1, 'retry options must not become a JSON replacer')
      }
      if (callee === 'fetchUploadRequestWithRetry') {
        uploadCalls += 1
        assert.equal(node.arguments.length, 3)
        assert.match(node.arguments[2].getText(file), /onUnauthorized/)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(uploadCalls, 3, 'sign, complete, and reference-text enrichment must receive retry options')
  assert.match(source, /pendingReferenceTextPromisesRef\.current\.set\(/)
  assert.match(
    source,
    /pendingReferenceTextPromisesRef\.current\.get\(record\.recordingId\)[\s\S]*?referenceTextCompletion/,
    'a local queue sync must keep a still-pending reference-text promise attached',
  )
})
