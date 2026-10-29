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
| Mayúsculas y espacios repetidos | minúsculas, un espacio | — | "URGENTE" y "urgente" son la misma palabra |

### Qué se dejó y por qué

| Qué | Por qué |
|---|---|
| Marcas (FedEx, Apple, iCloud, Netflix, Prime, Estafeta…) | Son contenido real: el phishing suplanta marcas. Quitarlas borraría una señal legítima |
| La frase "escriba a" | Es texto real del pie de baja de suscripción. Se borra solo la dirección que la sigue |
| Números, signos y emojis en `texto` | Pueden ser señal ("!!", "📦", montos). Se deciden al vectorizar (paso 1.4) |
| Palabras vacías en español e inglés | `STOPWORDS_ES` y `STOPWORDS_EN` se aplican al vectorizar, no aquí, para que `texto` sea legible |
| `n_urls`, `n_adjuntos` y `long_cuerpo` | Señales medidas en la exploración. `long_cuerpo` usa el cuerpo original para no cambiar al limpiar |

### Grupo para dividir los datos

`grupo` es el asunto normalizado: limpio, sin números, signos ni emojis, y sin prefijos como
"RE:" o "RV:". Así, "Pablito!! Tienes un (1) paquete" y "Miguelina!! Tienes un (2) paquete"
quedan juntos. Resultado: **999 grupos** para 1.385 correos; 134 grupos tienen más de un correo
y el mayor tiene 47 ("última alerta todas tus fotos serán borradas"). En el paso 1.4 la división
entrenamiento/prueba se hará por grupo, para que una misma campaña no quede en ambos lados.
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
