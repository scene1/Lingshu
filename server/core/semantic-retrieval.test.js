import test from 'node:test'
import assert from 'node:assert/strict'
import { cosineSimilarity, hybridSemanticRank } from './semantic-retrieval.js'

test('computes cosine similarity and hybrid embedding rank', async () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  const ranked = await hybridSemanticRank([
    { title: '词法命中', relevance: 0.8 },
    { title: '语义命中', relevance: 0.1 },
  ], 'query', {
    minimumRelevance: 0,
    embedTexts: async () => [[1, 0], [0, 1], [1, 0]],
  })
  assert.equal(ranked.results[0].title, '语义命中')
  assert.equal(ranked.diagnostics.embedding, 'ok')
})

test('uses cross encoder scores and degrades when adapters fail', async () => {
  const ranked = await hybridSemanticRank([
    { title: 'A', relevance: 0.6 },
    { title: 'B', relevance: 0.5 },
  ], 'query', {
    minimumRelevance: 0,
    crossEncode: async () => [0.1, 0.95],
  })
  assert.equal(ranked.results[0].title, 'B')

  const degraded = await hybridSemanticRank([{ title: 'A', relevance: 0.6 }], 'query', {
    embedTexts: async () => { throw new Error('offline') },
  })
  assert.match(degraded.diagnostics.embedding, /^degraded:/)
  assert.equal(degraded.results.length, 1)
})
