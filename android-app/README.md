# Android app `internal_chat`

Cliente Android nativo para el provider `internal_chat`.

## Requisitos para compilar

- JDK 17
- Android SDK con `compileSdk 35`
- Gradle wrapper o Android Studio
- Archivo `app/google-services.json` del proyecto Firebase

## Configuracion

Crear `local.properties` con al menos:

```properties
sdk.dir=C:\\Users\\TU_USUARIO\\AppData\\Local\\Android\\Sdk
backend.baseUrl=http://TU_SERVIDOR:3000/
```

Notas:

- `backend.baseUrl` debe terminar en `/`.
- Para usar HTTPS con certificado propio o por tunel, cambiar `usesCleartextTraffic` y la URL segun tu entorno.
- FCM requiere agregar el `google-services.json` real; el repo solo deja la estructura preparada.

## Endpoints usados

- `POST /api/mobile/login`
- `POST /api/mobile/logout`
- `GET /api/mobile/me`
- `GET /api/mobile/conversations`
- `GET /api/mobile/conversations/:id/messages`
- `POST /api/mobile/conversations/:id/messages`
- `POST /api/mobile/conversations/:id/read`
- `POST /api/mobile/devices`

## Estado

Este modulo queda scaffolded dentro del repo. En esta maquina no se genero APK porque no hay JDK/Android SDK instalados.
