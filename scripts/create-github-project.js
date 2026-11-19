// Creates the GitHub Project board for IWAS from docs/SPRINTS.md and links it
// to the repository (course Part-2 §1: backlog, story points, owners, sprints).
//
// GitHub links a project only to repositories with the same owner, so this
// must run as the repository owner (SanjithSK29):
//
//   1. Install the GitHub CLI: https://cli.github.com
//   2. gh auth login                     (sign in as SanjithSK29)
//   3. gh auth refresh -s project        (allow creating projects)
//   4. node scripts/create-github-project.js --dry-run   (shows what will be created)
//   5. node scripts/create-github-project.js
//
// It creates the project "IWAS Backlog" with:
//   - a Sprint iteration field: Sprint 1-4 on the real sprint dates
//   - Story points (number) and Owner (single select) fields
//   - one item per backlog row in docs/SPRINTS.md, with sprint, points, owner,
//     requirement and delivering PR, assigned to the owner's GitHub account
//   - Status = Done (every row has been delivered)
// and links the project to SanjithSK29/Insurance-Workflow-Automation-System.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OWNER = 'SanjithSK29';
const REPO = 'Insurance-Workflow-Automation-System';
const TITLE = process.env.PROJECT_TITLE || 'IWAS Backlog';
const DRY_RUN = process.argv.includes('--dry-run');

const SPRINTS = [
  { title: 'Sprint 1', startDate: '2026-10-19', duration: 5 },
  { title: 'Sprint 2', startDate: '2026-10-26', duration: 5 },
  { title: 'Sprint 3', startDate: '2026-11-01', duration: 17 },
  { title: 'Sprint 4', startDate: '2026-11-18', duration: 1 },
];
const OWNER_COLORS = ['BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'PINK', 'YELLOW', 'RED', 'GRAY'];

// ---------------------------------------------------------------- read the backlog
function readBacklog() {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPRINTS.md'), 'utf8');
  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

  // GitHub accounts from the "Team and roles" table, keyed by every part of the
  // name, because the backlog uses either first or last name ("Sakaray Vishal" -> Vishal).
  const logins = {};
  for (const line of md.split('\n')) {
    const c = cells(line);
    if (c.length === 4 && /^`[\w-]+`$/.test(c[1])) for (const part of c[0].split(' ')) logins[part] = c[1].replace(/`/g, '');
  }

  const items = [];
  let sprint = null;
  for (const line of md.split('\n')) {
    const heading = /^### (Sprint \d)\b/.exec(line);
    if (heading) { sprint = heading[1]; continue; }
    if (/^## /.test(line)) sprint = null;
    if (!sprint || !line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length !== 6 || c[0] === 'Item' || /^-+$/.test(c[0]) || c[0].startsWith('**')) continue;
    const [title, requirement, owner, sp, deliveredIn, date] = c;
    items.push({ sprint, title, requirement, owner, login: logins[owner] || null, points: Number(sp), deliveredIn: deliveredIn.replace(/`/g, ''), date });
  }
  if (!items.length) throw new Error('No backlog rows found in docs/SPRINTS.md');
  return items;
}

// ---------------------------------------------------------------- GitHub GraphQL via gh
function gql(query, variables = {}) {
  const out = execFileSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify({ query, variables }), encoding: 'utf8' });
  const res = JSON.parse(out);
  if (res.errors) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data;
}

