import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAndRankKnowledgeResults, scoreKnowledgeCandidate, tokenizeKnowledgeQuery } from './knowledge-relevance.js'

test('extracts meaningful mixed-language query terms', () => {
  assert.deepEqual(tokenizeKnowledgeQuery('OAG 跟 RAG 的区别是什么'), ['oag', 'rag'])
})

test('excludes generated conversation archives from normal knowledge retrieval', () => {
  const results = filterAndRankKnowledgeResults([
    {
      title: '知识库问答',
      relativePath: '灵枢/Conversations/AI对话/会话_2026-08-17.md',
      snippet: '会话ID: session model: sonnet OAG 跟 RAG 的区别',
    },
    {
      title: 'OAG 与 RAG 架构比较',
      relativePath: '架构/检索增强.md',
      snippet: 'OAG 强调工具编排，RAG 强调外部知识检索与上下文注入。',
    },
  ], 'OAG 跟 RAG 的区别是什么')

  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'OAG 与 RAG 架构比较')
  assert.ok(results[0].relevance >= 0.8)
})

test('allows conversation archives only for explicit history questions', () => {
  const archive = {
    title: '上次会话',
    relativePath: '灵枢/Conversations/AI对话/上次会话.md',
    snippet: '我们上次说的项目计划包含三个阶段。',
  }
  assert.equal(filterAndRankKnowledgeResults([archive], '项目计划').length, 0)
  assert.equal(filterAndRankKnowledgeResults([archive], '找一下我们上次说的项目计划').length, 1)
  assert.ok(scoreKnowledgeCandidate(archive, '找一下我们上次说的项目计划') > 0)
})
