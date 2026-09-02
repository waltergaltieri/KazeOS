# Diseño del módulo de gastos y control financiero

## Objetivo

Ampliar KazeOS con un módulo de gastos que permita ver, por moneda y por período, cuánto se prevé cobrar y gastar, cuánto se cobró y gastó realmente, qué obligaciones están pendientes o vencidas y cómo se distribuyen los egresos por categoría, ámbito y tipo económico.

La implementación debe sentirse nativa, preservar los flujos actuales y evitar convertir la aplicación en un ERP o sistema contable.

## Alcance aprobado

La primera entrega incluye:

- gastos únicos y recurrentes;
- categorías administrables;
- clasificación independiente por categoría, ámbito, tipo fijo/variable y recurrencia;
- estados planificado, pendiente, pagado, vencido calculado y cancelado;
- vencimiento y fecha efectiva de pago separados;
- USD y ARS sin conversión ni suma entre monedas;
- generación automática e idempotente con horizonte de tres meses;
- listado, búsqueda, filtros, acciones rápidas y experiencia móvil;
- métricas, desgloses y próximos vencimientos en `/expenses`;
- resultado proyectado y real;
- integración acotada con Dashboard, navegación, creación rápida y Configuración;
- datos de demostración y pruebas de dominio, integración, componentes y navegador.

Quedan para una fase posterior porque el documento fuente los marca como opcionales, futuros o condicionales:

- calendario financiero;
- margen porcentual;
- frecuencia semanal;
- un nuevo módulo `/reports` (no existe actualmente);
- comprobantes, presupuestos, alertas, exportaciones e integraciones bancarias o contables.

No se mostrará un enlace a Reportes hasta que exista una pantalla útil.

## Enfoques evaluados

### Dominio separado con infraestructura compartida — elegido

Crear tablas y reglas propias de gastos, reutilizando las primitivas de dinero, fechas, recurrencia, autenticación, base de datos, formularios, tablas, filtros y estilos existentes. Es el camino más corto que conserva límites de dominio claros y reduce regresiones.

### Libro financiero genérico

Generalizar cobros y gastos como movimientos de entrada y salida produciría una arquitectura uniforme a largo plazo, pero exige migrar y revalidar el flujo de cobros ya estable. Se descarta para esta entrega por riesgo y plazo.

### Clonar Cobros y Servicios

Copiar las implementaciones actuales reduciría decisiones iniciales, pero duplicaría reglas sensibles de dinero, fechas, recurrencia e idempotencia. Se descarta porque el ahorro inicial se convertiría rápidamente en divergencias y mantenimiento doble.

## Arquitectura

El módulo seguirá la organización existente por dominio:

- esquema y relaciones Drizzle en `src/db/schema`;
- validaciones Zod en `src/lib/validations`;
- lógica financiera pura en `src/lib/domain`;
- transacciones y generación en `src/lib/services`;
- consultas autenticadas en `src/lib/queries`;
- Server Actions en `src/lib/actions`;
- componentes por dominio en `src/components/expenses`;
- rutas App Router en `src/app/(app)/expenses`.

Los Server Components obtendrán datos en paralelo. Las mutaciones exigirán una sesión verificada, validarán la entrada, operarán dentro de `withAuthenticatedDb`, actualizarán todas las filas relacionadas de forma transaccional y revalidarán únicamente las rutas afectadas.

## Reutilización

Se reutilizarán sin duplicar:

- `Currency`, importes en centavos enteros, parseo y formato de dinero;
- fechas comerciales ISO y zona `America/Argentina/Buenos_Aires`;
- suma de períodos mensual, trimestral y anual;
- selector de moneda, campo monetario, selector accesible y calendario compacto;
- seguridad por `ownerId`, políticas RLS y columnas de auditoría;
- estructura de consultas autenticadas y agregados SQL;
- patrones de formulario, diálogo, badges, filtros, tabla y tarjetas móviles;
- menú lateral, menú de creación rápida y selector de moneda del Dashboard;
- proceso protegido que actualmente mantiene el horizonte de cobros recurrentes.

La recurrencia se refactorizará de manera aditiva: se extraerá un constructor genérico de períodos y se conservará `buildChargePeriods` como adaptador compatible. Cobros debe seguir produciendo exactamente las mismas fechas y claves de período antes y después del cambio.

## Modelo de datos

### `expense_categories`

- `id` UUID;
- `ownerId` UUID obligatorio;
- `name` no vacío y único por propietario sin distinguir mayúsculas;
- `icon` nullable;
- `active` boolean, true por defecto;
- timestamps de auditoría.

