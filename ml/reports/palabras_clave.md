# Palabras clave del modelo seleccionado (paso 1.5)

Generado por `ml/src/evaluate.py` desde los coeficientes del SVM lineal guardado.
Peso positivo empuja hacia phishing; negativo, hacia legítimo. Las columnas de correos
cuentan en cuántos correos de **entrenamiento** de cada clase aparece el término.
Un término fuerte que solo sale en una clase y en pocos correos puede ser un atajo.

## Hacia phishing

| # | Término | Peso | Correos phishing (de 581) | Correos legítimos (de 528) |
|---|---|---|---|---|
| 1 | paquete | 1,201 | 225 | 4 |
| 2 | account | 1,152 | 7 | 1 |
| 3 | cliente | 1,028 | 76 | 23 |
| 4 | ricardo lópez | 0,918 | 39 | 14 |
| 5 | entrega | 0,909 | 219 | 21 |
| 6 | plazo | 0,871 | 38 | 7 |
| 7 | 10 marzo | 0,871 | 1 | 1 |
| 8 | satélite | 0,871 | 1 | 1 |
| 9 | universidad | 0,865 | 28 | 30 |
| 10 | haga clic | 0,855 | 105 | 10 |

## Hacia legítimo

| # | Término | Peso | Correos phishing (de 581) | Correos legítimos (de 528) |
|---|---|---|---|---|
| 1 | urltoken | -1,936 | 68 | 267 |
| 2 | genovevo | -1,202 | 4 | 13 |
| 3 | saludos | -1,117 | 22 | 141 |
| 4 | cloud | -1,006 | 1 | 8 |
| 5 | puerto | -0,972 | 0 | 12 |
| 6 | día | -0,938 | 32 | 147 |
| 7 | puedes | -0,927 | 42 | 98 |
| 8 | descarga | -0,908 | 0 | 18 |
| 9 | invitación | -0,886 | 0 | 40 |
| 10 | sábado 18 | -0,881 | 0 | 2 |

## Columnas numéricas

Pesos (tras log1p y escala a [0, 1]): `n_urls` -0,137, `n_adjuntos` -1,665, `long_cuerpo` -1,246.
