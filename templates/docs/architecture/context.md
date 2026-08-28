# Context

The system, its actors, and the externals it talks to — and only that. Runnable
units belong on `containers.md`; internal structure belongs on `modules.md`.

<!-- TODO: draw the real context diagram, fill in the sections, and delete this line -->

```mermaid
flowchart LR
  user[Someone who uses this] --> system[This system]
  system --> external[Something it depends on]
```

## Actors

<!-- what belongs here: who drives this system — people and other systems. One line each. -->

## Externals

<!-- what belongs here: what it depends on and does not control. One line each. -->

## Boundary

<!-- what belongs here: what this system deliberately does not do or own. -->
