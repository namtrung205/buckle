import assert from 'node:assert/strict'
import test from 'node:test'
import { RpcBudget, RpcProtocolError, parseRpcRequest, rpcErrorResult, rpcFailure, rpcSuccess, validateRpcParams } from './rpc.ts'

const call = (id: string, method: string, params?: unknown) =>
  params === undefined ? { v: 1, id, method } : { v: 1, id, method, params }

test('a valid request parses (no-params method)', () => {
  const request = parseRpcRequest(call('1', 'model.query'))
  assert.equal(request.method, 'model.query')
  assert.equal(request.id, '1')
})

test('a valid request parses with object params', () => {
  const request = parseRpcRequest(call('2', 'ui.notify', { message: 'hi', kind: 'info' }))
  assert.deepEqual(request.params, { message: 'hi', kind: 'info' })
})

test('malformed envelopes fail closed', () => {
  assert.throws(() => parseRpcRequest(null), /must be an object/)
  assert.throws(() => parseRpcRequest({ v: 2, id: 'x', method: 'model.query' }), /version/)
  assert.throws(() => parseRpcRequest({ v: 1, id: 'x', method: 'model.query', extra: 1 }), /Unknown RPC key/)
  assert.throws(() => parseRpcRequest({ v: 1, id: '', method: 'model.query' }), /id/)
})

test('unknown methods fail closed', () => {
  assert.throws(() => parseRpcRequest(call('3', 'host.evaluate', { code: 'process.exit()' })), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'UNKNOWN_METHOD')
  assert.throws(() => parseRpcRequest(call('4', 'storage.getItem', { key: 'token' })), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'UNKNOWN_METHOD')
})

test('params are validated against the method spec', () => {
  assert.throws(() => validateRpcParams('model.query', {}), /takes no params/)
  assert.throws(() => parseRpcRequest(call('5', 'ui.notify')), /requires a params object/)
  assert.throws(() => parseRpcRequest(call('6', 'ui.notify', 'text')), /must be an object/)
  assert.throws(() => parseRpcRequest(call('7', 'ui.notify', { message: 'x'.repeat(5000) })), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'MESSAGE_TOO_LARGE')
})

test('oversized messages fail closed before parsing', () => {
  const big = JSON.stringify(call('8', 'model.execute', { command: { type: 'Transaction', payload: { operations: [] } }, blob: 'x'.repeat(300 * 1024) }))
  assert.throws(() => parseRpcRequest(JSON.parse(big)), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'MESSAGE_TOO_LARGE')
})

test('result envelopes have the protocol shape', () => {
  assert.deepEqual(rpcSuccess('9', { ok: 1 }), { v: 1, id: '9', ok: true, value: { ok: 1 } })
  assert.deepEqual(rpcFailure('9', 'NOPE', 'nope'), { v: 1, id: '9', ok: false, error: { code: 'NOPE', message: 'nope' } })
  const error = rpcErrorResult('9', new RpcProtocolError('INVALID_PARAMS', 'bad'))
  assert.deepEqual(error, { v: 1, id: '9', ok: false, error: { code: 'INVALID_PARAMS', message: 'bad' } })
})

test('the budget rejects bursts over the rate cap', () => {
  const now = 0
  const budget = new RpcBudget({ maxCalls: 3, windowMs: 1000, now: () => now })
  for (let index = 0; index < 3; index++) budget.countMessage(10)
  assert.throws(() => budget.countMessage(10), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'RATE_EXCEEDED')
})

test('the budget window resets as time advances', () => {
  let now = 0
  const budget = new RpcBudget({ maxCalls: 2, windowMs: 1000, now: () => now })
  budget.countMessage(1)
  budget.countMessage(1)
  now = 1500
  budget.countMessage(1)
  assert.doesNotThrow(() => budget.countMessage(1))
})

test('the budget enforces the message size limit', () => {
  const budget = new RpcBudget({ sizeLimit: 100, now: () => 0 })
  assert.throws(() => budget.countMessage(101), (error: unknown) =>
    error instanceof RpcProtocolError && error.code === 'MESSAGE_TOO_LARGE')
})
