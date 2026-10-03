import type { MessageBrief } from "./message-brief";

export interface ComposedMessage {
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceIds: string[] }>;
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

function meaningfulTokens(value: string): Set<string> {
  return new Set(value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .match(/[a-z0-9]+/gu)
    ?.filter((token) => token.length >= 4) ?? []);
}

function tokenCoverage(left: string, right: string): number {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  const denominator = Math.min(leftTokens.size, rightTokens.size);
  if (denominator === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / denominator;
}

export function composeProspectMessage(brief: MessageBrief): ComposedMessage {
  const selected = brief.facts.slice(0, brief.policy.minimumSpecificFacts);
  const claims = selected.map((fact) => ({ text: compact(fact.value), evidenceIds: [fact.id] }));
  const name = brief.contact.firstName?.trim();
  if (brief.policy.language === "en-US") {
    const opening = name ? `Hi ${name},` : "Hello,";
    const facts = claims.map(({ text }) => text).join("; ");
    return {
      subject: `An idea for ${brief.companyName}`,
      body: [opening, "", brief.policy.intro, `I noticed that ${facts}.`, `There may be an opportunity to ${compact(brief.primaryOpportunity).replace(/^[A-Z]/, (c) => c.toLowerCase())}.`, brief.policy.commercialModel, brief.policy.cta, "", brief.policy.signature].join("\n"),
      claims,
    };
  }
  const opening = name ? `Hola ${name},` : "Hola,";
  const facts = claims.map(({ text }) => text).join("; ");
  return {
    subject: `Una idea para ${brief.companyName}`,
    body: [opening, "", brief.policy.intro, `Estuve viendo que ${facts}.`, `Veo una oportunidad concreta para ${compact(brief.primaryOpportunity).replace(/^[A-ZÁÉÍÓÚ]/, (c) => c.toLowerCase())}.`, brief.policy.commercialModel, brief.policy.cta, "", brief.policy.signature].join("\n"),
    claims,
  };
}

export function validateProspectMessage(brief: MessageBrief, message: ComposedMessage) {
  const issues: string[] = [];
  const words = message.body.trim().split(/\s+/).filter(Boolean).length;
  if (/<[^>]+>|```|[\u{1F300}-\u{1FAFF}]|[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(`${message.subject} ${message.body}`)) issues.push("El mensaje debe ser texto simple y estar completamente en el idioma configurado.");
  if (/[{}\[\]]/u.test(message.body) || /"(?:result|statusCode|state|targetUrl|testedPaths|brokenPaths)"\s*:/u.test(message.body)) issues.push("El mensaje contiene datos técnicos o serializados.");
  if (words < brief.policy.wordRange.minimum || words > brief.policy.wordRange.maximum) issues.push("La longitud está fuera del rango configurado.");
  if (brief.policy.restrictedPhrases.some((phrase) => message.body.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()))) issues.push("El mensaje usa una frase restringida.");
  for (const required of [brief.policy.intro, brief.policy.commercialModel, brief.policy.cta]) {
    if (!message.body.includes(required)) issues.push("Falta una sección obligatoria del mensaje.");
  }
  if (!message.body.endsWith(brief.policy.signature)) issues.push("La firma no coincide con la identidad configurada.");
  if (!message.subject.toLocaleLowerCase().includes(brief.companyName.toLocaleLowerCase())) issues.push("El asunto no identifica a la empresa.");
  const factsById = new Map(brief.facts.map((fact) => [fact.id, fact]));
  const groundedClaims = message.claims.filter(({ text, evidenceIds }) => (
    tokenCoverage(text, message.body) >= 0.5
    && evidenceIds.length > 0
    && evidenceIds.every((id) => factsById.has(id))
    && evidenceIds.some((id) => tokenCoverage(text, factsById.get(id)!.value) >= 0.3)
  ));
  if (groundedClaims.length < brief.policy.minimumSpecificFacts) issues.push("Las afirmaciones no tienen evidencia suficiente.");
  return { valid: issues.length === 0, issues };
}

export function validateFollowUpMessage(
  brief: MessageBrief,
  initialSubject: string,
  message: ComposedMessage,
) {
  const issues: string[] = [];
  const words = message.body.trim().split(/\s+/u).filter(Boolean).length;
  if (message.subject !== `Re: ${initialSubject}`) issues.push("El seguimiento debe continuar el asunto original.");
  if (/<[^>]+>|```|[\u{1F300}-\u{1FAFF}]|[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(`${message.subject} ${message.body}`)) issues.push("El seguimiento debe ser texto simple y estar completamente en el idioma configurado.");
  if (/[{}\[\]]/u.test(message.body)) issues.push("El seguimiento contiene datos técnicos o serializados.");
  if (words < 55 || words > 140) issues.push("La longitud del seguimiento está fuera del rango permitido.");
  if (!message.body.endsWith(brief.policy.signature)) issues.push("La firma del seguimiento es incorrecta.");
  const factsById = new Map(brief.facts.map((fact) => [fact.id, fact]));
  if (message.claims.some(({ evidenceIds }) => (
    evidenceIds.length === 0 || evidenceIds.some((id) => !factsById.has(id))
  ))) issues.push("El seguimiento no está respaldado por evidencia.");
  return { valid: issues.length === 0, issues };
}

export function composeFollowUps(brief: MessageBrief, initialSubject: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const name = brief.contact.firstName?.trim();
    if (brief.policy.language === "en-US") {
      return {
        subject: `Re: ${initialSubject}`,
        body: [name ? `Hi ${name},` : "Hello,", "", index === 0
          ? `I wanted to follow up on the idea for ${brief.companyName} around ${brief.primaryOpportunity.toLowerCase()}.`
          : `I’m following up once more in case improving ${brief.primaryOpportunity.toLowerCase()} is currently a priority.`, brief.policy.cta, "", brief.policy.signature].join("\n"),
      };
    }
    return {
      subject: `Re: ${initialSubject}`,
      body: [name ? `Hola ${name},` : "Hola,", "", index === 0
        ? `Quería retomar la idea para ${brief.companyName} sobre ${brief.primaryOpportunity.toLowerCase()}.`
        : `Vuelvo a escribir por si mejorar ${brief.primaryOpportunity.toLowerCase()} es una prioridad en este momento.`, brief.policy.cta, "", brief.policy.signature].join("\n"),
    };
  });
}
