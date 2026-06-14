const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    randomDelayMs,
    isUrlMatch,
    isRestrictedUrl,
    validateInterval,
    INTERVAL_MAX_SEC,
} = require('../utils.js');

test('randomDelayMs returns milliseconds within [min, max]', () => {
    for (let i = 0; i < 1000; i++) {
        const ms = randomDelayMs(5, 10);
        assert.ok(ms >= 5000 && ms <= 10000, `out of range: ${ms}`);
        assert.equal(ms % 1000, 0, 'should be whole seconds');
    }
});

test('randomDelayMs with min === max is deterministic', () => {
    assert.equal(randomDelayMs(30, 30), 30000);
});

test('isUrlMatch ignores protocol, trailing slash and hash', () => {
    assert.ok(isUrlMatch('http://example.com/path', 'https://example.com/path'));
    assert.ok(isUrlMatch('https://example.com/path/', 'https://example.com/path'));
    assert.ok(isUrlMatch('https://example.com/p#a', 'https://example.com/p#b'));
    assert.ok(isUrlMatch('https://example.com', 'https://example.com'));
});

test('isUrlMatch compares host, path and query', () => {
    assert.ok(isUrlMatch('https://example.com/p?a=1', 'https://example.com/p?a=1'));
    assert.ok(!isUrlMatch('https://example.com/p?a=1', 'https://example.com/p?a=2'));
    assert.ok(!isUrlMatch('https://example.com/a', 'https://example.com/b'));
    assert.ok(!isUrlMatch('https://a.com/p', 'https://b.com/p'));
});

test('isUrlMatch handles empty and malformed input', () => {
    assert.ok(!isUrlMatch('', 'https://example.com'));
    assert.ok(!isUrlMatch('https://example.com', null));
    assert.ok(!isUrlMatch('not a url', 'also not a url'));
});

test('isRestrictedUrl flags browser-internal and store pages', () => {
    assert.ok(isRestrictedUrl('chrome://extensions'));
    assert.ok(isRestrictedUrl('about:addons'));
    assert.ok(isRestrictedUrl('edge://settings'));
    assert.ok(isRestrictedUrl('view-source:https://example.com'));
    assert.ok(isRestrictedUrl('chrome-extension://abc/popup.html'));
    assert.ok(isRestrictedUrl('https://chromewebstore.google.com/detail/x'));
    assert.ok(isRestrictedUrl('https://addons.mozilla.org/firefox/addon/x'));
    assert.ok(isRestrictedUrl(''));
    assert.ok(isRestrictedUrl(undefined));
});

test('isRestrictedUrl allows normal web pages', () => {
    assert.ok(!isRestrictedUrl('https://example.com'));
    assert.ok(!isRestrictedUrl('http://localhost:3000/dashboard'));
});

test('validateInterval accepts valid positive integers', () => {
    assert.deepEqual(validateInterval('30', '35'), { min: 30, max: 35 });
    assert.deepEqual(validateInterval(10, 10), { min: 10, max: 10 });
    assert.deepEqual(validateInterval('1', String(INTERVAL_MAX_SEC)), { min: 1, max: INTERVAL_MAX_SEC });
});

test('validateInterval rejects non-positive-integers', () => {
    assert.equal(validateInterval('0', '10').error, 'bad');
    assert.equal(validateInterval('1.5', '10').error, 'bad');
    assert.equal(validateInterval('-5', '10').error, 'bad');
    assert.equal(validateInterval('abc', '10').error, 'bad');
    assert.equal(validateInterval('', '10').error, 'bad');
});

test('validateInterval rejects out-of-bounds values', () => {
    assert.equal(validateInterval('1', String(INTERVAL_MAX_SEC + 1)).error, 'bounds');
});

test('validateInterval rejects max < min', () => {
    assert.equal(validateInterval('40', '30').error, 'minmax');
});
