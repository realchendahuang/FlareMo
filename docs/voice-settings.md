# Administrator-managed voice recognition

The instance owner and users with the existing team `owner` or `admin` role can configure the shared voice service under **Account → Voice recognition settings**. This permission applies to shared voice settings only; other instance-owner settings retain their original restrictions. No new tags, role tables or role-assignment UI are introduced. Ordinary members use Capture with the configured service; they cannot read or write its credentials.

The browser renders no settings panel until a fresh, user-scoped `/api/app/me` response confirms `can_manage_voice_service: true`. Pending, failed and non-administrator responses keep the panel unmounted. The API independently verifies the active browser session and voice-service management permission for every request, and exact Origin for writes. It rejects API-token authentication.

## Deployment

Apply the new D1 migration with the normal deployment procedure. Before saving credentials in the UI, set an independent, randomly generated encryption secret of at least 32 characters:

```sh
openssl rand -hex 32
pnpm exec wrangler secret put FLAREMO_VOICE_CONFIG_KEY --config ./wrangler.jsonc
```

Paste the generated value into the secret prompt and retain it in your password manager. Do not reuse the login secret or an ASR provider key. Never commit the value. For local development, set the same binding in an ignored `.dev.vars` file.

Choose Tencent Cloud or DashScope and enter all required credentials on the first save or when changing provider. Blank credential fields preserve credentials previously saved through this UI for the same provider. Environment secrets are not automatically imported. Save does not contact the cloud provider. The optional connection test uses saved settings and may incur provider charges; it does not send audio or verify transcription quality.

## Storage and lifecycle

Credentials are encrypted using AES-GCM with a fresh nonce and stored in the dedicated `voice_service_config` D1 table. Responses return only configuration metadata, never saved keys. Credential values are held only in component state while editing; they are not stored in browser persistence or the query cache. Settings responses use `Cache-Control: no-store`. Ordinary Capture status responses expose availability without the provider identity.

There is no environment-variable fallback for voice credentials. The service is unavailable until an administrator saves credentials in the site settings. Unchecking Enable and saving retains encrypted credentials while disabling Capture. Deleting credentials writes a disabled marker, so old credentials cannot silently reactivate the service. A missing or incorrect encryption key also fails closed. To enable again, enter new credentials and save with Enable selected.

Configuration updates use revisions to reject stale writes from another open tab. Existing recordings keep their original provider configuration. Disabling is checked again at the existing session reauthentication interval (up to 60 seconds); new connections are rejected immediately. This is not instantaneous revocation of every active connection.

Normal memo exports do not include this configuration. Full D1 backups contain ciphertext; restore requires the corresponding independently retained encryption secret. Replacing the secret without re-encrypting makes existing credentials unreadable. Restore the original secret or delete the saved credentials and enter them again. There is no automatic key-rotation workflow in this version.

The new UI strings are available in Chinese and English; other locales currently use English for this panel.
