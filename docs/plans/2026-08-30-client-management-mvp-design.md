# Diseño del MVP de gestión de clientes, cobros y tareas

## Objetivo

Construir una aplicación web interna que permita comprender en menos de diez segundos cuánto se cobró, cuánto queda pendiente, qué está vencido, qué se cobrará próximamente y qué tareas requieren atención.

El producto no es un CRM comercial ni un ERP. Su flujo central es:

`Clientes -> Servicios recurrentes -> Cobros -> Pagos -> Vencimientos -> Tareas`

La primera entrega se ejecutará localmente y utilizará un proyecto remoto real de Supabase para PostgreSQL y autenticación. GitHub y Vercel quedan fuera de esta etapa.

## Arquitectura

- Next.js 16 con App Router, React y TypeScript.
- Tailwind CSS, shadcn/ui y Lucide Icons para la interfaz.
- Supabase remoto para PostgreSQL y Supabase Auth.
- Drizzle ORM para esquema, relaciones y migraciones.
- Zod para validación compartida y React Hook Form cuando simplifique formularios interactivos.
- Server Components por defecto; Client Components solamente para formularios, diálogos, filtros y controles interactivos.
- Server Actions para mutaciones de la aplicación y Route Handlers para integraciones o el futuro endpoint de cron.
- Lógica financiera aislada de la presentación mediante servicios y helpers probados.

La aplicación se organizará por dominios: autenticación, clientes, servicios, cobros, pagos, tareas, notas, configuración y dashboard.

## Modelo de datos

### Entidades principales

- `profiles`: identidad y preferencias del administrador.
- `clients`: datos de contacto, empresa, estado y fecha de alta.
- `services`: servicios recurrentes o únicos asociados a clientes.
- `charges`: obligaciones de cobro con período, importe, moneda, vencimiento y saldo pagado.
- `payments`: pagos reales asociados a clientes y, normalmente, a un cobro.
- `tasks`: tareas simples, opcionalmente asociadas a clientes y con recurrencia básica.
- `client_notes`: historial cronológico de notas por cliente.
- `settings`: preferencias y datos básicos del negocio.

Todas las entidades utilizarán UUID, timestamps, claves foráneas e índices adecuados. Los datos financieros no se eliminarán mediante cascadas peligrosas: clientes se archivarán, servicios se desactivarán y cobros se cancelarán.

### Reglas financieras

- Un cobro representa dinero esperado; un pago representa dinero recibido.
- Un cobro admite varios pagos y conserva el historial completo.
- El saldo es `importe del cobro - suma de pagos válidos`.
- Los estados `pending`, `due_today`, `overdue`, `partial`, `paid` y `cancelled` se calcularán mediante una única función de dominio.
- El MRR incluirá solamente servicios recurrentes activos y se agrupará por moneda.
- USD y ARS nunca se sumarán ni convertirán automáticamente.
- Los servicios recurrentes mantendrán un horizonte de tres meses de cobros futuros.
- La generación será idempotente mediante una restricción única por servicio y período.
- Las fechas comerciales se tratarán en `America/Argentina/Buenos_Aires` para evitar desplazamientos por UTC.

## Experiencia de usuario

### Navegación

La aplicación tendrá sidebar fija en escritorio y drawer en móvil. Las secciones principales serán Dashboard, Clientes, Cobros, Tareas y Configuración. La barra superior contendrá contexto de usuario, tema y acciones rápidas.

### Dashboard

El dashboard priorizará la acción diaria:

- Cobrado este mes, pendiente, vencido y MRR, siempre separados por moneda.
- Clientes activos y cobros de los próximos siete días.
- Próximos cobros ordenados con vencidos primero y luego por fecha.
- Tareas pendientes ordenadas por urgencia.
- Cronología de próximos movimientos que combine cobros y tareas.
- Acción primaria para registrar un pago y menú para crear cliente, cobro o tarea.

Los gráficos serán secundarios y solamente se incluirán cuando aporten información útil.

### Clientes

