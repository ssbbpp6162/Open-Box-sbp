import { randomBytes } from 'node:crypto'
import dns from 'node:dns/promises'
import express from 'express'
import YAML from 'yaml'
import { fetchSubscriptionText, subscriptionUrls } from './subscriptions.mjs'

const MAX_NAME = 120
const tokenFor = () => randomBytes(24).toString('hex')
const now = () => Date.now()
const cleanName = (value) => typeof value === 'string' ? value.trim().slice(0, MAX_NAME) : ''
const normalizeProtocol = (value) => value === 'http' || value === 'https' ? value : ''

const normalizeIds = (value, subscriptions) => {
  if (!Array.isArray(value)) return []
  const allowed = new Set(subscriptions.map((s) => s.id))
  return [...new Set(value.filter((id) => typeof id === 'string' && allowed.has(id)))]
}

const normalizeRecord = (raw) => ({
  id: typeof raw?.id === 'string' ? raw.id : tokenFor(),
  name: cleanName(raw?.name) || '订阅分享',
  token: typeof raw?.token === 'string' && raw.token.length >= 32 ? raw.token : tokenFor(),
  subscriptionIds: Array.isArray(raw?.subscriptionIds) ? raw.subscriptionIds.filter((id) => typeof id === 'string') : [],
  host: typeof raw?.host === 'string' ? raw.host.trim() : '',
  protocol: normalizeProtocol(raw?.protocol),
  createdAt: Number(raw?.createdAt) || now(),
  updatedAt: Number(raw?.updatedAt) || now(),
})

const sourceText = async (sub, { fetchImpl, lookup }) => {
  if (typeof sub?.content === 'string' && sub.content.trim()) return sub.content.trim()
  const url = subscriptionUrls(sub)[0]
  if (!url) return ''
  return fetchSubscriptionText(url, fetchImpl, lookup, 'Open-Box/1.0')
}

const mergeContents = (parts) => {
  const nonempty = parts.map((p) => p.trim()).filter(Boolean)
  if (!nonempty.length) return { body: '', type: 'text/plain; charset=utf-8' }
  if (nonempty.length === 1) return { body: nonempty[0], type: 'text/plain; charset=utf-8' }

  const parsed = nonempty.map((text) => {
    try {
      const value = YAML.parse(text)
      if (value && Array.isArray(value.proxies)) return { kind: 'clash', value }
    } catch {}
    try {
      const value = JSON.parse(text)
      if (value && Array.isArray(value.outbounds)) return { kind: 'singbox', value }
    } catch {}
    return { kind: 'sharelink', value: text }
  })

  if (parsed.every((p) => p.kind === 'clash')) {
    const proxies = parsed.flatMap((p) => p.value.proxies || [])
    return { body: YAML.stringify({ proxies }), type: 'text/yaml; charset=utf-8' }
  }
  if (parsed.every((p) => p.kind === 'singbox')) {
    const outbounds = parsed.flatMap((p) => p.value.outbounds || [])
    return { body: JSON.stringify({ outbounds }, null, 2), type: 'application/json; charset=utf-8' }
  }
  if (parsed.every((p) => p.kind === 'sharelink')) {
    return { body: parsed.map((p) => p.value).join('\n'), type: 'text/plain; charset=utf-8' }
  }
  return { body: nonempty.join('\n'), type: 'text/plain; charset=utf-8' }
}

export const registerPublicSubscriptionShareRoutes = (app, { store, fetchImpl = globalThis.fetch, lookup = dns.lookup } = {}) => {
  app.get('/sub/:token', async (req, res) => {
    try {
      const share = store.getSubscriptionShares().map(normalizeRecord).find((item) => item.token === req.params.token)
      if (!share) return res.status(404).type('text/plain').send('subscription share not found')
      const subscriptions = store.getSubscriptions()
      const selected = share.subscriptionIds.map((id) => subscriptions.find((s) => s.id === id)).filter(Boolean)
      const parts = []
      for (const sub of selected) parts.push(await sourceText(sub, { fetchImpl, lookup }))
      const merged = mergeContents(parts)
      if (!merged.body) return res.status(404).type('text/plain').send('subscription share has no content')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', merged.type)
      return res.send(merged.body)
    } catch (error) {
      return res.status(502).type('text/plain').send(error instanceof Error ? error.message : String(error))
    }
  })
}

