# Métricas de SICAE-IA

## Dataset

El modelo phishing vs. legítimo se entrena solo con **SpaPhish**, un corpus de correos en español.

| Dato | Valor |
|---|---|
| Fuente | [Mendeley Data — SpaPhish](https://data.mendeley.com/datasets/hz2d6gz7pc/5) |
| Licencia | CC BY 4.0 |
| Idioma | Español |
| Correos originales | 1.395 (731 phishing, 664 legítimos) |
| Quitados por no tener asunto | 3 |
| Quitados por cuerpo de menos de 30 caracteres | 7 |
| **Correos finales** | **1.385 (725 phishing, 660 legítimos)** |

La carga, verificación y depuración están en [`ml/src/load_data.py`](../ml/src/load_data.py).
Para reproducirlas, ver *Cómo obtener los datos* en el [README](../README.md#cómo-obtener-los-datos).

### Por qué se descartó SpearPhishMX

SpearPhishMX se evaluó como segundo dataset y se descartó por tres razones. Primero, su etiqueta 0
significa "no dirigido" y no "legítimo", así que no encaja con nuestra clasificación phishing vs.
legítimo. Segundo, comparte el 42 % de los asuntos con SpaPhish, pero con etiquetas contradictorias,
lo que le enseñaría al modelo respuestas opuestas para el mismo correo. Tercero, su anonimización
deja marcadores en el texto que el modelo aprendería como señal, en lugar de aprender del contenido
real del correo.

> *Nota: Cifras obtenidas comparando ambos CSV: asuntos normalizados en común (1.276 de 3.006) y
> tabla cruzada de etiquetas entre los mensajes coincidentes. El análisis se puede repetir con un
> script si el jurado lo solicita.*

## Exploración (paso 1.2)

Cifras obtenidas con [`ml/notebooks/01_exploracion.ipynb`](../ml/notebooks/01_exploracion.ipynb)
sobre los 1.385 correos finales. Las gráficas están en [`ml/reports/`](../ml/reports/).

| Medida | Legítimo | Phishing |
|---|---|---|
| Correos | 660 (47,7 %) | 725 (52,3 %) |
| Longitud del cuerpo, promedio (caracteres) | 1.769 | 697 |
| Longitud del cuerpo, mediana (caracteres) | 1.115 | 539 |
| Enlaces (`n_urls`), promedio | 8,47 | 4,95 |
| Enlaces (`n_urls`), mediana | 3 | 4 |
| Correos con al menos un enlace | 74,9 % | 96,3 % |
| Adjuntos (`n_adjuntos`), promedio | 0,72 | 0,03 |
| Correos con al menos un adjunto | 37,6 % | 2,8 % |

- **Clases balanceadas:** no hace falta rebalancear; basta con dividir de forma estratificada.
- **El phishing es más corto:** la longitud del cuerpo puede servir como señal.
- **Enlaces y adjuntos:** casi todo el phishing trae al menos un enlace, pero los legítimos traen
  más enlaces en promedio y casi todos los adjuntos. Son señales útiles, pero no sirve la regla
  simple "muchos enlaces = phishing".
- **Palabras más frecuentes** (asunto + cuerpo, sin URLs ni palabras vacías en español):
  - Phishing: paquete, entrega, suscripción, recibir, cuenta, icloud, pago, información, correo,
    clic. Urgencia y suplantación de marcas.
  - Legítimo: correo, información, datos, electrónico, cuenta, saludos, privacidad, personales,
    aviso, gracias. Trámites, instituciones y avisos de privacidad.

### Hallazgos para el preprocesamiento

1. **Nombres que el modelo aprendería como atajo.** "pablito" aparece en 169 correos de phishing
   (asunto o cuerpo) y en ninguno legítimo: es el nombre del destinatario, no una señal de phishing.
   Pasa algo parecido del lado legítimo con "puebla" y "ricardo".
2. **Campañas repetidas.** 210 asuntos de phishing están repetidos (misma plantilla). Si copias
   de una campaña quedan en entrenamiento y en prueba, la evaluación saldrá inflada: conviene
   agrupar por asunto al dividir.
3. **El phishing imita a la publicidad.** "darse de baja" aparece en el cuerpo de 187 correos de
   phishing y de 7 legítimos. La regla de publicidad debe apoyarse en la cabecera
   `List-Unsubscribe` y no solo en el texto.
4. **Texto en inglés.** "the" está entre las 20 palabras más frecuentes de ambas clases y "and"
   entre las de legítimo; la lista de palabras vacías en español no las filtra.

## Preprocesamiento (paso 1.3)

[`ml/src/preprocess.py`](../ml/src/preprocess.py) lee `correos.csv` y guarda
`ml/data/processed/correos_limpios.csv` con las columnas `texto` (asunto + cuerpo limpios con
`limpiar_texto()` de [`ml/src/texto.py`](../ml/src/texto.py)), `n_urls`, `n_adjuntos`,
`long_cuerpo` (del cuerpo original), `etiqueta` y `grupo`. La columna `date` no se usa.

### Qué se reemplazó o borró y por qué

Conteo de una ejecución sobre los 1.385 correos. Los nombres, lugares y organizaciones se buscan
como palabra completa: "salas" se cambia, pero "ensaladas" no.

**Regla:** un dato anonimizado se cambia por un token solo si el token queda en las dos clases.
Si quedaría en una sola, se borra, porque un token exclusivo de una clase sigue siendo un atajo.

| Qué | Acción | Veces | Por qué |
|---|---|---|---|
| Etiquetas y comentarios HTML (`<p>`, `<td>`, `<!-- -->`…) y entidades (`&aacute;`, `&nbsp;`) | se quitan | 842 etiquetas | Son formato, no contenido. Solo se quitan etiquetas HTML reales: `<<Cancelar>>` es el texto de un botón y se conserva |
| URLs (`http://`, `https://`, `www.`) | `urltoken` | 1.583 | Cada URL es casi única; importa que haya un enlace, no cuál |
| Correos electrónicos | `emailtoken` | 890 | Igual que las URLs; además se llevan nombres de personas |
| Nombres de la anonimización: pablito (172), ezequiela (84), miguelina (83), guadalupe (58), robles (54), missxtranger (52), salas (43), jiménez (42), garcía/garcia (41), vargas (39), pancracio (34), durán/duran (34), martínez/martinez (46) | `nombretoken` | 782 | Cada nombre estaba en una sola clase. El token queda en ambas: 333 correos de phishing y 184 legítimos |
| Direcciones ficticias de los pies de página ("escriba a: 128 Willow Crest Rd Ste 402#5912, Northwood, VT, 05744", "Or write to: …", "correo electrónico à: …", "escribiendo a …") | se borra la dirección; se conserva "escriba a:" | 149 | Solo aparecen en phishing (120 correos). Antes dejaban "ste" en 105 correos de phishing y 0 legítimos; ahora en 0 |
| Lugares: hidalgo (33), ciudad central (17) | se borran | 50 | Sin las direcciones, `lugartoken` quedaba en 35 legítimos y 0 de phishing. "northwood" solo estaba dentro de direcciones |
| Organizaciones (`ORGS_ANONIMIZADAS`): myown (127), cietec (81), estelar (81), sni (29) | se borran | 318 | Solo en legítimos: myown en 52 correos, cietec en 24, sni en 22 y estelar en 21, ninguna en phishing. Un `orgtoken` quedaría en una sola clase |
| Letras decoradas de Unicode ("𝐇𝐞𝐦𝐨𝐬", "𝑭𝑨𝑪𝑻𝑼𝑹𝑨𝑺") | se normalizan con NFKC ("hemos", "facturas") | 23 correos de phishing, 0 legítimos | Ver "Normalización Unicode (NFKC)" abajo |
| Mayúsculas y espacios repetidos | minúsculas, un espacio | — | "URGENTE" y "urgente" son la misma palabra |

### Qué se dejó y por qué

| Qué | Por qué |
|---|---|
| Marcas (FedEx, Apple, iCloud, Netflix, Prime, Estafeta…) | Son contenido real: el phishing suplanta marcas. Quitarlas borraría una señal legítima |
| La frase "escriba a" | Es texto real del pie de baja de suscripción. Se borra solo la dirección que la sigue |
| Números, signos y emojis en `texto` | Pueden ser señal ("!!", "📦", montos). Se deciden al vectorizar (paso 1.4) |
| Palabras vacías en español e inglés | `STOPWORDS_ES` y `STOPWORDS_EN` se aplican al vectorizar, no aquí, para que `texto` sea legible |
| `n_urls`, `n_adjuntos` y `long_cuerpo` | Señales medidas en la exploración. `long_cuerpo` usa el cuerpo original para no cambiar al limpiar |

### Normalización Unicode (NFKC)

Algunos correos de phishing escriben el asunto o el cuerpo con letras "decoradas" de Unicode
(negrita o cursiva matemática): "𝐇𝐞𝐦𝐨𝐬 𝐢𝐧𝐭𝐞𝐧𝐭𝐚𝐝𝐨 𝐩𝐨𝐧𝐞𝐫𝐧𝐨𝐬 𝐞𝐧 𝐜𝐨𝐧𝐭𝐚𝐜𝐭𝐨". A la vista se lee
normal, pero para la computadora son otros caracteres: es un truco para esquivar filtros.
Aparecen en 23 correos de phishing y en ninguno legítimo. Sin tratarlas causaban dos problemas:

1. **Grupos vacíos.** `normalizar_asunto` solo conserva letras normales, así que 7 asuntos de
   phishing quedaban sin ninguna letra; el CSV los guardaba como nulos y la división por grupos
   del paso 1.4 fallaba.
2. **Palabras duplicadas.** El TF-IDF trataría "𝐞𝐧" y "en" como palabras distintas.

`limpiar_texto()` aplica `unicodedata.normalize("NFKC", …)` justo después de decodificar el HTML:
"𝐇𝐞𝐦𝐨𝐬" pasa a "Hemos". NFKC también modifica 117 correos legítimos (espacios especiales,
símbolos como "º"), cambios sin efecto en los conteos de reemplazos de la tabla anterior. Como
respaldo, si un asunto no conserva ninguna letra (por ejemplo, solo emojis), su grupo es
`"(sin letras)"` en vez de quedar vacío.

### Grupo para dividir los datos

`grupo` es el asunto normalizado: limpio, sin números, signos ni emojis, y sin prefijos como
"RE:" o "RV:". Así, "Pablito!! Tienes un (1) paquete" y "Miguelina!! Tienes un (2) paquete"
quedan juntos. Resultado: **1.001 grupos** para 1.385 correos; 134 grupos tienen más de un correo
y el mayor tiene 47 ("última alerta todas tus fotos serán borradas"). Con NFKC, las versiones
decoradas de "hemos intentado ponernos en contacto con usted, ¡responda!" quedan en el mismo
grupo que las escritas normal (9 correos). La división entrenamiento/prueba del paso 1.4 se hace
por grupo, para que una misma campaña no quede en ambos lados.
Tres grupos mezclan etiquetas ("factura", "validar datos", "tenemos un voucher para ti"): son
asuntos genéricos, no campañas.

### Limitaciones

- **Sesgo institucional de los legítimos.** Muchos correos legítimos de SpaPhish vienen de
  universidades, centros de investigación y entidades públicas (muchos con dominios `.mx`). Palabras
  como ciencia, investigadores, tesis, maestría, convocatoria y nacional aparecen en 20 o más
  correos legítimos y en 2 o menos de phishing.
  El modelo puede aprender "tono académico o institucional = legítimo" y fallar con correos
  legítimos de otro tipo (personales, de comercios, de bancos reales). Esto no se corrige
  limpiando texto; hay que medirlo con las cuentas de prueba del equipo.
- **Falsos positivos de "salas".** "salas" está en la lista de nombres, pero también es un
  sustantivo. De sus 43 reemplazos, 2 no eran un apellido: "ingreso a salas específicas" y
  "realización de salas separadas". Ahí `nombretoken` reemplaza una palabra normal. El efecto es
  pequeño (2 de 1.385 correos), pero muestra que la lista no distingue el contexto.
- **Nombres, lugares y organizaciones que siguen en una sola clase.** Después de limpiar, estas
  palabras aparecen en 20 o más correos legítimos y en 2 o menos de phishing:

  | Palabra | Phishing | Legítimo | Tipo | Contexto |
  |---|---|---|---|---|
  | flores | 1 | 46 | Persona (apellido) | "Ricardo [nombretoken] Flores" |
  | luna | 1 | 37 | Persona (apellido) | "Roberto G. Luna", "Fernando Ramos Luna" |
  | sol | 1 | 28 | Lugar | "Villa del Sol", "Banco del Sol", "Cerrada del Sol" |
  | santa | 2 | 27 | Lugar | "Santa María", "Santa Rosa" |
  | alcaldía | 1 | 22 | Lugar (dirección) | "Alcaldía Coyoacán", "Alcaldía Central" |

  Se dejan a propósito: las cinco también son palabras normales (luna, sol, flores, santa,
  alcaldía) y borrarlas tendría el mismo problema que "salas". En cambio, "cietec", "estelar" y
  "sni" no tienen otro uso en el dataset y se agregaron a `ORGS_ANONIMIZADAS`.
- **Lista hecha a mano.** Los nombres y lugares salieron del análisis de palabras exclusivas de
  una clase (20 o más correos en una y 2 o menos en la otra). Puede haber otros por debajo de ese
  umbral, como "982 Willow Park Ave" (1 correo de phishing), una dirección que no va después de
  dos puntos.

## Entrenamiento (paso 1.4)

[`ml/src/train.py`](../ml/src/train.py) entrena con `correos_limpios.csv`. Resultados completos en
[`ml/reports/resultados_cv.json`](../ml/reports/resultados_cv.json) y
[`ml/reports/resultados_prueba.json`](../ml/reports/resultados_prueba.json). El modelo se guarda
en `ml/models/clasificador.joblib` (fuera de Git; se regenera ejecutando `train.py`).

### Características

[`ml/src/features.py`](../ml/src/features.py) construye un `ColumnTransformer`:

| Entrada | Transformación | Por qué |
|---|---|---|
| `texto` | TF-IDF de palabras y pares de palabras (`ngram_range=(1, 2)`), `min_df=2`, `sublinear_tf=True`, sin `STOPWORDS_ES` ni `STOPWORDS_EN` | Los pares capturan frases típicas ("paquete detenido"); `min_df=2` ignora palabras de un solo correo; `sublinear_tf` evita que una palabra repetida pese de más |
| `n_urls`, `n_adjuntos`, `long_cuerpo` | `log1p` y `MinMaxScaler(clip=True)` a [0, 1] | `long_cuerpo` va de 30 a 28.630 caracteres: sin logaritmo, unos pocos correos larguísimos aplastarían a los demás. `clip` evita valores negativos, que Naive Bayes no acepta |

### División entrenamiento / prueba

Prueba = primer pliegue de `StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)` por
`grupo`. Un `assert` comprueba que ningún grupo está en los dos conjuntos.

| Conjunto | Correos | Phishing | Legítimo | Grupos |
|---|---|---|---|---|
| Entrenamiento | 1.109 (80 %) | 581 | 528 | 803 |
| Prueba | 276 (20 %) | 144 | 132 | 198 |

### Validación cruzada (solo entrenamiento)

`GridSearchCV` con `StratifiedGroupKFold` de 5 pliegues por grupo; los hiperparámetros se eligen
por F1 macro. Media ± desviación estándar entre pliegues; precisión, recall y F1 de la clase
phishing.

| Modelo | Hiperparámetro elegido | Accuracy | Precisión phishing | Recall phishing | F1 phishing | F1 macro |
|---|---|---|---|---|---|---|
| Naive Bayes (`MultinomialNB`) | alpha = 0,5 (de 0,1 / 0,5 / 1) | 0,905 ± 0,021 | 0,984 ± 0,010 | 0,833 ± 0,045 | 0,901 ± 0,025 | 0,905 ± 0,021 |
| Regresión logística (`class_weight="balanced"`) | C = 100 (de 0,1 / 1 / 10 / 30 / 100) | 0,950 ± 0,011 | 0,970 ± 0,007 | 0,933 ± 0,021 | 0,951 ± 0,012 | 0,950 ± 0,011 |
| **SVM lineal** (`LinearSVC`, `class_weight="balanced"`) | **C = 30** (de 0,1 / 1 / 10 / 30 / 100) | **0,952 ± 0,010** | 0,975 ± 0,006 | 0,933 ± 0,020 | **0,953 ± 0,010** | **0,952 ± 0,010** |

**Regla de selección:** mayor F1 macro medio en validación cruzada; si empatan, mayor recall de
phishing. Gana el **SVM lineal con C = 30**. Naive Bayes es el más preciso cuando marca phishing
(0,984), pero deja pasar casi 1 de cada 6 (recall 0,833).

### Resultado en prueba (solo el modelo elegido)

| Métrica | SVM lineal, C = 30 |
|---|---|
| Accuracy | 0,964 |
| Precisión phishing | 0,959 |
| Recall phishing | 0,972 |
| F1 phishing | 0,966 |
| F1 macro | 0,964 |

Matriz de confusión (276 correos):

| Real (filas) / Predicho (columnas) | Legítimo | Phishing |
|---|---|---|
| **Legítimo** (132) | 126 | 6 |
| **Phishing** (144) | 4 | 140 |

- 4 correos de phishing pasaron como legítimos (falsos negativos).
- 6 correos legítimos se marcaron como phishing (falsos positivos).

El resultado en prueba (F1 macro 0,964) es algo mayor que el de validación cruzada (0,952), pero
está dentro de la variación esperable para un solo corte de 276 correos.

### Nota: ampliación de la rejilla de C

En una primera ejecución la rejilla de C era [0,1 / 1 / 10]. Tanto la regresión logística como
el SVM eligieron C = 10, el valor del borde: el óptimo podía estar más arriba. Se amplió a
[0,1 / 1 / 10 / 30 / 100] y se volvió a entrenar. La selección siguió haciéndose **solo con
validación cruzada**.

| | Primera ejecución (C hasta 10) | Rejilla ampliada (C hasta 100) |
|---|---|---|
| Regresión logística | C = 10; F1 macro CV 0,945 ± 0,014 | C = 100; F1 macro CV 0,950 ± 0,011 |
| SVM lineal | C = 10; F1 macro CV 0,950 ± 0,009 | C = 30; F1 macro CV 0,952 ± 0,010 |
| Modelo elegido | SVM lineal | SVM lineal (sin cambio) |
| Resultado en prueba | F1 macro 0,964; matriz [[126, 6], [4, 140]] | Idéntico: F1 macro 0,964; matriz [[126, 6], [4, 140]] |

Transparencia: el conjunto de prueba ya se había evaluado una vez con la rejilla anterior. La
nueva selección no usó la prueba, pero esa prueba ya no es un dato totalmente "virgen"; por eso
se registran los dos resultados. En la regresión logística C = 100 vuelve a quedar en el borde.
No se amplió otra vez porque no cambia el modelo elegido (sigue por debajo del SVM).
