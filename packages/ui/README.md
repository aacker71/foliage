# Shared UI controls

`@foliage/ui` supplies React controls and their Foliage styling. Import each React
control from its subpath. `@foliage/tokens` owns values; `src/controls.css` owns
control appearance. Application styles own page composition.

| Control | Import | Current use |
|---|---|---|
| `Button` | `@foliage/ui/button` | Native button; `asChild` preserves a supplied link. `variant` is default, outline, secondary, ghost, destructive or link; `size` is default, xs, sm, lg or an icon size. |
| `ActionList`, `ActionRow`, `ActionRowTitle`, `ActionRowMeta` | `@foliage/ui/action-row` | One bordered list of full-width actions. Each row is one native button and one focus target; `action-row.css` supplies the shared styling. |
| `Input` | `@foliage/ui/input` | Native input props, including `type`, `required`, `name` and `autoComplete`. |
| `Checkbox` | `@foliage/ui/checkbox` | Radix checked state, keyboard and form behavior; the caller supplies an explicit `id` and associated `Label`. |
| `Textarea` | `@foliage/ui/textarea` | Native multiline props and vertical resize; server pages use the same component through `ui.textarea`. |
| `Label` | `@foliage/ui/label` | Radix label; set `htmlFor` to the control's explicit `id`. |
| `Field` | `@foliage/ui/field` | Layout for a label and its control; does not create a form or change input behavior. |
| `EmptyState`, `EmptyStateTitle`, `EmptyStateActions` | `@foliage/ui/empty-state` | Action-led content absence; compose with `Button` or a native link. |
| `FeedbackNotice` | `@foliage/ui/feedback-notice` | A bordered result surface. `tone="error"` sets `role="alert"`; `tone="status"` sets `role="status"`. Caller owns wording and recovery actions. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@foliage/ui/tabs` | Radix tabs in Workflow and Hosting. |
| `ToggleGroup`, `ToggleGroupItem` | `@foliage/ui/toggle-group` | Radix roving focus for compact choices; the feature owns selection. |
| `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` | `@foliage/ui/select` | Radix Select for Workflow Rhythm cadence and day. |
| `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` | `@foliage/ui/alert-dialog` | Confirmation behavior in Canopy Hosting; its publication form still performs the server check. |

The root `@foliage/ui` export is a separate static HTML facade for native server
controls. Portfolio renderers and styles also have their own subpaths. The website
uses the shared controls and `@foliage/ui/blur-fade` where its motion is purposeful.
See [PROVENANCE.md](PROVENANCE.md) for inherited component notices.

Load CSS in this order: `@foliage/tokens/tokens.css`,
`@foliage/tokens/roles.css`, `@foliage/tokens/foliage.css`, then
`@foliage/ui/controls.css`. Add `@foliage/ui/action-row.css` for ActionRow and
`@foliage/ui/empty-state.css` for EmptyState, then `@foliage/ui/workspace.css` for the shared
workspace shell, followed by application layout CSS. The Workflow and Hosting
pages load token files first; their build scripts bundle shared controls and
workspace CSS before page composition.

Sources uses ActionRow for each provider; selecting a row opens that provider's
real connection form. Use a native button for such an in-page action, and keep
the trailing meta brief so the whole row remains one focus target:

```tsx
<ActionList>
  <ActionRow onClick={() => choose(provider.id)}>
    <ActionRowTitle>{provider.name}</ActionRowTitle>
    <ActionRowMeta>{provider.mode}</ActionRowMeta>
  </ActionRow>
</ActionList>
```

Work's native document uses `ui.emptyState(title, actions)` from the root facade;
its first link is the primary action and later links remain quiet native anchors.
Use `{ status: true }` as the third argument when the absence itself is a load status.
Workflow Overview uses the composable React parts for its no-source action.

Use `FeedbackNotice` for a completed action or actionable failure, with the
page's own copy and recovery control as children. The native facade exposes
`ui.feedbackNotice(detail, { tone, heading?, id?, tabIndex?, autoFocus? })`.
Keep the live-region role derived from `tone`; do not add an alert around every
inline validation message or replace an import receipt with its own result data.

Workflow's repository form composes the shared field without hiding native
validation or label association:

```tsx
<Field className="app-field">
  <Label htmlFor="source-path">Repository path</Label>
  <Input id="source-path" required value={path} onChange={e => setPath(e.target.value)} />
</Field>
```

Use `Input type="file"` for a native file picker. It keeps the browser's selected-file
name and keyboard behavior; the shared CSS aligns its button with other controls.

Workflow's Rhythm form uses the shared Select for its saved cadence:

```tsx
<Label htmlFor="cadence">Cadence</Label>
<Select value={draft.cadence} onValueChange={value => update("cadence", value as Schedule["cadence"])}>
  <SelectTrigger id="cadence" aria-label="Cadence"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="daily">Daily</SelectItem>
    <SelectItem value="weekly">Weekly</SelectItem>
  </SelectContent>
</Select>
```

Workflow uses the same Checkbox for source authorization and quiet hours. Keep the label
separate and explicitly associated; Radix's form input preserves the required source
authorization gate:

```tsx
<div className="fol-checkbox-row">
  <Checkbox id="source-authorization" required checked={authorized}
    onCheckedChange={checked => setAuthorized(checked === true)} />
  <Label htmlFor="source-authorization">Allow local reads for this email</Label>
</div>
```

See [UI Foundation](../../docs/UI-FOUNDATION.md) for application adoption,
provenance and verification boundaries.
