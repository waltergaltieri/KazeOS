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
python -m pip install -e .
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

Para recuperar una prueba tras corregir un error: `retry-failed --owner OWNER_UUID --campaign CAMPAIGN_UUID --job JOB_UUID`. Conserva el error anterior en el historial. `refresh-drafts --owner OWNER_UUID --campaign CAMPAIGN_UUID` vuelve a preparar borradores con la revisión de calidad actual, conservando las versiones anteriores. Ambos comandos exigen modo borradores; la actualización omite contactos que ya tengan algún comando de envío.

Cuando el usuario haya autorizado contacto real, configurar explícitamente `enable-sending --owner OWNER_UUID --campaign CAMPAIGN_UUID --mailbox EXISTING_MAILBOX_UUID` y luego ejecutar `run --recurring`. El modo automático usa el transporte ya configurado en Oracle. Revisar los prospectos listos de una prueba antes de reutilizarlos en producción: el comando no reenvía borradores anteriores automáticamente.

La búsqueda incorpora país, región y rubro; descarta enlaces de mensajería, videos y publicaciones aisladas y agrupa los resultados del mismo sitio. La investigación captura hasta tres páginas por negocio (página encontrada, inicio/contacto/información), conserva texto y hash por fuente y no trata resúmenes del buscador como hechos verificados. El contacto se extrae de esas capturas, incluidos enlaces `mailto:`. Si no puede investigar una fuente, registra el fallo; no lo presenta como éxito vacío.

Antes de aceptar un correo se valida formato, firma, detalles distintos respaldados y una revisión de contenido con IA. Una revisión fallida bloquea el correo; no habilitar envíos para saltarse una investigación incompleta. Instagram y LinkedIn dependen del contenido público accesible: no hay acceso a perfiles privados ni una garantía de obtener correo de todos los negocios.

## Contrato del puente de correo

Todas las llamadas usan `Authorization: Bearer <LEADHUNTER_TRANSPORT_SECRET>`. El worker de Oracle ejecuta el transporte con Gmail mediante `GMAIL_ADDRESS` y `GMAIL_APP_PASSWORD`; su estado idempotente de envíos y el cursor de entrada se conservan en `MAIL_STATE_PATH`.

- `POST /api/public/leadhunter/mail/claim` con `{ "limit": 10 }`: retira comandos vencidos.
- `POST /api/public/leadhunter/mail/settle`: informa `accepted`, `failed` o `unknown` junto con el identificador del proveedor.
- `POST /api/public/leadhunter/mail/events`: informa `replied` o `bounced`. Una respuesta cancela los seguimientos pendientes.

Cada comando incluye `outboxId`, destinatario, asunto, cuerpo, fecha e `idempotencyKey`. El transportador debe usar esa clave para impedir duplicados.

## Fuentes disponibles

La búsqueda general, directorios, Instagram público y páginas públicas de empresas en LinkedIn se descubren mediante SearXNG. Las páginas encontradas se investigan con evidencia trazable. CSV y carga manual permanecen disponibles como entrada del usuario; no generan búsquedas automáticas.

No se aplican migraciones automáticamente. Antes de activar una campaña en un entorno nuevo, ejecutar `pnpm db:migrate -- --dry-run`, revisar las migraciones pendientes y después ejecutar `pnpm db:migrate` contra la base de datos correspondiente.
