# Errores del modelo en el conjunto de prueba (paso 1.5)

Generado por `ml/src/evaluate.py` con `svm_lineal` (`ml/models/clasificador.joblib`).

- **Falsos negativos** (phishing clasificado como legítimo): 4
- **Falsos positivos** (legítimo clasificado como phishing): 6

El texto es el que ve el modelo: ya limpio (urltoken, emailtoken, nombretoken, sin HTML).
**Puntaje**: salida de `decision_function`. Mayor que 0 empuja hacia phishing; cerca de 0
significa que el modelo dudó. Cada tabla va del error más seguro al más dudoso.

## Falsos negativos (phishing que pasó como legítimo)

| # | Asunto (limpio) | Primeros 200 caracteres del texto limpio | Puntaje |
|---|---|---|---|
| 1 | recibo de su compra reciente | recibo de su compra reciente se adjuntan los recibos de su compra reciente. ¡gracias por su compra! se adjuntan los recibos de su compra reciente. ¡gracias por su compra! | -0,284 |
| 2 | 👾mdr en acción: protege tu empresa con seguridad 24/7 | 👾mdr en acción: protege tu empresa con seguridad 24/7 texto descriptivo la seguridad no se trata solo de prevenir ataques, sino de detectarlos y responder en el menor tiempo posible. en este evento ex | -0,151 |
| 3 | s⁪u ⁪c­u⁪ent­a d⁪e ⁪a⁭m⁪a⁭z­o⁫n឴ ⁪ha ­si⁪do b⁭l⁪o⁬q­u⁬eada­. ⁫i⁪d⁪ ⁫:⁭ 9qpnp-f9utof | s⁪u ⁪c­u⁪ent­a d⁪e ⁪a⁭m⁪a⁭z­o⁫n឴ ⁪ha ­si⁪do b⁭l⁪o⁬q­u⁬eada­. ⁫i⁪d⁪ ⁫:⁭ 9qpnp-f9utof ó ó ͏͏͏͏y0pmgr cl͏͏͏͏y0pmgrie͏͏͏͏y0pmgrnte, ͏͏͏͏y0pmgr ͏͏͏͏y0pmgr ͏͏͏͏y0pmgrá͏͏͏͏y0pmgr͏͏͏͏y0pmgr ͏͏͏͏y0pmgr ͏͏͏͏y0p | -0,095 |
| 4 | andros, informe de riesgo disponible en tu cuenta | andros, informe de riesgo disponible en tu cuenta informe de riesgo informe de riesgo en tu cuenta. tu cuenta sr/sra. mendoza nos hemos dado cuenta de que ha pasado mucho tiempo desde que usaste nuest | -0,080 |

## Falsos positivos (legítimo marcado como phishing)

| # | Asunto (limpio) | Primeros 200 caracteres del texto limpio | Puntaje |
|---|---|---|---|
| 1 | notificación del reparto del paquete shein | notificación del reparto del paquete shein mercado chic estimado cliente, su pedido mchqwe99990yykk con número de seguimiento 9024567789012, ha salido a reparto. por favor, asegúrese de tener el teléf | 1,158 |
| 2 | notificación de entrega shein | notificación de entrega shein mercado chic estimado cliente, su pedido mchqwe99990yykk con número de seguimiento 9024567789012, ha sido entregado. en el caso de que no lo haya recibido, le sugerimos q | 0,935 |
| 3 | nuevo mensaje en el buzón tributario de buml821201am3 | nuevo mensaje en el buzón tributario de buml821201am3 tienes un mensaje en tu buzón fiscal. ingresa a hacienda.gob.mx, inicia sesión en tu buzón fiscal, elige mis registros, y selecciona mis notificac | 0,519 |
| 4 | 🥳 ¡feliz 6.o duoaniversario, ismaela1216! | 🥳 ¡feliz 6.o duoaniversario, ismaela1216! duolingo descubre cuánto has aprendido. ¡feliz 6.o duoaniversario, marianaribas87! tuviste un gran comienzo y aprendiste 54 palabras. ¡sigue progresando con u | 0,126 |
| 5 | verifica fácilmente con una “permiso de un solo uso para samsung account” | verifica fácilmente con una “permiso de un solo uso para samsung account” verifica fácilmente con una “permiso de un solo uso para samsung account” verifica fácilmente con una “permiso de un solo uso | 0,098 |
| 6 | misa unción de los enfermos | misa unción de los enfermos [image: whatsapp image 2022-11-30 at 2.39.52 pm (1).jpeg] | 0,041 |

## Patrones comunes

Los 10 errores se concentran en **temas que comparten las dos clases**: entregas de paquetes,
cuentas y seguridad. El modelo decide por el vocabulario del tema más que por señales de
fraude (remitente, enlaces que no coinciden), que no ve. 7 de los 10 tienen un puntaje entre
-0,3 y 0,3: el modelo dudó.

- **Falsos positivos de entregas (#1 y #2, Shein).** Son los errores más seguros (1,16 y 0,94).
  "paquete", "entrega" y "estimado cliente" son de los términos con más peso hacia phishing,
  porque las campañas de paquete falso dominan esa clase (225 correos de phishing con
  "paquete" en entrenamiento frente a 4 legítimos). Una notificación de entrega real se
  parece demasiado a la falsa.
- **Llamados a iniciar sesión (#3 FP, buzón tributario).** "Ingresa" e "inicia sesión" son la
  llamada a la acción típica del phishing, aunque aquí venga de una entidad real.
- **Falsos negativos por señales de formato de SpaPhish (#1 y #2 FN).**
  - El "recibo de su compra" (#1 FN) trae un adjunto. En entrenamiento, el 38 % de los
    legítimos tiene adjuntos y solo el 3 % de los phishing, así que `n_adjuntos` pesa -1,67
    hacia legítimo.
  - El correo de "MDR en acción" (#2 FN) tiene URLs escritas en el texto. "urltoken" aparece en
    el 51 % de los legítimos y en el 11 % de los phishing (en el phishing de SpaPhish los
    enlaces casi nunca están en el texto plano), y es el término con más peso hacia legítimo
    (-1,94).
  - Las dos son características del formato del dataset, no del fraude.
- **Nombre fuera de la lista de anonimización (#4 FN).** "andros, informe de riesgo
  disponible en tu cuenta" usa un tema de cuenta genérico y nombres ("andros", "mendoza") que
  no están en `NOMBRES_ANONIMIZADOS`.
- **Evasión con caracteres invisibles (#3 FN, Amazon).** El asunto "s⁪u ⁪c­u⁪ent­a ... bloqueada"
  mete caracteres invisibles (U+00AD, U+034F, U+206A–U+206F, U+17B4) que la limpieza del paso
  1.3 no quita. Las palabras quedan partidas y el modelo no reconoce "cuenta bloqueada".
  Hay 24 correos de phishing y 3 legítimos con estos caracteres.
- **Correos legítimos de marketing o muy cortos (#4–#6 FP).** Duolingo, la verificación de
  Samsung ("account" pesa hacia phishing) y un aviso de misa con casi solo una imagen. Quedaron
  justo encima de la frontera (puntaje < 0,13).
