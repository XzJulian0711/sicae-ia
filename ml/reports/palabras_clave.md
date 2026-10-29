# Palabras clave del modelo seleccionado (paso 1.5)

Generado por `ml/src/evaluate.py` desde los coeficientes del SVM lineal guardado.
Peso positivo empuja hacia phishing; negativo, hacia legítimo. Las columnas de correos
cuentan en cuántos correos de **entrenamiento** de cada clase aparece el término.
Un término fuerte que solo sale en una clase y en pocos correos puede ser un atajo.

## Hacia phishing

| # | Término | Peso | Correos phishing (de 580) | Correos legítimos (de 528) |
|---|---|---|---|---|
| 1 | aerolínea | 1,202 | 1 | 1 |
| 2 | paquete | 1,186 | 232 | 6 |
| 3 | cuenta | 1,027 | 159 | 107 |
| 4 | entrega | 1,017 | 229 | 25 |
| 5 | account | 0,888 | 13 | 2 |
| 6 | re | 0,869 | 28 | 35 |
| 7 | campus | 0,834 | 13 | 4 |
| 8 | documento | 0,823 | 13 | 35 |
| 9 | tarjeta | 0,819 | 32 | 13 |
| 10 | plazo | 0,816 | 36 | 7 |

## Hacia legítimo

| # | Término | Peso | Correos phishing (de 580) | Correos legítimos (de 528) |
|---|---|---|---|---|
| 1 | interjet | -1,234 | 0 | 2 |
| 2 | descarga | -1,141 | 0 | 19 |
| 3 | hola nombretoken | -1,104 | 12 | 81 |
| 4 | contraseña | -1,053 | 13 | 31 |
| 5 | cloud | -1,044 | 1 | 8 |
| 6 | plataforma | -0,980 | 3 | 28 |
| 7 | liga | -0,969 | 4 | 46 |
| 8 | verifica | -0,946 | 1 | 6 |
| 9 | saludos | -0,928 | 21 | 148 |
| 10 | soporte | -0,813 | 11 | 15 |

## Columnas numéricas

Pesos (tras log1p y escala a [0, 1]): `n_urls` -0,252, `n_adjuntos` -1,808, `long_cuerpo` -1,354.
