"""Build the committed knowledge graph: the recipe `noldor graphify build` runs.

Run it from the root of a copy of the tree to graph, under PYTHONHASHSEED=0, with
the packages pinned in graphify-requirements.txt. It writes GRAPH_REPORT.md and
graph.json into --out and nothing anywhere else except graphify's parse cache,
which stays inside the copy.

A clean pass over code files. Not `graphify update`: that keeps every node
graph.json already holds, so deleted code never leaves, and it extracts
markdown too.
"""

import argparse
import re
from pathlib import Path

from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.detect import detect
from graphify.export import to_json
from graphify.extract import extract
from graphify.report import generate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--date', required=True)
    args = parser.parse_args()

    detected = detect(Path('.'))
    # Sorted, so the node order does not follow the filesystem's listing order.
    # One process, because that is how every committed graph was built; parallel
    # extraction was never measured to give the same bytes.
    code = sorted(Path(f) for f in detected['files']['code'])
    ast = extract(code, cache_root=Path('.'), parallel=False)
    G = build_from_json({'nodes': ast['nodes'], 'edges': ast['edges'], 'hyperedges': []})
    communities = cluster(G)
    labels = {c: f'Community {c}' for c in communities}
    report = generate(G, communities, score_all(G, communities), labels, god_nodes(G),
                      surprising_connections(G, communities), detected,
                      {'input': 0, 'output': 0}, '.',
                      suggested_questions=suggest_questions(G, communities, labels))

    # generate() stamps the header with the run day, so the same commit built
    # on two days would differ by that line. The built commit's date replaces it.
    header, newline, body = report.partition('\n')
    header, stamped = re.subn(r'\(\d{4}-\d{2}-\d{2}\)$', f'({args.date})', header)
    if stamped != 1:
        raise SystemExit(f'build-graph: no date to replace in the report header: {header!r}')

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'GRAPH_REPORT.md').write_text(header + newline + body, encoding='utf-8')
    # force: a commit that deletes code legitimately shrinks the graph.
    to_json(G, communities, str(args.out / 'graph.json'), force=True,
            built_at_commit=args.commit)


if __name__ == '__main__':
    main()
