type Campaign = { campaignId: string; campaignName: string; evaluation: string; status: string; score: number | null };
type Audit = { id: string; gateResult: string; summary: string; confidence: number; checks: unknown };

export function QualificationPanel({ campaigns, audits }: { campaigns: Campaign[]; audits: Audit[] }) {
  const audit = audits[0];
  const checks = audit && typeof audit.checks === "object" && audit.checks && "checks" in audit.checks && Array.isArray((audit.checks as { checks?: unknown }).checks) ? (audit.checks as { checks: Array<{ key: string; outcome: string }> }).checks : [];
  return <section className="leadhunter-panel"><header><p className="eyebrow">Calificación</p><h2>¿Conviene contactarlo?</h2></header>{campaigns.map((campaign) => <div className="qualification-result" key={campaign.campaignId}><strong>{campaign.campaignName}</strong><span>{campaign.evaluation.replaceAll("_", " ")}{campaign.score !== null ? ` · ${campaign.score}/100` : ""}</span></div>)}{audit ? <div className="website-audit-summary"><h3>Auditoría web: {audit.gateResult.replaceAll("_", " ")}</h3><p>{audit.summary}</p><span>Confianza {audit.confidence}%</span>{checks.length ? <ul>{checks.map((check) => <li key={check.key}>{check.key.replaceAll("_", " ")}: <strong>{check.outcome}</strong></li>)}</ul> : null}</div> : <p>La página web todavía no fue auditada.</p>}</section>;
}