El listado tendrá búsqueda, filtros y adaptación a móvil. La ficha de cliente será el centro de su historial, con pestañas Resumen, Cobros, Servicios, Tareas y Notas. Las acciones creadas desde la ficha precargarán el cliente.

### Cobros y pagos

La pantalla de cobros ofrecerá filtros por estado, fecha, cliente, moneda y servicio. Registrar un pago desde un cobro precargará cliente, cobro, saldo y fecha para completar la operación en menos de quince segundos.

### Tareas y notas

Las tareas serán una lista simple con estado, fecha, prioridad y cliente, sin Kanban. Las notas se mostrarán como una cronología inversa y admitirán creación, edición y eliminación confirmada.

## Dirección visual

La interfaz será sobria, precisa y tranquila, inspirada conceptualmente en Linear, Stripe y Vercel, sin copiarlos.

- Mundo visual: azul tinta, blanco papel, violeta para acciones, verde para cobros, ámbar para proximidad y rojo para deuda.
- Profundidad: bordes suaves y elevación discreta, evitando sombras dramáticas.
- Tipografía: legible, con jerarquía clara y números tabulares para importes.
- Espaciado: generoso en dashboard y más compacto en tablas operativas.
- Firma: la cronología combinada de cobros y tareas, presente como agenda operativa del negocio.
- Referencia: el dashboard adjunto orienta composición, densidad y jerarquía, no una copia literal.

Habrá modos claro, oscuro y sistema. Todos los controles tendrán estados hover, focus, disabled, loading y error. Las tablas se convertirán en tarjetas o usarán desplazamiento controlado en pantallas pequeñas.

## Flujo de datos

1. Un Server Component obtiene datos mediante consultas reutilizables.
2. El usuario interactúa con un formulario o diálogo cliente.
3. Una Server Action valida la entrada con Zod y verifica la sesión.
4. La capa de dominio aplica reglas financieras o de recurrencia.
5. Drizzle ejecuta la transacción contra Supabase PostgreSQL.
6. Se revalida la vista afectada y se muestra confirmación o error.

Operaciones como registrar pagos y generar cobros se ejecutarán dentro de transacciones para evitar estados parciales.

## Estados y errores

- Skeletons para cargas relevantes.
- Estados vacíos con explicación y acción contextual.
- Mensajes no destructivos mediante toasts.
- Confirmaciones para archivar, cancelar o eliminar.
- Errores de servidor registrados sin exponer secretos al cliente.
- Páginas y límites de error donde corresponda.
- Variables sensibles únicamente en archivos de entorno no versionados.

## Estrategia de pruebas

Las pruebas unitarias protegerán:

- cálculo del estado de cobro;
- cálculo del saldo;
- MRR agrupado por moneda;
- generación idempotente de cobros recurrentes;
- recurrencia básica de tareas;
- comportamiento de fechas comerciales.

Las pruebas de integración cubrirán el flujo crítico:

1. iniciar sesión;
2. crear cliente;
3. crear servicio recurrente;
4. generar y visualizar el cobro;
5. registrar un pago parcial y luego completar el saldo;
6. verificar métricas del dashboard;
7. crear y completar una tarea;
8. consultar historial, pagos y notas del cliente.

Antes de considerar la entrega terminada deberán pasar TypeScript, lint, tests y build de producción. La aplicación final no utilizará mocks ni datos hardcodeados como fuente funcional.

## Fuera de alcance inicial

No se implementarán integraciones automáticas de pago, facturación fiscal, WhatsApp, emails, notificaciones push, leads, pipeline comercial, presupuestos, contratos, gestión avanzada de proyectos, tickets, inventario, contabilidad, IA, aplicación móvil nativa, multiempresa, equipos o permisos complejos.

## Criterio de aceptación

El MVP estará completo cuando una sesión autenticada pueda ejecutar y persistir el flujo cliente -> servicio -> cobro -> pago -> métricas, además de gestionar tareas y notas, con funcionamiento correcto en escritorio y móvil y con todas las verificaciones técnicas aprobadas.
