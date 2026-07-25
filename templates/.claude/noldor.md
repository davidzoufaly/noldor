# Noldor Framework

@docs/noldor/README.md
@.claude/engineering-rules.md

`docs/noldor/README.md` is the framework's route table — every workflow has a dedicated page. Before any change open the matching page from there. `.claude/engineering-rules.md` carries the Noldor baseline (single source; the old `docs/noldor/engineering-principles.md` page is dropped — its content lives here now).

On any weird or opaque failure (commit rejected with no clear message, gate abort, tool exit that makes no sense), grep `docs/noldor/gotchas.md` and the area runbook BEFORE debugging from scratch — known traps are documented there.

## Gate

`/gate` mandatory before any code edit. Bypass via `Noldor-Path-Override: <reason>` only when a hook genuinely cannot run.
