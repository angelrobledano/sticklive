# Despliegue de identidad por portal (PR #409) y oportunidades (PR #410).
# Requisito: los dos PR mergeados en main.
#
# Hace, en el servidor: backup de la BD -> deploy.sh (pull, build, migraciones
# 081-086, smoke, tag) -> comprobaciones en seco. No lanza ningún paso de datos
# con --write: eso se revisa después con el log.
#
# Uso, desde la carpeta del proyecto en PowerShell:
#   .\deploy-identidad.ps1

$ErrorActionPreference = 'Stop'
$log = "deploy-$(Get-Date -Format 'yyyy-MM-dd-HHmm').log"
ssh root@167.233.94.156 "cd /opt/sticklive && ./deploy/backup-db.sh && ./deploy/deploy.sh && bash deploy/post-deploy-identidad.sh" 2>&1 |
  Tee-Object -FilePath $log
Write-Host "`nLog guardado en $log"