export const registerSubscriptionShareRoutes = (app, { store } = {}) => {
  const router = express.Router()
  router.use(express.json({ limit: '256kb' }))

  router.get('/', (_req, res) => {
    const subscriptions = store.getSubscriptions()
    const valid = new Set(subscriptions.map((s) => s.id))
    const shares = store.getSubscriptionShares().map((raw) => {
      const share = normalizeRecord(raw)
      return { ...share, subscriptionIds: share.subscriptionIds.filter((id) => valid.has(id)) }
    })
    res.json({ shares })
  })

  router.post('/', (req, res) => {
    const name = cleanName(req.body?.name)
    if (!name) return res.status(400).json({ error: 'name is required' })
    const subscriptionIds = normalizeIds(req.body?.subscriptionIds, store.getSubscriptions())
    if (!subscriptionIds.length) return res.status(400).json({ error: 'select at least one subscription' })
    const host = typeof req.body?.host === 'string' ? req.body.host.trim() : ''
    if (!host) return res.status(400).json({ error: 'host is required' })
    const protocol = normalizeProtocol(req.body?.protocol) || 'https'
    const timestamp = now()
    const share = { id: tokenFor(), name, host, protocol, token: tokenFor(), subscriptionIds, createdAt: timestamp, updatedAt: timestamp }
    store.setSubscriptionShares([...store.getSubscriptionShares(), share])
    return res.status(201).json({ share })
  })

  router.patch('/:id', (req, res) => {
    const list = store.getSubscriptionShares().map(normalizeRecord)
    const index = list.findIndex((item) => item.id === req.params.id)
    if (index < 0) return res.status(404).json({ error: 'subscription share not found' })
    const current = list[index]
    const name = req.body?.name === undefined ? current.name : cleanName(req.body.name)
    if (!name) return res.status(400).json({ error: 'name is required' })
    const subscriptionIds = req.body?.subscriptionIds === undefined
      ? current.subscriptionIds
      : normalizeIds(req.body.subscriptionIds, store.getSubscriptions())
    if (!subscriptionIds.length) return res.status(400).json({ error: 'select at least one subscription' })
    const host = req.body?.host === undefined ? current.host : (typeof req.body.host === 'string' ? req.body.host.trim() : '')
    if (!host) return res.status(400).json({ error: 'host is required' })
    const protocol = req.body?.protocol === undefined ? current.protocol : normalizeProtocol(req.body.protocol)
    const updated = { ...current, name, host, protocol, subscriptionIds, token: req.body?.regenerate ? tokenFor() : current.token, updatedAt: now() }
    list[index] = updated
    store.setSubscriptionShares(list)
    return res.json({ share: updated })
  })

  router.post('/:id/regenerate', (req, res) => {
    const list = store.getSubscriptionShares().map(normalizeRecord)
    const index = list.findIndex((item) => item.id === req.params.id)
    if (index < 0) return res.status(404).json({ error: 'subscription share not found' })
    list[index] = { ...list[index], token: tokenFor(), updatedAt: now() }
    store.setSubscriptionShares(list)
    return res.json({ share: list[index] })
  })

  router.delete('/:id', (req, res) => {
    const list = store.getSubscriptionShares().map(normalizeRecord)
    const next = list.filter((item) => item.id !== req.params.id)
    if (next.length === list.length) return res.status(404).json({ error: 'subscription share not found' })
    store.setSubscriptionShares(next)
    return res.json({ ok: true })
  })

  app.use('/api/openbox/subscription-shares', router)
}