function main() {
  const items = readBacklog();
  const owners = [...new Set(items.map((i) => i.owner))];
  console.log(`${items.length} backlog items, ${items.reduce((s, i) => s + i.points, 0)} story points`);
  for (const s of SPRINTS) {
    const rows = items.filter((i) => i.sprint === s.title);
    console.log(`  ${s.title} (${s.startDate}, ${s.duration} day(s)): ${rows.length} items, ${rows.reduce((t, i) => t + i.points, 0)} SP`);
  }
  console.log(`  owners: ${owners.map((o) => `${o} (${items.find((i) => i.owner === o).login || 'no login'})`).join(', ')}`);
  if (DRY_RUN) {
    for (const i of items) console.log(`  [${i.sprint}] ${i.points} SP  ${i.owner.padEnd(9)} ${i.title}`);
    console.log('\nDry run: nothing was created.');
    return;
  }

  const ids = gql(`query($owner:String!,$repo:String!){ user(login:$owner){ id projectsV2(first:50){ nodes { title number url } } } repository(owner:$owner,name:$repo){ id } }`, { owner: OWNER, repo: REPO });
  const existing = ids.user.projectsV2.nodes.find((p) => p.title === TITLE);
  if (existing) throw new Error(`A project called "${TITLE}" already exists: ${existing.url}. Delete it or set PROJECT_TITLE.`);

  const project = gql(`mutation($owner:ID!,$title:String!){ createProjectV2(input:{ownerId:$owner,title:$title}){ projectV2 { id number url } } }`, { owner: ids.user.id, title: TITLE }).createProjectV2.projectV2;
  console.log(`\nCreated ${project.url}`);

  // Sprint field: a real iteration field when the API allows it, otherwise a single select.
  let sprintField;
  try {
    const f = gql(`mutation($p:ID!,$cfg:ProjectV2IterationFieldConfigurationInput!){ createProjectV2Field(input:{projectId:$p,dataType:ITERATION,name:"Sprint",iterationConfiguration:$cfg}){
        projectV2Field { ... on ProjectV2IterationField { id configuration { iterations { id title } } } } } }`,
    { p: project.id, cfg: { startDate: SPRINTS[0].startDate, duration: 7, iterations: SPRINTS } }).createProjectV2Field.projectV2Field;
    sprintField = { id: f.id, kind: 'iteration', options: Object.fromEntries(f.configuration.iterations.map((it) => [it.title, it.id])) };
  } catch (err) {
    console.log(`  iteration field not available (${err.message}); using a single-select Sprint field`);
    const f = gql(`mutation($p:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"Sprint",singleSelectOptions:$opts}){
        projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } } }`,
    { p: project.id, opts: SPRINTS.map((s, n) => ({ name: s.title, color: OWNER_COLORS[n], description: `${s.startDate}, ${s.duration} day(s)` })) }).createProjectV2Field.projectV2Field;
    sprintField = { id: f.id, kind: 'select', options: Object.fromEntries(f.options.map((o) => [o.name, o.id])) };
  }

  const pointsField = gql(`mutation($p:ID!){ createProjectV2Field(input:{projectId:$p,dataType:NUMBER,name:"Story points"}){ projectV2Field { ... on ProjectV2Field { id } } } }`, { p: project.id }).createProjectV2Field.projectV2Field;
  const ownerField = gql(`mutation($p:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"Owner",singleSelectOptions:$opts}){
      projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } } }`,
  { p: project.id, opts: owners.map((o, n) => ({ name: o, color: OWNER_COLORS[n % OWNER_COLORS.length], description: items.find((i) => i.owner === o).login || '' })) }).createProjectV2Field.projectV2Field;
  const ownerOption = Object.fromEntries(ownerField.options.map((o) => [o.name, o.id]));

  // The built-in Status field: every backlog row has been delivered.
  const fields = gql(`query($p:ID!){ node(id:$p){ ... on ProjectV2 { fields(first:50){ nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`, { p: project.id }).node.fields.nodes;
  const status = fields.find((f) => f && f.name === 'Status');
  const done = status && status.options.find((o) => o.name === 'Done');

  const userIds = {};
  for (const login of new Set(items.map((i) => i.login).filter(Boolean))) {
    try { userIds[login] = gql(`query($l:String!){ user(login:$l){ id } }`, { l: login }).user.id; } catch { /* account not found: owner field still set */ }
  }

  const setField = (itemId, fieldId, value) => gql(`mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){ projectV2Item { id } } }`,
    { p: project.id, i: itemId, f: fieldId, v: value });

  for (const [n, it] of items.entries()) {
    const body = [`**Requirement:** ${it.requirement}`, `**Owner:** ${it.owner}${it.login ? ` (@${it.login})` : ''}`, `**Story points:** ${it.points}`,
      `**Delivered in:** ${it.deliveredIn} on ${it.date}`, '', 'Source: docs/SPRINTS.md'].join('\n');
    const add = (assignees) => gql(`mutation($p:ID!,$t:String!,$b:String,$a:[ID!]){ addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b,assigneeIds:$a}){ projectItem { id } } }`,
      { p: project.id, t: `${it.title} (${it.requirement})`, b: body, a: assignees }).addProjectV2DraftIssue.projectItem.id;
    let itemId;
    try { itemId = add(it.login && userIds[it.login] ? [userIds[it.login]] : []); } catch { itemId = add([]); }
    setField(itemId, sprintField.id, sprintField.kind === 'iteration' ? { iterationId: sprintField.options[it.sprint] } : { singleSelectOptionId: sprintField.options[it.sprint] });
    setField(itemId, pointsField.id, { number: it.points });
    setField(itemId, ownerField.id, { singleSelectOptionId: ownerOption[it.owner] });
    if (done) setField(itemId, status.id, { singleSelectOptionId: done.id });
    console.log(`  ${String(n + 1).padStart(2)}/${items.length} [${it.sprint}] ${it.title}`);
  }

  gql(`mutation($p:ID!,$r:ID!){ linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){ repository { id } } }`, { p: project.id, r: ids.repository.id });
  console.log(`\nLinked to ${OWNER}/${REPO}. Open ${project.url} and group the board by "Sprint".`);
}

try {
  main();
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
