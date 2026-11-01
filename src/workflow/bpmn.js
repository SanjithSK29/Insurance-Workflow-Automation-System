// Parser + validator for the BPMN 2.0 subset IWAS executes:
// startEvent, endEvent, userTask, serviceTask, exclusiveGateway, sequenceFlow
// (with conditionExpression and gateway default flows).
//
// Extension attributes (Camunda-compatible where possible):
//   userTask   camunda:candidateGroups="ADJUSTER"   (or iwas:candidateGroup)
//   serviceTask iwas:topic="claim.notify"           (published on the event bus)
//   endEvent   iwas:result="APPROVED"               (workflow outcome)
const { parse: parseExpression } = require('./expression');

const NODE_TYPES = ['startEvent', 'endEvent', 'userTask', 'serviceTask', 'exclusiveGateway'];
const ELEMENT = /<(?:[\w-]+:)?(startEvent|endEvent|userTask|serviceTask|exclusiveGateway|sequenceFlow)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?\1>)/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(ATTR)) out[m[1]] = decode(m[2]);
  return out;
}

function parseBpmn(source) {
  if (typeof source !== 'string' || !source.includes('definitions')) throw new Error('Not a BPMN definitions document');
  const xml = source.replace(/<!--[\s\S]*?-->/g, '');
  const processMatch = /<(?:[\w-]+:)?process\b([^>]*)>/.exec(xml);
  if (!processMatch) throw new Error('No <process> element found');
  const proc = attrs(processMatch[1]);
  if (!proc.id) throw new Error('<process> requires an id');

  const nodes = {};
  const flows = {};
  for (const m of xml.matchAll(ELEMENT)) {
    const [, type, attrSrc, inner = ''] = m;
    const a = attrs(attrSrc);
    if (!a.id) throw new Error(`<${type}> is missing an id`);
    if (nodes[a.id] || flows[a.id]) throw new Error(`Duplicate id '${a.id}'`);
    if (type === 'sequenceFlow') {
      const cond = /<(?:[\w-]+:)?conditionExpression[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?conditionExpression>/.exec(inner);
      const condition = cond ? decode(cond[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')).trim() : null;
      flows[a.id] = { id: a.id, source: a.sourceRef, target: a.targetRef, name: a.name || '', condition };
    } else {
      nodes[a.id] = {
        id: a.id,
        type,
        name: a.name || a.id,
        candidateGroup: a['camunda:candidateGroups'] || a['iwas:candidateGroup'] || null,
        topic: a['iwas:topic'] || null,
        result: a['iwas:result'] || null,
        defaultFlow: a.default || null,
        outgoing: [],
        incoming: [],
      };
    }
  }

  const def = { key: proc.id, name: proc.name || proc.id, nodes, flows };
  validate(def);
  return def;
}

function validate(def) {
  const { nodes, flows } = def;
  const errors = [];
  for (const f of Object.values(flows)) {
    if (!nodes[f.source]) errors.push(`Flow '${f.id}' has unknown sourceRef '${f.source}'`);
    if (!nodes[f.target]) errors.push(`Flow '${f.id}' has unknown targetRef '${f.target}'`);
    if (nodes[f.source]) nodes[f.source].outgoing.push(f.id);
    if (nodes[f.target]) nodes[f.target].incoming.push(f.id);
    if (f.condition) {
      try { parseExpression(f.condition); } catch (e) { errors.push(`Flow '${f.id}' condition invalid: ${e.message}`); }
    }
  }

  const starts = Object.values(nodes).filter((n) => n.type === 'startEvent');
  if (starts.length !== 1) errors.push(`Process must have exactly one startEvent (found ${starts.length})`);
  if (!Object.values(nodes).some((n) => n.type === 'endEvent')) errors.push('Process must have at least one endEvent');

  for (const n of Object.values(nodes)) {
    if (n.type !== 'endEvent' && n.outgoing.length === 0) errors.push(`Node '${n.id}' has no outgoing flow`);
    if (n.type === 'endEvent' && n.outgoing.length) errors.push(`endEvent '${n.id}' must not have outgoing flows`);
    if (n.type === 'userTask' && !n.candidateGroup) errors.push(`userTask '${n.id}' needs camunda:candidateGroups`);
    if (n.type === 'serviceTask' && !n.topic) errors.push(`serviceTask '${n.id}' needs iwas:topic`);
    if (n.type === 'exclusiveGateway') {
      for (const fid of n.outgoing) {
        if (!flows[fid].condition && n.defaultFlow !== fid && n.outgoing.length > 1) {
          errors.push(`Gateway '${n.id}' flow '${fid}' needs a condition or must be the default`);
        }
      }
      if (n.defaultFlow && !n.outgoing.includes(n.defaultFlow)) errors.push(`Gateway '${n.id}' default flow is not one of its outgoing flows`);
    } else if (n.type !== 'endEvent' && n.outgoing.length > 1) {
      errors.push(`Node '${n.id}' has several outgoing flows; use an exclusiveGateway`);
    }
  }

  if (starts.length === 1) {
    const seen = new Set();
    const stack = [starts[0].id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || !nodes[id]) continue;
      seen.add(id);
      for (const fid of nodes[id].outgoing) stack.push(flows[fid].target);
    }
    for (const id of Object.keys(nodes)) if (!seen.has(id)) errors.push(`Node '${id}' is unreachable from the start event`);
  }

  if (errors.length) {
    const err = new Error(`Invalid BPMN: ${errors[0]}`);
    err.validationErrors = errors;
    throw err;
  }
}

module.exports = { parseBpmn, NODE_TYPES };
