# Evaluación del extractor de investigación de LeadHunter

**Evaluación ejecutada:** 2026-09-30

**Decisión:** aprobar el contrato y el extractor determinista para pruebas controladas; mantener ScrapeGraphAI deshabilitado y no aprobado para producción hasta medirlo con un proveedor y un corpus representativo.

## Alcance de esta evaluación

El worker recibe contenido público que otro componente ya obtuvo. No abre URLs, no navega, no consulta la base de datos y no recibe credenciales de correo, administración de KazeOS ni Supabase. La URL, la fecha de suministro, el tipo de fuente, el hash del contenido, las preguntas autorizadas y los límites de ejecución forman parte de un contrato estricto.

El contenido se trata como datos no confiables. Una página no puede agregar campos, cambiar el esquema, pedir acciones ni sustituir la URL de evidencia. Todo resultado pasa por la misma validación de campos, fuente y arraigo textual antes de cruzar el límite del worker. Cada afirmación debe incluir un extracto exacto y acotado que aparezca completo dentro de un solo bloque visible del contenido suministrado; encabezados, párrafos y otros bloques separados nunca se concatenan para fabricar una frase. El valor debe aparecer dentro de ese mismo extracto con límites Unicode de palabra o frase. Se rechazan extractos ausentes, coincidencias parciales como `us` dentro de `business` y cualquier valor alfabético de una sola palabra con tres caracteres o menos (`a`, `de`, `la`, `y`, entre otros). La excepción sólo alcanza a valores claramente estructurados que validen como correo o URL HTTP(S); ante una señal textual débil se conserva `unknown` en lugar de crear evidencia.

## Dependencias y versión evaluable

- Runtime productivo fijado a Python `>=3.12,<3.13`, con `.python-version` en `3.12`.
- Python 3.12 no está instalado en este equipo. Las pruebas locales se ejecutaron desde el código fuente con Python 3.13 solamente como comprobación auxiliar; la validación del runtime exacto 3.12 continúa pendiente y no se considera aprobada por esta corrida.
- Contrato base: `pydantic==2.12.5`.
- Pruebas: `pytest==9.0.2`.
- Adaptador opcional: extra `scrapegraph`, fijado a `scrapegraphai==2.3.0`.

La versión 2.3.0 era la versión estable actual al 2026-09-30. PyPI declara compatibilidad con Python 3.12 o posterior y publicó el artefacto 2.3.0 el 2026-09-25: [PyPI](https://pypi.org/project/scrapegraphai/2.3.0/). El repositorio oficial registra la misma versión y fecha: [GitHub Releases](https://github.com/ScrapeGraphAI/Scrapegraph-ai/releases/tag/v2.3.0).

ScrapeGraphAI está detrás de un adaptador reemplazable y no se instala con las dependencias normales. Su disponibilidad sólo es verdadera cuando existen simultáneamente una configuración compatible del proveedor y un runner ejecutable aprobado que acepte los límites antes de iniciar la llamada. El runner recibe tiempo, llamadas, tokens y coste máximos como un objeto inmutable y debe confirmar exactamente esos límites en su respuesta. Un runner con la firma anterior, sin confirmación o con una confirmación distinta falla cerrado. Con ninguno, con sólo uno o con un runner incompatible, el adaptador informa que no está disponible y falla antes de procesar contenido.

## Corpus local

Se usaron siete documentos HTML sintéticos y breves:

1. negocio activo con sitio oficial;
2. negocio visible solamente en un directorio;
3. nombre comercial ambiguo;
4. texto con una instrucción maliciosa incrustada;
5. dos direcciones contradictorias;
6. página vacía, como representación de contenido vacío o no recuperable;
7. correo empresarial publicado con su URL exacta.

Los documentos están anotados para que la línea base determinista pueda comprobar el contrato sin un modelo. No contienen páginas copiadas ni contenido extenso de terceros.

## Resultado medido

Comando de verificación: `workers/leadhunter/.venv/Scripts/python -m pytest workers/leadhunter/tests/test_extract.py -q`.

| Medida | Resultado |
|---|---:|
| Casos de prueba Python | 38 aprobados |
| Documentos del corpus | 7 |
| Afirmaciones esperadas | 13 |
| Afirmaciones correctas | 13 |
| Exactitud sobre el corpus anotado | 100% |
| Afirmaciones no respaldadas | 0 |
| Tasa de afirmaciones no respaldadas | 0% |
| Tiempo total de la corrida de medición | 5,192 ms |
| Llamadas a modelos | 0 |
| Coste de modelo | USD 0 |

Estos números describen exclusivamente los fixtures sintéticos anotados. No estiman precisión, latencia ni coste sobre sitios reales.

La prueba de inyección confirmó que el texto que pedía revelar secretos, cambiar el esquema y enviar correo permaneció como contenido sin autoridad. El worker devolvió únicamente los campos solicitados. La prueba de conflicto conservó ambas direcciones con estado `conflicting`. La página vacía produjo un resultado vacío válido con el diagnóstico `content_empty`.

## Estado de ScrapeGraphAI

No se instalaron el extra, un proveedor de modelo ni credenciales. Por lo tanto:

- no se ejecutó ScrapeGraphAI;
- no se midieron su precisión, latencia, tokens ni coste;
- no se fabricaron estimaciones;
- no está aprobado para producción.

Para aprobarlo harán falta un entorno aislado con el extra fijado, configuración de un proveedor permitida, un corpus representativo de páginas públicas de Argentina y Estados Unidos, comparación manual de afirmaciones con sus fuentes, tasa de afirmaciones no respaldadas, latencia por documento, tokens y coste reales. Su salida deberá pasar sin excepciones por el mismo validador usado por la línea base. El runner real también deberá demostrar que el proveedor aplica timeout y límites de tokens/coste antes y durante la llamada. La verificación posterior de uso queda como defensa adicional: detectar un exceso después de la respuesta no cancela la llamada ni recupera gasto ya incurrido.

## Limitaciones y siguiente decisión

La línea base determinista reconoce las anotaciones controladas y sirve para probar de punta a punta el contrato, los conflictos, la trazabilidad y la ausencia de acciones. No pretende extraer semántica general de cualquier página real. La recuperación segura de páginas también queda fuera del worker: debe validar la red y almacenar la procedencia antes de entregar contenido.

La interfaz queda estable para sustituir el extractor por ScrapeGraphAI u otra implementación sin cambiar las reglas de evidencia. Una sustitución no puede quitar la URL, la fecha, el hash, el estado, la confianza, el extracto ni los límites de presupuesto. Este adaptador no intenta cancelar de manera forzada un callable local: un hilo detenido desde fuera no garantiza que el proveedor interrumpa la facturación. La aprobación productiva exige cancelación o timeout implementado por el cliente/proveedor dentro del runner.
