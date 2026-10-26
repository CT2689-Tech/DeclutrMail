// gh follows GraphQL pageInfo until exhaustion; never cap decision history at
// a recent-PR count. File connections also paginate to preserve docs-only checks.
// Alias nested file pageInfo so gh's outer pagination cannot follow that cursor.
const historyQuery = `query($endCursor: String) {
  repository(owner: "CT2689-Tech", name: "DeclutrMail") {
    pullRequests(first: 100, after: $endCursor, states: MERGED,
      orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes { number body files(first: 100) { nodes { path } filePageInfo: pageInfo { hasNextPage endCursor } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const filesQuery = `query($number: Int!, $endCursor: String) {
  repository(owner: "CT2689-Tech", name: "DeclutrMail") {
    pullRequest(number: $number) {
      files(first: 100, after: $endCursor) { nodes { path } pageInfo { hasNextPage endCursor } }
    }
  }
}`;

function connections(raw, select) {
  const pages = JSON.parse(raw);
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Missing PR history pages');
  return pages.map((page, index) => {
    const connection = select(page?.data?.repository);
    if (
      page?.errors?.length ||
      !Array.isArray(connection?.nodes) ||
      connection.pageInfo?.hasNextPage !== index < pages.length - 1 ||
      (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)
    )
      throw new Error('Incomplete PR history connection');
    return connection;
  });
}

function paths(nodes) {
  if (!Array.isArray(nodes) || nodes.some((node) => typeof node?.path !== 'string'))
    throw new Error('Unreadable PR file history');
  return nodes.map(({ path }) => ({ path }));
}

export function readMergedPrHistory(run) {
  const pages = connections(
    run(['api', 'graphql', '--paginate', '--slurp', '-f', `query=${historyQuery}`]),
    (repository) => repository?.pullRequests,
  );
  const seen = new Set();
  return pages
    .flatMap(({ nodes }) => nodes)
    .map((pr) => {
      if (
        !Number.isInteger(pr?.number) ||
        pr.number < 1 ||
        seen.has(pr.number) ||
        typeof pr.body !== 'string' ||
        typeof pr.files?.filePageInfo?.hasNextPage !== 'boolean'
      )
        throw new Error('Unreadable PR history record');
      seen.add(pr.number);
      const files = paths(pr.files.nodes);
      if (pr.files.filePageInfo.hasNextPage) {
        if (typeof pr.files.filePageInfo.endCursor !== 'string' || !pr.files.filePageInfo.endCursor)
          throw new Error('Missing PR file cursor');
        for (const page of connections(
          run([
            'api',
            'graphql',
            '--paginate',
            '--slurp',
            '-f',
            `query=${filesQuery}`,
            '-F',
            `number=${pr.number}`,
            '-f',
            `endCursor=${pr.files.filePageInfo.endCursor}`,
          ]),
          (repository) => repository?.pullRequest?.files,
        ))
          files.push(...paths(page.nodes));
      }
      return { number: pr.number, body: pr.body, files };
    });
}
