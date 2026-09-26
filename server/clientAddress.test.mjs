import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClientAddressResolver } from './clientAddress.mjs';

function request(peer, forwarded, otherHeaders = {}) {
  return { socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': forwarded, ...otherHeaders } };
}

test('forwarded headers are ignored by default and when the direct peer is untrusted', () => {
  const spoofed = request('198.51.100.5', '192.0.2.1', {
    forwarded: 'for=192.0.2.2', 'x-real-ip': '192.0.2.3',
  });
  assert.equal(createClientAddressResolver()(spoofed), '198.51.100.5');
  assert.equal(createClientAddressResolver(['127.0.0.1'])(spoofed), '198.51.100.5');
});

test('the first untrusted hop from the right wins over a spoofed leftmost client', () => {
  const resolve = createClientAddressResolver(['127.0.0.1']);
  assert.equal(resolve(request('127.0.0.1', '192.0.2.1, 198.51.100.5')), '198.51.100.5');
  assert.equal(resolve(request('127.0.0.1', '192.0.2.2, 198.51.100.5')), '198.51.100.5');
});

test('multiple explicitly trusted proxies can be skipped but an untrusted proxy stops traversal', () => {
  const resolve = createClientAddressResolver(['127.0.0.1', '10.0.0.2', '2001:db8::2']);
  assert.equal(resolve(request('127.0.0.1', '198.51.100.5, 10.0.0.2, 2001:db8::2')), '198.51.100.5');
  assert.equal(resolve(request('127.0.0.1', '198.51.100.5, 10.0.0.3, 2001:db8::2')), '10.0.0.3');
  assert.equal(resolve(request('127.0.0.1', '10.0.0.2, 2001:db8::2')), '127.0.0.1');
});

test('IPv6 aliases and IPv4-mapped IPv6 addresses share one rate-limit address and trust entry', () => {
  const resolve = createClientAddressResolver(['127.0.0.1', '2001:DB8:0:0:0:0:0:2']);
  assert.equal(resolve(request('::ffff:127.0.0.1', '2001:0DB8:0:0:0:0:0:5')), '2001:db8::5');
  assert.equal(resolve(request('0:0:0:0:0:FFFF:7f00:1', '2001:db8::5, 2001:db8::2')), '2001:db8::5');
  assert.equal(resolve(request('2001:db8::2', '::ffff:192.0.2.5')), '192.0.2.5');
  assert.equal(resolve(request('2001:db8::2', '0:0:0:0:0:ffff:c000:205')), '192.0.2.5');
  assert.equal(resolve(request('2001:0DB8:0:0:0:0:0:5')), '2001:db8::5');
  assert.equal(createClientAddressResolver(['::ffff:7f00:1'])(request('127.0.0.1', '192.0.2.5')), '192.0.2.5');
});

test('missing and malformed forwarded chains conservatively use the socket peer', () => {
  const resolve = createClientAddressResolver(['127.0.0.1', '10.0.0.2']);
  for (const forwarded of [
    undefined, '', ' ', null, 123, ['192.0.2.1'],
    'unknown', '192.0.2.1, unknown', 'unknown, 192.0.2.1',
    '192.0.2.1, unknown, 10.0.0.2', '192.0.2.1,,10.0.0.2',
    ',192.0.2.1', '192.0.2.1,', '192.0.2.1:443', '[2001:db8::1]',
    'fe80::1%lo0', '192.0.2.1/32', 'localhost', '192.000.002.001',
  ]) {
    assert.equal(resolve(request('::ffff:127.0.0.1', forwarded)), '127.0.0.1', JSON.stringify(forwarded));
  }
  assert.equal(resolve(request('127.0.0.1', ' 192.0.2.1 , 10.0.0.2 ')), '192.0.2.1');
});

test('forwarded chains have bounded byte length and hop count', () => {
  const resolve = createClientAddressResolver(['127.0.0.1', '10.0.0.2']);
  assert.equal(resolve(request('127.0.0.1', '192.0.2.1'.padEnd(4096))), '192.0.2.1');
  assert.equal(resolve(request('127.0.0.1', '192.0.2.1'.padEnd(4097))), '127.0.0.1');
  assert.equal(resolve(request('127.0.0.1', `192.0.2.1${'\u2000'.repeat(2048)}`)), '127.0.0.1');
  assert.equal(resolve(request('127.0.0.1', ['192.0.2.1', ...Array(31).fill('10.0.0.2')].join(','))), '192.0.2.1');
  assert.equal(resolve(request('127.0.0.1', ['192.0.2.1', ...Array(32).fill('10.0.0.2')].join(','))), '127.0.0.1');
});

test('invalid proxy configuration fails early with a useful configuration error', () => {
  for (const config of [null, '127.0.0.1', {}, 1]) {
    assert.throws(() => createClientAddressResolver(config), /trustedProxies must be an array/);
  }
  assert.throws(() => createClientAddressResolver(Array(1)), /trustedProxies\[0\].*exact IPv4 or IPv6/);
  for (const value of ['', 'localhost', '*', '0.0.0.0/0', '127.0.0.1/32', '2001:db8::/32',
    '127.0.0.1:8080', '[::1]', 'fe80::1%lo0', ' 127.0.0.1 ', '999.0.0.1', null, 1]) {
    assert.throws(() => createClientAddressResolver(['127.0.0.1', value]), /trustedProxies\[1\].*exact IPv4 or IPv6/);
  }
});

test('a missing or invalid socket address uses a stable fallback', () => {
  const resolve = createClientAddressResolver(['127.0.0.1']);
  for (const peer of [undefined, null, '', 'invalid']) {
    assert.equal(resolve(request(peer, '192.0.2.1')), 'unknown');
  }
  assert.equal(resolve({ headers: { 'x-forwarded-for': '192.0.2.1' } }), 'unknown');
});
