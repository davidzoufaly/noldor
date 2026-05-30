# Noldor Framework

@docs/noldor/README.md
@.claude/engineering-rules.md

`docs/noldor/README.md` is the framework's route table — every workflow has a dedicated page. Before any change open the matching page from there. `.claude/engineering-rules.md` carries the Noldor baseline (single source; the old `docs/noldor/engineering-principles.md` page is dropped — its content lives here now).

## Gate

`/gate` mandatory before any code edit. Bypass via `Noldor-Path-Override: <reason>` only when a hook genuinely cannot run.
