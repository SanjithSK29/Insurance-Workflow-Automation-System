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
//   - one item per backlog row in docs/SPRINTS.md. Each row uses its existing
//     repository issue ("[Sprint N] <requirement>: <item>"); rows without an
//     issue get one, created in the same format and closed as completed.
//     Issues are assigned to the owner's GitHub account.
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

// ---------------------------------------------------------------- existing backlog issues
const issueTitle = (it) => `[${it.sprint}] ${it.requirement}: ${it.title}`;
const norm = (s) => s.toLowerCase().replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

// Issues (not PRs) of the repository, open and closed. The dry run uses the
// public API so it works before `gh auth login`.
async function listIssues() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}`;
    let batch;
    if (DRY_RUN) {
      const res = await fetch(`https://api.github.com/${url}`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
      batch = await res.json();
    } else {
      batch = JSON.parse(execFileSync('gh', ['api', url], { encoding: 'utf8' }));
    }
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return all;
}

// Pair each backlog row with its issue: same "[Sprint N]" prefix and the row's
// item text in the issue title.
function matchIssues(items, issues) {
  const used = new Set();
  for (const it of items) {
    const prefix = norm(`[${it.sprint}]`);
    const want = norm(it.title);
    const hit = issues.find((i) => !used.has(i.number) && norm(i.title).startsWith(prefix) && norm(i.title).includes(want));
    if (hit) { it.issue = hit; used.add(hit.number); }
  }
  return issues.filter((i) => /^\[Sprint \d\]/.test(i.title) && !used.has(i.number));
}

async function main() {
  const items = readBacklog();
  const owners = [...new Set(items.map((i) => i.owner))];
  console.log(`${items.length} backlog items, ${items.reduce((s, i) => s + i.points, 0)} story points`);
  for (const s of SPRINTS) {
    const rows = items.filter((i) => i.sprint === s.title);
    console.log(`  ${s.title} (${s.startDate}, ${s.duration} day(s)): ${rows.length} items, ${rows.reduce((t, i) => t + i.points, 0)} SP`);
  }
  console.log(`  owners: ${owners.map((o) => `${o} (${items.find((i) => i.owner === o).login || 'no login'})`).join(', ')}`);

  const unmatched = matchIssues(items, await listIssues());
  const missing = items.filter((i) => !i.issue);
  console.log(`  existing issues used: ${items.length - missing.length}; issues to create: ${missing.length}`);
  for (const i of missing) console.log(`    + ${issueTitle(i)}`);
  if (unmatched.length) console.log(`  sprint issues not in docs/SPRINTS.md (left off the board): ${unmatched.map((i) => `#${i.number}`).join(', ')}`);
  if (DRY_RUN) {
    for (const i of items) console.log(`  [${i.sprint}] ${String(i.points).padStart(2)} SP  ${i.owner.padEnd(9)} ${i.issue ? `#${i.issue.number}` : 'new'}  ${i.title}`);
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

  const setField = (itemId, fieldId, value) => gql(`mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){ projectV2Item { id } } }`,
    { p: project.id, i: itemId, f: fieldId, v: value });

  const rest = (method, url, body) => JSON.parse(execFileSync('gh', ['api', '-X', method, url, '--input', '-'], { input: JSON.stringify(body || {}), encoding: 'utf8' }) || '{}');

  for (const [n, it] of items.entries()) {
    if (!it.issue) {
      // Backlog row without an issue: create it like the others, closed as delivered.
      const body = [`**Requirement:** ${it.requirement}`, `**Owner:** ${it.owner}`, `**Story points:** ${it.points}`,
        `**Delivered in:** ${it.deliveredIn} on ${it.date}`, '', 'Source: docs/SPRINTS.md'].join('\n');
      it.issue = rest('POST', `repos/${OWNER}/${REPO}/issues`, { title: issueTitle(it), body });
      rest('PATCH', `repos/${OWNER}/${REPO}/issues/${it.issue.number}`, { state: 'closed', state_reason: 'completed' });
      console.log(`  created #${it.issue.number} ${issueTitle(it)}`);
    }
    if (it.login && !(it.issue.assignees || []).some((a) => a.login === it.login)) {
      try { rest('POST', `repos/${OWNER}/${REPO}/issues/${it.issue.number}/assignees`, { assignees: [it.login] }); } catch { /* not a collaborator: Owner field still set */ }
    }
    const itemId = gql(`mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }`,
      { p: project.id, c: it.issue.node_id }).addProjectV2ItemById.item.id;
    setField(itemId, sprintField.id, sprintField.kind === 'iteration' ? { iterationId: sprintField.options[it.sprint] } : { singleSelectOptionId: sprintField.options[it.sprint] });
    setField(itemId, pointsField.id, { number: it.points });
    setField(itemId, ownerField.id, { singleSelectOptionId: ownerOption[it.owner] });
    if (done) setField(itemId, status.id, { singleSelectOptionId: done.id });
    console.log(`  ${String(n + 1).padStart(2)}/${items.length} #${it.issue.number} [${it.sprint}] ${it.title}`);
  }

  gql(`mutation($p:ID!,$r:ID!){ linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){ repository { id } } }`, { p: project.id, r: ids.repository.id });
  console.log(`\nLinked to ${OWNER}/${REPO}. Open ${project.url} and group the board by "Sprint".`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
