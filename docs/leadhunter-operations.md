# LeadHunter: puesta en marcha

LeadHunter separa tres responsabilidades:

1. KazeOS planifica campañas, descubre negocios, investiga, califica, redacta y programa la secuencia.
2. El worker procesa investigación, auditoría web y búsqueda de correos publicados.
3. El puente de correo retira comandos ya decididos y devuelve aceptación, respuesta o rebote. El puente no modifica textos ni decide a quién contactar.

## Variables

- `LEADHUNTER_SEARXNG_ENDPOINT`: URL HTTPS opcional para ejecutar búsquedas desde KazeOS durante desarrollo.
- `LEADHUNTER_WORKER_SECRET`: secreto de 32 caracteres o más compartido con el worker.
- `LEADHUNTER_TRANSPORT_SECRET`: secreto de 32 caracteres o más compartido con el puente de correo.
- `CRON_SECRET`: protege la corrida programada.
- `KAZEOS_URL`: URL pública de KazeOS, utilizada por el worker.
- `SEARXNG_URL`: URL interna de SearXNG utilizada por el worker de Oracle, por ejemplo `http://searxng:8080/search`.

## Ejecución

El worker llama cada minuto al endpoint interno `tick`. Esa llamada crea las corridas vencidas y resuelve identidades; el mismo worker procesa las búsquedas y el resto de los trabajos pesados. Se mantiene activo con:

```powershell
cd workers/leadhunter
python -m pip install -e '.[scrapegraph]'
python -m leadhunter_worker
```

Desde la pantalla de una campaña, **Activar agente** y **Buscar ahora** inician la búsqueda conservando el modo de envío existente. Nunca convierten borradores en envíos automáticos ni inventan una cuenta de correo. **Pausar** detiene búsquedas y cancela los correos todavía no retirados. No hace falta un cron separado ni que una PC permanezca encendida.

## Operación desde el asistente, sin pantalla nueva

Usar la configuración validada de `docs/leadhunter-campaign.example.json` como base, adaptar país, rubro, búsquedas, criterios y secuencia al pedido. No copiar credenciales en el archivo. Las credenciales siguen en `.env.local` y en el servidor. Cada criterio de calificación debe tener un `predicate` ejecutable; una frase sola deja al prospecto en revisión y el operador rechaza esa configuración.

```text
pnpm leadhunter create --owner OWNER_UUID --file campaña.json
pnpm leadhunter run --owner OWNER_UUID --campaign CAMPAIGN_UUID
pnpm leadhunter status --owner OWNER_UUID --campaign CAMPAIGN_UUID
pnpm leadhunter pause --owner OWNER_UUID --campaign CAMPAIGN_UUID
```

`create` guarda la campaña en borradores, sin cuenta para enviar. `run` ejecuta una sola corrida; `run --recurring` programa las siguientes según el calendario de la campaña. `status` muestra errores de cada etapa, prospectos y cola. No modifica otras campañas.

`run --research-only` ejecuta una prueba única de búsqueda, resolución de identidad e investigación. Guarda `executionMode: research_only` en el plan antes de publicar los trabajos y detiene el pipeline después de la investigación. La toma de trabajos también rechaza etapas posteriores para ese plan. No crea análisis comercial, briefs, borradores ni envíos. Es incompatible con `--recurring`; el límite de candidatos es `dailyLeadLimit`.

`run --qualify-only` añade auditoría web y calificación, y se detiene antes del enriquecimiento de contactos y de la redacción. Es una prueba única incompatible con `--research-only` y `--recurring`. Tanto el pipeline como la toma de trabajos bloquean las etapas posteriores.

### Evaluación visual

El worker de Oracle usa Chromium mediante Playwright: captura la portada y el siguiente tramo visible en escritorio (1440×900) y móvil (390×844), hasta cuatro JPEG. MiniMax-M3 recibe esas imágenes y contexto de renderizado, no solo HTML. Las capturas, hashes, métricas y respuesta del modelo se conservan en el volumen persistente `worker-state/visual`; la evidencia `website_visual_review` del CRM incluye referencias a las imágenes y observaciones concretas. El modelo no prueba botones ni envía formularios. La API multimodal utilizada es `/chat/completions`, según la documentación oficial de MiniMax.

Para marcar `BAD_WEBSITE` por presentación se requieren ambos tamaños, confianza ≥80 y dos categorías distintas con defectos materiales, o un defecto crítico no basado solamente en estilo anticuado. Cada observación debe identificar elemento, captura e impacto visible. Un estilo antiguo por sí solo no excluye una web; no se infieren antigüedad real, tráfico ni pérdidas. Capturas bloqueadas, CAPTCHA, falta de visión o evidencia insuficiente producen `UNVERIFIED`. Un resultado visual adecuado no certifica todo el sitio: solo las vistas capturadas. Se retiraron los pases ficticios de navegación y páginas rotas del auditor anterior.

