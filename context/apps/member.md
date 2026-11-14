# Individual Enterprise member

## Status

Planned; `apps/member` and `@foliage/member-app` are reserved, absent from this checkout. Intended plane: enterprise.

## Responsibility

The employee’s own governed Leaf: inspect their contributions, understand release restrictions, request correction and export permitted work on departure. It must not be hidden inside the organization administrator interface.

## Runtime and interfaces

Subject-scoped reads and correction/takeout requests use the shared
[identity](../contracts/identity-and-admission.md) and [authority model](../contracts/storage-and-operations.md).
The server derives the subject and current company membership; client-provided identity
cannot select another person's private work. No implemented routes are asserted here.

## Storage and access

Reuse Leaf evidence and enterprise policy; keep company-private evidence private. The subject retaining an open-source Leaf is not itself a takeout mechanism. Export should distinguish inaccessible support from changed evidence.

## Data flow and acceptance

Company membership + authenticated subject → authorized evidence view → correction/export
request → policy-controlled package. Recheck current grants at export; the manifest records
included, withheld and unavailable items. Departure removes company access without deleting
previously permitted personal material. Unit [15](../specs/15-member-exit.md) owns acceptance.

## Ownership

[Canonical architecture](../architecture.md) identifies implementation status. Do not create
an application manifest or broaden a licensing boundary merely to make this planned entry
look implemented. Update this document when its actual contract lands.
