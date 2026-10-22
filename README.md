# SICAE-IA

Sistema inteligente para la automatización y clasificación de correos electrónicos.
Clasifica cada correo en **legítimo**, **publicidad** o **phishing** y le asigna una prioridad (**alta**, **media** o **baja**).
Proyecto de grado de Ingeniería de Sistemas, Fundación Universitaria Los Libertadores.

## Estado del proyecto

En desarrollo — **Fase 1: datos y modelo**. La API y la extensión de Chrome están planificadas pero
todavía no implementadas.

El repositorio aún no contiene un modelo entrenado ni resultados evaluables, por lo que este README
no reporta ninguna métrica de desempeño. Se añadirán cuando el entrenamiento y la validación estén
hechos.

## Alcance

Definido por el equipo. No se modifica sin aprobación conjunta.

- **Prototipo en entorno controlado.** No es un producto listo para producción.
- **Nunca borra ni envía correos reales.** La limpieza y el envío son **simulados**: el sistema
  muestra qué haría, pero no ejecuta ninguna acción sobre el buzón.
- **Datos:** SpaPhish, SpearPhishMX y cuentas de prueba creadas por el equipo.
- **Modelo:** clasificación phishing vs. legítimo, entrenado con SpaPhish y SpearPhishMX (correos
  en español).
- **Publicidad y spam:** se detectan por reglas, no por el modelo — cabecera `List-Unsubscribe` y
  señales de envío masivo.
- **Salida al usuario:** una de tres categorías (legítimo, publicidad, phishing) y una prioridad
  (alta, media, baja).

## Stack

| Módulo | Tecnologías |
|---|---|
| `ml/` | Python 3.13, scikit-learn, pandas |
| `api/` | FastAPI, Pydantic, SQLAlchemy, SQLite |
| `extension/` | Chrome Manifest V3, side panel, HTML/CSS/JS sin framework |

## Integrantes

- Julian Camilo Cárdenas Torres
- Juan Sebastián Vásquez Peña
- Stephanie Murillo Urrego
- Mateo Enrique Bermejo Ramírez

## Estructura del repositorio

```
sicae-ia/
├── ml/                       Modelo de machine learning
│   ├── src/                  Código del modelo
│   │   └── publicidad.py     Regla de publicidad (List-Unsubscribe, envío masivo)
│   ├── tests/                Pruebas del modelo
│   ├── data/
│   │   ├── raw/              Datasets originales          ← fuera de Git
│   │   └── processed/        Datasets limpios             ← fuera de Git
│   ├── models/               Modelos entrenados (.joblib) ← fuera de Git
│   └── requirements.txt
│
├── api/                      Backend: puente entre el modelo y la extensión
│   ├── src/
│   │   └── main.py           App FastAPI y endpoints
│   ├── tests/                Pruebas de los endpoints
│   └── requirements.txt
│
├── extension/                Extensión de Chrome (Manifest V3)
│   ├── manifest.json         Permisos y configuración
│   └── sidepanel/
│       └── panel.html        Interfaz del panel lateral
│
├── docs/
│   └── arquitectura.md       Documentación de arquitectura y decisiones
│
├── .github/workflows/
│   └── ci.yml                Integración continua (pruebas en cada push)
│
├── .env.example              Plantilla de variables de entorno
├── .gitignore
└── CLAUDE.md                 Guía del proyecto
```

Las rutas marcadas **fuera de Git** no se versionan: los datasets son pesados y pueden contener
datos personales, y los modelos se regeneran entrenando. Las carpetas sí existen al clonar, vacías.

## Cómo contribuir

### 1. Una rama por paso

Nunca se trabaja directamente sobre `main`. Cada paso de la guía va en su propia rama, con el
formato `feat/<fase>.<paso>-<tema>`:

```
feat/1.1-datasets
feat/1.2-preprocesamiento
feat/2.1-endpoints
```

```bash
git switch main
git pull
git switch -c feat/1.1-datasets
```

### 2. Commits en español

Mensaje corto que diga qué cambió, en español:

```bash
git commit -m "Agrega carga de SpaPhish y normalización de columnas"
```

Mejor varios commits pequeños y entendibles que uno gigante al final.

### 3. Pull request con revisión de otro integrante

```bash
git push -u origin feat/1.1-datasets
```

Después, en GitHub: *Compare & pull request*, describe qué hiciste y asigna como revisor a otro
integrante del equipo.

**Nadie aprueba ni mergea su propio pull request.** Son cuatro personas sobre el mismo código: la
revisión cruzada es lo que evita que algo se rompa sin que nadie se dé cuenta, y deja constancia en
el historial de quién revisó qué.

### Antes de abrir el pull request

- Las pruebas pasan (`pytest`).
- Ninguna clave ni token quedó en el código. Las credenciales van en `.env`, que está fuera de Git;
  si agregaste una variable nueva, añádela también a `.env.example`.
- Cada función nueva tiene al menos una prueba en el `tests/` de su módulo.
