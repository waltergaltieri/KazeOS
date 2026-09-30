# LeadHunter: diseño del flujo de prospección e investigación

**Fecha:** 2026-09-29  
**Estado:** aprobado  
**Alcance:** descubrimiento, investigación, calificación y preparación de mensajes. Los ejemplos anteriores de tareas programadas se usan como material de referencia y casos de aceptación; no se crean ni se ejecutan como campañas.

## Objetivo

LeadHunter debe transformar una intención comercial configurada por el propietario en prospectos investigados y mensajes listos para enviar. El sistema conserva las decisiones, evidencias, límites, historial y estados. ChatGPT participa únicamente como puente de correo: recibe mensajes terminados para enviarlos y devuelve eventos de envío o recepción.

El flujo debe mantener el nivel de investigación de los ejemplos anteriores sin depender de un prompt monolítico. Cada etapa produce datos estructurados, verificables y revisables desde KazeOS.

## Enfoques considerados

### Prompt completo por campaña

Toda la búsqueda, investigación, calificación y redacción se describe en un único texto. Es rápido de prototipar, pero mezcla reglas, dificulta reintentos parciales y vuelve frágil la auditoría.

### Reglas totalmente codificadas

Cada búsqueda y decisión se implementa con reglas fijas. Ofrece control, aunque limita la adaptación a rubros, mercados y oportunidades nuevas.

### Flujo híbrido por etapas

Las restricciones, estados, evidencias, deduplicación y autorizaciones son deterministas. La IA interpreta contenido público, propone oportunidades y redacta usando solamente el expediente aprobado. Este es el enfoque elegido porque combina flexibilidad con control operativo.

## Principios

1. Una campaña define intención y reglas; una corrida ejecuta una parte acotada de esa configuración.
2. Descubrir una empresa no significa calificarla ni autorizar un contacto.
3. Toda conclusión comercial importante debe conservar evidencia, fuente, fecha y nivel de confianza.
4. Los datos desconocidos permanecen desconocidos; no cuentan automáticamente a favor ni en contra.
5. Una exclusión obligatoria prevalece sobre la puntuación.
6. La búsqueda de contactos es una etapa separada y ocurre después de confirmar que el negocio merece investigación.
7. El cuerpo final se compone a partir de un expediente estructurado, no directamente desde resultados de búsqueda.
8. ChatGPT no elige destinatarios, no cambia el mensaje y no decide seguimientos. Sólo transporta correo y reporta eventos.

## Flujo funcional

### 1. Plan de búsqueda

Antes de consultar fuentes, LeadHunter convierte la configuración en un plan de corrida:

- mercados, regiones y rubros incluidos;
- consultas y variantes por fuente;
- páginas o directorios iniciales;
- criterios baratos que pueden aplicarse durante el descubrimiento;
- presupuesto de resultados, páginas, tiempo y coste;
- cursor de continuidad para no revisar siempre los primeros resultados.

El plan queda guardado con la versión de campaña que lo generó. Una reanudación continúa desde el cursor persistido y no amplía automáticamente el cupo para compensar una corrida incompleta.

### 2. Descubrimiento

Los adaptadores producen candidatos mínimos con nombre observado, ubicación, URL, fuente, consulta y fecha. En esta etapa se permite conservar resultados incompletos.

Las fuentes se clasifican por capacidad:

- descubrimiento de empresas;
- ampliación de información;
- búsqueda de contacto;
- verificación de identidad.

Una fuente puede cumplir más de una capacidad, pero LeadHunter no supone que Instagram, LinkedIn, un directorio o un buscador ofrecen las mismas operaciones.

### 3. Identidad y deduplicación

Antes de gastar en investigación, el sistema intenta vincular cada resultado con un negocio existente usando dominio oficial, perfiles verificados, dirección, teléfono publicado y otras señales coincidentes.

El nombre por sí solo no fusiona empresas. Las coincidencias dudosas quedan para revisión. Una empresa ya contactada o excluida puede enriquecer su expediente, pero no vuelve a entrar automáticamente en otra secuencia.

