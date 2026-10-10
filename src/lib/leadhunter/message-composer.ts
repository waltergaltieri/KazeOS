import type { MessageBrief } from "./message-brief";

export interface ComposedMessage {
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceIds: string[] }>;
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

/** First-contact copy must explain the business use, not file specifications or a timid pitch. */
export function validateOutreachStyle(body: string): string[] {
  const issues: string[] = [];
  if (/\b(?:vectorial(?:es)?|vectorizad[oa]s?|vector (?:files?|logos?|formats?))\b/iu.test(body)) {
    issues.push("Traducí el detalle técnico a lenguaje de negocio: hablá del diseño o de los pedidos personalizados, no del formato del archivo ni del flujo del logo vectorial.");
  }
  if (/como idea para validar|se podr[ií]a explorar|podr[ií]amos (?:explorar|evaluar)|(?:perhaps|maybe) we could|pequeñ[oa]\s+(?:portal|sistema|herramienta|m[oó]dulo)|small\s+(?:portal|system|tool|module)/iu.test(body)) {
    issues.push("Presentá una oferta clara: Podemos desarrollar una solución que permita una acción concreta. No uses rodeos como 'como idea para validar', 'se podría explorar' ni diminutivos que resten valor. Podría o permitiría sí pueden describir beneficios sin garantizarlos.");
  }
  return issues;
}

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
  return validateProspectMessageChecks(brief, message, true);
}

/** Structural validity is not approval: callers must also perform semantic review. */
export function validateProspectMessageStructure(brief: MessageBrief, message: ComposedMessage) {
  return validateProspectMessageChecks(brief, message, false);
}

function validateProspectMessageChecks(brief: MessageBrief, message: ComposedMessage, requireTokenOverlap: boolean) {
  const issues: string[] = validateOutreachStyle(message.body);
  const words = message.body.trim().split(/\s+/).filter(Boolean).length;
  if (/\b(?:deje[n]? de|dejar de|stop having to|no longer (?:need|have) to)\b/iu.test(message.body)) issues.push("Describí lo que permitiría hacer la herramienta, sin decir que el equipo dejaría de hacer algo: eso presupone un problema o proceso actual.");
  if (message.claims.some(({ text }) => /lo que (?:sugiere|implica|indica)|da la sensaci[oó]n|(?:which|this) (?:suggests|implies)|gives the impression/iu.test(text))) issues.push("La lectura del negocio agrega deducciones: quitá conclusiones sobre volumen, complejidad, trabajo manual o procesos internos y conservá solo los hechos publicados. Las hipótesis van en la propuesta, no en la descripción.");
  if (/lo que (?:habla|demuestra|revela)|sin perder el trato directo que/iu.test(message.body)) issues.push("No agregues deducciones sobre el alcance comercial, clientes ni trato actual: describí únicamente el hecho publicado, sin ampliar su significado.");
  if (/(?=\p{L})(?!\p{Script=Latin})/u.test(`${message.subject} ${message.body}`)) issues.push("El correo mezcla alfabetos ajenos al idioma configurado; redactá todas las palabras en español o inglés según corresponda.");
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(`${message.subject} ${message.body}`)) issues.push("El mensaje expone identificadores internos.");
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
    compact(message.body).includes(compact(text))
    && evidenceIds.length > 0
    && evidenceIds.every((id) => factsById.has(id))
    && (!requireTokenOverlap || evidenceIds.some((id) => tokenCoverage(text, factsById.get(id)!.value) >= 0.3))
  ));
  const distinctEvidence = new Set(groundedClaims.flatMap(({ evidenceIds }) => evidenceIds));
  const absentClaims = message.claims.filter(({ text }) => !compact(message.body).includes(compact(text)));
  if (absentClaims.length) issues.push(`claims.text debe copiar frases LITERALES del correo, sin resumirlas ni reformularlas. Estas frases no aparecen en el cuerpo: ${absentClaims.slice(0, 3).map(({ text }) => text).join(" | ")}`);
  if (groundedClaims.length < brief.policy.minimumSpecificFacts || distinctEvidence.size < brief.policy.minimumSpecificFacts || groundedClaims.length !== message.claims.length) issues.push("Las afirmaciones no tienen evidencia suficiente.");
  if (!requireTokenOverlap && message.claims.map(c => c.text).join(" ").trim().split(/\s+/u).length > 65) issues.push("Resumí la descripción del negocio en un máximo de 65 palabras: actividad, clientes y forma de trabajar publicada. Quitá listas de productos, procesos, medidas y terminaciones.");
  return { valid: issues.length === 0, issues };
}

export function validateFollowUpMessage(
  brief: MessageBrief,
  initialSubject: string,
  message: ComposedMessage,
) {
  const issues: string[] = validateOutreachStyle(message.body);
  const words = message.body.trim().split(/\s+/u).filter(Boolean).length;
  if (/(?=\p{L})(?!\p{Script=Latin})/u.test(`${message.subject} ${message.body}`)) issues.push("El seguimiento mezcla alfabetos ajenos al idioma configurado.");
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(`${message.subject} ${message.body}`)) issues.push("El seguimiento expone identificadores internos.");
  if (message.subject !== `Re: ${initialSubject}`) issues.push("El seguimiento debe continuar el asunto original.");
  if (/<[^>]+>|```|[\u{1F300}-\u{1FAFF}]|[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(`${message.subject} ${message.body}`)) issues.push("El seguimiento debe ser texto simple y estar completamente en el idioma configurado.");
  if (/[{}\[\]]/u.test(message.body)) issues.push("El seguimiento contiene datos técnicos o serializados.");
  if (words < 55 || words > 140) issues.push("La longitud del seguimiento está fuera del rango permitido.");
  if (!message.body.endsWith(brief.policy.signature)) issues.push("La firma del seguimiento es incorrecta.");
  const factsById = new Map(brief.facts.map((fact) => [fact.id, fact]));
  if (message.claims.length === 0 || message.claims.some(({ text, evidenceIds }) => (
    !compact(message.body).includes(compact(text)) || evidenceIds.length === 0 || evidenceIds.some((id) => !factsById.has(id))
    || !evidenceIds.some((id) => factsById.has(id) && tokenCoverage(text, factsById.get(id)!.value) >= 0.3)
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
