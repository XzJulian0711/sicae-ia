# Arquitectura de SICAE-IA

<!--
  Documento de arquitectura del proyecto de grado.
  Secciones previstas (se llenan a medida que se construye el sistema):
-->

## 1. Vision general

<!-- Diagrama y descripcion de las tres piezas: extension -> API -> modelo ML. -->

## 2. Modulo ML (`ml/`)

<!-- Dataset usado (SpaPhish; ver metricas.md), preprocesamiento, algoritmo
     elegido y metricas obtenidas. -->

## 3. API (`api/`)

<!-- Endpoints, esquemas de entrada/salida, modelo de datos en SQLite. -->

## 4. Extension de Chrome (`extension/`)

<!-- Manifest V3, permisos solicitados y como el side panel obtiene el correo. -->

## 5. Clasificacion y prioridad

<!-- Como se combinan el modelo (phishing vs legitimo) y la regla de
     publicidad para llegar a las tres categorias finales, y como se
     asigna la prioridad. -->

La API (`api/app/main.py`, paso 2.1) expone `POST /analizar`, que llama a
`analizar_correo()` de `ml/sicae_ml/sistema.py`: modelo v1.0, luego regla de publicidad y
luego prioridad (detalle en `docs/metricas.md`, pasos 1.6 a 1.8). El modelo se carga una vez
al arrancar; `GET /salud` dice si está cargado.

## 6. Alcance y limitaciones

<!-- Prototipo en entorno controlado. Limpieza y envio SIMULADOS:
     nunca se borra ni se envia un correo real. -->

## 7. Decisiones tecnicas

<!-- Por que cada eleccion, para poder defenderla ante el jurado. -->
