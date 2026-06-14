# QA Dash — Backend

API REST + WebSocket server para el dashboard de automatización de QA.

## Stack

- **Node.js** + **Express**
- **Socket.io** — progreso en tiempo real de ejecuciones
- **pytest** — runner de tests Python (debe estar instalado en el sistema)

## Requisitos

- Node.js 18+
- npm
- Python 3.8+ con `pytest` instalado en el proyecto de automatización

## Instalación

```bash
npm install
```

## Ejecución

```bash
node server.js
```

El servidor corre en `http://localhost:3001` por defecto.  
Para cambiar el puerto: `PORT=4000 node server.js`

## Estructura

```
backend/
├── routes/
│   ├── config.js        # Configuración del proyecto
│   ├── tests.js         # Colección y ejecución de tests
│   ├── reports.js       # Historial y analítica
│   ├── env.js           # Editor de variables de entorno
│   ├── profiles.js      # Perfiles de variables
│   └── automation.js    # Instalación/actualización del repo de automatización
├── services/
│   ├── testCollector.js # pytest --collect-only
│   ├── pytestRunner.js  # Ejecución secuencial de tests
│   ├── envManager.js    # Lectura/escritura de .env
│   ├── profileManager.js
│   └── automationInstaller.js
├── server.js
└── package.json
```

## Archivos generados (no versionados)

| Archivo/Dir | Descripción |
|---|---|
| `config.json` | Ruta del proyecto, comando pytest, env, repo de automatización |
| `reports/` | JSONs de cada ejecución |
| `data/last-collection.json` | Caché de la última colección de tests |
| `profiles.json` | Perfiles de variables de entorno guardados |

Estos archivos se crean automáticamente al iniciar el servidor.

## API principal

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/config` | GET/POST | Leer/guardar configuración |
| `/api/tests/collect` | GET | Colectar tests con pytest |
| `/api/tests/cached` | GET | Última colección sin re-ejecutar pytest |
| `/api/tests/run` | POST | Ejecutar tests seleccionados |
| `/api/reports` | GET | Listado de reportes |
| `/api/reports/analytics` | GET | Estadísticas agregadas |
| `/api/automation/install` | POST | Clonar repo + venv + pip install |
| `/api/automation/update` | POST | git pull en rama indicada |

## WebSocket events (Socket.io)

| Evento | Dirección | Descripción |
|---|---|---|
| `execution:started` | server → client | Inicio de ejecución |
| `test:started` | server → client | Test individual iniciado |
| `test:completed` | server → client | Resultado de un test |
| `progress` | server → client | Progreso general |
| `execution:completed` | server → client | Ejecución terminada |
| `automation:progress` | server → client | Progreso de instalación |
| `automation:log` | server → client | Logs de instalación |