Las campañas orientadas a renovar webs deben exigir `BAD_WEBSITE` y evidencia de escala operativa. `website_problem` textual puede ser una pregunta opcional, pero no un requisito adicional: los defectos visuales se acreditan con las capturas aunque el texto de la página no declare un problema.

No se declara contenido faltante por ausencia de palabras clave en el HTML. La comprobación de transporte toma la URL final tras las redirecciones, evitando marcar HTTP inseguro cuando el servidor redirige a HTTPS.

Para recuperar una prueba tras corregir un error: `retry-failed --owner OWNER_UUID --campaign CAMPAIGN_UUID --job JOB_UUID`. Conserva el error anterior en el historial. `refresh-drafts --owner OWNER_UUID --campaign CAMPAIGN_UUID` vuelve a preparar borradores con la revisión de calidad actual, conservando las versiones anteriores. Ambos comandos exigen modo borradores; la actualización omite contactos que ya tengan algún comando de envío.

Cuando el usuario haya autorizado contacto real, configurar explícitamente `enable-sending --owner OWNER_UUID --campaign CAMPAIGN_UUID --mailbox EXISTING_MAILBOX_UUID` y luego ejecutar `run --recurring`. El modo automático usa el transporte ya configurado en Oracle. Revisar los prospectos listos de una prueba antes de reutilizarlos en producción: el comando no reenvía borradores anteriores automáticamente.

La búsqueda incorpora país, región y rubro; descarta enlaces de mensajería, videos y publicaciones aisladas y agrupa los resultados del mismo sitio. La investigación captura hasta siete páginas del sitio por negocio (página encontrada y hasta seis secciones de empresa, servicios, sectores, proyectos, contacto o condiciones comerciales), conserva texto y hash por fuente y no trata resúmenes del buscador como hechos verificados. El contacto se extrae de esas capturas, incluidos enlaces `mailto:`. Si no puede investigar una fuente, registra el fallo; no lo presenta como éxito vacío.

Antes de aceptar un correo se valida formato, firma, detalles distintos respaldados y una revisión de contenido con IA. Una revisión fallida bloquea el correo; no habilitar envíos para saltarse una investigación incompleta. Instagram y LinkedIn dependen del contenido público accesible: no hay acceso a perfiles privados ni una garantía de obtener correo de todos los negocios.

### Estilo de los correos

El generador usa el tono de `strategy.message.tone` y calcula la extensión disponible descontando los textos fijos. La estructura es: saludo, presentación, lectura del negocio desde información pública, oportunidad principal alineada con la campaña, segunda oportunidad opcional con objetivo independiente, modalidad mensual y una sola invitación final. No exige preguntas sobre herramientas ni reuniones intermedias. La descripción conecta hechos sin deducir volumen, problemas internos o ausencia de software a partir de la web.

La lectura del negocio resume qué tipo de empresa es, a quién atiende y cómo declara trabajar, en tres frases breves de 40–65 palabras en total. Los hechos respaldados se seleccionan por esas dimensiones, no como tres productos del catálogo. El análisis previo y la revisión editorial también evitan enumeraciones técnicas, composiciones, medidas, pesos y presentaciones; solo admiten un ejemplo sencillo cuando resulta necesario para comprender el beneficio propuesto.

La propuesta distingue condición observada, mejora ofrecida y beneficio comercial en oraciones completas. El brief incorpora por separado los hallazgos visuales de la auditoría más reciente: solo observaciones materiales respaldadas por capturas de escritorio y móvil con confianza suficiente; no transmite pérdidas o impactos especulativos como hechos. Una auditoría sin hallazgos utilizables no autoriza a afirmar que la web está rota o no consigue visitas. El redactor puede abrir con un defecto comprobado y continuar con «Les proponemos…», explicando cómo la mejora ayudaría a mostrar la oferta, llegar a potenciales clientes y facilitar consultas. La revisión rechaza fragmentos como «Un sitio web que presente…» que no expresan una propuesta completa.

