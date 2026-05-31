# lab-backend (cPanel)

API REST del sistema de laboratorio clínico — **Sprints 0–9 completos**, adaptada para despliegue en **hosting compartido cPanel**.

Stack: Node.js 20 · NestJS 10 · TypeScript 5 (estricto) · Prisma 6 · **MySQL/MariaDB** · pino · Swagger · **pdfmake (PDF sin navegador)** · EventEmitter2.

> Esta variante reemplaza PostgreSQL → MySQL, Puppeteer/Chromium → pdfmake, y Docker/Railway → Phusion Passenger, para correr en cPanel sin binarios externos.

---

## Requisitos

- **Node.js 20** (en cPanel se selecciona en *Setup Node.js App*).
- **pnpm 9** (`corepack enable && corepack prepare pnpm@9 --activate`) — en local. En cPanel se usa `npm install` desde la UI.
- **MySQL / MariaDB** — base de datos creada desde *MySQL® Databases* en cPanel.

No requiere Docker ni Chrome: el PDF se genera 100% en Node con `pdfmake`.

## Arranque rápido (desarrollo local)

```powershell
# 1. Instalar deps
$env:NODE_OPTIONS="--use-system-ca"
pnpm install

# 2. Copiar variables de entorno y editar JWT_SECRET / DATABASE_URL
Copy-Item .env.example .env

# 3. Generar el cliente Prisma y aplicar el esquema a MySQL
pnpm db:generate
pnpm db:migrate:deploy   # o `pnpm db:push` si aún no hay migraciones MySQL

# 4. Sembrar admin + lab_config + catálogo demo
pnpm db:seed

# 5. Arrancar la API en modo dev
pnpm start:dev
```

Cuando arranque:

- API: <http://localhost:3000/api/v1/health>
- Swagger: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/docs-json>

