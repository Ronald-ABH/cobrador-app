# Cobrador App

Aplicación web (funciona como app instalada en el celular) para gestionar
clientes, préstamos, cuotas, rutas de cobro y reportes. Pensada para
prestamistas independientes, cobradiarios y pagadiarios.

## Qué incluye

- Login con usuario y contraseña.
- Clientes, con rutas/zonas de cobro.
- Préstamos con tres tipos de interés (fijo, sobre saldo, capitalizado) y
  frecuencia diaria, semanal, quincenal o mensual. Genera la tabla de cuotas
  automáticamente.
- Registro de pagos (incluye pagos parciales), detección de mora.
- Agenda del día: qué cuotas cobrar hoy, filtrable por ruta.
- Reportes: cartera, mora, recaudo diario, ganancia proyectada.
- Copia de seguridad automática **todos los días por correo** (usando
  [Resend](https://resend.com)), con la base de datos completa adjunta (y
  también en un archivo de texto legible).
- Instalable en el celular como una app (PWA): ícono en la pantalla de
  inicio, pantalla completa, sin barra del navegador.
- Los datos se guardan en un archivo de base de datos (SQLite) que vive en
  disco: no se pierden al reiniciar el servidor.

## 1. Antes de empezar

Vas a necesitar dos cosas gratuitas:

1. Una cuenta en **[Railway](https://railway.app)** (recomendado para que el
   servidor esté siempre activo, sin dormirse).
2. Una cuenta en **[Resend](https://resend.com)**, que es el servicio que se
   usa para *enviar* las copias de seguridad por correo. Se eligió Resend en
   vez de Gmail/SMTP porque Railway (y proveedores similares) bloquean las
   conexiones SMTP salientes en sus planes básicos; Resend envía el correo
   por HTTPS normal, así que no depende de puertos de correo que puedan estar
   bloqueados.

## 2. Obtener la clave de la API de Resend (para el backup)

1. Crea una cuenta gratis en [resend.com](https://resend.com) (el plan
   gratuito alcanza de sobra para un correo diario).
2. Ve a **API Keys → Create API Key** y copia la clave que te muestra
   (empieza con `re_`). La vas a necesitar en el paso 4.
3. Por defecto, el backup se envía desde `onboarding@resend.dev` (un remitente
   de prueba que ya viene habilitado, sin configuración extra). Si más
   adelante quieres que el correo llegue desde tu propio dominio, en Resend
   puedes verificar un dominio y luego poner esa dirección en la variable de
   entorno `RESEND_FROM` (paso 4).

## 3. Subir el proyecto a GitHub

Railway despliega desde un repositorio de GitHub.

1. Crea una cuenta en [github.com](https://github.com) si no tienes.
2. Crea un repositorio nuevo (puede ser privado), por ejemplo
   `cobrador-app`.
3. Sube esta carpeta completa a ese repositorio (puedes arrastrar los
   archivos desde la web de GitHub, o usar Git si sabes usarlo).

## 4. Desplegar en Railway

1. Entra a [railway.app](https://railway.app) e inicia sesión con GitHub.
2. **New Project → Deploy from GitHub repo** → selecciona `cobrador-app`.
3. Railway va a detectar que es un proyecto Node.js y lo va a construir
   automáticamente (usa el archivo `package.json`).
4. Entra a la pestaña **Variables** del servicio y agrega estas variables de
   entorno (usa tus propios valores, no copies los de ejemplo):

   | Variable | Valor |
   |---|---|
   | `JWT_SECRET` | una frase larga y única que inventes |
   | `ADMIN_USERNAME` | el usuario con el que vas a entrar (ej. `papa`) |
   | `ADMIN_PASSWORD` | la contraseña inicial (cámbiala luego desde Ajustes) |
   | `RESEND_API_KEY` | la clave `re_...` del paso 2 |
   | `BACKUP_EMAIL_TO` | `ronaldbarrios31peluqueria@gmail.com` |
   | `DATA_DIR` | `/data` |

   Opcional: `RESEND_FROM` si verificaste tu propio dominio en Resend (si no
   la configuras, se usa el remitente de prueba `onboarding@resend.dev`).

   `PORT` no hace falta configurarlo, Railway lo asigna solo.

5. **Muy importante — para que los datos nunca se borren:** en la pestaña
   del servicio, ve a **Volumes → New Volume**, y móntalo en la ruta
   `/data`. Esto crea un disco permanente que sobrevive aunque el servidor se
   reinicie o vuelvas a desplegar el proyecto. Sin este paso, los datos
   podrían borrarse la próxima vez que actualices el código.
6. Railway te da una URL pública (algo como
   `https://cobrador-app-production.up.railway.app`). Esa es la dirección de
   tu app, tanto para entrar desde el computador como desde el celular.
7. Para que el servidor **no se duerma nunca**, usa un plan de pago de
   Railway (el plan "Hobby", desde unos $5 USD al mes, mantiene el servicio
   activo 24/7). Los planes gratuitos de la mayoría de proveedores duermen el
   servidor tras un rato sin uso — no hay forma de evitar esto sin un plan
   pago o un servidor propio.

   Como capa extra de seguridad (opcional, no imprescindible si ya pagas el
   plan), puedes crear una cuenta gratis en
   [UptimeRobot](https://uptimerobot.com) y configurar un monitor que visite
   `https://TU-URL/api/sistema/ping` cada 5 minutos. Así, si algún día el
   plan cambia, esto ayuda a mantener el servidor despierto.

## 5. Instalar la app en el celular

1. Abre la URL de tu app en el navegador del celular (Chrome en Android,
   Safari en iPhone).
2. **Android (Chrome):** toca el menú (⋮) → "Añadir a pantalla de inicio" /
   "Instalar app".
3. **iPhone (Safari):** toca el botón de compartir (□↑) → "Añadir a
   pantalla de inicio".
4. Va a aparecer un ícono como cualquier otra app. Al abrirla, no se ve la
   barra del navegador — se siente como una app normal.

## 6. Primer ingreso

1. Entra con el `ADMIN_USERNAME` y `ADMIN_PASSWORD` que configuraste en el
   paso 4.
2. Ve a **Ajustes → Cambiar contraseña** y ponle una contraseña que solo tú
   conozcas.
3. Ve a **Ajustes → Enviar copia de seguridad ahora** para confirmar que el
   correo de backup está funcionando.

## 7. Uso diario

- Cada noche a las 11:59 pm (hora del servidor) se envía automáticamente un
  correo a `ronaldbarrios31peluqueria@gmail.com` con la base de datos
  completa adjunta. Puedes cambiar la hora con la variable de entorno
  `BACKUP_CRON` (formato cron; por defecto `59 23 * * *`).
- Si algún día necesitas recuperar los datos desde una copia de seguridad,
  guarda el archivo adjunto `cobrador-backup-FECHA.db` y contáctame para
  restaurarlo en el servidor.

## Desarrollo local (opcional, para hacer cambios)

```bash
npm install
cp .env.example .env   # y completa tus datos
npm start
```

La app queda disponible en `http://localhost:3000`.

## Estructura del proyecto

```
cobrador-app/
  server.js              # arranque del servidor
  db.js                  # base de datos (SQLite) y usuario inicial
  middleware/auth.js      # protección de rutas con sesión
  routes/                 # endpoints de la API (clientes, préstamos, pagos...)
  utils/interest.js       # cálculo de intereses y cuotas
  utils/backup.js         # copia de seguridad diaria por correo
  public/                 # interfaz (HTML/CSS/JS) tipo app móvil (PWA)
```
