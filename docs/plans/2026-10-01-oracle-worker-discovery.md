# Oracle Worker Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ejecutar el descubrimiento de prospectos mediante SearXNG en el worker de Oracle y persistir sus resultados de forma segura en KazeOS.

**Architecture:** El resultado `discover` incluirá una página acotada de candidatos. `completeClaimedJob` validará el lease, reutilizará `persistDiscoveryPage` y sólo después marcará el trabajo como completado. El cron dejará de ejecutar búsquedas y el worker reclamará `discover`.

**Tech Stack:** Next.js, TypeScript, Zod, PostgreSQL/Drizzle, Python 3.13, Pydantic, SearXNG, Docker Compose.

---

### Task 1: Contrato de descubrimiento

**Files:** `src/lib/services/leadhunter/job-manager.ts`, `src/lib/services/leadhunter/job-manager.integration.test.ts`

1. Escribir una prueba que rechace candidatos inválidos y acepte una página acotada.
2. Ejecutarla y confirmar que falla.
3. Añadir candidatos y cursor al esquema `discover`.
4. Ejecutar la prueba y confirmar que pasa.

### Task 2: Persistencia al completar

**Files:** `src/lib/services/leadhunter/completion-manager.ts`, `src/lib/services/leadhunter/completion-manager.integration.test.ts`

1. Escribir una prueba donde completar `discover` persiste candidatos y agenda identidad.
2. Ejecutarla y confirmar que falla.
3. Validar el lease, llamar `persistDiscoveryPage` y completar con el resumen persistido.
4. Verificar éxito, repetición idempotente y rechazo de fuente incorrecta.

### Task 3: Búsqueda desde Python

**Files:** `workers/leadhunter/leadhunter_worker/runner.py`, `workers/leadhunter/leadhunter_worker/contracts.py`, `workers/leadhunter/tests/test_runner.py`

1. Escribir pruebas de consulta, paginación, normalización, límites y error HTTP.
2. Ejecutarlas y confirmar que fallan.
3. Implementar búsqueda SearXNG y URL semilla con `urllib` y Pydantic.
4. Incluir `discover` en los tipos reclamados y verificar las pruebas.

### Task 4: Cron y operación

**Files:** `src/app/api/cron/leadhunter/route.ts`, `src/app/api/cron/leadhunter/route.test.ts`, `docs/leadhunter-operations.md`

1. Escribir una prueba que confirme que el cron sólo planifica.
2. Ejecutarla y confirmar que falla.
3. Retirar la búsqueda del cron y documentar las variables del worker.
4. Ejecutar pruebas dirigidas, typecheck y pruebas Python.

### Task 5: Despliegue Oracle

1. Construir la imagen ARM64 del worker en el stack `~/leadhunter-stack`.
2. Configurar `KAZEOS_URL`, `LEADHUNTER_WORKER_SECRET` y `SEARXNG_URL` sin imprimir secretos.
3. Iniciar el worker con reinicio automático.
4. Ejecutar una reclamación real y verificar logs, salud y ausencia de duplicados.
