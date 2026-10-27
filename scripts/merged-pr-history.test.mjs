import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMergedPrHistory } from './merged-pr-history.mjs';
const connection = (nodes, more = false, cursor = more ? 'next' : null) => ({
  nodes,
  pageInfo: { hasNextPage: more, endCursor: cursor },
});
const pr = (number, files = connection([{ path: 'src/a.ts' }])) => ({
  number,
  body: 'Closes D11',
  files: { nodes: files.nodes, filePageInfo: files.pageInfo },
});
const page = (nodes, more = false) => ({
  data: { repository: { pullRequests: connection(nodes, more) } },
});

test('retains earliest shipping PR when merged history exceeds 1000 records', () => {
  const records = Array.from({ length: 1005 }, (_, index) => pr(index + 1));
  const pages = [];
  for (let start = 0; start < records.length; start += 100)
    pages.push(page(records.slice(start, start + 100), start + 100 < records.length));
  const result = readMergedPrHistory((args) => {
    assert.ok(args.includes('--paginate') && args.includes('--slurp'));
    assert.ok(!args.includes('--limit'));
    assert.match(args.join(' '), /filePageInfo: pageInfo/);
    return JSON.stringify(pages);
  });
  assert.equal(result.length, 1005);
  assert.equal(result[4].number, 5);
  assert.equal(result.at(-1).number, 1005);
});
test('reads file pages beyond the first hundred so docs-only classification stays truthful', () => {
  let reads = 0;
  const result = readMergedPrHistory((args) => {
    if (++reads === 1)
      return JSON.stringify([
        page([
          pr(
            5,
            connection(
              Array.from({ length: 100 }, (_, i) => ({ path: `docs/${i}.md` })),
              true,
            ),
          ),
        ]),
      ]);
    assert.ok(args.includes('number=5') && args.includes('endCursor=next'));
    return JSON.stringify([
      {
        data: {
          repository: {
            pullRequest: {
              files: connection([{ path: 'src/orm.ts' }]),
            },
          },
        },
      },
    ]);
  });
  assert.equal(reads, 2);
  assert.equal(result[0].files.length, 101);
  assert.equal(result[0].files.at(-1).path, 'src/orm.ts');
});
test('unavailable, partial, malformed and duplicate history fails closed', () => {
  for (const value of [
    [],
    [{}],
    [{ errors: [{ message: 'unavailable' }] }],
    [page([pr(5)], true)],
    [page([pr(5), pr(5)])],
    [page([pr(5, connection([{}]))])],
    [page([pr(5, connection([], true, null))])],
    [page([pr(5)]), page([pr(6)])],
  ])
    assert.throws(() => readMergedPrHistory(() => JSON.stringify(value)));
  assert.throws(() => readMergedPrHistory(() => '{'));
  assert.throws(() =>
    readMergedPrHistory(() => {
      throw new Error('provider unavailable');
    }),
  );
});
test('a successful empty repository is distinct from an unreadable repository', () => {
  assert.deepEqual(
    readMergedPrHistory(() => JSON.stringify([page([])])),
    [],
  );
});