### 4. Investigación del negocio

LeadHunter construye un expediente con preguntas definidas por la campaña:

- qué hace el negocio;
- a quién vende;
- qué productos o servicios ofrece;
- dónde opera;
- qué presencia digital mantiene;
- qué señales de escala o actividad reciente existen;
- qué proceso comercial u operativo puede observarse;
- qué oportunidad concreta puede tener relación con los servicios de KazeCode.

Cada respuesta incluye estado (`verified`, `inferred`, `unknown`, `conflicting`), valor, confianza, fuente, fecha y extracto permitido. Las inferencias nunca se presentan como hechos.

### 5. Auditoría de presencia web

La evaluación de una web es una estrategia reutilizable, no una obligación global. Una campaña puede habilitar una puerta de calificación como:

- `NO_WEBSITE`;
- `BAD_WEBSITE`;
- `GOOD_ENOUGH_WEBSITE`;
- `UNVERIFIED`.

Una calificación negativa requiere señales observables: errores de carga, páginas rotas, problemas de seguridad o dominio, contenido incompleto, navegación grave, presentación que perjudica la credibilidad, información crítica obsoleta o una presencia fragmentada que no cumple el objetivo comercial. Tecnologías, tipografías, copyright antiguo o falta de ecommerce no bastan por sí solos.

La auditoría conserva comprobaciones realizadas, evidencia visual o textual disponible y aspectos que no pudieron verificarse.

### 6. Calificación

La evaluación mantiene dimensiones independientes:

- encaje comercial;
- confianza de evidencia;
- fortaleza aparente del negocio;
- oportunidad principal;
- oportunidad secundaria;
- posibilidad de contacto.

Los criterios configurables pueden ser obligatorios, positivos, negativos o excluyentes. La puntuación ordena candidatos elegibles, pero no reemplaza las puertas obligatorias.

El resultado incluye decisión, razones, criterios satisfechos, criterios faltantes y dudas. Un candidato sin correo puede quedar calificado como oportunidad y pasar a `no_email` sin ser enviado.

### 7. Enriquecimiento del contacto

Para cada negocio calificado se inicia una búsqueda específica. El orden preferido es sitio oficial, perfiles oficiales, páginas legales o de contacto, asociaciones y directorios confiables.

Se buscan:

- correo empresarial publicado;
- persona decisora y rol verificable;
- canales alternativos;
- URL exacta donde apareció cada dato.

No se crean patrones de correo ni cargos. La confianza del correo se representa como alta, media o no encontrado. Si existen varios contactos, se conserva la evidencia y una razón explícita para elegir el destinatario principal.

### 8. Estrategia del mensaje

Antes de redactar, LeadHunter crea un brief estable:

- idioma y variante regional;
- destinatario y forma de saludo;
- tres o más hechos específicos utilizables;
- oportunidad principal;
- resultado comercial que se propone explorar;
- una oportunidad secundaria prudente;
- límites de lo que puede afirmarse;
- presentación aprobada de KazeCode;
- explicación aprobada del modelo comercial;
- llamada a la acción, firma y enlaces permitidos.

Las campañas pueden usar plantillas de estrategia, como abrir mediante una oportunidad web y luego mencionar una automatización. La plantilla nunca reemplaza los hechos del expediente.

### 9. Composición

El redactor genera asunto y cuerpo en texto plano mediante bloques semánticos:

1. apertura breve y específica;
2. presentación corta;
3. comprensión del negocio y, cuando corresponda, aclaración de que es una mirada externa;
4. oportunidad principal expresada como resultado comercial;
5. transición breve a procesos u operaciones;
6. una idea secundaria basada en evidencia;
7. explicación corta del modelo comercial con lenguaje aprobado;
8. llamada a la acción y firma.

La estructura es una guía y no obliga a repetir frases. País, idioma, firma, canales y palabras restringidas provienen de la configuración vigente.

### 10. Validación editorial

Antes de autorizar la bandeja de salida, un validador comprueba:

