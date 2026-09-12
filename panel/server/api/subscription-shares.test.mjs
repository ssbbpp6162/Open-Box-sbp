import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createStore } from '../store/openbox-store.mjs'
import { registerPublicSubscriptionShareRoutes, registerSubscriptionShareRoutes } from './subscription-shares.mjs'

const setup = async () => {
  const map = new Map()
  const store = createStore({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), del: (k) => map.delete(k) })
  store.setSubscriptions([{ id: 'one', name: 'One', content: 'ss://example#one', nodeCount: 1 }])
  const app = express()
  registerPublicSubscriptionShareRoutes(app, { store, fetchImpl: async () => ({ ok: true, text: async () => '' }) })
  registerSubscriptionShareRoutes(app, { store })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return { store, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('subscription share management and public URL', async () => {
  const { store, base, close } = await setup()
  try {
    const createdResponse = await fetch(`${base}/api/openbox/subscription-shares`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '手机', host: 'router.local:2026', subscriptionIds: ['one'] }) })
    assert.equal(createdResponse.status, 201)
    const { share } = await createdResponse.json()
    assert.equal(share.subscriptionIds[0], 'one')
    const publicResponse = await fetch(`${base}/sub/${share.token}`)
    assert.equal(publicResponse.status, 200)
    assert.equal(await publicResponse.text(), 'ss://example#one')
    const regenerated = await fetch(`${base}/api/openbox/subscription-shares/${share.id}/regenerate`, { method: 'POST' })
    assert.equal(regenerated.status, 200)
    const next = (await regenerated.json()).share
    assert.notEqual(next.token, share.token)
    const disabled = await fetch(`${base}/api/openbox/subscription-shares/${share.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
    assert.equal(disabled.status, 200)
    assert.equal((await disabled.json()).share.enabled, false)
    assert.equal((await fetch(`${base}/sub/${next.token}`)).status, 404)
    assert.equal(store.getSubscriptionShares().length, 1)
  } finally { await close() }
})

test('public URL decodes base64 subscription content before serving', async () => {
  const { store, base, close } = await setup()
  try {
    const encoded = Buffer.from('ss://example#one\n', 'utf8').toString('base64')
    store.setSubscriptions([{ id: 'one', name: 'One', content: encoded, nodeCount: 1 }])
    const createdResponse = await fetch(`${base}/api/openbox/subscription-shares`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'base64', host: 'router.local:2026', subscriptionIds: ['one'] }) })
    const { share } = await createdResponse.json()
    const response = await fetch(`${base}/sub/${share.token}`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ss://example#one')
  } finally { await close() }
})
