# Descubrimiento de LeadHunter en Oracle

## Objetivo

Mover la búsqueda de prospectos fuera de Vercel. Oracle ejecuta SearXNG y el worker; Vercel conserva la planificación, validación, persistencia y continuidad del pipeline.

## Alternativas consideradas

1. **El worker devuelve una página normalizada en la finalización del trabajo.** Vercel valida los candidatos, los guarda de forma transaccional y crea trabajos de resolución de identidad. Es la opción elegida porque reutiliza el leasing, la idempotencia y `persistDiscoveryPage`.
2. **Un endpoint de ingesta separado.** Permitiría cargas parciales, pero duplicaría autenticación, idempotencia y manejo de errores.
3. **Exponer SearXNG a Vercel.** Requiere un servicio público autenticado y mantiene la búsqueda dentro de una función con tiempo limitado. Se descarta.

## Flujo

1. El cron de Vercel planifica corridas, encola trabajos `discover` y procesa únicamente resoluciones de identidad pendientes, que no acceden a la web.
2. El worker de Oracle reclama `discover` junto con investigación, auditoría, calificación y enriquecimiento.
3. Para búsquedas, el worker llama al SearXNG local del stack Oracle; para URL semilla normaliza la propia URL.
4. El worker devuelve candidatos, cursor y metadatos limitados por el contrato.
5. KazeOS valida que fuente y trabajo coincidan, persiste la página, crea los trabajos `resolve_identity` y completa el trabajo original.
6. La resolución de identidad permanece temporalmente en Vercel hasta trasladarla al worker en una entrega posterior; el cron la procesa sin consultar SearXNG.

## Seguridad y fallos

- SearXNG no se publica en Internet.
- El worker sólo recibe el secreto de máquina y la URL pública de KazeOS.
- KazeOS limita tamaño, cantidad, URL, rango y metadatos de cada candidato.
- Una finalización repetida conserva idempotencia y no duplica candidatos ni trabajos.
- Errores de red se informan como fallo del trabajo y usan el reintento durable existente.

## Verificación

- Pruebas Python del adaptador SearXNG y del cuerpo de finalización.
- Pruebas TypeScript del contrato y de persistencia al completar `discover`.
- Prueba del cron para confirmar que no consulta SearXNG.
- Prueba real Oracle → Vercel antes de activar una campaña.
