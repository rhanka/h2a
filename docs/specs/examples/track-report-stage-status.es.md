<!-- Synthetic contextual report; language=es. Human semantic acceptance pending. -->
<!-- Historical references track-report-contextual.md and track-report-raw.txt are unchanged. -->
**2026-10-11T12:00:00.000Z → 2026-10-18T12:00:00.000Z** · c-new · 2/15 (13%)
coverage: 14 → 12 · outside-wp: 7

## HECHO

| alcance | avance | últimos resultados |
| --- | --- | --- |
| global | 2/15 (13%) | La entrega registrada permite reanudar en el entorno referenciado; la referencia de despliegue y la prueba en c-new respaldan el resultado. |
| WP2 · UAT Beta | 2/3 (67%) | La entrega registrada permite reanudar en el entorno referenciado; la referencia de despliegue y la prueba en c-new respaldan el resultado. |

## POR HACER

| WP | av. | etapa | estado | por hacer | bloqueo | próxima acción |
| --- | --- | --- | --- | --- | --- | --- |
| fuera de WP; vinculación pendiente | n/a | [1.1] — | [1.1] — | [1.1] Preparar la decisión sobre el modo sin conexión (outside-wp; fuera de WP; vinculación pendiente) | opciones no registradas | Registrar las opciones conservar/descartar el punto sin conexión y sus consecuencias. |
| WP1 · UAT Alpha | 0% | [2.1] dev<br>[2.2] spec<br>[2.3] dev<br>[2.4] dev<br>[2.5] dev<br>[2.6] spec | [2.1] — no calificado<br>[2.2] — retirado<br>[2.3] 🔴 bloqueado<br>[2.4] 🔵 decisión pendiente<br>[2.5] — no calificado<br>[2.6] — retirado | [2.1] Reanudar una sesión interrumpida<br>[2.2] Retiro anterior con dependencia activa — motivo no registrado<br>[2.3] Restablecer la ejecución de reanudación<br>[2.4] Elegir si se comparte la conexión<br>[2.5] Reanudar tras una reconexión<br>[2.6] Retiro: alcance ya cubierto por el trabajo anterior | D1 · dependencia | Repetir la comprobación de reanudación tras reiniciar la ejecución dependiente y guardar su resultado. |
| WP2 · UAT Beta | 67% | [3.1] dev | [3.1] — no calificado | [3.1] Verificar la reanudación sin pérdidas | — | Definir el caso « interrumpir y reanudar sin perder el último mensaje » y registrar su resultado. |
| WP1.1 · UAT Alpha.1 | 0% | [4.1] dev | [4.1] — no calificado | [4.1] Reanudar tras una reconexión | — | Ejecutar la reconexión con el mismo identificador de sesión y comparar el último mensaje. |
| WP3 · phase only | 0% | [5.1] spec | [5.1] — no calificado | [5.1] Definir el resultado de la fase (outside-wp; fuera de WP; vinculación pendiente) | spec | Escribir el resultado esperado de esta fase al reanudar después de una interrupción. |
| S1 · stream only | 0% | [6.1] spec | [6.1] — no calificado | [6.1] Definir el resultado del flujo (outside-wp; fuera de WP; vinculación pendiente) | spec | Documentar qué punto de reanudación conserva este flujo antes de vincularlo a un WP. |
| fuera de WP; vinculación pendiente | n/a | [7.1] spec<br>[7.2] spec<br>[7.3] spec<br>[7.4] spec<br>[7.5] spec | [7.1] — no calificado<br>[7.2] — no calificado<br>[7.3] — no calificado<br>[7.4] — no calificado<br>[7.5] — no calificado | [7.1] Preparar el requisito anterior (outside-wp; fuera de WP; vinculación pendiente)<br>[7.2] Preparar el requisito de ejecución (outside-wp; fuera de WP; vinculación pendiente)<br>[7.3] Vincular la reanudación aislada a su WP (outside-wp; fuera de WP; vinculación pendiente)<br>[7.4] Conservar el punto de reanudación (outside-wp; fuera de WP; vinculación pendiente)<br>« Quiero reanudar mi sesión sin perder el último mensaje » (demand-raw)<br>[7.5] Restaurar la sesión (outside-wp; fuera de WP; vinculación pendiente)<br>« Quiero reanudar mi sesión sin perder el último mensaje » (demand-raw) | — | Comprobar los dos requisitos y proponer el WP de las solicitudes aisladas. |

## DECISIONES

| # | pregunta | alternativas | recomendación |
| --- | --- | --- | --- |
| D1 | ¿Compartir la conexión utilizada al reanudar una sesión? | A Compartir — una conexión<br>B Aislar — dos conexiones | A<br> |

[D1](https://example.test/dossier/share)

## RECOMENDACIÓN

Sin respuesta: verificar el último mensaje y la reconexión, y preparar las solicitudes aisladas. El retiro anterior mantiene su dependencia; falta el motivo.

Repetir la comprobación de reanudación tras reiniciar la ejecución dependiente y guardar su resultado.

D1 A comparte una conexión y libera la elección de reanudación; D1 B aísla las conexiones y exige mantener dos. Se recomienda A para reducir conexiones.

Responde « vas y » para el trabajo sin decisión o « D1 A » para autorizar la conexión compartida.


```text
track report --period last-week --now 2026-10-18T12:00:00.000Z --commit c-new --expect-events 55 --expect-head sha256:44f138a8a9445eeda256bb853c8528124c8887cf350f16bd9f6d1688c65cb7f6 --resolve <handle>
1.1	01M57000000000000000000092
2.1	01M57000000000000000000007
2.2	01M57000000000000000000019
2.3	01M57000000000000000000041
2.4	01M57000000000000000000049
2.5	01M57000000000000000000029
2.6	01M57000000000000000000079
3.1	01M57000000000000000000057
4.1	01M57000000000000000000029
5.1	01M57000000000000000000064
6.1	01M57000000000000000000068
7.1	01M57000000000000000000022
7.2	01M57000000000000000000044
7.3	01M57000000000000000000060
7.4	01M57000000000000000000073
7.5	01M57000000000000000000074
D1	01M57000000000000000000052
Q1	01M57000000000000000000092
```