- destinatario y fuente del correo;
- idioma, firma y llamada a la acción;
- correspondencia entre afirmaciones y evidencia;
- cantidad mínima de detalles específicos;
- ausencia de nombres, roles o defectos inventados;
- longitud y formato permitidos;
- ausencia de relleno, repetición, exageración o asunto engañoso;
- consistencia entre oportunidad, negocio y mensaje.

Los fallos objetivos bloquean el envío. Las observaciones de estilo permiten regeneración acotada. Cada versión conserva brief, contenido, resultado de validación y modelo usado.

### 11. Entrega al correo

Una versión validada se convierte en una orden de envío inmutable con destinatario, asunto, cuerpo, campaña, incorporación, paso lógico, fecha habilitada e identificador idempotente.

La tarea de ChatGPT obtiene órdenes vencidas, envía exactamente su contenido mediante la cuenta conectada y devuelve estado e identificadores del proveedor. Otra tarea entrega a KazeOS los mensajes entrantes. LeadHunter interpreta respuestas, detiene secuencias y decide la próxima acción.

## Pantallas afectadas

La campaña incorpora secciones estructuradas para descubrimiento, preguntas de investigación, puertas de calificación, estrategia del mensaje y validaciones. No se muestran como un prompt técnico.

La ficha del prospecto presenta:

- identidad y posibles coincidencias;
- resumen del negocio;
- evidencias por campo;
- auditoría web cuando aplique;
- calificación explicada;
- contactos y sus fuentes;
- brief de mensaje;
- versiones del correo y validaciones;
- actividad y estado de la bandeja.

La vista de corrida muestra avance por etapa, cantidades, descartes, errores recuperables, costes, cursores y próximos trabajos.

## Estados y recuperación

Cada etapa es durable y reintentable. Un fallo en una fuente o candidato no cancela los demás. Los trabajos usan lease, heartbeat, intentos limitados e identificadores idempotentes.

Los estados mínimos de candidato dentro de una corrida son `discovered`, `identity_pending`, `researching`, `qualification_pending`, `excluded`, `no_email`, `message_pending`, `validation_failed`, `ready` y `queued`.

Una corrida conserva conteos verdaderos por etapa. Nunca informa un envío sin confirmación del transportador ni marca evidencia como verificada si sólo fue inferida.

## Casos de aceptación derivados del flujo anterior

1. Un negocio sin web, pero con actividad pública suficiente, puede calificarse cuando la campaña habilita esa estrategia.
2. Un negocio con web moderna no pasa una puerta web aunque parezca necesitar automatización; otra campaña sin esa puerta puede evaluarlo.
3. Una web no se declara deficiente por una sola señal superficial.
4. Un candidato calificado sin correo permanece visible con canales alternativos y no entra a la bandeja.
5. Ningún correo inferido a partir del dominio puede enviarse.
6. Una misma empresa encontrada por varias fuentes produce un solo expediente revisable.
7. Cada mensaje incluye detalles respaldados que no podrían intercambiarse sin cambios con otra empresa.
8. Un hecho incierto se expresa como hipótesis prudente o se omite.
9. Argentina y Estados Unidos pueden usar estrategias compartidas con idioma, firma, CTA y fuentes diferentes sin campañas precargadas.
10. ChatGPT recibe contenido final; cualquier decisión de búsqueda, redacción, seguimiento o pausa permanece en LeadHunter.

## Fuera de alcance de esta etapa

- Crear automáticamente las campañas históricas.
- Ejecutar los textos adjuntos como instrucciones.
- Negociar, cotizar o cerrar ventas de forma autónoma.
- Garantizar cobertura de cualquier red social sin un adaptador autorizado.
- Tratar una aceptación del proveedor como prueba de entrega o lectura.

## Resultado esperado

El sistema puede explicar cómo encontró a cada empresa, qué entendió, qué no pudo verificar, por qué la calificó, de dónde obtuvo el contacto y cómo cada parte del mensaje se relaciona con evidencia. La automatización se puede ampliar sin volver a concentrar toda la operación en un prompt difícil de auditar.
