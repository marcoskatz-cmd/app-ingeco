# Plantillas de WhatsApp Cloud API (categoría Utility, idioma es_AR)

Crear en Meta Business Manager → WhatsApp → Plantillas. Un parámetro de texto `{{1}}` en el cuerpo.
Los nombres tienen que coincidir con `WA_PLANTILLAS` en `backend/avisos.js`.

| Nombre | Cuerpo |
|---|---|
| `ingeco_stock_critico` | INGECO · Stock crítico: {{1}} Revisá la app INGECO para ver el detalle. |
| `ingeco_vencimiento_doc` | INGECO · Vencimiento: {{1}} Revisá la app INGECO para ver el detalle. |
| `ingeco_pedido_pendiente` | INGECO · Pedido: {{1}} Entrá a la app INGECO para verlo. |
| `ingeco_aviso_general` | INGECO · {{1}} Entrá a la app INGECO para ver el detalle. |

Requisitos: Meta Business verificado con CUIT de INGECO, número dedicado, token permanente de System User
(`WA_TOKEN`) y el Phone Number ID (`WA_PHONE_ID`). Celulares en formato `549…` (el backend normaliza).
Solo se usa para `prioridad = critica`.
