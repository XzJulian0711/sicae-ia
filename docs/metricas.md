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
