import { useMemo, useState, type ChangeEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import { memberName, STATUSES } from "../lib/format";
import type { Project } from "../lib/types";

// Bulk import: CSV / TSV (incl. Meta's UTF-16 exports) and Excel (.xlsx via SheetJS from a CDN).

const MAX_ROWS = 5000;
const BATCH = 200;
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

type Field =
  | "name" | "first_name" | "last_name" | "phone" | "email" | "city" | "budget" | "message"
  | "project" | "status" | "created_at" | "campaign" | "adset" | "ad" | "form" | "platform" | "extra" | "ignore";

const FIELDS: { value: Field; label: string }[] = [
  { value: "name", label: "Name" }, { value: "first_name", label: "First name" }, { value: "last_name", label: "Last name" },
  { value: "phone", label: "Phone" }, { value: "email", label: "Email" }, { value: "city", label: "City" },
  { value: "budget", label: "Budget" }, { value: "message", label: "Message / notes" }, { value: "project", label: "Project" },
  { value: "status", label: "Status" }, { value: "created_at", label: "Received date" },
  { value: "campaign", label: "Campaign" }, { value: "adset", label: "Ad set" }, { value: "ad", label: "Ad" },
  { value: "form", label: "Form" }, { value: "platform", label: "Platform" },
  { value: "extra", label: "Keep as extra info" }, { value: "ignore", label: "Don't import" },
];

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Partial<Record<Field, string[]>> = {
  name: ["name", "fullname", "yourname", "customername", "leadname", "contactname", "clientname"],
  first_name: ["firstname", "fname"],
  last_name: ["lastname", "lname", "surname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "phoneno", "contact", "contactnumber", "contactno", "whatsapp", "whatsappnumber", "tel", "telephone", "number"],
  email: ["email", "emailaddress", "emailid", "mail", "workemail"],
  city: ["city", "location", "preferredlocation", "yourcity"],
  budget: ["budget", "pricerange", "budgetrange"],
  message: ["message", "comments", "comment", "query", "requirement", "requirements", "remarks", "description", "notes", "enquiry"],
  project: ["project", "projectname", "property", "propertyname"],
  status: ["status", "leadstatus", "stage"],
  created_at: ["createdtime", "createdat", "created", "date", "leaddate", "submittedon", "timestamp", "receivedon"],
  campaign: ["campaignname", "campaign"],
  adset: ["adsetname", "adset"],
  ad: ["adname"],
  form: ["formname", "form"],
  platform: ["platform"],
};
const IGNORE = new Set(["adid", "adsetid", "campaignid", "formid", "isorganic"]);

function guess(header: string, used: Set<Field>): Field {
  const n = norm(header);
  if (IGNORE.has(n)) return "ignore";
  for (const [f, list] of Object.entries(ALIASES) as [Field, string[]][]) {
    if (list.includes(n) && !used.has(f)) return f;
  }
  return n ? "extra" : "ignore";
}

export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/^p:/i, "");
  const d = s.replace(/\D/g, "");
  if (d.length < 6) return null;
  if (s.startsWith("+")) return "+" + d;
  if (d.length === 10) return "+91" + d;
  if (d.length === 11 && d.startsWith("0")) return "+91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  return "+" + d;
}