Las categorías utilizadas no se eliminan. Se desactivan, continúan visibles en registros históricos y dejan de ofrecerse para nuevos gastos.

### `recurring_expenses`

- `id`, `ownerId`;
- `title`, `description` nullable;
- `amountMinor`, `currency`;
- `categoryId`, `scope`, `costType`;
- `frequency`: monthly, quarterly o yearly;
- `billingDay` entre 1 y 31;
- `startDate`, `endDate` nullable;
- `status`: active, paused o cancelled;
- `paymentMethod`, `vendor`, `notes` nullable;
- `automaticGeneration`;
- timestamps.

### `expenses`

- `id`, `ownerId`;
- `title`, `description` nullable;
- `amountMinor`, `currency`;
- `categoryId`, `scope`, `costType`;
- `recurringExpenseId` y `periodKey` nullable;
- `dueDate` obligatorio;
- `paidDate` nullable;
- `status`: planned, pending, paid o cancelled;
- `paymentMethod`, `vendor`, `notes` nullable;
- `generatedAutomatically`;
- timestamps.

No se crea una tabla `expense_payments`: el alcance no contempla pagos parciales de gastos. Una ocurrencia conserva directamente el importe final y los datos de su pago.

### Integridad

- Restricción única parcial por `(recurringExpenseId, periodKey)`.
- Checks de importes positivos y enteros seguros.
- Coherencia entre recurrencia, generación automática y clave de período.
- Coherencia entre estado pagado y fecha de pago.
- Claves compuestas con `ownerId` para impedir relaciones entre propietarios.
- Eliminación restringida para categorías y recurrencias con historia.
- Índices por propietario y fecha, estado/fecha, categoría, ámbito, moneda y recurrencia.
- RLS autenticada en las tres tablas.

`dueDate` será obligatorio en el MVP. Aunque la propuesta inicial lo marca nullable, el flujo aprobado siempre pide una fecha y las métricas, filtros, estados y recurrencia dependen de ella.

## Estados

Los estados persistidos son:

- `planned`: intención o estimación todavía no confirmada;
- `pending`: obligación confirmada aún no pagada;
- `paid`: pago registrado con fecha efectiva;
- `cancelled`: gasto que no debe entrar en totales.

`overdue` será derivado cuando `dueDate < today`, el gasto no esté pagado y no esté cancelado. Un planificado también puede quedar vencido si nunca se confirmó o canceló. La fecha no cambia automáticamente un registro de planificado a pendiente.

## Recurrencia e idempotencia

Una recurrencia activa con generación automática produce ocurrencias dentro de `[hoy, hoy + 3 meses)`. El día 29, 30 o 31 se ajusta al último día de los meses cortos sin perder el ancla original.

Las nuevas ocurrencias se crean como `pending`, porque una recurrencia activa representa un compromiso confirmado. La restricción única y `onConflictDoNothing` hacen segura la ejecución repetida.

Al editar una recurrencia:

- las ocurrencias pagadas e históricas no cambian;
- sólo se actualizan ocurrencias automáticas futuras, impagas y no canceladas;
- se cancelan las proyecciones futuras que dejan de corresponder;
- se generan las nuevas ocurrencias faltantes;
- pausar o cancelar detiene nuevas generaciones.

El proceso automático actual se ampliará para ejecutar generadores de cobros y gastos en la misma invocación protegida. Se conserva la ruta existente para evitar cambios operativos y se mantiene compatibilidad en su respuesta.

## Definiciones financieras

Para un período `[inicio, fin)`:

- ingreso proyectado: importe total de cobros con vencimiento en el período y no cancelados;
- ingreso real: pagos con fecha efectiva dentro del período;
- gasto proyectado: importe total de gastos con vencimiento en el período y no cancelados;
- gasto real: gastos pagados con `paidDate` dentro del período;
- resultado proyectado: ingreso proyectado menos gasto proyectado;
- resultado real: ingreso real menos gasto real.

Planificados, pendientes y pagados forman parte de la proyección de su período de vencimiento. Un gasto pagado fuera del mes de vencimiento pertenece a la proyección del mes original y a la realidad del mes en que fue pagado.

Los cálculos devuelven un mapa independiente por moneda. Los agregados se ejecutan en SQL y se transportan como cadenas enteras para no perder precisión. Los helpers puros componen y restan esos mapas; la UI nunca suma importes financieros.