La generación inicial usa `generateReviewedProspectMessage`: hasta tres intentos dentro de 140 segundos, devolviendo al modelo el borrador rechazado y los motivos. Primero valida formato, extensión, firma, presencia literal de las frases declaradas e identificadores de evidencia; después exige una revisión semántica y editorial independiente. Las paráfrasis no se rechazan por baja coincidencia de palabras con la fuente. Los identificadores desconocidos siguen bloqueados y una revisión fallida o no disponible nunca aprueba el correo. La lectura del negocio tiene un máximo de 65 palabras. Las pruebas sin envío usan la misma función; no convierten prospectos pendientes de calificación en aptos. Redacción y revisión usan razonamiento de MiniMax M3 (`reasoning.effort: medium`, que habilita razonamiento sin graduar su profundidad según la [API de MiniMax](https://platform.minimax.io/docs/api-reference/responses-create)); el presupuesto de salida incluye esos tokens.

Las campañas nuevas usan los valores actualizados de `contracts.ts` (200–350 palabras y un párrafo comercial más breve); el ejemplo JSON del operador contiene los mismos valores. Las campañas y briefs ya guardados conservan sus textos y parámetros para mantener su historial. Cambiar los valores predeterminados no reescribe correos existentes. La generación actual se registra con `qualityVersion: 7`; `refresh-drafts` puede solicitar una nueva versión para prospectos elegibles sin envíos, solo en modo borradores, conservando la investigación y la configuración del brief original. Para cambiar también los textos fijos de una campaña existente debe crearse una nueva versión de su configuración.

## Investigación con ScrapeGraphAI

El worker instala `scrapegraphai==2.3.0` y ejecuta `SmartScraperGraph` en cada trabajo de investigación. El grafo recibe la captura pública hecha por KazeOS y usa MiniMax mediante su adaptador de modelo; no necesita una clave de la API comercial de ScrapeGraphAI ni OpenAI. No hay fallback silencioso al extractor anterior. Cada fuente conserva URL, fecha, hash, fragmentos literales y uso del modelo; la actividad `research.completed` registra `scrapegraphai-2.3.0` y `graph:SmartScraperGraph`.

La captura tiene un límite de siete páginas del mismo sitio, 30.000 caracteres por página y una llamada de extracción por fuente. No es navegación ilimitada ni acceso autenticado a redes sociales. La búsqueda inicial sigue siendo SearXNG. Para responder sobre trayectoria, capacidades y cobertura, las campañas nuevas incluyen esas preguntas; las existentes conservan su configuración versionada.

Antes de redactar, `business-analysis.ts` analiza las evidencias de negocio y guarda `businessAnalysis` dentro del brief del CRM: actividad, clientes, proceso publicado, mejora propuesta y aspectos desconocidos. La propuesta no se registra como hecho sobre la operación actual. Los hechos se distribuyen entre dimensiones para evitar que varias páginas repitiendo el mismo producto desplacen todo el contexto. El redactor recibe tanto las evidencias como este análisis y abre la propuesta por su utilidad para el cliente. La validación final sigue comprobando el correo contra las evidencias originales.

Para verificar el flujo, crear una campaña en modo `drafts`, sin buzón, con una sola URL semilla y sin recurrencia. Ejecutar con `run`, revisar trabajos, actividad de investigación, brief y versión del mensaje; comprobar que no tiene registros en `lh_outbox` y pausarla al terminar. No utilizar `enable-sending` durante esta prueba.

## Contrato del puente de correo

Todas las llamadas usan `Authorization: Bearer <LEADHUNTER_TRANSPORT_SECRET>`. El worker de Oracle ejecuta el transporte con Gmail mediante `GMAIL_ADDRESS` y `GMAIL_APP_PASSWORD`; su estado idempotente de envíos y el cursor de entrada se conservan en `MAIL_STATE_PATH`.

- `POST /api/public/leadhunter/mail/claim` con `{ "limit": 10 }`: retira comandos vencidos.
- `POST /api/public/leadhunter/mail/settle`: informa `accepted`, `failed` o `unknown` junto con el identificador del proveedor.
- `POST /api/public/leadhunter/mail/events`: informa `replied` o `bounced`. Una respuesta cancela los seguimientos pendientes.

Cada comando incluye `outboxId`, destinatario, asunto, cuerpo, fecha e `idempotencyKey`. El transportador debe usar esa clave para impedir duplicados.

El worker consulta respuestas antes de enviar y retira un solo correo por turno. `MAIL_SEND_INTERVAL_SECONDS` vale 432 (7 minutos y 12 segundos) como mínimo: la reserva se guarda por cuenta en SQLite antes de retirar el comando y sobrevive a reinicios. Turnos vacíos o fallidos no se acumulan. Esto distribuye hasta 200 envíos en 24 horas entre todas las campañas del buzón, incluyendo seguimientos; cada campaña conserva además su límite diario. La investigación, disponibilidad de candidatos y frecuencia efectiva del worker pueden reducir el volumen: no es una garantía de 200 envíos ni de horarios exactos.

## Fuentes disponibles

La búsqueda general, directorios, Instagram público y páginas públicas de empresas en LinkedIn se descubren mediante SearXNG. Las páginas encontradas se investigan con evidencia trazable. CSV y carga manual permanecen disponibles como entrada del usuario; no generan búsquedas automáticas.

No se aplican migraciones automáticamente. Antes de activar una campaña en un entorno nuevo, ejecutar `pnpm db:migrate -- --dry-run`, revisar las migraciones pendientes y después ejecutar `pnpm db:migrate` contra la base de datos correspondiente.

La oferta expresa con claridad lo que podemos desarrollar; la prudencia se aplica a los hechos desconocidos y a los beneficios no garantizados. Los detalles de formatos de archivos se traducen a su uso comercial (diseño, pedidos personalizados). El ensamblado omite la segunda propuesta cuando el brief no define un objetivo separado. Los briefs nuevos de campañas web pueden incluir gestión interna como objetivo secundario; dos vistas de un mismo sistema de pedidos no son dos oportunidades. Los controles de estilo se aplican también a los seguimientos.
