import * as React from "react";
import { Button } from "@foliage/ui/button";
import { Input } from "@foliage/ui/input";
import { Label } from "@foliage/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@foliage/ui/select";
import { ActionList, ActionRow, ActionRowTitle, ActionRowMeta } from "@foliage/ui/action-row";
import { FeedbackNotice } from "@foliage/ui/feedback-notice";
import { sourceCatalog, type SourceProvider, type SourceItem, type SourcePreview, type SourceBundlePreview, type SourceImagePreview } from "../src/sourceCatalog.ts";
import { loadConnectionStatus, type ConnectionStatus } from "../src/connectionStatus.ts";

function ConnectionStatusControls({ status, busy, retry, connect }: { status: ConnectionStatus; busy: boolean; retry: () => void; connect: () => void }) {
  if (status.kind === "unavailable") return <FeedbackNotice tone="error" className="app-feedback-notice"><p>Status unavailable</p><Button variant="outline" disabled={busy} onClick={retry}>Retry</Button></FeedbackNotice>;
  if (status.kind === "loading") return <p role="status">Checking…</p>;
  const companion = status.companion;
  return <><p role="status">{companion.connected ? companion.ready ? "Connected · Cloud" : "Cloud setup needed" : "Not connected"}</p><Button disabled={busy} variant="outline" onClick={connect}>{companion.connected ? "Disconnect" : "Connect"}</Button>{companion.connected && <Button asChild variant="ghost"><a href="/review">Review</a></Button>}</>;
}

