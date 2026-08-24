const MAX_WORKFLOW_NODES = 100
const MAX_WORKFLOW_EDGES = 300

function validateWorkflowDefinition(workflow = {}) {
  const errors = []
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow.edges) ? workflow.edges : []
  if (nodes.length === 0) errors.push('工作流至少需要一个节点')
  if (nodes.length > MAX_WORKFLOW_NODES) errors.push(`工作流节点不能超过 ${MAX_WORKFLOW_NODES} 个`)
  if (edges.length > MAX_WORKFLOW_EDGES) errors.push(`工作流连线不能超过 ${MAX_WORKFLOW_EDGES} 条`)

  const nodeIds = new Set()
  for (const node of nodes) {
    const id = String(node?.id || '').trim()
    if (!id) errors.push('工作流节点必须包含 id')
    else if (nodeIds.has(id)) errors.push(`工作流节点 id 重复：${id}`)
    else nodeIds.add(id)
  }

  const adjacency = new Map([...nodeIds].map(id => [id, []]))
  const indegree = new Map([...nodeIds].map(id => [id, 0]))
  for (const edge of edges) {
    const source = String(edge?.source || '').trim()
    const target = String(edge?.target || '').trim()
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      errors.push(`工作流连线引用不存在的节点：${source || '?'} -> ${target || '?'}`)
      continue
    }
    adjacency.get(source).push(target)
    indegree.set(target, indegree.get(target) + 1)
  }

  if (errors.length === 0) {
    const queue = [...nodeIds].filter(id => indegree.get(id) === 0)
    let visited = 0
    while (queue.length > 0) {
      const id = queue.shift()
      visited += 1
      for (const target of adjacency.get(id)) {
        indegree.set(target, indegree.get(target) - 1)
        if (indegree.get(target) === 0) queue.push(target)
      }
    }
    if (visited !== nodeIds.size) errors.push('工作流不能包含循环依赖')
  }

  return { valid: errors.length === 0, errors }
}

function assertValidWorkflow(workflow) {
  const result = validateWorkflowDefinition(workflow)
  if (!result.valid) {
    const error = new Error(result.errors.join('；'))
    error.statusCode = 400
    throw error
  }
  return workflow
}

export { MAX_WORKFLOW_EDGES, MAX_WORKFLOW_NODES, assertValidWorkflow, validateWorkflowDefinition }
