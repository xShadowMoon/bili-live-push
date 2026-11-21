import test from 'node:test';
import assert from 'node:assert/strict';
import { signWbiWith, mixinKeyOf } from '../src/bili.mjs';

test('WBI signature matches the documented example', () => {
  const key = mixinKeyOf('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png');
  assert.equal(key, 'ea1db124af3c7062474693fa704f4ff8');
  assert.equal(signWbiWith(key, { foo: '114', bar: '514', zab: 1919810 }, 1702204169000),
    'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
});
