import assert from 'node:assert/strict';
import test from 'node:test';

import { overwriteTextObject } from './oss.service';

test('text object overwrite does not send unsupported PutObject condition headers', async () => {
    const calls: unknown[][] = [];
    const client = {
        async put(...args: unknown[]): Promise<void> {
            calls.push(args);
        },
    };

    const content = Buffer.from('next content');
    await overwriteTextObject(client, 'dataset/account/manifest.jsonl', content);

    assert.deepEqual(calls, [[
        'dataset/account/manifest.jsonl',
        content,
    ]]);
});
