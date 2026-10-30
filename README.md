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
- **Datos:** SpaPhish y cuentas de prueba creadas por el equipo.
- **Modelo:** clasificación phishing vs. legítimo, entrenado solo con SpaPhish (correos en
  español). SpearPhishMX se descartó; las razones están en [docs/metricas.md](docs/metricas.md).
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
│   │   ├── load_data.py      Carga y depuración de SpaPhish
│   │   ├── publicidad.py     Regla de publicidad (List-Unsubscribe, envío masivo)
│   │   └── priority.py       Regla de prioridad (alta, media, baja)
│   ├── config/
│   │   └── prioridad.json    Reglas de prioridad: remitentes, palabras, umbrales
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
│   ├── arquitectura.md       Documentación de arquitectura y decisiones
│   └── metricas.md           Dataset usado y métricas del modelo
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

## Cómo obtener los datos

Los datos no están en Git, así que cada integrante los descarga una vez:

1. Descarga SpaPhish de Mendeley Data: <https://data.mendeley.com/datasets/hz2d6gz7pc/5>
2. Copia estos tres archivos a `ml/data/raw/spaphish/`:
   - `Spaphish dataset - DiB.csv`
   - `README.txt`
   - `dataset_schema.json`
3. Instala las dependencias del módulo ML:

   ```bash
   pip install -r ml/requirements.txt
   ```

4. Ejecuta la carga y depuración desde la raíz del proyecto:

   ```bash
   python ml/src/load_data.py
   ```

   El script verifica los conteos, quita las filas inválidas y guarda
   `ml/data/processed/correos.csv`. Las cifras de cada paso están en
   [docs/metricas.md](docs/metricas.md).

## Configurar la prioridad

La prioridad (alta, media o baja) de los correos legítimos sale de las reglas de
`ml/config/prioridad.json`. En Git ese archivo va con las listas de remitentes y dominios
**vacías**, y así debe quedarse.

Para usar tus remitentes reales, crea una **copia local** que Git ignora:

```bash
cp ml/config/prioridad.json ml/config/prioridad.local.json
```

En Windows con PowerShell, el comando es `Copy-Item ml/config/prioridad.json ml/config/prioridad.local.json`.

Después llena las listas en `prioridad.local.json`:
- **Si existe, se usa en lugar de `prioridad.json`.** Lo reemplaza completo; no se mezclan, así
  que debe tener todas las claves.
- **Está en `.gitignore`**, así que tus direcciones nunca se suben. Puedes comprobarlo con
  `git check-ignore -v ml/config/prioridad.local.json`.
- **Para volver a la configuración del repositorio,** borra o renombra el archivo local.

> **No pongas direcciones reales en `prioridad.json`**, solo en el archivo local.

Ejemplo comentado. El JSON real **no admite comentarios**: quítalos al copiarlo.

```jsonc
{
  // +2 si el correo viene de una de estas direcciones exactas
  "remitentes_importantes": ["coordinacion@universidad.edu.co", "jefa@example.com"],
  // +2 si viene de este dominio o de un subdominio (mail.universidad.edu.co también cuenta)
  "dominios_importantes": ["universidad.edu.co"],
  // +1 si aparece alguna como palabra completa, sin importar tildes ni mayúsculas
  "palabras_urgencia": ["vence", "fecha limite", "plazo", "urgente", "hoy", "manana", "recordatorio"],
  // Puntos de cada regla. destinatario_unico: un solo destinatario en To, sin Cc ni List-Id.
  // respuesta: el correo tiene In-Reply-To (contesta a otro correo)
  "puntos": {"remitente_importante": 2, "urgencia": 1, "destinatario_unico": 1, "respuesta": 1},
  // puntaje >= 3 -> alta; >= 1 -> media; 0 -> baja
  "umbrales": {"alta": 3, "media": 1}
}
```

Las reglas y por qué son reglas y no un modelo están en
[docs/metricas.md](docs/metricas.md), sección "Prioridad (paso 1.6)".

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
