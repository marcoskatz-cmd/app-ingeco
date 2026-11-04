#!/usr/bin/env bash
# Setup de IngeBot (una vez). Requiere: clasp logueado, Vercel logueado (cuenta gestionpedidosingeco),
# y un archivo de claves con SETUP_K (clave del endpoint temporal en Code.js) y BOT_CLAVE (puente a Compras).
# Uso: bash scripts/setup_bot.sh /ruta/claves_bot.env
set -euo pipefail
source "$1"
EXEC="https://script.google.com/macros/s/AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0/exec"
DEPLOY_ID="AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0"
urlenc() { python -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

echo "1) Backend: push + deploy"
(cd backend && clasp push -f && clasp deploy -i "$DEPLOY_ID" -d "IngeBot 1.3.0")

echo "2) Properties del bot (via endpoint temporal setup_bot)"
for par in "COMPRAS_RPC_URL=https://compras.ingecosa.com.ar/api/rpc" "COMPRAS_BOT_CLAVE=$BOT_CLAVE" "BOT_CUPO_DIA=30"; do
  prop="${par%%=*}"; val="${par#*=}"
  curl -sL "$EXEC?accion=setup_bot&k=$SETUP_K&prop=$prop&v=$(urlenc "$val")"; echo
done

echo "3) migrarV3 (módulo BOT, permisos a ADMIN, columnas) + diagnóstico de planillas"
curl -sL "$EXEC?accion=setup_bot&k=$SETUP_K"; echo

echo "4) Pedidos de compra: env BOT_CLAVE en producción (misma clave) y push a main"
echo "   (cd ../ingeco-pedidos-vercel && printf '%s' \"\$BOT_CLAVE\" | vercel env add BOT_CLAVE production && git push origin main)"

echo "5) Borrar las líneas TEMPORAL-SETUP-BOT de backend/Code.js, push + deploy de nuevo."
