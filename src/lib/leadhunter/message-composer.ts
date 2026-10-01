import type { MessageBrief } from "./message-brief";

export interface ComposedMessage {
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceIds: string[] }>;
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

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
  const expected = composeProspectMessage(brief);
  const words = message.body.trim().split(/\s+/).filter(Boolean).length;
  if (/<[^>]+>|[\u{1F300}-\u{1FAFF}]/u.test(`${message.subject} ${message.body}`)) issues.push("El mensaje debe ser texto simple.");
  if (words < brief.policy.wordRange.minimum || words > brief.policy.wordRange.maximum) issues.push("La longitud está fuera del rango configurado.");
  if (brief.policy.restrictedPhrases.some((phrase) => message.body.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()))) issues.push("El mensaje usa una frase restringida.");
  if (message.subject !== expected.subject || message.body !== expected.body) issues.push("El contenido contiene texto no respaldado por el brief.");
  const allowedIds = new Set(brief.facts.map(({ id }) => id));
  if (message.claims.length < brief.policy.minimumSpecificFacts || message.claims.some(({ evidenceIds }) => !evidenceIds.length || evidenceIds.some((id) => !allowedIds.has(id)))) issues.push("Las afirmaciones no tienen evidencia suficiente.");
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
