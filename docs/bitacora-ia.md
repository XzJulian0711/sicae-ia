# Bitácora de decisiones (trabajo con IA)

Registro de las decisiones del equipo que cambian las reglas del proyecto, en especial las de
la sección "Alcance" de [`CLAUDE.md`](../CLAUDE.md), que no se cambian sin aprobación del equipo.
Cada entrada dice la fecha, quién la aprobó, qué cambió y por qué.

---

## 2026-11-04 · Regla de borrado y envío de correos (paso 4.4)

- **Aprobada por:** el equipo completo.
- **Dónde:** `CLAUDE.md`, sección "Alcance (no cambiar sin aprobación del equipo)".
- **Regla anterior:**

  > Nunca borrar ni enviar correos reales. Limpieza y envío son SIMULADOS.

- **Regla nueva:**

  > Nunca borrar de forma definitiva ni enviar correos. Mover a la papelera solo con
  > confirmación explícita y opción de deshacer (paso 4.5). Probar solo con la cuenta de Gmail
  > del proyecto.

- **Por qué:**
  - Desde el paso 4.4 la extensión lee la bandeja con la API de Gmail.
  - El paso 4.5 propondrá liberar espacio moviendo publicidad a la papelera, que en Gmail se
    puede deshacer durante 30 días. Para eso la regla anterior, que lo hacía todo simulado,
    ya no alcanza.
  - Siguen prohibidos el borrado definitivo y el envío de correos.
- **Qué cambia en el paso 4.4:** nada se mueve ni se borra. El 4.4 es **solo lectura**: usa el
  alcance `gmail.readonly`, que no permite modificar, borrar ni enviar.