export function Connections({ repository }: { repository: React.ReactNode }) {
  const [selected, setSelected] = React.useState<SourceProvider | null>(null);
  const [search, setSearch] = React.useState("");
  const [projects, setProjects] = React.useState<SourceItem[] | null>(null), [files, setFiles] = React.useState<SourceItem[] | null>(null);
  const [preview, setPreview] = React.useState<SourcePreview | null>(null);
  const [bundlePreview, setBundlePreview] = React.useState<SourceBundlePreview | null>(null);
  const [imagePreview, setImagePreview] = React.useState<SourceImagePreview | null>(null);
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageProject, setImageProject] = React.useState(""), [imageTitle, setImageTitle] = React.useState("");
  const [imageOrigin, setImageOrigin] = React.useState<"figma-export" | "local-image">("local-image");
  const [dribbbleUrl, setDribbbleUrl] = React.useState("");
  const [bundleProject, setBundleProject] = React.useState("");
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatus>({ kind: "loading" });
  const ladybug = connectionStatus.kind === "ready" ? connectionStatus.companion : null;
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [notice, setNotice] = React.useState("");
  const [binding, setBinding] = React.useState<{ digest: string; subject: string; leafId: string; titles: string[]; bound: boolean } | null>(null);
  const [added, setAdded] = React.useState(false);
  const [inspectUrl, setInspectUrl] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [fileSearch, setFileSearch] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);
  const imagePreviewHeading = React.useRef<HTMLHeadingElement>(null);
  const reviewLink = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => { if (imagePreview) imagePreviewHeading.current?.focus(); }, [imagePreview]);
  React.useEffect(() => { if (added) reviewLink.current?.focus(); }, [added]);
  const statusRequest = React.useRef<AbortController | null>(null);
  const refreshStatus = React.useCallback(() => {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    return loadConnectionStatus(setConnectionStatus, controller.signal);
  }, []);
  React.useEffect(() => {
    void refreshStatus();
    return () => { statusRequest.current?.abort(); };
  }, [refreshStatus]);
  async function request(body: unknown, endpoint = "/sources/api") {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const v = await r.json(); if (!r.ok) throw Error(v.error || "Connection failed");
      if (v.binding) setBinding(v.binding);
      if (v.ladybug) {
        statusRequest.current?.abort();
        setConnectionStatus({ kind: "ready", companion: v.ladybug });
        window.dispatchEvent(new Event("foliage-connection"));
      }
      if (v.projects) { setProjects(v.projects); setFiles(null); }
      if (v.files) setFiles(v.files);
      if (v.preview) setPreview(v.preview);
      if (v.bundlePreview) setBundlePreview(v.bundlePreview);
      if (v.imagePreview) { setImageLoaded(false); setImagePreview(v.imagePreview); }
      if (v.imported !== undefined) { setPreview(null); setBundlePreview(null); setImagePreview(null); setAdded(true); setInspectUrl(v.inspectUrl ?? null); }
      setNotice(v.detail || v.ladybug?.detail || ""); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Source unreadable"); return false; }
    finally { setBusy(false); }
  }
  async function choose(id: SourceProvider, origin: "figma-export" | "local-image" = "local-image") {
    const activePreview = preview ?? bundlePreview ?? imagePreview;
    if (activePreview && !await request({ action: "cancel", preview: activePreview.id })) return;
    setSelected(id); setPreview(null); setBundlePreview(null); setImagePreview(null); setImageLoaded(false); setBundleProject(""); setProjects(null); setFiles(null); setNotice(""); setError(""); setAdded(false); setInspectUrl(null); setProjectName(""); setFileSearch(""); setImageProject(""); setImageTitle(""); setDribbbleUrl(""); setImageOrigin(origin);
    if (id === "open-design") await request({ action: "projects" });
    setTimeout(() => document.getElementById("source-detail")?.focus(), 0);
  }
  async function selectWork(body: unknown, endpoint?: string) {
    const activePreview = preview ?? bundlePreview ?? imagePreview;
    if (activePreview && !await request({ action: "cancel", preview: activePreview.id })) return false;
    setPreview(null); setBundlePreview(null); setImagePreview(null); setImageLoaded(false);
    return request(body, endpoint);
  }
  async function openProject(project: SourceItem) {
    if (await selectWork({ action: "files", project: project.id })) {
      setProjectName(project.name);
      setFileSearch("");
    }
  }
  async function changeProject() {
    if (preview && !await request({ action: "cancel", preview: preview.id })) return;
    setFiles(null); setPreview(null); setProjectName("");
  }
  async function back() {
    const activePreview = preview ?? bundlePreview ?? imagePreview;
    if (activePreview && !await request({ action: "cancel", preview: activePreview.id })) return;
    setSelected(null); setPreview(null); setBundlePreview(null); setImagePreview(null); setImageLoaded(false); setError(""); setNotice(""); setAdded(false); setBinding(null); setInspectUrl(null);
    setTimeout(() => document.getElementById("source-search")?.focus(), 0);
  }
  const source = sourceCatalog.find(p => p.id === selected);
  const matches = sourceCatalog.filter(p => `${p.name} ${p.group} ${p.detail}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="source-connections">
    {!source && <><div className="source-heading"><Input id="source-search" aria-label="Search sources" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a source…" /></div>
    {matches.length > 0 && <ActionList className="source-grid">
      {matches.map(p => <ActionRow key={p.id} disabled={busy} onClick={() => void choose(p.id)}>
        <ActionRowTitle>{p.name}</ActionRowTitle>
        <ActionRowMeta>{p.mode === "projects" ? "Projects" : p.mode === "repository" ? "Repository" : p.mode === "bundle" ? "Files" : p.mode === "image" ? "Image" : "Export"}</ActionRowMeta>
      </ActionRow>)}
    </ActionList>}
    {search && matches.length === 0 && <p>No match</p>}</>}
    {!source && <details className="source-agent-settings"><summary>Scarlet</summary>
      <ConnectionStatusControls status={connectionStatus} busy={busy} retry={() => void refreshStatus()} connect={() => void request({ action: ladybug?.connected ? "ladybug-disconnect" : "ladybug-connect" })} />
    </details>}
    {source && <Button variant="ghost" disabled={busy} onClick={() => void back()}>All sources</Button>}
    {error && <FeedbackNotice tone="error" className="app-feedback-notice"><p>{error}</p>{/incomplete subject binding/.test(error) && <Button variant="outline" disabled={busy} onClick={() => void request({ action: "review-binding" })}>Review destination</Button>}</FeedbackNotice>}
    {binding && <section className="source-preview"><h2>Link queue to {binding.subject}?</h2><p className="app-mono">{binding.titles.length} drafts</p><details><summary>Titles</summary><ul>{binding.titles.map((title,i) => <li key={i}>{title}</li>)}</ul></details>{binding.bound && <p>Already linked</p>}<Button disabled={busy || binding.bound} onClick={async () => { if (await request({ action: "bind-review", digest: binding.digest, confirm: true })) setBinding(null); }}>Link queue</Button>{" "}<Button variant="ghost" disabled={busy} onClick={() => setBinding(null)}>Cancel</Button></section>}
    {notice && <FeedbackNotice tone="status" className="app-feedback-notice"><p>{notice}</p>{added && <div className="source-next">
      {inspectUrl && <Button asChild><a href={inspectUrl}>Inspect work</a></Button>}
      <Button variant="ghost" asChild><a ref={reviewLink} href="/review">Review queue</a></Button>
      <Button variant="ghost" disabled={busy} onClick={() => void back()}>Add another source</Button>
    </div>}</FeedbackNotice>}
    {source && !added && <section id="source-detail" tabIndex={-1} className="source-detail" aria-label={`${source.name} connection`}>
      <h2>{source.name}</h2>
      {source.mode === "repository" ? repository : source.mode === "projects" ? <>
        <Button disabled={busy} variant="outline" onClick={() => void selectWork({ action: "projects" })}>Refresh projects</Button>
        {projects?.length === 0 && <p>No projects</p>}
        {projects && !files && <div className="source-items" aria-label="Open Design projects">{projects.map(p => <Button key={p.id} disabled={busy} variant="outline" onClick={() => void openProject(p)}>{p.name}</Button>)}</div>}
        {files && <><Button variant="ghost" disabled={busy} onClick={() => void changeProject()}>Change project</Button><h3>Files · {projectName}</h3><Label htmlFor="source-file-search">Find a file</Label><Input id="source-file-search" value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Search files…" />{!files.length && <p>No supported files</p>}<div className="source-items">{files.filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase())).map(f => <Button key={f.id} disabled={busy} variant="outline" onClick={() => void selectWork({ action: "preview-file", file: f.id })}>{f.name}</Button>)}</div></>}
      </> : source.mode === "image" ? <>
        {!imagePreview && <div className="source-image-select">
          <Label htmlFor="source-image-project">Project</Label>
          <Input id="source-image-project" maxLength={120} value={imageProject} onChange={e => setImageProject(e.target.value)} placeholder="Project name" />
          <Label htmlFor="source-image-title">Artwork title</Label>
          <Input id="source-image-title" maxLength={160} value={imageTitle} onChange={e => setImageTitle(e.target.value)} placeholder="What you made" />
          <Label htmlFor="source-image-origin">File origin</Label>
          <Select value={imageOrigin} onValueChange={value => setImageOrigin(value as "figma-export" | "local-image")}>
            <SelectTrigger id="source-image-origin"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="figma-export">Figma export · owner labeled</SelectItem><SelectItem value="local-image">Local design image</SelectItem></SelectContent>
          </Select>
          <Label htmlFor="source-image-dribbble">Dribbble shot URL <span className="app-muted">(optional reference)</span></Label>
          <Input id="source-image-dribbble" type="url" value={dribbbleUrl} onChange={e => setDribbbleUrl(e.target.value)} placeholder="Public shot URL" />
          <Button variant="outline" disabled={busy || !imageProject.trim() || !imageTitle.trim() || `${imageProject.trim()} · ${imageTitle.trim()}`.length > 200} onClick={() => fileInput.current?.click()}>Choose image</Button>
          <input ref={fileInput} className="source-file-input" tabIndex={-1} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" disabled={busy} aria-label="Choose one design image" onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) { setError("Choose an image of at most 4 MiB."); return; }
            setBusy(true); setError("");
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error("The image could not be read."));
                reader.onload = () => {
                  const data = reader.result;
                  if (typeof data !== "string" || !data.includes(",")) reject(new Error("The image could not be read."));
                  else resolve(data.slice(data.indexOf(",") + 1));
                };
                reader.readAsDataURL(file);
              });
              await selectWork({ name: file.name, base64, project: imageProject, title: imageTitle, origin: imageOrigin, referenceUrl: dribbbleUrl }, "/sources/image-preview");
            } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be read."); }
            finally { setBusy(false); }
          }} />
          <p className="app-small">PNG or JPEG · up to 4 MiB. Selected image only.</p>
        </div>}
      </> : source.mode === "bundle" ? <>
        {!bundlePreview && <div className="source-bundle-select">
          <Label htmlFor="source-bundle-project">Project name</Label>
          <Input id="source-bundle-project" maxLength={120} value={bundleProject} onChange={e => setBundleProject(e.target.value)} placeholder="Unique project name" aria-describedby="source-bundle-name-help" />
          <p id="source-bundle-name-help" className="app-small">Reuse this name for updates. Give different projects different names.</p>
          <Button variant="outline" disabled={busy || !bundleProject.trim()} onClick={() => fileInput.current?.click()}>Choose project files</Button>
          <input ref={fileInput} className="source-file-input" tabIndex={-1} type="file" multiple accept=".txt,.md,.html,.htm,.svg,.csv" disabled={busy} aria-label="Choose personal project files" onChange={async e => {
            const selected = Array.from(e.target.files ?? []); e.target.value = "";
            if (!selected.length) return;
            if (selected.length > 8) { setError("Choose up to 8 files."); return; }
            setBusy(true); setError("");
            try {
              const files = [];
              for (const file of selected) {
                if (file.size > 15_000) throw new Error("Each file must be 15 KB or less.");
                const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
                files.push({ name: file.name, content });
              }
              await selectWork({ action: "preview-project-bundle", project: bundleProject, files });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "The selected files could not be read."); }
            finally { setBusy(false); }
          }} />
          <p className="app-small">1–8 TXT, Markdown, HTML, SVG or CSV files · 15 KB each · 96 KB total</p>
        </div>}
      </> : <>
        {source.id === "figma" && <Button variant="outline" disabled={busy} onClick={() => void choose("design-image", "figma-export")}>Add a Figma frame image</Button>}
        <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>Choose a file</Button>
        <input ref={fileInput} className="source-file-input" tabIndex={-1} type="file" accept=".txt,.md,.html,.htm,.svg,.csv" disabled={busy} aria-label={`Choose ${source.name} export`} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
          if (file.size > 256 * 1024) { setError("File over 256 KiB"); return; }
          try { await selectWork({ action: "preview-export", provider: source.id, name: file.name, content: await file.text() }); }
          catch { setError("Unreadable file"); }
        }} />
        <p className="app-small">TXT · Markdown · HTML · SVG · CSV</p>
      </>}
      {preview && <section className="source-preview" aria-labelledby="source-preview-title"><h3 id="source-preview-title">{preview.title}</h3>
        <p className="app-mono">{preview.bytes.toLocaleString()} bytes{preview.truncated ? " · excerpt" : " · full"}</p>
        <pre tabIndex={0} aria-label="Selected file text">{preview.excerpt}</pre>
        <Button disabled={busy} onClick={() => void request({ action: "import", preview: preview.id, confirm: true })}>Add to review</Button>{" "}
        <Button variant="ghost" disabled={busy} onClick={async () => { if (await request({ action: "cancel", preview: preview.id })) setPreview(null); }}>Cancel</Button>
      </section>}
      {bundlePreview && <section className="source-preview" aria-labelledby="source-preview-title"><h3 id="source-preview-title">{bundlePreview.title}</h3>
        <p className="app-mono">{bundlePreview.files.length} files · {bundlePreview.bytes.toLocaleString()} bytes</p>
        <div className="source-bundle-files">{bundlePreview.files.map(file => <details key={file.name}>
          <summary><strong className="source-bundle-file-name">{file.name}</strong>
            <span className="source-bundle-file-meta app-mono">{file.bytes.toLocaleString()} bytes · {file.state === "revised" ? "New revision of this file" : file.state === "already" ? "Already in review" : "New file"} · Contents</span>
          </summary>
          <pre tabIndex={0} aria-label={`${file.name} selected text`}>{file.text}</pre>
        </details>)}</div>
        <div className="source-bundle-actions"><Button disabled={busy} onClick={() => void request({ action: "import", preview: bundlePreview.id, confirm: true })}>Add {bundlePreview.files.length} files to review</Button>
        <Button variant="ghost" disabled={busy} onClick={async () => { if (await request({ action: "cancel", preview: bundlePreview.id })) setBundlePreview(null); }}>Change files</Button></div>
      </section>}
      {imagePreview && <section className="source-preview source-image-preview" aria-labelledby="source-preview-title">
        <h3 ref={imagePreviewHeading} tabIndex={-1} id="source-preview-title">{imagePreview.project} · {imagePreview.title}</h3>
        <figure><img src={imagePreview.imageUrl} alt={`Selected artwork: ${imagePreview.title}`} onLoad={() => setImageLoaded(true)} onError={() => { setImageLoaded(false); setError("Image preview could not be displayed. Choose another image."); }} />
          <figcaption>{imagePreview.name} · <span className="app-mono">{imagePreview.bytes.toLocaleString()} bytes</span></figcaption></figure>
        <p className="app-small">{imagePreview.origin === "figma-export" ? "Figma export · labeled by you" : "Local design image"}</p>
        {imagePreview.referenceUrl && <p className="source-image-reference">Dribbble link · entered by you<br /><span>{imagePreview.referenceUrl}</span></p>}
        <div className="source-bundle-actions"><Button disabled={busy || !imageLoaded} onClick={() => void request({ action: "import", preview: imagePreview.id, confirm: true })}>Add image to review</Button>
          <Button variant="ghost" disabled={busy} onClick={async () => { if (await request({ action: "cancel", preview: imagePreview.id })) setImagePreview(null); }}>Change image</Button></div>
      </section>}
    </section>}
  </div>;
}
