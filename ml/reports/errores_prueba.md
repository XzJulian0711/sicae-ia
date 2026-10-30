# Errores del modelo en el conjunto de prueba (paso 1.5)

Generado por `ml/sicae_ml/evaluate.py` con `svm_lineal` (`ml/models/clasificador.joblib`).

- **Falsos negativos** (phishing clasificado como legítimo): 9
- **Falsos positivos** (legítimo clasificado como phishing): 4

El texto es el que ve el modelo: ya limpio (urltoken, emailtoken, nombretoken, sin HTML).
**Puntaje**: salida de `decision_function`. Mayor que 0 empuja hacia phishing; cerca de 0
significa que el modelo dudó. Cada tabla va del error más seguro al más dudoso.

## Falsos negativos (phishing que pasó como legítimo)

| # | Asunto (limpio) | Primeros 200 caracteres del texto limpio | Puntaje |
|---|---|---|---|
| 1 | rv: product-tef4017(rqf) | rv: product-tef4017(rqf) buenos dias, me gustaría invitar a su empresa a proporcionarnos los productos adjuntos. algunos de los productos que podemos solicitar pueden estar fuera de su alcance de trab | -0,715 |
| 2 | fwd: muchos saludos | fwd: muchos saludos no suele recibir correos electrónicos de emailtoken . por qué esto es importante se le invita a conocer nuestro aviso de privacidad en el siguiente enlace. la información contenida | -0,419 |
| 3 | 👾mdr en acción: protege tu empresa con seguridad numtoken | 👾mdr en acción: protege tu empresa con seguridad numtoken texto descriptivo la seguridad no se trata solo de prevenir ataques, sino de detectarlos y responder en el menor tiempo posible. en este event | -0,243 |
| 4 | fw: buenas tardes emailtoken notificacion de infracciones numtoken. | fw: buenas tardes emailtoken notificacion de infracciones numtoken. ese día ni manejé ----- mensaje reenviado ----- de: numtoken - secretaria vial - numtoken < emailtoken >para: " emailtoken " < email | -0,233 |
| 5 | error en la reunión programada | error en la reunión programada [logo de zoon.] hola, emailtoken : hemos encontrado un problema con su reunión. revise sus configuraciones a continuación: revisar la configuración revise su configuraci | -0,164 |
| 6 | acción requerida | acción requerida i personally believe digital copywriter will secure your financial future as a writer ... but i don’t want you to take my word for it. >> go here for a numtoken-day test drive ( ). fo | -0,056 |
| 7 | ¡gracias por usar nuestros servicios bancarios! | ¡gracias por usar nuestros servicios bancarios! su documento ha sido completado revisar documento banco bbva emailtoken todas las partes han completado el documento. gracias por usar nuestros servicio | -0,043 |
| 8 | error en la reunión programada | error en la reunión programada hola, emailtoken : hemos encontrado un problema con su reunión. revise sus configuraciones a continuación: revisar la configuración revise su configuración para ingresar | -0,015 |
| 9 | error en la reunión programada | error en la reunión programada hola, emailtoken : hemos encontrado un problema con su reunión. revise sus configuraciones a continuación: revisar la configuración revise su configuración para ingresar | -0,012 |

## Falsos positivos (legítimo marcado como phishing)

| # | Asunto (limpio) | Primeros 200 caracteres del texto limpio | Puntaje |
|---|---|---|---|
| 1 | documentos amparo | documentos amparo buen día, les pedimos por favor que revisen su bandeja de spam, ya que nos reportan que algunos correos se están marcando así, por el envío masivo que estamos realizando para la docu | 0,219 |
| 2 | dale la bienvenida a tu premio: suscripción gratis a spotify premium - numtoken meses | dale la bienvenida a tu premio: suscripción gratis a spotify premium - numtoken meses disfrútalo ahora. gracias por completar la oferta “busca con orion en navegador atlas por numtoken días” ahora dis | 0,144 |
| 3 | ¿buscas nuevas oportunidades laborales? | ¿buscas nuevas oportunidades laborales? no te pierdas ni una sola oferta de trabajo dinos qué ofertas de trabajo te interesan, te costará sólo un minuto ¿estás buscando trabajo? no pierdas tu oportuni | 0,125 |
| 4 | protocolo de actuación con perspectiva de género | protocolo de actuación con perspectiva de género compartimos con la comunidad del en archivo anexo de pdf el *protocolo de actuación con perspectiva de género en sede administrativa en la investigació | 0,064 |

## Patrones comunes

Hay 13 errores: 9 falsos negativos y 4 falsos positivos. 11 de los 13 tienen un puntaje
entre -0,3 y 0,3: el modelo dudó. Ya no aparecen errores por nombres, por "urltoken" ni por
caracteres invisibles.

- **Phishing dentro de un reenvío (#1, #2 y #4 FN).** Asuntos con "rv:", "fwd:" o "fw:" y
  cabeceras de reenvío ("mensaje reenviado", "de:", "para:"). Esa forma es típica de los
  correos legítimos entre personas, y el phishing que la imita pasa como legítimo.
- **Suplantación de plataformas con poco texto (#5, #8 y #9 FN).** Son tres correos de la
  misma campaña ("error en la reunión programada", logo de "Zoon"). Quedan justo debajo de la
  frontera (puntajes entre -0,16 y -0,01): sin URL en el texto, solo queda un aviso corto y
  neutro. También #7, un supuesto documento completado de un banco.
- **Phishing con tono de evento o de marketing (#3 y #6 FN).** La invitación a un evento de
  seguridad ("MDR en acción") y un texto en inglés de venta de cursos usan el vocabulario de
  los boletines legítimos.
- **Legítimos con vocabulario de oferta o de premio (#2 y #3 FP).** "Premio", "gratis",
  "oferta" y "oportunidades" pesan hacia phishing, aunque aquí sean de servicios reales.
- **Legítimos con avisos de envío masivo o adjuntos (#1 y #4 FP).** Un aviso que pide revisar
  la carpeta de spam y un protocolo "en archivo anexo" quedaron apenas encima de la frontera
  (puntaje < 0,22).
