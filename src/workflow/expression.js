// Safe evaluator for BPMN condition expressions such as
//   ${amount > 100000 && fraudFlagged == false}
// Supports variables, number/string/boolean literals, comparison operators,
// &&, ||, ! and parentheses. No eval/Function is used.

const TOKEN = /\s*(\d+(?:\.\d+)?|'[^']*'|"[^"]*"|&&|\|\||==|!=|>=|<=|>|<|!|\(|\)|[A-Za-z_][\w.]*)/y;

function tokenize(src) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Unexpected character in expression at ${pos}: '${src.slice(pos, pos + 10)}'`);
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

function parse(src) {
  const body = src.trim().replace(/^\$\{([\s\S]*)\}$/, '$1');
  const tokens = tokenize(body);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function primary() {
    const t = next();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (t === '(') {
      const node = or();
      if (next() !== ')') throw new Error('Missing )');
      return node;
    }
    if (t === '!') return { op: '!', arg: primary() };
    if (/^\d/.test(t)) return { lit: Number(t) };
    if (/^['"]/.test(t)) return { lit: t.slice(1, -1) };
    if (t === 'true' || t === 'false') return { lit: t === 'true' };
    if (t === 'null') return { lit: null };
    if (/^[A-Za-z_]/.test(t)) return { ref: t };
    throw new Error(`Unexpected token '${t}'`);
  }
  function comparison() {
    let left = primary();
    while (['==', '!=', '>', '>=', '<', '<='].includes(peek())) {
      const op = next();
      left = { op, left, right: primary() };
    }
    return left;
  }
  function and() {
    let left = comparison();
    while (peek() === '&&') { next(); left = { op: '&&', left, right: comparison() }; }
    return left;
  }
  function or() {
    let left = and();
    while (peek() === '||') { next(); left = { op: '||', left, right: and() }; }
    return left;
  }

  const ast = or();
  if (i !== tokens.length) throw new Error(`Unexpected token '${tokens[i]}'`);
  return ast;
}

function evaluate(ast, vars) {
  if ('lit' in ast) return ast.lit;
  if ('ref' in ast) return ast.ref.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
  const L = () => evaluate(ast.left, vars);
  const R = () => evaluate(ast.right, vars);
  switch (ast.op) {
    case '!': return !evaluate(ast.arg, vars);
    case '&&': return Boolean(L()) && Boolean(R());
    case '||': return Boolean(L()) || Boolean(R());
    // eslint-disable-next-line eqeqeq
    case '==': return L() == R();
    // eslint-disable-next-line eqeqeq
    case '!=': return L() != R();
    case '>': return L() > R();
    case '>=': return L() >= R();
    case '<': return L() < R();
    case '<=': return L() <= R();
    default: throw new Error(`Unknown operator ${ast.op}`);
  }
}

const evaluateExpression = (src, vars) => Boolean(evaluate(parse(src), vars));

module.exports = { parse, evaluate, evaluateExpression };