function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (dmy) {
    let [, d, m, y, hh, mm, ss, ap] = dmy;
    if (y.length === 2) y = "20" + y;
    let h = Number(hh ?? 0);
    if (ap) h = (h % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(h).padStart(2, "0")}:${mm ?? "00"}:${ss ?? "00"}+05:30`;
    const t = Date.parse(iso);
    return isNaN(t) ? null : new Date(t).toISOString();
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", "\t", ";"].map((d) => [d, first.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readFile(file: File): Promise<string[][]> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX: any = await import(/* @vite-ignore */ SHEETJS);
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) => r.map((v) => String(v ?? "")));
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0);
  const text = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf).replace(/^\uFEFF/, "");
  return parseDelimited(text);
}

interface Props { projects: Project[]; onClose: () => void; onDone: () => void }

export default function ImportModal({ projects, onClose, onDone }: Props) {
  const { current, members } = useSession();
  const wsId = current!.id;
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Field[]>([]);
  const [projectMode, setProjectMode] = useState<string>("column"); // column | none | <project id>
  const [cameFrom, setCameFrom] = useState("");
  const [assign, setAssign] = useState<string>("auto"); // auto | <user id>
  const [skipDupes, setSkipDupes] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ added: number; dupes: number; invalid: number; failed: number } | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setResult(null);
    try {
      const all = (await readFile(file)).filter((r) => r.some((c) => c.trim() !== ""));
      if (all.length < 2) throw new Error("The file needs a header row and at least one lead.");
      const head = all[0].map((h) => h.trim());
      const body = all.slice(1, MAX_ROWS + 1);
      const used = new Set<Field>();
      const m = head.map((h) => { const g = guess(h, used); if (!["extra", "ignore"].includes(g)) used.add(g); return g; });
      setHeaders(head); setRows(body); setMap(m);
      setFileName(file.name);
      setCameFrom(`Import: ${file.name.replace(/\.[^.]+$/, "")}`.slice(0, 80));
      setProjectMode(m.includes("project") ? "column" : (projects.length === 1 ? projects[0].id : "none"));
      if (all.length - 1 > MAX_ROWS) setError(`Only the first ${MAX_ROWS.toLocaleString("en-IN")} rows will be imported. Split larger files.`);
    } catch (err) {
      setError(err instanceof Error && err.message.includes("header") ? err.message
        : /\.(xlsx|xls)$/i.test(file.name) ? "Couldn't read this Excel file. Save it as CSV and try again."
        : "Couldn't read this file. Use a CSV or Excel file.");
      setHeaders([]); setRows([]);
    }
    e.target.value = "";
  }

  const projectByName = useMemo(() => new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id])), [projects]);

  function build(r: string[]) {
    const v: Partial<Record<Field, string>> = {};
    const extra: Record<string, unknown> = {};
    const meta: Record<string, string> = {};
    map.forEach((f, i) => {
      const val = (r[i] ?? "").trim();
      if (!val || f === "ignore") return;
      if (f === "extra") extra[headers[i] || `column_${i + 1}`] = val;
      else if (["campaign", "adset", "ad", "form", "platform"].includes(f)) meta[f] = val;
      else v[f] = v[f] ? `${v[f]} ${val}` : val;
    });
    const name = v.name ?? ([v.first_name, v.last_name].filter(Boolean).join(" ") || null);
    const phone = v.phone ? normalizePhone(v.phone) : null;
    const sv = v.status ? norm(v.status) : "";
    const st = sv ? STATUSES.find((s) => norm(s.value) === sv || norm(s.label) === sv) : undefined;
    const project_id = projectMode === "column" ? (v.project ? projectByName.get(v.project.toLowerCase()) ?? null : null)
      : projectMode === "none" ? null : projectMode;
    if (projectMode === "column" && v.project && !project_id) extra.project = v.project;
    if (Object.keys(meta).length) extra._meta = meta;
    return {
      workspace_id: wsId,
      source: "import",
      source_detail: cameFrom.trim() || "Import",
      name, phone,
      email: v.email ? v.email.toLowerCase() : null,
      city: v.city ?? null, budget: v.budget ?? null, message: v.message ?? null,
      status: st?.value ?? "new",
      project_id,
      assigned_to: assign === "auto" ? null : assign,
      extra,
      ...(v.created_at && parseDate(v.created_at) ? { created_at: parseDate(v.created_at)! } : {}),
    };
  }

  const preview = useMemo(() => rows.slice(0, 5).map(build), [rows, map, projectMode, cameFrom, assign]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "—";
  const hasContact = map.includes("phone") || map.includes("email");

  async function run() {
    setBusy(true); setError(""); setResult(null);
    const built = rows.map(build);
    const valid = built.filter((b) => b.phone || b.email);
    let invalid = built.length - valid.length;
    let todo = valid;
    let dupes = 0;
    if (skipDupes) {
      const seen = new Set<string>();
      const phones = [...new Set(valid.map((b) => b.phone).filter(Boolean) as string[])];
      for (let i = 0; i < phones.length; i += BATCH) {
        setProgress(`Checking for duplicates… ${Math.min(i + BATCH, phones.length)}/${phones.length}`);
        const { data } = await supabase.from("leads").select("phone").eq("workspace_id", wsId).in("phone", phones.slice(i, i + BATCH));
        (data ?? []).forEach((d: { phone: string }) => seen.add(d.phone));
      }
      todo = valid.filter((b) => {
        if (!b.phone) return true;
        if (seen.has(b.phone)) { dupes++; return false; }
        seen.add(b.phone);
        return true;
      });
    }
    let added = 0, failed = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      setProgress(`Importing… ${Math.min(i + BATCH, todo.length).toLocaleString("en-IN")} of ${todo.length.toLocaleString("en-IN")}`);
      const chunk = todo.slice(i, i + BATCH);
      const { error } = await supabase.from("leads").insert(chunk);
      if (error) { failed += chunk.length; setError(error.message); } else added += chunk.length;
    }
    setProgress("");
    setResult({ added, dupes, invalid, failed });
    setBusy(false);
    if (added) onDone();
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal card wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Import leads">
        <div className="row"><h2 className="grow">Import leads</h2>{!busy && <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}</div>

        {result ? (
          <>
            <div className={`notice ${result.failed ? "warn" : "ok"}`}>
              Imported <b>{result.added.toLocaleString("en-IN")}</b> lead{result.added === 1 ? "" : "s"}.
              {result.dupes > 0 && <> Skipped {result.dupes} already in the CRM.</>}
              {result.invalid > 0 && <> Skipped {result.invalid} with no phone or email.</>}
              {result.failed > 0 && <> {result.failed} could not be saved.</>}
            </div>
            {error && <div className="notice error small">{error}</div>}
            <div className="row gap end"><button className="btn primary" onClick={onClose}>Done</button></div>
          </>
        ) : !headers.length ? (
          <>
            <p className="muted">Upload a CSV or Excel file: a Meta Lead Ads download, a portal export, or your own sheet. The first row must be the column names.</p>
            <label className="drop">
              <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={pick} />
              <span className="drop-title">Choose a file</span>
              <span className="muted small">CSV, TSV or Excel · up to {MAX_ROWS.toLocaleString("en-IN")} leads</span>
            </label>
            {error && <div className="notice error">{error}</div>}
          </>
        ) : (
          <>
            <p className="muted small"><b>{fileName}</b> · {rows.length.toLocaleString("en-IN")} row{rows.length === 1 ? "" : "s"} · <button className="link small" onClick={() => { setHeaders([]); setRows([]); setError(""); }} disabled={busy}>choose another file</button></p>

            <h3 className="section-title">Match the columns</h3>
            <div className="map-grid">
              {headers.map((h, i) => (
                <label key={i} className="map-row">
                  <span className="map-col"><b>{h || `Column ${i + 1}`}</b><span className="muted small ellipsis">{rows.find((r) => (r[i] ?? "").trim())?.[i] ?? ""}</span></span>
                  <select value={map[i]} disabled={busy} onChange={(e) => setMap(map.map((m, j) => (j === i ? (e.target.value as Field) : m)))}>
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!hasContact && <div className="notice warn small">Match a column to Phone or Email: leads need at least one.</div>}

            <div className="field-grid">
              <label>Project
                <select value={projectMode} onChange={(e) => setProjectMode(e.target.value)} disabled={busy}>
                  {map.includes("project") && <option value="column">From the Project column</option>}
                  <option value="none">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>All leads: {p.name}</option>)}
                </select>
              </label>
              <label>Assign to
                <select value={assign} onChange={(e) => setAssign(e.target.value)} disabled={busy}>
                  <option value="auto">{current?.auto_assign ? "Round-robin to agents" : "Unassigned"}</option>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
                </select>
              </label>
              <label>Came from
                <input value={cameFrom} onChange={(e) => setCameFrom(e.target.value)} disabled={busy} placeholder="e.g. Meta export Oct" />
              </label>
              <label className="switch-row inline-check">
                <input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} disabled={busy} />
                <span>Skip phone numbers already in the CRM</span>
              </label>
            </div>

            <h3 className="section-title">Preview</h3>
            <div className="preview-wrap">
              <table className="preview">
                <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Project</th><th>Status</th><th>Received</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className={p.phone || p.email ? "" : "bad"}>
                      <td>{p.name ?? "—"}</td><td>{p.phone ?? "—"}</td><td>{p.email ?? "—"}</td>
                      <td>{projectName(p.project_id)}</td><td>{STATUSES.find((s) => s.value === p.status)?.label}</td>
                      <td>{p.created_at ? new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Now"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <div className="notice error small">{error}</div>}
            <div className="row gap end">
              {progress && <span className="muted small grow">{progress}</span>}
              <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn primary" onClick={run} disabled={busy || !hasContact}>
                {busy ? "Importing…" : `Import ${rows.length.toLocaleString("en-IN")} lead${rows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
