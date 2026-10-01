import { ExternalLink } from "lucide-react";

type Evidence = { id: string; kind: string; field: string; value: string; sourceType: string; sourceUrl: string | null; confidence: number; observedAt: Date };

export function ResearchDossier({ evidence }: { evidence: Evidence[] }) {
  const facts = evidence.filter((item) => item.kind === "fact");
  return <section className="leadhunter-panel"><header><p className="eyebrow">Investigación</p><h2>Hechos observados</h2></header>{facts.length ? <ul className="evidence-list">{facts.map((item) => <li key={item.id}><div><strong>{item.value}</strong><span>{item.field.replaceAll("_", " ")} · confianza {item.confidence}%</span></div>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label="Abrir fuente"><ExternalLink size={14} /></a> : null}</li>)}</ul> : <p>La investigación todavía no produjo evidencia.</p>}</section>;
}
