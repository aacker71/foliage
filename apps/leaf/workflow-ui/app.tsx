import { WorkspaceHeader } from "@foliage/ui/workspace-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@foliage/ui/tabs";
import { workspaceNavigation } from "../src/workspaceNavigation.ts";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@foliage/ui/button";
import { Input } from "@foliage/ui/input";
import { Checkbox } from "@foliage/ui/checkbox";
import { Label } from "@foliage/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@foliage/ui/select";
import { Field } from "@foliage/ui/field";
import { FeedbackNotice } from "@foliage/ui/feedback-notice";
import { BlurFade } from "@foliage/ui/blur-fade";
import { workflowViews as views, workflowHref, workflowLocation } from "../src/workflowNavigation.ts";
import type { openWorkflow } from "../src/workflow";
import type { PortfolioPipeline } from "../src/portfolioPipeline.ts";
import { Connections } from "./connections.tsx";
import type { CompanionStatus } from "../src/sourceCatalog.ts";
import { CollectionTrace } from "./pipeline.tsx";
import { WorkspaceOverview } from "./overview.tsx";
import { readWorkflowState } from "./load.ts";
/** `queue.open` is the one review queue's count, as /review shows it; null when unread. */
type Data = ReturnType<Awaited<ReturnType<typeof openWorkflow>>["snapshot"]> & { queue: { open: number | null; next: { id: string; title: string; href: string } | null }; pipeline: PortfolioPipeline; localModelConfigured?: boolean; ladybug?: CompanionStatus };
type Schedule = NonNullable<Data["schedule"]>;
/** The one review queue lives at /review; this app only links there, with its true count. */
function ReviewLink({ open, ...anchor }: { open: number | null } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  // One child, so a button's flex gap cannot split the label from its count.
  return <a {...anchor} href="/review"><span>Review{open === null ? "" : <> (<span className="app-mono">{open}</span>)</>}</span></a>;
}
const defaults = (): Schedule => ({
  cadence: "weekly",
  day: "Friday",
  time: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  quiet: true,
  start: "18:00",
  end: "08:00",
  paused: false,
});
function App() {
  const [data, setData] = React.useState<Data | null>(null),
    [location, setLocation] = React.useState(() => workflowLocation(window.location.hash) ?? { view: "Overview" as const }),
    [error, setError] = React.useState(""),
    [readTechnical, setReadTechnical] = React.useState(""),
    // A refusal's exact fix (a command naming the folder), kept under a closed disclosure.
    [technical, setTechnical] = React.useState(""),
    [receipt, setReceipt] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [loadPending, setLoadPending] = React.useState(true);
  const latestLoad = React.useRef(0);
  const tabHashChange = React.useRef<string | null>(null);
  const view = location.view;
  React.useEffect(() => {
    const changed = () => {
      const keepTabFocus = tabHashChange.current === window.location.hash;
      tabHashChange.current = null;
      const next = workflowLocation(window.location.hash);
      if (!next) return; // Native skip links focus content without changing the current view.
      setLocation(next);
      setReceipt("");
      if (!keepTabFocus) setTimeout(() => document.querySelector<HTMLElement>("h1")?.focus(), 0);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  async function load() {
    const requestId = ++latestLoad.current;
    setLoadPending(true);
    const result = await readWorkflowState<Data>();
    if (requestId !== latestLoad.current) return;
    setLoadPending(false);
    setTechnical("");
    if (result.ok) {
      setData(result.data);
      setError("");
      setReadTechnical("");
    } else {
      setError(result.detail);
      setReadTechnical(result.technical ?? "");
      setData(null);
    }
  }
  React.useEffect(() => {
    void load();
    const changed = () => { void load(); };
    window.addEventListener("foliage-connection", changed);
    const timer = setInterval(() => void load(), 30000);
    return () => { latestLoad.current++; clearInterval(timer); window.removeEventListener("foliage-connection", changed); };
  }, []);
  async function command(body: unknown, message: string) {
    setBusy(true);
    setError("");
    setTechnical("");
    try {
      const r = await fetch("/workflow/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) {
        setTechnical(typeof result.technical === "string" ? result.technical : "");
        throw Error(result.error);
      }
      setData(result);
      setReceipt(message);
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function go(v: typeof view, focusHeading = true) {
    const hash = workflowHref(v);
    if (window.location.hash === hash) {
      if (focusHeading) setTimeout(() => document.querySelector<HTMLElement>("h1")?.focus(), 0);
      return;
    }
    tabHashChange.current = focusHeading ? null : hash;
    window.location.hash = hash;
    setReceipt("");
  }
  return (
    <div className="fol-app app-shell app-personal-shell">
      <a className="app-skip" href="#workspace-main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("workspace-main")?.focus();
      }}>
        Skip to workspace
      </a>
      <WorkspaceHeader {...workspaceNavigation("workflow")} />
      <div className="app-body">
        <main aria-busy={busy || loadPending} id="workspace-main" className="fol-app-main" tabIndex={-1}><div className="fol-app-content app-main">
          <header className="app-page-heading"><h1 tabIndex={-1}>Sources</h1></header>
          <Tabs value={view} onValueChange={value => go(value as typeof view, false)} className="workflow-views">
            <TabsList aria-label="Sources sections">{views.map(v => <TabsTrigger key={v} value={v}>{v === "Background workflow" ? "Collection" : v}</TabsTrigger>)}</TabsList>
            <TabsContent value={view}>
          {data && error && (
            <FeedbackNotice tone="error" className="app-feedback-notice">
              {error}
              {technical && (
                <details className="app-workflow-details">
                  <summary>Technical details</summary>
                  <p className="app-mono">{technical}</p>
                </details>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  void load();
                }}
              >
                Retry
              </Button>
            </FeedbackNotice>
          )}
          {!data ? error ? (
            <FeedbackNotice tone="error" className="app-feedback-notice">
              <strong>Sources unavailable</strong>
              <p>Your sources and collection settings could not be read.</p>
              <div className="app-actions">
                <Button disabled={loadPending} onClick={() => void load()}>{loadPending ? "Checking…" : "Retry"}</Button>
                <Button asChild variant="outline"><a href="/leaf/import">Import a portfolio</a></Button>
                <Button asChild variant="ghost"><a href="/review">Review</a></Button>
              </div>
              <details className="app-workflow-details">
                <summary>Technical details</summary>
                <p className="app-mono">{error}</p>
                {readTechnical && <p className="app-mono">{readTechnical}</p>}
              </details>
            </FeedbackNotice>
          ) : (
            <p role="status">Loading…</p>
          ) : (
            <>
              {view === "Overview" && <>
                <WorkspaceOverview data={data} />
              </>}
              {view === "Sources" && (
                <Connections repository={<Sources data={data} busy={busy} command={command} onNext={() => go("Background workflow")} />} />
              )}
              {view === "Background workflow" && (
                <Workflow data={data} busy={busy} command={command} />
              )}
            </>
          )}
          {receipt && (
            <BlurFade key={receipt} offset={0} blur="0px">
              <FeedbackNotice tone="status" className="app-feedback-notice">
                {receipt}
              </FeedbackNotice>
            </BlurFade>
          )}

            </TabsContent>
          </Tabs>
        </div></main>
      </div>
    </div>
  );
}
type Command = (body: unknown, message: string) => Promise<boolean>;
function Sources({
  data,
  busy,
  command,
  onNext,
}: {
  data: Data;
  busy: boolean;
  command: Command;
  onNext: () => void;
}) {
  const [path, setPath] = React.useState(""),
    [email, setEmail] = React.useState(""),
    [authorized, setAuthorized] = React.useState(false);
  return (
    <>
      <form
        className="app-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await command(
              { action: "source", path, email, authorized },
              "Repository connected",
            )
          ) {
            setPath("");
            setEmail("");
            setAuthorized(false);
          }
        }}
      >
        <h2>Local repository</h2>
        <Field className="app-field">
          <Label htmlFor="source-path">Repository path</Label>
          <Input
            id="source-path"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </Field>
        <Field className="app-field">
          <Label htmlFor="source-email">Author email</Label>
          <Input
            id="source-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

        </Field>
        <div className="fol-checkbox-row">
          <Checkbox
            id="source-authorization"
            required
            checked={authorized}
            onCheckedChange={(checked) => setAuthorized(checked === true)}
          />
          <Label htmlFor="source-authorization">Allow local reads for this email</Label>
        </div>
        <p>
          <Button disabled={busy} type="submit">
            Connect repository
          </Button>
        </p>
      </form>
      {data.sources.some((s) => s.enabled) && <p><Button variant="outline" onClick={onNext}>{data.schedule ? "Collection" : "Set rhythm"}</Button></p>}
      {data.sources.map((s) => (
        <section className="app-panel" key={s.id}>
          <h2>{s.path}</h2>
          <p>
            {s.email} · {s.enabled ? "Enabled" : "Paused"}
          </p>
          <p className="app-mono">
            {s.lastRead
              ? `Last read: ${new Date(s.lastRead).toLocaleString()}`
              : "Not read yet"}
          </p>
          {s.error && (
            <p role="alert" className="app-error">
              {s.error}
            </p>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              command(
                { action: "source-toggle", id: s.id },
                "Saved",
              )
            }
          >
            {s.enabled ? "Pause" : "Enable"}
          </Button>{" "}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Remove this source? Files and decisions stay.",
                )
              )
                void command(
                  { action: "source-remove", id: s.id },
                  "Source removed",
                );
            }}
          >
            Remove
          </Button>
        </section>
      ))}
    </>
  );
}
function Workflow({
  data,
  busy,
  command,
}: {
  data: Data;
  busy: boolean;
  command: Command;
}) {
  const [draft, setDraft] = React.useState<Schedule>(
    data.schedule || defaults(),
  );
  function update<K extends keyof Schedule>(key: K, value: Schedule[K]) {
    setDraft({ ...draft, [key]: value });
  }
  return (
    <>
      <section className="app-collection-status" aria-label="Collection status">
        <p role="status">{data.running ? "Collecting…" : data.schedule?.paused ? "Paused" : data.schedule ? "Scheduled" : "Not scheduled"}</p>
        <p className="app-small">Local</p>
        {(data.queue.open ?? 0) > 0 && <Button asChild><ReviewLink open={data.queue.open} /></Button>}
      </section>
      {data.schedule && <div className="app-growth-rhythm">
        <Button
          variant="outline"
          disabled={busy || !data.schedule}
          onClick={async () => {
            if (data.schedule) {
              const s = { ...data.schedule, paused: !data.schedule.paused };
              if (
                await command(
                  { action: "schedule", schedule: s },
                  s.paused ? "Paused" : "Resumed",
                )
              )
                setDraft(s);
            }
          }}
        >
          {data.schedule?.paused ? "Resume" : "Pause"}
        </Button>
      </div>}
      <details id="collection-schedule" className="app-growth-settings" open={!data.schedule || undefined}>
        <summary>Rhythm</summary>
      <div className="app-settings-layout">
        <form
          className="app-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void command(
              { action: "schedule", schedule: draft },
              "Saved",
            );
          }}
        >
          <Field className="app-field">
            <Label htmlFor="cadence">Cadence</Label>
            <Select value={draft.cadence} onValueChange={value => update("cadence", value as Schedule["cadence"])}>
              <SelectTrigger id="cadence" aria-label="Cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {draft.cadence === "weekly" && (
            <Field className="app-field">
              <Label htmlFor="day">Day</Label>
              <Select value={draft.day} onValueChange={value => update("day", value)}>
                <SelectTrigger id="day" aria-label="Day"><SelectValue /></SelectTrigger>
                <SelectContent>
                {[
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="app-form-row">
            <Field className="app-field">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                required
                value={draft.time}
                onChange={(e) => update("time", e.target.value)}
              />
            </Field>
            <Field className="app-field">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                required
                value={draft.timezone}
                onChange={(e) => update("timezone", e.target.value)}
              />
            </Field>
          </div>
          <section className="app-settings-section">
            <h2>Quiet hours</h2>
            <div className="fol-checkbox-row">
              <Checkbox
                id="quiet-hours"
                checked={draft.quiet}
                onCheckedChange={(checked) => update("quiet", checked === true)}
              />
              <Label htmlFor="quiet-hours">Use quiet hours</Label>
            </div>
            <div className="app-form-row">
              {(["start", "end"] as const).map((k) => (
                <Field className="app-field" key={k}>
                  <Label htmlFor={k}>{k === "start" ? "From" : "Until"}</Label>
                  <Input
                    id={k}
                    type="time"
                    disabled={!draft.quiet}
                    value={draft[k]}
                    onChange={(e) => update(k, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </section>
          <Button disabled={busy} type="submit">
            Save
          </Button>
        </form>
        <aside className="app-note-panel">
          <h2>Collect</h2>
          <p className="app-mono">
            {data.nextAt && !data.schedule?.paused
              ? `Next: ${new Date(data.nextAt).toLocaleString()}`
              : !data.schedule ? "Save a rhythm to collect" : data.schedule.paused ? "Paused · resume to collect" : "No upcoming run"}
          </p>
          <Button
            variant="outline"
            disabled={busy || !data.schedule || data.schedule.paused}
            onClick={() =>
              command(
                { action: "collect" },
                "Collected",
              )
            }
          >
            Collect now
          </Button>
        </aside>
      </div>
      </details>
      <details id="processing-details" className="app-processing-section"><summary>Processing</summary>
        <dl className="app-processing">
          <div><dt>Collection <span>Local</span></dt><dd><strong>{data.running ? "Collecting now" : data.schedule?.paused ? "Paused" : data.schedule ? "Scheduled" : "Not scheduled"}</strong></dd></div>
          <div><dt>Photosynthesis <span>Local AI</span></dt><dd><strong>{data.localModelConfigured === true ? "Configured · unchecked" : data.localModelConfigured === false ? "Not configured" : "Unknown"}</strong> <a href="/scarlet/workspace" aria-label="Open Photosynthesis">Open</a></dd></div>
          <div><dt>Scarlet <span>Cloud</span></dt><dd><strong>{data.ladybug?.connected ? data.ladybug.ready ? "Connected" : "Cloud setup needed" : "Not connected"}</strong></dd></div>
        </dl>
      </details>
      <details className="app-growth-settings" open={data.running || data.sources.some(source => source.enabled && !!source.error) || undefined}>
        <summary>Activity</summary>
        <div className="app-growth-history">
        {data.running && data.collection && <><p role="status">Collecting…</p><CollectionTrace run={data.collection} /></>}
        {data.history.length ? (
          data.history.map((h, i) => (
            <div key={i}>
              <p className="app-mono">
                {new Date(h.at).toLocaleString()} · {h.status}
              </p>
              <p>{h.detail}</p>
              {h.run && <CollectionTrace run={h.run} />}
            </div>
          ))
        ) : (
          <p>No runs yet</p>
        )}
        </div>
      </details>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
