---
name: Packages Field Mismatch Fixture
phase: done
introduced: '0.2.0'
area: example
category: Other
packages: [web]
'noldor-tier': specs-only
links:
  code:
    - packages/sample-scenes/src/empty-room.ts
    - packages/format/src/types.ts
  tests:
    - packages/sample-scenes/src/__tests__/empty-room.test.ts
---

## Summary

Fixture for validatePackagesField — declares only `web` but `links.code`
references `sample-scenes` and `format` packages.

## User Story

As a validator, I want to flag this fixture, so that drift is caught upstream.

## Usage

Test fixture only.