## Pantalla `/expenses`

La página usa el período y la moneda seleccionados en la URL. Presenta:

1. encabezado y acción `Nuevo gasto`;
2. selector de moneda USD/ARS;
3. métricas de gastado, pendiente, vencido, proyectado, fijo y variable;
4. resultados proyectado y real;
5. búsqueda y filtros por estado, período, categoría, ámbito, tipo, recurrencia y moneda;
6. tabla operativa con acciones y alternativa de tarjetas en móvil;
7. desgloses por categoría, ámbito y fijo/variable;
8. próximos gastos, con vencidos primero y luego orden cronológico.

Las métricas del período siguen las definiciones financieras. El indicador de vencidos de la pantalla responde al período filtrado; el Dashboard conserva una señal acumulada de obligaciones vencidas.

## Creación y edición

El formulario pide inicialmente sólo:

- título;
- monto;
- moneda;
- categoría;
- ámbito;
- tipo fijo o variable;
- vencimiento.

Descripción, estado, proveedor, método y notas quedan en información adicional. El estado inicial es `pending` salvo que el usuario elija `planned` o registre el gasto como pagado.

El toggle de recurrencia revela frecuencia, día, inicio, fin y generación automática. Guardar crea la plantilla y las primeras ocurrencias en una transacción. Editar un gasto pagado usa una corrección controlada; no expone una edición financiera libre.

Acciones de la lista:

- marcar como pagado con importe, fecha predeterminada a hoy y método;
- editar;
- duplicar como gasto manual nuevo;
- cancelar;
- eliminar sólo registros manuales planificados o pendientes.

## Categorías

Configuración incorporará una sección de categorías con creación, cambio de nombre/icono y activación/desactivación. El seed agregará las dieciséis categorías iniciales y los cinco ejemplos indicados, de forma idempotente.

## Dashboard

El Dashboard mantiene el selector de moneda y su jerarquía actual:

- conserva Cobrado, Pendiente, Vencido y MRR;
- agrega Gastos del mes y Balance proyectado;
- conserva los conteos operativos;
- incorpora gastos a la cronología de próximos movimientos;
- reemplaza la visualización secundaria de ingresos por `Ingresos vs gastos — este mes`;
- enlaza gastos y balance con `/expenses` para ampliar el detalle.

No se duplican en el Dashboard los desgloses por categoría, ámbito o tipo; pertenecen al módulo Gastos.

## Errores y operaciones destructivas

- Errores de validación se muestran junto al campo y conservan la entrada.
- Fallos de servidor usan mensajes seguros y no exponen secretos.
- Operaciones financieras y generación se ejecutan en transacciones.
- Duplicados de período se omiten y se informan en el resultado del generador.
- Referencias inexistentes o de otro propietario se tratan como no encontradas.
- Cancelación, desactivación y eliminación requieren confirmación.
- Una categoría desactivada sigue mostrándose en históricos y formularios de edición existentes.

## Estrategia de pruebas

### Dominio

- estados planificado, pendiente, vencido, pagado y cancelado;
- generación mensual, trimestral y anual;
- meses cortos y fin de recurrencia;
- idempotencia y horizonte;
- totales y desgloses por moneda, categoría, ámbito y tipo;
- escenario de balance USD 2.000/1.400/800/500 = 1.200 proyectado y 900 real.

### Esquema e integración

- tablas, constraints, índices, claves compuestas y RLS;
- CRUD autenticado;
- edición de recurrencias sin tocar historia;
- consultas agregadas sin N+1;
- categorías desactivadas con referencias históricas;
- generación conjunta de cobros y gastos.

### Componentes y navegador

- formulario simple y recurrente;
- filtros persistentes en URL;
- tabla y tarjetas móviles;
- marcar como pagado y corregirlo;
- administración de categorías;
- flujo completo y actualización de métricas/Dashboard.

### Regresión

Antes de terminar deben pasar todas las pruebas actuales y los recorridos de login, clientes, servicios, cobros, pagos, tareas, notas, Dashboard y Configuración, además de TypeScript, lint, tests y build de producción.

## Criterio de aceptación

La entrega está completa cuando una sesión autenticada puede crear, clasificar, consultar, filtrar, pagar, cancelar y duplicar gastos; crear y mantener recurrencias idempotentes; administrar categorías; comprender proyección y realidad por moneda; ver los resultados en Gastos y Dashboard; y completar el flujo en escritorio y móvil sin regresiones ni datos funcionales hardcodeados.
