# SICAE-IA
Sistema inteligente para la automatización y clasificación de correos electrónicos.
Proyecto de grado, Ingeniería de Sistemas, Fundación Universitaria Los Libertadores.

## Alcance (no cambiar sin aprobación del equipo)
- Prototipo en entorno controlado. Datos: SpaPhish y cuentas de prueba.
- Nunca borrar de forma definitiva ni enviar correos. Mover a la papelera solo con confirmación explícita y opción de deshacer (paso 4.5). Probar solo con la cuenta de Gmail del proyecto.
- Modelo ML: phishing vs legitimo, entrenado solo con SpaPhish (español). CSV separado por comas, utf-8-sig.
- Publicidad/spam: regla por cabecera List-Unsubscribe y señales de envío masivo (ml/sicae_ml/publicidad.py).
- Categoría final al usuario: legitimo, publicidad, phishing. Prioridad: alta, media, baja.

## Stack
- ml/: Python 3.13, scikit-learn, pandas
- api/: FastAPI, Pydantic, SQLAlchemy, SQLite
- extension/: Chrome Manifest V3, side panel, HTML/CSS/JS sin framework

## Reglas para Claude
- Antes de editar archivos, ejecuta git branch --show-current. Si estás en main o en una rama ya unida, detente y avísame.
- Explica cada cambio en español y en pasos cortos; somos estudiantes aprendiendo.
- Un paso a la vez. Pide confirmación antes de crear más de 3 archivos.
- Nunca escribas claves ni tokens en el código: usa .env y actualiza .env.example.
- Cada función nueva lleva al menos una prueba en tests/.
- Estilo visual: el de la demo (Sora + DM Sans, azul = acción, naranja = alerta).