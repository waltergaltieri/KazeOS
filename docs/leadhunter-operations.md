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

Desde la pantalla de una campaña, **Activar agente** habilita la búsqueda y los envíos automáticos. **Buscar ahora** adelanta la próxima corrida. **Pausar** detiene búsquedas y cancela los correos todavía no retirados. No hace falta un cron separado ni que una PC permanezca encendida.

## Contrato del puente de correo

Todas las llamadas usan `Authorization: Bearer <LEADHUNTER_TRANSPORT_SECRET>`.

- `POST /api/public/leadhunter/mail/claim` con `{ "limit": 10 }`: retira comandos vencidos.
- `POST /api/public/leadhunter/mail/settle`: informa `accepted`, `failed` o `unknown` junto con el identificador del proveedor.
- `POST /api/public/leadhunter/mail/events`: informa `replied` o `bounced`. Una respuesta cancela los seguimientos pendientes.

Cada comando incluye `outboxId`, destinatario, asunto, cuerpo, fecha e `idempotencyKey`. El transportador debe usar esa clave para impedir duplicados.

## Fuentes disponibles

La búsqueda general, directorios, Instagram público y páginas públicas de empresas en LinkedIn se descubren mediante SearXNG. Las páginas encontradas se investigan con evidencia trazable. CSV y carga manual permanecen disponibles como entrada del usuario; no generan búsquedas automáticas.

No se aplican migraciones automáticamente. Antes de activar una campaña en un entorno nuevo, ejecutar `pnpm db:migrate -- --dry-run`, revisar las migraciones pendientes y después ejecutar `pnpm db:migrate` contra la base de datos correspondiente.