Credenciales del admin sembrado (configurables por `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

| Email | Password |
|---|---|
| `admin@laboratorio.com` | `Admin123!` |

## Módulos disponibles

| Sprint | Módulo | Endpoints principales |
|---|---|---|
| 1 | `auth` | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password` |
| 1 | `users` | placeholder admin (uso interno) |
| 2 | `catalog/categories`, `catalog/tests`, `catalog/reference-ranges` | CRUD admin |
| 3 | `catalog/panels`, `catalog/import` | paneles + import XLSX (dry-run + confirm) |
| 4 | `patients`, `references`, `professionals`, `lab-config` | CRUD + portal access + firmas + logo |
| 5 | `orders`, `results` | máquina de estados + bulk-save autosave |
| 6 | `reports`, `verify` | **PDF con pdfmake** + verificación pública con QR |
| 7 | `portal` (`/me/...`, `/me/reference/...`) | portales paciente y referencia |
| 8 | `audit`, `dashboards` | trazas + KPIs (`/audit`, `/admin/dashboard/overview`, `/admin/dashboard/timeline`) |
| 9 | hardening, e2e tests, deploy | rate limiting endurecido, suite Jest e2e |

Todos los errores siguen el formato **RFC 7807** (`application/problem+json`).

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `pnpm start:dev` | API con hot-reload |
| `pnpm build` | Compila a `dist/` |
| `pnpm start:prod` | Corre el build (`node dist/main.js`) |
| `pnpm lint` | Lint con auto-fix |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Tests unitarios (jest) |
| `pnpm test:e2e` | Suite e2e contra MySQL real (admin sembrado) |
| `pnpm db:migrate` | Migración dev (genera SQL y aplica) |
| `pnpm db:migrate:deploy` | Aplica migraciones pendientes (CI / prod) |
| `pnpm db:seed` | Carga admin + lab_config + categorías + test demo |
| `pnpm db:studio` | Abre Prisma Studio |

## Variables de entorno

Ver `.env.example`. Validación con Zod en `src/config/env.validation.ts`; si falta una crítica, la app no arranca.

Variables más importantes:

- `DATABASE_URL` — URL de MySQL. Formato: `mysql://usuario:password@localhost:3306/nombre_bd`.
- `JWT_SECRET` — mínimo 32 caracteres.
- `FRONT_URL` — origen permitido por CORS.
- `PUBLIC_VERIFY_URL` — URL pública del frontend donde se sirve `/verificar/:token` (usada en el QR del PDF).
- `STORAGE_DRIVER` / `STORAGE_PATH` — almacenamiento local de logo, firmas y PDFs.
- `RESEND_API_KEY` — opcional, para correos transaccionales.
- `LOG_LEVEL` — `info` por defecto; `debug` para depurar.

> Ya no existe `CHROMIUM_PATH`: pdfmake no usa navegador.

## Tests end-to-end

Los specs en `test/*.e2e-spec.ts` se ejecutan contra la **DB de desarrollo** (no monta una DB aislada): asumen que el esquema está aplicado y el admin sembrado. Cada spec limpia sus propios datos en `afterAll`.

```powershell
$env:NODE_OPTIONS="--use-system-ca"
pnpm test:e2e
```

Coverage actual:

- `health.e2e-spec.ts` — endpoints públicos y guard de auth.
- `auth.e2e-spec.ts` — login, refresh, /me, rejection de payloads malos.
- `orders-flow.e2e-spec.ts` — flujo completo paciente → orden → bulk-save → validate → deliver → audit + dashboard.

El throttler se desactiva automáticamente cuando `NODE_ENV=test` (ver `src/shared/guards/test-aware-throttler.guard.ts`).

## Despliegue en cPanel

### 1. Crear la base de datos MySQL

En cPanel → **MySQL® Databases**:
1. Crear una base de datos (ej. `usuario_lab`).
2. Crear un usuario MySQL y asignarle **todos los privilegios** sobre esa base.
3. Anotar el `DATABASE_URL`: `mysql://usuario_lab:PASSWORD@localhost:3306/usuario_lab`.

### 2. Subir el código

Sube el repo (sin `node_modules` ni `dist`) a una carpeta fuera de `public_html`, por ejemplo `~/apps/lab-backend`.

### 3. Crear la aplicación Node.js

En cPanel → **Setup Node.js App**:
- **Node version:** 20.x
- **Application root:** `apps/lab-backend`
- **Application startup file:** `app.js` ← Passenger lo detecta automáticamente y carga `dist/main.js`.
- Crear las variables de entorno (las mismas del `.env`) desde la sección *Environment variables* del panel.

### 4. Instalar, compilar y migrar

Desde el botón **Run NPM Install**, o por terminal SSH dentro del virtualenv que cPanel crea:

```bash
# Entrar al entorno de la app (cPanel muestra el comando exacto, ej.:)
source ~/nodevenv/apps/lab-backend/20/bin/activate
cd ~/apps/lab-backend

npm install
npm run build
npx prisma migrate deploy   # o `npx prisma db push`
node dist/prisma/seed.js     # admin + lab_config + catálogo demo
```

### 5. Reiniciar y verificar

Pulsa **Restart** en *Setup Node.js App* y verifica:

- `https://api.tudominio.com/api/v1/health`
- Activa **SSL (Let's Encrypt)** sobre el dominio/subdominio de la API.

### Notas de la adaptación a cPanel

- **`app.js`** es el punto de entrada para **Phusion Passenger** (el gestor de Node que usa cPanel). Mantiene el proceso vivo; no necesitas pm2 ni Docker.
- **PDF con pdfmake:** generación pura en Node, sin Chromium. El logo y las firmas se embeben en base64 leyéndolos del storage local.
- **MySQL:** el esquema Prisma usa `VarChar(36)` para IDs (UUID), `DateTime(3)` para timestamps y `Json` para metadata. Las unicidades parciales de Postgres se validan a nivel de servicio.

## Hardening de seguridad

Configurado out-of-the-box:

- **Helmet** con CSP estricta + COOP/CORP, en `src/main.ts`.
- **Throttler** global (100 req/min) + límites endurecidos en `/auth/login` (5/min) y `/auth/reset-password` (3/min). El lockout a nivel de cuenta vive en `AuthService` (5 fallos consecutivos bloquean por 15 min).
- **CORS** restringido a `FRONT_URL`.
- **JWT** con refresh rotation; el refresh va en cookie HttpOnly + SameSite Lax (Secure se activa en prod).
- **Audit log** persistente para todas las acciones críticas (state changes de orden, soft-deletes, credenciales emitidas, cambios de config).
- **Soft-delete** en todas las entidades clínicas — nunca se borran filas físicas.
- **Versionado** en Test (TestHistory) y Order (snapshot del nombre/unidad en `OrderItem`) para que el PDF refleje siempre la versión vigente al momento de la captura.

## Estructura

```
lab-backend/
├── prisma/
│   ├── schema.prisma            ← 25+ modelos, datasource = mysql
│   ├── migrations/              ← migraciones SQL versionadas
│   └── seed.ts                  ← admin + lab_config + categorías + test demo
├── src/
│   ├── config/                  ← env validation (Zod) + swagger
│   ├── modules/
│   │   ├── audit/               ← AuditLog + suscriptor de eventos
│   │   ├── auth/                ← login, refresh, recover, change-password
│   │   ├── catalog/             ← categories + tests + panels + ranges + import
│   │   ├── dashboards/          ← /admin/dashboard/overview + /timeline
│   │   ├── health/              ← /health + /health/ready
│   │   ├── lab-config/          ← config global + logo
│   │   ├── notifications/       ← Resend + suscriptores de eventos
│   │   ├── orders/              ← state machine + items + amend
│   │   ├── patients/            ← CRUD + portal access
│   │   ├── portal/              ← /me/* y /me/reference/*
│   │   ├── professionals/       ← CRUD + firma
│   │   ├── references/          ← CRUD + usuarios anidados
│   │   ├── reports/             ← pdfmake + QR + /verify/:token
│   │   ├── results/             ← captura + bulk-save autosave
│   │   ├── storage/             ← GET /storage/:folder/:file
│   │   └── users/               ← interno (admin seed)
│   ├── shared/
│   │   ├── decorators/
│   │   ├── events/              ← AppEvents + payloads tipados
│   │   ├── filters/             ← RFC 7807
│   │   ├── guards/              ← JWT, Roles, TestAwareThrottler
│   │   ├── interceptors/
│   │   ├── prisma/
│   │   └── storage/             ← LocalStorageService + image-upload validators
│   ├── app.module.ts
│   └── main.ts
├── test/
│   ├── helpers/app.ts           ← bootstrap mínimo para e2e
│   ├── *.e2e-spec.ts            ← suite end-to-end
│   ├── jest-e2e.json
│   └── setup-e2e.ts
├── app.js                       ← entry point Phusion Passenger (carga dist/main.js)
└── .env.example
```

## Troubleshooting

**`Access denied for user` / `Unknown database` al migrar**
→ Revisa el `DATABASE_URL`. En cPanel el usuario y la base suelen llevar prefijo de cuenta (`cuenta_usuario`, `cuenta_bd`) y el host es `localhost`.

**`drift detected` al correr `prisma migrate dev`**
→ Si la carpeta `migrations/` viene de la versión PostgreSQL, bórrala y regenera contra MySQL: `npx prisma migrate dev --name init`, o usa directamente `npx prisma db push`.

**La app no arranca en cPanel tras el deploy**
→ Verifica que `npm run build` haya generado `dist/main.js` y que el *startup file* sea `app.js`. Revisa el log en *Setup Node.js App* y pulsa **Restart**.

**Tests e2e fallan con 429 al hacer login**
→ Verifica `NODE_ENV=test`. El `TestAwareThrottlerGuard` skipea el rate-limit solo en ese modo.

## Licencia

UNLICENSED — uso interno.
