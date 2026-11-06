import { useEffect, useState } from "react";
import type { ExtractionTemplate, SectionFormat, TemplateSection } from "@gist/core";
import { api } from "../api.ts";

const FORMATS: { v: SectionFormat; l: string }[] = [
  { v: "bullets", l: "Bullet points" },
  { v: "checklist", l: "Checklist" },
  { v: "numbered", l: "Numbered steps" },
  { v: "paragraph", l: "Short paragraph" },
];

const blank = (): Partial<ExtractionTemplate> => ({
  name: "",
  description: "",
  icon: "✨",
  length: "standard",
  includeTimestamps: true,
  sections: [{ id: "s1", heading: "", instruction: "", format: "bullets" }],
});

export function Templates() {
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [editing, setEditing] = useState<Partial<ExtractionTemplate> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.templates().then((r) => setTemplates(r.templates), () => {});
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    setError(null);
    try {
      if (editing.id && !editing.builtIn) await api.updateTemplate(editing.id, editing);
      else await api.createTemplate({ ...editing, id: undefined, builtIn: undefined });
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const setSection = (i: number, patch: Partial<TemplateSection>) =>
    setEditing((t) => t && { ...t, sections: t.sections!.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  if (editing) {
    return (
      <div className="stack">
        <h1>{editing.id && !editing.builtIn ? "Edit template" : "New template"}</h1>
        <div className="card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="field" style={{ width: 80 }}>
              <label>Icon</label>
              <input value={editing.icon} maxLength={4} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>Name</label>
              <input value={editing.name} placeholder="e.g. Sales call debrief" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Description <span className="hint">(optional)</span></label>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Length</label>
              <select value={editing.length} onChange={(e) => setEditing({ ...editing, length: e.target.value as ExtractionTemplate["length"] })}>
                <option value="brief">Brief (about 150 words)</option>
                <option value="standard">Standard (about 400 words)</option>
                <option value="detailed">Detailed (up to 900 words)</option>
                <option value="exhaustive">Exhaustive (no length limit)</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Tone <span className="hint">(optional)</span></label>
              <input value={editing.tone ?? ""} placeholder="plain language" onChange={(e) => setEditing({ ...editing, tone: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Written for <span className="hint">(optional)</span></label>
              <input value={editing.audience ?? ""} placeholder="a first-time home buyer" onChange={(e) => setEditing({ ...editing, audience: e.target.value })} />
            </div>
          </div>
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={editing.includeTimestamps} onChange={(e) => setEditing({ ...editing, includeTimestamps: e.target.checked })} />
            Include timestamps (videos and podcasts)
          </label>
        </div>

        <h2>Sections</h2>
        <p className="muted small">Each section is something you want pulled out. Say what you want in plain words.</p>
        {editing.sections!.map((s, i) => (
          <div className="card" key={i}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>Heading</label>
                <input value={s.heading} placeholder="e.g. Objections raised" onChange={(e) => setSection(i, { heading: e.target.value })} />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>Format</label>
                <select value={s.format} onChange={(e) => setSection(i, { format: e.target.value as SectionFormat })}>
                  {FORMATS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>What to extract</label>
              <textarea rows={2} value={s.instruction} placeholder="e.g. Every concern the customer raised, with how it was answered" onChange={(e) => setSection(i, { instruction: e.target.value })} />
            </div>
            <div className="row">
              <button className="btn-ghost small" disabled={i === 0} onClick={() => setEditing({ ...editing, sections: swap(editing.sections!, i, i - 1) })}>↑</button>
              <button className="btn-ghost small" disabled={i === editing.sections!.length - 1} onClick={() => setEditing({ ...editing, sections: swap(editing.sections!, i, i + 1) })}>↓</button>
              <span className="spacer" />
              <button className="btn-ghost btn-danger small" disabled={editing.sections!.length === 1} onClick={() => setEditing({ ...editing, sections: editing.sections!.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          </div>
        ))}
        <button disabled={editing.sections!.length >= 20} onClick={() => setEditing({ ...editing, sections: [...editing.sections!, { id: `s${Date.now()}`, heading: "", instruction: "", format: "bullets" }] })}>＋ Add section</button>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn-primary" onClick={save}>Save template</button>
          <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Templates</h1>
        <span className="spacer" />
        <button className="btn-primary" onClick={() => setEditing(blank())}>＋ New template</button>
      </div>
      <p className="muted">Templates decide what gets pulled out and how it's laid out. Copy a built-in one to tweak it, or start from scratch.</p>
      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className="card">
            <h3>{t.icon} {t.name} {t.builtIn && <span className="pill">Built-in</span>}</h3>
            <p className="muted small">{t.sections.map((s) => s.heading).join(" · ")}</p>
            <div className="row">
              <button className="small" onClick={() => setEditing(t.builtIn ? { ...structuredClone(t), name: `${t.name} (my copy)` } : structuredClone(t))}>{t.builtIn ? "Copy and edit" : "Edit"}</button>
              {!t.builtIn && <button className="btn-ghost btn-danger small" onClick={async () => { await api.deleteTemplate(t.id); load(); }}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const c = [...arr];
  [c[a], c[b]] = [c[b], c[a]];
  return c;
}
