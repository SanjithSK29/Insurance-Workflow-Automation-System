// Workflow Engine: deploys versioned BPMN definitions and executes instances
// (IWA-F-021, IWA-F-030). Camunda stand-in with the same concepts:
// definitions, instances, user tasks with candidate groups, process variables.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { parseBpmn } = require('./bpmn');
const { evaluateExpression } = require('./expression');
const { newId, nowIso } = require('../core/db');
const { ah, parseJson } = require('../core/util');
const { requireRole } = require('../security/middleware');
const { badRequest, notFound, forbidden, conflict } = require('../core/errors');

const DEFAULT_DEFINITIONS = ['claim-approval.bpmn'];

module.exports = function workflowModule(ctx) {
  const { db, bus, audit } = ctx;
  const parsedCache = new Map();

  function getParsed(defRow) {
    if (!parsedCache.has(defRow.id)) parsedCache.set(defRow.id, parseBpmn(defRow.xml));
    return parsedCache.get(defRow.id);
  }

  function deploy(xml, deployedBy) {
    const def = parseBpmn(xml); // throws with validationErrors on bad input
    const latest = db.get('SELECT MAX(version) AS v FROM workflow_definitions WHERE key = ?', def.key);
    const row = { id: newId('WD'), key: def.key, version: (latest?.v || 0) + 1, name: def.name };
    db.run(
      'INSERT INTO workflow_definitions (id, key, version, name, xml, deployed_by, created_at) VALUES (?,?,?,?,?,?,?)',
      row.id, row.key, row.version, row.name, xml, deployedBy, nowIso(),
    );
    audit.record(deployedBy, 'WORKFLOW_DEPLOYED', 'workflow_definition', row.id, { key: row.key, version: row.version });
    return { ...row, nodes: Object.keys(def.nodes).length, flows: Object.keys(def.flows).length };
  }

  function latestDefinition(key) {
    return db.get('SELECT * FROM workflow_definitions WHERE key = ? ORDER BY version DESC LIMIT 1', key);
  }

  function ensureDefaults() {
    for (const file of DEFAULT_DEFINITIONS) {
      const xml = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (!latestDefinition(parseBpmn(xml).key)) deploy(xml, 'system');
    }
  }

  // Walk from `nodeId` until the instance waits on a user task or ends.
  function advance(instance, def, nodeId, vars) {
    let current = nodeId;
    for (let steps = 0; steps < 500; steps++) {
      const node = def.nodes[current];
      if (node.type === 'userTask') {
        const task = {
          id: newId('T'), instance_id: instance.id, business_key: instance.business_key,
          node_id: node.id, name: node.name, candidate_group: node.candidateGroup,
        };
        db.run(
          `INSERT INTO workflow_tasks (id, instance_id, business_key, node_id, name, candidate_group, status, created_at)
           VALUES (?,?,?,?,?,?, 'OPEN', ?)`,
          task.id, task.instance_id, task.business_key, task.node_id, task.name, task.candidate_group, nowIso(),
        );
        db.run('UPDATE workflow_instances SET current_node = ?, variables = ? WHERE id = ?', node.id, JSON.stringify(vars), instance.id);
        bus.publish('workflow.task.created', {
          taskId: task.id, instanceId: instance.id, businessKey: instance.business_key, nodeId: node.id,
          name: node.name, candidateGroup: node.candidateGroup, definitionKey: def.key, variables: vars,
        });
        return { status: 'WAITING', task };
      }
      if (node.type === 'endEvent') {
        const result = node.result || 'COMPLETED';
        db.run(
          `UPDATE workflow_instances SET current_node = ?, status = 'COMPLETED', result = ?, variables = ?, completed_at = ? WHERE id = ?`,
          node.id, result, JSON.stringify(vars), nowIso(), instance.id,
        );
        bus.publish('workflow.completed', { instanceId: instance.id, businessKey: instance.business_key, definitionKey: def.key, result, variables: vars });
        return { status: 'COMPLETED', result };
      }
      if (node.type === 'serviceTask') {
        bus.publish(node.topic, { instanceId: instance.id, businessKey: instance.business_key, nodeId: node.id, variables: vars });
      }
      current = nextNode(def, node, vars);
    }
    throw new Error('Workflow exceeded maximum steps (possible infinite loop)');
  }

  function nextNode(def, node, vars) {
    if (node.type !== 'exclusiveGateway') return def.flows[node.outgoing[0]].target;
    for (const fid of node.outgoing) {
      const flow = def.flows[fid];
      if (fid !== node.defaultFlow && flow.condition && evaluateExpression(flow.condition, vars)) return flow.target;
    }
    if (node.defaultFlow) return def.flows[node.defaultFlow].target;
    if (node.outgoing.length === 1 && !def.flows[node.outgoing[0]].condition) return def.flows[node.outgoing[0]].target;
    throw new Error(`No outgoing flow of gateway '${node.id}' matched`);
  }

  function start(key, businessKey, variables = {}, actor = 'system') {
    const defRow = latestDefinition(key);
    if (!defRow) throw notFound(`Workflow '${key}'`);
    const def = getParsed(defRow);
    const instance = { id: newId('WI'), business_key: businessKey };
    db.run(
      `INSERT INTO workflow_instances (id, definition_id, business_key, current_node, status, variables, created_at)
       VALUES (?,?,?,?, 'ACTIVE', ?, ?)`,
      instance.id, defRow.id, businessKey, null, JSON.stringify(variables), nowIso(),
    );
    audit.record(actor, 'WORKFLOW_STARTED', 'workflow_instance', instance.id, { key, version: defRow.version, businessKey });
    const startNode = Object.values(def.nodes).find((n) => n.type === 'startEvent');
    const outcome = advance(instance, def, nextNode(def, startNode, variables), variables);
    return { instanceId: instance.id, definitionVersion: defRow.version, ...outcome };
  }

  function completeTask(taskId, user, { outcome, comment, variables = {} } = {}) {
    const task = db.get('SELECT * FROM workflow_tasks WHERE id = ?', taskId);
    if (!task) throw notFound('Task');
    if (task.status !== 'OPEN') throw conflict('TASK_CLOSED', 'Task is already completed');
    if (user.role !== task.candidate_group) throw forbidden(`Task '${task.name}' is assigned to ${task.candidate_group}`);
    if (!['approve', 'reject'].includes(outcome)) throw badRequest("outcome must be 'approve' or 'reject'");

    const instance = db.get('SELECT * FROM workflow_instances WHERE id = ?', task.instance_id);
    const def = getParsed(db.get('SELECT * FROM workflow_definitions WHERE id = ?', instance.definition_id));
    const vars = { ...parseJson(instance.variables, {}), ...variables, outcome, [`${task.node_id}_outcome`]: outcome };

    db.run(
      `UPDATE workflow_tasks SET status = 'COMPLETED', completed_by = ?, outcome = ?, comment = ?, completed_at = ? WHERE id = ?`,
      user.id, outcome, comment || null, nowIso(), task.id,
    );
    audit.record(user.id, 'TASK_COMPLETED', 'workflow_task', task.id, { name: task.name, outcome, businessKey: task.business_key });
    bus.publish('workflow.task.completed', { taskId: task.id, businessKey: task.business_key, nodeId: task.node_id, name: task.name, outcome, variables, userId: user.id });

    return advance(instance, def, nextNode(def, def.nodes[task.node_id], vars), vars);
  }

  const openTasksFor = (businessKey) =>
    db.all("SELECT * FROM workflow_tasks WHERE business_key = ? AND status = 'OPEN' ORDER BY created_at", businessKey);

  // ---------- routes ----------
  const router = express.Router();

  router.get('/tasks', requireRole('ADJUSTER', 'ADMIN', 'UNDERWRITER'), (req, res) => {
    const status = req.query.status === 'COMPLETED' ? 'COMPLETED' : 'OPEN';
    const rows = req.user.role === 'ADMIN' && req.query.all === 'true'
      ? db.all('SELECT * FROM workflow_tasks WHERE status = ? ORDER BY created_at', status)
      : db.all('SELECT * FROM workflow_tasks WHERE status = ? AND candidate_group = ? ORDER BY created_at', status, req.user.role);
    res.json(rows);
  });

  router.post('/tasks/:id/complete', requireRole('ADJUSTER', 'ADMIN', 'UNDERWRITER'), ah(async (req, res) => {
    res.json(completeTask(req.params.id, req.user, req.body || {}));
  }));

  router.get('/instances/:id', requireRole('ADJUSTER', 'ADMIN'), (req, res) => {
    const inst = db.get('SELECT * FROM workflow_instances WHERE id = ?', req.params.id);
    if (!inst) throw notFound('Workflow instance');
    res.json({
      ...inst,
      variables: parseJson(inst.variables, {}),
      tasks: db.all('SELECT * FROM workflow_tasks WHERE instance_id = ? ORDER BY created_at', inst.id),
    });
  });

  const adminRouter = express.Router();
  adminRouter.use(requireRole('ADMIN'));

  adminRouter.get('/', (req, res) => {
    res.json(db.all('SELECT id, key, version, name, deployed_by, created_at FROM workflow_definitions ORDER BY key, version DESC'));
  });

  adminRouter.get('/:key/latest', (req, res) => {
    const row = latestDefinition(req.params.key);
    if (!row) throw notFound('Workflow');
    const def = getParsed(row);
    res.json({ ...row, model: { nodes: Object.values(def.nodes), flows: Object.values(def.flows) } });
  });

  const asValidationError = (err) => {
    const e = badRequest(err.message, err.validationErrors);
    e.code = 'INVALID_BPMN';
    return e;
  };

  adminRouter.post('/validate', (req, res) => {
    try {
      const def = parseBpmn(req.body?.xml);
      res.json({ valid: true, key: def.key, nodes: Object.values(def.nodes), flows: Object.values(def.flows) });
    } catch (err) {
      throw asValidationError(err);
    }
  });

  adminRouter.post('/', (req, res) => {
    let result;
    try {
      result = deploy(req.body?.xml, req.user.id);
    } catch (err) {
      throw asValidationError(err);
    }
    res.status(201).json(result);
  });

  return { deploy, start, completeTask, openTasksFor, ensureDefaults, latestDefinition, router, adminRouter };
};
